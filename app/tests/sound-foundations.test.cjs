const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const foundations = require('../sound-foundations.js');

const ordinary = 'p b t d k ɡ f v θ ð s z ʃ ʒ tʃ dʒ m n ŋ h l ɹ w j iː i ɪ ɛ e æ ɑː ɑ ɔː ɔ ɒ uː u ʊ ʌ ə ɐ ɜː a o eɪ aɪ ɔɪ aʊ oʊ əʊ ɪə eə ʊə'.split(' ');
const positions = new Set(['front-high', 'front-mid', 'front-low', 'central', 'back-high', 'back-mid', 'back-low']);
const places = new Set(['lips', 'teeth', 'ridge', 'palate', 'velum', 'throat', 'vowel']);

test('browser UMD matches CommonJS and loads without DOM, network or microphone access', () => {
  let accesses = 0;
  const context = {};
  for (const key of ['document', 'fetch', 'navigator', 'Audio', 'XMLHttpRequest']) {
    Object.defineProperty(context, key, {get() { accesses++; throw new Error('No side effects on load'); }});
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sound-foundations.js'), 'utf8'), context);
  assert.equal(typeof context.EGLSoundFoundations.describe, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(context.EGLSoundFoundations.describe('l'))), foundations.describe('l'));
  assert.equal(accesses, 0);
});

test('ordinary English phones expose structured Thai coaching and explicit schematic cues', () => {
  for (const phone of ordinary) {
    const result = foundations.describe(phone);
    assert.equal(result.symbol, phone);
    assert.equal(result.known, true, phone);
    for (const key of ['category', 'place', 'manner', 'voice', 'airflow', 'lips', 'tongue', 'commonMistake']) {
      assert.equal(typeof result[key], 'string', phone + ' ' + key);
      assert.match(result[key], /[ก-๙]/, phone + ' ' + key);
    }
    assert.equal(typeof result.canSustain, 'boolean');
    assert.ok(result.steps.length >= 3 && result.steps.length <= 4, phone);
    for (const step of result.steps) assert.match(step, /[ก-๙]/);
    assert.ok(places.has(result.visual.place), phone);
    assert.ok(positions.has(result.visual.tongue), phone);
    for (const key of ['voiced', 'nasal', 'contact']) assert.equal(typeof result.visual[key], 'boolean', phone + ' ' + key);
    assert.match(result.visual.note, /ประมาณ.*สำเนียง/);
    assert.ok(result.sources.length >= 1, phone);
    for (const source of result.sources) {
      const url = new URL(source);
      assert.equal(url.protocol, 'https:');
      assert.ok(['www.internationalphoneticassociation.org', 'enunciate.arts.ubc.ca',
        'ecampusontario.pressbooks.pub', 'corpus.eduhk.hk'].includes(url.hostname));
    }
    assert.match(result.compare.note, /[ก-๙]/);
  }
});

test('f and v use the same teeth/lip gesture while voicing differs', () => {
  const f = foundations.describe('f');
  const v = foundations.describe('v');
  assert.equal(f.place, v.place);
  assert.equal(f.visual.place, 'teeth');
  assert.match(f.lips, /ฟันบน.*ริมฝีปากล่าง/);
  assert.match(v.lips, /ฟันบน.*ริมฝีปากล่าง/);
  assert.equal(f.visual.voiced, false);
  assert.equal(v.visual.voiced, true);
  assert.match(f.voice, /ไม่สั่น/);
  assert.match(v.voice, /คอสั่น/);
  assert.ok(f.canSustain && v.canSustain);
  assert.equal(v.compare.phone, 'f');
  assert.match(v.commonMistake, /ห่อปาก.*w/);
});

