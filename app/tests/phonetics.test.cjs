const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'phonetics.js'), 'utf8');

function setup(options = {}) {
  const dom = new JSDOM('<main id="widget"></main>', { url: options.url || 'http://127.0.0.1:8766/app/index.html', runScripts: 'outside-only' });
  const window = dom.window;
  const calls = [], revoked = [];
  let objectId = 0, plays = 0;
  const playedElements = [], loadedElements = [];
  window.URL.createObjectURL = () => 'blob:test-' + (++objectId);
  window.URL.revokeObjectURL = url => revoked.push(url);
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.play = function () { plays++; playedElements.push(this); return Promise.resolve(); };
  window.HTMLMediaElement.prototype.load = function () { loadedElements.push(this); };
  window.fetch = async (...args) => { calls.push(args); return options.fetch ? options.fetch(...args) : Promise.reject(new TypeError('Failed to fetch')); };
  Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: options.getUserMedia || (() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))) }, configurable: true });
  if (options.MediaRecorder) window.MediaRecorder = options.MediaRecorder;
  if (options.AudioContext) window.AudioContext = options.AudioContext;
  if (options.globals) Object.assign(window, options.globals);
  window.eval(source);
  const container = window.document.getElementById('widget');
  const cleanup = window.EGLPhonetics.mount(container, { text: 'Hello, leaf.', ...(options.mount || {}) });
  return { dom, window, container, cleanup, calls, revoked, playedElements, loadedElements, plays: () => plays, button: text => [...container.querySelectorAll('button')].find(node => node.textContent === text) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function reference(text = 'Hello, leaf.', accent = 'en-us') {
  return { text, accent, ipa: 'həˈloʊ liːf', words: [{ index: 0, text: 'Hello', ipa: 'həˈloʊ', phones: ['h', 'ə', 'l', 'oʊ'] }], analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
}
const ok = data => ({ ok: true, status: 200, json: async () => data });

function pcmFixture() {
  const rate = 16000, frames = 8000, bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI / 20) * 8000), true);
  return bytes;
}
function decodedFixture(options = {}) {
  const frames = options.frames == null ? 8000 : options.frames, sampleRate = 16000;
  return { sampleRate, length: frames, duration: options.duration == null ? frames / sampleRate : options.duration, numberOfChannels: 2,
    getChannelData: channel => new Float32Array(frames).fill(channel ? 0 : .5) };
}
function installCapture(app, options = {}) {
  let active;
  app.window.navigator.mediaDevices.getUserMedia = options.getUserMedia || (async () => ({ getTracks: () => [{ stop() {} }] }));
  app.window.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { active = this; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      if (this.ondataavailable) this.ondataavailable({ data: new app.window.Blob([options.bytes || pcmFixture()], { type: this.mimeType }) });
      if (this.onstop) this.finished = this.onstop();
    }
  };
  if (options.decode) app.window.AudioContext = class {
    decodeAudioData(bytes) { return options.decode(bytes); }
    close() { if (options.onClose) options.onClose(); return Promise.resolve(); }
  };
  return () => active;
}
async function recorded(app, active) {
  app.button('บันทึกเสียงของฉัน').click(); await flush();
  app.button('หยุดบันทึก').click();
  await active().finished;
}
function readBlob(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
}

test('mount stays collapsed, makes no requests or microphone calls, and escapes precomputed text', async () => {
  let mic = 0;
  const text = '<img src=x onerror=alert(1)>';
  const precomputed = reference(text);
  precomputed.words[0].text = text;
  const app = setup({ getUserMedia: () => { mic++; }, mount: { text, precomputed } });
  assert.equal(app.container.querySelector('details').open, false);
  assert.equal(app.calls.length, 0);
  assert.equal(mic, 0);
  assert.equal(app.container.querySelectorAll('img,script,svg').length, 0);
  assert.ok(app.container.textContent.includes(text));
  app.container.querySelector('details').open = true;
  await flush();
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('text reference uses explicit POST and cannot be mistaken for audio analysis', async () => {
  const app = setup({ fetch: async (_url, init) => ok(reference(JSON.parse(init.body).text, JSON.parse(init.body).accent)) });
  app.container.querySelector('select').value = 'en-gb';
  app.container.querySelector('select').dispatchEvent(new app.window.Event('change'));
  app.button('ดูคำอ่าน').click();
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], 'http://127.0.0.1:8766/api/phonetics/text');
  assert.equal(app.calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(app.calls[0][1].body), { text: 'Hello, leaf.', accent: 'en-gb' });
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.match(app.container.querySelector('[role=status]').textContent, /ยังไม่ได้วิเคราะห์เสียง/);
  app.cleanup(); app.dom.window.close();
});

