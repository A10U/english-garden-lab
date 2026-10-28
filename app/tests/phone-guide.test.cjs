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
  assert.equal(typeof context.EGLPhoneGuide.practiceForWord, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(context.EGLPhoneGuide.practiceForWord('with', ['w', 'ɪ', 'θ']))), guide.practiceForWord('with', ['w', 'ɪ', 'θ']));
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

test('with plans respect both dictionary pronunciations and use the supplied reference for each indexed step', () => {
  for (const final of ['ð', 'θ']) {
    const input = ['w', 'ɪ', final], before = [...input], plan = guide.practiceForWord('with', input);
    assert.equal(plan.available, true); assert.equal(plan.word, 'with');
    assert.deepEqual(plan.steps.map(step => step.phoneIndex), [0, 1, 2]);
    assert.deepEqual(plan.steps.map(step => step.phone), input); assert.deepEqual(input, before);
    assert.deepEqual(plan.acceptedPronunciations, [['w', 'ɪ', 'ð'], ['w', 'ɪ', 'θ']]);
    assert.match(plan.variantNote, /\/wɪð\/.*\/wɪθ\//);
    assert.ok(plan.variantNote.includes('ตัวอย่างนี้ใช้ /wɪ' + final + '/'));
    assert.match(plan.steps[0].instruction, /ห่อริมฝีปาก.*ส่วนหลังของลิ้น.*คลาย.*\/ɪ\//);
    assert.match(plan.steps[0].selfCheck, /กระจก|ริมฝีปาก/);
    assert.match(plan.steps[1].instruction, /ลิ้น.*ต่ำ.*กลาง.*sit.*seat.*ไม่ใช้ความยาวอย่างเดียว/);
    assert.deepEqual(plan.steps[1].examples.map(example => example.text), ['sit', 'seat']);
    assert.match(plan.steps[2].instruction, /ลิ้น.*ฟันบน.*เบา.*ลมผ่านต่อเนื่อง/);
    assert.ok(plan.steps[2].instruction.includes('ตัวอย่างนี้ใช้ /' + final + '/'));
    assert.deepEqual(plan.steps[2].examples.map(example => example.text), final === 'ð' ? ['this', 'thin'] : ['thin', 'this']);
    assert.ok(plan.sources.includes('https://www.oxfordlearnersdictionaries.com/definition/english/with?q=with'));
    assert.ok(plan.sources.includes('https://dictionary.cambridge.org/us/dictionary/english/with'));
    assert.match(plan.disclaimer, /แนวทางฝึกทั่วไป.*ไม่ได้ชี้ว่าคุณออกเสียงส่วนใดผิด/);
    assert.doesNotMatch([plan.disclaimer, plan.variantNote, ...plan.steps.flatMap(step => [step.instruction, step.selfCheck, ...step.examples.map(example => example.label)])].join(' '), /\d+(?:\.\d+)?%/);
  }
});

test('with exercise examples are complete existing public words rather than invented isolated-phone files', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../word-audio.js'), 'utf8'), context);
  for (const final of ['ð', 'θ']) {
    for (const step of guide.practiceForWord('with', ['w', 'ɪ', final]).steps) {
      assert.ok(step.examples.length > 0);
      for (const example of step.examples) {
        assert.match(example.text, /^[a-z]+$/i); assert.match(example.label, /คำเต็ม/);
        assert.equal(context.EGL_WORD_AUDIO.by_word[example.text].standalone, true);
      }
    }
  }
});

test('accepted th alternatives are specific to with and never equate theta with eth globally', () => {
  const thisPlan = guide.practiceForWord('this', ['ð', 'ɪ', 's']);
  const thinPlan = guide.practiceForWord('thin', ['θ', 'ɪ', 'n']);
  assert.equal(thisPlan.available, true); assert.equal(thinPlan.available, true);
  assert.deepEqual(thisPlan.acceptedPronunciations, []); assert.deepEqual(thinPlan.acceptedPronunciations, []);
  assert.equal(thisPlan.variantNote, ''); assert.equal(thinPlan.variantNote, '');
  assert.notEqual(thisPlan.steps[0].instruction, thinPlan.steps[0].instruction);
  assert.equal(thisPlan.steps[0].phone, 'ð'); assert.equal(thinPlan.steps[0].phone, 'θ');
  const otherWith = guide.practiceForWord('with', ['w', 'ɪ', 't']);
  assert.equal(otherWith.available, true, 'generic practice follows supplied supported phones without validating a word transcription');
  assert.deepEqual(otherWith.acceptedPronunciations, []); assert.equal(otherWith.variantNote, '');
  assert.ok(!otherWith.sources.some(url => /oxfordlearnersdictionaries|dictionary\.cambridge/.test(url)));
});

test('generic familiar words reuse authored phone instructions without claiming personal assessment', () => {
  for (const [word, phones] of [["It's", ['ɪ', 't', 's']], ['this', ['ð', 'ɪ', 's']], ['leaf', ['l', 'iː', 'f']]]) {
    const plan = guide.practiceForWord(word, phones);
    assert.equal(plan.available, true); assert.equal(plan.word, word);
    assert.deepEqual(plan.steps.map(step => step.phoneIndex), phones.map((_, index) => index));
    plan.steps.forEach((step, index) => {
      assert.equal(step.phone, phones[index]); assert.ok(step.instruction.startsWith(guide.describe(phones[index]).tip));
      assert.equal(step.examples[0].text, guide.describe(phones[index]).example);
      assert.match(step.selfCheck, /ฟัง.*เทียบ.*ยังไม่แน่ใจ/);
    });
    assert.deepEqual(plan.acceptedPronunciations, []);
    assert.match(plan.disclaimer, /ตามเสียงอ้างอิงที่ส่งมา.*ไม่ได้ยืนยันคำอ่านของคำใหม่/);
    assert.deepEqual(Object.keys(plan).sort(), ['acceptedPronunciations', 'available', 'disclaimer', 'sources', 'steps', 'variantNote', 'word']);
    assert.ok(plan.sources.every(url => url.startsWith('https://')));
  }
});

test('practice indices preserve reference order and repeats while existing phone normalization remains consistent', () => {
  const phones = ['t', '/ˈɪ/', 't'], plan = guide.practiceForWord('test', phones);
  assert.equal(plan.available, true);
  assert.deepEqual(plan.steps.map(step => [step.phoneIndex, step.phone]), [[0, 't'], [1, 'ɪ'], [2, 't']]);
  assert.deepEqual(phones, ['t', '/ˈɪ/', 't']);
  assert.equal(guide.practiceForWord(' WITH ', ['w', 'ˈɪ', 'θ']).variantNote.includes('ตัวอย่างนี้ใช้ /wɪθ/'), true);
  assert.equal(guide.practiceForWord('It’s', ['ɪ', 't', 's']).word, 'It’s');
});

test('the phone-practice API is not a dictionary and says so for a new lexical word with supported reference phones', () => {
  const plan = guide.practiceForWord('blorf', ['b', 'l', 'ɔː', 'f']);
  assert.equal(plan.available, true);
  assert.equal(plan.steps.length, 4); assert.deepEqual(plan.acceptedPronunciations, []);
  assert.match(plan.disclaimer, /ไม่ได้ยืนยันคำอ่านของคำใหม่/);
  assert.ok(plan.steps.every(step => step.examples.every(example => example.text !== 'blorf')));
});

test('malformed words, missing phones and unsupported symbols have no invented practice instructions', () => {
  const malformed = ['', 'with me', 'with.', '<img src=x>', '__proto__', '123', null, undefined, {toString() { throw new Error('must not execute'); }}];
  for (const text of malformed) {
    const plan = guide.practiceForWord(text, ['w', 'ɪ', 'ð']);
    assert.equal(plan.available, false); assert.deepEqual(plan.steps, []); assert.deepEqual(plan.sources, []);
  }
  for (const phones of [undefined, null, [], 'wɪð', ['w', null, 'ð'], ['w', 'qʰ', 'ð'], ['w', 'ɪ', '__proto__'], ['tʃɹ'], Array(2)]) {
    const plan = guide.practiceForWord('with', phones);
    assert.equal(plan.available, false); assert.deepEqual(plan.steps, []);
    assert.deepEqual(plan.acceptedPronunciations, []); assert.equal(plan.variantNote, '');
    assert.match(plan.disclaimer, /ยังไม่มีคำแนะนำที่อ้างอิงได้/);
  }
});

test('callers cannot mutate future practice plans, nested examples, accepted variants or sources', () => {
  const before = guide.practiceForWord('with', ['w', 'ɪ', 'ð']), changed = guide.practiceForWord('with', ['w', 'ɪ', 'ð']);
  changed.steps[0].phoneIndex = 99; changed.steps[0].instruction = 'wrong'; changed.steps[0].examples[0].text = 'wrong';
  changed.acceptedPronunciations[0][2] = 't'; changed.acceptedPronunciations.push(['wrong']); changed.sources.push('wrong');
  changed.variantNote = 'wrong'; changed.disclaimer = 'wrong';
  assert.deepEqual(guide.practiceForWord('with', ['w', 'ɪ', 'ð']), before);
  assert.equal(guide.describe('w').example, 'water');
});

test('practice plans can be built without DOM, network, microphone or speech APIs', () => {
  const context = {};
  for (const name of ['document', 'fetch', 'navigator', 'Audio', 'speechSynthesis']) Object.defineProperty(context, name, {get() { throw new Error('must stay data only'); }});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../phone-guide.js'), 'utf8'), context);
  assert.equal(context.EGLPhoneGuide.practiceForWord('with', ['w', 'ɪ', 'θ']).available, true);
});
