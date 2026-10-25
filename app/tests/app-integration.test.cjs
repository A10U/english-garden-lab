'use strict';

/* JSDOM exercises DOM/events and classic-script wiring only. It does not render
 * the garden, run a real browser, or prove that an audio voice is audible. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const BASE = Date.parse('2026-10-24T09:00:00+07:00');
const DAY = 86400000;
const KEY = 'egl-progress-v1';

function source(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }

function boot({ startApp = false, saved = null, now = BASE, storageDenied = false,
  localVoice = false, cloudVoice = false, throwOnCancel = false, throwOnSpeak = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(source('index.html'), {
    url: 'http://localhost:8765/app/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  let clock = now;
  const DateOriginal = window.Date;
  window.Date = class extends DateOriginal {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  window.matchMedia = query => ({ matches: false, media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:test-export';
  window.URL.revokeObjectURL = () => {};
  const tts = { utterance: null, calls: 0 };
  // Optional voice objects/events below are stubs, never audible browser voices.
  window.speechSynthesis = {
    getVoices: () => localVoice ? [{ lang: 'en-US', localService: true, name: 'Stub local voice' }]
      : cloudVoice ? [{ lang: 'en-US', localService: false, name: 'Stub remote voice' }] : [],
    addEventListener() {}, removeEventListener() {},
    cancel() { if (throwOnCancel) throw new Error('Stub cancel failure'); },
    speak(utterance) {
      if (throwOnSpeak) throw new Error('Stub playback failure');
      tts.utterance = utterance; tts.calls++;
    }, speaking: false
  };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const prohibitedCalls = [];
  window.fetch = (...args) => { prohibitedCalls.push(['fetch', ...args]); throw new Error('Network is outside this local prototype test'); };
  window.navigator.mediaDevices = {
    getUserMedia: (...args) => { prohibitedCalls.push(['microphone', ...args]); throw new Error('Microphone is outside this prototype'); }
  };
  if (saved !== null) window.localStorage.setItem(KEY, saved);
  if (storageDenied) Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new Error('Stub storage denied'); }
  });
  for (const name of ['content.js', 'core.js', 'storage.js']) window.eval(source(name));
  if (startApp) {
    window.eval(source('garden.js'));
    window.eval(source('app.js'));
  }
  return { dom, window, document: window.document, errors, prohibitedCalls, tts,
    setNow(value) { clock = value; },
    saved() { return window.localStorage.getItem(KEY); },
    close() { window.close(); }
  };
}

test('classic scripts expose three content lessons and the browser core/storage APIs', t => {
  const b = boot(); t.after(() => b.close());
  assert.equal(typeof b.window.EGLCore.recordAnswer, 'function');
  assert.equal(typeof b.window.EGLStorage.createStore, 'function');
  const lessons = b.window.EGL_CONTENT.lessons;
  assert.equal(lessons.length, 3);
  assert.equal(new Set(lessons.map(l => l.id)).size, 3);
  for (const lesson of lessons) {
    for (const step of ['listen', 'read']) {
      assert.equal(lesson[step].choices.filter(c => c.id === lesson[step].correctId).length, 1);
    }
    for (const step of ['write', 'recall']) {
      assert.ok(lesson[step].accepted.length > 0);
      assert.ok(lesson[step].accepted.every(answer => typeof answer === 'string' && answer.trim()));
    }
    assert.ok(lesson.dialogue.choices.some(choice => choice.helpful === true));
  }
  assert.deepEqual(b.prohibitedCalls, []);
});

test('each real content lesson can complete through the classic core and persist a review schedule', t => {
  const b = boot(); t.after(() => b.close());
  const Core = b.window.EGLCore;
  const lessons = b.window.EGL_CONTENT.lessons;
  const store = b.window.EGLStorage.createStore({ lessonIds: lessons.map(l => l.id), now: BASE });
  let p = store.load().progress;
  for (const lesson of lessons) {
    for (const step of ['listen', 'read', 'write', 'recall', 'dialogue']) {
      const response = step === 'dialogue' ? lesson.dialogue.choices.find(c => c.helpful).id
        : ['listen', 'read'].includes(step) ? lesson[step].correctId : lesson[step].accepted[0];
      const correct = ['write', 'recall'].includes(step)
        ? Core.checkAnswer(response, lesson[step].accepted) : true;
      p = Core.recordAnswer(p, { lessonId: lesson.id, step, response, correct,
        assisted: false, modality: ['write', 'recall'].includes(step) ? 'text' : 'selection', now: BASE });
    }
    p = Core.markSpeaking(p, { lessonId: lesson.id, status: 'skipped', support: null, now: BASE });
    p = Core.completeLesson(p, lesson.id, BASE);
  }
  assert.equal(store.save(p).persistent, true);
  const reloaded = JSON.parse(b.saved());
  for (const lesson of lessons) {
    assert.equal(reloaded.lessons[lesson.id].speaking.status, 'skipped');
    assert.equal(Date.parse(reloaded.reviews[lesson.id].dueAt), BASE + DAY);
    assert.equal(Core.lessonResults(reloaded, lesson.id).answerCount, 4);
  }
  assert.equal(Core.getDueReviews(reloaded, BASE + DAY).length, 3);
});

test('local HTML declares local runtime script paths and does not reference the test dependencies', t => {
  const b = boot(); t.after(() => b.close());
  const scripts = [...b.document.querySelectorAll('script[src]')].map(el => el.getAttribute('src'));
  assert.ok(scripts.includes('app.js'));
  assert.ok(scripts.includes('content.js'));
  assert.ok(scripts.every(src => !/^(?:https?:)?\/\//i.test(src)));
  assert.ok(scripts.every(src => !/node_modules|jsdom/i.test(src)));
});

function click(b, selector) {
  const element = b.document.querySelector(selector);
  assert.ok(element, `missing control ${selector}`);
  assert.equal(element.disabled, false, `disabled control ${selector}`);
  element.click();
}

function step(b) {
  return Number(b.document.querySelector('[aria-current="step"]').dataset.step);
}

function submit(b, kind, response, formType = 'answer') {
  const form = b.document.querySelector(`form[data-form="${formType}"]${formType === 'answer' ? `[data-kind="${kind}"]` : ''}`);
  assert.ok(form, `missing ${formType}/${kind} form`);
  const input = form.querySelector('input[name="answer"]');
  assert.equal(input.disabled, false);
  input.value = response;
  form.dispatchEvent(new b.window.Event('submit', { bubbles: true, cancelable: true }));
}

function savedProgress(b) { return JSON.parse(b.saved()); }

function finishLesson(b, lesson) {
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  assert.equal(step(b), 0);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 1);
  assert.ok([...b.document.querySelectorAll('[data-kind="listen"][data-choice]')].every(el => el.disabled));
  click(b, '[data-action="hint"][data-kind="listen"]');
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 2);
  click(b, `[data-kind="read"][data-choice="${lesson.read.correctId}"]`);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 3);
  submit(b, 'write', lesson.write.accepted[0]);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 4);
  click(b, '[data-action="speaking"][data-support="skip"]');
  click(b, '[data-action="next"]');
  assert.equal(step(b), 5);
  const helpful = lesson.dialogue.choices.find(c => c.helpful);
  click(b, `[data-kind="dialogue"][data-choice="${helpful.id}"]`);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 6);
  submit(b, 'recall', lesson.recall.accepted[0]);
  click(b, '[data-action="next"]');
  assert.equal(step(b), 7);
  assert.ok(savedProgress(b).lessons[lesson.id].completedAt);
  click(b, '[data-action="home"]');
}

test('all three lessons complete through DOM controls with honest no-audio fallback and skipped speaking', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lessons = b.window.EGL_CONTENT.lessons;
  assert.equal(b.document.querySelectorAll('[data-action="start"]').length, 3);
  for (const lesson of lessons) finishLesson(b, lesson);
  const progress = savedProgress(b);
  for (const lesson of lessons) {
    const p = progress.lessons[lesson.id];
    assert.equal(p.speaking.status, 'skipped');
    assert.equal(p.answers.listen.first.assisted, true);
    assert.equal(p.answers.recall.first.assisted, false);
    const result = b.window.EGLCore.lessonResults(progress, lesson.id);
    assert.equal(result.firstCorrect, 4);
    assert.equal(result.firstIndependent, 3);
    assert.equal(result.answerCount, 4);
  }
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.prohibitedCalls, []);
});

test('leaving a partial lesson and reloading resumes its checkpoint and preserves first-attempt evidence', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="hint"][data-kind="listen"]');
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  click(b, '[data-action="next"]');
  const wrong = lesson.read.choices.find(c => c.id !== lesson.read.correctId);
  click(b, `[data-kind="read"][data-choice="${wrong.id}"]`);
  click(b, '[data-view="home"]');
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  assert.equal(step(b), 2);
  assert.equal(savedProgress(b).lessons[lesson.id].answers.read.first.correct, false);
  const reload = boot({ startApp: true, saved: b.saved() }); t.after(() => reload.close());
  click(reload, `[data-action="start"][data-lesson="${lesson.id}"]`);
  assert.equal(step(reload), 2);
  click(reload, `[data-kind="read"][data-choice="${lesson.read.correctId}"]`);
  const answer = savedProgress(reload).lessons[lesson.id].answers.read;
  assert.equal(answer.first.correct, false);
  assert.equal(answer.latest.correct, true);
  assert.equal(answer.attemptCount, 2);
  assert.equal(answer.latest.assisted, true);
  assert.deepEqual(reload.errors, []);
});

test('repeated submit events cannot count the same first answer twice', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="hint"][data-kind="listen"]');
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  click(b, '[data-action="next"]');
  click(b, `[data-kind="read"][data-choice="${lesson.read.correctId}"]`);
  click(b, '[data-action="next"]');
  submit(b, 'write', 'wrong');
  submit(b, 'write', 'wrong');
  assert.equal(savedProgress(b).lessons[lesson.id].answers.write.attemptCount, 1);
  b.setNow(BASE + 1000);
  submit(b, 'write', lesson.write.accepted[0]);
  assert.equal(savedProgress(b).lessons[lesson.id].answers.write.attemptCount, 2);
  const form = b.document.querySelector('form[data-form="answer"]');
  form.dispatchEvent(new b.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(savedProgress(b).lessons[lesson.id].answers.write.attemptCount, 2);
});

test('early review practice preserves the real schedule and a due review records only its first answer', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  finishLesson(b, lesson);
  const original = savedProgress(b).reviews[lesson.id];
  click(b, '[data-view="review"]');
  click(b, `[data-action="practice"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="review-hint"]');
  submit(b, 'review', lesson.recall.accepted[0], 'review');
  assert.deepEqual(savedProgress(b).reviews[lesson.id], original);
  click(b, '[data-action="review-close"]');
  b.setNow(BASE + DAY);
  click(b, '[data-view="home"]');
  click(b, '[data-view="review"]');
  click(b, `[data-action="review-start"][data-lesson="${lesson.id}"]`);
  submit(b, 'review', lesson.recall.accepted[0], 'review');
  const review = savedProgress(b).reviews[lesson.id];
  assert.equal(review.history.length, 1);
  assert.equal(review.stage, 1);
  assert.equal(Date.parse(review.dueAt), BASE + 4 * DAY);
  const form = b.document.querySelector('form[data-form="review"]');
  form.dispatchEvent(new b.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(savedProgress(b).reviews[lesson.id].history.length, 1);
});

async function chooseImport(b, text) {
  const input = b.document.querySelector('#import-file');
  assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: Buffer.byteLength(text), text: async () => text }] });
  input.dispatchEvent(new b.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
}

test('UI import validates before replacement, asks for confirmation and preserves current data on invalid input', async t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  finishLesson(b, lesson);
  const original = b.saved();
  click(b, '[data-view="progress"]');
  await chooseImport(b, '{bad json');
  assert.equal(b.saved(), original);
  assert.equal(b.document.querySelector('[data-action="import-confirm"]'), null);
  const future = { ...savedProgress(b), schemaVersion: 99 };
  await chooseImport(b, JSON.stringify(future));
  assert.equal(b.saved(), original);
  assert.equal(b.document.querySelector('[data-action="import-confirm"]'), null);
  const replacement = b.window.EGLCore.createProgress(BASE);
  await chooseImport(b, JSON.stringify(replacement));
  assert.ok(b.document.querySelector('[data-action="import-confirm"]'));
  assert.equal(b.saved(), original);
  click(b, '[data-action="import-cancel"]');
  assert.equal(b.saved(), original);
  await chooseImport(b, JSON.stringify(replacement));
  click(b, '[data-action="import-confirm"]');
  assert.deepEqual(savedProgress(b).lessons, {});
  assert.deepEqual(savedProgress(b).reviews, {});
  assert.deepEqual(b.prohibitedCalls, []);
});

test('imported answer text is displayed as text rather than executable markup', async t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const p = b.window.EGLCore.recordAnswer(b.window.EGLCore.createProgress(BASE), {
    lessonId: lesson.id, step: 'write', response: payload, correct: false, modality: 'text', now: BASE
  });
  click(b, '[data-view="progress"]');
  await chooseImport(b, JSON.stringify(p));
  click(b, '[data-action="import-confirm"]');
  assert.ok(b.document.querySelector('#screen').textContent.includes(payload));
  assert.equal(b.document.querySelector('#screen img[onerror]'), null);
  assert.equal(b.document.querySelector('#screen script'), null);
  assert.equal(b.window.__xss, undefined);
  assert.deepEqual(b.errors, []);
});

test('hint-before-answer evidence survives leaving the lesson and reloading', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="hint"][data-kind="listen"]');
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  click(b, '[data-action="next"]');
  click(b, `[data-kind="read"][data-choice="${lesson.read.correctId}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="hint"][data-kind="write"]');
  click(b, '[data-view="home"]');
  const reload = boot({ startApp: true, saved: b.saved() }); t.after(() => reload.close());
  click(reload, `[data-action="start"][data-lesson="${lesson.id}"]`);
  assert.equal(step(reload), 3);
  submit(reload, 'write', lesson.write.accepted[0]);
  assert.equal(savedProgress(reload).lessons[lesson.id].answers.write.first.assisted, true);
});

test('storage denial is visible in the UI while the learner can continue in memory', t => {
  const b = boot({ startApp: true, storageDenied: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  assert.match(b.document.querySelector('#save-status').textContent, /เก็บชั่วคราว/);
  assert.match(b.document.querySelector('#screen').textContent, /บันทึกถาวรไม่ได้/);
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="hint"][data-kind="listen"]');
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  click(b, '[data-view="home"]');
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  assert.equal(step(b), 1);
  assert.equal(b.document.querySelector('[data-action="next"]').disabled, false);
  assert.deepEqual(b.errors, []);
});

test('stub local audio unlocks listening choices only after its completion event', t => {
  const b = boot({ startApp: true, localVoice: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="audio"][data-purpose="listen"]');
  assert.equal(b.tts.calls, 1);
  assert.ok([...b.document.querySelectorAll('[data-kind="listen"][data-choice]')].every(el => el.disabled));
  b.tts.utterance.onstart();
  assert.ok([...b.document.querySelectorAll('[data-kind="listen"][data-choice]')].every(el => el.disabled));
  b.tts.utterance.onend();
  click(b, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  assert.equal(savedProgress(b).lessons[lesson.id].answers.listen.first.assisted, false);
  assert.deepEqual(b.prohibitedCalls, []);
});

test('a cancelled older utterance cannot unlock a listening item after returning home', t => {
  const b = boot({ startApp: true, localVoice: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="next"]');
  click(b, '[data-action="audio"][data-purpose="listen"]');
  const stale = b.tts.utterance;
  click(b, '[data-view="home"]');
  click(b, `[data-action="start"][data-lesson="${lesson.id}"]`);
  stale.onend();
  assert.equal(step(b), 1);
  assert.ok([...b.document.querySelectorAll('[data-kind="listen"][data-choice]')].every(el => el.disabled));
});

test('remote-only voices are not used and playback/cancel failures retain the text path', t => {
  const remote = boot({ startApp: true, cloudVoice: true }); t.after(() => remote.close());
  const lesson = remote.window.EGL_CONTENT.lessons[0];
  click(remote, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(remote, '[data-action="next"]');
  assert.equal(remote.document.querySelector('[data-action="audio"]').disabled, true);
  click(remote, '[data-action="hint"][data-kind="listen"]');
  click(remote, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  assert.equal(remote.tts.calls, 0);
  const failed = boot({ startApp: true, localVoice: true, throwOnCancel: true, throwOnSpeak: true });
  t.after(() => failed.close());
  click(failed, `[data-action="start"][data-lesson="${lesson.id}"]`);
  click(failed, '[data-action="next"]');
  click(failed, '[data-action="audio"][data-purpose="listen"]');
  assert.match(failed.document.querySelector('[data-voice-status]').textContent, /ข้อความแทน/);
  click(failed, '[data-action="hint"][data-kind="listen"]');
  click(failed, `[data-kind="listen"][data-choice="${lesson.listen.correctId}"]`);
  assert.equal(savedProgress(failed).lessons[lesson.id].answers.listen.first.assisted, true);
  assert.deepEqual(failed.errors, []);
});

test('a due-review hint survives home/reload and the assisted correct answer schedules one day without advancement', t => {
  const b = boot({ startApp: true }); t.after(() => b.close());
  const lesson = b.window.EGL_CONTENT.lessons[0];
  finishLesson(b, lesson);
  b.setNow(BASE + DAY);
  click(b, '[data-view="review"]');
  click(b, `[data-action="review-start"][data-lesson="${lesson.id}"]`);
  click(b, '[data-action="review-hint"]');
  click(b, '[data-view="home"]');
  const reload = boot({ startApp: true, saved: b.saved(), now: BASE + DAY });
  t.after(() => reload.close());
  click(reload, '[data-view="review"]');
  click(reload, `[data-action="review-start"][data-lesson="${lesson.id}"]`);
  submit(reload, 'review', lesson.recall.accepted[0], 'review');
  const review = savedProgress(reload).reviews[lesson.id];
  assert.equal(review.history.length, 1);
  assert.equal(review.history[0].correct, true);
  assert.equal(review.history[0].assisted, true);
  assert.equal(review.stage, 0);
  assert.equal(Date.parse(review.dueAt), BASE + 2 * DAY);
  assert.equal(Boolean(review.helpSeen), false);
  const finishedHint = reload.document.querySelector('[data-action="review-hint"]');
  assert.equal(finishedHint.disabled, true);
  finishedHint.click();
  assert.equal(Boolean(savedProgress(reload).reviews[lesson.id].helpSeen), false);
});

