const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const alignment = require('../phonetic-alignment.js');

const sources = Object.fromEntries(['phone-guide.js', 'sound-foundations.js', 'articulation-images.js', 'spelling-guide.js', 'word-audio.js', 'phonetics.js']
  .map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const exampleScope = {};
vm.runInNewContext(sources['word-audio.js'], exampleScope);
const actualWords = exampleScope.EGL_WORD_AUDIO;
const flush = () => new Promise(resolve => setImmediate(resolve));

function reference(text = 'This is a leaf.', words = [
  { index: 0, text: 'This', ipa: 'ðɪs', phones: ['ð', 'ɪ', 's'] },
  { index: 1, text: 'is', ipa: 'ɪz', phones: ['ɪ', 'z'] },
  { index: 2, text: 'a', ipa: 'ə', phones: ['ə'] },
  { index: 3, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] },
]) {
  return { text, accent: 'en-us', ipa: words.map(word => word.ipa).join(' '), words,
    analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
}
function compose(expected, observed) {
  const phones = observed || expected.words.flatMap(word => word.phones).map((phone, index) => ({ phone, start: .1 + index * .08, end: .16 + index * .08 }));
  return alignment.composeAnalysis(expected, phones, { duration_seconds: 2, rms_dbfs: -20, voiced_seconds: 1.2 });
}
function selectedReference(form, original) {
  const selected = original.words.find(word => word.index === Number(form.get('context_word_index')));
  const phoneIndex = Number(form.get('context_phone_index'));
  const phone = selected.phones[phoneIndex];
  return { text: form.get('text'), accent: form.get('accent'), ipa: phone,
    words: [{ ...selected, index: 0, ipa: phone, phones: [phone] }],
    context: { text: original.text, word_index: selected.index, phone_index: phoneIndex },
    reference_context: 'phone_in_word', analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
}
function setup(options = {}) {
  const dom = new JSDOM('<main id="widget"></main>', { url: options.url || 'http://127.0.0.1:8766/app/index.html', runScripts: 'outside-only' });
  const win = dom.window, calls = [], revoked = [], plays = [], pauses = [], loads = [];
  let objectId = 0, microphones = 0;
  win.URL.createObjectURL = () => 'blob:learner-' + (++objectId);
  win.URL.revokeObjectURL = value => revoked.push(value);
  win.HTMLMediaElement.prototype.play = function () { plays.push(this); return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { pauses.push(this); };
  win.HTMLMediaElement.prototype.load = function () { loads.push(this); };
  win.fetch = async (...args) => { calls.push(args); return options.fetch ? options.fetch(...args) : Promise.reject(new Error('No automatic network request expected')); };
  Object.defineProperty(win.navigator, 'mediaDevices', { value: { getUserMedia: () => { microphones++; return Promise.reject(new Error('Explicit recording only')); } } });
  for (const name of ['phone-guide.js', 'sound-foundations.js', 'articulation-images.js', 'spelling-guide.js', 'word-audio.js']) win.eval(sources[name]);
  if (options.globals) Object.assign(win, options.globals);
  win.eval(sources['phonetics.js']);
  const container = win.document.getElementById('widget'), expected = options.reference || reference();
  const cleanup = win.EGLPhonetics.mount(container, { text: expected.text, precomputed: expected, expanded: true, ...(options.mount || {}) });
  const button = (text, scope = container) => [...scope.querySelectorAll('button')].find(node => node.textContent === text);
  return { dom, win, container, cleanup, expected, calls, revoked, plays, pauses, loads, button, microphones: () => microphones };
}
function selectWord(app, text) {
  const token = [...app.container.querySelectorAll('.egl-ph-ref-word')].find(node => node.querySelector('.egl-ph-token').textContent === text);
  assert.ok(token, 'Missing reference word: ' + text); token.click();
  return app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
}
function selectGroup(section, letters) {
  const button = [...section.querySelectorAll('.egl-ph-spelling-group')].find(node => node.querySelector('.egl-ph-grapheme').textContent === letters);
  assert.ok(button, 'Missing spelling group: ' + letters); button.click();
  return section.querySelector('.egl-ph-spelling-detail');
}
function selectFile(app) {
  const input = app.container.querySelector('input[type=file]');
  // A real short PCM16 container keeps the fixture valid if decode is added here.
  const bytes = new ArrayBuffer(44 + 6400 * 2), view = new DataView(bytes);
  const tag = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, 12800, true);
  for (let i = 0; i < 6400; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * .2) * 8000), true);
  const file = new app.win.File([bytes], 'my-practice.wav', { type: 'audio/wav' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new app.win.Event('change'));
  return file;
}
function close(app) { app.cleanup(); app.dom.window.close(); }

test('leaf spelling groups lead to only /iː/ practice, with exact local word/phone context and a separate result heading', async () => {
  const original = reference();
  const app = setup({ reference: original, fetch: async (_url, init) => ({ ok: true, status: 200, json: async () => compose(selectedReference(init.body, original)) }) });
  assert.equal(app.calls.length, 0);
  assert.equal(app.microphones(), 0);
  selectFile(app); const previousURL = app.container.querySelector('.egl-ph-player').src;
  const section = selectWord(app, 'leaf');
  assert.deepEqual([...section.querySelectorAll('.egl-ph-grapheme')].map(node => node.textContent), ['l', 'ea', 'f']);
  const panel = selectGroup(section, 'ea');
  assert.equal(panel.querySelector('.egl-ph-spelling-focus').textContent, 'ea → /iː/');
  app.button('ฝึกเฉพาะเสียง /iː/', panel).click();
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกเสียง \/iː\/.*ea.*leaf/);
  assert.match(app.container.querySelector('.egl-ph-record-hint').textContent, /เฉพาะ \/iː\/.*ไม่ต้องพูดชื่ออักษรหรือทั้งคำ/);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.ok(app.revoked.includes(previousURL));
  assert.equal(app.microphones(), 0, 'selecting a practice target must not open the microphone');
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.calls.length, 1);
  const [url, init] = app.calls[0];
  assert.equal(url, 'http://127.0.0.1:8766/api/phonetics/analyze');
  assert.equal(init.method, 'POST');
  assert.equal(init.body.get('text'), 'leaf');
  assert.equal(init.body.get('context_text'), original.text);
  assert.equal(init.body.get('context_word_index'), '3');
  assert.equal(init.body.get('context_phone_index'), '1');
  assert.match(app.container.querySelector('.egl-ph-observed > h3').textContent, /ผลเฉพาะเสียง \/iː\/ ในคำ leaf/);
  assert.match(app.container.querySelector('.egl-ph-observed').textContent, /ไม่ใช่ผลของทั้งคำ/);
  assert.deepEqual([...app.container.querySelectorAll('.egl-ph-inspector .egl-ph-grapheme')].map(node => node.textContent), ['l', 'ea', 'f'], 'the result inspector recovers the full original word rather than the one-phone target');
  close(app);
});