test('l and English rhotic teach contact versus a gap without mandatory tongue curling', () => {
  const l = foundations.describe('l');
  const r = foundations.describe('ɹ');
  assert.equal(l.visual.contact, true);
  assert.equal(r.visual.contact, false);
  assert.equal(l.visual.lateral, true);
  assert.match(l.airflow, /ข้างลิ้น/);
  assert.match(l.tongue, /แตะปลายลิ้น/);
  assert.match(r.tongue, /ปลายลิ้นไม่แตะ/);
  assert.match(r.commonMistake, /อย่ารัว.*อย่าบังคับ/);
  assert.equal(r.compare.phone, 'l');
  assert.equal(foundations.describe('r').known, false, 'Do not silently convert a trill symbol to English /ɹ/');
});

test('iː/ɪ and uː/ʊ contrasts explain tongue quality rather than length alone', () => {
  const longI = foundations.describe('iː');
  const shortI = foundations.describe('ɪ');
  assert.notEqual(longI.visual.tongue, shortI.visual.tongue);
  assert.match(shortI.tongue, /ต่ำ.*กลาง/);
  assert.match(shortI.commonMistake, /อย่าเพียงตัด.*สั้น/);
  assert.match(longI.commonMistake, /ไม่ใช่แค่ความยาว/);
  assert.notEqual(foundations.describe('i').commonMistake, longI.commonMistake);
  const longU = foundations.describe('uː');
  const shortU = foundations.describe('ʊ');
  assert.notEqual(longU.visual.tongue, shortU.visual.tongue);
  assert.equal(longU.visual.lips, 'rounded');
  assert.equal(shortU.visual.lips, 'rounded');
  assert.match(shortU.commonMistake, /อย่าเพียงตัด/);
  assert.match(longU.commonMistake, /สำเนียง/);
});

test('dental pair preserves position and distinguishes throat vibration with a continuous air gap', () => {
  const theta = foundations.describe('θ');
  const eth = foundations.describe('ð');
  assert.equal(theta.place, eth.place);
  assert.match(theta.tongue, /ฟัน.*ช่องให้ลมผ่าน/);
  assert.equal(theta.visual.voiced, false);
  assert.equal(eth.visual.voiced, true);
  assert.ok(theta.canSustain && eth.canSustain);
  assert.match(theta.commonMistake, /ปิดลม.*t/);
  assert.match(eth.commonMistake, /ปิดทางลม.*d/);
});

test('nasals route air through the nose and sing does not get an invented final g', () => {
  for (const phone of ['m', 'n', 'ŋ']) {
    const result = foundations.describe(phone);
    assert.equal(result.visual.nasal, true);
    assert.equal(result.visual.voiced, true);
    assert.equal(result.canSustain, true);
    assert.match(result.airflow, /จมูก/);
    assert.match(result.manner, /ลดเพดานอ่อน/);
  }
  const ng = foundations.describe('ŋ');
  assert.equal(ng.visual.place, 'velum');
  assert.equal(ng.visual.contact, true);
  assert.match(ng.commonMistake, /sing.*ไม่ต้อง.*ɡ.*finger.*อาจมี/);
  assert.equal(foundations.describe('m').visual.contact, false, 'Lip closure is not tongue contact');
  assert.equal(foundations.describe('n').visual.place, 'ridge');
});

