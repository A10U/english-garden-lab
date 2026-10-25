const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pairs = require('../vowel-pairs.js');

test('browser and CommonJS expose identical pure data with no media or network access', () => {
  const context = {};
  for (const name of ['fetch', 'document', 'navigator', 'Audio']) Object.defineProperty(context, name, {get() { throw new Error('no side effects'); }});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vowel-pairs.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.EGLVowelPairs.forPhone('ɪ'))), pairs.forPhone('ɪ'));
});

test('the requested core comparisons contain real complete English words and Thai coaching', () => {
  const expected = {ɪ: ['sit', 'seat'], 'iː': ['seat', 'sit'], ʊ: ['pull', 'pool'], 'uː': ['pool', 'pull'],
    ɛ: ['bed', 'bad'], æ: ['bad', 'bed'], ʌ: ['cup', 'cop'], 'ɑː': ['cop', 'cup'],
    eɪ: ['late', 'let'], aɪ: ['bite', 'bit'], oʊ: ['note', 'not'], aʊ: ['now', 'no'], ɔɪ: ['boy', 'buy']};
  for (const [phone, words] of Object.entries(expected)) {
    const result = pairs.forPhone(phone);
    assert.equal(result.target, phone);
    assert.deepEqual([result.targetWord.word, result.other.word], words);
    assert.equal(result.exactTarget, true);
    assert.equal(result.minimalPair, true);
    assert.equal(result.accent, 'en-us');
    for (const value of [result.targetWord, result.other]) {
      assert.match(value.word, /^[a-z]+$/);
      assert.match(value.meaning, /[ก-๙]/);
      assert.equal(typeof value.phone, 'string');
    }
    assert.match(result.title, /ฟัง/);
    assert.match(result.difference, /ลิ้น|ปาก/);
    assert.equal(result.steps.length, 3);
    result.steps.forEach(step => assert.match(step, /[ก-๙]/));
    assert.ok(result.sources.includes('https://dictionary.cambridge.org/pronunciation/english/' + words[0]));
    assert.ok(result.sources.includes('https://dictionary.cambridge.org/pronunciation/english/' + words[1]));
    assert.ok(result.sources.some(source => /ubc\.ca|pressbooks\.pub/.test(source)));
  }
});

test('high-vowel contrasts teach quality and tongue position rather than duration alone', () => {
  assert.match(pairs.forPhone('ɪ').difference, /ต่ำ.*กลาง.*สูง.*ไม่ใช่แค่/);
  assert.match(pairs.forPhone('ʊ').difference, /ต่ำ.*ห่อปาก.*สูง.*สำเนียง/);
  assert.match(pairs.forPhone('ʊ').steps.join(' '), /ไม่เพียงยืดหรือหด/);
  assert.match(pairs.forPhone('æ').difference, /อ้าปากกว้าง.*ลดลิ้น/);
});

test('American cup/cop and note/not do not label the low vowel as British ɒ or rounded ɔ', () => {
  for (const value of ['ʌ', 'ɑː', 'ɑ']) {
    const result = pairs.forPhone(value);
    const cop = [result.targetWord, result.other].find(word => word.word === 'cop');
    assert.equal(cop.phone, 'ɑː');
    assert.equal(result.accent, 'en-us');
    assert.match(result.note, /อเมริกัน|อังกฤษ/);
  }
  assert.equal(pairs.forPhone('oʊ').other.phone, 'ɑː');
  assert.match(pairs.forPhone('oʊ').note, /อเมริกัน.*อังกฤษ/);
});

