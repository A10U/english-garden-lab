const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const alignment = require('../phonetic-alignment.js');

const names = ['phone-guide.js', 'spelling-guide.js', 'spelling-feedback.js', 'word-audio.js', 'phonetics.js'];
const sources = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const catalogScope = {};
vm.runInNewContext(sources['word-audio.js'], catalogScope);
const catalog = catalogScope.EGL_WORD_AUDIO;
const publicExample = catalog.by_word["it's"];
const publicWave = fs.readFileSync(path.resolve(__dirname, '..', publicExample.url));
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function result(reference, phones, options = {}) {
  const observed = phones.map((phone, index) => ({ phone, start: .1 + index * .08, end: .16 + index * .08 }));
  const data = {
    reference: clone(reference), observed: { ipa: phones.join(' '), phones: observed, duration_seconds: .54 },
    alignment: alignment.alignPhoneSequences(reference.words, observed),
    metrics: { duration_seconds: .54, voiced_seconds: .3, rms_dbfs: -20, ...(options.metrics || {}) },
    audio_analyzed: true, analysis_type: 'acoustic_phone_comparison', live_analysis: true, precomputed: false
  };
  if (options.quality) data.recognition_quality = options.quality;
  if (options.legacyZero) {
    data.alignment.summary.match_percent = 0;
    data.alignment.words.forEach(word => { word.match_percent = 0; });
  }
  return data;
}
function sentenceReference() {
  const reference = { ...clone(publicExample.reference), text: "It's a leaf.", words: [
    { index: 0, text: "It's", ipa: 'ɪts', phones: ['ɪ', 't', 's'] },
    { index: 1, text: 'a', ipa: 'ə', phones: ['ə'] },
    { index: 2, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }
  ], ipa: 'ɪts ə liːf' };
  delete reference.reference_context; return reference;
}
function setup(t, responses = [], reference = publicExample.reference) {
  const dom = new JSDOM('<main></main>', { url: 'https://garden.example/app/index.html', runScripts: 'outside-only' });
  const win = dom.window, dispatched = [], network = [], played = [], hostResults = [], revoked = [];
  let objectId = 0;
  win.URL.createObjectURL = () => 'blob:short-word-' + (++objectId);
  win.URL.revokeObjectURL = value => revoked.push(value);
  win.HTMLMediaElement.prototype.pause = function () {};
  win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLMediaElement.prototype.play = function () { played.push(this); return Promise.resolve(); };
  win.fetch = (...args) => { network.push(args); return Promise.reject(new Error('No network expected in public-fixture UI tests')); };
  names.slice(0, -1).forEach(name => win.eval(sources[name]));
  win.EGLBrowserPhonetics = { supported: () => true, analyze: async options => {
    dispatched.push(options);
    const next = responses.shift();
    assert.ok(next, 'the test must supply an acoustic response');
    return typeof next === 'function' ? next(options) : next;
  } };
  win.eval(sources['phonetics.js']);
  const container = win.document.querySelector('main');
  const cleanup = win.EGLPhonetics.mount(container, {
    text: reference.text, precomputed: clone(reference), expanded: true, onAnalysis: value => hostResults.push(value)
  });
  t.after(() => { cleanup(); win.close(); });
  return { win, container, dispatched, network, played, hostResults, revoked,
    button: (text, scope = container) => [...scope.querySelectorAll('button')].find(node => node.textContent === text),
    status: () => container.querySelector('[role=status]').textContent };
}
function selectFile(app, exampleKey = "it's") {
  const input = app.container.querySelector('input[type=file]');
  const wave = exampleKey === "it's" ? publicWave : fs.readFileSync(path.resolve(__dirname, '..', catalog.by_word[exampleKey].url));
  Object.defineProperty(input, 'files', { value: [new app.win.File([wave], 'public-example-' + exampleKey + '.wav', { type: 'audio/wav' })], configurable: true });
  input.dispatchEvent(new app.win.Event('change'));
}
async function analyze(app) {
  app.button('ดูผลเสียงของฉัน').click(); await flush(); await flush();
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, false);
}
function practice(app, text) {
  const token = [...app.container.querySelectorAll('.egl-ph-ref-word')].find(node => node.querySelector('.egl-ph-token').textContent === text);
  assert.ok(token, 'reference token must exist: ' + text); token.click();
  const focus = app.container.querySelector('.egl-ph-reference-focus');
  const action = focus && app.button('ฝึกคำนี้', focus) || app.button('ฝึกคำนี้');
  assert.ok(action, 'the selected word must offer isolated practice'); action.click();
}
function unassessed(app) {
  const observed = app.container.querySelector('.egl-ph-observed');
  const overall = observed.querySelector('.egl-ph-percent, .egl-ph-evidence-status');
  assert.ok(overall); assert.equal(overall.textContent, '—');
  assert.ok(observed.querySelector('.egl-ph-agreement').classList.contains(overall.matches('.egl-ph-evidence-status') ? 'egl-ph-evidence-unassessed' : 'egl-ph-unassessed'));
  const words = [...observed.querySelectorAll('.egl-ph-word-percent, .egl-ph-word-evidence')];
  assert.ok(words.length > 0); assert.ok(words.every(node => node.textContent === '—'));
  assert.ok(app.container.querySelectorAll('.egl-ph-part-status').length >= 3);
  assert.ok([...app.container.querySelectorAll('.egl-ph-part-status')].every(node => node.textContent === '—'));
  assert.equal(observed.querySelector('.egl-ph-phone-pairs'), null);
  assert.doesNotMatch(observed.querySelector('.egl-ph-spelling-summary')?.textContent || '', /ควรฝึกก่อน:|จับคู่ตรงดีแล้ว/);
  assert.equal(app.button('คำที่มีเสียงต่างถัดไป').disabled, true);
  assert.ok(observed.querySelector('.egl-ph-recognition-warning'));
}

