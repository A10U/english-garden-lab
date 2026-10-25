'use strict';

// Behavioral fixtures mirror the model-free Python engine contract. No model,
// network, DOM, audio device, or generated target speech is needed for these.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../phonetic-alignment.js');

const word = (text, phones, index = 0) => ({ index, text, ipa: phones.join(''), phones });
const heard = phones => phones.map((phone, index) => ({
  phone, start: Number((index / 10).toFixed(2)), end: Number(((index + 1) / 10).toFixed(2))
}));

test('canonical phones remove only stress/tie conventions and ASCII-g while preserving actual contrasts', () => {
  assert.equal(P.canonical_phone('ˈg'), 'ɡ');
  assert.equal(P.canonical_phone('ˌt\u0361ʃ'), 'tʃ');
  assert.equal(P.canonical_phone('d\u035cʒ'), 'dʒ');
  assert.equal(P.canonical_phone('n\u0303'), 'ñ');
  for (const [a, b] of [['r', 'ɹ'], ['i', 'iː'], ['ɐ', 'ə'], ['ɪ', 'iː'], ['ɑ', 'ʌ']]) {
    assert.notEqual(P.canonical_phone(a), P.canonical_phone(b));
    const result = P.align_phone_sequences([word('contrast', [a])], heard([b]));
    assert.equal(result.operations[0].type, 'substitute');
  }
  assert.equal(P.align_phone_sequences([word('go', ['g'])], heard(['ɡ'])).summary.match_percent, 100);
});

test('CTC decoding collapses runs but preserves repeated units separated by blank and clips final intervals', () => {
  const result = P.decode_ctc_segments([0, 4, 4, 0, 4, 5, 5, 1],
    { 0: '<pad>', 1: '<s>', 4: 't', 5: 'tʃ' },
    { blank_id: 0, duration_seconds: 0.15, frame_seconds: 0.02 });
  assert.deepEqual(result, [
    { phone: 't', start: 0.02, end: 0.06 },
    { phone: 't', start: 0.08, end: 0.1 },
    { phone: 'tʃ', start: 0.1, end: 0.14 }
  ]);
  const clipped = P.decodeCTCSegments(new Int32Array([4, 4, 5, 5]), new Map([[4, 'ɑːɹ'], [5, 'dʒ']]),
    { blankId: 0, durationSeconds: 0.065, frameSeconds: 0.02 });
  assert.deepEqual(clipped, [{ phone: 'ɑːɹ', start: 0, end: 0.04 }, { phone: 'dʒ', start: 0.04, end: 0.065 }]);
});

test('CTC ignores inventory separators, unknowns and special tokens without merging separated identical phones', () => {
  const result = P.decode_ctc_segments(new BigInt64Array([4n, 4n, 8n, 4n, 99n, 7n, 3n, 5n]),
    { 0: '<pad>', 3: '<unk>', 4: 't', 5: 'ɑːɹ', 7: ' ', 8: '|' },
    { blank_id: 0, duration_seconds: 1, frame_seconds: 0.02 });
  assert.deepEqual(result.map(item => item.phone), ['t', 't', 'ɑːɹ']);
  assert.equal(result[1].start, 0.06);
  assert.equal(result[2].start, 0.14);
  assert.deepEqual(P.decodeCTCSegments([], {}, { blankId: 0, durationSeconds: 1, frameSeconds: 0.02 }), []);
});

test('CTC rejects invalid timing and malformed IDs rather than manufacturing timestamps', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => P.decodeCTCSegments([4], { 4: 't' }, { blankId: 0, durationSeconds: value, frameSeconds: 0.02 }), RangeError);
    assert.throws(() => P.decodeCTCSegments([4], { 4: 't' }, { blankId: 0, durationSeconds: 1, frameSeconds: value }), RangeError);
  }
  assert.throws(() => P.decodeCTCSegments([NaN], {}, { blankId: 0, durationSeconds: 1, frameSeconds: 0.02 }), TypeError);
  assert.throws(() => P.decodeCTCSegments([1.5], {}, { blankId: 0, durationSeconds: 1, frameSeconds: 0.02 }), TypeError);
});

