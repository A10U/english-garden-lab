'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const BASE = Date.parse('2026-10-24T09:00:00+07:00');
const DAY = 24 * 60 * 60 * 1000;
const LESSON = 'garden';
const asMs = value => Date.parse(value);
const snapshot = value => JSON.parse(JSON.stringify(value));

function freezeDeep(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  });
  return value;
}

function answer(progress, step, patch = {}) {
  return Core.recordAnswer(progress, {
    lessonId: LESSON, step, response: `answer-${step}`, correct: true,
    assisted: false, modality: 'selection', now: BASE, ...patch
  });
}

function readyLesson() {
  let progress = Core.createProgress(BASE);
  for (const step of ['listen', 'read', 'write', 'recall', 'dialogue']) {
    progress = answer(progress, step, { modality: step === 'write' ? 'text' : 'selection' });
  }
  return Core.markSpeaking(progress, {
    lessonId: LESSON, status: 'skipped', support: null, now: BASE
  });
}

test('new progress identifies the app/schema and stores deterministic ISO dates', () => {
  const p = Core.createProgress(BASE);
  assert.equal(p.appId, 'english-garden-lab');
  assert.equal(p.schemaVersion, 1);
  assert.equal(asMs(p.createdAt), BASE);
  assert.equal(asMs(p.updatedAt), BASE);
  assert.deepEqual(p.lessons, {});
  assert.deepEqual(p.reviews, {});
});

test('answer comparison tolerates case, surrounding/repeated spaces and final punctuation', () => {
  for (const value of ['This is a leaf.', '  THIS   is a LEAF  ', 'This is a leaf .']) {
    assert.equal(Core.checkAnswer(value, ['This is a leaf.']), true, value);
  }
  assert.equal(Core.normalizeAnswer('  Leaf!  '), 'leaf');
});

test('answer comparison does not accept substrings or an empty answer', () => {
  for (const value of ['', '   ', 'leaf', 'This is not a leaf.', 'This is a flower.']) {
    assert.equal(Core.checkAnswer(value, ['This is a leaf.']), false, value);
  }
  assert.equal(Core.checkAnswer('I like plants.', ['I like plants.', 'I like my plant.']), true);
});

test('recordAnswer is pure and records first/latest separately', () => {
  const original = freezeDeep(Core.createProgress(BASE));
  const originalCopy = snapshot(original);
  const next = answer(original, 'read', { response: 'wrong', correct: false });
  assert.deepEqual(original, originalCopy);
  assert.notEqual(next, original);
  assert.equal(next.lessons[LESSON].answers.read.first.response, 'wrong');
  assert.equal(next.lessons[LESSON].answers.read.attemptCount, 1);
});

test('correcting a wrong answer keeps first-attempt evidence and increments attempts', () => {
  let p = answer(Core.createProgress(BASE), 'write', {
    response: 'wrong', correct: false, modality: 'text'
  });
  const first = snapshot(p.lessons[LESSON].answers.write.first);
  p = answer(p, 'write', { response: 'correct', modality: 'text', now: BASE + 1000 });
  assert.deepEqual(p.lessons[LESSON].answers.write.first, first);
  assert.equal(p.lessons[LESSON].answers.write.latest.correct, true);
  assert.equal(p.lessons[LESSON].answers.write.latest.response, 'correct');
  assert.equal(p.lessons[LESSON].answers.write.attemptCount, 2);
  const result = Core.lessonResults(p, LESSON);
  assert.equal(result.firstCorrect, 0);
  assert.equal(result.firstIndependent, 0);
  assert.equal(result.answerCount, 1);
});

test('using a hint is separate from answering correctly on the first attempt', () => {
  const p = answer(Core.createProgress(BASE), 'listen', { assisted: true });
  const result = Core.lessonResults(p, LESSON);
  assert.equal(result.firstCorrect, 1);
  assert.equal(result.firstIndependent, 0);
  assert.equal(result.assistedSteps, 1);
  assert.equal(p.lessons[LESSON].answers.listen.first.assisted, true);
});

test('a later hint cannot rewrite an earlier independent first answer', () => {
  const before = answer(Core.createProgress(BASE), 'read');
  const first = snapshot(before.lessons[LESSON].answers.read.first);
  const after = answer(before, 'read', { assisted: true, now: BASE + 2000 });
  assert.deepEqual(after.lessons[LESSON].answers.read.first, first);
  assert.equal(Core.lessonResults(after, LESSON).firstIndependent, 1);
  assert.equal(after.lessons[LESSON].answers.read.latest.assisted, true);
});

