const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const alignment = require('../phonetic-alignment.js');
const feedback = require('../spelling-feedback.js');
const spelling = require('../spelling-guide.js');

const names = ['spelling-guide.js', 'spelling-feedback.js', 'word-audio.js', 'phonetics.js'];
const sources = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const scope = {}; vm.runInNewContext(sources['word-audio.js'], scope);
const publicWave = fs.readFileSync(path.resolve(__dirname, '..', scope.EGL_WORD_AUDIO.by_word["it's"].url));
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const reference = (text, phones) => ({ text, accent: 'en-us', ipa: phones.join(''),
  words: [{ index: 0, text, ipa: phones.join(''), phones }],
  analysis_type: 'text_pronunciation_reference', audio_analyzed: false });
const its = () => reference("It's", ['ɪ', 't', 's']);
function analysis(expected, phones, quality = 'recognized') {
  const heard = phones.map((phone, index) => ({ phone, start: .1 + index * .1, end: .18 + index * .1 }));
  return { ...alignment.composeAnalysis(expected, heard, { duration_seconds: .64, voiced_seconds: .4, rms_dbfs: -20 }),
    recognition_quality: { status: quality, mean_token_posterior: .9, calibrated: false },
    live_analysis: true, precomputed: false };
}
function setup(t, expected, responses) {
  const dom = new JSDOM('<main></main>', { url: 'https://garden.example/app/index.html', runScripts: 'outside-only' });
  const win = dom.window, calls = [], network = [];
  let sequence = 0;
  win.URL.createObjectURL = () => 'blob:public-' + (++sequence); win.URL.revokeObjectURL = () => {};
  win.HTMLMediaElement.prototype.pause = function () {};
  win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  win.fetch = (...args) => { network.push(args); return Promise.reject(new Error('No private audio or provider calls')); };
  for (const name of names.slice(0, -1)) win.eval(sources[name]);
  win.EGLBrowserPhonetics = { supported: () => true, analyze: async options => {
    calls.push(options); const response = responses.shift(); assert.ok(response);
    return typeof response === 'function' ? response(options) : response;
  } };
  win.eval(sources['phonetics.js']);
  const container = win.document.querySelector('main');
  const cleanup = win.EGLPhonetics.mount(container, { text: expected.text, precomputed: clone(expected), expanded: true });
  t.after(() => { cleanup(); win.close(); });
  return { win, container, calls, network,
    button: (text, area = container) => [...area.querySelectorAll('button')].find(node => node.textContent === text) };
}
function selectFile(app) {
  const input = app.container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true,
    value: [new app.win.File([publicWave], 'public-example-its.wav', { type: 'audio/wav' })] });
  input.dispatchEvent(new app.win.Event('change'));
}
async function analyze(app) {
  selectFile(app); app.button('ดูผลเสียงของฉัน').click(); await flush(); await flush();
  const section = app.container.querySelector('.egl-ph-inspector .egl-ph-spelling');
  assert.ok(section); return section;
}
function cards(section) { return [...section.querySelectorAll('.egl-ph-spelling-group')]; }
function card(section, letters) { return cards(section).find(node => node.querySelector('.egl-ph-grapheme').textContent === letters); }
function statuses(section) { return cards(section).map(node => node.querySelector('.egl-ph-part-status').textContent); }
function learningText(node) {
  const copy = node.cloneNode(true); copy.querySelectorAll('.egl-ph-alignment-details').forEach(details => details.remove());
  return copy.textContent;
}
function noLearningPercentages(section) {
  assert.equal(section.querySelector('.egl-ph-part-percent'), null, 'the old percentage badge must not remain hidden in a learning card');
  for (const node of [...cards(section), section.querySelector('.egl-ph-spelling-summary'), section.querySelector('.egl-ph-spelling-detail')]) {
    assert.doesNotMatch(learningText(node), /\d+(?:\.\d+)?%/);
  }
  for (const node of section.querySelectorAll('.egl-ph-spelling-group, .egl-ph-spelling-summary, .egl-ph-part-result, .egl-ph-spelling-detail .egl-ph-actions button')) {
    assert.doesNotMatch(node.className, /egl-ph-(?:purple|blue|indigo|sky|green|yellow|orange|red)(?:\s|$)/);
  }
  assert.match(section.querySelector('.egl-ph-spelling-summary').textContent, /ฟังเทียบทีละเสียง/);
  assert.doesNotMatch(learningText(section.querySelector('.egl-ph-spelling-summary')), /ควรฝึกก่อน|ฝึกเสียงที่แนะนำ|ฝึกคำเต็มโดยเน้นเสียงที่แนะนำ/);
}