test('UK-only comparisons explicitly require UK reference audio and preserve rounded-vowel distinctions', () => {
  const lot = pairs.forPhone('ɒ');
  assert.equal(lot.targetWord.word, 'not');
  assert.equal(lot.targetWord.phone, 'ɒ');
  assert.equal(lot.accent, 'en-gb');
  assert.match(lot.note, /อเมริกัน.*ไม่ใช่/);
  assert.equal(pairs.forPhone('əʊ').other.phone, 'ɒ');
  for (const value of ['ɔː', 'ɔ']) {
    const thought = pairs.forPhone(value);
    assert.equal(thought.targetWord.word, 'thought');
    assert.equal(thought.targetWord.phone, 'ɔː');
    assert.equal(thought.accent, 'en-gb');
    assert.equal(thought.minimalPair, false);
    assert.match(thought.note, /ไม่ใช่ทุกสำเนียง.*ตรวจไฟล์/);
  }
  assert.equal(pairs.forPhone('ɜː').accent, 'en-gb');
  assert.match(pairs.forPhone('ɜː').note, /อเมริกัน.*ɝ.*ไม่ใช่/);
});

test('schwa and near-open central guidance identify reduced-vowel context without claiming a false exact pair', () => {
  const schwa = pairs.forPhone('ə');
  assert.equal(schwa.targetWord.word, 'about');
  assert.equal(schwa.targetWord.phone, 'ə');
  assert.equal(schwa.other.word, 'cup');
  assert.equal(schwa.minimalPair, false);
  assert.match(schwa.steps.join(' '), /พยางค์แรก.*เบา/);
  assert.match(schwa.note, /ไม่ใช่คู่คำ/);
  const central = pairs.forPhone('ɐ');
  assert.equal(central.target, 'ɐ');
  assert.equal(central.targetWord.phone, 'ə');
  assert.equal(central.exactTarget, false);
  assert.equal(central.minimalPair, false);
  assert.match(central.note, /ไม่ใช่ไฟล์ยืนยัน \/ɐ\//);
});

test('aliases retain the actual example phone and mark that the requested notation is not exact', () => {
  for (const [request, actual] of [['i', 'iː'], ['u', 'uː'], ['e', 'ɛ'], ['ɑ', 'ɑː'], ['ɔ', 'ɔː']]) {
    const result = pairs.forPhone(request);
    assert.equal(result.target, request);
    assert.equal(result.targetWord.phone, actual);
    assert.equal(result.exactTarget, false);
    assert.match(result.note, /สัญลักษณ์|ระบบ|พจนานุกรม/);
  }
});

test('diphthongs coach a continuous movement inside one syllable', () => {
  for (const phone of ['eɪ', 'aɪ', 'oʊ', 'aʊ', 'ɔɪ', 'əʊ']) {
    const result = pairs.forPhone(phone);
    assert.match(result.difference, /เลื่อน/);
    assert.match(result.steps.join(' '), /พยางค์เดียว|ไม่เติมพยางค์|อย่าแยก/);
  }
});

test('unknown phones, composites, rhotic vowels, inherited names and markup safely return null', () => {
  for (const value of ['ɹ', 'ɚ', 'ɝ', 'ɑːɹ', 'aɪɚ', 'ɪə', 'eə', 'ʊə', 'qʰ', 'a', 'o',
    '__proto__', 'constructor', 'toString', '<img src=x>', '&lt;svg&gt;', 'x'.repeat(100), null, undefined, {}]) {
    assert.equal(pairs.forPhone(value), null);
  }
  assert.equal(pairs.forPhone({toString() { throw new Error('never coerce'); }}), null);
});

test('wrappers and stress normalize without merging different vowel qualities or length', () => {
  assert.deepEqual(pairs.forPhone('/ˈɪ/'), pairs.forPhone('ɪ'));
  assert.deepEqual(pairs.forPhone('[i:]'), pairs.forPhone('iː'));
  assert.notDeepEqual(pairs.forPhone('i'), pairs.forPhone('iː'));
  assert.notDeepEqual(pairs.forPhone('ɑ'), pairs.forPhone('ɒ'));
});

test('returned nested data can be edited without corrupting subsequent calls or reverse comparisons', () => {
  const result = pairs.forPhone('ɪ');
  result.other.word = 'wrong'; result.steps[0] = 'wrong'; result.sources.splice(0);
  assert.equal(pairs.forPhone('ɪ').other.word, 'seat');
  assert.equal(pairs.forPhone('iː').targetWord.word, 'seat');
  assert.ok(pairs.forPhone('ɪ').sources.length > 0);
});