test('speaking self practice is recorded without becoming an automatic language score', () => {
  const original = Core.createProgress(BASE);
  const p = Core.markSpeaking(original, {
    lessonId: LESSON, status: 'self_practiced', support: 'model', now: BASE
  });
  const result = Core.lessonResults(p, LESSON);
  assert.equal(result.speaking, 'self_practiced');
  assert.equal(result.answerCount, 0);
  assert.equal(result.firstCorrect, 0);
  assert.equal(result.firstIndependent, 0);
  assert.equal(Object.hasOwn(p.lessons[LESSON].speaking, 'score'), false);
  assert.deepEqual(original.lessons, {});
});

test('skipping speaking remains skipped and contributes no scored answers', () => {
  const p = Core.markSpeaking(Core.createProgress(BASE), {
    lessonId: LESSON, status: 'skipped', support: null, now: BASE
  });
  const result = Core.lessonResults(p, LESSON);
  assert.equal(result.speaking, 'skipped');
  assert.equal(result.answerCount, 0);
  assert.equal(result.firstCorrect, 0);
  assert.equal(result.firstIndependent, 0);
  assert.equal(Core.lessonResults(Core.createProgress(BASE), LESSON).speaking, 'not_assessed');
});

test('dialogue choices are participation rather than automatic speaking scores', () => {
  const p = answer(Core.createProgress(BASE), 'dialogue');
  const result = Core.lessonResults(p, LESSON);
  assert.equal(result.answerCount, 0);
  assert.equal(result.firstCorrect, 0);
  assert.equal(result.firstIndependent, 0);
});

test('incomplete lesson completion is rejected without mutation', () => {
  const p = answer(Core.createProgress(BASE), 'listen');
  const original = snapshot(p);
  assert.throws(() => Core.completeLesson(p, LESSON, BASE));
  assert.deepEqual(p, original);
});

test('all required activities plus a speaking choice permit completion and a one-day review', () => {
  const p = Core.completeLesson(readyLesson(), LESSON, BASE);
  assert.equal(asMs(p.lessons[LESSON].completedAt), BASE);
  assert.equal(asMs(p.reviews[LESSON].dueAt), BASE + DAY);
  assert.equal(p.reviews[LESSON].stage, 0);
  assert.equal(Core.lessonResults(p, LESSON).completed, true);
  assert.equal(Core.lessonResults(p, LESSON).answerCount, 4);
  assert.equal(Core.lessonResults(p, LESSON).speaking, 'skipped');
  assert.equal(Core.lessonResults(p, LESSON).independentRecall, true);
});

test('completion repeated later keeps the original completion and review schedule', () => {
  const p = Core.completeLesson(readyLesson(), LESSON, BASE);
  const completedAt = p.lessons[LESSON].completedAt;
  const originalReview = snapshot(p.reviews[LESSON]);
  const again = Core.completeLesson(p, LESSON, BASE + 12 * DAY);
  assert.equal(again.lessons[LESSON].completedAt, completedAt);
  assert.deepEqual(again.reviews[LESSON], originalReview);
});

test('review is due at the due timestamp and not one millisecond earlier', () => {
  const p = Core.completeLesson(readyLesson(), LESSON, BASE);
  assert.equal(Core.getDueReviews(p, BASE + DAY - 1).length, 0);
  assert.equal(Core.getDueReviews(p, BASE + DAY).length, 1);
});

test('correct independent reviews progress to three, seven and recurring seven-day delays', () => {
  let p = Core.completeLesson(readyLesson(), LESSON, BASE);
  for (const [reviewId, at, delay] of [
    ['r1', BASE + DAY, 3], ['r2', BASE + 4 * DAY, 7], ['r3', BASE + 11 * DAY, 7]
  ]) {
    p = Core.recordReview(p, {
      lessonId: LESSON, reviewId, response: 'leaf', correct: true, assisted: false, now: at
    });
    assert.equal(asMs(p.reviews[LESSON].dueAt), at + delay * DAY, reviewId);
  }
  assert.equal(p.reviews[LESSON].history.length, 3);
});

