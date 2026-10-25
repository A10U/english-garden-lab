/* Authored spelling-to-sound examples for this project's beginner vocabulary.
 * General phonics reference: UF Literacy Institute, phoneme/grapheme correspondences
 * https://ufli.education.ufl.edu/resources/teaching-resources/instructional-activities/phoneme-grapheme-correspondences/
 * Digraph/silent-e reference: North Carolina Department of Public Instruction
 * https://www.dpi.nc.gov/students-families/parents-corner/literacy-home-digital-childrens-reading-initiative/2nd-grade/phonics-2nd-grade
 * This is a checked lexicon, not a general grapheme-to-phoneme algorithm or an
 * acoustic analysis. Phone strings come from the supplied pronunciation reference.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EGLSpellingGuide = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // A space separates phone TOKENS; | separates explicitly allowed variants.
  // Empty sound strings mark letters with no separate sound in this word.
  // Multi-letter groups and multi-phone groups are intentional: ar can be one
  // /ɑːɹ/ token or two /ɑː/, /ɹ/ tokens; le can be /əl/ or /ə/, /l/.
  const entries = {
    a: [['a', 'eɪ|ɐ|ə']],
    add: [['a', 'æ'], ['dd', 'd']],
    and: [['a', 'æ|ə'], ['n', 'n'], ['d', 'd']],
    at: [['a', 'æ|ə'], ['t', 't']],
    back: [['b', 'b'], ['a', 'æ'], ['ck', 'k']],
    be: [['b', 'b'], ['e', 'iː|i']],
    can: [['c', 'k'], ['a', 'æ|ə'], ['n', 'n']],
    check: [['ch', 'tʃ'], ['e', 'ɛ|e'], ['ck', 'k']],
    come: [['c', 'k'], ['o', 'ʌ'], ['m', 'm'], ['e', '']],
    could: [['c', 'k'], ['ou', 'ʊ'], ['l', ''], ['d', 'd']],
    day: [['d', 'd'], ['ay', 'eɪ']],
    do: [['d', 'd'], ['o', 'uː|u']],
    for: [['f', 'f'], ['or', 'ɔːɹ|ɔː ɹ|ɔː|ɚ|ə']],
    garden: [['g', 'ɡ'], ['ar', 'ɑːɹ|ɑː ɹ|ɑ ɹ|ɑː'], ['d', 'd'], ['e', 'ə'], ['n', 'n']],
    give: [['g', 'ɡ'], ['i', 'ɪ'], ['v', 'v'], ['e', '']],
    good: [['g', 'ɡ'], ['oo', 'ʊ'], ['d', 'd']],
    green: [['g', 'ɡ'], ['r', 'ɹ'], ['ee', 'iː'], ['n', 'n']],
    have: [['h', 'h'], ['a', 'æ'], ['v', 'v'], ['e', '']],
    hear: [['h', 'h'], ['ear', 'ɪɹ|ɪ ɹ|ɪə|iə']],
    help: [['h', 'h'], ['e', 'ɛ|e'], ['l', 'l'], ['p', 'p']],
    hi: [['h', 'h'], ['i', 'aɪ']],
    how: [['h', 'h'], ['ow', 'aʊ']],
    i: [['i', 'aɪ']],
    in: [['i', 'ɪ'], ['n', 'n']],
    is: [['i', 'ɪ'], ['s', 'z']],
    it: [['i', 'ɪ'], ['t', 't|ɾ']],
    leaf: [['l', 'l'], ['ea', 'iː'], ['f', 'f']],
    leaves: [['l', 'l'], ['ea', 'iː'], ['v', 'v'], ['e', ''], ['s', 'z']],
    let: [['l', 'l'], ['e', 'ɛ|e'], ['t', 't']],
    like: [['l', 'l'], ['i', 'aɪ'], ['k', 'k'], ['e', '']],
    listen: [['l', 'l'], ['i', 'ɪ'], ['s', 's'], ['t', ''], ['e', 'ə'], ['n', 'n']],
    little: [['l', 'l'], ['i', 'ɪ'], ['tt', 'ɾ|t'], ['le', 'əl|ə l|l̩']],
    look: [['l', 'l'], ['oo', 'ʊ'], ['k', 'k']],
    make: [['m', 'm'], ['a', 'eɪ'], ['k', 'k'], ['e', '']],
    me: [['m', 'm'], ['e', 'iː|i']],
    my: [['m', 'm'], ['y', 'aɪ']],
    near: [['n', 'n'], ['ear', 'ɪɹ|ɪ ɹ|ɪə|iə']],
    need: [['n', 'n'], ['ee', 'iː'], ['d', 'd']],
    new: [['n', 'n'], ['ew', 'uː|j uː']],
    nice: [['n', 'n'], ['i', 'aɪ'], ['c', 's'], ['e', '']],
    no: [['n', 'n'], ['o', 'oʊ|əʊ']],
    now: [['n', 'n'], ['ow', 'aʊ']],
    of: [['o', 'ʌ|ə|ɒ'], ['f', 'v']],
    plant: [['p', 'p'], ['l', 'l'], ['a', 'æ|ɑː'], ['n', 'n'], ['t', 't']],
    please: [['p', 'p'], ['l', 'l'], ['ea', 'iː'], ['s', 'z'], ['e', '']],
    pot: [['p', 'p'], ['o', 'ɑː|ɑ|ɒ'], ['t', 't']],
    ready: [['r', 'ɹ'], ['ea', 'ɛ|e'], ['d', 'd'], ['y', 'i']],
    right: [['r', 'ɹ'], ['igh', 'aɪ'], ['t', 't']],
    root: [['r', 'ɹ'], ['oo', 'uː'], ['t', 't']],
    say: [['s', 's'], ['ay', 'eɪ']],
    see: [['s', 's'], ['ee', 'iː']],
    short: [['sh', 'ʃ'], ['or', 'ɔːɹ|ɔː ɹ|ɔː'], ['t', 't']],
    slow: [['s', 's'], ['l', 'l'], ['ow', 'oʊ|əʊ']],
    small: [['s', 's'], ['m', 'm'], ['a', 'ɔː|ɑː|ɔ|ɑ'], ['ll', 'l']],
    soft: [['s', 's'], ['o', 'ɔ|ɒ|ɑː|ɑ'], ['f', 'f'], ['t', 't']],
    soil: [['s', 's'], ['oi', 'ɔɪ'], ['l', 'l']],
    step: [['s', 's'], ['t', 't'], ['e', 'ɛ|e'], ['p', 'p']],
    take: [['t', 't'], ['a', 'eɪ'], ['k', 'k'], ['e', '']],
    talk: [['t', 't'], ['a', 'ɔː|ɑː|ɔ|ɑ'], ['l', ''], ['k', 'k']],
    tell: [['t', 't'], ['e', 'ɛ|e'], ['ll', 'l']],
    thank: [['th', 'θ'], ['a', 'æ'], ['n', 'ŋ'], ['k', 'k']],
    that: [['th', 'ð'], ['a', 'æ'], ['t', 't']],
    the: [['th', 'ð'], ['e', 'ə|iː|i']],
    then: [['th', 'ð'], ['e', 'ɛ|e'], ['n', 'n']],
    thing: [['th', 'θ'], ['i', 'ɪ'], ['ng', 'ŋ']],
    think: [['th', 'θ'], ['i', 'ɪ'], ['n', 'ŋ'], ['k', 'k']],
    this: [['th', 'ð'], ['i', 'ɪ'], ['s', 's']],
    three: [['th', 'θ'], ['r', 'ɹ'], ['ee', 'iː']],
    time: [['t', 't'], ['i', 'aɪ'], ['m', 'm'], ['e', '']],
    to: [['t', 't'], ['o', 'uː|ə|ʊ']],
    try: [['t', 't'], ['r', 'ɹ'], ['y', 'aɪ']],
    two: [['t', 't'], ['w', ''], ['o', 'uː']],
    us: [['u', 'ʌ|ə'], ['s', 's']],
    water: [['w', 'w'], ['a', 'ɔː|ɑː|ɔ|ɑ'], ['t', 'ɾ|t'], ['er', 'ɚ|ə ɹ|ə']],
    we: [['w', 'w'], ['e', 'iː|i']],
    with: [['w', 'w'], ['i', 'ɪ'], ['th', 'ð|θ']],
    word: [['w', 'w'], ['or', 'ɜː|ɜːɹ|ɜː ɹ|ɝ|ɚ'], ['d', 'd']],
    write: [['w', ''], ['r', 'ɹ'], ['i', 'aɪ'], ['t', 't'], ['e', '']],
    you: [['y', 'j'], ['ou', 'uː|u|ə|ʊ']],
    your: [['y', 'j'], ['our', 'ʊɹ|ʊ ɹ|ɔːɹ|ɔː ɹ|ɔː|ɚ']],
  };
  const splitE = new Set(['make', 'like', 'nice', 'take', 'time', 'write']);
  const normalizePhone = phone => phone.normalize('NFC').replace(/[ˈˌ͜͡]/gu, '').replace(/g/g, 'ɡ').replace(/r/g, 'ɹ');
  const lexicon = new Map(Object.entries(entries).map(([word, groups]) => [word, groups.map(([letters, variants]) => ({
    letters, alternatives: variants.split('|').map(value => value ? value.split(' ').map(normalizePhone) : []),
  }))]));

  function unavailable(word, note) { return { word, groups: [], available: false, note }; }
  function forWord(wordText, phones) {
    const word = typeof wordText === 'string' ? wordText : '';
    const key = word.toLowerCase();
    const entry = lexicon.get(key);
    if (!entry) return unavailable(word, 'คำนี้ยังไม่มีตัวช่วยแบ่งตัวสะกดที่ตรวจไว้ ดูหน่วยเสียงอ้างอิงและฟังตัวอย่างแทนได้');
    if (!Array.isArray(phones) || !phones.length || phones.some(phone => typeof phone !== 'string' || !phone.length)) {
      return unavailable(word, 'ยังไม่มีหน่วยเสียงอ้างอิงที่ครบสำหรับแบ่งตัวสะกดคำนี้');
    }
    const normalized = phones.map(normalizePhone);
    // Match complete token sequences, including variable-size composite phones.
    // Backtracking is bounded by this small curated entry, never spelling rules.
    function match(groupIndex, phoneIndex) {
      if (groupIndex === entry.length) return phoneIndex === phones.length ? [] : null;
      for (const alternative of entry[groupIndex].alternatives) {
        if (!alternative.every((phone, offset) => normalized[phoneIndex + offset] === phone)) continue;
        const rest = match(groupIndex + 1, phoneIndex + alternative.length);
        if (rest !== null) return [alternative.length, ...rest];
      }
      return null;
    }
    const lengths = match(0, 0);
    if (!lengths) return unavailable(word, 'หน่วยเสียงชุดนี้ไม่ตรงกับตัวอย่างแบ่งตัวสะกดที่ตรวจไว้ จึงแสดงหน่วยเสียงอย่างเดียว');
    let letterIndex = 0, phoneIndex = 0;
    const groups = entry.map((group, index) => {
      const start = letterIndex;
      letterIndex += group.letters.length;
      const count = lengths[index];
      const phoneIndices = Array.from({ length: count }, (_, offset) => phoneIndex + offset);
      phoneIndex += count;
      return { letters: word.slice(start, letterIndex), start, end: letterIndex, phoneIndices,
        phones: phoneIndices.map(position => phones[position]), silent: count === 0 };
    });
    let note = 'แบ่งตัวสะกดตามเสียงในคำนี้ ไม่ใช่การอ่านชื่อพยัญชนะหรือกฎสำหรับทุกคำ';
    if (splitE.has(key)) note += ' สระกับ e ท้ายคำทำงานร่วมกัน โดย e ไม่มีเสียงแยก';
    else if (groups.some(group => group.silent)) note += ' ตัวอักษรที่เงียบไม่มีเสียงแยกในคำนี้';
    return { word, groups, available: true, note };
  }
  return Object.freeze({ forWord });
});
