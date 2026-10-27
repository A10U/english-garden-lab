/* Project real acoustic alignment operations onto word-local phone indices and
 * checked spelling groups. No acoustic inference, spelling guesses or confidence
 * scores are generated here. Missing or ambiguous data stays unassessed.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLSpellingFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TYPES = new Set(['match', 'substitute', 'delete', 'insert']);
  const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const index = value => Number.isSafeInteger(value) && value >= 0;
  const phone = value => typeof value === 'string' && value.length > 0 && value.length <= 64 && value.trim() === value;
  // Keep /r/ and /ɹ/, vowel qualities and length distinct, as the actual aligner
  // does. Only stress, tie bars and the two g glyphs are normalized.
  const canonical = value => value.normalize('NFC').replace(/[ˈˌ\u0361\u035c]/g, '').replace(/g/g, 'ɡ');
  const same = (a, b) => phone(a) && phone(b) && canonical(a) === canonical(b);
  const baseNote = 'เปอร์เซ็นต์ = เสียงที่จับคู่ตรง ÷ (เสียงอ้างอิง + เสียงเพิ่ม) × 100 เป็นผลการจับคู่หน่วยเสียง ไม่ใช่คะแนนความสามารถ';

  function copy(value, depth) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if ((depth || 0) > 12) return null;
    if (Array.isArray(value)) return value.map(item => copy(item, (depth || 0) + 1));
    if (!record(value)) return null;
    const result = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.enumerable && own(descriptor, 'value')) {
        Object.defineProperty(result, key, {value: copy(descriptor.value, (depth || 0) + 1), enumerable: true, writable: true, configurable: true});
      }
    }
    return result;
  }
  function count(operations, referenceCount) {
    const value = {match: 0, substitute: 0, delete: 0, insert: 0};
    operations.forEach(operation => { value[operation.type]++; });
    return {...value, matched_phones: value.match, reference_phones: referenceCount,
      inserted_phones: value.insert, substituted_phones: value.substitute,
      deleted_phones: value.delete, compared_phones: referenceCount + value.insert};
  }
  function status(counts, assessed) {
    if (!assessed) return 'unassessed';
    const differences = ['delete', 'substitute', 'insert'].filter(kind => counts[kind] > 0);
    return differences.length > 1 ? 'mixed' : differences[0] || 'matched';
  }
  function percent(counts, assessed) {
    return assessed && counts.compared_phones > 0
      ? Math.round(1000 * counts.match / counts.compared_phones) / 10 : null;
  }
  function empty(groups, note) {
    return {phones: [], groups: (Array.isArray(groups) ? groups : []).map(group => ({
      ...(record(group) ? copy(group) : {}), counts: null, match_percent: null,
      status: record(group) && Array.isArray(group.phoneIndices) && group.phoneIndices.length === 0 ? 'silent' : 'unassessed'
    })), priority: [], available: false, note: note || 'ยังไม่มีข้อมูลจับคู่เสียงที่ครบ จึงยังให้เปอร์เซ็นต์รายส่วนไม่ได้'};
  }
  function checkedGroup(group) {
    return record(group) && own(group, 'phoneIndices') && Array.isArray(group.phoneIndices)
      && group.phoneIndices.every(value => index(value) && value < 4096)
      && new Set(group.phoneIndices).size === group.phoneIndices.length
      && !(group.silent === true && group.phoneIndices.length > 0);
  }

  function analyzeWord(analysis, referenceWordIndex, groups) {
    const suppliedGroups = Array.isArray(groups) ? groups : [];
    if (record(analysis) && record(analysis.recognition_quality) && analysis.recognition_quality.status === 'uncertain') {
      return empty(suppliedGroups, 'ระบบยังแยกหน่วยเสียงได้ไม่มั่นคง จึงยังให้เปอร์เซ็นต์หรือระบุส่วนที่ออกเสียงผิดไม่ได้');
    }
    if (!record(analysis) || analysis.audio_analyzed !== true || analysis.analysis_type !== 'acoustic_phone_comparison'
      || !index(referenceWordIndex) || !record(analysis.reference)
      || !Array.isArray(analysis.reference.words)) return empty(suppliedGroups);
    const reference = analysis.reference, words = reference.words;
    const flat = [], wordIds = new Set();
    for (const word of words) {
      if (!record(word) || !own(word, 'index') || !index(word.index) || wordIds.has(word.index)
        || !own(word, 'phones') || !Array.isArray(word.phones) || word.phones.some(value => !phone(value))) {
        return empty(suppliedGroups, 'คำอ่านอ้างอิงไม่ครบหรือดัชนีคำซ้ำ จึงยังจับคู่เปอร์เซ็นต์รายเสียงไม่ได้');
      }
      wordIds.add(word.index);
      word.phones.forEach((expected, phoneIndex) => flat.push({wordIndex: word.index, phoneIndex, expected}));
    }
    if (flat.length > 4096) return empty(suppliedGroups);
    const context = record(reference.context) ? reference.context : record(analysis.context) ? analysis.context : null;
    const single = reference.reference_context === 'phone_in_word' || context && own(context, 'phone_index');
    let word = words.find(item => item.index === referenceWordIndex);
    if (!word && context && index(context.word_index) && context.word_index === referenceWordIndex && words.length === 1) word = words[0];
    if (!word) return empty(suppliedGroups, 'ไม่พบคำที่เลือกในคำอ่านอ้างอิงของผลเสียงนี้');
    if (single && (!context || !index(context.word_index) || !index(context.phone_index)
      || context.phone_index >= 4096 || words.length !== 1 || word.phones.length !== 1)) return empty(suppliedGroups);

    const selectedFlat = flat.map((entry, expectedIndex) => ({...entry, expectedIndex})).filter(entry => entry.wordIndex === word.index);
    const projected = new Map();
    if (single) {
      // Original checked groups provide the other original slots. They receive
      // no score from a recording that practiced only one phone.
      for (const group of suppliedGroups) if (checkedGroup(group) && Array.isArray(group.phones) && group.phones.length === group.phoneIndices.length) {
        group.phoneIndices.forEach((at, offset) => { if (phone(group.phones[offset]) && !projected.has(at)) projected.set(at, group.phones[offset]); });
      }
      projected.set(context.phone_index, word.phones[0]);
    } else word.phones.forEach((expected, at) => projected.set(at, expected));

    const operations = record(analysis.alignment) && Array.isArray(analysis.alignment.operations) ? analysis.alignment.operations : null;
    const observed = record(analysis.observed) && Array.isArray(analysis.observed.phones) ? analysis.observed.phones : [];
    const heard = observed.map(value => typeof value === 'string' ? value : record(value) ? value.phone : null);
    const observedAvailable = heard.length > 0 && heard.every(phone);
    const buckets = new Map(selectedFlat.map(entry => [entry.expectedIndex, []]));
    const invalid = new Set(), consumed = new Map(), heardOwners = new Map();
    let wholeWordInvalid = operations === null;

    function damage(operation, assignedAt) {
      if (!record(operation)) { wholeWordInvalid = true; return; }
      const at = operation.type === 'insert' && index(assignedAt) ? assignedAt : operation.expected_index;
      const located = index(at) && flat[at];
      if (located && located.wordIndex === word.index) invalid.add(at);
      if (operation.word_index === word.index && (!located || located.wordIndex !== word.index)) wholeWordInvalid = true;
      if (!located && !wordIds.has(operation.word_index)) wholeWordInvalid = true;
    }
    function ownerForInsertion(position, operation) {
      // Insertions belong to the following expected phone WITHIN this word.
      // With no following phone they belong to this word's final phone.
      for (let next = position + 1; next < operations.length; next++) {
        const candidate = operations[next];
        if (record(candidate) && candidate.type !== 'insert' && index(candidate.expected_index)
          && flat[candidate.expected_index] && flat[candidate.expected_index].wordIndex === operation.word_index) return candidate.expected_index;
      }
      for (let at = flat.length - 1; at >= 0; at--) if (flat[at].wordIndex === operation.word_index) return at;
      return null;
    }

    if (operations) {
      let previousExpected = -1, previousOperation = null;
      operations.forEach((operation, position) => {
        if (!record(operation) || !own(operation, 'type') || !TYPES.has(operation.type)
          || !own(operation, 'word_index') || !index(operation.word_index) || !wordIds.has(operation.word_index)) {
          damage(operation); return;
        }
        const insertion = operation.type === 'insert';
        const at = insertion ? ownerForInsertion(position, operation) : operation.expected_index;
        const location = index(at) && flat[at];
        let valid = Boolean(location && location.wordIndex === operation.word_index);
        valid = valid && own(operation, 'expected_index') && own(operation, 'expected') && own(operation, 'observed') && own(operation, 'observed_index');
        if (insertion) valid = valid && operation.expected_index === null && operation.expected === null;
        else {
          valid = valid && index(operation.expected_index) && same(operation.expected, location && location.expected);
          if (index(operation.expected_index)) {
            if (consumed.has(operation.expected_index)) {
              damage(consumed.get(operation.expected_index)); damage(operation); valid = false;
            } else consumed.set(operation.expected_index, operation);
            if (location) {
              if (operation.expected_index < previousExpected) { damage(operation); damage(previousOperation); valid = false; }
              previousExpected = operation.expected_index; previousOperation = operation;
            }
          }
        }
        if (operation.type === 'delete') valid = valid && operation.observed === null && operation.observed_index === null;
        else {
          valid = valid && phone(operation.observed) && index(operation.observed_index)
            && operation.observed_index < heard.length && same(operation.observed, heard[operation.observed_index]);
          if (operation.type === 'match') valid = valid && same(operation.expected, operation.observed);
          if (operation.type === 'substitute') valid = valid && !same(operation.expected, operation.observed);
          if (index(operation.observed_index)) {
            if (heardOwners.has(operation.observed_index)) {
              const previous = heardOwners.get(operation.observed_index);
              if (buckets.has(previous)) invalid.add(previous);
              if (buckets.has(at)) invalid.add(at);
              valid = false;
            } else heardOwners.set(operation.observed_index, at);
          }
        }
        if (buckets.has(at)) buckets.get(at).push({operation, position});
        if (!valid) {
          if (buckets.has(at)) invalid.add(at);
          damage(operation, at);
        }
      });
    }

    const resultPhones = [...projected].sort(([a], [b]) => a - b).map(([phoneIndex, expected]) => {
      const selected = single ? phoneIndex === context.phone_index : true;
      const actual = selected ? selectedFlat[single ? 0 : phoneIndex] : null;
      const assigned = actual ? buckets.get(actual.expectedIndex) || [] : [];
      const raw = assigned.map(entry => entry.operation);
      const consuming = raw.filter(operation => operation.type !== 'insert');
      const complete = actual && !wholeWordInvalid && !invalid.has(actual.expectedIndex)
        && consuming.length === 1 && same(consuming[0].expected, expected);
      const counts = complete ? count(raw, 1) : null;
      const assessed = Boolean(counts && observedAvailable);
      return {phoneIndex, expected, observed: raw.filter(operation => phone(operation.observed)).map(operation => operation.observed),
        operations: raw.map(operation => copy(operation)), counts,
        match_percent: counts ? percent(counts, assessed) : null, status: status(counts, assessed)};
    });
    const byIndex = new Map(resultPhones.map(item => [item.phoneIndex, item]));
    const groupUsers = new Map();
    suppliedGroups.forEach((group, at) => { if (checkedGroup(group)) group.phoneIndices.forEach(value => {
      if (!groupUsers.has(value)) groupUsers.set(value, []);
      groupUsers.get(value).push(at);
    }); });
    const resultGroups = suppliedGroups.map(group => {
      const base = record(group) ? copy(group) : {};
      const valid = checkedGroup(group);
      if (valid && group.phoneIndices.length === 0) return {...base, counts: null, match_percent: null, status: 'silent'};
      const targets = valid ? group.phoneIndices.map(value => byIndex.get(value)) : [];
      const groupPhonesValid = !own(group, 'phones') || Array.isArray(group.phones) && group.phones.length === targets.length
        && group.phones.every((value, at) => targets[at] && same(value, targets[at].expected));
      const complete = valid && group.phoneIndices.length > 0 && groupPhonesValid
        && group.phoneIndices.every(value => groupUsers.get(value).length === 1)
        && targets.every(value => value && value.counts && value.match_percent !== null);
      const raw = complete ? targets.flatMap(value => value.operations) : [];
      const counts = complete ? count(raw, targets.length) : null;
      return {...base, counts, match_percent: counts ? percent(counts, true) : null, status: status(counts, complete)};
    });
    const priority = resultPhones.filter(value => value.match_percent !== null && value.match_percent < 95)
      .sort((a, b) => a.match_percent - b.match_percent || ['delete', 'substitute', 'mixed', 'insert'].indexOf(a.status)
        - ['delete', 'substitute', 'mixed', 'insert'].indexOf(b.status) || a.phoneIndex - b.phoneIndex)
      .map(value => value.phoneIndex);
    const available = resultPhones.some(value => value.match_percent !== null);
    return {phones: resultPhones, groups: resultGroups, priority, available,
      note: baseNote + (single ? ' · วิเคราะห์เฉพาะหน่วยเสียงที่ฝึก ส่วนอื่นยังไม่ได้ประเมิน' : '')
        + (!available ? ' · ข้อมูลยังไม่พอประเมินรายเสียง' : resultPhones.some(value => value.match_percent === null) ? ' · บางส่วนยังไม่มีข้อมูลที่ครบสำหรับประเมิน' : '')};
  }
  return Object.freeze({analyzeWord});
});
