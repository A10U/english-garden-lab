const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const alignment = require('../phonetic-alignment.js');

// UI regression fixtures are synthetic recognizer responses. The only audio
// fixture is an existing public word asset; no learner recordings are stored.
const names = ['spelling-guide.js', 'spelling-feedback.js', 'phone-guide.js', 'word-audio.js', 'phonetics.js'];
const sources = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const catalogScope = {}; vm.runInNewContext(sources['word-audio.js'], catalogScope);
const catalog = catalogScope.EGL_WORD_AUDIO.by_word;
const publicWave = fs.readFileSync(path.resolve(__dirname, '..', catalog.with.url));
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const reference = (text, phones) => ({ text, accent: 'en-us', ipa: phones.join(''),
  words: [{ index: 0, text, ipa: phones.join(''), phones }],
  analysis_type: 'text_pronunciation_reference', audio_analyzed: false });
const withReference = () => reference('with', ['w', 'ɪ', 'ð']);

function analysis(expected, phones, posteriors = phones.map(() => .9), status = 'uncertain') {
  const heard = phones.map((phone, index) => ({ phone, start: .1 + index * .1, end: .18 + index * .1 }));
  return { ...alignment.composeAnalysis(expected, heard, { duration_seconds: .64, voiced_seconds: .4, rms_dbfs: -20 }),
    recognition_quality: { status, reason: status === 'uncertain' ? 'low_token_posterior' : null,
      mean_token_posterior: .6, threshold: .65, calibrated: false,
      token_diagnostics: heard.map((segment, observed_index) => ({ ...segment, observed_index,
        mean_token_posterior: posteriors[observed_index], frame_count: 2, calibrated: false, diagnostic_only: true })) },
    live_analysis: true, precomputed: false };
}

function setup(t, expected, responses) {
  const dom = new JSDOM('<main></main>', { url: 'https://garden.example/app/index.html', runScripts: 'outside-only' });
  const win = dom.window, calls = [], network = [], played = [], storage = [], microphones = [];
  let sequence = 0;
  win.URL.createObjectURL = () => 'blob:public-' + (++sequence); win.URL.revokeObjectURL = () => {};
  win.HTMLMediaElement.prototype.pause = function () {};
  win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLMediaElement.prototype.play = function () { played.push({ player: this, src: this.src }); return Promise.resolve(); };
  win.fetch = (...args) => { network.push(args); return Promise.reject(new Error('No analysis or provider requests in these exercises')); };
  win.Storage.prototype.setItem = function (...args) { storage.push(args); };
  Object.defineProperty(win.navigator, 'mediaDevices', { configurable: true,
    value: { getUserMedia: (...args) => { microphones.push(args); return Promise.reject(new Error('Exercise must not open microphone')); } } });
  win.MediaRecorder = class { constructor() { throw new Error('Exercise must not create a recorder'); } };
  for (const name of names.slice(0, -1)) win.eval(sources[name]);
  win.EGLBrowserPhonetics = { supported: () => true, analyze: async options => {
    calls.push(options); const response = responses.shift(); assert.ok(response, 'unexpected extra model inference');
    return typeof response === 'function' ? response(options) : response;
  } };
  win.eval(sources['phonetics.js']);
  const container = win.document.querySelector('main');
  const cleanup = win.EGLPhonetics.mount(container, { text: expected.text, precomputed: clone(expected), expanded: true });
  t.after(() => { cleanup(); win.close(); });
  return { win, container, calls, network, played, storage, microphones,
    button(text, area = container) {
      const found = [...area.querySelectorAll('button')].find(node => node.textContent === text);
      assert.ok(found, 'missing button: ' + text); return found;
    } };
}
function selectFile(app) {
  const input = app.container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true,
    value: [new app.win.File([publicWave], 'public-example-with.wav', { type: 'audio/wav' })] });
  input.dispatchEvent(new app.win.Event('change'));
}
async function analyze(app) {
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush(); await flush();
  const section = app.container.querySelector('.egl-ph-inspector .egl-ph-spelling');
  assert.ok(section, 'analysis must render a spelling inspector'); return section;
}
const cards = section => [...section.querySelectorAll('.egl-ph-spelling-group')];
function card(section, letters) {
  const found = cards(section).find(node => node.querySelector('.egl-ph-grapheme').textContent === letters);
  assert.ok(found, 'missing spelling group: ' + letters); return found;
}
const statuses = section => cards(section).map(node => node.querySelector('.egl-ph-part-status').textContent);
const observation = section => section.querySelector('.egl-ph-observation');
const taskBox = section => section.querySelector('.egl-ph-practice-task');
function learningText(section) {
  const copy = section.cloneNode(true); copy.querySelectorAll('.egl-ph-alignment-details').forEach(node => node.remove());
  return copy.textContent;
}
function noAutomaticActions(app, inferenceCount) {
  assert.equal(app.calls.length, inferenceCount); assert.equal(app.microphones.length, 0);
  assert.equal(app.network.length, 0); assert.equal(app.storage.length, 0);
}