test('minimal vowel contrast produces the exact operation, word difference and phone-count percentage shape', () => {
  const result = P.align_phone_sequences([word('ship', ['ʃ', 'ɪ', 'p'])], heard(['ʃ', 'iː', 'p']));
  assert.deepEqual(result.operations, [
    { type: 'match', expected: 'ʃ', observed: 'ʃ', expected_index: 0, observed_index: 0, word_index: 0, start: 0, end: 0.1 },
    { type: 'substitute', expected: 'ɪ', observed: 'iː', expected_index: 1, observed_index: 1, word_index: 0, start: 0.1, end: 0.2 },
    { type: 'match', expected: 'p', observed: 'p', expected_index: 2, observed_index: 2, word_index: 0, start: 0.2, end: 0.3 }
  ]);
  assert.deepEqual(result.words[0], {
    index: 0, text: 'ship', ipa: 'ʃɪp', status: 'difference', start: 0, end: 0.3,
    differences: [{ type: 'substitute', expected: 'ɪ', observed: 'iː', start: 0.1, end: 0.2 }],
    match_percent: 66.7, matched_phones: 2, reference_phones: 3, inserted_phones: 0,
    substituted_phones: 1, deleted_phones: 0, compared_phones: 3
  });
  assert.equal(result.summary.metric, 'phone_agreement');
  assert.equal(result.summary.calibrated_pronunciation_grade, false);
});

test('affricates and long rhotic units each count once rather than as Unicode characters', () => {
  const result = P.align_phone_sequences([word('chair', ['tʃ', 'ɑːɹ'])], heard(['t͡ʃ', 'ɑːɹ']));
  assert.equal(result.operations.length, 2);
  assert.equal(result.words[0].status, 'matched');
  assert.equal(result.summary.reference_phones, 2);
  assert.equal(result.summary.match_percent, 100);
});

test('insertions between words attach to the following word and trailing insertions to the last word', () => {
  const result = P.align_phone_sequences([word('one', ['a'], 5), word('two', ['b'], 11)], heard(['a', 'x', 'b', 'y']));
  assert.deepEqual(result.operations.filter(op => op.type === 'insert').map(op => ({ word: op.word_index, observed: op.observed })),
    [{ word: 11, observed: 'x' }, { word: 11, observed: 'y' }]);
  assert.equal(result.words[0].match_percent, 100);
  assert.equal(result.words[1].match_percent, 33.3);
  assert.equal(result.summary.match_percent, 50);
  assert.equal(result.summary.compared_phones, 4);
});

test('deleted words have no fabricated acoustic times and overall agreement weights phone counts', () => {
  const missing = P.align_phone_sequences([word('we', ['w', 'iː']), word('go', ['ɡ', 'oʊ'], 1)], heard(['w', 'iː']));
  assert.equal(missing.words[1].status, 'difference');
  assert.equal(missing.words[1].start, null); assert.equal(missing.words[1].end, null);
  assert.equal(missing.words[1].match_percent, 0);
  assert.ok(missing.words[1].differences.every(item => item.type === 'delete' && item.start === null && item.end === null));
  assert.equal(missing.summary.match_percent, 50);
  const uneven = P.alignPhoneSequences([word('I', ['aɪ']), word('cat', ['k', 'æ', 't'], 1)], heard(['aɪ', 'k', 'ɛ', 't']));
  assert.equal(uneven.summary.match_percent, 75);
  assert.notEqual(uneven.summary.match_percent, (uneven.words[0].match_percent + uneven.words[1].match_percent) / 2);
});

test('absent observations remain unassessed and a missing reference has no invented word provenance', () => {
  const absent = P.align_phone_sequences([word('chair', ['tʃ', 'ɑːɹ'])], []);
  assert.equal(absent.words[0].status, 'unresolved');
  assert.equal(absent.words[0].match_percent, null);
  assert.equal(absent.summary.match_percent, null);
  const noReference = P.alignPhoneSequences([], heard(['h']));
  assert.equal(noReference.operations[0].word_index, null);
  assert.equal(noReference.summary.match_percent, null);
  assert.equal(noReference.summary.inserted_phones, 1);
});

test('alignment tie breaking and half-even percentage rounding agree with Python', () => {
  const tied = P.alignPhoneSequences([word('tie', ['a', 'b'])], heard(['b', 'a']));
  assert.deepEqual(tied.operations.map(op => op.type), ['substitute', 'substitute']);
  const operations = matched => Array.from({ length: 16 }, (_, i) => ({ type: i < matched ? 'match' : 'delete' }));
  assert.equal(P.phone_match_summary(operations(1), 16, { observed_available: true }).match_percent, 6.2);
  assert.equal(P.phoneMatchSummary(operations(3), 16, { observedAvailable: true }).match_percent, 18.8);
  assert.equal(P.phoneMatchSummary(operations(16), 16, false).match_percent, null);
});

test('waveform metrics count actual tail samples and finite 16 kHz energy without mutating input', () => {
  const signal = Float32Array.from({ length: 16000 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * i / 16000));
  const before = signal.slice();
  const [audio, metrics] = P.waveform_metrics(signal);
  assert.notEqual(audio, signal); assert.deepEqual(signal, before);
  assert.deepEqual(metrics, { duration_seconds: 1, rms_dbfs: -23.01, voiced_seconds: 1 });
  const [, tail] = P.waveformMetrics(new Float32Array(4880).fill(0.05));
  assert.deepEqual(tail, { duration_seconds: 0.305, rms_dbfs: -26.021, voiced_seconds: 0.305 });
  assert.equal(P.waveformMetrics(new Float32Array(240000).fill(0.05))[1].duration_seconds, 15);
});