test('hosted phone practice passes one real context phone to the browser engine and resets audio when targets change', async () => {
  let args, engineCalls = 0;
  const original = reference();
  const app = setup({ url: 'https://garden.example/app/index.html', reference: original, globals: {
    EGLBrowserPhonetics: { supported: () => true, analyze: async options => { engineCalls++; args = options; return compose(options.reference); } },
  } });
  const panel = selectGroup(selectWord(app, 'leaf'), 'ea'); app.button('ฝึกเฉพาะเสียง /iː/', panel).click();
  const file = selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(args.blob, file);
  assert.equal(args.text, 'leaf');
  assert.equal(args.accent, 'en-us');
  assert.equal(args.reference.words.length, 1);
  assert.deepEqual([...args.reference.words[0].phones], ['iː']);
  assert.equal(args.reference.words[0].index, 0);
  assert.equal(args.reference.words[0].text, 'leaf');
  assert.equal(args.reference.reference_context, 'phone_in_word');
  assert.equal(args.reference.context.text, original.text);
  assert.equal(args.reference.context.word_index, 3);
  assert.equal(args.reference.context.phone_index, 1);
  assert.deepEqual(original.words[3].phones, ['l', 'iː', 'f']);
  assert.match(app.container.querySelector('.egl-ph-observed > h3').textContent, /ผลเฉพาะเสียง \/iː\//);
  app.button('ฝึกเสียงถัดไป', app.container.querySelector('.egl-ph-sound-target')).click();
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /ฝึกเสียง \/f\//);
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  assert.equal(engineCalls, 1, 'changing a target must not start a new analysis');
  selectFile(app);
  app.button('กลับไปฝึกคำ leaf', app.container.querySelector('.egl-ph-sound-target')).click();
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกคำ: leaf/);
  selectFile(app); selectWord(app, 'This');
  assert.equal(app.container.querySelector('.egl-ph-player').getAttribute('src'), null);
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกคำ: This/);
  assert.equal(app.calls.length, 0);
  assert.equal(app.microphones(), 0);
  close(app);
});

