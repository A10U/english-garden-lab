'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Storage = require('../storage.js');

const BASE = Date.parse('2026-10-24T09:00:00+07:00');
const KEY = 'test-egl-progress';
const LESSON = 'garden';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); }
  };
}

function createStore(storage) {
  return Storage.createStore({ storage, key: KEY, lessonIds: [LESSON], now: () => BASE });
}

function progressWithAnswer(response = 'leaf') {
  return Core.recordAnswer(Core.createProgress(BASE), {
    lessonId: LESSON, step: 'write', response, correct: true,
    assisted: false, modality: 'text', now: BASE
  });
}

test('save/load/export round trip preserves progress in durable storage', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  const p = progressWithAnswer();
  const saved = store.save(p);
  assert.equal(saved.persistent, true);
  assert.deepEqual(saved.progress, p);
  const reloaded = createStore(storage).load();
  assert.equal(reloaded.persistent, true);
  assert.deepEqual(reloaded.progress, p);
  assert.deepEqual(JSON.parse(store.exportData()), p);
});

test('valid explicit import replaces current progress after validation', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  store.save(progressWithAnswer('before'));
  const replacement = progressWithAnswer('after');
  const imported = store.importData(JSON.stringify(replacement));
  assert.deepEqual(imported.progress, replacement);
  assert.deepEqual(store.load().progress, replacement);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), replacement);
});

test('malformed JSON import does not replace memory or durable progress', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  const original = progressWithAnswer('keep this');
  store.save(original);
  const rawBefore = storage.getItem(KEY);
  assert.throws(() => store.importData('{"broken":'));
  assert.deepEqual(store.load().progress, original);
  assert.equal(storage.getItem(KEY), rawBefore);
});

test('unsupported schema and unknown lesson imports leave current data intact', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  const original = progressWithAnswer('keep this');
  store.save(original);
  const rawBefore = storage.getItem(KEY);
  const nextSchema = { ...original, schemaVersion: 99 };
  const unknown = JSON.parse(JSON.stringify(original));
  unknown.lessons['unknown-lesson'] = unknown.lessons[LESSON];
  for (const invalid of [nextSchema, unknown, { appId: 'wrong', schemaVersion: 1 }]) {
    assert.throws(() => store.importData(JSON.stringify(invalid)));
    assert.deepEqual(store.load().progress, original);
    assert.equal(storage.getItem(KEY), rawBefore);
  }
});

test('blocked storage falls back to memory with a visible warning and working export', () => {
  const denied = {
    getItem() { throw Object.assign(new Error('storage denied'), { name: 'SecurityError' }); },
    setItem() { throw Object.assign(new Error('storage denied'), { name: 'SecurityError' }); }
  };
  const store = createStore(denied);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.equal(typeof loaded.warning, 'string');
  assert.ok(loaded.warning.length > 0);
  const p = progressWithAnswer();
  const saved = store.save(p);
  assert.equal(saved.persistent, false);
  assert.ok(saved.warning);
  assert.deepEqual(store.load().progress, p);
  assert.deepEqual(JSON.parse(store.exportData()), p);
});

test('quota failure keeps the newly saved progress in memory instead of reverting to old durable data', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  store.save(progressWithAnswer('old durable answer'));
  const durableBefore = storage.getItem(KEY);
  storage.setItem = () => { throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' }); };
  const latest = progressWithAnswer('latest memory answer');
  const saved = store.save(latest);
  assert.equal(saved.persistent, false);
  assert.ok(saved.warning);
  assert.equal(storage.getItem(KEY), durableBefore);
  assert.deepEqual(store.load().progress, latest);
  assert.deepEqual(JSON.parse(store.exportData()), latest);
});

test('corrupt durable JSON is preserved for recovery and subsequent saves stay memory-only', () => {
  const corrupt = '{"unclosed":';
  const storage = fakeStorage({ [KEY]: corrupt });
  const store = createStore(storage);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.ok(loaded.warning);
  assert.equal(store.getRecovery(), corrupt);
  const p = progressWithAnswer('memory while corrupt');
  store.save(p);
  assert.equal(storage.getItem(KEY), corrupt);
  assert.deepEqual(store.load().progress, p);
  assert.equal(store.getRecovery(), corrupt);
});

test('a valid explicit import can recover from a corrupt durable record', () => {
  const storage = fakeStorage({ [KEY]: '{corrupt' });
  const store = createStore(storage);
  store.load();
  const valid = progressWithAnswer('recovered');
  const imported = store.importData(JSON.stringify(valid));
  assert.equal(imported.persistent, true);
  assert.deepEqual(store.load().progress, valid);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), valid);
  assert.equal(store.getRecovery(), null);
});

test('invalid durable schema is preserved instead of being silently reset', () => {
  const raw = JSON.stringify({ appId: 'english-garden-lab', schemaVersion: 999 });
  const storage = fakeStorage({ [KEY]: raw });
  const store = createStore(storage);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.ok(loaded.warning);
  assert.equal(store.getRecovery(), raw);
  assert.equal(storage.getItem(KEY), raw);
});

test('a completed lesson with a later wrong replay survives durable save and explicit import', () => {
  let p = Core.createProgress(BASE);
  for (const step of ['listen', 'read', 'write', 'recall', 'dialogue']) {
    p = Core.recordAnswer(p, {
      lessonId: LESSON, step, response: 'first correct', correct: true, now: BASE
    });
  }
  p = Core.markSpeaking(p, { lessonId: LESSON, status: 'skipped', now: BASE });
  p = Core.completeLesson(p, LESSON, BASE);
  p = Core.recordAnswer(p, {
    lessonId: LESSON, step: 'write', response: 'replay wrong', correct: false, now: BASE + 1000
  });
  const storage = fakeStorage();
  const store = createStore(storage);
  store.save(p);
  const copy = createStore(storage);
  assert.deepEqual(copy.load().progress, p);
  const other = createStore(fakeStorage());
  other.importData(copy.exportData());
  assert.deepEqual(other.load().progress, p);
});