test('QE-001 the screenshot pattern i/t versus ɪ/t/s describes acoustic evidence, preserves raw 0/100/0, and never ranks pronunciation', async t => {
  const expected = its(), data = analysis(expected, ['i', 't']), before = JSON.stringify(data);
  assert.equal(data.alignment.summary.match_percent, 33.3);
  const app = setup(t, expected, [data]), section = await analyze(app);
  assert.deepEqual(statuses(section), ['โมเดลถอดต่าง', 'จับคู่ตรง', 'ยังจับคู่ไม่ได้']);
  for (const [letters, state] of [['I', 'different'], ['t', 'matched'], ["'s", 'missing']]) {
    assert.ok(card(section, letters).classList.contains('egl-ph-evidence-' + state));
    assert.match(card(section, letters).getAttribute('aria-label'), new RegExp(statuses(section)[['I', 't', "'s"].indexOf(letters)]));
  }
  noLearningPercentages(section);
  assert.equal(card(section, 'I').getAttribute('aria-pressed'), 'true');
  const advice = section.querySelector('.egl-ph-part-advice').textContent;
  assert.match(advice, /อ้างอิง \/ɪ\/.*\/i\//);
  assert.doesNotMatch(advice, /ออกเสียงในคำเต็มให้ชัดขึ้น|ระวังเติมสระ|ควรฝึกก่อน/);
  const details = section.querySelector('.egl-ph-alignment-details');
  assert.ok(details); assert.equal(details.open, false);
  assert.deepEqual([...details.querySelectorAll('.egl-ph-raw-phone-percent')].map(node => node.textContent), ['0.0%', '100.0%', '0.0%']);
  assert.match(details.textContent, /ไม่ใช่คะแนน|ไม่ใช่.*ประเมิน|ไม่ได้.*คะแนน/);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '33.3%');
  assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '33.3%');
  assert.ok(data.alignment.operations.some(op => op.type === 'substitute' && op.expected === 'ɪ' && op.observed === 'i'));
  assert.equal(JSON.stringify(data), before, 'qualitative presentation must not boost or rewrite the raw result');
  assert.equal(app.network.length, 0);
});

test('QE-002 a perfect raw token match stays qualitative rather than becoming a pronunciation grade', async t => {
  const expected = its(), data = analysis(expected, ['ɪ', 't', 's']);
  const app = setup(t, expected, [data]), section = await analyze(app);
  assert.deepEqual(statuses(section), ['จับคู่ตรง', 'จับคู่ตรง', 'จับคู่ตรง']); noLearningPercentages(section);
  assert.ok(cards(section).every(node => node.classList.contains('egl-ph-evidence-matched')));
  assert.doesNotMatch(learningText(section), /จับคู่ตรงดีแล้ว|คุณออกเสียงถูกต้อง|ได้คะแนนการออกเสียง/);
  assert.match(section.querySelector('.egl-ph-part-result-label').textContent, /ไม่ใช่คะแนนการออกเสียง/);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  assert.deepEqual([...section.querySelectorAll('.egl-ph-raw-phone-percent')].map(node => node.textContent), ['100.0%', '100.0%', '100.0%']);
});

test('QE-003 a multi-phone group with matches and an insertion shows partial evidence while raw aggregation remains unchanged', async t => {
  const expected = reference('garden', ['ɡ', 'ɑː', 'ɹ', 'd', 'ə', 'n']);
  const data = analysis(expected, ['ɡ', 'ɑː', 'ə', 'ɹ', 'd', 'ə', 'n']);
  const before = JSON.stringify(data), raw = feedback.analyzeWord(data, 0, spelling.forWord('garden', expected.words[0].phones).groups);
  assert.equal(raw.groups.find(group => group.letters === 'ar').match_percent, 66.7);
  const app = setup(t, expected, [data]), section = await analyze(app), ar = card(section, 'ar');
  assert.equal(ar.querySelector('.egl-ph-part-status').textContent, 'จับคู่บางส่วน');
  assert.ok(ar.classList.contains('egl-ph-evidence-partial'));
  ar.click(); noLearningPercentages(section);
  assert.ok(section.querySelectorAll('.egl-ph-spelling-detail .egl-ph-actions button').length >= 2);
  assert.ok([...section.querySelectorAll('.egl-ph-raw-phone-percent')].some(node => node.textContent === '50.0%'));
  assert.equal(JSON.stringify(data), before);
});