test('alphabet controls speak uppercase letter names through a local English voice rather than IPA', () => {
  const spoken = [], local = { localService: true, lang: 'en-US', name: 'Installed English' };
  const app = setup({ globals: {
    speechSynthesis: { getVoices: () => [{ localService: false, lang: 'en-US' }, { localService: true, lang: 'th-TH' }, local], speak: utterance => spoken.push(utterance), cancel() {} },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
  } });
  const section = selectWord(app, 'leaf');
  assert.deepEqual([...section.querySelectorAll('.egl-ph-letter-name')].map(node => node.textContent), ['L', 'E', 'A', 'F']);
  assert.equal(spoken.length, 0);
  section.querySelector('[aria-label="ฟังชื่ออักษร E"]').click();
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'E');
  assert.equal(spoken[0].voice, local);
  assert.equal(spoken[0].lang, 'en-US');
  assert.match(app.container.querySelector('.egl-ph-example-caption').textContent, /ชื่ออักษร E.*ต่างจากเสียงในคำ/);
  assert.equal(app.plays.length, 0);
  assert.equal(app.calls.length, 0);
  close(app);
});

test('selecting a sound shows actual Thai articulation facts, steps, and an explicitly approximate diagram', () => {
  const app = setup(), panel = selectGroup(selectWord(app, 'leaf'), 'ea');
  const description = app.win.EGLSoundFoundations.describe('iː');
  assert.equal(description.known, true);
  const foundation = panel.querySelector('.egl-ph-foundation');
  assert.ok(foundation, 'the real foundation module must be connected to the selected sound guide');
  assert.equal(foundation.querySelector('h5').textContent, 'สร้างเสียง /iː/ ทีละขั้น');
  assert.deepEqual([...foundation.querySelectorAll('.egl-ph-mouth-steps li')].map(node => node.textContent), [...description.steps]);
  assert.ok(description.steps.length >= 3);
  for (const value of [description.place, description.manner, description.voice, description.lips, description.tongue, description.airflow]) {
    assert.ok(foundation.textContent.includes(value), value);
  }
  assert.ok(foundation.querySelector('.egl-ph-air-schematic svg[role="img"] title').textContent.includes('/iː/'));
  assert.match(foundation.querySelector('.egl-ph-articulation-caption').textContent, /ไม่แสดงความยาวเสียง/);
  assert.match(foundation.querySelector('.egl-ph-articulation-image').src, /\/assets\/articulation\/i\.svg$/);
  assert.match(foundation.textContent, /แผนภาพย่อ.*ไม่ใช่ภาพการเคลื่อนไหวจริง/);
  assert.ok([...foundation.querySelectorAll('a')].every(link => link.href.startsWith('https:')));
  assert.equal(app.calls.length, 0);
  assert.equal(app.microphones(), 0);
  close(app);
});

