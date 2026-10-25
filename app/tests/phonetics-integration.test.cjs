'use strict';

// Full application wiring with the real phonetics runtime and generated IPA
// cache. Media/API stubs exercise lifecycle and consent, not audible quality.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function boot(options = {}) {
  const errors = [], fetches = [], microphones = [], revoked = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(source('index.html'), {
    url: 'http://127.0.0.1:8766/app/index.html', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: console
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.load = function () {};
  window.speechSynthesis = { getVoices: () => [], cancel() {}, addEventListener() {} };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  let objectId = 0, recorderCount = 0;
  window.URL.createObjectURL = () => 'blob:integration-' + (++objectId);
  window.URL.revokeObjectURL = url => revoked.push(url);
  window.fetch = (...args) => {
    fetches.push(args);
    return options.fetch ? options.fetch(...args)
      : Promise.reject(new Error('Unexpected request: ' + args[0]));
  };
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: (...args) => {
      microphones.push(args);
      return options.getUserMedia ? options.getUserMedia(...args)
        : Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    } }
  });
  window.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { recorderCount++; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  };
  for (const name of ['content.js', 'core.js', 'storage.js', 'garden.js',
    'phonetic-data.js', 'phone-guide.js', 'study-help.js', 'reference-audio.js', 'phonetics.js', 'app.js']) window.eval(source(name));
  return {
    dom, window, document: window.document, errors, fetches, microphones, revoked,
    recorderCount: () => recorderCount,
    widget: () => window.document.querySelector('[data-phonetic-text]'),
    saved: () => JSON.parse(window.localStorage.getItem('egl-progress-v1')),
    close() { window.dispatchEvent(new window.Event('pagehide')); window.close(); }
  };
}

function click(app, selector) {
  const control = app.document.querySelector(selector);
  assert.ok(control, 'Missing control: ' + selector);
  assert.equal(control.disabled, false, 'Disabled control: ' + selector);
  control.click();
}

function widgetButton(app, text) {
  const control = [...app.widget().querySelectorAll('button')].find(button => button.textContent === text);
  assert.ok(control, 'Missing phonetics button: ' + text);
  assert.equal(control.disabled, false, 'Disabled phonetics button: ' + text);
  control.click();
}

function expectReference(app, text) {
  const widget = app.widget();
  assert.ok(widget, 'Phonetics widget must be mounted');
  const actual = app.window.EGL_PHONETIC_DATA[text];
  assert.ok(actual && actual.words.length, 'Real generated cache must contain ' + text);
  assert.equal(widget.querySelector('textarea').value, text);
  assert.equal(widget.querySelector('.egl-ph-reference').hidden, false);
  assert.equal(widget.querySelector('.egl-ph-reference .egl-ph-ipa').textContent, actual.ipa);
  assert.equal(widget.querySelector('.egl-ph-reference .egl-ph-technical').open, false,
    'Detailed IPA stays collapsed in the beginner view');
  assert.deepEqual([...widget.querySelectorAll('.egl-ph-reference > .egl-ph-words .egl-ph-token')].map(node => node.textContent),
    Array.from(actual.words, word => word.text));
  assert.equal(widget.querySelector('.egl-ph-observed').hidden, true,
    'Cached IPA is a text reference, never a detected pronunciation');
}

function beginListening(app) {
  click(app, '[data-view="home"]');
  click(app, '[data-action="start"][data-lesson="G01"]');
  click(app, '[data-action="next"]');
  assert.equal(app.document.querySelector('[aria-current="step"]').dataset.step, '1');
}

test('real app glossary renders cached IPA without automatic requests and uses explicit controls for API and microphone', async t => {
  let app;
  app = boot({ fetch: async (_url, init) => {
    const values = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ...app.window.EGL_PHONETIC_DATA[values.text], accent: values.accent }) };
  } });
  t.after(() => app.close());
  assert.equal(app.widget(), null, 'Home has no mounted phonetics widget');
  click(app, '[data-action="open-garden"]');
  expectReference(app, 'This is a leaf.');
  app.widget().querySelector('details').open = true;
  await flush();
  assert.equal(app.fetches.length, 0);
  assert.equal(app.microphones.length, 0);
  widgetButton(app, 'ดูคำอ่าน');
  await flush();
  assert.equal(app.fetches.length, 0, 'Explicit cached US lookup still works offline');
  const accent = app.widget().querySelector('select');
  accent.value = 'en-gb'; accent.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.fetches.length, 0, 'Changing accent alone must not send a request');
  widgetButton(app, 'ดูคำอ่าน');
  await flush();
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0][0], 'http://127.0.0.1:8766/api/phonetics/text');
  assert.deepEqual(JSON.parse(app.fetches[0][1].body), { text: 'This is a leaf.', accent: 'en-gb' });
  assert.equal(app.microphones.length, 0);
  widgetButton(app, 'บันทึกเสียงของฉัน');
  await flush();
  assert.equal(app.microphones.length, 1);
  assert.equal(app.fetches.length, 1, 'Denied microphone permission must not upload audio');
  assert.match(app.widget().querySelector('[role="status"]').textContent, /ยังไม่ได้อนุญาตไมโครโฟน/);
  assert.deepEqual(app.errors, []);
});