test('QE-004 silent letters stay outside acoustic scoring and before-analysis badges are nonvacuously unassessed', async t => {
  const expected = reference('make', ['m', 'eɪ', 'k']), app = setup(t, expected, [analysis(expected, ['m', 'eɪ', 'k'])]);
  app.container.querySelector('.egl-ph-ref-word').click();
  const before = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
  assert.equal(cards(before).length, 4); assert.deepEqual(statuses(before), ['—', '—', '—', '—']);
  assert.ok(cards(before).every(node => node.classList.contains('egl-ph-evidence-unassessed')));
  const section = await analyze(app);
  assert.deepEqual(statuses(section), ['จับคู่ตรง', 'จับคู่ตรง', 'จับคู่ตรง', '—']);
  const silent = card(section, 'e');
  assert.ok(silent.classList.contains('egl-ph-silent')); assert.ok(silent.classList.contains('egl-ph-evidence-unassessed'));
  assert.match(silent.textContent, /ไม่มีเสียงแยก|ไม่ออกเสียง/);
  assert.match(silent.getAttribute('aria-label'), /ไม่ออกเสียงแยก/);
  silent.click(); noLearningPercentages(section);
  assert.equal(section.querySelector('.egl-ph-spelling-detail .egl-ph-part-result'), null);
});

test('QE-005 single-phone practice never spreads one matched token to other original word slots', async t => {
  const expected = reference('leaf', ['l', 'iː', 'f']);
  const app = setup(t, expected, [options => analysis(options.reference, ['iː'])]);
  app.container.querySelector('.egl-ph-ref-word').click();
  const focus = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling'); card(focus, 'ea').click();
  app.button('ฝึกเฉพาะเสียง /iː/', focus.querySelector('.egl-ph-spelling-detail')).click();
  const section = await analyze(app);
  assert.deepEqual(statuses(section), ['—', 'จับคู่ตรง', '—']); noLearningPercentages(section);
  assert.ok(card(section, 'l').classList.contains('egl-ph-evidence-unassessed'));
  assert.ok(card(section, 'ea').classList.contains('egl-ph-evidence-matched'));
  assert.ok(card(section, 'f').classList.contains('egl-ph-evidence-unassessed'));
  assert.equal(card(section, 'ea').getAttribute('aria-pressed'), 'true', 'explicit practice starts on the chosen original phone index');
  card(section, 'f').click();
  assert.equal(card(section, 'f').getAttribute('aria-pressed'), 'true', 'later voluntary choices remain possible');
  assert.deepEqual([...app.calls[0].reference.words[0].phones], ['iː']);
  assert.equal(app.calls[0].reference.context.phone_index, 1);
});

test('QE-006 feedback refresh preserves the chosen spelling group and a new clip clears its evidence without ranking', async t => {
  const expected = reference('leaf', ['l', 'iː', 'f']), data = analysis(expected, ['l', 'iː', 's']);
  const app = setup(t, expected, [data]);
  app.container.querySelector('.egl-ph-ref-word').click();
  app.button('ฝึกคำนี้', app.container.querySelector('.egl-ph-reference-focus')).click();
  const focus = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling');
  assert.equal(card(focus, 'l').getAttribute('aria-pressed'), 'true'); card(focus, 'f').click();
  await analyze(app);
  assert.equal(card(focus, 'f').getAttribute('aria-pressed'), 'true');
  assert.match(focus.querySelector('.egl-ph-spelling-focus').textContent, /\/f\//);
  assert.deepEqual(statuses(focus), ['จับคู่ตรง', 'จับคู่ตรง', 'โมเดลถอดต่าง']);
  selectFile(app);
  assert.deepEqual(statuses(focus), ['—', '—', '—']);
  assert.equal(card(focus, 'f').getAttribute('aria-pressed'), 'true');
  assert.equal(app.container.querySelector('.egl-ph-observed').hidden, true);
  noLearningPercentages(focus); assert.equal(app.calls.length, 1); assert.equal(app.network.length, 0);
});

test('QE-007 uncertain recognition keeps qualitative states unassessed without changing perfect raw diagnostics into success', async t => {
  const expected = its(), data = analysis(expected, ['ɪ', 't', 's'], 'uncertain'), before = JSON.stringify(data);
  const app = setup(t, expected, [data]), section = await analyze(app);
  assert.deepEqual(statuses(section), ['—', '—', '—']); noLearningPercentages(section);
  assert.ok(cards(section).every(node => node.classList.contains('egl-ph-evidence-unassessed')));
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '—');
  assert.equal(data.alignment.summary.match_percent, 100); assert.equal(JSON.stringify(data), before);
});

