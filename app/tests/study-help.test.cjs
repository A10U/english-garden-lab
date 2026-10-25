const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const study = require('../study-help.js');
const phoneticSandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../phonetic-data.js'), 'utf8'), phoneticSandbox);
const inventory = JSON.parse(JSON.stringify(phoneticSandbox.EGL_PHONETIC_DATA));
const wordPattern = /[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*/g;

test('all 58 real examples have Thai meaning, useful words and exact chunk coverage', () => {
  assert.equal(Object.keys(inventory).length, 58);
  for (const [text, phonetics] of Object.entries(inventory)) {
    const result = study.forText(text);
    assert.ok(result, `Missing curated help: ${text}`);
    assert.match(result.translation, /[ก-๙]/);
    assert.match(result.tip, /[ก-๙]/);
    const flattened = result.chunks.flatMap(chunk => chunk.wordIndices);
    assert.deepEqual(flattened, phonetics.words.map(word => word.index), text);
    const sourceWords = [...text.matchAll(wordPattern)].map(match => match[0]);
    for (const chunk of result.chunks) {
      assert.match(chunk.translation, /[ก-๙]/);
      assert.ok(text.includes(chunk.text));
      assert.deepEqual([...chunk.text.matchAll(wordPattern)].map(match => match[0]),
        chunk.wordIndices.map(index => sourceWords[index]), text);
      assert.ok(chunk.wordIndices.length <= 6);
      assert.ok(chunk.wordIndices.length >= (sourceWords.length === 1 ? 1 : 2));
    }
    for (const word of sourceWords) {
      assert.match(result.words[word.toLowerCase().replace(/’/g, "'")] || '', /[ก-๙]/,
        `Missing contextual word meaning: ${word} in ${text}`);
    }
  }
});

test('meaning preserves beginner-critical negation and idiomatic phrases', () => {
  assert.match(study.forText("You don't have to get every word right. Let's try one sentence together.").translation, /ไม่จำเป็น/);
  assert.match(study.forText("That's okay. Take your time, and try again when you're ready.").translation, /ค่อย ๆ/);
  assert.match(study.forText('I see what you mean. Could you give me a small example?').words.see, /เข้าใจ/);
  assert.match(study.forText('Would you like to hear it again, or would you rather take a short break?').words.like, /อยาก/);
  assert.notEqual(study.forText('I like plants.').words.like,
    study.forText('Would you like to hear it again, or would you rather take a short break?').words.like);
});

test('leaf/plural and noun senses are useful without Thai sound-alike spellings', () => {
  assert.match(study.forText('leaf').translation, /หนึ่งใบ/);
  assert.match(study.forText('plants').translation, /หลายต้น/);
  const result = study.forText("You've learned three words today: leaf, root, and flower.");
  assert.equal(result.words.root, 'ราก');
  assert.equal(result.words.flower, 'ดอกไม้');
  assert.match(result.translation, /ใบไม้.*ราก.*ดอกไม้/);
});

test('source punctuation survives and smart apostrophes retain correct word indices', () => {
  const text = '  THAT’S okay.  Take your time, and try again when you’re ready.  ';
  const result = study.forText(text);
  assert.ok(result);
  assert.equal(result.chunks[0].text, 'THAT’S okay.');
  assert.equal(result.chunks.at(-1).text, 'when you’re ready.');
  assert.deepEqual(result.chunks.at(-1).wordIndices, [8, 9, 10]);
});

test('unknown text stays unknown, with no automatic guessed translation', () => {
  for (const input of ['This is a leaf?', 'I cannot understand this new sentence.', '', null, {}, '__proto__']) {
    assert.equal(study.forText(input), null);
  }
});

test('browser global works and returned help cannot mutate future lookups', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../study-help.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.EGLStudyHelp.forText, 'function');
  assert.equal(sandbox.EGLStudyHelp.forText('green').translation, 'สีเขียว');
  const altered = study.forText('This is a leaf.');
  altered.translation = 'wrong';
  altered.chunks[0].wordIndices[0] = 99;
  altered.words.leaf = 'wrong';
  const fresh = study.forText('This is a leaf.');
  assert.equal(fresh.translation, 'นี่คือใบไม้หนึ่งใบ');
  assert.equal(fresh.words.leaf, 'ใบไม้หนึ่งใบ');
  assert.deepEqual(fresh.chunks[0].wordIndices, [0, 1, 2, 3]);
});