test('text editing aborts pending request and ignores stale successful responses', async () => {
  let finish;
  const app = setup({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  app.button('ดูคำอ่าน').click();
  const signal = app.calls[0][1].signal;
  const input = app.container.querySelector('textarea');
  input.value = 'New text.';
  input.dispatchEvent(new app.window.Event('input'));
  assert.equal(signal.aborted, true);
  finish(ok(reference('OLD RESPONSE')));
  await flush();
  assert.ok(!app.container.textContent.includes('OLD RESPONSE'));
  assert.equal(app.container.querySelector('.egl-ph-reference').hidden, true);
  app.cleanup(); app.dom.window.close();
});

test('failed local service gives friendly help and loopback link without requesting microphone', async () => {
  const app = setup();
  app.button('ดูคำอ่าน').click();
  await flush();
  assert.match(app.container.querySelector('[role=status]').textContent, /เปิดบริการเสียงในเครื่องก่อน/);
  assert.equal(app.container.querySelector('.egl-ph-service').hidden, false);
  assert.equal(app.container.querySelector('.egl-ph-service-link').href, 'http://127.0.0.1:8766/app/index.html');
  app.cleanup(); app.dom.window.close();
});

test('microphone denial is recoverable and no audio is uploaded', async () => {
  class Recorder {}
  let mic = 0;
  const app = setup({ MediaRecorder: Recorder, getUserMedia: () => { mic++; return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); } });
  assert.equal(mic, 0);
  app.button('บันทึกเสียงของฉัน').click();
  await flush();
  assert.equal(mic, 1);
  assert.equal(app.calls.length, 0);
  assert.match(app.container.querySelector('[role=status]').textContent, /ยังไม่ได้อนุญาตไมโครโฟน/);
  assert.equal(app.button('บันทึกเสียงของฉัน').disabled, false);
  app.cleanup(); app.dom.window.close();
});

test('cleanup while microphone permission is pending stops every late-acquired track', async () => {
  let grant, stopped = 0, recorderCreated = 0;
  class Recorder { constructor() { recorderCreated++; } }
  const app = setup({ MediaRecorder: Recorder, getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  app.button('บันทึกเสียงของฉัน').click();
  app.cleanup(); app.cleanup();
  grant({ getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] });
  await flush();
  assert.equal(stopped, 2);
  assert.equal(recorderCreated, 0);
  assert.equal(app.calls.length, 0);
  app.dom.window.close();
});

test('recording stops tracks, creates a preview, and uploads only after explicit analyze', async () => {
  let stopped = 0;
  const app = setup({ getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }), fetch: async () => ok({ reference: reference(), observed: { ipa: 'hɛlo', phones: [{ phone: 'h', start: 0, end: .2 }] }, alignment: { words: [] }, metrics: { duration_seconds: 1, voiced_seconds: .5, rms_dbfs: -20 }, audio_analyzed: true }) });
  const active = installCapture(app, { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }), decode: async () => decodedFixture() });
  app.button('บันทึกเสียงของฉัน').click(); await flush();
  assert.equal(active().state, 'recording');
  assert.equal(app.calls.length, 0);
  app.button('หยุดบันทึก').click();
  assert.equal(stopped, 1);
  assert.equal(app.button('กำลังเตรียมเสียง…').disabled, true);
  await active().finished;
  assert.equal(app.calls.length, 0);
  assert.equal(app.container.querySelector('audio').hidden, false);
  app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][1].body.get('text'), 'Hello, leaf.');
  assert.ok(app.calls[0][1].body.get('audio') instanceof app.window.Blob);
  app.cleanup();
  assert.deepEqual(app.revoked, ['blob:test-1']);
  app.dom.window.close();
});

test('AI audio uploads bytes, keeps A/B labels blind, and replays actual aligned word ranges', async () => {
  let app;
  app = setup({ mount: { audioSources: [{ label: 'A', url: '../speech-training/runs/secret-baseline/tts.wav' }] }, fetch: async (url, init) => {
    if (!init.method) return { ok: true, headers: { get: () => '12' }, blob: async () => new app.window.Blob(['actual audio'], { type: 'audio/wav' }) };
    return ok({ reference: reference(), observed: { ipa: 'hɛlo', phones: [{ phone: 'h', start: .1, end: .2 }] }, alignment: { words: [{ text: '<svg/onload=alert(1)>', ipa: 'həˈloʊ', status: 'difference', start: .1, end: .8, differences: [{ expected: 'ə', observed: 'ɛ' }] }] }, metrics: { duration_seconds: 1, voiced_seconds: .8, rms_dbfs: -20 }, audio_analyzed: true, limitations: ['Approximate phone alignment.'] });
  } });
  assert.equal(app.calls.length, 0);
  app.button('วิเคราะห์เสียง A').click(); await flush(); await flush();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1][0], 'http://127.0.0.1:8766/api/phonetics/analyze');
  assert.equal(app.calls[1][1].body.get('audio').size, 12);
  assert.equal(app.calls[1][1].body.has('url'), false);
  assert.ok(!app.container.textContent.includes('secret-baseline'));
  assert.equal(app.container.querySelectorAll('svg').length, 0);
  assert.equal(app.container.querySelector('.egl-ph-detected').textContent, 'hɛlo');
  const player = app.container.querySelector('audio');
  Object.defineProperty(player, 'readyState', { value: 1, configurable: true });
  app.container.querySelector('button.egl-ph-compare').click();
  app.button('ฟังคำนี้').click();
  assert.equal(player.currentTime, .1);
  assert.equal(app.plays(), 1);
  app.cleanup(); app.dom.window.close();
});