test('QE-008 explicit one-sound practice uses qualitative overall and word labels while raw 100/0 remain technical', async t => {
  for (const variant of [
    { name: 'matched', phones: ['iː'], quality: 'recognized', raw: '100.0%', label: 'จับคู่ตรง', state: 'matched' },
    { name: 'different', phones: ['ɪ'], quality: 'recognized', raw: '0.0%', label: 'โมเดลถอดต่าง', state: 'different' },
    { name: 'uncertain', phones: ['iː'], quality: 'uncertain', raw: '100.0%', label: '—', state: 'unassessed' }
  ]) {
    await t.test(variant.name, async child => {
      const expected = reference('leaf', ['l', 'iː', 'f']);
      let raw, before;
      const app = setup(child, expected, [options => {
        raw = analysis(options.reference, variant.phones, variant.quality); before = JSON.stringify(raw); return raw;
      }]);
      app.container.querySelector('.egl-ph-ref-word').click();
      const focus = app.container.querySelector('.egl-ph-reference-focus .egl-ph-spelling'); card(focus, 'ea').click();
      app.button('ฝึกเฉพาะเสียง /iː/', focus.querySelector('.egl-ph-spelling-detail')).click();
      const section = await analyze(app), observed = app.container.querySelector('.egl-ph-observed');
      assert.equal(observed.querySelector('.egl-ph-evidence-status').textContent, variant.label);
      assert.equal(observed.querySelector('.egl-ph-word-evidence').textContent, variant.label);
      assert.ok(observed.querySelector('.egl-ph-agreement').classList.contains('egl-ph-evidence-' + variant.state));
      assert.equal(observed.querySelector('.egl-ph-percent'), null);
      assert.equal(observed.querySelector('.egl-ph-word-percent'), null);
      assert.equal(observed.querySelector('.egl-ph-color-legend'), null);
      assert.equal(observed.querySelector('.egl-ph-inspector-title').textContent, 'leaf · ' + variant.label);
      assert.equal(card(section, 'ea').getAttribute('aria-pressed'), 'true');
      const rawSummary = observed.querySelector('.egl-ph-raw-summary-percent');
      const rawWord = observed.querySelector('.egl-ph-raw-word-percent');
      assert.ok(rawSummary); assert.ok(rawWord);
      assert.equal(rawSummary.textContent, variant.raw); assert.equal(rawWord.textContent, variant.raw);
      assert.equal(rawSummary.closest('details').open, false); assert.equal(rawWord.closest('details').open, false);
      assert.equal(raw.alignment.summary.match_percent.toFixed(1) + '%', variant.raw);
      assert.equal(JSON.stringify(raw), before); noLearningPercentages(section);
    });
  }
});

test('QE-009 a naturally one-phone word still uses the existing whole-word raw percentage contract', async t => {
  const expected = reference('a', ['eɪ']), data = analysis(expected, ['eɪ']);
  const app = setup(t, expected, [data]), section = await analyze(app);
  assert.equal(app.container.querySelector('.egl-ph-percent').textContent, '100.0%');
  assert.equal(app.container.querySelector('.egl-ph-word-percent').textContent, '100.0%');
  assert.equal(app.container.querySelector('.egl-ph-evidence-status'), null);
  assert.deepEqual(statuses(section), ['จับคู่ตรง']); noLearningPercentages(section);
});
