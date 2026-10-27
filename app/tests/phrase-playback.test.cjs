'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const study = require('../study-help.js');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'speech-training/listen.html'), 'utf8');
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'speech-training/demo-assets/demo-data.json'), 'utf8'));
const catalog = bundle.reference_audio.by_text;
const phrase = 'This is a leaf.';

function setup(t, { side = 'baseline', examples = catalog } = {}) {
  const dom = new JSDOM(html, { url: 'https://garden.example/prefix/speech-training/listen.html', runScripts: 'outside-only' });
  const { window } = dom, plays = [], pauses = [], loads = [], requests = [];
  window.HTMLMediaElement.prototype.play = function () { plays.push(this); this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () { pauses.push(this); };
  window.HTMLMediaElement.prototype.load = function () { loads.push(this); };
  Object.defineProperty(window.crypto, 'getRandomValues', { value: bytes => { bytes.fill(side === 'candidate' ? 1 : 0); return bytes; } });
  window.fetch = (...args) => { requests.push(args); throw new Error('Example playback must use public local assets'); };
  window.EGLStudyHelp = study;
  window.EGL_REFERENCE_AUDIO = examples;
  window.EGLPhonetics = { mount: () => () => {} };
  for (const script of window.document.querySelectorAll('script:not([src])')) {
    if (script.type !== 'application/json') window.eval(script.textContent);
  }
  const document = window.document;
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  const buttons = [...document.querySelectorAll('.study-chunk')];
  const selected = bundle.pairs.find(pair => pair.id === document.querySelector('.phrase-card').dataset.promptId);
  return { window, document, plays, pauses, loads, requests, selected,
    exact: buttons.find(button => button.querySelector('span').textContent === phrase),
    fallback: buttons.find(button => button.querySelector('span').textContent !== phrase),
    separate: document.querySelector('.phrase-example-player'), A: document.querySelector('[data-voice="A"]'),
    status: () => document.querySelector('.example-status').textContent };
}

function monitor(media, position = .6) {
  const writes = [];
  Object.defineProperty(media, 'readyState', { value: 1, configurable: true });
  Object.defineProperty(media, 'currentTime', { configurable: true, get: () => position, set: value => { writes.push(value); position = value; } });
  return { writes, advance: value => { position = value; } };
}

test('an exact public phrase uses its complete separately spoken asset, independently of blind A/B assignment', t => {
  const example = catalog[phrase], file = path.resolve(root, 'app', example.url), audio = fs.readFileSync(file);
  assert.equal(example.text, phrase);
  assert.equal(crypto.createHash('sha256').update(audio).digest('hex'), example.audio_sha256);
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  let rate, channels, bits, frames;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const tag = audio.toString('ascii', offset, offset + 4), size = audio.readUInt32LE(offset + 4), start = offset + 8;
    if (tag === 'fmt ') { channels = audio.readUInt16LE(start + 2); rate = audio.readUInt32LE(start + 4); bits = audio.readUInt16LE(start + 14); }
    if (tag === 'data') frames = size / (channels * bits / 8);
    offset = start + size + size % 2;
  }
  assert.equal(frames / rate, example.duration_seconds, 'the selected asset is the complete manifest recording');
  for (const side of ['baseline', 'candidate']) {
    const app = setup(t, { side }), playback = monitor(app.separate);
    assert.match(app.exact.querySelector('.chunk-playback-mode').textContent, /เสียงวลีแยก/);
    app.exact.click();
    assert.equal(app.separate.getAttribute('src'), example.url);
    assert.deepEqual(playback.writes, [0]);
    assert.deepEqual(app.plays, [app.separate], 'a separate example must not be presented as blind A or B');
    assert.match(app.status(), /ไม่ใช่ช่วงตัดจากเสียง A\/B/);
    const paused = app.pauses.length;
    playback.advance(example.duration_seconds - .01);
    app.separate.dispatchEvent(new app.window.Event('timeupdate'));
    assert.equal(app.pauses.length, paused);
    app.separate.dispatchEvent(new app.window.Event('ended'));
    assert.match(app.status(), /ฟังจบแล้ว/);
    assert.equal(app.requests.length, 0);
  }
});