test('file sources map to local HTTP service and pagehide aborts in-flight requests', async () => {
  const app = setup({ url: 'file:///Users/example/project/speech-training/listen.html', mount: { audioSources: [{ label: 'B', url: 'runs/blind-b.wav' }] }, fetch: () => new Promise(() => {}) });
  app.button('วิเคราะห์เสียง B').click();
  assert.equal(app.calls[0][0], 'http://127.0.0.1:8766/speech-training/runs/blind-b.wav');
  const signal = app.calls[0][1].signal;
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  assert.equal(signal.aborted, true);
  assert.equal(app.container.children.length, 0);
  app.dom.window.close();
});

test('oversize files and empty text do not leave stale analysis or make network requests', async () => {
  const app = setup();
  const fileInput = app.container.querySelector('input[type=file]');
  Object.defineProperty(fileInput, 'files', { value: [{ name: 'large.wav', size: 10 * 1024 * 1024 + 1 }], configurable: true });
  fileInput.dispatchEvent(new app.window.Event('change'));
  assert.match(app.container.querySelector('[role=status]').textContent, /10 MB/);
  assert.equal(app.container.querySelector('audio').hidden, true);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  app.container.querySelector('textarea').value = '';
  app.button('ดูคำอ่าน').click();
  assert.equal(app.calls.length, 0);
  assert.match(app.container.querySelector('[role=status]').textContent, /ใส่ข้อความภาษาอังกฤษ/);
  app.cleanup(); app.dom.window.close();
});

function selectFile(app, contents = 'speech', filename = 'practice.wav') {
  const input = app.container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [new app.window.File([contents], filename, { type: 'audio/wav' })], configurable: true });
  input.dispatchEvent(new app.window.Event('change'));
}
function analysis(overrides = {}) {
  return {
    reference: reference(),
    observed: { ipa: 'hɛlo', phones: [{ phone: 'h', start: .1, end: .2 }] },
    alignment: { words: [{ index: 0, text: 'Hello', ipa: 'həˈloʊ', status: 'matched', start: .1, end: .8, match_percent: 100, matched_phones: 1, reference_phones: 1, inserted_phones: 0, compared_phones: 1 }], operations: [{ type: 'match', expected: 'h', observed: 'h', word_index: 0, start: .1, end: .2 }], summary: { match_percent: 100, matched_phones: 1, reference_phones: 1, inserted_phones: 0, compared_phones: 1 } },
    metrics: { duration_seconds: 1, voiced_seconds: .8, rms_dbfs: -20 }, audio_analyzed: true,
    ...overrides,
  };
}
async function analyzeFixture(data, options = {}) {
  const app = setup({ fetch: async () => ok(data), ...options });
  selectFile(app);
  app.button('ดูผลเสียงของฉัน').click();
  await flush();
  return app;
}

test('guided interface supports expanded workspace and keeps editor and IPA details collapsed', async () => {
  const app = setup({ mount: { expanded: true, precomputed: reference() } });
  assert.equal(app.container.querySelector('.egl-phonetics').open, true);
  assert.deepEqual([...app.container.querySelectorAll('.egl-ph-steps li')].map(node => node.textContent), ['1 คำอ่าน / ฟัง', '2 ลองพูด', '3 ดูผล']);
  assert.equal(app.container.querySelector('.egl-ph-phrase').textContent, 'Hello, leaf.');
  assert.equal(app.container.querySelector('.egl-ph-editor').open, false);
  assert.equal(app.container.querySelector('.egl-ph-reference .egl-ph-technical').open, false);
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('all eight requested percentage colors use one-decimal displayed thresholds and gray for null', async () => {
  const values = [95, 90, 80, 70, 60, 50, 40, 39.9, null, 94.96];
  const tiers = ['purple', 'blue', 'indigo', 'sky', 'green', 'yellow', 'orange', 'red', 'unassessed', 'purple'];
  const data = analysis();
  data.alignment.words = values.map((value, index) => ({ index, text: 'word' + index, ipa: 'w', status: 'difference', start: index / 10, end: index / 10 + .1, match_percent: value, matched_phones: 3, compared_phones: 4 }));
  data.alignment.summary = { match_percent: 75, matched_phones: 3, reference_phones: 3, inserted_phones: 1, compared_phones: 4 };
  const app = await analyzeFixture(data);
  const buttons = [...app.container.querySelectorAll('.egl-ph-compare')];
  buttons.forEach((node, index) => assert.ok(node.classList.contains('egl-ph-' + tiers[index]), values[index] + ' tier'));
  assert.equal(buttons[0].querySelector('.egl-ph-word-percent').textContent, '95.0%');
  assert.equal(buttons[8].querySelector('.egl-ph-word-percent').textContent, '—');
  assert.equal(buttons[9].querySelector('.egl-ph-word-percent').textContent, '95.0%');
  assert.equal(app.container.querySelector('.egl-ph-agreement .egl-ph-percent').textContent, '75.0%');
  assert.match(app.container.querySelector('.egl-ph-agreement .egl-ph-counts').textContent, /3 \/ 4/);
  assert.equal(app.container.querySelector('.egl-ph-color-legend').open, false);
  assert.match(app.container.querySelector('.egl-ph-observed').textContent, /ไม่ใช่คะแนนความสามารถ/);
  app.cleanup(); app.dom.window.close();
});

test('legacy responses derive percentages from real operations including insertion denominator', async () => {
  const data = analysis();
  delete data.alignment.summary;
  data.alignment.operations = [
    ...['h', 'ə', 'l'].map((phone, index) => ({ type: 'match', expected: phone, observed: phone, word_index: 0, start: index * .1, end: (index + 1) * .1 })),
    { type: 'insert', expected: null, observed: 'ə', word_index: 0, start: .3, end: .4 },
  ];
  data.alignment.words = [{ index: 0, text: 'Hello', ipa: 'həl', status: 'difference', start: 0, end: .4 }];
  const app = await analyzeFixture(data);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '75.0%');
  assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '75.0%');
  assert.match(app.container.querySelector('.egl-ph-inspector .egl-ph-counts').textContent, /3 \/ 4/);
  app.cleanup(); app.dom.window.close();
});