test('SW-001 legacy zero with no recognized phones stays unassessed and does not call voiced audio silence', async t => {
  const data = result(publicExample.reference, [], { legacyZero: true }), before = JSON.stringify(data);
  const app = setup(t, [data]); practice(app, "it's"); selectFile(app); await analyze(app);
  unassessed(app);
  assert.doesNotMatch(app.status(), /เสียงเบาหรือมีช่วงเงียบมาก/);
  assert.match(app.status(), /หน่วยเสียง|ตรวจไม่พบ|ตรวจแยก/);
  assert.equal(JSON.stringify(data), before, 'display classification must preserve raw diagnostics');
  assert.equal(app.hostResults[0].data.alignment.summary.match_percent, 0);
  assert.equal(app.network.length, 0);
  app.button('ฟังเสียงของฉันทั้งคลิป').click();
  assert.equal(app.played.at(-1), app.container.querySelector('.egl-ph-player'));
});

test('SW-002 absent observation fields cannot display a confident legacy zero', async t => {
  for (const missing of ['observed', 'phones']) {
    await t.test(missing, async child => {
      const data = result(publicExample.reference, [], { legacyZero: true, quality: { status: 'recognized', mean_token_posterior: .9 } });
      if (missing === 'observed') delete data.observed;
      else delete data.observed.phones;
      const app = setup(child, [data]); selectFile(app); await analyze(app); unassessed(app);
    });
  }
});

test('SW-003 explicit zero voiced time suppresses hallucinated perfect matches and phoneme coaching', async t => {
  const data = result(publicExample.reference, ['ɪ', 't', 's'], {
    metrics: { voiced_seconds: 0 }, quality: { status: 'recognized', mean_token_posterior: .99 }
  });
  assert.equal(data.alignment.summary.match_percent, 100);
  const before = JSON.stringify(data), app = setup(t, [data]); selectFile(app); await analyze(app);
  unassessed(app);
  assert.match(app.status(), /เสียงเบา|เงียบ|สัญญาณเสียง/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(app.container.querySelector('.egl-ph-detected').textContent, 'ɪ t s', 'raw model output stays inspectable');
});

test('SW-004 noise-floor boundary does not turn sufficiently audible legacy detections into abstention', async t => {
  for (const rms of [-60.01, -60]) {
    await t.test(String(rms), async child => {
      const data = result(publicExample.reference, ['ʔ', 'i'], { metrics: { rms_dbfs: rms } });
      const app = setup(child, [data]); selectFile(app); await analyze(app);
      if (rms < -60) unassessed(app);
      else {
        assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '0.0%');
        assert.equal(app.container.querySelector('.egl-ph-recognition-warning'), null);
      }
    });
  }
});

test('SW-005 actual mismatching phones without quality metadata retain genuine zero, including legacy missing metrics', async t => {
  for (const withMetrics of [true, false]) {
    await t.test(withMetrics ? 'audible metrics' : 'legacy missing metrics', async child => {
      const data = result(publicExample.reference, ['ʔ', 'i']); if (!withMetrics) delete data.metrics;
      const app = setup(child, [data]); selectFile(app); await analyze(app);
      assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '0.0%');
      assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '0.0%');
      assert.equal(app.container.querySelector('.egl-ph-recognition-warning'), null);
      assert.ok(app.container.querySelector('.egl-ph-phone-pairs'));
      assert.match(app.container.querySelector('.egl-ph-spelling-summary').textContent, /ฟังเทียบทีละเสียง/);
      assert.doesNotMatch(app.container.querySelector('.egl-ph-spelling-summary').textContent, /ควรฝึกก่อน:/);
    });
  }
});

