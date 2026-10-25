const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const images = require('../articulation-images.js');
const directory = path.join(__dirname, '../assets/articulation');
const attribution = JSON.parse(fs.readFileSync(path.join(directory, 'ATTRIBUTION.json'), 'utf8'));

test('browser and CommonJS provide the same descriptor without document-dependent paths', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../articulation-images.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.EGLArticulationImages.describe('f'))), images.describe('f'));
  for (const scriptURL of ['https://a10u.github.io/english-garden-lab/app/phonetics.js', 'https://example.org/nested/demo/app/phonetics.js']) {
    const resolved = new URL(images.describe('f').src, scriptURL);
    assert.equal(resolved.href, scriptURL.replace('phonetics.js', 'assets/articulation/f.svg'));
  }
});

test('all published descriptors refer to downloaded originals with exact attribution and bytes', () => {
  assert.equal(attribution.assets.length, 20);
  const actualSVGs = fs.readdirSync(directory).filter(file => file.endsWith('.svg')).sort();
  assert.deepEqual(actualSVGs, attribution.assets.map(asset => asset.filename).sort());
  for (const asset of attribution.assets) {
    const descriptor = images.describe(asset.phone);
    assert.ok(descriptor, asset.phone);
    assert.equal(descriptor.src, `assets/articulation/${asset.filename}`);
    assert.match(descriptor.altThai, /[ก-๙]/);
    assert.match(descriptor.captionThai, /[ก-๙]/);
    for (const field of ['author', 'source', 'license', 'licenseURL', 'changes']) assert.equal(descriptor[field], asset[field]);
    assert.equal(descriptor.changes, 'unmodified');
    assert.match(descriptor.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(['CC BY-SA 4.0', 'CC BY 3.0', 'CC0'].includes(descriptor.license));
    assert.match(descriptor.licenseURL, /^https:\/\/creativecommons\.org\//);
    const bytes = fs.readFileSync(path.join(directory, asset.filename));
    assert.equal(bytes.byteLength, asset.bytes);
    assert.equal(crypto.createHash('sha1').update(bytes).digest('hex'), asset.commonsSHA1);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
});

test('SVGs contain no active or externally loaded content', () => {
  for (const asset of attribution.assets) {
    const raw = fs.readFileSync(path.join(directory, asset.filename), 'utf8');
    assert.doesNotMatch(raw, /<!DOCTYPE|<!ENTITY|@import|url\(\s*["']?(?:https?:|\/\/|data:)/i);
    const dom = new JSDOM(raw, { contentType: 'image/svg+xml' });
    assert.equal(dom.window.document.documentElement.localName, 'svg');
    for (const element of dom.window.document.querySelectorAll('*')) {
      assert.ok(!['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video'].includes(element.localName.toLowerCase()));
      for (const attribute of element.attributes) {
        assert.doesNotMatch(attribute.localName, /^on/i);
        if (attribute.localName === 'href') assert.match(attribute.value, /^#/);
      }
    }
    dom.window.close();
  }
});

test('exact sound images distinguish voicing and explain vowel and lateral illustration limits', () => {
  assert.notEqual(images.describe('f').src, images.describe('v').src);
  assert.match(images.describe('f').captionThai, /เส้นเสียงไม่สั่น/);
  assert.match(images.describe('v').captionThai, /เส้นเสียงสั่น/);
  assert.notEqual(images.describe('iː').src, images.describe('ɪ').src);
  assert.match(images.describe('iː').captionThai, /ต้นฉบับ.*\/i\//);
  assert.match(images.describe('iː').captionThai, /ไม่แสดงความยาวเสียง/);
  assert.match(images.describe('ɪ').captionThai, /ไม่ใช่แค่.*สั้น/);
  assert.match(images.describe('l').captionThai, /สองแบบ/);
  assert.doesNotMatch(images.describe('iː').captionThai, /หันหน้าไปทาง/);
});

test('normalizes only known notation and returns null for unsupported sounds', () => {
  assert.deepEqual(images.describe('/ˈiː/'), images.describe('iː'));
  assert.deepEqual(images.describe('g'), images.describe('ɡ'));
  for (const input of ['ɹ', 'əl', 'ɑːɹ', 'ɪː', 'unknown', '__proto__', '<img>', null, undefined, { toString() { throw Error('no coercion'); } }]) {
    assert.equal(images.describe(input), null);
  }
  const original = images.describe('f'); original.author = 'changed';
  assert.equal(images.describe('f').author, 'Tavin, Nardog');
});