test('real licensed articulation images resolve under a hosted app or speech prefix with per-image credits', () => {
  for (const page of ['app/index.html', 'speech-training/listen.html']) {
    const app = setup({ url: 'https://example.test/prefix/' + page });
    const panel = selectGroup(selectWord(app, 'leaf'), 'f');
    const foundation = panel.querySelector('.egl-ph-foundation'), asset = app.win.EGLArticulationImages.describe('f');
    const figure = foundation.querySelector('.egl-ph-articulation-figure'), image = figure.querySelector('.egl-ph-articulation-image');
    assert.equal(image.src, 'https://example.test/prefix/app/assets/articulation/f.svg');
    assert.equal(image.alt, asset.altThai);
    assert.equal(figure.querySelector('figcaption').textContent, asset.captionThai);
    assert.equal(foundation.querySelector('.egl-ph-anatomy').open, true);
    const credit = figure.querySelector('.egl-ph-image-credit');
    assert.ok(credit.textContent.includes(asset.author));
    assert.ok(credit.textContent.includes('ภาพต้นฉบับไม่ดัดแปลง'));
    assert.deepEqual([...credit.querySelectorAll('a')].map(link => link.href), [new URL(asset.source).href, new URL(asset.licenseURL).href]);
    assert.ok([...credit.querySelectorAll('a')].every(link => link.rel.includes('noopener')));
    assert.equal(app.calls.length, 0);
    assert.equal(app.microphones(), 0);
    close(app);
  }
});

test('a missing or unsafe image mapping uses only the teaching schematic and never invents a picture URL', () => {
  const expected = reference('root', [{ index: 0, text: 'root', ipa: 'ɹuːt', phones: ['ɹ', 'uː', 't'] }]);
  const app = setup({ reference: expected });
  assert.equal(app.win.EGLArticulationImages.describe('ɹ'), null);
  const section = selectWord(app, 'root');
  const foundation = section.querySelector('.egl-ph-foundation');
  assert.ok(foundation.querySelector('svg[role="img"]'));
  assert.equal(foundation.querySelector('img'), null);
  assert.equal(foundation.querySelector('.egl-ph-image-credit'), null);
  assert.equal(app.calls.length, 0);
  close(app);

  const unsafe = setup({ globals: { EGLArticulationImages: { describe: () => ({ src: 'https://unrelated.example/guessed-mouth.svg' }) } } });
  const unsafePanel = selectGroup(selectWord(unsafe, 'leaf'), 'f');
  assert.equal(unsafePanel.querySelector('img'), null);
  assert.ok(unsafePanel.querySelector('svg[role="img"]'));
  assert.equal(unsafe.container.querySelector('[src*="unrelated.example"]'), null);
  close(unsafe);
});

test('an unavailable licensed image falls back to the app schematic without falsely crediting it as an original', () => {
  const app = setup(), panel = selectGroup(selectWord(app, 'leaf'), 'f');
  const figure = panel.querySelector('.egl-ph-articulation-figure'), image = figure.querySelector('img');
  assert.ok(figure.querySelector('.egl-ph-image-credit a'));
  image.dispatchEvent(new app.win.Event('error'));
  assert.equal(figure.querySelector('img'), null);
  assert.ok(figure.querySelector('svg[role="img"] title').textContent.includes('/f/'));
  assert.match(figure.querySelector('figcaption').textContent, /โหลดภาพต้นฉบับไม่สำเร็จ.*แผนภาพตำแหน่งแบบย่อของแอป/);
  assert.equal(figure.querySelector('.egl-ph-image-credit').textContent, '');
  assert.equal(figure.querySelectorAll('.egl-ph-image-credit a').length, 0);
  assert.equal(app.calls.length, 0);
  close(app);
});

