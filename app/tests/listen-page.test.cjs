'use strict';

// Exercise the generated one-phrase workspace. The shared widget has its own
// real-runtime tests; this small mount double checks its page-level lifecycle.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'egl-listen-page-'));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const prompts = Array.from({ length: 24 }, (_, i) => ({
  id: `tts-${String(i + 1).padStart(3, '0')}`,
  text: i === 0 ? 'Hello, leaf.' : i === 1 ? 'Welcome to my garden.'
    : i === 2 ? '<img src=x onerror=window.unsafe=1> is text.' : `Practice sentence number ${i + 1}.`,
  category: i < 8 ? 'greeting' : i < 16 ? 'garden' : 'conversation'
}));
const write = (name, value) => {
  const destination = path.join(temporary, name);
  fs.writeFileSync(destination, JSON.stringify(value));
  return destination;
};
const promptPath = write('prompts.json', { prompts });
const references = { by_audio: {}, by_text: {} }, phonetics = { texts: {} };
const metadata = {};
for (const side of ['baseline', 'candidate']) {
  const directory = path.join(temporary, 'secret_' + side);
  fs.mkdirSync(directory);
  const results = prompts.map((prompt, index) => {
    const file = `${prompt.id}.wav`, absolute = path.join(directory, file);
    fs.writeFileSync(absolute, 'fixture audio; not rendered by jsdom');
    const offset = side === 'baseline' ? 0.1 : 1.1;
    references.by_audio[fs.realpathSync(absolute)] = {
      text: prompt.text,
      words: [{ index: 0, text: 'Hello', start: offset, end: offset + 0.2 },
        { index: 1, text: 'leaf', start: offset + 0.2, end: offset + 0.5 }]
    };
    phonetics.texts[prompt.text] = { text: prompt.text, accent: 'en-us', ipa: 'test IPA',
      words: [{ index: 0, text: 'Hello', ipa: 'həloʊ', phones: ['h', 'ə', 'l', 'oʊ'] }], audio_analyzed: false };
    return { ...prompt, file, seed: 3407 + index, status: 'ok', duration_seconds: 3, generation_seconds: 1 };
  });
  const file = path.join(directory, 'metadata.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'secret-model',
    adapter: side === 'candidate' ? 'secret-adapter' : null, prompts_source: promptPath,
    reference_audio_sha256: 'same-reference', conditioning: 'speaker', base_seed: 3407,
    settings: { temperature: 0.7 }, results }));
  metadata[side] = file;
}
const referencePath = write('references.json', references);
const phoneticsPath = write('phonetics.json', phonetics);
const resultPath = write('result.json', { status: 'training_completed', optimizer_steps: 24,
  weights_changed: true, validation_ce_before: 0.9, validation_ce_best: 0.8 });
const builder = path.resolve(__dirname, '../../speech-training/build_listen.py');
const html = execFileSync('python3', ['-c',
  "import runpy,sys;from pathlib import Path;n=runpy.run_path(sys.argv[1],run_name='listen_page_test');print(n['build'](*[Path(p) for p in sys.argv[2:]]))",
  builder, metadata.baseline, metadata.candidate, resultPath,
  path.join(temporary, 'listen.html'), phoneticsPath, referencePath], { encoding: 'utf8' });

