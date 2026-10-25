const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const videos = require('../pronunciation-videos.js');

test('UMD exposes the same catalog without contacting a service or creating players', () => {
  const context = {};
  for (const name of ['fetch', 'document', 'navigator', 'Audio', 'XMLHttpRequest']) Object.defineProperty(context, name, {get() { throw new Error('must not load third-party media'); }});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pronunciation-videos.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.EGLPronunciationVideos.forPhone('ɪ'))), videos.forPhone('ɪ'));
});

test('core vowel demonstrations have validated IDs, complete watch URLs and official creator attribution', () => {
  const expected = {ɪ: 'DuK3A3pBQlc', 'iː': 'DuK3A3pBQlc', ʊ: 'ukKuV4fXdTA', 'uː': 'ukKuV4fXdTA',
    ɛ: 'UM9gPzKs1Hg', æ: 'UM9gPzKs1Hg', ʌ: 'eJPv2mJJwHQ', 'ɑː': 'eJPv2mJJwHQ',
    eɪ: 'XOuD6mFr6sQ', aɪ: 'rbQtAWNFy2I', oʊ: 'Civ7UBZP99M', aʊ: 'i8KThVR713Q', ɔɪ: '3cdSvIuTxLY', ə: '2BmkUa4Mv60'};
  for (const [phone, id] of Object.entries(expected)) {
    const list = videos.forPhone(phone);
    assert.equal(list.length, 1);
    const item = list[0];
    assert.equal(item.id, id);
    assert.match(item.id, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(item.url, 'https://www.youtube.com/watch?v=' + id);
    assert.equal(new URL(item.source).hostname, 'rachelsenglish.com');
    assert.equal(new URL(item.source).protocol, 'https:');
    assert.equal(item.creator, "Rachel's English");
    assert.equal(item.accent, 'en-us');
    assert.match(item.focusThai, /[ก-๙]/);
    assert.match(item.focusThai, /อเมริกัน/);
    assert.ok(item.title.length > 10);
    assert.equal(item.checked_on, '2026-10-25');
    assert.doesNotMatch(item.url, /autoplay|embed|results|search_query/);
  }
});

test('pair videos describe the actual contrasts and schwa video targets unstressed vowels', () => {
  assert.match(videos.forPhone('ɪ')[0].focusThai, /seat.*sit.*ไม่ใช่เพียงยาว/);
  assert.match(videos.forPhone('ʊ')[0].focusThai, /pool.*pull.*ห่อปาก/);
  assert.match(videos.forPhone('ɛ')[0].focusThai, /ɛ.*æ.*bat–bet/);
  assert.match(videos.forPhone('ʌ')[0].focusThai, /cop–cup.*ไม่ใช่.*ɒ/);
  assert.match(videos.forPhone('ə')[0].focusThai, /ไม่เน้น.*about/);
});

test('British-specific, unsupported and composite phones never get a mislabeled American lesson', () => {
  for (const value of ['ɒ', 'ɔ', 'ɔː', 'ɜː', 'əʊ', 'ɐ', 'ɪə', 'eə', 'ʊə', 'ɑːɹ', 'ɚ', 'ɝ',
    '__proto__', 'constructor', 'toString', '<iframe src=x>', '&lt;svg&gt;', null, undefined, {}, 'x'.repeat(100)]) {
    assert.equal(videos.forPhone(value), null);
  }
  assert.equal(videos.forPhone({toString() { throw new Error('never coerce'); }}), null);
});

test('normalizes wrapper/stress/length notation and returns detached descriptors', () => {
  assert.deepEqual(videos.forPhone('/ˈɪ/'), videos.forPhone('ɪ'));
  assert.deepEqual(videos.forPhone('[i:]'), videos.forPhone('iː'));
  assert.deepEqual(videos.forPhone('i'), videos.forPhone('iː'));
  const result = videos.forPhone('aɪ');
  result[0].url = 'https://example.com'; result.push({id: 'bad'});
  assert.equal(videos.forPhone('aɪ').length, 1);
  assert.equal(videos.forPhone('aɪ')[0].url, 'https://www.youtube.com/watch?v=rbQtAWNFy2I');
});