test('wrong and assisted reviews are scheduled after one day instead of advancing recall', () => {
  const completed = Core.completeLesson(readyLesson(), LESSON, BASE);
  for (const patch of [{ correct: false, assisted: false }, { correct: true, assisted: true }]) {
    const p = Core.recordReview(completed, {
      lessonId: LESSON, reviewId: 'retry', response: 'leaf', now: BASE + DAY, ...patch
    });
    assert.equal(asMs(p.reviews[LESSON].dueAt), BASE + 2 * DAY);
    assert.equal(p.reviews[LESSON].stage, 0);
  }
});

test('reusing a review ID preserves the original response and does not advance twice', () => {
  const completed = Core.completeLesson(readyLesson(), LESSON, BASE);
  const first = Core.recordReview(completed, {
    lessonId: LESSON, reviewId: 'same', response: 'first wrong', correct: false,
    assisted: false, now: BASE + DAY
  });
  const again = Core.recordReview(first, {
    lessonId: LESSON, reviewId: 'same', response: 'second correct', correct: true,
    assisted: false, now: BASE + 2 * DAY
  });
  assert.deepEqual(again.reviews[LESSON], first.reviews[LESSON]);
  assert.equal(again.reviews[LESSON].history.length, 1);
});

test('checkpoint and settings updates do not mutate existing progress', () => {
  const original = freezeDeep(Core.createProgress(BASE));
  const checkpoint = Core.setCheckpoint(original, LESSON, 2, BASE + 1000);
  assert.equal(checkpoint.lessons[LESSON].checkpoint, 2);
  assert.deepEqual(original.lessons, {});
  const settings = Core.updateSettings(checkpoint, { companion: 'kwak', motion: 'reduce' }, BASE + 2000);
  assert.equal(settings.settings.companion, 'kwak');
  assert.equal(settings.settings.motion, 'reduce');
  assert.equal(checkpoint.settings.companion, 'mali');
});

test('validator rejects other apps, future schemas, and unknown lesson IDs', () => {
  const valid = Core.completeLesson(readyLesson(), LESSON, BASE);
  for (const mutate of [
    p => { p.appId = 'another-app'; },
    p => { p.schemaVersion = 999; },
    p => { p.lessons['unknown-lesson'] = p.lessons[LESSON]; }
  ]) {
    const p = snapshot(valid); mutate(p);
    assert.throws(() => Core.validateProgress(p, [LESSON]));
  }
});

test('validator returns an independent whitelisted clone of a valid export', () => {
  const p = Core.completeLesson(readyLesson(), LESSON, BASE);
  p.untrustedExtra = 'remove-me';
  const clean = Core.validateProgress(p, [LESSON]);
  assert.equal(Object.hasOwn(clean, 'untrustedExtra'), false);
  assert.equal(clean.lessons[LESSON].completedAt, p.lessons[LESSON].completedAt);
  clean.settings.companion = 'none';
  assert.equal(p.settings.companion, 'mali');
});

test('replaying a completed lesson can record a wrong answer without erasing historical completion', () => {
  const completed = Core.completeLesson(readyLesson(), LESSON, BASE);
  const replay = answer(completed, 'write', {
    response: 'wrong during later practice', correct: false, now: BASE + DAY
  });
  const valid = Core.validateProgress(replay, [LESSON]);
  assert.equal(valid.lessons[LESSON].answers.write.latest.correct, false);
  assert.equal(valid.lessons[LESSON].answers.write.first.correct, true);
  assert.equal(valid.lessons[LESSON].completedAt, completed.lessons[LESSON].completedAt);
  assert.deepEqual(valid.reviews[LESSON], completed.reviews[LESSON]);
  const completedAgain = Core.completeLesson(valid, LESSON, BASE + 2 * DAY);
  assert.deepEqual(completedAgain, valid);
});

test('a hint is persisted without fabricating an answer and survives validation before the first attempt', () => {
  const original = freezeDeep(Core.createProgress(BASE));
  const p = Core.markHint(original, LESSON, 'write', BASE + 1000);
  assert.deepEqual(original.lessons, {});
  assert.equal(p.lessons[LESSON].helpSeen.write, true);
  assert.deepEqual(p.lessons[LESSON].answers, {});
  const imported = Core.validateProgress(p, [LESSON]);
  assert.equal(imported.lessons[LESSON].helpSeen.write, true);
  assert.equal(Core.lessonResults(imported, LESSON).answerCount, 0);
  assert.throws(() => Core.markHint(p, LESSON, 'unknown-step', BASE));
});

