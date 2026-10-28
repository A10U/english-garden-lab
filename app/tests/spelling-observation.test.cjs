const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const feedback = require('../spelling-feedback.js');
const aligner = require('../phonetic-alignment.js');
const spelling = require('../spelling-guide.js');

const word = (text = 'with', phones = ['w', 'ɪ', 'ð'], index = 0) => ({ index, text, ipa: phones.join(''), phones });
const groupsFor = source => spelling.forWord(source.text, source.phones).groups;
const clone = value => JSON.parse(JSON.stringify(value));
function analysis(words = [word()], heard = ['w', 'ɪ', 'ð']) {
  const segments = heard.map((phone, at) => ({ phone, start: at * .1, end: (at + 1) * .1 }));
  return { reference: { text: words.map(item => item.text).join(' '), words }, observed: { phones: segments },
    alignment: aligner.alignPhoneSequences(words, segments), audio_analyzed: true, analysis_type: 'acoustic_phone_comparison',
    recognition_quality: { status: 'uncertain', mean_token_posterior: .6, threshold: .65,
      calibrated: false, reason: 'low_token_posterior' } };
}
function attachDiagnostics(data, values = []) {
  data.recognition_quality.token_diagnostics = data.observed.phones.map((segment, observed_index) => ({
    observed_index, phone: segment.phone, start: segment.start, end: segment.end,
    mean_token_posterior: values[observed_index] == null ? .9 : values[observed_index],
    frame_count: 2, calibrated: false, diagnostic_only: true
  }));
  return data;
}
const relations = result => result.phones.map(item => item.relation);
function noGrades(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['grade', 'score', 'match_percent', 'priority'].includes(key), 'observation must not contain ' + key);
    noGrades(child);
  }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('observation is pure in UMD/CommonJS and does not alter the existing uncertain assessment gate', () => {
  const context = {};
  for (const name of ['document', 'fetch', 'navigator', 'Audio']) Object.defineProperty(context, name, { get() { throw new Error('must stay pure'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../spelling-feedback.js'), 'utf8'), context);
  const data = attachDiagnostics(analysis()), groups = groupsFor(word()), original = clone(data), originalGroups = clone(groups);
  const assessedBefore = feedback.analyzeWord(data, 0, groups);
  const observed = feedback.observeWord(freeze(data), 0, freeze(groups));
  assert.deepEqual(clone(context.EGLSpellingFeedback.observeWord(data, 0, groups)), observed);
  assert.deepEqual(feedback.analyzeWord(data, 0, groups), assessedBefore);
  assert.equal(assessedBefore.available, false); assert.deepEqual(assessedBefore.priority, []);
  assert.deepEqual(data, original); assert.deepEqual(groups, originalGroups); noGrades(observed);
  assert.equal(observed.provisional, true); assert.equal(observed.assessmentAvailable, false);
});

test('a complete raw match remains observable under global uncertainty with per-token tentative points only', () => {
  const data = attachDiagnostics(analysis(), [.9, .64, .42]);
  const result = feedback.observeWord(data, 0, groupsFor(word()));
  assert.deepEqual(relations(result), ['match', 'match', 'match']);
  assert.deepEqual(result.rawHeard, ['w', 'ɪ', 'ð']); assert.deepEqual(result.wordRawHeard, ['w', 'ɪ', 'ð']);
  assert.equal(result.referenceCount, 3); assert.equal(result.observedMatchCount, 3); assert.equal(result.completeRawMatch, true);
  assert.deepEqual(result.phones.map(item => item.tentative), [false, true, true]);
  assert.ok(result.phones.every(item => item.diagnosticAvailable));
  assert.deepEqual(result.phones.map(item => item.tokenDiagnostics[0].observed_index), [0, 1, 2]);
  assert.equal(data.recognition_quality.status, 'uncertain'); noGrades(result);
});

test('missing segment diagnostics stay unknown and never inherit the global mean', () => {
  const data = analysis(); data.recognition_quality.mean_token_posterior = .01;
  let result = feedback.observeWord(data, 0, groupsFor(word()));
  assert.deepEqual(result.phones.map(item => item.tentative), [false, false, false]);
  assert.ok(result.phones.every(item => !item.diagnosticAvailable && item.tokenDiagnostics.length === 0));
  attachDiagnostics(data, [.8, .8, .8]);
  result = feedback.observeWord(data, 0, groupsFor(word()));
  assert.ok(result.phones.every(item => item.diagnosticAvailable && !item.tentative));
  data.recognition_quality.status = 'recognized'; data.recognition_quality.mean_token_posterior = .99;
  data.recognition_quality.token_diagnostics[1].mean_token_posterior = .2;
  assert.equal(feedback.observeWord(data, 0, groupsFor(word())).phones[1].tentative, true);
  assert.equal(data.recognition_quality.status, 'recognized', 'descriptive diagnostics cannot downgrade the assessment');
});

test('posterior threshold boundaries are exact and missing/invalid thresholds do not classify segments', () => {
  const data = attachDiagnostics(analysis(), [.65, .649999, .650001]);
  assert.deepEqual(feedback.observeWord(data, 0).phones.map(item => item.tentative), [false, true, false]);
  for (const threshold of [undefined, null, NaN, -1, 2, '.65']) {
    data.recognition_quality.threshold = threshold;
    const result = feedback.observeWord(data, 0);
    assert.ok(result.phones.every(item => !item.tentative && !item.diagnosticAvailable));
  }
});

test('/i/ and /ɪ/, and /θ/ and /ð/, remain literal different hypotheses rather than silently equivalent phones', () => {
  const data = attachDiagnostics(analysis([word()], ['w', 'i', 'θ']));
  const result = feedback.observeWord(data, 0, groupsFor(word()));
  assert.deepEqual(relations(result), ['match', 'different', 'different']);
  assert.deepEqual(result.phones.map(item => item.observed), [['w'], ['i'], ['θ']]);
  assert.equal(result.observedMatchCount, 1); assert.equal(result.completeRawMatch, false);
  assert.equal(result.phones[1].operations[0].type, 'substitute');
  assert.equal(result.phones[1].operations[0].expected, 'ɪ');
});

test('deleted reference phones have no segment posterior, including a nearby inserted observation', () => {
  const data = attachDiagnostics(analysis([word()], ['w', 'ɪ']));
  const result = feedback.observeWord(data, 0, groupsFor(word()));
  assert.deepEqual(relations(result), ['match', 'match', 'not_detected']);
  const missing = result.phones[2];
  assert.deepEqual(missing.observed, []); assert.deepEqual(missing.tokenDiagnostics, []);
  assert.equal(missing.diagnosticAvailable, false); assert.equal(missing.tentative, false);
  assert.equal(result.observedMatchCount, 2); assert.equal(result.completeRawMatch, false);
  const inserted = attachDiagnostics(analysis([word()], ['w', 'ɪ', 'ə']), [.9, .9, .1]);
  const operations = inserted.alignment.operations;
  const last = operations.findIndex(item => item.expected_index === 2);
  operations.splice(last, 1,
    { type: 'delete', expected_index: 2, observed_index: null, word_index: 0, expected: 'ð', observed: null },
    { type: 'insert', expected_index: null, observed_index: 2, word_index: 0, expected: null, observed: 'ə' });
  const deleted = feedback.observeWord(inserted, 0).phones[2];
  assert.equal(deleted.relation, 'not_detected'); assert.deepEqual(deleted.observed, ['ə']);
  assert.deepEqual(deleted.tokenDiagnostics, []); assert.equal(deleted.tentative, false);
});

test('insertions retain their actual observed indices and block a complete raw match without creating a grade', () => {
  const source = word('leaf', ['l', 'iː', 'f'], 9);
  const data = attachDiagnostics(analysis([source], ['ə', 'l', 'ə', 'iː', 'f', 'ə']), [.1, .9, .9, .9, .9, .9]);
  const result = feedback.observeWord(data, 9, groupsFor(source));
  assert.deepEqual(relations(result), ['different', 'different', 'different']);
  assert.deepEqual(result.phones.map(item => item.observed), [['ə', 'l'], ['ə', 'iː'], ['f', 'ə']]);
  assert.deepEqual(result.phones.map(item => item.tokenDiagnostics.map(row => row.observed_index)), [[0, 1], [2, 3], [4, 5]]);
  assert.equal(result.observedMatchCount, 3); assert.equal(result.referenceCount, 3); assert.equal(result.completeRawMatch, false);
  assert.equal(result.phones[0].tentative, true); assert.deepEqual(result.wordRawHeard, data.observed.phones.map(item => item.phone));
  noGrades(result);
});

test('an unmapped extra observation cannot manufacture a complete isolated-word hypothesis', () => {
  const data = attachDiagnostics(analysis());
  data.observed.phones.push({ phone: 'ə', start: .4, end: .5 });
  const result = feedback.observeWord(data, 0);
  assert.deepEqual(relations(result), ['match', 'match', 'match']);
  assert.deepEqual(result.rawHeard, ['w', 'ɪ', 'ð', 'ə']);
  assert.equal(result.observedMatchCount, 3); assert.equal(result.completeRawMatch, false);
});

test('sentence observations use global actual indices while word-local output excludes the other words', () => {
  const source = word('leaf', ['l', 'iː', 'f'], 9), preceding = word('a', ['ə'], 4);
  const data = attachDiagnostics(analysis([preceding, source], ['ə', 'l', 'iː', 'f']), [.1, .9, .6, .9]);
  const result = feedback.observeWord(data, 9, groupsFor(source));
  assert.deepEqual(result.rawHeard, ['ə', 'l', 'iː', 'f']); assert.deepEqual(result.wordRawHeard, ['l', 'iː', 'f']);
  assert.deepEqual(result.phones.map(item => item.operations[0].expected_index), [1, 2, 3]);
  assert.deepEqual(result.phones.map(item => item.tokenDiagnostics[0].observed_index), [1, 2, 3]);
  assert.deepEqual(result.phones.map(item => item.tentative), [false, true, false]);
  assert.equal(result.completeRawMatch, true); assert.equal(result.scope, 'word');
});

test('word-in-sentence aliases keep literal result mapping and original word identity', () => {
  const source = word('leaf', ['l', 'iː', 'f'], 0), data = attachDiagnostics(analysis([source], source.phones));
  data.reference.reference_context = 'word_in_sentence';
  data.reference.context = { text: 'a leaf', word_index: 9 };
  const result = feedback.observeWord(data, 9, groupsFor(source));
  assert.equal(result.completeRawMatch, true); assert.equal(result.scope, 'word');
  assert.ok(result.phones.every(item => item.operations[0].word_index === 0));
});

test('explicit single-phone context projects only the original selected slot and never claims a complete word', () => {
  const original = word(), practiced = word('with', ['ɪ'], 0), data = attachDiagnostics(analysis([practiced], ['ɪ']), [.6]);
  data.reference.reference_context = 'phone_in_word';
  data.reference.context = { text: 'Welcome back. Let\'s start with one small step.', word_index: 4, phone_index: 1 };
  const result = feedback.observeWord(data, 4, groupsFor(original));
  assert.equal(result.scope, 'phone_in_word'); assert.equal(result.selectedPhoneIndex, 1);
  assert.deepEqual(result.phones.map(item => item.phoneIndex), [0, 1, 2]);
  assert.deepEqual(relations(result), ['unavailable', 'match', 'unavailable']);
  assert.equal(result.referenceCount, 1); assert.equal(result.observedMatchCount, 1); assert.equal(result.completeRawMatch, false);
  assert.equal(result.phones[1].tentative, true); assert.equal(result.phones[1].tokenDiagnostics[0].observed_index, 0);
  assert.equal(result.phones[1].operations[0].expected_index, 0);
  assert.equal(feedback.observeWord(data, 0, groupsFor(original)).selectedPhoneIndex, 1);
  assert.equal(feedback.observeWord(data, 8, groupsFor(original)).available, false);
});

test('empty actual observations describe a decoder omission but absent or malformed sequences remain unavailable', () => {
  const data = analysis([word()], []);
  let result = feedback.observeWord(data, 0);
  assert.deepEqual(result.rawHeard, []); assert.deepEqual(relations(result), ['not_detected', 'not_detected', 'not_detected']);
  assert.equal(result.completeRawMatch, false); assert.equal(result.observedMatchCount, 0);
  assert.ok(result.phones.every(item => !item.tentative && !item.diagnosticAvailable));
  for (const observed of [undefined, {}, { phones: 'wɪð' }, { phones: [null] }]) {
    const broken = { ...data, observed }; result = feedback.observeWord(broken, 0);
    assert.ok(result.phones.every(item => item.relation === 'unavailable' && item.operations.length === 0));
    assert.equal(result.available, false); assert.deepEqual(result.rawHeard, []);
  }
});

test('invalid and duplicate operations never publish their mappings while valid independent slots remain observable', () => {
  for (const change of [{ type: 'invalid' }, { expected: 'i' }, { observed_index: 99 }, { word_index: 99 }]) {
    const data = attachDiagnostics(analysis()); Object.assign(data.alignment.operations[1], change);
    const result = feedback.observeWord(data, 0);
    assert.equal(result.phones[1].relation, 'unavailable'); assert.deepEqual(result.phones[1].operations, []);
    assert.deepEqual(result.phones[1].observed, []); assert.deepEqual(result.phones[1].tokenDiagnostics, []);
    assert.equal(result.completeRawMatch, false);
  }
  const data = analysis(); data.alignment.operations.splice(2, 0, clone(data.alignment.operations[1]));
  assert.deepEqual(relations(feedback.observeWord(data, 0)), ['match', 'unavailable', 'match']);
  const reused = analysis(); reused.alignment.operations[1].observed_index = 0;
  assert.deepEqual(relations(feedback.observeWord(reused, 0)), ['unavailable', 'unavailable', 'match']);
});

test('stale, foreign, malformed or duplicate diagnostic records stay unknown rather than borrowing another segment', () => {
  const mutations = [
    row => { row.phone = 'i'; }, row => { row.start += .001; }, row => { row.end += .001; },
    row => { row.mean_token_posterior = NaN; }, row => { row.mean_token_posterior = -1; },
    row => { row.mean_token_posterior = 1.1; }, row => { row.mean_token_posterior = '.1'; },
    row => { row.frame_count = 0; }, row => { row.frame_count = 1.5; },
    row => { row.calibrated = true; }, row => { delete row.diagnostic_only; }
  ];
  for (const mutate of mutations) {
    const data = attachDiagnostics(analysis(), [.9, .1, .9]); mutate(data.recognition_quality.token_diagnostics[1]);
    const result = feedback.observeWord(data, 0);
    assert.deepEqual(result.phones[1].tokenDiagnostics, []);
    assert.equal(result.phones[1].diagnosticAvailable, false); assert.equal(result.phones[1].tentative, false);
    assert.equal(result.phones[0].diagnosticAvailable, true);
    assert.equal(result.phones[1].relation, 'match', 'missing diagnostics must not erase a valid raw hypothesis');
  }
  const data = attachDiagnostics(analysis(), [.9, .1, .9]);
  data.recognition_quality.token_diagnostics.push(clone(data.recognition_quality.token_diagnostics[1]));
  assert.equal(feedback.observeWord(data, 0).phones[1].diagnosticAvailable, false);
  assert.equal(feedback.observeWord(data, 0).phones[1].tentative, false);
});

test('unsupported raw model tokens remain inspectable without being treated as reliable English diagnostics', () => {
  const data = attachDiagnostics(analysis([word()], ['w', 'i5', 'ð']), [.9, .1, .9]);
  data.recognition_quality.unsupported_tokens = ['i5']; data.recognition_quality.reason = 'unsupported_english_tokens';
  const result = feedback.observeWord(data, 0);
  assert.deepEqual(result.rawHeard, ['w', 'i5', 'ð']); assert.equal(result.phones[1].relation, 'different');
  assert.deepEqual(result.phones[1].observed, ['i5']); assert.deepEqual(result.phones[1].tokenDiagnostics, []);
  assert.equal(result.phones[1].diagnosticAvailable, false); assert.equal(result.phones[1].tentative, false);
  assert.equal(data.recognition_quality.status, 'uncertain');
});

test('missing timing or string-only legacy segments cannot receive timestamp-specific diagnostics', () => {
  const data = attachDiagnostics(analysis(), [.1, .1, .1]);
  data.observed.phones = data.observed.phones.map(item => item.phone);
  const result = feedback.observeWord(data, 0);
  assert.deepEqual(relations(result), ['match', 'match', 'match']);
  assert.ok(result.phones.every(item => !item.diagnosticAvailable && !item.tentative && item.tokenDiagnostics.length === 0));
});

test('invalid references or nonacoustic payloads cannot produce observations from forged operations', () => {
  for (const change of [{ audio_analyzed: false }, { analysis_type: 'text_pronunciation_reference' },
    { reference: null }, { reference: { words: [] } }, { reference: { words: [word(), word()] } }]) {
    const data = { ...analysis(), ...change }, result = feedback.observeWord(data, 0);
    assert.equal(result.available, false); assert.equal(result.completeRawMatch, false);
    assert.equal(result.observedMatchCount, 0); assert.equal(result.referenceCount, 0);
  }
  for (const data of [null, undefined, 3, {}, []]) {
    const result = feedback.observeWord(data, 0);
    assert.equal(result.available, false); assert.deepEqual(result.phones, []); noGrades(result);
  }
});

test('returned mappings and diagnostics are detached and omit arbitrary scoring fields from raw operations', () => {
  const data = attachDiagnostics(analysis()), groups = groupsFor(word());
  data.alignment.operations[0].match_percent = 100; data.alignment.operations[0].priority = ['must not leak'];
  const before = clone(data), result = feedback.observeWord(data, 0, groups); noGrades(result);
  result.phones[0].operations[0].observed = 'changed';
  result.phones[0].tokenDiagnostics[0].phone = 'changed'; result.phones[0].observed.push('changed');
  result.rawHeard[0] = 'changed'; result.wordRawHeard[0] = 'changed';
  assert.deepEqual(data, before);
});