function setup() {
  const errors = [], mounts = [], cleanups = [], exports = [], plays = [], pauses = [], requests = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8766/speech-training/listen.html',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  let activeWidgets = 0;
  window.HTMLMediaElement.prototype.pause = function () { pauses.push(this); };
  window.HTMLMediaElement.prototype.play = function () {
    plays.push(this); this.dispatchEvent(new window.Event('play')); return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.load = function () {};
  window.HTMLAnchorElement.prototype.click = function () {};
  window.Blob = Blob;
  window.URL.createObjectURL = blob => { exports.push(blob); return 'blob:rating-export'; };
  window.URL.revokeObjectURL = () => {};
  window.fetch = (...args) => { requests.push(args); throw new Error('Unexpected network request'); };
  Object.defineProperty(window.navigator, 'mediaDevices', { value: {
    getUserMedia() { throw new Error('Microphone must not open automatically'); }
  } });
  window.EGLStudyHelp = { forText(text) { return {
    translation: text === prompts[0].text ? 'สวัสดี ใบไม้' : 'ความหมายภาษาไทยของประโยคที่เลือก',
    tip: 'ค่อย ๆ ฟังทีละวลี', chunks: [{ text, translation: 'ฟังวลีนี้', wordIndices: [0, 1] }], words: {}
  }; } };
  window.EGLPhonetics = { mount(container, options) {
    activeWidgets++; mounts.push(options);
    const details = window.document.createElement('details');
    details.className = 'test-phonetic-widget'; details.open = options.expanded;
    const summary = window.document.createElement('summary'); summary.textContent = 'ฝึกทีละคำ';
    details.append(summary); container.append(details);
    let disposed = false;
    return () => { if (disposed) return; disposed = true; activeWidgets--; cleanups.push(options.text); details.remove(); };
  } };
  const scripts = [...window.document.querySelectorAll('script')].filter(node => !node.src && node.type !== 'application/json');
  scripts.forEach(script => window.eval(script.textContent));
  return { dom, window, document: window.document, errors, mounts, cleanups, exports, plays, pauses, requests,
    activeWidgets: () => activeWidgets,
    close() { window.dispatchEvent(new window.Event('pagehide')); window.close(); } };
}

function click(app, selector) {
  const element = app.document.querySelector(selector);
  assert.ok(element, 'Missing ' + selector);
  assert.equal(element.disabled, false, 'Disabled ' + selector);
  element.click();
}
function change(app, selector, value, eventName = 'change') {
  const element = app.document.querySelector(selector);
  element.value = value; element.dispatchEvent(new app.window.Event(eventName, { bubbles: true }));
}
function selected(app) { return app.document.querySelector('.phrase-card')?.dataset.promptId || null; }

test('generated page opens one beginner-friendly phrase and expanded widget without playback, network or identity disclosure', t => {
  const app = setup(); t.after(() => app.close());
  assert.equal(app.document.querySelectorAll('.phrase-card').length, 1);
  assert.equal(app.document.querySelectorAll('.phrase-option').length, 24);
  assert.equal(app.activeWidgets(), 1);
  assert.equal(app.document.querySelector('.test-phonetic-widget').open, true);
  assert.equal(app.mounts[0].expanded, true);
  assert.equal(app.mounts[0].precomputed.text, prompts[0].text);
  assert.equal(app.document.querySelector('.phrase-translation').textContent, 'สวัสดี ใบไม้');
  assert.equal(app.document.querySelector('.phrase-option .list-translation').textContent, 'สวัสดี ใบไม้');
  assert.equal(app.document.querySelectorAll('.voice audio').length, 2);
  assert.equal(app.document.querySelectorAll('audio[autoplay]').length, 0);
  assert.equal(app.document.querySelector('#experiment').open, false);
  assert.ok(app.document.querySelector('#experiment .metrics'));
  assert.match(app.document.querySelector('#phrase-counter').textContent, /1 \/ 24/);
  assert.equal(app.document.querySelector('#previous').disabled, true);
  assert.ok(!app.document.querySelector('main').textContent.includes('secret_'));
  assert.ok(!app.document.querySelector('main').textContent.includes('secret-model'));
  assert.deepEqual(Array.from(app.mounts[0].audioSources, source => source.label), ['A', 'B']);
  assert.equal(app.mounts[0].referenceExample.url, app.document.querySelector('[data-voice="A"]').getAttribute('src'));
  assert.equal(app.plays.length, 0);
  assert.equal(app.requests.length, 0);
  const sources = [...app.document.querySelectorAll('script[src]')].map(node => node.src);
  assert.ok(sources.findIndex(src => src.endsWith('/study-help.js')) < sources.findIndex(src => src.endsWith('/phonetics.js')));
  assert.deepEqual(app.errors, []);
});

test('next and previous clean up media while preserving ratings and blind assignments for each phrase', t => {
  const app = setup(); t.after(() => app.close());
  const firstAudio = app.document.querySelector('[data-voice="A"]'), firstSource = firstAudio.getAttribute('src');
  click(app, 'input[name="tts-001-A"][value="5"]');
  click(app, 'input[name="tts-001-B"][value="4"]');
  click(app, 'input[name="tts-001-preference"][value="A"]');
  assert.match(app.document.querySelector('#progress').textContent, /1 \/ 24/);
  click(app, '#next');
  assert.equal(selected(app), 'tts-002');
  assert.equal(app.activeWidgets(), 1);
  assert.equal(app.cleanups.length, 1);
  assert.ok(app.pauses.includes(firstAudio));
  assert.equal(firstAudio.getAttribute('src'), null);
  click(app, '#previous');
  assert.equal(selected(app), 'tts-001');
  assert.equal(app.document.querySelector('[data-voice="A"]').getAttribute('src'), firstSource);
  assert.equal(app.document.querySelector('input[name="tts-001-A"][value="5"]').checked, true);
  assert.equal(app.document.querySelector('input[name="tts-001-B"][value="4"]').checked, true);
  assert.equal(app.document.querySelector('input[name="tts-001-preference"][value="A"]').checked, true);
  assert.equal(app.activeWidgets(), 1);
  assert.deepEqual(app.errors, []);
});

test('search and category filters select only visible phrases, clear stale analysis and render unsafe-looking text safely', t => {
  const app = setup(); t.after(() => app.close());
  change(app, '#phrase-search', 'nothing matches this phrase', 'input');
  assert.equal(selected(app), null);
  assert.equal(app.activeWidgets(), 0);
  assert.equal(app.document.querySelectorAll('audio').length, 0);
  assert.equal(app.document.querySelector('#previous').disabled, true);
  assert.equal(app.document.querySelector('#next').disabled, true);
  change(app, '#phrase-search', '<img', 'input');
  assert.equal(selected(app), 'tts-003');
  assert.equal(app.document.querySelectorAll('img').length, 0);
  assert.equal(app.window.unsafe, undefined);
  assert.equal(app.document.querySelector('.phrase-text').textContent, prompts[2].text);
  change(app, '#phrase-search', 'สวัสดี', 'input');
  assert.equal(selected(app), 'tts-001');
  assert.equal(app.document.querySelectorAll('.phrase-option').length, 1);
  change(app, '#phrase-search', '', 'input');
  change(app, '#phrase-category', 'garden');
  assert.equal(selected(app), 'tts-009');
  assert.equal(app.document.querySelectorAll('.phrase-option').length, 8);
  assert.equal(app.document.querySelector('#previous').disabled, true);
  click(app, '#next'); assert.equal(selected(app), 'tts-010');
  assert.equal(app.activeWidgets(), 1);
  assert.deepEqual(app.errors, []);
});

test('Thai phrase chunks replay the actual A word boundaries, with slow playback and a finite two-repeat control', t => {
  const app = setup(); t.after(() => app.close());
  const audio = app.document.querySelector('[data-voice="A"]');
  Object.defineProperty(audio, 'readyState', { value: 1, configurable: true });
  const example = app.mounts[0].referenceExample;
  click(app, '.study-chunk');
  assert.equal(audio.currentTime, example.words[0].start);
  assert.equal(app.plays.length, 1);
  const slow = app.document.querySelector('#example-slow'); slow.checked = true;
  slow.dispatchEvent(new app.window.Event('change'));
  assert.equal(audio.playbackRate, 0.75);
  assert.equal(app.document.querySelector('[data-voice="B"]').playbackRate, 0.75);
  audio.currentTime = example.words[1].end + 0.01;
  audio.dispatchEvent(new app.window.Event('timeupdate'));
  assert.match(app.document.querySelector('.example-status').textContent, /ฟังจบแล้ว/);
  click(app, '#repeat-example');
  assert.equal(app.plays.length, 2);
  audio.dispatchEvent(new app.window.Event('ended'));
  assert.equal(app.plays.length, 3);
  audio.dispatchEvent(new app.window.Event('ended'));
  assert.equal(app.plays.length, 3, 'Repeat ends after exactly two plays');
  click(app, '#next');
  audio.dispatchEvent(new app.window.Event('ended'));
  assert.equal(app.plays.length, 3, 'An old player cannot continue repeating after a phrase change');
  assert.equal(app.document.querySelector('[data-voice="A"]').playbackRate, 0.75);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.errors, []);
});

