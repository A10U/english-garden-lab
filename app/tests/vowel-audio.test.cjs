const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const audio = require('../vowel-audio.js');
const directory = path.join(__dirname, '../assets/vowels');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));

test('all twelve complete OGG assets match published hash, license, and descriptor metadata', () => {
  assert.equal(manifest.recordings.length, 12);
  assert.deepEqual(manifest.recordings.map(record => record.symbol).sort(), ['ɪ', 'i', 'ʊ', 'u', 'ɛ', 'æ', 'ʌ', 'ɑ', 'ə', 'ɔ', 'ɒ', 'ɜ'].sort());
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.ogg')).sort(), manifest.recordings.map(record => record.filename).sort());
  for (const record of manifest.recordings) {
    const bytes = fs.readFileSync(path.join(directory, record.filename));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'OggS');
    assert.equal(bytes.byteLength, record.bytes);
    assert.equal(crypto.createHash('sha1').update(bytes).digest('hex'), record.commonsSHA1);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(record.changes, 'unmodified');
    assert.equal(record.whole_recording, true);
    assert.ok(record.duration_seconds > .2 && record.duration_seconds < 5);
    assert.equal(record.sample_rate, 44100);
    assert.ok([1, 2].includes(record.channels));
    const result = audio.forPhone(record.symbol);
    assert.equal(result.audioSymbol, record.symbol);
    assert.equal(result.symbol, record.symbol);
    assert.equal(result.url, 'assets/vowels/' + record.filename);
    assert.ok(result.caption.includes('/' + record.symbol + '/'));
    for (const key of ['author', 'source', 'license', 'licenseURL']) assert.equal(result[key], record[key]);
    assert.equal(result.license, 'CC BY-SA 3.0');
    assert.match(result.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(result.licenseURL, /^https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\//);
  }
});

test('long-symbol aliases explicitly preserve actual recorded quality rather than claiming English duration', () => {
  for (const [symbol, base] of [['iː', 'i'], ['uː', 'u'], ['ɑː', 'ɑ'], ['ɔː', 'ɔ'], ['ɜː', 'ɜ']]) {
    const result = audio.forPhone(symbol);
    assert.equal(result.symbol, symbol);
    assert.equal(result.audioSymbol, base);
    assert.equal(result.caption, audio.forPhone(base).caption);
    assert.match(result.note, /คุณภาพ/);
    assert.match(result.note, /ไม่ได้ยืนยันระยะเสียงยาว/);
    assert.deepEqual(audio.forPhone(symbol.replace('ː', ':')), result);
  }
  assert.match(audio.forPhone('ʌ').note, /ไม่ใช่เสียง STRUT.*ทุกสำเนียง/);
});

test('dictionary e aliases only actual epsilon and labels the difference from cardinal e', () => {
  const result = audio.forPhone('e');
  assert.equal(result.symbol, 'e');
  assert.equal(result.audioSymbol, 'ɛ');
  assert.equal(result.caption, audio.forPhone('ɛ').caption);
  assert.match(result.caption, /\/ɛ\//);
  assert.match(result.note, /พจนานุกรมอังกฤษ.*bed/);
  assert.match(result.note, /ไม่ใช่สระอ้างอิงมาตรฐาน \[e\]/);
  assert.equal(audio.forPhone('eː'), null);
});

test('diphthongs, unsupported symbols, and arbitrary objects never invent an isolated recording', () => {
  for (const value of ['eɪ', 'aɪ', 'oʊ', 'aʊ', 'ɔɪ', 'ɹ', 'ɚ', 'ɜːɹ', 'iːː', '__proto__', '<img>', null, undefined,
    { toString() { throw Error('must not coerce'); } }]) assert.equal(audio.forPhone(value), null);
  assert.deepEqual(audio.forPhone('/ˈi:/'), audio.forPhone('iː'));
  const first = audio.forPhone('ɪ'); first.note = 'changed';
  assert.notEqual(audio.forPhone('ɪ').note, 'changed');
});

test('browser module initializes without audio creation, network calls, or document URL dependence', () => {
  let requests = 0;
  const forbidden = () => { requests++; throw Error('unexpected I/O'); };
  const context = { fetch: forbidden, XMLHttpRequest: forbidden, Audio: forbidden };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vowel-audio.js'), 'utf8'), context);
  const result = context.EGLVowelAudio.forPhone('ɪ');
  assert.equal(requests, 0);
  assert.equal(result.url, audio.forPhone('ɪ').url);
  for (const scriptURL of ['https://a10u.github.io/english-garden-lab/app/phonetics.js', 'https://example.test/nested/app/phonetics.js']) {
    assert.equal(new URL(result.url, scriptURL).href, scriptURL.replace('phonetics.js', 'assets/vowels/vowel-ih.ogg'));
  }
});
