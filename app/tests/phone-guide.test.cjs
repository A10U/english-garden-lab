const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guide = require('../phone-guide.js');

test('browser and CommonJS expose the same describe contract', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../phone-guide.js'), 'utf8'), context);
  assert.equal(typeof context.EGLPhoneGuide.describe, 'function');
  const result = context.EGLPhoneGuide.describe('θ');
  assert.deepEqual(Object.keys(result).sort(), ['example', 'label', 'symbol', 'tip']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), guide.describe('θ'));
});

test('ordinary English phones have contextual English words and beginner tips', () => {
  const symbols = 'iː ɪ e ɛ æ ɑː ɑ ɔː ɔ ɒ ʊ uː ʌ ə ɐ ɜː ɚ ɝ ɹ r l θ ð ʃ ʒ tʃ dʒ ŋ p b t d k ɡ f v s z m n h w j eɪ aɪ ɔɪ əʊ oʊ aʊ ɪə eə ʊə'.split(' ');
  for (const symbol of symbols) {
    const result = guide.describe(symbol);
    assert.equal(result.symbol, symbol);
    assert.match(result.tip, /[ก-๙]/);
    assert.match(result.example, /^[a-z]+$/i);
    assert.doesNotMatch(result.label, /ยังไม่มี/);
  }
});

test('dental fricatives explain voicing with understandable physical cues', () => {
  assert.match(guide.describe('θ').tip, /ลิ้น.*ฟัน/);
  assert.match(guide.describe('θ').tip, /ไม่สั่น/);
  assert.match(guide.describe('ð').tip, /ลำคอสั่น/);
  assert.equal(guide.describe('θ').example, 'thin');
  assert.equal(guide.describe('ð').example, 'this');
});

test('vowel contrasts describe mouth or tongue quality as well as duration', () => {
  assert.match(guide.describe('iː').tip, /ตำแหน่งลิ้น/);
  assert.match(guide.describe('ɪ').tip, /ต่ำ.*กลาง/);
  assert.match(guide.describe('ʊ').tip, /ไม่ใช่แค่ความยาว/);
  assert.notEqual(guide.describe('iː').tip, guide.describe('i').tip);
});

test('normalizes stress, affricate ties and equivalent g spelling, preserving length', () => {
  assert.deepEqual(guide.describe('/ˈt͡ʃ/'), guide.describe('tʃ'));
  assert.deepEqual(guide.describe('[d͜ʒ]'), guide.describe('dʒ'));
  assert.deepEqual(guide.describe('g'), guide.describe('ɡ'));
  assert.deepEqual(guide.describe('ʧ'), guide.describe('tʃ'));
  assert.equal(guide.describe('ˌɑːɹ').symbol, 'ɑːɹ');
  assert.notEqual(guide.describe('ɑː').symbol, guide.describe('ɑ').symbol);
  assert.notEqual(guide.describe('r').tip, guide.describe('ɹ').tip);
});

test('rhotic composite provides whole-word guidance without treating IPA as letters', () => {
  const result = guide.describe('ɑːɹ');
  assert.equal(result.example, 'car');
  assert.match(result.tip, /สระ.*ɹ.*ต่อเนื่อง/);
  assert.doesNotMatch(result.label, /ยังไม่มี/);
});

test('unlisted combinations use longest known phone units without invented example words', () => {
  const result = guide.describe('tʃɹ');
  assert.match(result.label, /\/tʃ\/.+\/ɹ\//);
  assert.doesNotMatch(result.label, /\/t\/|\/ʃ\//);
  assert.equal(result.example, '');
});

test('unknown sounds or diacritics receive a safe noncommittal description', () => {
  for (const value of ['qʰ', 'ɬ', '__proto__', '<img src=x>', 'nonsense', null, {}, undefined]) {
    const result = guide.describe(value);
    assert.match(result.label, /ยังไม่มี/);
    assert.equal(result.example, '');
  }
  assert.equal(guide.describe({toString() { throw new Error('must not execute'); }}).example, '');
});

test('callers cannot mutate later descriptions', () => {
  const description = guide.describe('ŋ');
  description.example = 'wrong';
  description.tip = 'wrong';
  assert.equal(guide.describe('ŋ').example, 'sing');
  assert.match(guide.describe('ŋ').tip, /จมูก/);
});