test('revealing identities applies to later phrases while widget sources remain labeled A and B', t => {
  const app = setup(); t.after(() => app.close());
  assert.ok([...app.document.querySelectorAll('.identity')].every(node => /ซ่อน/.test(node.textContent)));
  click(app, '#reveal');
  assert.ok([...app.document.querySelectorAll('.identity')].some(node => node.textContent === 'โมเดลเดิม'));
  assert.ok([...app.document.querySelectorAll('.identity')].some(node => node.textContent === 'รุ่นที่ปรับด้วยข้อมูลเสียง'));
  click(app, '#next');
  assert.ok([...app.document.querySelectorAll('.identity')].every(node => !/ซ่อน/.test(node.textContent)));
  assert.deepEqual(Array.from(app.mounts.at(-1).audioSources, source => source.label), ['A', 'B']);
  assert.equal(app.document.querySelector('#reveal').disabled, true);
  assert.deepEqual(app.errors, []);
});

test('export keeps all 24 assignments and unrated entries across filtering; pagehide disposes the sole widget', async t => {
  const app = setup(); t.after(() => app.close());
  const firstSource = app.document.querySelector('[data-voice="A"]').getAttribute('src');
  click(app, 'input[name="tts-001-A"][value="5"]');
  change(app, '#phrase-category', 'conversation');
  assert.equal(selected(app), 'tts-017');
  click(app, '#export');
  assert.equal(app.exports.length, 1);
  const result = JSON.parse(await app.exports[0].text());
  assert.equal(result.ratings.length, 24);
  assert.equal(result.ratings[0].naturalness_A, 5);
  assert.equal(result.ratings[0].naturalness_B, null);
  assert.equal(result.ratings[23].preference, null);
  assert.equal(result.selected_prompt_id, 'tts-017');
  assert.equal(result.filters.category, 'conversation');
  const expectedA = firstSource.includes('secret_baseline') ? 'baseline' : 'candidate';
  assert.equal(result.ratings[0].assignment.A, expectedA);
  assert.equal(result.revealed_at_utc, null);
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  assert.equal(app.activeWidgets(), 0);
  assert.ok([...app.document.querySelectorAll('.voice audio')].every(audio => audio.getAttribute('src') === null));
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.errors, []);
});