test('stops teach a brief release without claiming universal aspiration or a held burst', () => {
  for (const phone of ['p', 'b', 't', 'd', 'k', 'ɡ']) {
    const result = foundations.describe(phone);
    assert.equal(result.canSustain, false);
    assert.match(result.manner, /ปิดทางลม.*ปล่อย.*ไม่สามารถค้าง/);
    assert.match(result.commonMistake, /ไม่.*ปล่อยชัด/);
    assert.match(result.steps.join(' '), /ไม่เติมสระ/);
  }
  for (const phone of ['p', 't', 'k']) {
    assert.match(foundations.describe(phone).steps.join(' '), /พยางค์เน้น.*มักมีลมตาม.*หลัง \/s\//);
  }
  assert.equal(foundations.describe('p').visual.contact, false);
  for (const phone of ['t', 'd', 'k', 'ɡ']) assert.equal(foundations.describe(phone).visual.contact, true);
});

test('affricates remain single units and distinguish their closure from fricatives', () => {
  const ch = foundations.describe('tʃ');
  const j = foundations.describe('dʒ');
  assert.equal(ch.canSustain, false);
  assert.equal(j.canSustain, false);
  assert.match(ch.manner, /ปิดทางลมก่อน.*หนึ่งหน่วย/);
  assert.match(ch.steps.join(' '), /ค้างได้เฉพาะช่วงลมเสียดสี/);
  assert.equal(ch.visual.contactPhase, 'closure');
  assert.equal(ch.visual.voiced, false);
  assert.equal(j.visual.voiced, true);
  assert.equal(foundations.describe('ʃ').canSustain, true);
  assert.equal(foundations.describe('ʃ').visual.contact, false);
  assert.match(foundations.describe('j').commonMistake, /yes.*ไม่ใช่.*J.*job/);
});

test('diphthongs provide a motion target and teach one continuous syllable', () => {
  for (const phone of ['eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ', 'ɪə', 'eə', 'ʊə']) {
    const result = foundations.describe(phone);
    assert.equal(result.visual.moving, true);
    assert.ok(positions.has(result.visual.tongueTo));
    assert.equal(result.visual.contact, false);
    assert.equal(result.canSustain, true);
    assert.match(result.manner, /ต่อเนื่อง.*พยางค์เดียว/);
    assert.match(result.commonMistake, /อย่าแยกเป็นสองพยางค์/);
  }
  assert.equal(foundations.describe('aɪ').visual.lipsTo, 'unrounded');
  assert.equal(foundations.describe('aʊ').visual.lipsTo, 'rounded');
});

test('normalizes wrappers, stress, ties and common symbol spelling while preserving distinctions', () => {
  assert.deepEqual(foundations.describe('/ˈt͡ʃ/'), foundations.describe('tʃ'));
  assert.deepEqual(foundations.describe('[d͜ʒ]'), foundations.describe('dʒ'));
  assert.deepEqual(foundations.describe('ʧ'), foundations.describe('tʃ'));
  assert.deepEqual(foundations.describe('g'), foundations.describe('ɡ'));
  assert.deepEqual(foundations.describe('i:'), foundations.describe('iː'));
  assert.notDeepEqual(foundations.describe('i'), foundations.describe('iː'));
  assert.notDeepEqual(foundations.describe('r'), foundations.describe('ɹ'));
});

test('unknown composites, diacritics, inherited names and markup never receive a guessed diagram', () => {
  for (const value of ['ɑːɹ', 'aɪɚ', 'ɚ', 'ɝ', 'tʃɹ', 'qʰ', 'n̩', '__proto__',
    'constructor', 'toString', '<img src=x onerror=alert(1)>', '&lt;svg&gt;', 'x'.repeat(100), null, undefined, {}]) {
    const result = foundations.describe(value);
    assert.equal(result.known, false, String(value));
    assert.equal(result.visual, null);
    assert.equal(result.canSustain, null);
    assert.equal(result.compare, null);
    assert.deepEqual(result.sources, []);
    assert.match(result.tongue, /ไม่เดา/);
  }
  assert.equal(foundations.describe('<script>bad</script>').symbol, '');
  assert.equal(foundations.describe({toString() { throw new Error('Never coerce arbitrary objects'); }}).known, false);
});

test('nested edits by one renderer do not alter descriptions returned later', () => {
  const result = foundations.describe('l');
  result.steps[0] = 'wrong';
  result.visual.contact = false;
  result.compare.phone = 'wrong';
  result.sources.splice(0);
  const next = foundations.describe('l');
  assert.match(next.steps[0], /ปุ่มเหงือก/);
  assert.equal(next.visual.contact, true);
  assert.equal(next.compare.phone, 'ɹ');
  assert.ok(next.sources.length);
});