test('silence, corrupt dimensions, nonfinite samples and invalid or insufficient voiced durations reject before inference', () => {
  for (const bad of [new Float32Array(16000), new Float32Array(16000).fill(1e-6),
    new Float32Array(4799).fill(0.1), new Float32Array(240001).fill(0.1),
    new Float32Array(16000).fill(NaN), new Float32Array(16000).fill(Infinity), [[0.1], [0.2]], ['0.1']]) {
    assert.throws(() => P.waveformMetrics(bad), P.AnalysisError);
  }
  const tooLittleSpeech = new Float32Array(4800); tooLittleSpeech.fill(0.1, 0, 1600);
  assert.throws(() => P.waveformMetrics(tooLittleSpeech), /ช่วงเสียงพูดสั้น/);
});

test('Wav2Vec2 normalization removes mean and uses population variance without creating signal from constants', () => {
  const input = new Float32Array([1, 2, 3, 4]), before = input.slice();
  const normalized = P.normalizeWaveform(input);
  assert.deepEqual(input, before);
  assert.ok(normalized instanceof Float32Array);
  const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  const variance = normalized.reduce((a, b) => a + b * b, 0) / normalized.length;
  assert.ok(Math.abs(mean) < 1e-7);
  assert.ok(Math.abs(variance - 1) < 1e-6);
  assert.ok(Math.abs(normalized[0] + 1.3416407) < 1e-6);
  assert.ok(P.normalizeWaveform(new Float32Array(100).fill(0.05)).every(value => value === 0));
  assert.ok(P.normalizeWaveform(new Float32Array(100)).every(value => value === 0));
  // The original energy check permits DC energy, but normalization does not
  // invent variance. A recognizer that emits no phones must still be rejected.
  const [constant] = P.waveformMetrics(new Float32Array(16000).fill(0.05));
  assert.ok(P.normalizeWaveform(constant).every(value => value === 0));
  assert.throws(() => P.waveformMetrics(new Float32Array(16000)), P.AnalysisError);
  assert.throws(() => P.normalizeWaveform(new Float32Array(0)), TypeError);
  assert.throws(() => P.normalizeWaveform([NaN]), TypeError);
});

test('full analysis keeps independent observed phones and supports live metadata without inventing model confidence', () => {
  const reference = { text: 'ship', accent: 'en-us', ipa: 'ʃˈɪp', words: [word('ship', ['ʃ', 'ɪ', 'p'])], audio_analyzed: false };
  const phones = heard(['ʃ', 'iː', 'p']), metrics = { duration_seconds: 1, rms_dbfs: -20, voiced_seconds: 0.8 };
  const result = { ...P.composeAnalysis(reference, phones, metrics), precomputed: false, live_analysis: true, playback_source: 'learner_recording' };
  assert.deepEqual(result.observed, { ipa: 'ʃ iː p', phones, duration_seconds: 1 });
  assert.notEqual(result.observed.ipa, reference.ipa);
  assert.equal(result.alignment.words[0].status, 'difference');
  assert.equal(result.analysis_type, 'acoustic_phone_comparison');
  assert.equal(result.audio_analyzed, true);
  assert.equal(result.precomputed, false);
  assert.equal(result.live_analysis, true);
  assert.equal('score' in result, false); assert.equal('confidence' in result, false);
  assert.throws(() => P.composeAnalysis(reference, [], metrics), P.AnalysisError);
  assert.throws(() => P.composeAnalysis(reference, phones, { duration_seconds: NaN }), TypeError);
});

test('alignment leaves frozen caller data intact and browser global exports need no browser services', () => {
  const reference = Object.freeze([Object.freeze({ ...word('go', Object.freeze(['g', 'oʊ'])) })]);
  const observed = Object.freeze(heard(['ɡ', 'oʊ']).map(Object.freeze));
  const result = P.alignPhoneSequences(reference, observed);
  assert.equal(result.summary.match_percent, 100);
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../phonetic-alignment.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.EGLPhoneticAlignment.normalizeWaveform, 'function');
  assert.equal(sandbox.EGLPhoneticAlignment.canonical_phone('ˈg'), 'ɡ');
  assert.ok(Object.isFrozen(sandbox.EGLPhoneticAlignment));
  assert.equal(P.canonicalPhone, P.canonical_phone);
  assert.equal(P.alignPhoneSequences, P.align_phone_sequences);
});
