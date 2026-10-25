/* Model-independent phonetic comparison, ported from phonetic_engine.py.
 * No network, microphone, model loading, or text-to-speech takes place here. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLPhoneticAlignment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAMPLE_RATE = 16000;
  const LIMITATIONS = Object.freeze([
    'เสียงที่แสดงเป็นหน่วยเสียงที่โมเดลคาดจากไฟล์เสียง อาจตรวจผิดหรือข้ามเสียงได้',
    'เวลาแต่ละหน่วยเสียงประมาณจากเฟรม CTC ไม่ใช่ขอบเขตเสียงที่ผู้เชี่ยวชาญกำกับ',
    'IPA จากข้อความเป็นเสียงอ้างอิงตามกฎ ไม่ครอบคลุมทุกสำเนียง การลดรูป หรือชื่อเฉพาะ',
    'ความต่างระหว่างหน่วยเสียงไม่ใช่คะแนนการออกเสียง และไม่ได้ตัดสินว่าเป็นสำเนียงเจ้าของภาษา',
    'ช่วงที่มีเสียงคำนวณจากพลังงานอย่างง่าย จึงอาจรวมเสียงรบกวนด้วย'
  ]);

  class AnalysisError extends Error {
    constructor(message) { super(message); this.name = 'AnalysisError'; }
  }

  // Python round(number, digits) uses nearest/even on the actual binary64
  // value. Scaling and Math.round would incorrectly turn 6.25% into 6.3%.
  function roundDecimal(value, digits) {
    if (!Number.isFinite(value)) throw new RangeError('Cannot round a nonfinite number');
    if (value === 0) return value;
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setFloat64(0, Math.abs(value), false);
    const high = bytes.getUint32(0, false), low = bytes.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent) mantissa |= 1n << 52n;
    const binaryPower = exponent ? exponent - 1023 - 52 : -1074;
    let numerator = mantissa * (10n ** BigInt(digits)), denominator = 1n;
    if (binaryPower >= 0) numerator <<= BigInt(binaryPower);
    else denominator <<= BigInt(-binaryPower);
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n)) quotient++;
    return (value < 0 ? -1 : 1) * Number(quotient) / (10 ** digits);
  }

  function canonicalPhone(phone) {
    if (typeof phone !== 'string') throw new TypeError('A phone must be a string');
    return phone.normalize('NFC').replace(/[ˈˌ\u0361\u035c]/gu, '').replace(/g/gu, 'ɡ');
  }

  function numericSequence(value) {
    return Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
  }

  function decodeCTCSegments(tokenIds, idToToken, options) {
    options = options || {};
    const blankId = options.blank_id ?? options.blankId;
    const duration = options.duration_seconds ?? options.durationSeconds;
    const frame = options.frame_seconds ?? options.frameSeconds;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frame) || frame <= 0) {
      throw new RangeError('duration_seconds and frame_seconds must be positive finite numbers');
    }
    if (!Number.isSafeInteger(blankId)) throw new TypeError('blank_id must be an integer');
    if (!numericSequence(tokenIds)) throw new TypeError('token_ids must be an array or typed array');
    if (!(idToToken instanceof Map) && (!idToToken || typeof idToToken !== 'object')) {
      throw new TypeError('id_to_token must be an object or Map');
    }
    const ids = Array.from(tokenIds, value => {
      if (typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError('Token IDs must be integers');
      const id = Number(value);
      if (!Number.isSafeInteger(id)) throw new TypeError('Token IDs must be safe integers');
      return id;
    });
    const phones = [];
    for (let first = 0; first < ids.length;) {
      const id = ids[first]; let endFrame = first + 1;
      while (endFrame < ids.length && ids[endFrame] === id) endFrame++;
      const token = idToToken instanceof Map ? idToToken.get(id)
        : Object.prototype.hasOwnProperty.call(idToToken, id) ? idToToken[id] : undefined;
      const phone = token === undefined ? '<unk>' : token;
      if (typeof phone !== 'string') throw new TypeError('Vocabulary entries must be strings');
      if (id !== blankId && phone.trim() && phone !== '|' && !(phone.startsWith('<') && phone.endsWith('>'))) {
        const start = Math.max(0, Math.min(first * frame, duration));
        const end = Math.max(0, Math.min(endFrame * frame, duration));
        if (end > start) phones.push({ phone, start: roundDecimal(start, 6), end: roundDecimal(end, 6) });
      }
      first = endFrame;
    }
    return phones;
  }

  function phoneMatchSummary(operations, referenceCount, options) {
    if (!Array.isArray(operations) || !Number.isSafeInteger(referenceCount) || referenceCount < 0) {
      throw new TypeError('Expected operations and a nonnegative reference phone count');
    }
    const available = typeof options === 'boolean' ? options
      : Boolean(options && (options.observed_available ?? options.observedAvailable));
    const counts = { match: 0, substitute: 0, delete: 0, insert: 0 };
    for (const operation of operations) if (Object.prototype.hasOwnProperty.call(counts, operation.type)) counts[operation.type]++;
    const denominator = referenceCount + counts.insert;
    return {
      match_percent: referenceCount > 0 && denominator > 0 && available
        ? roundDecimal(100 * counts.match / denominator, 1) : null,
      matched_phones: counts.match, reference_phones: referenceCount,
      inserted_phones: counts.insert, substituted_phones: counts.substitute,
      deleted_phones: counts.delete, compared_phones: denominator
    };
  }

  function validateWords(words) {
    if (!Array.isArray(words)) throw new TypeError('reference_words must be an array');
    for (const word of words) {
      if (!word || !Number.isSafeInteger(word.index) || word.index < 0 || typeof word.text !== 'string'
        || typeof word.ipa !== 'string' || !Array.isArray(word.phones)) throw new TypeError('Invalid reference word');
      word.phones.forEach(canonicalPhone);
    }
  }

  function validateObserved(observed) {
    if (!Array.isArray(observed)) throw new TypeError('observed must be an array');
    for (const item of observed) {
      if (!item || typeof item.phone !== 'string' || !Number.isFinite(item.start) || !Number.isFinite(item.end)
        || item.start < 0 || item.end < item.start) throw new TypeError('Invalid observed phone interval');
    }
  }

  function alignPhoneSequences(referenceWords, observed) {
    validateWords(referenceWords); validateObserved(observed);
    const expected = [], wordIndices = [];
    for (const word of referenceWords) for (const phone of word.phones) {
      expected.push(phone); wordIndices.push(word.index);
    }
    const heard = observed.map(item => item.phone);
    const a = expected.map(canonicalPhone), b = heard.map(canonicalPhone);
    const rows = a.length, cols = b.length;
    const costs = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = 0; i <= rows; i++) costs[i][0] = i;
    for (let j = 0; j <= cols; j++) costs[0][j] = j;
    for (let i = 1; i <= rows; i++) for (let j = 1; j <= cols; j++) {
      costs[i][j] = Math.min(costs[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
        costs[i - 1][j] + 1, costs[i][j - 1] + 1);
    }
    const operations = []; let i = rows, j = cols;
    while (i || j) {
      let operation;
      // Match the Python diagonal-first tie break, including substitutions.
      if (i && j && costs[i][j] === costs[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
        i--; j--;
        operation = { type: a[i] === b[j] ? 'match' : 'substitute', expected: expected[i], observed: heard[j],
          expected_index: i, observed_index: j, word_index: wordIndices[i], start: observed[j].start, end: observed[j].end };
      } else if (i && costs[i][j] === costs[i - 1][j] + 1) {
        i--;
        operation = { type: 'delete', expected: expected[i], observed: null, expected_index: i,
          observed_index: null, word_index: wordIndices[i], start: null, end: null };
      } else {
        j--;
        operation = { type: 'insert', expected: null, observed: heard[j], expected_index: null, observed_index: j,
          word_index: rows ? wordIndices[Math.min(i, rows - 1)] : null, start: observed[j].start, end: observed[j].end };
      }
      operations.push(operation);
    }
    operations.reverse();
    const words = referenceWords.map(word => {
      const relevant = operations.filter(operation => operation.word_index === word.index);
      const times = relevant.filter(operation => operation.start !== null);
      const differences = relevant.filter(operation => operation.type !== 'match').map(operation => ({
        type: operation.type, expected: operation.expected, observed: operation.observed, start: operation.start, end: operation.end
      }));
      return {
        index: word.index, text: word.text, ipa: word.ipa,
        status: !word.phones.length || !observed.length ? 'unresolved' : differences.length ? 'difference' : 'matched',
        start: times.length ? Math.min(...times.map(operation => operation.start)) : null,
        end: times.length ? Math.max(...times.map(operation => operation.end)) : null,
        differences, ...phoneMatchSummary(relevant, word.phones.length, Boolean(observed.length))
      };
    });
    const summary = {
      ...phoneMatchSummary(operations, rows, Boolean(observed.length)),
      formula: '100 * matched_phones / (reference_phones + inserted_phones)',
      description: 'เปอร์เซ็นต์หน่วยเสียงที่จับคู่กับอ้างอิงได้ รวมเสียงที่เพิ่มเข้ามาในการนับ ไม่ใช่คะแนนความสามารถหรือความมั่นใจของโมเดล',
      metric: 'phone_agreement', calibrated_pronunciation_grade: false
    };
    return { words, operations, summary };
  }

  function waveformMetrics(waveform) {
    if (!numericSequence(waveform)) throw new AnalysisError('เสียงต้องเป็นโมโนและไม่มีค่าตัวอย่างเสียงที่เสียหาย');
    const audio = new Float32Array(waveform.length);
    let sum = 0, peak = 0;
    for (let i = 0; i < waveform.length; i++) {
      if (typeof waveform[i] !== 'number') throw new AnalysisError('เสียงต้องเป็นโมโนและไม่มีค่าตัวอย่างเสียงที่เสียหาย');
      audio[i] = waveform[i];
      if (!Number.isFinite(audio[i])) throw new AnalysisError('เสียงต้องเป็นโมโนและไม่มีค่าตัวอย่างเสียงที่เสียหาย');
      sum += audio[i] * audio[i]; peak = Math.max(peak, Math.abs(audio[i]));
    }
    const duration = audio.length / SAMPLE_RATE;
    if (duration < 0.3 || duration > 15) throw new AnalysisError('กรุณาใช้เสียงยาวระหว่าง 0.3 ถึง 15 วินาที');
    const rms = Math.sqrt(sum / audio.length), rmsDbfs = 20 * Math.log10(Math.max(rms, 1e-12));
    if (rmsDbfs < -55 || peak < 1e-4) throw new AnalysisError('เสียงเงียบหรือเบาเกินไป กรุณาพูดให้ชัดและลองใหม่');
    const threshold = 10 ** (Math.max(-45, rmsDbfs - 16) / 20);
    let activeSamples = 0;
    for (let start = 0; start < audio.length; start += 320) {
      const end = Math.min(start + 320, audio.length); let energy = 0;
      for (let position = start; position < end; position++) energy += audio[position] * audio[position];
      if (Math.sqrt(energy / (end - start)) >= threshold) activeSamples += end - start;
    }
    if (activeSamples / SAMPLE_RATE < 0.12) throw new AnalysisError('ช่วงเสียงพูดสั้นหรือเบาเกินไป กรุณาบันทึกใหม่');
    return [audio, { duration_seconds: roundDecimal(duration, 6), rms_dbfs: roundDecimal(rmsDbfs, 3),
      voiced_seconds: roundDecimal(activeSamples / SAMPLE_RATE, 6) }];
  }

  function normalizeWaveform(waveform) {
    // Wav2Vec2FeatureExtractor: center each complete utterance and divide by
    // sqrt(population variance + 1e-7). Validate audibility with waveformMetrics
    // before calling this helper; normalization cannot turn silence into speech.
    if (!numericSequence(waveform) || !waveform.length) throw new TypeError('A nonempty mono waveform is required');
    const audio = new Float32Array(waveform.length); let sum = 0;
    for (let i = 0; i < waveform.length; i++) {
      if (typeof waveform[i] !== 'number') throw new TypeError('Waveform samples must be finite numbers');
      audio[i] = waveform[i];
      if (!Number.isFinite(audio[i])) throw new TypeError('Waveform samples must be finite numbers');
      sum += audio[i];
    }
    const mean = Math.fround(sum / audio.length); let squares = 0;
    for (const sample of audio) { const centered = Math.fround(sample - mean); squares += Math.fround(centered * centered); }
    const variance = Math.fround(squares / audio.length);
    const scale = Math.fround(Math.sqrt(Math.fround(variance + 1e-7)));
    const output = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) output[i] = Math.fround(audio[i] - mean) / scale;
    return output;
  }

  function composeAnalysis(reference, observed, metrics) {
    if (!reference || !Array.isArray(reference.words)) throw new TypeError('A text pronunciation reference is required');
    validateObserved(observed);
    if (!observed.length) throw new AnalysisError('โมเดลยังตรวจไม่พบหน่วยเสียง กรุณาพูดให้ชัดและลองใหม่');
    if (!metrics || !Number.isFinite(metrics.duration_seconds) || metrics.duration_seconds <= 0) {
      throw new TypeError('Validated audio metrics are required');
    }
    const phones = observed.map(item => ({ ...item }));
    return { reference, observed: { ipa: phones.map(item => item.phone).join(' '), phones,
      duration_seconds: metrics.duration_seconds }, alignment: alignPhoneSequences(reference.words, phones),
    metrics: { ...metrics }, analysis_type: 'acoustic_phone_comparison', audio_analyzed: true, limitations: [...LIMITATIONS] };
  }

  return Object.freeze({
    SAMPLE_RATE, LIMITATIONS, AnalysisError,
    canonical_phone: canonicalPhone, canonicalPhone,
    decode_ctc_segments: decodeCTCSegments, decodeCTCSegments,
    phone_match_summary: phoneMatchSummary, phoneMatchSummary,
    align_phone_sequences: alignPhoneSequences, alignPhoneSequences,
    waveform_metrics: waveformMetrics, waveformMetrics,
    normalizeWaveform, composeAnalysis
  });
});