test('silent make e has no invented sound or single-phone practice action', () => {
  const app = setup({ reference: reference('make', [{ index: 0, text: 'make', ipa: 'meɪk', phones: ['m', 'eɪ', 'k'] }]) });
  const section = selectWord(app, 'make'), panel = selectGroup(section, 'e');
  assert.deepEqual([...section.querySelectorAll('.egl-ph-grapheme')].map(node => node.textContent), ['m', 'a', 'k', 'e']);
  assert.match(panel.textContent, /ตัวสะกด e ไม่ออกเสียงแยก/);
  assert.equal(panel.querySelectorAll('button').length, 0);
  assert.equal(section.querySelector('.egl-ph-silent .egl-ph-grapheme-sound').textContent, 'ไม่ออกเสียง');
  assert.equal(app.container.textContent.includes('/undefined/'), false);
  assert.equal(app.calls.length, 0);
  close(app);
});

test('unknown spelling mapping preserves a truthful phone-only practice fallback', () => {
  const app = setup({ reference: reference('quark', [{ index: 0, text: 'quark', ipa: 'kwɑːk', phones: ['k', 'w', 'ɑː', 'k'] }]) });
  const section = selectWord(app, 'quark');
  assert.match(section.textContent, /ยังไม่ได้ตรวจการจับคู่ตัวสะกดกับเสียง.*โดยไม่เดา/);
  assert.deepEqual([...section.querySelectorAll('.egl-ph-grapheme')].map(node => node.textContent), ['k', 'w', 'ɑː', 'k']);
  const panel = section.querySelector('.egl-ph-spelling-detail');
  app.button('ฝึกเฉพาะเสียง /k/', panel).click();
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกเสียง \/k\/.*quark/);
  assert.equal(app.calls.length, 0);
  assert.equal(app.microphones(), 0);
  close(app);
});

test('phone examples play the standalone complete word and observed phones play the full learner clip without automatic cuts', async () => {
  const chosen = actualWords.by_word.leaf, original = reference();
  assert.equal(chosen.standalone, true);
  const observed = original.words.flatMap(word => word.phones).map((phone, index, phones) => ({ phone: index === phones.length - 1 ? 's' : phone, start: .1 + index * .08, end: .16 + index * .08 }));
  const response = compose(original, observed);
  const substitution = response.alignment.operations.find(op => op.type === 'substitute' && op.expected === 'f' && op.observed === 's');
  assert.ok(substitution);
  const app = setup({ reference: original, fetch: async () => ({ ok: true, status: 200, json: async () => response }) });
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  [...app.container.querySelectorAll('.egl-ph-compare')].find(node => node.querySelector('.egl-ph-token').textContent === 'leaf').click();
  const section = app.container.querySelector('.egl-ph-inspector .egl-ph-spelling'), panel = selectGroup(section, 'f');
  const learner = app.container.querySelector('.egl-ph-player'), example = app.container.querySelector('.egl-ph-example-player');
  const learnerURL = learner.src;
  app.button('ฟังเสียง /f/ ในคำ', panel).click();
  assert.equal(example.src, new URL(chosen.url, app.win.document.baseURI).href);
  assert.notEqual(example.src, learnerURL);
  Object.defineProperty(example, 'duration', { value: chosen.duration_seconds, configurable: true });
  example.dispatchEvent(new app.win.Event('loadedmetadata'));
  assert.equal(example.currentTime, 0);
  assert.notEqual(example.currentTime, Math.max(0, substitution.start - .07));
  assert.equal(app.plays.at(-1), example);
  assert.match(app.container.querySelector('.egl-ph-example-caption').textContent, /เสียงคำเดี่ยว: leaf.*สร้างเสียงคำนี้แยกต่างหาก.*\/f\/.*คำเต็ม/);
  const previousPauses = app.pauses.filter(audio => audio === example).length;
  example.currentTime = chosen.duration_seconds - .01;
  example.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(app.pauses.filter(audio => audio === example).length, previousPauses, 'the complete word must play naturally to its own end');
  const observedChip = app.container.querySelector('.egl-ph-inspector .egl-ph-op-substitute [aria-label^="ตรวจพบ s "]');
  learner.currentTime = .9; observedChip.click();
  assert.equal(app.plays.at(-1), learner);
  assert.equal(learner.currentTime, 0);
  const learnerPauses = app.pauses.filter(audio => audio === learner).length;
  learner.currentTime = substitution.end + .5; learner.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(app.pauses.filter(audio => audio === learner).length, learnerPauses, 'an observed phone must not trigger a model-timed audio cut');
  assert.equal(app.calls.length, 1, 'playing the shipped example must not upload learner audio or query the acoustic model');
  close(app);
});