test('SW-006 selecting a new take clears the old score before an empty model response is displayed', async t => {
  const correct = result(publicExample.reference, ['ɪ', 't', 's']);
  const noPhones = result(publicExample.reference, [], { legacyZero: true });
  const app = setup(t, [correct, noPhones]); selectFile(app); await analyze(app);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  selectFile(app);
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-percent'), null);
  await analyze(app); unassessed(app);
  assert.equal(app.dispatched.length, 2); assert.equal(app.network.length, 0);
});

test('SW-007 an unassessed isolated-word take cannot overwrite the saved sentence result', async t => {
  const sentence = sentenceReference();
  const original = JSON.stringify(sentence);
  const app = setup(t, [
    result(sentence, ['ɪ', 't', 's', 'ə', 'l', 'iː', 'f']),
    options => result(options.reference, [], { legacyZero: true })
  ], sentence);
  selectFile(app); await analyze(app);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  const sentenceURL = app.container.querySelector('.egl-ph-player').src;
  practice(app, "It's"); selectFile(app); await analyze(app); unassessed(app);
  assert.equal(app.dispatched[1].reference.reference_context, 'isolated_word');
  app.button('กลับไปฝึกทั้งประโยค').click();
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  assert.equal(app.container.querySelector('.egl-ph-recognition-warning'), null);
  assert.equal(app.container.querySelector('.egl-ph-target').hidden, true);
  assert.equal(app.dispatched.length, 2, 'restoring a known result must not rerun inference');
  assert.ok(app.container.querySelector('.egl-ph-player').src.startsWith('blob:'));
  assert.ok(app.revoked.includes(sentenceURL), 'the old object URL was revoked when switching takes');
  assert.equal(JSON.stringify(sentence), original);
});

test('SW-008 actual standalone contraction references survive case and curly apostrophes without sentence context', async t => {
  for (const text of ["It's", 'It’s']) {
    await t.test(text, async child => {
      const reference = clone(publicExample.reference); reference.text = text; reference.words[0].text = text;
      const before = JSON.stringify(catalog.by_word["it's"]);
      const app = setup(child, [options => result(options.reference, ['ɪ', 't', 's'])], reference);
      practice(app, text); selectFile(app); await analyze(app);
      const sent = app.dispatched[0].reference;
      assert.equal(sent.reference_context, 'isolated_word');
      assert.deepEqual([...sent.words[0].phones], ['ɪ', 't', 's']);
      assert.equal(sent.words[0].index, 0); assert.equal(sent.context, undefined);
      assert.equal(JSON.stringify(catalog.by_word["it's"]), before);
      assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
    });
  }
});

test('SW-009 actual standalone a keeps its strong form while the saved sentence retains schwa', async t => {
  const reference = { ...clone(publicExample.reference), text: 'a leaf', ipa: 'ə liːf', words: [
    { index: 0, text: 'a', ipa: 'ə', phones: ['ə'] }, { index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }
  ] };
  delete reference.reference_context;
  const app = setup(t, [options => result(options.reference, ['eɪ'])], reference);
  practice(app, 'a'); selectFile(app); await analyze(app);
  const sent = app.dispatched[0].reference;
  assert.equal(sent.reference_context, 'isolated_word');
  assert.deepEqual([...sent.words[0].phones], ['eɪ']); assert.equal(sent.context, undefined);
  assert.deepEqual(reference.words[0].phones, ['ə']);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  assert.equal(app.network.length, 0);
});