test('AP-001 uncertain exact with exposes provisional observations and valid tentative segments without awarding or rewriting a score', async t => {
  const expected = withReference(), data = analysis(expected, ['w', 'ɪ', 'ð'], [.95, .5, .25]);
  const before = JSON.stringify(data), app = setup(t, expected, [data]), section = await analyze(app);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '—');
  assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '—');
  assert.deepEqual(statuses(section), ['—', '—', '—']);
  assert.match(observation(section).querySelector('.egl-ph-model-reading').textContent, /with: \/w ɪ ð\//);
  assert.match(observation(section).querySelector('.egl-ph-observation-match').textContent, /ครบ 3 หน่วยเสียง.*ยังใช้ยืนยันคะแนน.*ไม่ได้/);
  const uncertainty = observation(section).querySelector('.egl-ph-model-uncertainty').textContent;
  assert.match(uncertainty, /\/ɪ\/, \/ð\//); assert.doesNotMatch(uncertainty, /\/w\//);
  assert.match(uncertainty, /ไม่ใช่การระบุว่าคุณพูดผิด/);
  card(section, 'i').click();
  assert.match(section.querySelector('.egl-ph-part-observation').textContent, /\/ɪ\/.*โมเดลยังไม่มั่นคง/);
  card(section, 'w').click();
  assert.doesNotMatch(section.querySelector('.egl-ph-part-observation').textContent, /โมเดลยังไม่มั่นคง/);
  assert.doesNotMatch(learningText(section), /ควรฝึกก่อน|ฝึกเสียงที่แนะนำ|คุณออกเสียงถูกต้อง|\d+(?:\.\d+)?%/);
  assert.equal(data.alignment.summary.match_percent, 100); assert.equal(JSON.stringify(data), before);
  assert.equal(app.played.length, 0); noAutomaticActions(app, 1);
});