test('closing before complete-word metadata arrives pauses playback and prevents a stale delayed restart', () => {
  const app = setup();
  const panel = selectGroup(selectWord(app, 'leaf'), 'ea');
  app.button('ฟังเสียง /iː/ ในคำ', panel).click();
  const example = app.container.querySelector('.egl-ph-example-player');
  assert.equal(example.currentTime, 0);
  const root = app.container.querySelector('.egl-phonetics'); root.open = false; root.dispatchEvent(new app.win.Event('toggle'));
  assert.equal(app.pauses.at(-1), example);
  example.dispatchEvent(new app.win.Event('loadedmetadata'));
  assert.equal(example.currentTime, 0);
  assert.equal(app.plays.length, 1, 'delayed metadata must not begin a new playback after closing');
  app.cleanup();
  example.dispatchEvent(new app.win.Event('loadedmetadata'));
  assert.equal(app.container.children.length, 0);
  app.dom.window.close();
});

test('a missing standalone recording reads the actual whole word with a local voice and never speaks IPA or learner audio', () => {
  const spoken = [];
  const app = setup({ globals: { EGL_WORD_AUDIO: { by_word: {} },
    speechSynthesis: { getVoices: () => [{ localService: true, lang: 'en-US', name: 'Installed English' }], speak: item => spoken.push(item), cancel() {} },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
  } });
  selectFile(app);
  const panel = selectGroup(selectWord(app, 'leaf'), 'f'); app.button('ฟังเสียง /f/ ในคำ', panel).click();
  assert.match(app.container.querySelector('.egl-ph-example-caption').textContent, /เสียงคำเดี่ยว: leaf.*เสียงอังกฤษในเครื่อง.*\/f\/.*คำเต็ม/);
  assert.equal(app.container.querySelector('.egl-ph-example-player').getAttribute('src'), null);
  assert.equal(app.plays.length, 0);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'leaf');
  assert.equal(app.calls.length, 0);
  close(app);
});

test('isolated whole-word practice uses its own reference and omits sentence context in local analysis', async () => {
  const chosen = actualWords.by_word.a;
  assert.deepEqual(Array.from(chosen.reference.words[0].phones), ['eɪ']);
  const app = setup({ fetch: async (_url, init) => {
    assert.equal(init.body.get('context_text'), null);
    assert.equal(init.body.get('context_word_index'), null);
    assert.equal(init.body.get('context_phone_index'), null);
    return { ok: true, status: 200, json: async () => compose(chosen.reference) };
  } });
  selectWord(app, 'a'); app.button('ฝึกคำนี้', app.container.querySelector('.egl-ph-reference-focus')).click();
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.calls[0][1].body.get('text'), 'a');
  assert.match(app.container.querySelector('.egl-ph-observed > h3').textContent, /ผลคำว่า a/);
  assert.equal(app.container.querySelector('.egl-ph-inspector .egl-ph-spelling-focus').textContent, 'a → /eɪ/');
  close(app);
});

