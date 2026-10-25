const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guide = require('../spelling-guide.js');

function complete(result, word, phones) {
  assert.equal(result.available, true, `${word}: ${result.note}`);
  assert.equal(result.word, word);
  assert.equal(result.groups.map(group => group.letters).join(''), word);
  assert.deepEqual(result.groups.flatMap(group => group.phoneIndices), phones.map((_, i) => i));
  assert.deepEqual(result.groups.flatMap(group => group.phones), phones);
  let next = 0;
  for (const group of result.groups) {
    assert.equal(group.start, next);
    assert.equal(group.end, next + group.letters.length);
    assert.equal(word.slice(group.start, group.end), group.letters);
    assert.equal(group.silent, group.phoneIndices.length === 0);
    assert.deepEqual(group.phones, group.phoneIndices.map(index => phones[index]));
    next = group.end;
  }
  assert.equal(next, word.length);
}

test('browser and CommonJS expose the same pure function', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../spelling-guide.js'), 'utf8'), context);
  const browser = context.EGLSpellingGuide.forWord('leaf', ['l', 'iː', 'f']);
  assert.deepEqual(JSON.parse(JSON.stringify(browser)), guide.forWord('leaf', ['l', 'iː', 'f']));
});

test('digraphs and ordinary consonants map to complete reference phone units', () => {
  for (const [word, phones, letters] of [
    ['leaf', ['l', 'iː', 'f'], ['l', 'ea', 'f']],
    ['green', ['ɡ', 'ɹ', 'iː', 'n'], ['g', 'r', 'ee', 'n']],
    ['this', ['ð', 'ɪ', 's'], ['th', 'i', 's']],
    ['root', ['ɹ', 'uː', 't'], ['r', 'oo', 't']],
    ['soft', ['s', 'ɔ', 'f', 't'], ['s', 'o', 'f', 't']],
    ['check', ['tʃ', 'ɛ', 'k'], ['ch', 'e', 'ck']],
  ]) {
    const result = guide.forWord(word, phones);
    complete(result, word, phones);
    assert.deepEqual(result.groups.map(group => group.letters), letters);
  }
});

test('silent letters are visible without invented phonemes', () => {
  for (const [word, phones, silent] of [
    ['make', ['m', 'eɪ', 'k'], ['e']],
    ['write', ['ɹ', 'aɪ', 't'], ['w', 'e']],
    ['listen', ['l', 'ɪ', 's', 'ə', 'n'], ['t']],
    ['could', ['k', 'ʊ', 'd'], ['l']],
    ['two', ['t', 'uː'], ['w']],
  ]) {
    const result = guide.forWord(word, phones);
    complete(result, word, phones);
    assert.deepEqual(result.groups.filter(group => group.silent).map(group => group.letters), silent);
    assert.ok(result.groups.filter(group => group.silent).every(group => !group.phones.length));
  }
  assert.match(guide.forWord('make', ['m', 'eɪ', 'k']).note, /สระกับ e.*ร่วมกัน/);
  assert.doesNotMatch(guide.forWord('have', ['h', 'æ', 'v']).note, /สระกับ e/);
});

test('its contraction retains the apostrophe without inventing an extra sound', () => {
  const phones = ['ɪ', 't', 's'];
  const result = guide.forWord("It's", phones);
  complete(result, "It's", phones);
  assert.deepEqual(result.groups.map(group => group.letters), ['I', 't', "'s"]);
  complete(guide.forWord('its', phones), 'its', phones);
});

test('composite rhotic and syllabic phone tokens stay intact and map once', () => {
  for (const phones of [['ɡ', 'ɑːɹ', 'd', 'ə', 'n'], ['ɡ', 'ɑː', 'ɹ', 'd', 'ə', 'n'], ['ɡ', 'ɑː', 'd', 'ə', 'n']]) {
    const result = guide.forWord('garden', phones);
    complete(result, 'garden', phones);
    assert.equal(result.groups[1].letters, 'ar');
  }
  for (const phones of [['l', 'ɪ', 'ɾ', 'əl'], ['l', 'ɪ', 't', 'ə', 'l'], ['l', 'ɪ', 't', 'l̩']]) {
    const result = guide.forWord('little', phones);
    complete(result, 'little', phones);
    assert.deepEqual(result.groups.map(group => group.letters), ['l', 'i', 'tt', 'le']);
  }
  complete(guide.forWord('water', ['w', 'ɔː', 'ɾ', 'ɚ']), 'water', ['w', 'ɔː', 'ɾ', 'ɚ']);
});

test('case, stress, tie bars, and equivalent IPA conventions preserve original symbols', () => {
  const phones = ['g', 'r', 'ˈiː', 'n'];
  const result = guide.forWord('Green', phones);
  complete(result, 'Green', phones);
  assert.equal(result.groups[0].letters, 'G');
  assert.deepEqual(result.groups[2].phones, ['ˈiː']);
  complete(guide.forWord('check', ['t͡ʃ', 'ɛ', 'k']), 'check', ['t͡ʃ', 'ɛ', 'k']);
});

test('unknown words, incomplete phones, and mismatched vowels have an explicit fallback', () => {
  for (const [word, phones] of [
    ['unlisted', ['ə', 'n']], ['leaf', ['l', 'ɪ', 'f']], ['leaf', ['l', 'iː']],
    ['leaf', ['l', 'iː', 'f', 'ə']], ['this', ['θ', 'ɪ', 's']],
    ['leaf', []], ['leaf', null], ['leaf', ['l', null, 'f']], ['leaf', ['l', '', 'f']],
    ['__proto__', ['x']], [null, ['x']], [undefined, ['x']], [{ toString() { throw Error('do not coerce'); } }, ['x']],
  ]) {
    const result = guide.forWord(word, phones);
    assert.equal(result.available, false);
    assert.deepEqual(result.groups, []);
    assert.match(result.note, /[ก-๙]/);
  }
});

test('curated coverage matches at least 75 actual words from current runtime references', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../phonetic-data.js'), 'utf8'), context);
  const covered = new Set();
  for (const reference of Object.values(context.EGL_PHONETIC_DATA)) {
    for (const word of reference.words) {
      const phones = Array.from(word.phones);
      const result = guide.forWord(word.text, phones);
      if (result.available) {
        complete(result, word.text, phones);
        covered.add(word.text.toLowerCase());
      }
    }
  }
  assert.ok(covered.size >= 75, `only ${covered.size} actual words mapped`);
});

test('returned objects and caller arrays cannot mutate later mappings', () => {
  const phones = ['l', 'iː', 'f'];
  const first = guide.forWord('leaf', phones);
  first.groups[1].letters = 'wrong'; first.groups[1].phones[0] = 'ɪ'; first.groups[1].phoneIndices[0] = 99;
  assert.deepEqual(phones, ['l', 'iː', 'f']);
  complete(guide.forWord('leaf', phones), 'leaf', phones);
});
