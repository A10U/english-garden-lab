const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const feedback = require('../spelling-feedback.js');
const aligner = require('../phonetic-alignment.js');
const spelling = require('../spelling-guide.js');

const leaf = (index = 9) => ({index, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f']});
const groupsFor = word => spelling.forWord(word.text, word.phones).groups;
function makeAnalysis(words, phones) {
  const observed = phones.map((phone, index) => ({phone, start: index * .1, end: (index + 1) * .1}));
  return {reference: {text: words.map(word => word.text).join(' '), words}, observed: {phones: observed},
    alignment: aligner.alignPhoneSequences(words, observed), audio_analyzed: true, analysis_type: 'acoustic_phone_comparison'};
}
const values = result => result.phones.map(phone => phone.match_percent);
const clone = value => JSON.parse(JSON.stringify(value));

test('UMD and CommonJS agree without accessing DOM/network/media', () => {
  const context = {};
  for (const name of ['document', 'fetch', 'navigator', 'Audio']) Object.defineProperty(context, name, {get() { throw new Error('must stay pure'); }});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../spelling-feedback.js'), 'utf8'), context);
  const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  assert.deepEqual(clone(context.EGLSpellingFeedback.analyzeWord(data, 9, groupsFor(leaf()))), feedback.analyzeWord(data, 9, groupsFor(leaf())));
});

test('global expected indices resolve across preceding words and preserve nonsequential word IDs', () => {
  const words = [{index: 4, text: 'a', ipa: 'ə', phones: ['ə']}, leaf(9)];
  const data = makeAnalysis(words, ['ə', 'l', 'iː', 'f']);
  const before = clone(data), groups = groupsFor(words[1]), originalGroups = clone(groups);
  const result = feedback.analyzeWord(data, 9, groups);
  assert.equal(result.available, true);
  assert.deepEqual(values(result), [100, 100, 100]);
  assert.deepEqual(result.phones.map(phone => phone.phoneIndex), [0, 1, 2]);
  assert.deepEqual(result.phones.map(phone => phone.operations[0].expected_index), [1, 2, 3]);
  assert.ok(result.phones.every(phone => phone.operations[0].word_index === 9));
  assert.deepEqual(result.groups.map(group => group.match_percent), [100, 100, 100]);
  assert.deepEqual(result.priority, []);
  assert.deepEqual(data, before); assert.deepEqual(groups, originalGroups);
  assert.equal(feedback.analyzeWord(data, 1).available, false, 'word ID is not an array position');
});

test('substitution scores only the actual affected phoneme and its checked grapheme group', () => {
  const data = makeAnalysis([leaf()], ['l', 'ɪ', 'f']);
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(values(result), [100, 0, 100]);
  assert.equal(result.phones[1].status, 'substitute');
  assert.deepEqual(result.phones[1].observed, ['ɪ']);
  assert.deepEqual(result.groups.map(group => [group.letters, group.match_percent]), [['l', 100], ['ea', 0], ['f', 100]]);
  assert.deepEqual(result.priority, [1]);
  assert.equal(result.phones[1].counts.substituted_phones, 1);
});

test('a deleted phoneme is zero when the recording has other detected speech', () => {
  const data = makeAnalysis([leaf()], ['l', 'iː']);
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(values(result), [100, 100, 0]);
  assert.equal(result.phones[2].status, 'delete');
  assert.deepEqual(result.phones[2].observed, []);
  assert.equal(result.phones[2].counts.deleted_phones, 1);
  assert.deepEqual(result.priority, [2]);
});

test('insertions attach to the following phone and final insertions to the last phone', () => {
  const data = makeAnalysis([leaf()], ['l', 'ə', 'iː', 'f', 'ə']);
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(values(result), [100, 50, 50]);
  assert.deepEqual(result.phones[1].observed, ['ə', 'iː']);
  assert.deepEqual(result.phones[2].observed, ['f', 'ə']);
  assert.equal(result.phones[1].status, 'insert');
  assert.equal(result.phones[2].counts.compared_phones, 2);
  assert.deepEqual(result.priority, [1, 2]);
  const all = feedback.analyzeWord(data, 9, [{letters: 'leaf', phoneIndices: [0, 1, 2], phones: ['l', 'iː', 'f']}]);
  assert.equal(all.groups[0].match_percent, 60, 'group score is 3/(3+2), not an average of phone percentages');
  assert.equal(all.groups[0].counts.inserted_phones, 2);
});

test('leading and inter-word insertions stay with the correct word and following phoneme', () => {
  const words = [{index: 4, text: 'hi', ipa: 'haɪ', phones: ['h', 'aɪ']}, leaf(9)];
  const data = makeAnalysis(words, ['h', 'aɪ', 'ə', 'l', 'iː', 'f']);
  assert.deepEqual(values(feedback.analyzeWord(data, 4)), [100, 100]);
  const result = feedback.analyzeWord(data, 9);
  assert.deepEqual(values(result), [50, 100, 100]);
  assert.deepEqual(result.phones[0].observed, ['ə', 'l']);
  const leading = feedback.analyzeWord(makeAnalysis([leaf()], ['ə', 'l', 'iː', 'f']), 9);
  assert.deepEqual(values(leading), [50, 100, 100]);
});

test('multi-phone groups aggregate real counts and silent letters receive no percentage', () => {
  const word = {index: 0, text: 'garden', ipa: 'ɡɑːɹdən', phones: ['ɡ', 'ɑː', 'ɹ', 'd', 'ə', 'n']};
  const data = makeAnalysis([word], ['ɡ', 'ɑː', 'ə', 'ɹ', 'd', 'ə', 'n']);
  const result = feedback.analyzeWord(data, 0, groupsFor(word));
  const ar = result.groups.find(group => group.letters === 'ar');
  assert.equal(ar.counts.reference_phones, 2);
  assert.equal(ar.counts.insert, 1);
  assert.equal(ar.match_percent, 66.7);
  const make = {index: 0, text: 'make', ipa: 'meɪk', phones: ['m', 'eɪ', 'k']};
  const silent = feedback.analyzeWord(makeAnalysis([make], make.phones), 0, groupsFor(make)).groups.at(-1);
  assert.equal(silent.letters, 'e');
  assert.equal(silent.status, 'silent');
  assert.equal(silent.match_percent, null); assert.equal(silent.counts, null);
});

test('a recording with no detected phones remains unassessed rather than scoring every deletion zero', () => {
  const result = feedback.analyzeWord(makeAnalysis([leaf()], []), 9, groupsFor(leaf()));
  assert.equal(result.available, false);
  assert.deepEqual(values(result), [null, null, null]);
  assert.ok(result.phones.every(phone => phone.status === 'unassessed' && phone.counts.delete === 1));
  assert.ok(result.groups.every(group => group.match_percent === null));
  assert.deepEqual(result.priority, []);
});

test('text references or missing acoustic provenance cannot obtain percentages from forged operations', () => {
  for (const change of [{audio_analyzed: false}, {audio_analyzed: undefined},
    {analysis_type: 'text_pronunciation_reference'}, {analysis_type: undefined}]) {
    const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
    Object.assign(data, change);
    const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
    assert.equal(result.available, false);
    assert.deepEqual(result.priority, []);
    assert.ok(result.phones.every(phone => phone.match_percent === null));
    assert.ok(result.groups.every(group => group.match_percent === null));
  }
});

test('missing per-phone operations leave only the missing slot unassessed', () => {
  const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  data.alignment.operations.splice(1, 1);
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(values(result), [100, null, 100]);
  assert.equal(result.phones[1].counts, null);
  assert.equal(result.groups[1].status, 'unassessed');
  assert.deepEqual(result.priority, []);
});

test('duplicate expected-index operations invalidate the affected slot instead of inflating a score', () => {
  const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  data.alignment.operations.splice(2, 0, clone(data.alignment.operations[1]));
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(values(result), [100, null, 100]);
  assert.equal(result.phones[1].counts, null);
  assert.equal(result.groups[1].match_percent, null);
});

test('unknown operation types and contradictory labels invalidate their own located slots', () => {
  for (const change of [{type: 'unknown'}, {expected: 'uː'}, {type: 'substitute'}]) {
    const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
    Object.assign(data.alignment.operations[1], change);
    assert.deepEqual(values(feedback.analyzeWord(data, 9)), [100, null, 100]);
  }
  const r = {index: 0, text: 'red', ipa: 'ɹɛd', phones: ['ɹ', 'ɛ', 'd']};
  const result = feedback.analyzeWord(makeAnalysis([r], ['r', 'ɛ', 'd']), 0);
  assert.equal(result.phones[0].match_percent, 0, '/r/ must not silently equal /ɹ/');
});

test('out-of-bounds or unlocated operations cannot manufacture an exact word score', () => {
  for (const change of [{expected_index: 99}, {expected_index: -1}, {expected_index: undefined}, {word_index: 999}]) {
    const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
    Object.assign(data.alignment.operations[1], change);
    const result = feedback.analyzeWord(data, 9);
    assert.equal(result.phones[1].match_percent, null);
    assert.ok(!values(result).every(value => value === 100));
  }
});

test('malformed data in another identified word does not discard complete selected-word evidence', () => {
  const words = [{index: 4, text: 'a', ipa: 'ə', phones: ['ə']}, leaf(9)];
  const data = makeAnalysis(words, ['ə', 'l', 'iː', 'f']);
  data.alignment.operations[0].expected_index = 99;
  assert.deepEqual(values(feedback.analyzeWord(data, 9)), [100, 100, 100]);
  assert.equal(feedback.analyzeWord(data, 4).available, false);
});

test('observed index reuse or an observation not present in the actual detected sequence is unassessed', () => {
  const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  data.alignment.operations[1].observed_index = 0;
  assert.deepEqual(values(feedback.analyzeWord(data, 9)), [null, null, 100]);
  const other = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  other.alignment.operations[1].observed = 'ɪ';
  assert.deepEqual(values(feedback.analyzeWord(other, 9)), [100, null, 100]);
});

test('bad group mappings remain unassessed without changing valid phone evidence', () => {
  const malformed = [
    {letters: 'ea', phoneIndices: [1, 1]},
    {letters: 'x', phoneIndices: [8]},
    {letters: 'ea', phoneIndices: [1], phones: ['uː']},
    {letters: 'f', phoneIndices: [2], silent: true},
    {letters: 'bad', phoneIndices: ['1']},
  ];
  const result = feedback.analyzeWord(makeAnalysis([leaf()], ['l', 'iː', 'f']), 9, malformed);
  assert.deepEqual(values(result), [100, 100, 100]);
  assert.ok(result.groups.every(group => group.status === 'unassessed' && group.match_percent === null));
  const overlap = feedback.analyzeWord(makeAnalysis([leaf()], ['l', 'iː', 'f']), 9,
    [{letters: 'e', phoneIndices: [1]}, {letters: 'a', phoneIndices: [1]}]);
  assert.ok(overlap.groups.every(group => group.match_percent === null));
});

test('single-phone practice projects only its original phone index and preserves the real API indices', () => {
  const practiced = {index: 0, text: 'leaf', ipa: 'iː', phones: ['iː']};
  const data = makeAnalysis([practiced], ['ɪ']);
  data.reference.reference_context = 'phone_in_word';
  data.reference.context = {text: 'a leaf', word_index: 9, phone_index: 1};
  const result = feedback.analyzeWord(data, 9, groupsFor(leaf()));
  assert.deepEqual(result.phones.map(phone => phone.phoneIndex), [0, 1, 2]);
  assert.deepEqual(values(result), [null, 0, null]);
  assert.deepEqual(result.priority, [1]);
  assert.equal(result.phones[1].expected, 'iː');
  assert.equal(result.phones[1].operations[0].expected_index, 0);
  assert.equal(result.phones[1].operations[0].word_index, 0);
  assert.deepEqual(result.groups.map(group => group.match_percent), [null, 0, null]);
  assert.deepEqual(values(feedback.analyzeWord(data, 0, groupsFor(leaf()))), [null, 0, null], 'the actual result word ID is also accepted');
  const sparse = feedback.analyzeWord(data, 9);
  assert.deepEqual(sparse.phones.map(phone => phone.phoneIndex), [1]);
  assert.equal(feedback.analyzeWord(data, 3, groupsFor(leaf())).available, false);
});

test('single-phone practice cannot grade an entire multi-phone grapheme from one observed target', () => {
  const practiced = {index: 0, text: 'garden', ipa: 'ɹ', phones: ['ɹ']};
  const data = makeAnalysis([practiced], ['ɹ']);
  data.reference.reference_context = 'phone_in_word';
  data.reference.context = {text: 'garden', word_index: 2, phone_index: 2};
  const groups = [{letters: 'ar', phoneIndices: [1, 2], phones: ['ɑː', 'ɹ']}];
  const result = feedback.analyzeWord(data, 2, groups);
  assert.deepEqual(values(result), [null, 100]);
  assert.equal(result.groups[0].match_percent, null);
});

test('word-in-sentence alias resolves the original word ID without changing word-local phone indices', () => {
  const data = makeAnalysis([leaf(0)], ['l', 'iː', 'f']);
  data.reference.reference_context = 'word_in_sentence';
  data.reference.context = {text: 'a leaf', word_index: 9};
  assert.deepEqual(values(feedback.analyzeWord(data, 9)), [100, 100, 100]);
  assert.deepEqual(feedback.analyzeWord(data, 9).phones.map(phone => phone.phoneIndex), [0, 1, 2]);
});

test('unsafe and missing inputs return unassessed data; strings remain text and nested output is detached', () => {
  for (const bad of [null, {}, {reference: {}}, {reference: {words: null}}]) assert.equal(feedback.analyzeWord(bad, 0).available, false);
  const data = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  assert.equal(feedback.analyzeWord(data, '9').available, false);
  const inherited = Object.create(data.alignment.operations[1]);
  data.alignment.operations[1] = inherited;
  assert.equal(feedback.analyzeWord(data, 9).phones[1].match_percent, null);
  const safe = makeAnalysis([leaf()], ['l', 'iː', 'f']);
  const groups = [{letters: '<img src=x onerror=alert(1)>', phoneIndices: [0], phones: ['l']}];
  const result = feedback.analyzeWord(safe, 9, groups);
  assert.equal(result.groups[0].letters, groups[0].letters, 'a pure data module does not generate HTML');
  result.groups[0].phoneIndices[0] = 99;
  result.phones[0].operations[0].expected = 'bad';
  assert.equal(groups[0].phoneIndices[0], 0);
  assert.equal(safe.alignment.operations[0].expected, 'l');
});