test('hosted isolated-word and phone practice use the strong-form target while a sentence weak-form example plays its whole sentence', async () => {
  const dispatched = [];
  const app = setup({ url: 'https://example.test/prefix/app/index.html', globals: {
    EGLBrowserPhonetics: { supported: () => true, analyze: async options => { dispatched.push(options); return compose(options.reference); } },
    EGL_DEMO_DATA: { reference_audio: { by_text: { 'This is a leaf.': { text: 'This is a leaf.', url: '../speech-training/demo-assets/audio/practice/tts-110.wav', words: [] } } } },
  } });
  const panel = selectGroup(selectWord(app, 'a'), 'a');
  assert.equal(panel.querySelector('.egl-ph-spelling-focus').textContent, 'a → /ə/');
  app.button('ฟังเสียง /ə/ ในคำ', panel).click();
  const example = app.container.querySelector('.egl-ph-example-player');
  assert.equal(example.src, 'https://example.test/prefix/speech-training/demo-assets/audio/practice/tts-110.wav');
  example.dispatchEvent(new app.win.Event('loadedmetadata'));
  assert.equal(example.currentTime, 0);
  assert.match(app.container.querySelector('.egl-ph-example-caption').textContent, /\/ə\/ ในประโยคเต็ม.*รูปเต็ม.*eɪ.*รูปเบา/);
  app.button('ฝึกคำนี้', app.container.querySelector('.egl-ph-reference-focus')).click();
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.deepEqual([...dispatched[0].reference.words[0].phones], ['eɪ']);
  assert.equal(dispatched[0].reference.text, 'a');
  assert.equal(dispatched[0].reference.reference_context, 'isolated_word');
  const section = app.container.querySelector('.egl-ph-inspector .egl-ph-spelling');
  app.button('ฝึกเฉพาะเสียง /eɪ/', section).click();
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.deepEqual([...dispatched[1].reference.words[0].phones], ['eɪ']);
  assert.equal(dispatched[1].reference.context.text, 'a');
  assert.equal(dispatched[1].reference.context.word_index, 0);
  assert.equal(dispatched[1].reference.context.phone_index, 0);
  assert.equal(app.calls.length, 0);
  close(app);
});

test('switching weak a to standalone practice refreshes the visible sound panel and stale weak-form controls cannot retarget it', async () => {
  const isolated = actualWords.by_word.a.reference;
  const app = setup({ fetch: async (_url, init) => ({ ok: true, status: 200, json: async () => compose(selectedReference(init.body, isolated)) }) });
  const oldPanel = selectGroup(selectWord(app, 'a'), 'a');
  const staleWeakButton = app.button('ฝึกเฉพาะเสียง /ə/', oldPanel);
  assert.ok(staleWeakButton);
  app.button('ฝึกคำนี้', app.container.querySelector('.egl-ph-reference-focus')).click();
  const currentFocus = app.container.querySelector('.egl-ph-reference-focus');
  assert.equal(currentFocus.querySelector('.egl-ph-spelling-focus').textContent, 'a → /eɪ/');
  assert.match(currentFocus.textContent, /คำเดี่ยว|คำเดียว|แยกคำ/);
  staleWeakButton.click();
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกคำ: a/);
  assert.equal(app.container.querySelector('.egl-ph-sound-target').hidden, true);
  assert.equal(app.calls.length, 0);
  app.button('ฝึกเฉพาะเสียง /eɪ/', currentFocus).click();
  assert.match(app.container.querySelector('.egl-ph-target > strong').textContent, /กำลังฝึกเสียง \/eɪ\//);
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  const form = app.calls[0][1].body;
  assert.equal(form.get('text'), 'a');
  assert.equal(form.get('context_text'), 'a');
  assert.equal(form.get('context_word_index'), '0');
  assert.equal(form.get('context_phone_index'), '0');
  assert.match(app.container.querySelector('.egl-ph-observed > h3').textContent, /ผลเฉพาะเสียง \/eɪ\//);
  close(app);
});