test('legacy statuses alone and explicit null fields never fabricate percentages', async () => {
  const data = analysis();
  data.alignment = { words: [{ index: 0, text: 'Hello', ipa: 'h', status: 'matched', differences: [] }], operations: [] };
  const app = await analyzeFixture(data);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '—');
  assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '—');
  assert.ok(app.container.querySelector('.egl-ph-agreement').classList.contains('egl-ph-unassessed'));
  app.cleanup(); app.dom.window.close();
  const explicit = analysis();
  explicit.alignment.summary.match_percent = null;
  explicit.alignment.words[0].match_percent = null;
  const other = await analyzeFixture(explicit);
  assert.equal(other.container.querySelector('.egl-ph-percent').textContent, '—');
  assert.equal(other.container.querySelector('.egl-ph-word-percent').textContent, '—');
  other.cleanup(); other.dom.window.close();
});

test('word inspector pairs phones, replays actual context, slows playback, and navigates differences', async () => {
  const data = analysis();
  data.alignment.words.push({ index: 1, text: 'leaf', ipa: 'liːf', status: 'difference', start: .4, end: .9, match_percent: 50, matched_phones: 1, compared_phones: 2 });
  data.alignment.operations.push({ type: 'substitute', expected: 'iː', observed: 'ɪ', word_index: 1, start: .55, end: .65 });
  const app = await analyzeFixture(data);
  app.window.EGLPhoneGuide = { describe: phone => ({ symbol: phone, label: 'เสียง ' + phone, tip: 'ผ่อนริมฝีปาก', example: 'leaf' }) };
  const player = app.container.querySelector('.egl-ph-player');
  Object.defineProperty(player, 'readyState', { value: 1, configurable: true });
  app.button('คำที่มีเสียงต่างถัดไป').click();
  assert.match(app.container.querySelector('.egl-ph-inspector-title').textContent, /leaf/);
  assert.equal(app.container.querySelectorAll('.egl-ph-phone-pairs .egl-ph-phone').length, 2);
  app.container.querySelector('.egl-ph-phone-pairs .egl-ph-phone').click();
  assert.ok(Math.abs(player.currentTime - .48) < .0001);
  assert.equal(app.playedElements.at(-1), player);
  assert.match(app.container.querySelector('.egl-ph-inspector .egl-ph-guide').textContent, /ผ่อนริมฝีปาก/);
  app.button('ช้า 0.75×').click();
  assert.equal(player.playbackRate, .75);
  assert.equal(app.button('ช้า 0.75× ✓').getAttribute('aria-pressed'), 'true');
  app.cleanup(); app.dom.window.close();
});

test('reference words can be selected and played on a separate audio element before analysis', async () => {
  const precomputed = reference();
  const app = setup({ mount: { precomputed, referenceExample: { text: precomputed.text, url: '../speech-training/examples/phrase.wav', label: 'เสียงตัวอย่าง A', words: [{ index: 0, text: 'Hello', start: .3, end: .9 }] } } });
  app.container.querySelector('.egl-ph-ref-word').click();
  assert.match(app.container.querySelector('.egl-ph-selected').textContent, /Hello/);
  app.button('ฟังคำตัวอย่าง').click();
  const example = app.container.querySelector('.egl-ph-example-player');
  example.dispatchEvent(new app.window.Event('loadedmetadata'));
  assert.equal(app.playedElements.at(-1), example);
  assert.equal(example.currentTime, .3);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.equal(app.calls.length, 0);
  assert.match(app.container.querySelector('.egl-ph-example-caption').textContent, /เสียงตัวอย่าง A/);
  app.cleanup(); app.dom.window.close();
});

test('missing reference word times can use another labeled source, never invent ranges', async () => {
  const app = setup({ mount: { precomputed: reference(), referenceExample: { text: 'Hello, leaf.', url: 'a.wav', words: [{ index: 0, text: 'Hello', start: null, end: null }] }, audioSources: [{ label: 'B', url: 'b.wav', words: [{ index: 0, text: 'Hello', start: .4, end: .7 }] }] } });
  app.container.querySelector('.egl-ph-ref-word').click(); app.button('ฟังคำตัวอย่าง').click();
  const example = app.container.querySelector('.egl-ph-example-player');
  example.dispatchEvent(new app.window.Event('loadedmetadata'));
  assert.match(example.src, /b\.wav$/);
  assert.equal(example.currentTime, .4);
  assert.equal(app.container.querySelector('.egl-ph-example-caption').textContent, 'เสียงตัวอย่าง B');
  app.cleanup(); app.dom.window.close();
});

