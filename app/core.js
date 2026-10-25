(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const APP_ID = 'english-garden-lab';
  const STEPS = ['listen', 'read', 'write', 'dialogue', 'recall'];
  const REQUIRED = ['listen', 'read', 'write', 'recall'];
  const MODES = ['selection', 'text', 'speech', 'self'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const stamp = now => {
    const d = new Date(now === undefined ? Date.now() : now);
    if (!Number.isFinite(d.getTime())) throw new Error('เวลาไม่ถูกต้อง');
    return d.toISOString();
  };
  function createProgress(now) {
    const at = stamp(now);
    return {appId: APP_ID, schemaVersion: 1, createdAt: at, updatedAt: at,
      settings: {companion: 'mali', motion: 'system', voiceRate: 0.85}, lessons: {}, reviews: {}};
  }
  function normalizeAnswer(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').replace(/[’‘]/g, "'").trim().toLowerCase()
      .replace(/,/g, ' ').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function checkAnswer(value, accepted) {
    const normalized = normalizeAnswer(value);
    return normalized !== '' && Array.isArray(accepted) && accepted.some(a => normalizeAnswer(a) === normalized);
  }
  function validId(id) { return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(id); }
  function ensureLesson(p, id) {
    if (!validId(id)) throw new Error('รหัสบทเรียนไม่ถูกต้อง');
    if (!Object.hasOwn(p.lessons, id)) p.lessons[id] = {contentVersion: '1.0.0', helpSeen: {}, answers: {}, speaking: {status: 'not_assessed', support: null, at: null}, checkpoint: 0, completedAt: null};
    return p.lessons[id];
  }
  function recordAnswer(progress, input) {
    const {lessonId, step, response, correct, assisted = false, modality = 'selection', now} = input;
    if (!STEPS.includes(step) || typeof correct !== 'boolean' || typeof assisted !== 'boolean' || !MODES.includes(modality)) throw new Error('รูปแบบคำตอบไม่ถูกต้อง');
    if (typeof response !== 'string' || response.length > 600) throw new Error('คำตอบต้องเป็นข้อความไม่เกิน 600 ตัวอักษร');
    const p = clone(progress), lesson = ensureLesson(p, lessonId), at = stamp(now);
    const attempt = {response, correct, assisted, modality, at};
    const existing = lesson.answers[step];
    lesson.answers[step] = {first: existing ? existing.first : clone(attempt), latest: attempt, attemptCount: Math.min(1000000, (existing ? existing.attemptCount : 0) + 1)};
    p.updatedAt = at;
    return p;
  }
  function markHint(progress, lessonId, step, now) {
    if (!STEPS.includes(step)) throw new Error('ประเภทคำช่วยไม่ถูกต้อง');
    const p = clone(progress), lesson = ensureLesson(p, lessonId);
    if (!lesson.helpSeen) lesson.helpSeen = {};
    lesson.helpSeen[step] = true; p.updatedAt = stamp(now); return p;
  }
  function markSpeaking(progress, {lessonId, status, support = null, now}) {
    if (!['self_practiced', 'skipped'].includes(status) || ![null, 'model', 'independent'].includes(support)) throw new Error('สถานะฝึกพูดไม่ถูกต้อง');
    const p = clone(progress), l = ensureLesson(p, lessonId), at = stamp(now);
    l.speaking = {status, support: status === 'skipped' ? null : support, at};
    p.updatedAt = at;
    return p;
  }
  function setCheckpoint(progress, lessonId, stepIndex, now) {
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > 7) throw new Error('ขั้นบทเรียนไม่ถูกต้อง');
    const p = clone(progress); ensureLesson(p, lessonId).checkpoint = stepIndex; p.updatedAt = stamp(now); return p;
  }
  function completeLesson(progress, lessonId, now) {
    const l = progress.lessons[lessonId];
    if (l?.completedAt) return clone(progress);
    if (!l || !REQUIRED.every(s => l.answers[s]?.latest.correct) || !l.answers.dialogue || l.speaking.status === 'not_assessed') throw new Error('ยังมีกิจกรรมที่ไม่ได้ทำ กรุณาทำให้ครบก่อน');
    const p = clone(progress), at = stamp(now);
    p.lessons[lessonId].completedAt = at; p.lessons[lessonId].checkpoint = 7; p.updatedAt = at;
    if (!p.reviews[lessonId]) p.reviews[lessonId] = {stage: 0, dueAt: stamp(new Date(at).getTime() + DAY), history: []};
    return p;
  }
  function recordReview(progress, {lessonId, reviewId, response, correct, assisted = false, now}) {
    if (!progress.lessons[lessonId]?.completedAt || !progress.reviews[lessonId]) throw new Error('ทำบทเรียนก่อนเริ่มบันทึกการทบทวน');
    if (typeof reviewId !== 'string' || !reviewId || reviewId.length > 180 || typeof response !== 'string' || response.length > 600 || typeof correct !== 'boolean' || typeof assisted !== 'boolean') throw new Error('ข้อมูลทบทวนไม่ถูกต้อง');
    const review = progress.reviews[lessonId];
    if (review.history.some(h => h.id === reviewId)) return clone(progress);
    const p = clone(progress), r = p.reviews[lessonId], at = stamp(now);
    const usedHelp = assisted || Boolean(r.helpSeen);
    r.history.push({id: reviewId, response, correct, assisted: usedHelp, at});
    r.history = r.history.slice(-300);
    if (correct && !usedHelp) r.stage = Math.min(3, r.stage + 1);
    const days = correct && !usedHelp ? [1, 3, 7, 7][r.stage] : 1;
    delete r.helpSeen;
    r.dueAt = stamp(new Date(at).getTime() + days * DAY); p.updatedAt = at;
    return p;
  }
  function markReviewHint(progress, lessonId, now) {
    if (!progress.reviews[lessonId]) throw new Error('ยังไม่มีบทนี้ในรายการทบทวน');
    const p = clone(progress); p.reviews[lessonId].helpSeen = true; p.updatedAt = stamp(now); return p;
  }
  function getDueReviews(progress, now) {
    const clock = new Date(stamp(now)).getTime();
    return Object.entries(progress.reviews).filter(([,r]) => new Date(r.dueAt).getTime() <= clock).map(([lessonId, r]) => ({lessonId, ...clone(r)})).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
  }
  function updateSettings(progress, patch, now) {
    const p = clone(progress);
    if (patch.companion !== undefined) {
      if (!['mali', 'kwak', 'none'].includes(patch.companion)) throw new Error('ผู้พาเรียนไม่ถูกต้อง');
      p.settings.companion = patch.companion;
    }
    if (patch.motion !== undefined) {
      if (!['system', 'reduce'].includes(patch.motion)) throw new Error('ตัวเลือกการเคลื่อนไหวไม่ถูกต้อง');
      p.settings.motion = patch.motion;
    }
    if (patch.voiceRate !== undefined) {
      if (![0.7, 0.85, 1].includes(patch.voiceRate)) throw new Error('ความเร็วเสียงไม่ถูกต้อง');
      p.settings.voiceRate = patch.voiceRate;
    }
    p.updatedAt = stamp(now); return p;
  }
  function lessonResults(progress, id) {
    const l = progress.lessons[id];
    const answers = REQUIRED.map(s => l?.answers[s]).filter(Boolean);
    return {completed: Boolean(l?.completedAt), firstCorrect: answers.filter(a => a.first.correct).length,
      firstIndependent: answers.filter(a => a.first.correct && !a.first.assisted).length,
      answerCount: answers.length, assistedSteps: answers.filter(a => a.first.assisted || a.latest.assisted).length,
      speaking: l?.speaking.status || 'not_assessed', independentRecall: Boolean(l?.answers.recall?.first.correct && !l.answers.recall.first.assisted)};
  }
  function validateProgress(data, validLessonIds) {
    const fail = message => { throw new Error(message || 'ไฟล์ความคืบหน้ามีรูปแบบไม่ถูกต้อง'); };
    const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const str = (value, max = 600) => typeof value === 'string' && value.length <= max;
    const iso = value => str(value, 50) && Number.isFinite(Date.parse(value));
    const allowedId = id => validId(id) && (!Array.isArray(validLessonIds) || validLessonIds.includes(id));
    if (!obj(data) || data.appId !== APP_ID) fail('ไฟล์นี้ไม่ใช่ความคืบหน้าของสวนภาษา AI');
    if (data.schemaVersion !== 1) fail('เวอร์ชันไฟล์ยังไม่รองรับ ไฟล์เดิมยังไม่เปลี่ยน');
    if (!iso(data.createdAt) || !iso(data.updatedAt) || !obj(data.settings) || !obj(data.lessons) || !obj(data.reviews)) fail();
    if (Object.keys(data.lessons).length > 50 || Object.keys(data.reviews).length > 50) fail('ข้อมูลมีจำนวนบทมากเกินที่รองรับ');
    const clean = createProgress(data.createdAt);
    clean.updatedAt = stamp(data.updatedAt);
    clean.settings = updateSettings(clean, data.settings, data.updatedAt).settings;
    function attempt(a) {
      if (!obj(a) || !str(a.response) || typeof a.correct !== 'boolean' || typeof a.assisted !== 'boolean' || !MODES.includes(a.modality) || !iso(a.at)) fail();
      return {response: a.response, correct: a.correct, assisted: a.assisted, modality: a.modality, at: stamp(a.at)};
    }
    for (const [id, l] of Object.entries(data.lessons)) {
      if (!allowedId(id) || !obj(l) || !obj(l.answers) || !obj(l.speaking) || !Number.isInteger(l.checkpoint) || l.checkpoint < 0 || l.checkpoint > 7 || (l.completedAt !== null && !iso(l.completedAt))) fail('ข้อมูลบทเรียนไม่ตรงกับรุ่นนี้');
      const result = ensureLesson(clean, id); result.checkpoint = l.checkpoint; result.completedAt = l.completedAt === null ? null : stamp(l.completedAt);
      if (l.contentVersion !== undefined) {
        if (!str(l.contentVersion, 40) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(l.contentVersion)) fail('เวอร์ชันเนื้อหาไม่ถูกต้อง');
        result.contentVersion = l.contentVersion;
      }
      if (l.helpSeen !== undefined) {
        if (!obj(l.helpSeen)) fail('ข้อมูลการใช้คำช่วยไม่ถูกต้อง');
        for (const [step, seen] of Object.entries(l.helpSeen)) {
          if (!STEPS.includes(step) || typeof seen !== 'boolean') fail('ข้อมูลการใช้คำช่วยไม่ถูกต้อง');
          result.helpSeen[step] = seen;
        }
      }
      if (!['not_assessed', 'self_practiced', 'skipped'].includes(l.speaking.status) || ![null, 'model', 'independent'].includes(l.speaking.support) || (l.speaking.at !== null && !iso(l.speaking.at))) fail();
      result.speaking = {status: l.speaking.status, support: l.speaking.status === 'skipped' ? null : l.speaking.support, at: l.speaking.at === null ? null : stamp(l.speaking.at)};
      for (const [step, a] of Object.entries(l.answers)) {
        if (!STEPS.includes(step) || !obj(a) || !Number.isInteger(a.attemptCount) || a.attemptCount < 1 || a.attemptCount > 1000000) fail();
        result.answers[step] = {first: attempt(a.first), latest: attempt(a.latest), attemptCount: a.attemptCount};
      }
      if (result.completedAt && (!REQUIRED.every(s => result.answers[s]) || !result.answers.dialogue || result.speaking.status === 'not_assessed')) fail('ไฟล์ระบุว่าจบบท แต่กิจกรรมยังไม่ครบ');
    }
    for (const [id, r] of Object.entries(data.reviews)) {
      if (!allowedId(id) || !clean.lessons[id]?.completedAt || !obj(r) || !Number.isInteger(r.stage) || r.stage < 0 || r.stage > 3 || !iso(r.dueAt) || !Array.isArray(r.history) || r.history.length > 300) fail('ข้อมูลวันทบทวนไม่ถูกต้อง');
      const seen = new Set();
      const history = r.history.map(h => {
        if (!obj(h) || !str(h.id,180) || !h.id || seen.has(h.id) || !str(h.response) || typeof h.correct !== 'boolean' || typeof h.assisted !== 'boolean' || !iso(h.at)) fail();
        seen.add(h.id); return {id: h.id, response: h.response, correct: h.correct, assisted: h.assisted, at: stamp(h.at)};
      });
      clean.reviews[id] = {stage: r.stage, dueAt: stamp(r.dueAt), history};
      if (r.helpSeen !== undefined) {
        if (typeof r.helpSeen !== 'boolean') fail('ข้อมูลคำช่วยในการทบทวนไม่ถูกต้อง');
        clean.reviews[id].helpSeen = r.helpSeen;
      }
    }
    for (const [id, l] of Object.entries(clean.lessons)) if (l.completedAt && !clean.reviews[id]) fail('ไฟล์ที่จบบทต้องมีวันทบทวน');
    return clean;
  }
  return {DAY, createProgress, normalizeAnswer, checkAnswer, recordAnswer, markHint, markSpeaking, setCheckpoint, completeLesson, recordReview, markReviewHint, getDueReviews, updateSettings, lessonResults, validateProgress};
});
