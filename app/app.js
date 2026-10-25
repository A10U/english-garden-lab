(function () {
  'use strict';
  const C = window.EGLCore, S = window.EGLStorage, G = window.EGLGarden, content = window.EGL_CONTENT;
  const screen = document.getElementById('screen');
  if (!C || !S || !G || !content?.lessons?.length) {
    screen.textContent = 'เปิดไฟล์แอปไม่ครบ กรุณาเก็บโฟลเดอร์ app ไว้ด้วยกันแล้วเปิดใหม่'; return;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[x]));
  const store = S.createStore({lessonIds: content.lessons.map(l => l.id)});
  let loaded = store.load(), progress = loaded.progress, view = 'home', session = null, reviewSession = null;
  let selectedWord = 'leaf', wordFilter = '', pendingImport = null, resetPending = false;
  let localVoice = null, voiceToken = 0, voiceTimer = null, voiceMessage = '', toastTimer = null;
  let phoneticCleanup = null;
  const STEP_NAMES = ['รู้จักบท', 'ฟัง', 'อ่าน', 'เขียน', 'ลองพูด', 'สนทนา', 'นึกคำเอง', 'สรุป'];
  const headings = {home: 'วันนี้อยากเรียนเรื่องอะไร', garden: 'สวนคำศัพท์', review: 'กลับมานึกคำอีกครั้ง', progress: 'ผลฝึกและข้อมูลของฉัน', lesson: 'ฝึกทีละประโยค'};
  const lessonById = id => content.lessons.find(l => l.id === id);
  const completed = () => content.lessons.filter(l => progress.lessons[l.id]?.completedAt).length;
  const date = value => new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
  const button = (label, action, attrs = '', kind = 'primary') => `<button type="button" class="button ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
  const title = (eyebrow, heading, lead) => `<header class="page-header"><p class="eyebrow">${esc(eyebrow)}</p><h1 tabindex="-1">${esc(heading)}</h1><p class="lead">${esc(lead)}</p></header>`;
  function notify(message) {
    clearTimeout(toastTimer); const el = document.getElementById('toast'); el.textContent = message; el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, 6500);
  }
  function save(next) {
    try { loaded = store.save(next); progress = loaded.progress; updateSaveStatus(); return true; }
    catch (error) { notify('บันทึกผลไม่สำเร็จ: ' + error.message); return false; }
  }
  function updateSaveStatus() {
    const el = document.getElementById('save-status');
    el.textContent = loaded.persistent ? 'บันทึกไว้ในเบราว์เซอร์นี้' : 'เก็บชั่วคราว · ส่งออกก่อนปิด';
    el.classList.toggle('is-warning', !loaded.persistent);
    document.documentElement.dataset.motion = progress.settings.motion;
  }
  function warning() { return loaded.warning ? `<div class="notice warning" role="status">${esc(loaded.warning)}</div>` : ''; }
  function companion() {
    const name = {mali: 'มะลิ', kwak: 'นางกวัก', none: 'โหมดเรียนด้วยตัวเอง'}[progress.settings.companion];
    return `<div class="companion"><span class="pill">${esc(name)}</span><p class="small muted">${progress.settings.companion === 'none' ? 'ทำตามจังหวะของคุณ คำช่วยอยู่ใกล้มือเสมอ' : 'ผู้พาเรียนสมมติ · บทสนทนาที่เตรียมไว้'}</p></div>`;
  }
  function setView(next, focus = true) {
    cancelSpeech(); view = next; reviewSession = null; pendingImport = null; resetPending = false;
    render(focus);
  }
  function clearPhonetics() {
    const cleanup = phoneticCleanup; phoneticCleanup = null;
    try { if (typeof cleanup === 'function') cleanup(); } catch { /* Keep navigation available if optional media cleanup fails. */ }
  }
  function mountPhonetics() {
    const container = screen.querySelector('[data-phonetic-text]');
    if (!container) return;
    if (typeof window.EGLPhonetics?.mount !== 'function') {
      container.textContent = 'เครื่องมือแยกเสียงยังไม่พร้อม ลองฟังตัวอย่างและฝึกพูดเองต่อได้'; return;
    }
    const text = container.dataset.phoneticText;
    try {
      phoneticCleanup = window.EGLPhonetics.mount(container, {
        text, audioSources: [], apiBase:null,
        precomputed: window.EGL_PHONETIC_DATA?.[text] || null,
        referenceExample: window.EGL_REFERENCE_AUDIO?.[text] || null
      });
    } catch {
      container.textContent = 'เครื่องมือแยกเสียงเปิดไม่ได้ในครั้งนี้ ลองฟังตัวอย่างและเรียนต่อได้';
    }
  }
  function phoneticPanel(text) {
    return `<section class="phonetic-panel" data-phonetic-text="${esc(text)}" aria-label="แยกเสียงและฝึกออกเสียง"></section>`;
  }
  function render(focus = false) {
    clearPhonetics();
    document.getElementById('app-heading').textContent = headings[view] || headings.home;
    document.querySelectorAll('[data-view]').forEach(b => {
      if (b.dataset.view === (view === 'lesson' ? 'home' : view)) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    updateSaveStatus();
    let html = view === 'lesson' ? renderLesson() : view === 'garden' ? renderGarden() : view === 'review' ? renderReview() : view === 'progress' ? renderProgress() : renderHome();
    screen.innerHTML = warning() + html;
    mountPhonetics();
    if (focus) {
      (screen.querySelector('h1') || document.getElementById('main')).focus({preventScroll: true});
      window.scrollTo({top: 0, behavior: 'instant'});
    }
  }
  function renderHome() {
    const due = C.getDueReviews(progress).length;
    return `${title('English Garden Lab · สวนภาษา AI', 'ภาษาอังกฤษจากเรื่องที่เราชอบ', 'เริ่มจากประโยคสั้น มีคำช่วยภาษาไทย ลองใหม่ได้ และกลับมาทบทวนเมื่อพร้อม')}
      <div class="hero-grid"><section class="panel"><p class="eyebrow">ภารกิจเล็กของวันนี้</p><h2>ค่อย ๆ เรียน แล้วให้สวนเติบโต</h2><p>เลือกเรื่องที่สนใจ ทุกบทมีฟัง อ่าน เขียน ลองพูด และใช้ประโยคในบทสนทนา</p>
      <div class="stat-grid"><div class="stat"><strong>${completed()} / 3</strong><span>บทที่ทำกิจกรรมครบ</span></div><div class="stat"><strong>${due}</strong><span>บทถึงวันทบทวน</span></div></div>
      <p class="small muted">การทำครบคือผ่านวงจรฝึก ยังไม่ใช่การรับรองระดับภาษา</p>${companion()}
      <div class="actions">${button(due ? 'ทบทวนคำที่ถึงนัด' : 'สำรวจสวนคำศัพท์', due ? 'open-review' : 'open-garden', '', 'secondary')}</div></section>
      <section class="garden-scene" aria-label="สวนในเกมของคุณ">${G.render({completed: completed()})}</section></div>
      <section class="stack"><h2 class="section-title">เลือกภารกิจที่อยากลอง</h2><div class="lesson-grid">${content.lessons.map((l, index) => {
        const p = progress.lessons[l.id], done = Boolean(p?.completedAt);
        return `<article class="lesson-card"><div class="lesson-meta"><span class="pill">${index + 1} / 3</span><span class="small muted">ประมาณ ${l.minutes} นาที</span></div><p class="eyebrow">${esc(l.eyebrow)}</p><h3>${esc(l.title)}</h3><p>${esc(l.description)}</p><p class="small muted">${done ? 'ทำครบแล้ว · ฝึกซ้ำได้' : p ? 'เริ่มไว้แล้ว · เรียนต่อได้' : 'เริ่มได้เลย · ไม่ต้องสอบก่อน'}</p>${button(done ? 'ฝึกบทนี้อีกครั้ง' : p ? 'เรียนต่อ' : 'เริ่มบทนี้', 'start', `data-lesson="${esc(l.id)}"`)}</article>`;
      }).join('')}</div></section>
      <div class="notice"><strong>ใช้ได้ในเครื่องนี้</strong> เสียงอ่านเป็นทางเลือก ดู IPA และแยกเสียงได้ในหน้าฝึกพูดหรือสวนคำศัพท์ ไมค์จะเปิดเมื่อกดบันทึกในเครื่องมือออกเสียงเท่านั้น บทสนทนาเป็นสคริปต์ ผลฝึกบันทึกในเบราว์เซอร์และส่งออกเป็นไฟล์ได้</div>`;
  }
  function buildSession(id) {
    const stored = progress.lessons[id];
    const fresh = Boolean(stored?.completedAt);
    const answers = fresh ? {} : JSON.parse(JSON.stringify(stored?.answers || {}));
    const s = {id, step: fresh ? 0 : stored?.checkpoint || 0, answers, assisted: fresh ? {} : {...(stored?.helpSeen || {})}, reveal: {}, heard: false, listenMode: null,
      speaking: fresh ? {status: 'not_assessed'} : stored?.speaking || {status: 'not_assessed'}, signature: '', signatureAt: 0};
    for (const [step,a] of Object.entries(answers)) s.assisted[step] = Boolean(s.assisted[step] || a.latest.assisted || !a.latest.correct);
    // A resumed unanswered listening item must play audio again or open the transcript.
    if (answers.listen) { s.listenMode = answers.listen.latest.assisted ? 'text' : 'audio'; s.heard = !answers.listen.latest.assisted; }
    return s;
  }
  function startLesson(id) {
    if (!lessonById(id)) return;
    cancelSpeech(); session = buildSession(id); view = 'lesson';
    session.step = Math.min(session.step, maxUnlocked());
    render(true);
  }
  function passed(step) { return Boolean(session?.answers[step]?.latest.correct); }
  function maxUnlocked() {
    if (!session) return 0;
    if (!passed('listen')) return 1;
    if (!passed('read')) return 2;
    if (!passed('write')) return 3;
    if (session.speaking.status === 'not_assessed') return 4;
    if (!passed('dialogue')) return 5;
    if (!passed('recall')) return 6;
    return 7;
  }
  function navigateStep(index) {
    if (!session || index < 0 || index > maxUnlocked()) return;
    cancelSpeech(); session.step = index;
    if (!save(C.setCheckpoint(progress, session.id, index))) return;
    render(true);
  }
  function voiceStatus() {
    return voiceMessage || (localVoice ? 'มีเสียงอังกฤษในเครื่อง กดฟังซ้ำได้' : 'ไม่มีเสียงอังกฤษในเครื่องที่ใช้ได้ เลือกอ่านข้อความแทนได้');
  }
  function audioButton(text, purpose = 'model') {
    return `<div class="actions">${button('ฟังเสียงอังกฤษ', 'audio', `data-text="${esc(text)}" data-purpose="${purpose}" ${localVoice ? '' : 'disabled'}`, 'secondary')}</div><p class="small muted" data-voice-status role="status">${esc(voiceStatus())}</p>`;
  }
  function feedbackFor(step, l) {
    const a = session.answers[step]; if (!a) return '';
    const right = a.latest.correct;
    let text = step === 'dialogue' ? (l.dialogue.choices.find(c => c.id === a.latest.response)?.reply || '') : l[step]?.feedback || '';
    const first = right ? 'ลองได้แล้ว' : step === 'write' || step === 'recall' ? 'ยังไม่ตรงคำตอบของโจทย์นี้ ลองใหม่ได้' : 'ยังไม่ตรงกับสิ่งที่ถาม ลองเลือกใหม่ได้';
    return `<div class="feedback ${right ? 'correct' : 'incorrect'}" role="status" tabindex="-1"><strong>${first}</strong><p>${esc(text)}</p><p class="small">${a.latest.assisted ? 'รอบนี้ใช้คำช่วย · เก็บแยกจากการนึกเอง' : 'บันทึกผลฝึกแล้ว · ยังไม่ใช่การวัดระดับภาษา'}</p></div>`;
  }
  function stepControls(canContinue) {
    return `<div class="actions">${session.step > 0 ? button('ย้อนกลับ', 'step', `data-step="${session.step - 1}"`, 'ghost') : button('กลับหน้าแรก', 'home', '', 'ghost')}${button(session.step === 6 ? 'จบภารกิจและดูสรุป' : 'ไปขั้นต่อไป', 'next', canContinue ? '' : 'disabled')}</div>`;
  }
  function renderLesson() {
    const l = lessonById(session.id), step = session.step;
    const stepper = `<nav class="stepper" aria-label="ขั้นการเรียน">${STEP_NAMES.map((n,i) => `<button type="button" class="step-pill ${i === step ? 'active' : i < step ? 'done' : ''}" data-action="step" data-step="${i}" ${i > maxUnlocked() ? 'disabled' : ''} ${i === step ? 'aria-current="step"' : ''}>${i + 1}. ${n}</button>`).join('')}</nav>`;
    const header = title(l.eyebrow, l.title, `ขั้น ${step + 1} จาก 8 · ${STEP_NAMES[step]}`);
    let activity = '';
    if (step === 0) activity = `<p class="eyebrow">วันนี้เราจะลองอะไร</p><h2>${esc(l.goal)}</h2><p>${esc(l.description)}</p><div class="word-grid">${l.words.map(w => `<div class="word-card"><strong lang="en">${esc(w.en)}</strong><span>${esc(w.th)}</span></div>`).join('')}</div><p class="notice">ฟังซ้ำ เปิดคำช่วย หรือลองใหม่ได้ การฝึกพูดเลือกข้ามได้ ไมค์จะเปิดเฉพาะเมื่อคุณกดบันทึกในเครื่องมือออกเสียง</p>${stepControls(true)}`;
    else if (step === 1 || step === 2) {
      const type = step === 1 ? 'listen' : 'read', q = l[type], done = passed(type);
      const enabled = type === 'read' || session.heard || session.reveal.listen;
      activity = `<p class="eyebrow">${type === 'listen' ? 'ฟังแล้วเลือกความหมาย' : 'อ่านเพื่อหาคำตอบ'}</p>
        ${type === 'listen' ? `<p>${esc(q.prompt)}</p>${audioButton(q.audio, 'listen')}${button(session.reveal.listen ? 'เปิดข้อความช่วยไว้แล้ว' : 'อ่านประโยคแทนเสียง / เปิดคำช่วย', 'hint', 'data-kind="listen"', 'ghost')}${session.reveal.listen ? `<div class="hint"><p lang="en" class="sentence">${esc(q.audio)}</p><p class="small">รอบนี้ฝึกความเข้าใจผ่านข้อความ ไม่สรุปว่าเป็นผลฟังอย่างเดียว</p></div>` : ''}` : `<p class="sentence" lang="en">${esc(q.text)}</p>${button('เปิดคำช่วยไทย', 'hint', 'data-kind="read"', 'ghost')}${session.reveal.read ? `<div class="hint">${esc(q.feedback)}</div>` : ''}`}
        <h2>${esc(q.question)}</h2><div class="choice-grid">${q.choices.map(choice => `<button type="button" class="choice ${session.answers[type]?.latest.response === choice.id ? 'selected' : ''}" data-action="answer-choice" data-kind="${type}" data-choice="${esc(choice.id)}" ${!enabled || done ? 'disabled' : ''}>${esc(choice.text)}</button>`).join('')}</div>
        ${!enabled ? '<p class="small muted">ฟังจนจบ หรือเปิดข้อความช่วยก่อนเลือกคำตอบได้</p>' : ''}${feedbackFor(type,l)}${stepControls(done)}`;
    } else if (step === 3 || step === 6) {
      const type = step === 3 ? 'write' : 'recall', q = l[type], answer = session.answers[type], done = passed(type);
      activity = `<p class="eyebrow">${type === 'write' ? 'เขียนประโยคสั้น' : 'ลองนึกคำก่อนเปิดเฉลย'}</p><h2>${esc(q.prompt)}</h2>${type === 'write' ? `<p class="small muted">รูปประโยค: <span lang="en">${esc(q.scaffold)}</span></p>` : '<p class="small muted">ซ่อนตัวอย่างไว้แล้ว ลองนึกจากความหมายไทยก่อน</p>'}
        <form data-form="answer" data-kind="${type}"><label class="field" for="lesson-answer">${type === 'write' ? 'ประโยคภาษาอังกฤษของคุณ' : 'คำภาษาอังกฤษที่นึกได้'}</label><div class="input-row"><input id="lesson-answer" name="answer" type="text" lang="en" maxlength="200" autocomplete="off" spellcheck="false" value="${esc(answer?.latest.response || '')}" ${done ? 'disabled' : ''}><button class="button primary" type="submit" ${done ? 'disabled' : ''}>ตรวจคำตอบ</button></div></form>
        <div class="actions">${button('ขอคำช่วย', 'hint', `data-kind="${type}"`, 'ghost')}</div>${session.reveal[type] ? `<div class="hint">${esc(q.hint)}</div>` : ''}${feedbackFor(type,l)}
        <p class="small muted">ตรวจเฉพาะคำตอบที่เตรียมไว้ ยอมรับตัวพิมพ์ใหญ่เล็ก ช่องว่าง และเครื่องหมายท้ายที่ต่างกัน</p>${stepControls(done)}`;
    } else if (step === 4) {
      activity = `<p class="eyebrow">พูดตามจังหวะของเรา</p><h2>ลองพูด แล้วบอกตัวเองว่าพร้อมแค่ไหน</h2><p>ฟังตัวอย่างแล้วลองพูดตาม หรือเปิด IPA เพื่อดูเสียงแต่ละคำ เมื่อพร้อมจึงเลือกบันทึกหรืออัปโหลดเสียงเพื่อวิเคราะห์ได้ การพูดเลือกข้ามได้และสถานะของบทนี้เป็นการสะท้อนตนเอง</p><p class="sentence" lang="en">${esc(l.speak.model)}</p>${audioButton(l.speak.model)}${phoneticPanel(l.speak.model)}
        <div class="choice-grid">${button('ลองพูดโดยอ่านตามแล้ว', 'speaking', 'data-support="model"', 'secondary')}${button('ลองพูดโดยไม่ดูตัวอย่างแล้ว', 'speaking', 'data-support="independent"', 'secondary')}${button('ขอข้ามการพูดครั้งนี้', 'speaking', 'data-support="skip"', 'ghost')}</div>
        ${session.speaking.status !== 'not_assessed' ? `<div class="feedback correct" role="status">${session.speaking.status === 'skipped' ? 'ข้ามไว้ก่อน · การพูดยังไม่ได้ประเมิน' : session.speaking.support === 'model' ? 'บันทึกว่าลองพูดโดยใช้ตัวอย่างแล้ว' : 'บันทึกว่าลองพูดโดยไม่ดูตัวอย่างแล้ว'}<p class="small">สถานะนี้เป็นการสะท้อนตนเอง แยกจากผลวิเคราะห์เสียงที่เลือกใช้ในเครื่องมือ</p></div>` : ''}${stepControls(session.speaking.status !== 'not_assessed')}`;
    } else if (step === 5) {
      const q = l.dialogue;
      activity = `<p class="eyebrow">ใช้ภาษาในบทสนทนา</p><h2>เลือกประโยคที่อยากตอบ</h2><p>${esc(q.prompt)}</p><div class="timeline">${q.lines.map(line => `<div><span class="pill">${esc(line.speaker === 'Mali' ? 'มะลิ' : line.speaker === 'You' ? 'เรา' : 'AI ตัวอย่าง')}</span><p class="sentence" lang="en">${esc(line.en)}</p><p class="small muted">${esc(line.th)}</p></div>`).join('')}</div>
        <div class="choice-grid">${q.choices.map(c => `<button type="button" class="choice ${session.answers.dialogue?.latest.response === c.id ? 'selected' : ''}" data-action="answer-choice" data-kind="dialogue" data-choice="${esc(c.id)}" ${passed('dialogue') ? 'disabled' : ''}>${esc(c.text)}</button>`).join('')}</div>${feedbackFor('dialogue',l)}${passed('dialogue') ? button('ลองตอบอีกแบบ', 'retry-dialogue', '', 'ghost') : ''}${stepControls(passed('dialogue'))}`;
    } else {
      const r = C.lessonResults(progress,l.id), rev = progress.reviews[l.id];
      activity = `<p class="eyebrow">ภารกิจเล็ก ทำครบแล้ว</p><h2>วันนี้ได้ลองใช้ภาษาอีกหนึ่งเรื่อง</h2><div class="stat-grid"><div class="stat"><strong>${r.firstCorrect} / ${r.answerCount}</strong><span>ตอบตรงโจทย์ในครั้งแรก</span></div><div class="stat"><strong>${r.firstIndependent} / ${r.answerCount}</strong><span>ครั้งแรกโดยไม่เปิดคำช่วย</span></div></div><ul class="result-list"><li>ฝึกพูด: ${r.speaking === 'skipped' ? 'ข้ามไว้ ยังไม่ได้ประเมิน' : 'ลองพูดและสะท้อนตนเอง ไม่มีคะแนนเสียง'}</li><li>นึกคำท้ายบท: ${r.independentRecall ? 'ครั้งแรกตอบได้โดยไม่เปิดคำช่วย' : 'ใช้ตัวช่วยหรือลองแก้เพื่อให้ได้คำตอบ'}</li><li>นัดทบทวน: ${rev ? esc(date(rev.dueAt)) : 'ยังไม่กำหนด'}</li></ul>
        <p class="notice">สรุปนี้ใช้คำตอบครั้งแรกที่บันทึกไว้ของบทนี้ การฝึกซ้ำไม่ลบประวัติครั้งแรก และการทำครบยังไม่เท่ากับจำได้ข้ามวัน</p><div class="actions">${button('เลือกภารกิจต่อไป', 'home')}${button('ดูสวนของฉัน', 'open-garden', '', 'secondary')}${button('ดูผลฝึกทั้งหมด', 'open-progress', '', 'ghost')}</div>`;
    }
    return `${header}${stepper}<div class="layout"><section class="panel activity-panel">${activity}</section><aside class="panel">${companion()}${G.render({completed: completed()})}<p class="small muted">ค่อย ๆ ทำทีละขั้น ย้อนกลับได้ หากออกก่อนจบ ระบบจะเก็บขั้นล่าสุดที่บันทึกไว้</p>${button('พักและกลับหน้าแรก', 'home', '', 'ghost')}</aside></div>`;
  }
  function renderGarden() {
    const w = content.glossary.find(w => w.id === selectedWord) || content.glossary[0];
    const words = content.glossary.filter(w => (w.en + ' ' + w.th).toLowerCase().includes(wordFilter.toLowerCase()));
    const p = content.plantSample;
    return `${title('สำรวจและแตะคำ', 'สวนเล็กที่มีคำให้เรียน', 'แตะป้ายบนภาพหรือเลือกจากรายการ ฟังตัวอย่างและลองพูดตามได้')}
      <div class="layout"><section class="garden-scene">${G.render({completed: completed(), interactive: true})}</section><section class="panel" aria-label="คำศัพท์ที่เลือก"><p class="eyebrow">คำที่เลือก</p><h2 lang="en" class="sentence">${esc(w.en)}</h2><p>${esc(w.th)}</p><p lang="en">${esc(w.example)}</p>${audioButton(w.example)}${phoneticPanel(w.example)}<p class="small muted">ภาพนี้คือสวนในเกม แทนด้วยปุ่มคำศัพท์ได้ทุกคำ</p></section></div>
      <section class="panel"><label class="field" for="word-search">ค้นหาคำอังกฤษหรือคำแปลไทย</label><input id="word-search" type="search" value="${esc(wordFilter)}" maxlength="60" autocomplete="off"><div class="word-grid">${words.map(w => `<button class="word-card ${w.id === selectedWord ? 'selected' : ''}" type="button" data-action="word" data-word="${esc(w.id)}" aria-pressed="${w.id === selectedWord}"><strong lang="en">${esc(w.en)}</strong><span>${esc(w.th)}</span></button>`).join('') || '<p class="empty-state">ยังไม่มีคำนี้ ลองค้นคำว่า leaf หรือ ช่วย</p>'}</div></section>
      <section class="panel"><p class="eyebrow">ข้อมูลจำลอง</p><h2>ลองอ่านตัวเลขในสวน</h2><div class="stat-grid"><div class="stat"><strong>${esc(p.temperature)} °C</strong><span>อุณหภูมิอากาศ</span></div><div class="stat"><strong>${esc(p.light)} lx</strong><span>แสง</span></div><div class="stat"><strong>${esc(p.moisture)} %</strong><span>ความชื้นดิน</span></div></div><p class="small muted">${esc(p.label)}</p></section>`;
  }
  function renderReview() {
    if (reviewSession) {
      const l = lessonById(reviewSession.id), result = reviewSession.result;
      return `${title(reviewSession.practice ? 'ฝึกก่อนวันนัด' : 'ทบทวนเมื่อถึงนัด', l.title, 'ลองเรียกคำจากความจำ คำตอบครั้งแรกเก็บแยกจากการแก้หลังเห็นเฉลย')}
        <section class="panel activity-panel"><h2>${esc(l.recall.prompt)}</h2><form data-form="review"><label class="field" for="review-answer">คำที่นึกได้</label><div class="input-row"><input id="review-answer" type="text" name="answer" lang="en" maxlength="200" spellcheck="false" autocomplete="off" value="${esc(result?.response || '')}" ${result ? 'disabled' : ''}><button class="button primary" type="submit" ${result ? 'disabled' : ''}>บันทึกคำตอบครั้งแรก</button></div></form>
        ${button('ขอคำช่วย', 'review-hint', result ? 'disabled' : '', 'ghost')}${reviewSession.assisted ? `<div class="hint">${esc(l.recall.hint)}</div>` : ''}
        ${result ? `<div class="feedback ${result.correct ? 'correct' : 'incorrect'}" role="status" tabindex="-1"><strong>${result.correct ? 'ตรงกับคำที่ฝึก' : 'คำที่กำลังฝึกคือ ' + esc(l.recall.accepted[0])}</strong><p>${esc(l.recall.feedback)}</p><p>${reviewSession.practice ? 'ฝึกก่อนวันนัด จึงไม่ได้เปลี่ยนวันนัดหรือผลทบทวนจริง' : `บันทึกคำตอบแรกแล้ว · นัดครั้งต่อไป ${esc(date(progress.reviews[l.id].dueAt))}`}</p></div>` : ''}
        <div class="actions">${button('กลับรายการทบทวน', 'review-close', '', 'secondary')}${result ? button('ฝึกคำนี้อีกครั้ง', 'practice', `data-lesson="${esc(l.id)}"`, 'ghost') : ''}</div></section>`;
    }
    const due = C.getDueReviews(progress), dueIds = new Set(due.map(r=>r.lessonId)), scheduled = content.lessons.filter(l=>progress.reviews[l.id]);
    return `${title('การนึกคำเว้นช่วง', 'กลับมาทบทวนตามจังหวะของเรา', 'เริ่มนัดหลังจบบท 1 วัน ถ้านึกได้เอง รอบต่อไปเว้น 3 แล้ว 7 วัน ถ้ายังใช้ตัวช่วยจะนัดใหม่อีก 1 วัน')}
      ${due.length ? `<p class="notice">มี ${due.length} บทถึงนัดแล้ว เลือกทีละบทได้</p>` : '<div class="empty-state"><h2>วันนี้ยังไม่มีบทที่ถึงนัด</h2><p>ทำบทใหม่ หรือเลือกฝึกก่อนวันนัดได้โดยไม่เปลี่ยนตาราง</p></div>'}
      <div class="lesson-grid">${scheduled.map(l => `<article class="lesson-card"><span class="pill">${dueIds.has(l.id) ? 'ถึงนัดแล้ว' : 'นัดถัดไป'}</span><h2>${esc(l.title)}</h2><p>${esc(date(progress.reviews[l.id].dueAt))}</p><p class="small muted">บันทึกทบทวนแล้ว ${progress.reviews[l.id].history.length} ครั้ง</p>${button(dueIds.has(l.id) ? 'เริ่มทบทวน' : 'ฝึกก่อนวันนัด', dueIds.has(l.id) ? 'review-start' : 'practice', `data-lesson="${esc(l.id)}"`, dueIds.has(l.id) ? 'primary' : 'secondary')}</article>`).join('')}</div>
      ${!scheduled.length ? button('ไปเลือกบทเรียน', 'home') : ''}<p class="small muted">ตารางนี้เป็นจุดเริ่มทดลอง ไม่ใช่สูตรรับรองการจำ ใช้เวลาที่ผ่านไปจริง 24 ชั่วโมงต่อวัน และแสดงเวลาไทย</p>`;
  }
  function renderProgress() {
    const details = content.lessons.map(l => {
      const r = C.lessonResults(progress,l.id), saved = progress.lessons[l.id];
      return `<article class="panel"><span class="pill">${r.completed ? 'ทำกิจกรรมครบ' : saved ? 'กำลังฝึก' : 'ยังไม่ได้เริ่ม'}</span><h2>${esc(l.title)}</h2><ul class="result-list"><li>ตรงโจทย์ครั้งแรก: ${r.firstCorrect}/${r.answerCount} ข้อที่ได้ลอง</li><li>ครั้งแรกไม่เปิดคำช่วย: ${r.firstIndependent}/${r.answerCount}</li><li>การพูด: ${r.speaking === 'self_practiced' ? 'บันทึกว่าลองแล้ว · สะท้อนตนเอง' : 'ยังไม่ได้ประเมิน'}</li></ul>${saved ? `<details><summary>ดูคำตอบครั้งแรกและครั้งล่าสุด</summary>${Object.entries(saved.answers).map(([step,a]) => `<div class="result-list"><p><strong>${esc({listen:'ฟัง/เข้าใจ',read:'อ่าน',write:'เขียน',dialogue:'สนทนา',recall:'นึกคำ'}[step] || step)}</strong> · ลอง ${a.attemptCount} ครั้ง</p><p class="small">ครั้งแรก: ${esc(displayResponse(l,step,a.first.response))} · ${a.first.correct ? 'ตรงโจทย์' : 'ยังไม่ตรงโจทย์'}${a.first.assisted ? ' · ใช้คำช่วย' : ''}</p><p class="small">ล่าสุด: ${esc(displayResponse(l,step,a.latest.response))} · ${a.latest.correct ? 'ตรงโจทย์' : 'ยังไม่ตรงโจทย์'}</p></div>`).join('')}</details>` : ''}</article>`;
    }).join('');
    return `${title('ข้อมูลอยู่กับเรา', 'เห็นสิ่งที่ฝึก และเก็บสำเนาไว้', 'ผลการเลือก เขียน และลองพูดแยกกัน คะแนนฝึกไม่ใช่คะแนน CEFR หรือหลักฐานว่าจำได้ระยะยาว')}
      <div class="lesson-grid">${details}</div><section class="panel"><h2>ปรับการเรียน</h2><div class="setting-row"><label for="companion-setting">ผู้พาเรียน</label><select id="companion-setting" data-setting="companion">${[['mali','มะลิ · นักพฤกษศาสตร์สมมติ'],['kwak','นางกวัก · เพื่อนต้นไม้สมมติ'],['none','เรียนด้วยตัวเอง']].map(([v,t])=>`<option value="${v}" ${progress.settings.companion===v?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="setting-row"><label for="rate-setting">ความเร็วเสียงอ่าน</label><select id="rate-setting" data-setting="voiceRate">${[[0.7,'ช้า'],[0.85,'ค่อนข้างช้า'],[1,'ปกติ']].map(([v,t])=>`<option value="${v}" ${progress.settings.voiceRate===v?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="setting-row"><label for="motion-setting">การเคลื่อนไหว</label><select id="motion-setting" data-setting="motion"><option value="system" ${progress.settings.motion==='system'?'selected':''}>ตามระบบ</option><option value="reduce" ${progress.settings.motion==='reduce'?'selected':''}>ลดการเคลื่อนไหว</option></select></div></section>
      <section class="panel"><h2>สำรองและย้ายความคืบหน้า</h2><p>ข้อมูลอยู่ในเบราว์เซอร์และที่อยู่ที่เปิดแอปนี้ การล้างข้อมูลเว็บไซต์อาจลบผลฝึก ส่งออกไฟล์เก็บไว้หรือย้ายไปเบราว์เซอร์อื่นได้</p><div class="actions">${button('ส่งออกไฟล์ความคืบหน้า', 'export', '', 'secondary')}${store.getRecovery() ? button('ส่งออกต้นฉบับที่อ่านไม่ได้', 'recovery', '', 'secondary') : ''}</div><label class="field" for="import-file">นำเข้าไฟล์สำรอง JSON (ไม่เกิน 1 MB)</label><input type="file" id="import-file" accept=".json,application/json">
      ${pendingImport ? `<div class="notice warning"><p>ไฟล์ผ่านการตรวจรูปแบบ มี ${Object.keys(pendingImport.data.lessons).length} บทที่เคยเริ่ม การยืนยันจะใช้ข้อมูลนี้แทนผลที่เปิดอยู่ ส่งออกผลเดิมก่อนได้</p><div class="actions">${button('ยืนยันใช้ข้อมูลจากไฟล์', 'import-confirm')}${button('ยกเลิก', 'import-cancel', '', 'ghost')}</div></div>` : ''}
      <p class="small muted">การนำเข้าแทนข้อมูลเดิม ไม่มีการส่งไฟล์ไปเซิร์ฟเวอร์ ไฟล์เสียหรือเวอร์ชันที่ไม่รองรับจะไม่เปลี่ยนข้อมูลเดิม</p></section>
      <section class="panel"><h2>เริ่มใหม่</h2><p>ล้างผลและวันทบทวนของแอปนี้ในเบราว์เซอร์ปัจจุบันเท่านั้น ส่งออกไฟล์ก่อนได้</p>${resetPending ? `<div class="notice warning"><p>พร้อมเริ่มใหม่หรือยัง? ผลที่ไม่ได้ส่งออกจะเรียกคืนจากแอปไม่ได้</p><div class="actions">${button('ยืนยันล้างผลของแอปนี้', 'reset-confirm', '', 'secondary')}${button('เก็บผลเดิมไว้', 'reset-cancel', '', 'ghost')}</div></div>` : button('ต้องการเริ่มใหม่', 'reset-request', '', 'ghost')}</section>`;
  }
  function displayResponse(l,step,response) { return l[step]?.choices?.find(c=>c.id===response)?.text || response; }
  function hint(kind) {
    if (!session) return;
    if (!save(C.markHint(progress,session.id,kind))) return;
    session.assisted[kind] = true; session.reveal[kind] = true;
    if (kind === 'listen') session.listenMode = 'text';
    render();
    const el=screen.querySelector('.hint');if(el){el.tabIndex=-1;el.focus({preventScroll:true});}
  }
  function commitAnswer(kind,response,correct,modality) {
    const signature = `${session.id}/${kind}/${response}`, now = Date.now();
    if (passed(kind) || (signature===session.signature && now-session.signatureAt < 650)) return;
    const assisted = Boolean(session.assisted[kind] || (kind==='listen' && session.listenMode!=='audio'));
    let next = C.recordAnswer(progress,{lessonId:session.id,step:kind,response,correct,assisted,modality});
    if (!correct) next = C.markHint(next,session.id,kind);
    if (!save(next)) return;
    session.signature = signature; session.signatureAt = now;
    session.answers[kind] = JSON.parse(JSON.stringify(progress.lessons[session.id].answers[kind]));
    if (!correct) session.assisted[kind] = true;
    render(); screen.querySelector('.feedback')?.focus({preventScroll:true});
  }
  function openReview(id,practice) {
    if (!lessonById(id) || !progress.reviews[id]) return;
    cancelSpeech(); view = 'review';
    const due = progress.reviews[id].dueAt;
    reviewSession = {id,practice,reviewId:`${id}:${due}`,assisted:practice ? false : Boolean(progress.reviews[id].helpSeen),result:null};
    render(true);
  }
  function cancelSpeech() { voiceToken++; clearTimeout(voiceTimer); try { window.speechSynthesis?.cancel?.(); } catch { /* Text fallback remains available when speech fails. */ } voiceMessage = ''; }
  function refreshVoices() {
    try { localVoice = window.speechSynthesis?.getVoices().find(v=>/^en([_-]|$)/i.test(v.lang) && v.localService===true) || null; }
    catch { localVoice = null; }
    if (!('SpeechSynthesisUtterance' in window)) localVoice = null;
    screen.querySelectorAll('[data-action="audio"]').forEach(b=>{b.disabled=!localVoice;});
    screen.querySelectorAll('[data-voice-status]').forEach(el=>{el.textContent=voiceStatus();});
  }
  function playAudio(text,purpose) {
    refreshVoices(); if (!localVoice) { notify('เสียงยังไม่พร้อม เปิดอ่านข้อความแทนได้'); return; }
    cancelSpeech(); const token = voiceToken, activeSession = session, activeStep = session?.step;
    const utterance = new window.SpeechSynthesisUtterance(text); utterance.voice=localVoice; utterance.lang=localVoice.lang; utterance.rate=progress.settings.voiceRate;
    const update = message => { voiceMessage=message; screen.querySelectorAll('[data-voice-status]').forEach(el=>{el.textContent=message;}); };
    utterance.onstart = () => { if (token===voiceToken) update('กำลังอ่านประโยคอังกฤษ…'); };
    utterance.onend = () => {
      if (token!==voiceToken) return; clearTimeout(voiceTimer); update('อ่านจบแล้ว กดฟังซ้ำได้');
      if (purpose==='listen' && view==='lesson' && session===activeSession && session.step===activeStep) { session.heard=true; if (!session.reveal.listen) session.listenMode='audio'; render(); }
    };
    utterance.onerror = () => { if(token===voiceToken) {clearTimeout(voiceTimer);update('เสียงเริ่มไม่ได้ เลือกอ่านข้อความแทนเพื่อเรียนต่อได้');} };
    try {
      window.speechSynthesis.speak(utterance);
      voiceTimer=setTimeout(()=>{if(token===voiceToken)update('หากไม่ได้ยิน เลือกอ่านข้อความแทนได้ แล้วเรียนต่อได้เสมอ');},8000);
    } catch { update('เสียงเริ่มไม่ได้ เปิดอ่านข้อความแทนได้'); }
  }
  function download(text,name) {
    try {const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notify('สร้างไฟล์สำรองแล้ว ตรวจดูโฟลเดอร์ดาวน์โหลดของคุณ');}
    catch {notify('สร้างไฟล์ดาวน์โหลดไม่ได้ในเบราว์เซอร์นี้ กรุณาลองเบราว์เซอร์อื่น');}
  }
  document.addEventListener('click',event=>{
    const nav=event.target.closest('[data-view]'); if(nav){setView(nav.dataset.view,true);return;}
    const el=event.target.closest('[data-action]'); if(!el || el.disabled)return;
    const action=el.dataset.action;
    try {
      if(action==='start')startLesson(el.dataset.lesson);
      else if(action==='home')setView('home',true);
      else if(action==='open-garden')setView('garden',true);
      else if(action==='open-review')setView('review',true);
      else if(action==='open-progress')setView('progress',true);
      else if(action==='step')navigateStep(Number(el.dataset.step));
      else if(action==='next'){
        if(!session)return;
        if(session.step===6){if(!passed('recall'))return;if(!save(C.completeLesson(progress,session.id)))return;navigateStep(7);}
        else navigateStep(session.step+1);
      }
      else if(action==='hint')hint(el.dataset.kind);
      else if(action==='retry-dialogue'){delete session.answers.dialogue;session.assisted.dialogue=true;session.signature='';render();}
      else if(action==='answer-choice'){
        const l=lessonById(session.id),kind=el.dataset.kind;
        if(kind==='listen' && !session.heard && !session.reveal.listen)return;
        const q=l[kind],choice=q.choices.find(c=>c.id===el.dataset.choice);if(!choice)return;
        commitAnswer(kind,choice.id,kind==='dialogue'?choice.helpful:choice.id===q.correctId,'selection');
      }
      else if(action==='speaking'){
        const support=el.dataset.support;
        if(save(C.markSpeaking(progress,{lessonId:session.id,status:support==='skip'?'skipped':'self_practiced',support:support==='skip'?null:support}))){session.speaking=progress.lessons[session.id].speaking;render();}
      }
      else if(action==='audio')playAudio(el.dataset.text,el.dataset.purpose);
      else if(action==='word'){selectedWord=el.dataset.word;render();[...screen.querySelectorAll('.word-card[data-word]')].find(b=>b.dataset.word===selectedWord)?.focus({preventScroll:true});const w=content.glossary.find(w=>w.id===selectedWord);if(w)notify(w.en+' · '+w.th);}
      else if(action==='review-start')openReview(el.dataset.lesson,false);
      else if(action==='practice')openReview(el.dataset.lesson,true);
      else if(action==='review-close'){cancelSpeech();reviewSession=null;render(true);}
      else if(action==='review-hint'){if(!reviewSession.practice && !save(C.markReviewHint(progress,reviewSession.id)))return;reviewSession.assisted=true;render();const h=screen.querySelector('.hint');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
      else if(action==='export')download(store.exportData(),'english-garden-progress.json');
      else if(action==='recovery')download(store.getRecovery(),'english-garden-recovery.json');
      else if(action==='import-cancel'){pendingImport=null;render();}
      else if(action==='import-confirm' && pendingImport){loaded=store.importData(pendingImport.text);progress=loaded.progress;pendingImport=null;session=null;render(true);notify('นำเข้าข้อมูลแล้ว'+(loaded.persistent?'':' · ยังต้องส่งออกก่อนปิดเพราะบันทึกถาวรไม่ได้'));}
      else if(action==='reset-request'){resetPending=true;render();}
      else if(action==='reset-cancel'){resetPending=false;render();}
      else if(action==='reset-confirm'){loaded=store.importData(JSON.stringify(C.createProgress()));progress=loaded.progress;session=null;resetPending=false;render(true);notify('เริ่มผลฝึกใหม่ในแอปนี้แล้ว');}
    }catch(error){notify(error.message);}
  });
  screen.addEventListener('submit',event=>{
    const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
    const input=form.querySelector('input[name="answer"]'),response=input.value.trim();
    if(!response){notify('ลองพิมพ์คำตอบก่อน หรือเปิดคำช่วยได้');input.focus();return;}
    try{
      if(form.dataset.form==='answer'){
        const kind=form.dataset.kind;commitAnswer(kind,response,C.checkAnswer(response,lessonById(session.id)[kind].accepted),'text');
      }else if(form.dataset.form==='review' && reviewSession && !reviewSession.result){
        const correct=C.checkAnswer(response,lessonById(reviewSession.id).recall.accepted);
        if(!reviewSession.practice && !save(C.recordReview(progress,{lessonId:reviewSession.id,reviewId:reviewSession.reviewId,response,correct,assisted:reviewSession.assisted})))return;
        reviewSession.result={response,correct};render();screen.querySelector('.feedback')?.focus({preventScroll:true});
      }
    }catch(error){notify(error.message);}
  });
  screen.addEventListener('change',async event=>{
    const el=event.target;
    if(el.dataset.setting){
      const value=el.dataset.setting==='voiceRate'?Number(el.value):el.value;
      try{if(save(C.updateSettings(progress,{[el.dataset.setting]:value}))){cancelSpeech();notify('บันทึกตัวเลือกการเรียนแล้ว');}}catch(error){notify(error.message);}
    }
    if(el.id==='import-file' && el.files?.[0]){
      const file=el.files[0];
      try{if(file.size>1048576)throw new Error('รองรับไฟล์ไม่เกิน 1 MB');const text=await file.text();const data=C.validateProgress(JSON.parse(text),content.lessons.map(l=>l.id));pendingImport={text,data};render();}
      catch(error){pendingImport=null;notify('นำเข้าไม่ได้: '+error.message);el.value='';}
    }
  });
  screen.addEventListener('input',event=>{
    if(event.target.id==='word-search'){
      const start=event.target.selectionStart;wordFilter=event.target.value;render();const search=document.getElementById('word-search');search.focus();search.setSelectionRange?.(start,start);
    }
  });
  window.addEventListener('pagehide',()=>{clearPhonetics();cancelSpeech();clearTimeout(toastTimer);});
  if(window.speechSynthesis?.addEventListener)window.speechSynthesis.addEventListener('voiceschanged',refreshVoices);
  refreshVoices();render();
})();