test('AP-002 absent or malformed token diagnostics remain unknown and never inherit the global posterior', async t => {
  for (const variant of ['missing', 'stale timestamps', 'duplicate index', 'unsupported token']) {
    await t.test(variant, async child => {
      const expected = withReference(), data = analysis(expected, ['w', 'ɪ', 'ð'], [.9, .9, .9]);
      data.recognition_quality.mean_token_posterior = .1;
      if (variant === 'missing') delete data.recognition_quality.token_diagnostics;
      if (variant === 'stale timestamps') data.recognition_quality.token_diagnostics.forEach(item => item.start += .01);
      if (variant === 'duplicate index') data.recognition_quality.token_diagnostics.push(...clone(data.recognition_quality.token_diagnostics));
      if (variant === 'unsupported token') data.recognition_quality.unsupported_tokens = ['w', 'ɪ', 'ð'];
      const app = setup(child, expected, [data]), section = await analyze(app);
      assert.match(observation(section).querySelector('.egl-ph-model-reading').textContent, /\/w ɪ ð\//);
      assert.match(observation(section).querySelector('.egl-ph-model-uncertainty').textContent, /ยังไม่มีข้อมูลความมั่นคงรายส่วนเพียงพอ/);
      assert.doesNotMatch(observation(section).textContent, /ส่วนที่โมเดลยังไม่มั่นคง:|โมเดลมั่นใจ|คุณพูดผิด/);
      assert.deepEqual(statuses(section), ['—', '—', '—']); noAutomaticActions(app, 1);
    });
  }
});

test('AP-003 valid high token diagnostics differ from unknown metadata while global abstention stays intact', async t => {
  const expected = withReference(), app = setup(t, expected, [analysis(expected, ['w', 'ɪ', 'ð'], [.9, .9, .9])]);
  const section = await analyze(app);
  assert.equal(observation(section).querySelector('.egl-ph-model-uncertainty'), null);
  assert.match(observation(section).querySelector('.egl-ph-model-reading').textContent, /\/w ɪ ð\//);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '—');
  assert.deepEqual(statuses(section), ['—', '—', '—']);
  assert.doesNotMatch(learningText(section), /โมเดลมั่นใจ|คุณออกเสียงถูกต้อง/); noAutomaticActions(app, 1);
});

test('AP-004 insufficient signal suppresses even high posterior raw hallucinations and keeps the raw object unchanged', async t => {
  for (const metrics of [{ voiced_seconds: 0, rms_dbfs: -20 }, { voiced_seconds: .4, rms_dbfs: -85 }]) {
    await t.test(JSON.stringify(metrics), async child => {
      const expected = withReference(), data = analysis(expected, ['w', 'ɪ', 'ð'], [.99, .99, .99], 'recognized');
      Object.assign(data.metrics, metrics); const before = JSON.stringify(data);
      const app = setup(child, expected, [data]), section = await analyze(app), box = observation(section);
      assert.match(box.textContent, /สัญญาณที่วัดได้ยังไม่เพียงพอ/);
      assert.doesNotMatch(box.textContent, /\/w ɪ ð\/|ถอดตรงกับอ้างอิงครบ/);
      assert.equal(section.querySelector('.egl-ph-part-observation'), null);
      assert.deepEqual(statuses(section), ['—', '—', '—']);
      assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '—');
      assert.equal(taskBox(section).hidden, false, 'self-directed practice remains usable without acoustic evidence');
      assert.equal(JSON.stringify(data), before); noAutomaticActions(app, 1);
    });
  }
});

test('AP-005 with acknowledges both dictionary forms without globally merging θ and ð in raw alignment', async t => {
  const expected = withReference(), data = analysis(expected, ['w', 'ɪ', 'θ'], [.9, .9, .9], 'recognized');
  const before = JSON.stringify(data), app = setup(t, expected, [data]), section = await analyze(app);
  card(section, 'th').click();
  const note = taskBox(section).querySelector('.egl-ph-word-variants').textContent;
  assert.match(note, /\/wɪð\/.*\/wɪθ\/.*ทั้งสองแบบ/); assert.match(note, /ไม่ได้หมายความว่าอีกแบบผิด/);
  assert.match(taskBox(section).querySelector('.egl-ph-task-instruction').textContent, /\/ð\//);
  assert.equal(data.alignment.summary.match_percent, 66.7);
  assert.ok(data.alignment.operations.some(op => op.type === 'substitute' && op.expected === 'ð' && op.observed === 'θ'));
  assert.equal(JSON.stringify(data), before);
  const other = reference('this', ['ð', 'ɪ', 's']);
  const differentApp = setup(t, other, [analysis(other, ['θ', 'ɪ', 's'], [.9, .9, .9], 'recognized')]);
  const otherSection = await analyze(differentApp);
  assert.equal(taskBox(otherSection).querySelector('.egl-ph-word-variants'), null);
  assert.equal(differentApp.container.querySelector('.egl-ph-percent').textContent, '66.7%');
  assert.equal(card(otherSection, 'th').querySelector('.egl-ph-part-status').textContent, 'โมเดลถอดต่าง');
  noAutomaticActions(app, 1); noAutomaticActions(differentApp, 1);
});

test('AP-006 task playback is explicit, uses full standalone example words, and never records or launches another analysis', async t => {
  const expected = withReference(), app = setup(t, expected, [analysis(expected, ['w', 'ɪ', 'ð'])]);
  app.container.querySelector('.egl-ph-ref-word').click();
  const before = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
  assert.equal(app.button('2. ฟังคลิปของฉัน', taskBox(before)).disabled, true);
  assert.equal(app.played.length, 0);
  const section = await analyze(app), player = app.container.querySelector('.egl-ph-example-player');
  assert.equal(app.played.length, 0); assert.equal(app.button('2. ฟังคลิปของฉัน', taskBox(section)).disabled, false);
  for (const [group, label, word] of [
    ['w', '1. ฟังคำตัวอย่าง with', 'with'],
    ['w', 'ฟัง /w/ ที่ต้นคำเต็ม water', 'water'],
    ['i', 'ฟังคำเต็ม sit: สระ /ɪ/', 'sit'],
    ['i', 'ฟังคำเต็ม seat: สระ /iː/ เพื่อเปรียบเทียบ', 'seat'],
    ['th', 'ฟัง /ð/ ในคำเต็ม this', 'this'],
    ['th', 'ฟัง /θ/ ในคำเต็ม thin เพื่อเปรียบเทียบ', 'thin']
  ]) {
    card(section, group).click(); player.currentTime = .37;
    const playedBefore = app.played.length; app.button(label, taskBox(section)).click();
    assert.equal(app.played.length, playedBefore + 1); assert.equal(app.played.at(-1).player, player);
    assert.equal(player.src, new URL(catalog[word].url, app.win.document.baseURI).href);
    player.dispatchEvent(new app.win.Event('loadedmetadata'));
    assert.equal(player.currentTime, 0, 'whole word begins at its start rather than an estimated phoneme crop');
    assert.equal(player.playbackRate, 1);
  }
  const own = app.container.querySelector('.egl-ph-player'), playedBefore = app.played.length;
  app.button('2. ฟังคลิปของฉัน', taskBox(section)).click();
  assert.equal(app.played.length, playedBefore + 1); assert.equal(app.played.at(-1).player, own);
  assert.match(app.played.at(-1).src, /^blob:public-/);
  await flush(); noAutomaticActions(app, 1);
});

test('AP-007 self-checks persist per selected sound in this clip, reset on a new clip, and never leave the page', async t => {
  const expected = withReference(), app = setup(t, expected, [analysis(expected, ['w', 'ɪ', 'ð'])]);
  app.container.querySelector('.egl-ph-ref-word').click();
  app.button('ฝึกคำนี้', app.container.querySelector('.egl-ph-reference-focus')).click();
  const focus = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
  selectFile(app); card(focus, 'i').click();
  app.button('อยากฝึกเพิ่ม', taskBox(focus)).click();
  assert.equal(app.button('อยากฝึกเพิ่ม', taskBox(focus)).getAttribute('aria-pressed'), 'true');
  card(focus, 'th').click();
  assert.equal(taskBox(focus).querySelector('.egl-ph-self-check-status').textContent, 'ยังไม่ได้เลือก');
  app.button('ใกล้ตัวอย่าง', taskBox(focus)).click();
  card(focus, 'i').click();
  assert.equal(taskBox(focus).querySelector('.egl-ph-self-check-status').textContent, 'คุณเลือก: อยากฝึกเพิ่ม');
  app.button('ดูผลเสียงของฉัน').click(); await flush(); await flush();
  assert.equal(card(focus, 'i').getAttribute('aria-pressed'), 'true');
  assert.equal(taskBox(focus).querySelector('.egl-ph-self-check-status').textContent, 'คุณเลือก: อยากฝึกเพิ่ม');
  assert.match(taskBox(focus).textContent, /ไม่ใช่คะแนนหรือผลประเมิน AI.*เก็บเฉพาะในหน้านี้/);
  selectFile(app);
  assert.equal(card(focus, 'i').getAttribute('aria-pressed'), 'true', 'new audio keeps the voluntarily selected sound');
  assert.equal(taskBox(focus).querySelector('.egl-ph-self-check-status').textContent, 'ยังไม่ได้เลือก');
  assert.ok([...taskBox(focus).querySelectorAll('.egl-ph-self-check button')].every(node => node.getAttribute('aria-pressed') === 'false'));
  card(focus, 'th').click();
  assert.equal(taskBox(focus).querySelector('.egl-ph-self-check-status').textContent, 'ยังไม่ได้เลือก');
  noAutomaticActions(app, 1); assert.equal(app.played.length, 0);
});

test('AP-008 explicit non-first phone practice keeps observations and the selected task scoped to that sound', async t => {
  const expected = reference('leaf', ['l', 'iː', 'f']);
  const app = setup(t, expected, [options => analysis(options.reference, ['iː'], [.5])]);
  app.container.querySelector('.egl-ph-ref-word').click();
  const focus = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
  card(focus, 'ea').click(); app.button('ฝึกเฉพาะเสียง /iː/', focus.querySelector('.egl-ph-spelling-detail')).click();
  const section = await analyze(app);
  assert.equal(card(section, 'ea').getAttribute('aria-pressed'), 'true');
  assert.match(taskBox(section).querySelector('h5').textContent, /\/iː\/ ใน leaf/);
  assert.match(observation(section).querySelector('.egl-ph-model-reading').textContent, /เฉพาะเสียงที่เลือกใน leaf: \/iː\//);
  assert.equal(observation(section).querySelector('.egl-ph-observation-match'), null, 'one sound cannot imply whole-word matching');
  assert.match(observation(section).querySelector('.egl-ph-model-uncertainty').textContent, /\/iː\//);
  assert.deepEqual(statuses(section), ['—', '—', '—']);
  assert.deepEqual([...app.calls[0].reference.words[0].phones], ['iː']);
  assert.equal(app.calls[0].reference.context.phone_index, 1); noAutomaticActions(app, 1);
});

test('AP-009 damaged word mappings do not present unrelated observed phones as evidence for the selected word', async t => {
  const expected = withReference(), data = analysis(expected, ['w', 'ɪ', 'ð']);
  data.alignment.operations.forEach(op => { op.observed_index = 99; });
  const before = JSON.stringify(data), app = setup(t, expected, [data]), section = await analyze(app);
  assert.match(observation(section).querySelector('.egl-ph-model-reading').textContent, /ยังไม่มีคำถอดรายเสียงที่เชื่อมกับคำนี้ได้/);
  assert.doesNotMatch(observation(section).textContent, /with: \/w ɪ ð\//);
  assert.equal(observation(section).querySelector('.egl-ph-observation-match'), null);
  assert.equal(section.querySelector('.egl-ph-part-observation'), null);
  assert.match(taskBox(section).querySelector('h5').textContent, /ใน with/);
  assert.equal(JSON.stringify(data), before); noAutomaticActions(app, 1);
});

test('AP-010 a late response after changing the target cannot revive stale observations or exercises', async t => {
  const expected = withReference(); let resolve;
  const app = setup(t, expected, [() => new Promise(done => { resolve = done; })]);
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush();
  assert.equal(app.calls.length, 1); assert.equal(typeof resolve, 'function');
  const textarea = app.container.querySelector('textarea');
  textarea.value = 'leaf'; textarea.dispatchEvent(new app.win.Event('input'));
  assert.equal(app.calls[0].signal.aborted, true);
  resolve(analysis(expected, ['w', 'ɪ', 'ð'], [.3, .3, .3])); await flush(); await flush();
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-observation'), null);
  assert.equal(app.container.querySelector('.egl-ph-practice-task'), null);
  assert.doesNotMatch(app.container.textContent, /คำถอดเบื้องต้นของ with|ลองฝึกทีละขั้น.*ใน with/);
  noAutomaticActions(app, 1);
});