test('explicit browser voice fallback uses local English words and clearly labels it', async () => {
  const spoken = [];
  const app = setup({ mount: { precomputed: reference() } });
  const local = { lang: 'en-US', localService: true, name: 'Local' };
  app.window.speechSynthesis = { getVoices: () => [{ lang: 'en-US', localService: false, name: 'Network' }, { lang: 'th-TH', localService: true, name: 'Thai' }, local], speak: utterance => spoken.push(utterance), cancel: () => {} };
  app.window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  app.container.querySelector('.egl-ph-ref-word').click();
  assert.equal(spoken.length, 0);
  app.button('ฟังคำตัวอย่าง').click();
  assert.equal(spoken[0].text, 'Hello');
  assert.equal(spoken[0].voice, local);
  assert.equal(app.container.querySelector('.egl-ph-example-caption').textContent, 'เสียงอ่านในเครื่อง');
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('word practice posts the selected word with new audio and returning restores sentence result', async () => {
  const precomputed = reference();
  precomputed.words.push({ index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] });
  const app = setup({ mount: { precomputed }, fetch: async (_url, init) => {
    const target = init.body.get('text');
    const data = analysis();
    data.reference = target === 'leaf' ? { ...reference('leaf'), words: [{ index: 0, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }] } : precomputed;
    data.alignment.summary.match_percent = target === 'leaf' ? 40 : 80;
    data.alignment.words[0].text = target === 'leaf' ? 'leaf' : 'Hello';
    return ok(data);
  } });
  selectFile(app, 'sentence audio'); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '80.0%');
  const leaf = [...app.container.querySelectorAll('.egl-ph-ref-word')].find(node => node.querySelector('.egl-ph-token').textContent === 'leaf');
  leaf.click();
  // No aligned result for leaf yet, so its reference focus offers practice.
  const practiceButton = [...app.container.querySelectorAll('.egl-ph-reference-focus button')].find(node => node.textContent === 'ฝึกคำนี้');
  practiceButton.click();
  assert.match(app.container.querySelector('.egl-ph-target').textContent, /กำลังฝึกคำ: leaf/);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  assert.equal(app.calls.length, 1);
  selectFile(app, 'word audio'); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.calls[1][1].body.get('text'), 'leaf');
  assert.equal(app.calls[1][1].body.get('context_text'), 'Hello, leaf.');
  assert.equal(app.calls[1][1].body.get('context_word_index'), '1');
  assert.match(app.container.querySelector('.egl-ph-step-title').textContent, /อ่านและฟัง/);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '40.0%');
  assert.equal(app.container.querySelector('textarea').value, 'Hello, leaf.');
  app.button('กลับไปฝึกทั้งประโยค').click();
  assert.equal(app.container.querySelector('.egl-ph-target').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '80.0%');
  assert.equal(app.calls.length, 2);
  assert.equal(app.container.querySelector('.egl-ph-player').hidden, false);
  app.cleanup(); app.dom.window.close();
});

test('closing the widget or changing voice mode stops capture and blocks deferred playback', async () => {
  let stopped = 0;
  const app = setup({ mount: { expanded: true, audioSources: [{ label: 'A', url: 'a.wav' }] }, getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) });
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  }
  app.window.MediaRecorder = Recorder;
  app.button('บันทึกเสียงของฉัน').click(); await flush();
  app.button('เสียง AI').click();
  assert.equal(stopped, 1);
  assert.equal(app.calls.length, 0);
  app.button('เสียงของฉัน').click(); app.button('บันทึกเสียงของฉัน').click(); await flush();
  const root = app.container.querySelector('.egl-phonetics'); root.open = false;
  root.dispatchEvent(new app.window.Event('toggle'));
  assert.equal(stopped, 2);
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('closing before loadedmetadata prevents an old word replay from starting later', async () => {
  const app = await analyzeFixture(analysis(), { mount: { expanded: true } });
  app.button('ฟังคำนี้').click();
  assert.equal(app.plays(), 0);
  const root = app.container.querySelector('.egl-phonetics'); root.open = false;
  root.dispatchEvent(new app.window.Event('toggle'));
  app.container.querySelector('.egl-ph-player').dispatchEvent(new app.window.Event('loadedmetadata'));
  assert.equal(app.plays(), 0);
  app.cleanup(); app.dom.window.close();
});

test('switching reference words cannot reuse word-only index zero results or the previous example', async () => {
  const precomputed = reference();
  precomputed.words.push({ index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] });
  const app = setup({ mount: { precomputed, referenceExample: { text: precomputed.text, url: 'example.wav', words: [{ index: 0, text: 'Hello', start: .1, end: .35 }, { index: 1, text: 'leaf', start: .5, end: .9 }] } }, fetch: async () => {
    const data = analysis();
    data.reference = { ...reference('leaf'), words: [{ index: 0, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }] };
    data.alignment.words[0].text = 'leaf';
    return ok(data);
  } });
  app.window.EGLStudyHelp = { forText: text => text === precomputed.text ? { words: { hello: 'สวัสดี', leaf: 'ใบไม้' } } : null };
  const select = text => [...app.container.querySelectorAll('.egl-ph-ref-word')].find(node => node.querySelector('.egl-ph-token').textContent === text).click();
  select('leaf');
  assert.equal(app.container.querySelector('.egl-ph-reference-focus .egl-ph-word-meaning').textContent, 'ใบไม้');
  app.button('ฝึกคำนี้').click();
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.container.querySelector('.egl-ph-inspector .egl-ph-word-meaning').textContent, 'ใบไม้');
  assert.equal(app.calls[0][1].body.get('context_word_index'), '1');
  select('Hello');
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.match(app.container.querySelector('.egl-ph-target').textContent, /กำลังฝึกคำ: Hello/);
  assert.match(app.container.querySelector('.egl-ph-reference-focus h4').textContent, /Hello/);
  assert.equal(app.container.querySelector('.egl-ph-reference-focus .egl-ph-word-meaning').textContent, 'สวัสดี');
  app.button('ฟังคำตัวอย่าง').click();
  const example = app.container.querySelector('.egl-ph-example-player');
  example.dispatchEvent(new app.window.Event('loadedmetadata'));
  assert.equal(example.currentTime, .1);
  assert.equal(app.calls.length, 1);
  app.cleanup(); app.dom.window.close();
});

