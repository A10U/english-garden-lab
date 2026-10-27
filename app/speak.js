/* English Garden Speak: explicit local practice and connected cloud turns. */
(function (global) {
  'use strict';
  const SCENARIOS = {
    garden: {
      phrase: "This is a leaf. It's green and soft.", translation: 'นี่คือใบไม้หนึ่งใบ มันมีสีเขียวและนุ่ม',
      welcome: 'What can you see in your garden?',
      examples: [
        {text: "This is a leaf. It's green and soft.", reply: 'That sounds lovely. A green, soft leaf is a nice place to start!', translation: 'น่ารักจัง เริ่มจากการสังเกตใบไม้สีเขียวที่นุ่มก็ได้', followUp: 'What else can you see?', correction: null},
        {text: 'My plant have two leaf.', reply: 'Two leaves! You can describe your plant like this.', translation: 'มีใบไม้สองใบ ลองใช้ประโยคนี้เล่าถึงต้นไม้ของคุณได้', followUp: 'Is your plant big or small?', correction: {original: 'My plant have two leaf.', suggested: 'My plant has two leaves.', explanation: 'ต้นไม้หนึ่งต้นใช้ has และใบไม้มากกว่าหนึ่งใบใช้ leaves'}},
        {text: 'I like growing flowers.', reply: 'Flowers can make a garden feel cheerful.', translation: 'ดอกไม้ช่วยให้สวนดูสดใส', followUp: 'What color are your favorite flowers?', correction: null}
      ]
    },
    cafe: {
      phrase: 'Please say it again.', translation: 'ช่วยพูดอีกครั้ง', welcome: 'Welcome! What would you like to drink?',
      examples: [
        {text: 'I would like a coffee, please.', reply: 'Of course. Would you like it hot or iced?', translation: 'ได้เลย คุณอยากได้แบบร้อนหรือเย็น', followUp: 'You can say: “Iced, please.”', correction: null},
        {text: 'I want coffee cold.', reply: 'You can ask for your drink a little more naturally.', translation: 'ลองขอเครื่องดื่มด้วยประโยคที่เป็นธรรมชาติขึ้น', followUp: 'Would you like anything to eat?', correction: {original: 'I want coffee cold.', suggested: "I'd like an iced coffee, please.", explanation: 'iced coffee คือกาแฟเย็น และเติม please เพื่อขออย่างสุภาพ'}},
        {text: 'Please say it again.', reply: 'Certainly. Would you like your coffee hot or iced?', translation: 'ได้เลย คุณอยากได้กาแฟร้อนหรือเย็น', followUp: 'Take your time. You can ask me to speak slowly, too.', correction: null}
      ]
    },
    introductions: {
      phrase: 'I like plants.', translation: 'ฉันชอบต้นไม้', welcome: 'Hi! What do you like to do in your free time?',
      examples: [
        {text: 'I like plants.', reply: 'So do I! Looking after plants can be relaxing.', translation: 'ฉันก็ชอบเหมือนกัน การดูแลต้นไม้ช่วยให้ผ่อนคลายได้', followUp: 'Do you have a plant at home?', correction: null},
        {text: 'I like read book.', reply: 'Reading is a lovely way to spend your free time.', translation: 'การอ่านหนังสือเป็นกิจกรรมยามว่างที่ดี', followUp: 'What kind of books do you enjoy?', correction: {original: 'I like read book.', suggested: 'I like reading books.', explanation: 'หลัง like ใช้ reading ได้ และ books ใช้พูดถึงหนังสือทั่วไป'}},
        {text: 'I am happy to meet you.', reply: "I'm happy to meet you, too. Let's practice a little together.", translation: 'ฉันก็ดีใจที่ได้รู้จัก มาลองฝึกด้วยกันทีละนิด', followUp: 'What would you like to talk about today?', correction: null}
      ]
    }
  };
  const normalize = text => String(text || '').toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9'\s]/g, '').replace(/\s+/g, ' ').trim();
  const bounded = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  const validPersonalKey = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~+/=-]{19,511}$/u.test(value);

  function mount(doc) {
    doc = doc || global.document;
    const win = doc.defaultView || global;
    const form = doc.getElementById('conversation-form');
    if (!form || form.dataset.speakMounted === 'true') return () => {};
    form.dataset.speakMounted = 'true';
    const byId = id => doc.getElementById(id);
    const ui = {
      thread: byId('conversation-thread'), input: byId('speak-transcript'), cloudBadge: byId('cloud-badge'),
      connection: byId('connection-status'), sample: byId('sample-mode'), cloud: byId('cloud-mode'),
      samples: byId('sample-controls'), replies: byId('sample-replies'), trySample: byId('try-sample'),
      send: byId('send-message'), cancel: byId('cancel-request'), transcribe: byId('transcribe-audio'),
      note: byId('send-note'), action: byId('speak-action-status'), clip: byId('clip-status'),
      attach: byId('attach-assessment'), assessment: byId('assessment-status'), practice: byId('local-practice'),
      keyInput: byId('personal-api-key'), connectKey: byId('connect-personal-key'), clearKey: byId('clear-personal-key'), keyStatus: byId('personal-key-status'), hostedLink: byId('personal-key-hosted-link')
    };
    let disposed = false, scenario = 'garden', mode = 'sample', sampleStarted = false;
    let cloudMessages = [], sampleMessages = [], pendingMessage = null;
    let capabilities = {conversation: false, transcription: false, speech: false};
    let clip = null, assessed = null, practiceCleanup = null;
    let requestVersion = 0, controller = null, busy = false, requestTimer = null;
    let cloudAudio = null, audioURL = null, utterance = null;
    const listeners = [];
    let personalApiKey = '', supportsPersonalKey = false, healthController = null, healthTimer = null, healthVersion = 0;
    const currentScenario = () => SCENARIOS[scenario];
    const listen = (target, event, callback) => {
      target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback));
    };
    const el = (tag, className, text) => {
      const node = doc.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = text; return node;
    };
    function actionStatus(message, error) {
      if (disposed) return;
      ui.action.textContent = safeText(message || ''); ui.action.classList.toggle('is-error', Boolean(error));
    }
    const safeText = value => personalApiKey ? String(value).split(personalApiKey).join('[ซ่อน key]') : String(value);
    function securePersonalTransport() {
      return win.location.protocol === 'https:' || win.location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(win.location.hostname);
    }
    function apiFetch(path, init = {}) {
      const url = new win.URL(path, win.location.href);
      if (url.origin !== win.location.origin || !['/api/speak/health', '/api/speak/chat', '/api/speak/transcribe', '/api/speak/speech'].includes(url.pathname) || url.search || url.hash) {
        throw new Error('ติดต่อ Cloud ได้ผ่านบริการ Speak ของเว็บนี้เท่านั้น');
      }
      const headers = new win.Headers(init.headers);
      // Probe host support without credentials, including after connect, clear, and BFcache restore.
      if (url.pathname === '/api/speak/health') headers.delete('X-Speak-Api-Key');
      else if (personalApiKey) {
        if (!supportsPersonalKey) throw new Error('หน้านี้ยังไม่ยืนยันว่ารองรับ key ส่วนตัว');
        if (!securePersonalTransport()) throw new Error('ใช้ key ส่วนตัวผ่าน HTTPS หรือ localhost เท่านั้น');
        headers.set('X-Speak-Api-Key', personalApiKey);
      }
      return win.fetch(url.pathname, {...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    }
    function cancelHealth() {
      healthVersion++; if (healthController) healthController.abort(); healthController = null;
      if (healthTimer !== null) win.clearTimeout(healthTimer); healthTimer = null;
    }
    function resetCapabilities() {
      capabilities = {conversation: false, transcription: false, speech: false};
      ui.cloudBadge.textContent = 'Cloud ยังไม่เชื่อม'; ui.cloudBadge.className = 'status-pill is-unavailable';
    }
    async function checkHealth() {
      cancelHealth();
      const version = healthVersion, selectedPersonalKey = Boolean(personalApiKey);
      supportsPersonalKey = false;
      const currentController = new win.AbortController(); healthController = currentController;
      const timer = win.setTimeout(() => currentController.abort(), 8000); healthTimer = timer;
      try {
        const value = await jsonResponse(await apiFetch('/api/speak/health', {signal: currentController.signal}));
        if (disposed || version !== healthVersion || currentController.signal.aborted) return;
        supportsPersonalKey = value.supportsPersonalKey === true;
        ui.hostedLink.hidden = supportsPersonalKey;
        if (selectedPersonalKey && !supportsPersonalKey) throw new Error('บริการหน้านี้ยังไม่รองรับ key ส่วนตัว');
        capabilities = selectedPersonalKey ? {conversation: true, transcription: true, speech: false}
          : {conversation: value.cloud?.conversation === true, transcription: value.cloud?.transcription === true, speech: value.cloud?.speech === true};
        ui.cloudBadge.textContent = capabilities.conversation ? selectedPersonalKey ? 'Cloud · key ของคุณ' : 'Cloud · key เซิร์ฟเวอร์' : 'Cloud ยังไม่เชื่อม';
        ui.cloudBadge.className = 'status-pill ' + (capabilities.conversation ? 'is-ready' : 'is-unavailable');
        ui.keyStatus.textContent = selectedPersonalKey ? 'พร้อมลองใช้งานด้วย key ของคุณ · ยังไม่ได้ตรวจสอบกับ OpenAI' : 'ยังไม่ได้ตั้ง key ส่วนตัว';
        ui.connection.textContent = capabilities.conversation ? selectedPersonalKey
          ? 'เลือก “สนทนา Cloud” แล้วกดส่งเมื่อพร้อม ระบบจะทราบว่า key ใช้งานได้เมื่อมีคำขอไป OpenAI จริง'
          : 'เว็บตั้ง key ของเซิร์ฟเวอร์ไว้แล้ว หรือคุณเลือกใช้ key ส่วนตัวด้านล่างได้ ยังไม่ได้ตรวจสอบกับ OpenAI'
          : 'การสนทนา cloud ยังไม่เชื่อมต่อ ใส่ key ของคุณ หรือลองตัวอย่างและฝึกเสียงในเครื่องได้';
      } catch (error) {
        if (disposed || version !== healthVersion) return;
        supportsPersonalKey = false; resetCapabilities(); ui.hostedLink.hidden = false;
        ui.connection.textContent = 'หน้านี้ยังไม่เชื่อมบริการ cloud ลองบทสนทนาตัวอย่างและฝึกเสียงในเครื่องได้';
        if (selectedPersonalKey) {
          personalApiKey = ''; ui.keyInput.value = '';
          ui.keyStatus.textContent = 'หน้านี้ยังไม่รองรับ key ส่วนตัวหรือตรวจบริการไม่ได้ ล้าง key แล้วโดยยังไม่ได้ส่งออกจากแท็บ';
          actionStatus('ยังไม่ได้เชื่อม key ส่วนตัว เปิด Speak ที่รองรับ Cloud แล้วลองใหม่ได้');
        }
      } finally {
        win.clearTimeout(timer);
        if (version === healthVersion) { healthTimer = null; healthController = null; updateControls(); }
      }
    }
    function connectPersonalKey() {
      if (disposed) return;
      const candidate = ui.keyInput.value;
      cancelHealth(); cancelRequest(); personalApiKey = ''; resetCapabilities(); mode = 'sample'; cloudMessages = [];
      renderThread(); updateControls();
      if (!validPersonalKey(candidate)) { ui.keyStatus.textContent = 'รูปแบบ key ยังไม่ถูกต้อง ตรวจว่าไม่มีช่องว่างและวาง key ครบแล้ว'; ui.connection.textContent = 'ยังไม่ได้เชื่อม key ส่วนตัว ตรวจ key แล้วกดใช้ key อีกครั้ง'; return; }
      if (!securePersonalTransport()) { ui.keyInput.value = ''; ui.keyStatus.textContent = 'ใช้ key ส่วนตัวผ่าน HTTPS หรือ localhost เท่านั้น'; return; }
      personalApiKey = candidate; ui.keyInput.value = '';
      ui.hostedLink.hidden = true;
      ui.keyStatus.textContent = 'กำลังตรวจว่าหน้านี้รองรับ key ส่วนตัวหรือไม่ · ยังไม่ส่ง key และยังไม่ได้ตรวจสอบกับ OpenAI';
      actionStatus('ตั้ง key ส่วนตัวแล้ว ข้อความและเสียงจะส่งเฉพาะเมื่อคุณเลือกใช้ Cloud'); renderThread(); updateControls();
      checkHealth();
    }
    function clearPersonalKey() {
      if (disposed) return;
      cancelHealth(); cancelRequest(); personalApiKey = ''; ui.keyInput.value = '';
      resetCapabilities(); mode = 'sample'; cloudMessages = [];
      ui.keyStatus.textContent = 'ล้าง key ส่วนตัวแล้ว';
      ui.connection.textContent = 'กำลังตรวจว่าบริการของเซิร์ฟเวอร์พร้อมใช้งานหรือไม่';
      actionStatus('ล้าง key ส่วนตัวและยกเลิกคำขอแล้ว'); renderThread(); updateControls(); checkHealth();
    }
    function stopVoice() {
      if (utterance && win.speechSynthesis) { try { win.speechSynthesis.cancel(); } catch (_) {} }
      utterance = null;
      if (cloudAudio) { cloudAudio.pause(); cloudAudio.removeAttribute('src'); cloudAudio.remove(); cloudAudio = null; }
      if (audioURL) { win.URL.revokeObjectURL(audioURL); audioURL = null; }
    }
    function cancelRequest(message) {
      requestVersion++; if (controller) controller.abort(); controller = null;
      if (requestTimer !== null) win.clearTimeout(requestTimer); requestTimer = null;
      busy = false; pendingMessage = null;
      stopVoice();
      if (!disposed) { updateControls(); renderThread(); if (message) actionStatus(message); }
    }
    function validLearnerClip(value) {
      return value && value.blob && ['recorded', 'uploaded'].includes(value.kind) && Number.isSafeInteger(value.clipId);
    }
    function matchingAssessment() {
      if (!validLearnerClip(clip) || !assessed || clip.clipId !== assessed.clipId
        || !['recorded', 'uploaded'].includes(assessed.clipKind)) return null;
      const data = assessed.data, target = bounded(assessed.target, 350);
      if (!data || data.audio_analyzed !== true || data.precomputed === true || data.analysis_type !== 'acoustic_phone_comparison'
        || !data.reference || normalize(data.reference.text) !== normalize(target)
        || normalize(clip.target) !== normalize(target) || normalize(ui.input.value) !== normalize(target)) return null;
      const summary = data.alignment && data.alignment.summary;
      if (!summary || typeof summary !== 'object') return null;
      if (!data.recognition_quality || !['uncertain', 'recognized'].includes(data.recognition_quality.status)) return null;
      const result = {target, recognition_quality: {}, summary: {}, differences: [], observed_ipa: bounded(data.observed && data.observed.ipa, 600)};
      const quality = data.recognition_quality || {};
      if (['uncertain', 'recognized'].includes(quality.status)) result.recognition_quality.status = quality.status;
      if (typeof quality.calibrated === 'boolean') result.recognition_quality.calibrated = quality.calibrated;
      if (typeof quality.mean_token_posterior === 'number' && Number.isFinite(quality.mean_token_posterior)) result.recognition_quality.mean_token_posterior = quality.mean_token_posterior;
      for (const key of ['match_percent', 'matched_phones', 'reference_phones', 'inserted_phones', 'compared_phones']) {
        const value = summary[key]; if (value === null || typeof value === 'number' && Number.isFinite(value)) result.summary[key] = value;
      }
      const operations = data.alignment && data.alignment.operations;
      if (Array.isArray(operations)) result.differences = operations.filter(item => item && ['substitute', 'delete', 'insert'].includes(item.type)).slice(0, 30).map(item => ({
        type: item.type, expected: item.expected === null ? null : bounded(item.expected, 30), observed: item.observed === null ? null : bounded(item.observed, 30)
      }));
      return result;
    }
    function updateControls() {
      if (disposed) return;
      ui.sample.setAttribute('aria-pressed', String(mode === 'sample')); ui.cloud.setAttribute('aria-pressed', String(mode === 'cloud'));
      ui.cloud.disabled = !capabilities.conversation; ui.samples.hidden = mode !== 'sample';
      ui.send.disabled = busy || mode !== 'cloud' || !capabilities.conversation || !ui.input.value.trim();
      ui.input.disabled = busy; ui.cancel.hidden = !busy;
      ui.clearKey.disabled = !personalApiKey && !ui.keyInput.value;
      ui.transcribe.disabled = busy || !capabilities.transcription || !validLearnerClip(clip);
      const assessment = matchingAssessment(); ui.attach.disabled = !assessment;
      ui.assessment.textContent = assessment ? 'จะแนบเฉพาะผลเสียงของคลิปและประโยคนี้' : assessed ? 'ผลเสียงจะใช้ได้เมื่อประโยคที่ส่งตรงกับคลิปที่วิเคราะห์' : 'บันทึกและวิเคราะห์ประโยคฝึกก่อน';
      ui.clip.textContent = validLearnerClip(clip) ? (clip.info && Number.isFinite(clip.info.duration) ? 'เสียงของคุณ ' + clip.info.duration.toFixed(2) + ' วินาที · พร้อมเลือกถอดเสียง' : 'เลือกเสียงของคุณแล้ว · พร้อมเลือกถอดเสียง') : 'ยังไม่ได้เลือกเสียงของคุณ';
      ui.note.textContent = mode === 'sample' ? 'โหมดตัวอย่าง: เลือกคำตอบที่เตรียมไว้ด้านบน' : 'กดส่งจึงส่งข้อความและผลเสียงที่เลือกไปยัง cloud';
      doc.querySelectorAll('[data-cloud-speech]').forEach(button => { button.disabled = busy || !capabilities.speech; });
    }
    function mountPractice() {
      if (practiceCleanup) practiceCleanup(); practiceCleanup = null; clip = null; assessed = null; stopVoice();
      ui.practice.replaceChildren();
      const item = currentScenario(); byId('practice-target').textContent = item.phrase; byId('practice-translation').textContent = item.translation;
      const cached = win.EGL_DEMO_DATA && win.EGL_DEMO_DATA.texts && win.EGL_DEMO_DATA.texts[item.phrase]
        || win.EGL_PHONETIC_DATA && win.EGL_PHONETIC_DATA[item.phrase];
      if (!win.EGLPhonetics || typeof win.EGLPhonetics.mount !== 'function') {
        ui.practice.append(el('p', 'panel-intro', 'เครื่องมือเสียงยังไม่พร้อมในครั้งนี้ ยังลองบทสนทนาตัวอย่างได้')); updateControls(); return;
      }
      try {
        practiceCleanup = win.EGLPhonetics.mount(ui.practice, {
          text: item.phrase, expanded: true, apiBase: null, demo: true, precomputed: cached || null,
          referenceExample: win.EGL_REFERENCE_AUDIO && win.EGL_REFERENCE_AUDIO[item.phrase] || null,
          onClipChange(value) { if (disposed) return; clip = value && value.blob ? value : null; assessed = null; stopVoice(); updateControls(); },
          onAnalysis(value) { if (disposed) return; assessed = value || null; updateControls(); }
        });
      } catch (_) { ui.practice.append(el('p', 'panel-intro', 'เปิดเครื่องมือเสียงไม่ได้ในครั้งนี้ ยังลองบทสนทนาตัวอย่างได้')); }
      updateControls();
    }
    function localSpeech(text) {
      if (disposed) return;
      stopVoice();
      const voice = win.speechSynthesis && win.speechSynthesis.getVoices().find(item => item.localService === true && /^en([_-]|$)/i.test(item.lang));
      if (!voice || !win.SpeechSynthesisUtterance) { actionStatus('เครื่องนี้ยังไม่มีเสียงอ่านอังกฤษในเครื่อง อ่านประโยคแล้วลองพูดตามได้ครับ'); return; }
      doc.querySelectorAll('audio').forEach(audio => audio.pause());
      utterance = new win.SpeechSynthesisUtterance(text); utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = .9;
      utterance.onerror = () => { if (!disposed) actionStatus('ยังอ่านเสียงนี้ไม่ได้ ลองกดฟังอีกครั้ง'); };
      try { win.speechSynthesis.speak(utterance); } catch (_) { actionStatus('ยังอ่านเสียงนี้ไม่ได้ ลองอ่านข้อความแทน'); }
    }
    function appendMessage(message) {
      const turn = el('article', 'chat-turn ' + message.role);
      const meta = el('div', 'chat-meta', message.role === 'assistant' ? 'มะลิ' : message.source === 'prepared' ? 'คำตอบตัวอย่าง' : 'คุณ');
      meta.append(el('span', 'chat-source', message.source === 'cloud' ? 'Cloud AI' : message.source === 'prepared' ? 'เตรียมไว้' : pendingMessage === message ? 'กำลังส่ง' : 'ข้อความของคุณ'));
      const bubble = el('div', 'chat-bubble'); bubble.append(el('p', 'chat-text', message.content));
      if (message.translation) bubble.append(el('p', 'chat-translation', message.translation));
      if (message.followUp) bubble.append(el('p', 'chat-followup', message.followUp));
      turn.append(meta, bubble);
      if (message.correction) {
        const help = el('div', 'chat-correction'); help.append(el('h4', '', 'ลองพูดให้เป็นธรรมชาติขึ้น'));
        if (message.correction.original) help.append(el('p', '', 'จาก: ' + message.correction.original));
        help.append(el('p', 'suggested', message.correction.suggested), el('p', '', message.correction.explanation)); turn.append(help);
      }
      if (message.pronunciationExplanation) {
        const explanation = el('div', 'chat-pronunciation'); explanation.append(el('h4', '', 'เข้าใจผลเสียงที่คุณเลือก'), el('p', '', message.pronunciationExplanation)); turn.append(explanation);
      }
      if (message.role === 'assistant') {
        const actions = el('div', 'chat-actions');
        const read = el('button', 'text-button', 'ฟังเสียงในเครื่อง'); read.type = 'button'; read.addEventListener('click', () => localSpeech(message.content + (message.followUp ? ' ' + message.followUp : ''))); actions.append(read);
        if (message.source === 'cloud' && capabilities.speech) {
          const speech = el('button', 'text-button', 'ฟังเสียง Cloud'); speech.type = 'button'; speech.dataset.cloudSpeech = 'true'; speech.disabled = busy || !capabilities.speech;
          speech.addEventListener('click', () => cloudSpeech(message.content + (message.followUp ? ' ' + message.followUp : ''), turn)); actions.append(speech);
        }
        turn.append(actions);
      }
      ui.thread.append(turn);
    }
    function renderThread() {
      if (disposed) return;
      ui.thread.replaceChildren();
      const messages = mode === 'sample' ? sampleMessages : cloudMessages;
      if (!messages.length) {
        const empty = el('div', 'conversation-empty'); empty.append(el('span', 'empty-leaf', '❧'), el('h3', '', 'เริ่มจากเรื่องเล็ก ๆ ใกล้ตัว'),
          el('p', '', mode === 'sample' ? 'กด “ลองบทสนทนาตัวอย่าง” เพื่อดูคำตอบ คำแปล และคำช่วยที่เตรียมไว้' : 'พิมพ์ประโยคของคุณ หรืออัดเสียงแล้วเลือกถอดเสียง เมื่อพร้อมค่อยกดส่ง'),
          el('p', 'conversation-sample-prompt', currentScenario().welcome)); ui.thread.append(empty);
      } else messages.forEach(appendMessage);
      if (pendingMessage && mode === 'cloud') appendMessage(pendingMessage);
      ui.thread.scrollTop = ui.thread.scrollHeight;
    }
    function showSamples() {
      ui.replies.replaceChildren(); ui.replies.hidden = !sampleStarted;
      currentScenario().examples.forEach((item, index) => {
        const button = el('button', '', item.text); button.type = 'button'; button.dataset.sampleReply = String(index);
        button.addEventListener('click', () => chooseSample(index)); ui.replies.append(button);
      });
      ui.trySample.textContent = sampleStarted ? 'ดูตัวอย่างอีกครั้ง ↗' : 'ลองบทสนทนาตัวอย่าง ↗';
    }
    function chooseSample(index) {
      if (disposed || mode !== 'sample') return;
      const item = currentScenario().examples[index]; if (!item) return;
      sampleStarted = true;
      sampleMessages = [
        {role: 'assistant', content: currentScenario().welcome, source: 'prepared'},
        {role: 'user', content: item.text, source: 'prepared'},
        {role: 'assistant', content: item.reply, translation: item.translation, followUp: item.followUp, correction: item.correction, source: 'prepared'}
      ];
      ui.input.value = item.text; actionStatus('นี่คือบทสนทนาตัวอย่างที่เตรียมไว้ ยังไม่ได้เรียก cloud หรือส่งเสียงของคุณ'); showSamples(); renderThread(); updateControls();
    }
    async function jsonResponse(response) {
      let value; try { value = await response.json(); } catch (_) { throw new Error('บริการตอบกลับไม่ครบ ลองใหม่อีกครั้งครับ'); }
      if (personalApiKey && JSON.stringify(value).includes(personalApiKey)) throw new Error('บริการตอบกลับไม่ถูกต้อง กรุณาลองใหม่');
      if (!response.ok) throw new Error(bounded(value && (value.error && value.error.message || value.error || value.detail), 300) || 'บริการยังไม่พร้อม ลองใหม่อีกครั้งครับ');
      return value;
    }
    async function runRequest(kind, request, apply) {
      if (disposed || busy) return;
      const version = ++requestVersion; controller = new win.AbortController(); const signal = controller.signal;
      busy = true; updateControls();
      requestTimer = win.setTimeout(() => { if (!disposed && version === requestVersion) controller.abort(); }, 60000);
      actionStatus(kind === 'chat' ? 'มะลิกำลังอ่านและตอบประโยคของคุณ…' : kind === 'transcribe' ? 'กำลังส่งคลิปที่คุณเลือกไปถอดเสียงผ่าน cloud…' : 'กำลังเตรียมเสียงอ่านจาก cloud…');
      try {
        const value = await request(signal);
        if (disposed || version !== requestVersion || signal.aborted) return;
        await apply(value);
      } catch (error) {
        if (!disposed && version === requestVersion) actionStatus(error.name === 'AbortError' ? 'หยุดคำขอแล้ว ลองส่งใหม่ได้ครับ' : bounded(error.message, 350) || 'ยังติดต่อ cloud ไม่ได้ ลองใหม่อีกครั้ง', true);
      } finally {
        if (!disposed && version === requestVersion) {
          if (requestTimer !== null) win.clearTimeout(requestTimer); requestTimer = null; controller = null;
          busy = false; pendingMessage = null; if (kind !== 'speech') renderThread(); updateControls();
        }
      }
    }
    function sendMessage(event) {
      event.preventDefault();
      if (disposed || busy || mode !== 'cloud' || !capabilities.conversation) return;
      const text = ui.input.value.trim(); if (!text || text.length > 1200) return;
      if (personalApiKey && text.includes(personalApiKey)) { ui.input.value = ''; actionStatus('อย่าใส่ key ในบทสนทนา ใช้ช่อง key ส่วนตัวเท่านั้น', true); updateControls(); return; }
      const user = {role: 'user', content: text, source: 'user'};
      const history = cloudMessages.slice(-10).map(item => ({role: item.role, content: item.content}));
      if (!history.length) history.push({role: 'assistant', content: currentScenario().welcome});
      const payload = {scenario, messages: [...history, {role: 'user', content: text}]};
      const assessment = ui.attach.checked && matchingAssessment(); if (assessment) payload.assessment = assessment;
      pendingMessage = user; renderThread();
      runRequest('chat', async signal => jsonResponse(await apiFetch('/api/speak/chat', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal
      })), value => {
        if (!value || value.source !== 'cloud' || typeof value.reply !== 'string' || !value.reply.trim()) throw new Error('ยังไม่ได้รับคำตอบจาก cloud ลองส่งใหม่ครับ');
        const correction = value.correction && typeof value.correction.suggested === 'string' ? {
          original: bounded(value.correction.original, 1200), suggested: bounded(value.correction.suggested, 1200), explanation: bounded(value.correction.explanation, 1800)
        } : null;
        cloudMessages.push(user, {role: 'assistant', content: bounded(value.reply, 4000), translation: bounded(value.translation, 4000),
          correction, followUp: bounded(value.followUp, 1200), pronunciationExplanation: assessment ? bounded(value.pronunciationExplanation, 2400) : '', source: 'cloud'});
        ui.input.value = ''; actionStatus(assessment ? 'ตอบแล้ว พร้อมคำอธิบายผลเสียงที่คุณเลือก' : 'ตอบแล้ว ลองอ่านหรือฟัง แล้วคุยต่อได้ครับ');
      });
    }
    function transcribe() {
      if (disposed || busy || !capabilities.transcription || !validLearnerClip(clip)) return;
      const selected = clip; const form = new win.FormData();
      form.append('audio', selected.blob, selected.blob.type === 'audio/wav' ? 'practice.wav' : 'practice-audio.webm');
      runRequest('transcribe', async signal => jsonResponse(await apiFetch('/api/speak/transcribe', {method: 'POST', body: form, signal})), value => {
        if (!clip || clip.clipId !== selected.clipId) throw new Error('คลิปเปลี่ยนแล้ว ลองเลือกถอดเสียงจากคลิปปัจจุบันอีกครั้ง');
        if (!value || value.source !== 'cloud' || typeof value.text !== 'string' || !value.text.trim()) throw new Error('ยังถอดคำพูดจากคลิปนี้ไม่ได้ ลองพิมพ์ประโยคหรือลองบันทึกใหม่');
        ui.input.value = bounded(value.text, 1200); actionStatus('ถอดเสียงแล้ว ตรวจหรือแก้ข้อความก่อนกดส่งให้มะลิได้ครับ');
      });
    }
    function cloudSpeech(text, owner) {
      if (disposed || busy || !capabilities.speech) return;
      runRequest('speech', async signal => {
        const response = await apiFetch('/api/speak/speech', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: bounded(text, 4000)}), signal});
        if (!response.ok) { await jsonResponse(response); throw new Error('ยังเตรียมเสียงจาก cloud ไม่ได้'); }
        const blob = await response.blob(); if (!blob.size || !/^audio\//.test(blob.type)) throw new Error('ไฟล์เสียงจาก cloud ยังเปิดไม่ได้'); return blob;
      }, async blob => {
        stopVoice(); doc.querySelectorAll('audio').forEach(audio => audio.pause());
        audioURL = win.URL.createObjectURL(blob); cloudAudio = el('audio', 'speak-cloud-audio'); cloudAudio.controls = true; cloudAudio.src = audioURL;
        cloudAudio.setAttribute('aria-label', 'เสียงอ่านคำตอบจาก cloud'); owner.append(cloudAudio);
        try { await cloudAudio.play(); actionStatus('กำลังเล่นเสียงจาก cloud'); } catch (_) { actionStatus('เสียงพร้อมแล้ว กดเล่นบนแถบเสียงได้ครับ'); }
      });
    }
    function resetConversation() {
      cancelRequest(); cloudMessages = []; sampleMessages = []; sampleStarted = false; ui.input.value = '';
      actionStatus('เริ่มบทสนทนาใหม่แล้ว'); showSamples(); renderThread(); updateControls();
    }
    listen(form, 'submit', sendMessage); listen(ui.input, 'input', updateControls);
    listen(ui.connectKey, 'click', connectPersonalKey); listen(ui.clearKey, 'click', clearPersonalKey); listen(ui.keyInput, 'input', updateControls);
    listen(ui.keyInput, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); connectPersonalKey(); } });
    listen(ui.trySample, 'click', () => { if (mode !== 'sample') { cancelRequest(); mode = 'sample'; } chooseSample(0); });
    listen(ui.sample, 'click', () => { if (mode === 'sample') return; cancelRequest(); mode = 'sample'; actionStatus('โหมดตัวอย่างที่เตรียมไว้ · ยังไม่ได้เรียก cloud'); renderThread(); updateControls(); });
    listen(ui.cloud, 'click', () => { if (!capabilities.conversation || mode === 'cloud') return; cancelRequest(); mode = 'cloud'; actionStatus('พร้อมสนทนา เมื่อกดส่งจึงส่งข้อความไป cloud'); renderThread(); updateControls(); });
    listen(byId('new-conversation'), 'click', resetConversation);
    listen(ui.cancel, 'click', () => cancelRequest('ยกเลิกแล้ว ข้อความและคลิปยังอยู่ให้ลองใหม่ได้'));
    listen(ui.transcribe, 'click', transcribe);
    doc.querySelectorAll('[data-scenario]').forEach(button => listen(button, 'click', () => {
      const next = button.dataset.scenario; if (!SCENARIOS[next] || next === scenario) return;
      scenario = next; resetConversation();
      doc.querySelectorAll('[data-scenario]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      mountPractice();
    }));
    function cleanup() {
      if (disposed) return;
      disposed = true; cancelHealth(); personalApiKey = ''; supportsPersonalKey = false; ui.keyInput.value = ''; resetCapabilities();
      ui.keyStatus.textContent = 'ยังไม่ได้ตั้ง key ส่วนตัว'; ui.clearKey.disabled = true; ui.cloud.disabled = true;
      cancelRequest(); if (practiceCleanup) practiceCleanup(); practiceCleanup = null;
      listeners.splice(0).forEach(remove => remove()); form.removeAttribute('data-speak-mounted');
      clip = null; assessed = null; cloudMessages = []; sampleMessages = [];
    }
    listen(win, 'pagehide', cleanup);
    showSamples(); mountPractice(); renderThread(); updateControls();
    checkHealth();
    return cleanup;
  }
  const api = Object.freeze({mount}); global.EGLSpeak = api;
  function autoMount() { if (global.document && global.document.getElementById('conversation-form')) api.mount(global.document); }
  autoMount();
  if (global.addEventListener) global.addEventListener('pageshow', event => { if (event.persisted) autoMount(); });
})(globalThis);