test('missing isolated phrases clearly play the matching complete A sentence without timestamp cuts', t => {
  for (const side of ['baseline', 'candidate']) {
    const app = setup(t, { side }), playback = monitor(app.A);
    assert.equal(app.A.getAttribute('src'), app.selected[side].audio);
    assert.match(app.fallback.querySelector('.chunk-playback-mode').textContent, /ประโยคเต็มจากเสียง A/);
    const slow = app.document.querySelector('#example-slow'); slow.checked = true;
    slow.dispatchEvent(new app.window.Event('change'));
    app.fallback.click();
    assert.deepEqual(playback.writes, [0]);
    assert.deepEqual(app.plays, [app.A]);
    assert.equal(app.A.playbackRate, .75); assert.equal(app.A.preservesPitch, true);
    assert.match(app.status(), /ประโยคเต็มจากเสียง A · ยังไม่มีเสียงวลีแยก/);
    const paused = app.pauses.length;
    const lastWord = app.selected[side].reference.words.at(-1);
    playback.advance(lastWord.end + .01); app.A.dispatchEvent(new app.window.Event('timeupdate'));
    assert.equal(app.pauses.length, paused, 'even the final approximate CTC word edge cannot stop playback');
    assert.doesNotMatch(app.status(), /ฟังจบแล้ว/);
    app.A.dispatchEvent(new app.window.Event('ended'));
    assert.match(app.status(), /ฟังจบแล้ว/);
    assert.equal(app.requests.length, 0);
  }
});

test('a catalog key cannot substitute a recording whose actual text differs from the selected phrase', t => {
  const app = setup(t, { examples: { [phrase]: { ...catalog[phrase], text: 'A different sentence.' } } });
  const playback = monitor(app.A);
  app.exact.click();
  assert.match(app.exact.querySelector('.chunk-playback-mode').textContent, /ประโยคเต็ม/);
  assert.deepEqual(app.plays, [app.A]); assert.deepEqual(playback.writes, [0]);
  assert.equal(app.separate.getAttribute('src'), null);
});

test('a fresh unloaded phrase plays inside the click and late metadata cannot replay it after switching or cleanup', t => {
  const app = setup(t);
  Object.defineProperty(app.separate, 'readyState', { value: 0, configurable: true });
  Object.defineProperty(app.separate, 'currentTime', { configurable: true, get: () => 0,
    set() { throw new Error('An unloaded complete file must not wait for or seek metadata'); } });
  monitor(app.A);
  app.exact.click();
  assert.deepEqual(app.plays, [app.separate], 'play() must run synchronously during the click, before metadata');
  assert.equal(app.loads.length, 0, 'play() loads a new complete file without a deferred metadata callback');
  app.fallback.click(); assert.deepEqual(app.plays, [app.separate, app.A]);
  app.separate.dispatchEvent(new app.window.Event('loadedmetadata'));
  assert.deepEqual(app.plays, [app.separate, app.A], 'late metadata cannot restart the previous independent example');
  app.document.querySelector('#repeat-example').click();
  assert.equal(app.plays.length, 3);
  app.document.querySelector('#next').click();
  app.A.dispatchEvent(new app.window.Event('ended'));
  app.separate.dispatchEvent(new app.window.Event('loadedmetadata'));
  app.separate.dispatchEvent(new app.window.Event('ended'));
  assert.equal(app.plays.length, 3, 'an old player cannot repeat after the phrase changes');
  assert.equal(app.A.getAttribute('src'), null); assert.equal(app.separate.getAttribute('src'), null);
  assert.equal(app.requests.length, 0);
});

test('a rejected unloaded play cleans repeat listeners and allows an explicit retry', async t => {
  const app = setup(t);
  app.window.HTMLMediaElement.prototype.play = function () { app.plays.push(this); return Promise.reject(new Error('Playback blocked')); };
  app.document.querySelector('#repeat-example').click();
  assert.deepEqual(app.plays, [app.A]);
  await Promise.resolve();
  assert.match(app.status(), /ยังเล่นตัวอย่างไม่ได้/);
  app.A.dispatchEvent(new app.window.Event('ended'));
  assert.equal(app.plays.length, 1, 'a failed play must not leave a repeat callback');
  app.window.HTMLMediaElement.prototype.play = function () { app.plays.push(this); return Promise.resolve(); };
  app.exact.click();
  assert.deepEqual(app.plays, [app.A, app.separate]);
  assert.match(app.status(), /เสียงวลีแยก/);
});