test('AI mode returns to the full phrase and never uploads a sentence as a selected word', async () => {
  const precomputed = reference();
  precomputed.words.push({ index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] });
  let app;
  app = setup({ mount: { precomputed, audioSources: [{ label: 'A', url: 'sentence-a.wav' }] }, fetch: async (_url, init) => {
    if (!init.method) return { ok: true, headers: { get: () => '6' }, blob: async () => new app.window.Blob(['speech'], { type: 'audio/wav' }) };
    return ok(analysis({ reference: precomputed }));
  } });
  [...app.container.querySelectorAll('.egl-ph-ref-word')].find(node => node.querySelector('.egl-ph-token').textContent === 'leaf').click();
  app.button('ฝึกคำนี้').click();
  selectFile(app, 'previous word recording');
  app.button('เสียง AI').click();
  assert.equal(app.container.querySelector('.egl-ph-target').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  app.button('วิเคราะห์เสียง A').click(); await flush(); await flush();
  const posted = app.calls.find(([, init]) => init.method === 'POST');
  assert.equal(posted[1].body.get('text'), 'Hello, leaf.');
  assert.equal(posted[1].body.has('context_text'), false);
  assert.equal(posted[1].body.has('context_word_index'), false);
  assert.equal(app.container.querySelector('.egl-ph-tabs [aria-selected=true]').textContent, 'เสียง AI');
  app.cleanup(); app.dom.window.close();
});

test('browser preparation produces a known-length mono PCM16 WAV and explicit self-listen loads it', async () => {
  const app = setup({ fetch: async () => ok(analysis()) });
  const active = installCapture(app, { decode: async bytes => {
    assert.equal(new DataView(bytes).getUint32(0), 0x52494646); // RIFF fixture
    return decodedFixture();
  } });
  await recorded(app, active);
  assert.equal(app.calls.length, 0, 'browser decoding must not upload the recording');
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.50 วินาที/);
  const player = app.container.querySelector('.egl-ph-player');
  assert.ok(app.loadedElements.includes(player));
  assert.equal(app.plays(), 0, 'preparation must not autoplay');
  player.muted = true; player.volume = .2;
  app.button('ฟังเสียงของฉัน').click();
  assert.equal(app.playedElements.at(-1), player);
  assert.equal(player.muted, false); assert.equal(player.volume, 1);
  player.currentTime = .25;
  app.button('ฟังใหม่ตั้งแต่ต้น').click();
  assert.equal(player.currentTime, 0);
  app.button('ดูผลเสียงของฉัน').click(); await flush();
  const recordedFile = app.calls[0][1].body.get('audio');
  assert.equal(recordedFile.type, 'audio/wav');
  const bytes = await readBlob(app.window, recordedFile), view = new DataView(bytes);
  assert.equal(view.getUint32(0), 0x52494646);
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1, 'PCM encoding');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16000);
  assert.equal(view.getInt16(44, true), 8192, 'stereo .5 and 0 downmix to .25 with little endian samples');
  app.cleanup(); app.dom.window.close();
});

test('a missing decoded duration uses only local normalization and validates the returned WAV', async () => {
  let app;
  app = setup({ fetch: async url => {
    assert.equal(url, 'http://127.0.0.1:8766/api/phonetics/normalize');
    return { ok: true, headers: { get: () => '999' }, blob: async () => new app.window.Blob([pcmFixture()], { type: 'audio/wav' }) };
  } });
  const active = installCapture(app, { decode: async () => decodedFixture({ duration: NaN }) });
  await recorded(app, active);
  assert.equal(app.calls.length, 1);
  const form = app.calls[0][1].body;
  assert.ok(form.get('audio') instanceof app.window.Blob);
  assert.equal(form.has('text'), false);
  assert.equal(form.has('accent'), false);
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.50 วินาที/);
  assert.match(app.container.querySelector('[role=status]').textContent, /บันทึกแล้ว/);
  assert.equal(app.button('ฟังเสียงของฉัน').disabled, false);
  app.cleanup(); app.dom.window.close();
});

test('invalid prepared containers never publish false success or leave the previous clip usable', async () => {
  let app;
  app = setup({ fetch: async () => ({ ok: true, blob: async () => new app.window.Blob(['header only'], { type: 'audio/wav' }) }) });
  selectFile(app, pcmFixture(), 'previous.wav');
  assert.equal(app.button('ฟังเสียงที่เลือก').disabled, false);
  const active = installCapture(app);
  await recorded(app, active);
  assert.ok(app.revoked.includes('blob:test-1'));
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.equal(app.container.querySelector('.egl-ph-self-audio').hidden, true);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  assert.doesNotMatch(app.container.querySelector('[role=status]').textContent, /บันทึกแล้ว/);
  assert.match(app.container.querySelector('[role=status]').textContent, /ยังเตรียมเสียงให้เล่นไม่ได้/);
  app.cleanup(); app.dom.window.close();
});