test('SW-010 no recognition in single-phone practice leaves the selected phone and every other slot unassessed', async t => {
  const app = setup(t, [options => result(options.reference, [], { legacyZero: true })]);
  app.container.querySelector('.egl-ph-ref-word').click();
  const focus = app.container.querySelector('.egl-ph-reference-focus');
  const group = [...focus.querySelectorAll('.egl-ph-spelling-group')].find(node => node.querySelector('.egl-ph-grapheme').textContent === 'i');
  assert.ok(group); group.click();
  app.button('ฝึกเฉพาะเสียง /ɪ/', focus.querySelector('.egl-ph-spelling-detail')).click();
  selectFile(app); await analyze(app); unassessed(app);
  const sent = app.dispatched[0].reference;
  assert.equal(sent.reference_context, 'phone_in_word');
  assert.deepEqual([...sent.words[0].phones], ['ɪ']); assert.equal(sent.context.phone_index, 0);
  assert.match(app.container.querySelector('.egl-ph-observed > h3').textContent, /ผลเฉพาะเสียง \/ɪ\//);
  const inspector = app.container.querySelector('.egl-ph-inspector');
  assert.ok(inspector.querySelectorAll('.egl-ph-part-status').length >= 3, 'the whole-word inspector retains the other unassessed slots');
  assert.equal(app.network.length, 0);
});

test('SW-011 contextual fallback restores the saved sentence, focuses recording, and never reruns inference', async t => {
  const sentence = sentenceReference();
  const app = setup(t, [
    result(sentence, ['ɪ', 't', 's', 'ə', 'l', 'iː', 'f']),
    options => result(options.reference, [], { legacyZero: true })
  ], sentence);
  selectFile(app); await analyze(app);
  practice(app, "It's"); selectFile(app); await analyze(app); unassessed(app);
  const fallback = app.button('ลองฝึกคำนี้ในประโยคเดิม');
  assert.ok(fallback); fallback.click();
  assert.equal(app.container.querySelector('.egl-ph-target').hidden, true);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  assert.equal(app.container.querySelector('.egl-ph-recognition-warning'), null);
  assert.equal(app.container.querySelector('textarea').value, sentence.text);
  assert.equal(app.win.document.activeElement, app.button('บันทึกเสียงของฉัน'));
  assert.match(app.status(), /เริ่มพูดได้|ประโยค/);
  assert.equal(app.dispatched.length, 2); assert.equal(app.network.length, 0);
  assert.equal(app.button('หยุดบันทึก'), undefined, 'fallback must leave microphone capture to the next explicit tap');
});

test('SW-012 exact this and it\'s targets stay distinct from selected phonemes when recognition is empty', async t => {
  for (const { key, phones, selected, letters } of [
    { key: 'this', phones: ['ð', 'ɪ', 's'], selected: 'ð', letters: 'th' },
    { key: "it's", phones: ['ɪ', 't', 's'], selected: 'ɪ', letters: 'i' }
  ]) {
    await t.test(key, async child => {
      const reference = clone(catalog.by_word[key].reference), before = JSON.stringify(reference);
      const app = setup(child, [
        options => result(options.reference, [], { legacyZero: true }),
        options => result(options.reference, [], { legacyZero: true }),
        options => result(options.reference, phones)
      ], reference);
      practice(app, key); selectFile(app, key); await analyze(app); unassessed(app);
      assert.equal(app.dispatched[0].reference.reference_context, 'isolated_word');
      assert.deepEqual([...app.dispatched[0].reference.words[0].phones], phones);
      const inspector = app.container.querySelector('.egl-ph-inspector');
      const group = [...inspector.querySelectorAll('.egl-ph-spelling-group')].find(node => node.querySelector('.egl-ph-grapheme').textContent === letters);
      assert.ok(group); group.click();
      app.button('ฝึกเฉพาะเสียง /' + selected + '/', inspector.querySelector('.egl-ph-spelling-detail')).click();
      selectFile(app, key); await analyze(app); unassessed(app);
      assert.equal(app.dispatched[1].reference.reference_context, 'phone_in_word');
      assert.deepEqual([...app.dispatched[1].reference.words[0].phones], [selected]);
      assert.equal(app.dispatched[1].reference.context.phone_index, 0);
      app.button('กลับไปฝึกคำ ' + key, app.container.querySelector('.egl-ph-sound-target')).click();
      selectFile(app, key); await analyze(app);
      assert.equal(app.dispatched[2].reference.reference_context, 'isolated_word');
      assert.deepEqual([...app.dispatched[2].reference.words[0].phones], phones);
      assert.equal(app.dispatched[2].reference.context, undefined);
      assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
      assert.equal(JSON.stringify(reference), before); assert.equal(app.network.length, 0);
    });
  }
});

test('SW-013 possessive its never silently reuses the different it\'s catalog entry', async t => {
  assert.equal(catalog.by_word.its, undefined, 'this fixture documents the current public catalog gap');
  const reference = { ...clone(publicExample.reference), text: 'its leaf', ipa: 'ɪts liːf', words: [
    { index: 0, text: 'its', ipa: 'ɪts', phones: ['ɪ', 't', 's'] },
    { index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }
  ] };
  delete reference.reference_context;
  const app = setup(t, [], reference);
  practice(app, 'its'); selectFile(app); app.button('ดูผลเสียงของฉัน').click();
  await flush(); await flush();
  assert.equal(app.dispatched.length, 0, 'missing isolated reference must not start inference or a model download');
  assert.equal(app.container.querySelector('.egl-ph-percent'), null);
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  assert.match(app.status(), /ยังไม่มีคำอ่านของคำเดี่ยวนี้/);
  assert.equal(app.network.length, 0);
});