test('changing glossary word cleans the real previous widget, revokes its preview and aborts stale requests', async t => {
  let finish;
  const app = boot({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => app.close());
  click(app, '[data-action="open-garden"]');
  const previousWidget = app.widget();
  const previousPlayer = previousWidget.querySelector('audio');
  const input = previousWidget.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new app.window.File(['local audio bytes'], 'practice.wav', { type: 'audio/wav' })]
  });
  input.dispatchEvent(new app.window.Event('change'));
  assert.equal(previousPlayer.getAttribute('src'), 'blob:integration-1');
  assert.equal(app.fetches.length, 0, 'Choosing a local file must not upload it');
  const accent = previousWidget.querySelector('select');
  accent.value = 'en-gb'; accent.dispatchEvent(new app.window.Event('change'));
  widgetButton(app, 'ดูคำอ่าน');
  const signal = app.fetches[0][1].signal;
  assert.equal(signal.aborted, false);
  click(app, '[data-action="word"][data-word="plant"]');
  assert.equal(signal.aborted, true);
  assert.deepEqual(app.revoked, ['blob:integration-1']);
  assert.equal(previousPlayer.getAttribute('src'), null);
  assert.equal(previousWidget.children.length, 0, 'Cleanup must remove the old runtime widget');
  expectReference(app, 'This is my plant.');
  finish({ ok: true, json: async () => ({
    text: 'STALE OLD LEAF', accent: 'en-gb', ipa: 'STALE OLD IPA', words: []
  }) });
  await flush();
  assert.ok(!app.document.getElementById('screen').textContent.includes('STALE OLD'));
  expectReference(app, 'This is my plant.');
  assert.equal(app.microphones.length, 0);
  assert.deepEqual(app.errors, []);
});

test('leaving glossary for a listening task removes IPA and stops microphone tracks granted after navigation', async t => {
  let grant, stopped = 0;
  const app = boot({ getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  t.after(() => app.close());
  click(app, '[data-action="open-garden"]');
  expectReference(app, 'This is a leaf.');
  widgetButton(app, 'บันทึกเสียงของฉัน');
  assert.equal(app.microphones.length, 1);
  beginListening(app);
  assert.equal(app.widget(), null);
  assert.equal(app.document.querySelector('.egl-ph-reference'), null);
  assert.equal(app.document.querySelector('.egl-ph-text'), null);
  assert.ok(!app.document.getElementById('screen').textContent.includes('This is a leaf.'),
    'A previously visible glossary transcript must not leak into the listening question');
  assert.ok([...app.document.querySelectorAll('[data-kind="listen"][data-choice]')].every(node => node.disabled));
  grant({ getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] });
  await flush();
  assert.equal(stopped, 2);
  assert.equal(app.recorderCount(), 0, 'A late permission grant must not start recording on another page');
  assert.equal(app.fetches.length, 0);
  assert.equal(app.microphones.length, 1);
  assert.deepEqual(app.errors, []);
});

test('speaking step mounts real cached phonetics while lesson speaking evidence stays a self report', async t => {
  const app = boot(); t.after(() => app.close());
  beginListening(app);
  click(app, '[data-action="hint"][data-kind="listen"]');
  click(app, '[data-action="answer-choice"][data-choice="g-listen-leaf"]');
  click(app, '[data-action="next"]');
  click(app, '[data-action="answer-choice"][data-choice="g-read-green"]');
  click(app, '[data-action="next"]');
  const form = app.document.querySelector('form[data-form="answer"]');
  form.querySelector('input[name="answer"]').value = 'This is a leaf.';
  form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  click(app, '[data-action="next"]');
  assert.equal(app.document.querySelector('[aria-current="step"]').dataset.step, '4');
  expectReference(app, 'This is a leaf.');
  const before = app.saved().lessons.G01.speaking;
  assert.equal(before.status, 'not_assessed');
  widgetButton(app, 'ดูคำอ่าน');
  await flush();
  assert.deepEqual(app.saved().lessons.G01.speaking, before,
    'Viewing phonetics must not mark speech as assessed or practiced');
  click(app, '[data-action="speaking"][data-support="model"]');
  const reported = app.saved().lessons.G01.speaking;
  assert.equal(reported.status, 'self_practiced');
  assert.equal(reported.support, 'model');
  assert.deepEqual(Object.keys(reported).sort(), ['at', 'status', 'support']);
  expectReference(app, 'This is a leaf.');
  assert.equal(app.fetches.length, 0);
  assert.equal(app.microphones.length, 0);
  assert.deepEqual(app.errors, []);
});