test('self-listen playback rejection and native player errors give actionable feedback', async () => {
  const app = setup();
  const active = installCapture(app, { decode: async () => decodedFixture() });
  await recorded(app, active);
  const player = app.container.querySelector('.egl-ph-player');
  player.play = () => Promise.reject(new app.window.DOMException('blocked', 'NotAllowedError'));
  app.button('ฟังเสียงของฉัน').click(); await flush();
  assert.match(app.container.querySelector('[role=status]').textContent, /เบราว์เซอร์ยังไม่อนุญาตให้เล่นเสียง/);
  player.dispatchEvent(new app.window.Event('error'));
  assert.match(app.container.querySelector('[role=status]').textContent, /ยังเปิดไฟล์เสียงนี้ไม่ได้/);
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('cleanup during browser decode prevents late publication and closes the decoder', async () => {
  let resolveDecode, closed = 0;
  const app = setup();
  const active = installCapture(app, { decode: () => new Promise(resolve => { resolveDecode = resolve; }), onClose: () => { closed++; } });
  app.button('บันทึกเสียงของฉัน').click(); await flush(); app.button('หยุดบันทึก').click();
  for (let i = 0; i < 30 && !resolveDecode; i++) await flush();
  assert.equal(typeof resolveDecode, 'function');
  assert.equal(app.button('กำลังเตรียมเสียง…').disabled, true);
  app.cleanup();
  resolveDecode(decodedFixture()); await active().finished;
  assert.ok(closed >= 1);
  assert.equal(app.calls.length, 0);
  assert.equal(app.container.children.length, 0);
  assert.deepEqual(app.revoked, []);
  app.dom.window.close();
});

test('changing view aborts local normalization and ignores its late response', async () => {
  let finish;
  const app = setup({ mount: { audioSources: [{ label: 'A', url: 'a.wav' }] }, fetch: () => new Promise(resolve => { finish = resolve; }) });
  const active = installCapture(app);
  app.button('บันทึกเสียงของฉัน').click(); await flush(); app.button('หยุดบันทึก').click();
  assert.equal(app.calls[0][0], 'http://127.0.0.1:8766/api/phonetics/normalize');
  const signal = app.calls[0][1].signal;
  app.button('เสียง AI').click();
  assert.equal(signal.aborted, true);
  finish({ ok: true, blob: async () => new app.window.Blob([pcmFixture()], { type: 'audio/wav' }) });
  await active().finished;
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.doesNotMatch(app.container.querySelector('[role=status]').textContent, /บันทึกแล้ว/);
  app.cleanup(); app.dom.window.close();
});

test('hosted demo uses bundled US text references and never probes localhost for missing text or UK', async () => {
  const textReference = reference();
  const app = setup({ url: 'https://garden.example/demo/app/index.html', globals: { EGL_DEMO_DATA: { texts: { [textReference.text]: textReference } } }, mount: { apiBase: 'http://127.0.0.1:8766' } });
  assert.equal(app.calls.length, 0);
  app.button('ดูคำอ่าน').click(); await flush();
  assert.equal(app.container.querySelector('.egl-ph-reference .egl-ph-ipa').textContent, textReference.ipa);
  const accent = app.container.querySelector('select'); accent.value = 'en-gb'; accent.dispatchEvent(new app.window.Event('change'));
  app.button('ดูคำอ่าน').click(); await flush();
  assert.match(app.container.querySelector('[role=status]').textContent, /ต้องเปิดรุ่นในเครื่อง/);
  const textarea = app.container.querySelector('textarea'); textarea.value = 'Unknown sentence.'; textarea.dispatchEvent(new app.window.Event('input'));
  app.button('ดูคำอ่าน').click(); await flush();
  assert.equal(app.calls.length, 0);
  assert.equal(app.container.querySelector('.egl-ph-service-link').hasAttribute('href'), false);
  assert.match(app.container.querySelector('.egl-ph-demo-learner-notice').textContent, /การวิเคราะห์เสียงที่คุณบันทึกต้องเปิดรุ่นในเครื่อง/);
  app.cleanup(); app.dom.window.close();
});

test('hosted AI results match exact exported source URLs and use real bundled analyses without POST', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'speech-training', 'demo-assets', 'demo-data.json'), 'utf8'));
  const pair = data.pairs[0];
  for (const page of ['app/index.html', 'speech-training/listen.html']) {
    let app;
    app = setup({ url: 'https://garden.example/nested/site/' + page, globals: { EGL_DEMO_DATA: data }, mount: { text: pair.text,
      apiBase: 'http://localhost:8766', audioSources: [{ label: 'A', url: pair.baseline.audio }, { label: 'B', url: pair.candidate.audio }, { label: 'X', url: '../other/tts-001.wav' }] },
      fetch: async (url, init) => {
        assert.equal(init.method, undefined, 'only static audio GET is allowed');
        const selected = [pair.baseline.audio, pair.candidate.audio].find(value => new URL(value, app.window.document.baseURI).href === url);
        assert.ok(selected);
        const bytes = fs.readFileSync(path.resolve(__dirname, '..', selected));
        return { ok: true, headers: { get: () => String(bytes.length) }, blob: async () => new app.window.Blob([bytes], { type: 'audio/wav' }) };
      } });
    for (const [label, selected] of [['A', pair.baseline], ['B', pair.candidate]]) {
      app.button('วิเคราะห์เสียง ' + label).click(); await flush(); await flush();
      const cached = data.analyses[selected.audio];
      assert.equal(app.container.querySelector('.egl-ph-percent').textContent, cached.alignment.summary.match_percent.toFixed(1) + '%');
      assert.match(app.container.querySelector('.egl-ph-demo-result').textContent, /ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้/);
      assert.match(app.container.querySelector('[role=status]').textContent, /ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้/);
    }
    assert.equal(app.calls.length, 2);
    app.button('วิเคราะห์เสียง X').click(); await flush();
    assert.equal(app.calls.length, 2, 'a matching basename must never select another cached file');
    assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
    assert.match(app.container.querySelector('[role=status]').textContent, /ยังไม่มีผลวิเคราะห์/);
    assert.ok(app.calls.every(([url]) => url.startsWith('https://garden.example/nested/site/speech-training/demo-assets/audio/')));
    app.cleanup(); app.dom.window.close();
  }
});

test('hosted recordings can be prepared and played but never receive cached learner percentages or POST', async () => {
  const app = setup({ url: 'https://garden.example/app/index.html', mount: { apiBase: 'http://127.0.0.1:8766' } });
  const active = installCapture(app, { decode: async () => decodedFixture() });
  await recorded(app, active);
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.50 วินาที/);
  assert.equal(app.button('ฟังเสียงของฉัน').disabled, false);
  app.button('ฟังเสียงของฉัน').click();
  assert.equal(app.plays(), 1);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  app.button('ดูผลเสียงของฉัน').dispatchEvent(new app.window.Event('click'));
  await flush();
  assert.match(app.container.querySelector('[role=status]').textContent, /การวิเคราะห์เสียงที่คุณบันทึกต้องเปิดรุ่นในเครื่อง/);
  assert.equal(app.container.querySelector('.egl-ph-percent'), null);
  assert.equal(app.calls.length, 0);
  app.cleanup(); app.dom.window.close();
});

test('a hosted browser decode failure never falls back to the visitor localhost normalizer', async () => {
  const app = setup({ url: 'https://garden.example/app/index.html', mount: { apiBase: 'http://localhost:8766' } });
  const active = installCapture(app);
  await recorded(app, active);
  assert.equal(app.calls.length, 0);
  assert.equal(app.container.querySelector('.egl-ph-self-audio').hidden, true);
  assert.doesNotMatch(app.container.querySelector('[role=status]').textContent, /บันทึกแล้ว/);
  assert.match(app.container.querySelector('[role=status]').textContent, /เดโม.*รุ่นในเครื่อง/);
  app.cleanup(); app.dom.window.close();
});

test('hosted demo blocks loopback AI audio and native example URLs even when configured in its data', async () => {
  for (const host of ['127.0.0.1', 'localhost', '127.1.2.3', '[::1]']) {
    const url = 'http://' + host + ':8766/speech-training/a.wav';
    const app = setup({ url: 'https://garden.example/app/index.html', globals: { EGL_DEMO_DATA: { reference_audio: { by_text: { 'Hello, leaf.': { text: 'Hello, leaf.', url, words: [] } } } } }, mount: { audioSources: [{ label: 'A', url }], apiBase: 'http://127.0.0.1:8766' } });
    app.button('วิเคราะห์เสียง A').click(); await flush();
    app.button('ฟังประโยคตัวอย่าง').click();
    assert.equal(app.calls.length, 0);
    assert.equal(app.plays(), 0);
    assert.ok([...app.container.querySelectorAll('audio')].every(node => node.getAttribute('src') == null));
    app.cleanup(); app.dom.window.close();
  }
});

test('explicit demo runtime on a local preview disables APIs but permits its same-origin bundled assets', async () => {
  const cached = { ...analysis(), analysis_type: 'acoustic_phone_comparison', playback_source: 'prerecorded_ai', precomputed: true, live_analysis: false };
  const url = '../speech-training/demo-assets/audio/baseline/example.wav';
  let app;
  app = setup({ url: 'http://127.0.0.1:8080/app/index.html', globals: { EGL_DEMO_RUNTIME: { mode: 'demo' }, EGL_DEMO_DATA: { analyses: { [url]: cached } } }, mount: { audioSources: [{ label: 'A', url }] }, fetch: async (requested, init) => {
    assert.equal(requested, 'http://127.0.0.1:8080/speech-training/demo-assets/audio/baseline/example.wav');
    assert.equal(init.method, undefined);
    return { ok: true, headers: { get: () => '6' }, blob: async () => new app.window.Blob(['speech'], { type: 'audio/wav' }) };
  } });
  app.button('วิเคราะห์เสียง A').click(); await flush(); await flush();
  assert.match(app.container.querySelector('.egl-ph-demo-result').textContent, /ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้/);
  assert.equal(app.calls.length, 1);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  app.cleanup(); app.dom.window.close();
});
