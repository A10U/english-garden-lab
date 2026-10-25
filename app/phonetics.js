/* English Garden Lab: opt-in local phonetic reference and audio comparison. */
(function (global) {
  'use strict';
  const MAX_BYTES = 10 * 1024 * 1024;
  let nextId = 0;

  function validPercent(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : null;
  }

  // Older responses may lack counts. Derive only from real alignment
  // operations; a word's status or list of differences cannot supply a %.
  function operationCounts(operations) {
    if (!Array.isArray(operations) || !operations.length) return null;
    const counts = { matched_phones: 0, reference_phones: 0, inserted_phones: 0 };
    let observedCount = 0;
    for (const op of operations) {
      const expected = typeof op.expected === 'string' && op.expected.length > 0;
      const observed = typeof op.observed === 'string' && op.observed.length > 0;
      if (observed) observedCount++;
      if (op.type === 'match' && expected && observed) { counts.matched_phones++; counts.reference_phones++; }
      else if (op.type === 'substitute' && expected && observed) counts.reference_phones++;
      else if (op.type === 'delete' && expected && !observed) counts.reference_phones++;
      else if (op.type === 'insert' && !expected && observed) counts.inserted_phones++;
      else return null;
    }
    const denominator = counts.reference_phones + counts.inserted_phones;
    counts.compared_phones = denominator;
    counts.match_percent = counts.reference_phones && denominator && observedCount ? 100 * counts.matched_phones / denominator : null;
    return counts;
  }

  function percentage(data, operations) {
    if (data && Object.prototype.hasOwnProperty.call(data, 'match_percent')) return validPercent(data.match_percent);
    const counts = operationCounts(operations);
    return counts ? validPercent(counts.match_percent) : null;
  }

  function percentText(value) { return value == null ? '—' : value.toFixed(1) + '%'; }
  function percentLevel(value) {
    if (value == null) return 'unassessed';
    return value >= 95 ? 'purple' : value >= 90 ? 'blue' : value >= 80 ? 'indigo' : value >= 70 ? 'sky' : value >= 60 ? 'green' : value >= 50 ? 'yellow' : value >= 40 ? 'orange' : 'red';
  }

  function checkedAudioFrames(frames, sampleRate) {
    const duration = frames / sampleRate;
    if (!Number.isInteger(frames) || frames <= 0 || !Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isFinite(duration) || duration < 0.2 || duration > 15) {
      throw new Error('Recording must contain 0.2–15 seconds of decoded audio');
    }
    return duration;
  }

  function monoWave(channels, sampleRate) {
    if (!Array.isArray(channels) || !channels.length) throw new Error('No decoded audio channels');
    const frames = channels[0].length;
    const duration = checkedAudioFrames(frames, sampleRate);
    if (channels.some(channel => channel.length !== frames)) throw new Error('Inconsistent decoded audio channels');
    const bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, frames * 2, true);
    let sumSquares = 0, peak = 0;
    for (let i = 0; i < frames; i++) {
      let value = 0;
      for (const channel of channels) {
        if (!Number.isFinite(channel[i])) throw new Error('Nonfinite decoded audio samples');
        value += channel[i] / channels.length;
      }
      value = Math.max(-1, Math.min(1, value));
      sumSquares += value * value; peak = Math.max(peak, Math.abs(value));
      view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
    }
    const rmsDbfs = 20 * Math.log10(Math.max(Math.sqrt(sumSquares / frames), 1e-6));
    return { blob: new global.Blob([bytes], { type: 'audio/wav' }), duration, rmsDbfs, peak, sampleRate, frames };
  }

  function normalizedWave(bytes) {
    const view = new DataView(bytes);
    const ascii = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
    if (bytes.byteLength < 44 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error('Invalid complete WAV container');
    let rate = 0, dataOffset = 0, dataBytes = 0, formatOK = false;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const tag = ascii(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > bytes.byteLength) throw new Error('Truncated WAV chunk');
      if (tag === 'fmt ') {
        if (size < 16) throw new Error('Missing WAV format');
        rate = view.getUint32(start + 4, true);
        formatOK = view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1 && view.getUint16(start + 12, true) === 2 && view.getUint16(start + 14, true) === 16 && view.getUint32(start + 8, true) === rate * 2;
      }
      if (tag === 'data') { dataOffset = start; dataBytes = size; }
      offset = start + size + (size % 2);
    }
    if (!formatOK || !dataOffset || !dataBytes || dataBytes % 2) throw new Error('Expected nonempty mono PCM16 WAV');
    const samples = new Float32Array(dataBytes / 2);
    checkedAudioFrames(samples.length, rate);
    for (let i = 0; i < samples.length; i++) {
      const value = view.getInt16(dataOffset + i * 2, true);
      samples[i] = value / (value < 0 ? 32768 : 32767);
    }
    return monoWave([samples], rate);
  }

  function mount(container, options) {
    if (!container || !container.ownerDocument) throw new TypeError('A container element is required');
    options = options || {};
    const doc = container.ownerDocument;
    const win = doc.defaultView || global;
    const location = win.location;
    const loopback = hostname => /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(hostname);
    // A published page must never probe the visitor's local computer, even
    // if a locally generated page still passes its old apiBase option.
    const hosted = /^https?:$/.test(location.protocol) && !loopback(location.hostname);
    const runtime = options.runtime || global.EGL_DEMO_RUNTIME || {};
    const demoMode = hosted || options.demo === true || runtime.mode === 'demo' || options.apiBase === null;
    const ownOrigin = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '8766';
    const api = demoMode ? null : new win.URL(options.apiBase || (ownOrigin ? location.origin : location.origin), doc.baseURI);
    if (api && (api.protocol !== 'http:' || !/^(127\.0\.0\.1|localhost)$/.test(api.hostname))) {
      throw new TypeError('Phonetics API must be an HTTP service on 127.0.0.1 or localhost');
    }
    const apiBase = api ? api.href.replace(/\/$/, '') : null;
    const localAnalysisRequired = 'การวิเคราะห์เสียงที่คุณบันทึกต้องเปิดรุ่นในเครื่อง';
    const id = 'egl-phonetics-' + (++nextId);
    let disposed = false, version = 0, controller = null, busy = false;
    let stream = null, recorder = null, recording = false, requestingMic = false, preparing = false;
    let prepareController = null, decodeContext = null;
    let recordingVersion = 0, recordTimer = null, playbackTimer = null, playbackEnd = null;
    let clip = null, clipLabel = '', clipURL = null, clipKind = '', clipInfo = null, reference = null;
    let mode = 'own', analysisData = null, wordItems = [], selectedIndex = null, slow = false;
    let practiceWord = null, sentenceResult = null, referenceFocus = null, inspector = null;
    let exampleEnd = null, exampleTimer = null, localUtterance = null, exampleVersion = 0, playbackVersion = 0;
    const listeners = [], referenceListeners = [], observedListeners = [], inspectorListeners = [], objectURLs = new Set();
    const sourceButtons = [], listenButtons = [];

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }
    function on(node, type, listener, opts, bucket) {
      node.addEventListener(type, listener, opts);
      (bucket || listeners).push(() => node.removeEventListener(type, listener, opts));
    }
    function button(text, action, className, bucket) {
      const node = el('button', className || 'egl-ph-button', text);
      node.type = 'button';
      on(node, 'click', action, undefined, bucket);
      return node;
    }
    function friendly(message) { const error = new Error(message); error.userMessage = message; return error; }
    function setStatus(message, error) {
      if (disposed) return;
      status.textContent = message || '';
      status.classList.toggle('egl-ph-status-error', Boolean(error));
    }
    function updateButtons() {
      const occupied = busy || preparing;
      textButton.disabled = occupied || recording || requestingMic;
      analyzeButton.disabled = demoMode || occupied || recording || requestingMic || !clip;
      sourceButtons.forEach(node => { node.disabled = occupied || recording || requestingMic; });
      listenButtons.forEach(node => { node.disabled = occupied || recording || requestingMic; });
      recordButton.disabled = occupied || requestingMic;
      fileInput.disabled = occupied || recording || requestingMic;
      recordButton.textContent = preparing ? 'กำลังเตรียมเสียง…' : requestingMic ? 'กำลังขอใช้ไมโครโฟน…' : recording ? 'หยุดบันทึก' : 'บันทึกเสียงของฉัน';
      selfListenButton.textContent = clipKind === 'recorded' ? 'ฟังเสียงของฉัน' : 'ฟังเสียงที่เลือก';
      selfAudioControls.hidden = !clip;
      selfListenButton.disabled = occupied || recording || requestingMic || !clip;
      selfRestartButton.disabled = selfListenButton.disabled;
      selfPauseButton.disabled = selfListenButton.disabled;
      root.setAttribute('aria-busy', String(occupied));
      ownTab.setAttribute('aria-selected', String(mode === 'own'));
      aiTab.setAttribute('aria-selected', String(mode === 'ai'));
      ownTab.tabIndex = mode === 'own' ? 0 : -1;
      aiTab.tabIndex = mode === 'ai' ? 0 : -1;
      ownPanel.hidden = mode !== 'own';
      aiPanel.hidden = mode !== 'ai';
    }
    function cancelRequest() {
      version += 1;
      if (controller) controller.abort();
      controller = null;
      busy = false;
      updateButtons();
    }
    function clearObserved() {
      observedListeners.splice(0).forEach(remove => remove());
      inspectorListeners.splice(0).forEach(remove => remove());
      analysisData = null; wordItems = []; selectedIndex = null;
      observed.replaceChildren(); observed.hidden = true; stopPlayback();
      resultPlaceholder.hidden = false;
    }
    function changeText() {
      cancelRequest();
      stopCapture();
      reference = null;
      practiceWord = null; sentenceResult = null; stopExample(); clearClip();
      referenceListeners.splice(0).forEach(remove => remove());
      phrase.textContent = textarea.value.trim() || 'ใส่ข้อความภาษาอังกฤษใน “แก้ข้อความ / สำเนียง”';
      updateStudyHelp(); updateTarget();
      selectedPhrase.textContent = 'แตะคำเพื่อดูเสียงทีละส่วน';
      expected.replaceChildren();
      expected.hidden = true;
      clearObserved();
      setStatus('กด “ดูคำอ่าน” เพื่อดู IPA ตามข้อความและสำเนียงที่เลือก');
    }
    function inputValues() {
      const text = practiceWord ? String(practiceWord.text).trim() : textarea.value.trim();
      if (!text) throw friendly('ใส่ข้อความภาษาอังกฤษก่อนครับ');
      if (text.length > 350 || text.split(/\s+/).length > 60) throw friendly('ใช้ข้อความไม่เกิน 350 ตัวอักษร และ 60 คำต่อครั้ง');
      return { text: text, accent: accent.value };
    }
    function showServiceError(error) {
      const message = error.userMessage || (demoMode ? 'ยังเปิดข้อมูลตัวอย่างนี้ไม่ได้ ลองโหลดหน้าใหม่อีกครั้ง' : 'เปิดบริการเสียงในเครื่องก่อน แล้วลองอีกครั้ง');
      setStatus(message, true);
      service.hidden = demoMode || Boolean(error.userMessage);
    }
    function demoData() { return options.demoData || global.EGL_DEMO_DATA || {}; }
    function portableURL(value) {
      const url = new win.URL(value, doc.baseURI);
      const forbiddenLoopback = loopback(url.hostname) && (hosted || url.origin !== location.origin);
      if (demoMode && (forbiddenLoopback || url.protocol === 'file:')) throw friendly('เสียงตัวอย่างนี้ยังไม่ได้รวมไว้ในเดโมออนไลน์');
      return url;
    }
    function catalogByURL(catalog, value) {
      if (!catalog || typeof catalog !== 'object') return null;
      let wanted;
      try { wanted = portableURL(value).href; } catch (_) { return null; }
      for (const key of Object.keys(catalog)) {
        try { if (portableURL(key).href === wanted) return catalog[key]; } catch (_) {}
      }
      return null;
    }
    function cachedAI(source, values) {
      const cached = catalogByURL(demoData().analyses, source.url);
      const expected = cached && cached.reference;
      if (!cached || cached.audio_analyzed !== true || cached.analysis_type !== 'acoustic_phone_comparison' || cached.playback_source !== 'prerecorded_ai' || cached.precomputed !== true || cached.live_analysis !== false || !expected || expected.text !== values.text || expected.accent !== values.accent) {
        throw friendly('เดโมนี้ยังไม่มีผลวิเคราะห์ที่เตรียมไว้สำหรับไฟล์ ข้อความ และสำเนียงนี้');
      }
      return cached;
    }
    async function request(action, message) {
      if (disposed) return;
      let values;
      try { values = inputValues(); } catch (error) { showServiceError(error); return; }
      cancelRequest();
      const current = version;
      const abort = new win.AbortController();
      controller = abort;
      busy = true;
      service.hidden = true;
      updateButtons();
      setStatus(message || 'กำลังวิเคราะห์เสียง…');
      try {
        const result = await action(values, abort.signal, () => !disposed && current === version);
        if (disposed || current !== version) return;
        if (result && result.audio_analyzed === true) renderAnalysis(result);
        else if (result) { renderReference(result); setStatus('แสดงคำอ่านอ้างอิงจากข้อความแล้ว ยังไม่ได้วิเคราะห์เสียง'); }
      } catch (error) {
        if (!disposed && current === version && error.name !== 'AbortError') showServiceError(error);
      } finally {
        if (!disposed && current === version) { busy = false; controller = null; updateButtons(); }
      }
    }
    async function jsonResponse(response) {
      let data;
      try { data = await response.json(); } catch (_) { throw new Error('Invalid local service response'); }
      if (!response.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : '';
        if (response.status === 400 || response.status === 413 || response.status === 422) {
          throw friendly(detail ? 'วิเคราะห์ไฟล์นี้ไม่ได้: ' + detail.slice(0, 240) : 'ตรวจสอบไฟล์เสียงและข้อความ แล้วลองอีกครั้ง');
        }
        throw new Error('Local service not ready');
      }
      return data;
    }
    function checkBlob(blob) {
      if (!blob || !blob.size) throw friendly('ไฟล์เสียงว่าง ลองเลือกไฟล์หรือบันทึกใหม่');
      if (blob.size > MAX_BYTES) throw friendly('ไฟล์เสียงต้องไม่เกิน 10 MB');
    }
    function revokeURL(url) {
      if (url && objectURLs.has(url)) { win.URL.revokeObjectURL(url); objectURLs.delete(url); }
    }
    function setClip(blob, label, kind, info) {
      checkBlob(blob);
      clearObserved();
      revokeURL(clipURL);
      clip = blob;
      clipLabel = label;
      clipKind = kind || 'uploaded'; clipInfo = info || null;
      clipURL = win.URL.createObjectURL(blob);
      objectURLs.add(clipURL);
      player.src = clipURL;
      player.hidden = false;
      chosen.textContent = label;
      durationText.textContent = clipInfo ? 'ความยาวเสียง ' + clipInfo.duration.toFixed(2) + ' วินาที' : '';
      player.load();
      updateButtons();
    }
    function clearClip() {
      clearObserved(); revokeURL(clipURL);
      clip = null; clipURL = null; clipLabel = ''; clipKind = ''; clipInfo = null;
      player.removeAttribute('src'); player.hidden = true; chosen.textContent = '';
      durationText.textContent = '';
      fileInput.value = '';
    }
    function closeContext(context) {
      if (!context || typeof context.close !== 'function') return;
      try { const result = context.close(); if (result && result.catch) result.catch(() => {}); } catch (_) {}
    }
    function assertPreparing(attempt, signal) {
      if (disposed || attempt !== recordingVersion || signal.aborted) throw new win.DOMException('Recording preparation canceled', 'AbortError');
    }
    async function blobBytes(blob, signal) {
      if (typeof blob.arrayBuffer === 'function') {
        const bytes = await blob.arrayBuffer();
        if (signal.aborted) throw new win.DOMException('Canceled', 'AbortError');
        return bytes;
      }
      return new Promise((resolve, reject) => {
        const reader = new win.FileReader();
        const detach = () => signal.removeEventListener('abort', abort);
        const abort = () => { reader.abort(); detach(); reject(new win.DOMException('Canceled', 'AbortError')); };
        reader.onload = () => { detach(); resolve(reader.result); };
        reader.onerror = () => { detach(); reject(new Error('Unable to read recording bytes')); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        reader.readAsArrayBuffer(blob);
      });
    }
    async function prepareRecording(blob, attempt, signal) {
      checkBlob(blob);
      const Context = win.AudioContext || win.webkitAudioContext;
      let context = null;
      try {
        if (!Context) throw new Error('Browser audio decoder unavailable');
        context = new Context(); decodeContext = context;
        const bytes = await blobBytes(blob, signal); assertPreparing(attempt, signal);
        const decoded = await context.decodeAudioData(bytes); assertPreparing(attempt, signal);
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1) throw new Error('Missing decoded recording duration/channels');
        const channels = [];
        for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
        const prepared = monoWave(channels, decoded.sampleRate);
        if (Math.abs(decoded.duration - prepared.duration) > Math.max(0.01, 2 / decoded.sampleRate)) throw new Error('Inconsistent decoded recording duration');
        return prepared;
      } catch (error) {
        assertPreparing(attempt, signal);
        // Some embedded browsers can capture an encoded container but cannot
        // decode it for playback. Normalize locally without an acoustic model.
      } finally {
        closeContext(context);
        if (decodeContext === context) decodeContext = null;
      }
      assertPreparing(attempt, signal);
      if (demoMode) throw friendly('เบราว์เซอร์นี้ยังเตรียมเสียงให้เล่นในเดโมไม่ได้ ลองเลือกไฟล์ WAV หรือเปิดรุ่นในเครื่อง');
      const form = new win.FormData(); form.append('audio', blob, /mp4/.test(blob.type) ? 'recording.m4a' : 'recording.webm');
      const response = await win.fetch(apiBase + '/api/phonetics/normalize', { method: 'POST', body: form, signal });
      assertPreparing(attempt, signal);
      if (!response.ok) throw new Error('Local recording preparation failed');
      const normalized = await response.blob(); assertPreparing(attempt, signal); checkBlob(normalized);
      const bytes = await blobBytes(normalized, signal); assertPreparing(attempt, signal);
      return normalizedWave(bytes);
    }
    function playOwn(restart) {
      if (!clip || disposed || preparing) return;
      stopPlayback(); stopExample();
      doc.querySelectorAll('audio').forEach(audio => { if (audio !== player) audio.pause(); });
      player.muted = false; player.volume = 1; player.playbackRate = 1;
      if (restart || player.ended) player.currentTime = 0;
      const currentURL = clipURL;
      try {
        const played = player.play();
        if (played && played.catch) played.catch(error => {
          if (disposed || currentURL !== clipURL || error.name === 'AbortError') return;
          setStatus(error.name === 'NotAllowedError' ? 'เบราว์เซอร์ยังไม่อนุญาตให้เล่นเสียง กดปุ่มเล่นบนแถบเสียงอีกครั้ง' : 'ยังเปิดเสียงที่บันทึกไม่ได้ ลองบันทึกใหม่หรือเปิดหน้าเรียนในเบราว์เซอร์อีกครั้ง', true);
        });
      } catch (_) { setStatus('ยังเล่นเสียงนี้ไม่ได้ กดปุ่มเล่นบนแถบเสียงหรือลองบันทึกใหม่', true); }
    }
    function changeMode(nextMode) {
      if (mode === nextMode) return;
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      if (nextMode === 'ai' && practiceWord) { practiceWord = null; updateTarget(); }
      mode = nextMode; updateButtons();
      setStatus(mode === 'own' ? 'บันทึกสั้น ๆ หรือเลือกไฟล์ แล้วกด “ดูผลเสียงของฉัน”' : 'เลือกเสียง AI ที่ต้องการเปรียบเทียบ');
    }
    function resolveSource(url) {
      const resolved = portableURL(url);
      if (resolved.protocol === 'file:') {
        const marker = resolved.pathname.lastIndexOf('/speech-training/');
        if (marker < 0) throw friendly('เปิดหน้าเสียงผ่านบริการในเครื่อง แล้วลองวิเคราะห์อีกครั้ง');
        return api.origin + resolved.pathname.slice(marker) + resolved.search;
      }
      if (!/^(https?:|blob:)$/.test(resolved.protocol)) throw friendly('ที่อยู่ไฟล์เสียงนี้เปิดไม่ได้');
      return resolved.href;
    }
    async function upload(blob, values, signal) {
      if (demoMode) throw friendly(localAnalysisRequired);
      checkBlob(blob);
      const form = new win.FormData();
      const type = blob.type || '';
      const extension = /mp4|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /webm/.test(type) ? 'webm' : 'wav';
      form.append('audio', blob, 'speech.' + extension);
      form.append('text', values.text);
      form.append('accent', values.accent);
      if (practiceWord && Number.isInteger(practiceWord.index) && practiceWord.index >= 0) {
        form.append('context_text', textarea.value.trim());
        form.append('context_word_index', String(practiceWord.index));
      }
      return jsonResponse(await win.fetch(apiBase + '/api/phonetics/analyze', { method: 'POST', body: form, signal: signal }));
    }
    function ipaText(value) { return Array.isArray(value) ? value.join(' ') : value == null ? '—' : String(value); }
    function guideFor(phone) {
      try {
        if (global.EGLPhoneGuide && typeof global.EGLPhoneGuide.describe === 'function') {
          return global.EGLPhoneGuide.describe(phone) || {};
        }
      } catch (_) {}
      return { symbol: phone, label: 'หน่วยเสียง ' + phone, tip: '', example: '' };
    }
    function wordKey(text) { return String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z']/g, ''); }
    function wordMeaning(word) {
      try {
        const help = global.EGLStudyHelp && global.EGLStudyHelp.forText(textarea.value.trim());
        return help && help.words && help.words[wordKey(word.text)] || '';
      } catch (_) { return ''; }
    }
    function countsText(data, operations) {
      let counts = data;
      if (!counts || !Number.isFinite(counts.matched_phones) || !Number.isFinite(counts.compared_phones)) counts = operationCounts(operations);
      return counts && counts.compared_phones > 0 ? counts.matched_phones + ' / ' + counts.compared_phones + ' หน่วยเสียง' : 'ข้อมูลยังไม่พอสำหรับเปรียบเทียบ';
    }
    function exampleForPhrase() {
      const text = textarea.value.trim();
      const supplied = options.referenceExample;
      if (demoMode) {
        const catalog = demoData().reference_audio || {};
        if (supplied && supplied.url) {
          const matched = catalogByURL(catalog.by_audio, supplied.url);
          if (matched) return { ...matched, label: supplied.label || matched.label || 'เสียงตัวอย่าง' };
        }
        const first = sources[0];
        if (first) {
          const matched = catalogByURL(catalog.by_audio, first.url);
          if (matched) return { ...matched, label: 'เสียงตัวอย่าง ' + String(first.label || 'A') };
        }
        const cached = catalog.by_text && catalog.by_text[text];
        if (cached) return cached;
        return null;
      }
      const cached = global.EGL_REFERENCE_AUDIO && global.EGL_REFERENCE_AUDIO[text];
      if (supplied && (!supplied.text || supplied.text === text)) return supplied;
      if (cached) return cached;
      const first = sources[0];
      return first ? { text, url: first.url, words: first.words || [], label: 'เสียงตัวอย่าง ' + String(first.label || 'A') } : null;
    }
    function exampleWord(example, word) {
      const normalize = text => String(text).toLowerCase().replace(/[^a-z']/g, '');
      const words = Array.isArray(example.words) ? example.words : [];
      return words.find(item => String(item.index) === String(word.index) && normalize(item.text) === normalize(word.text)) || words.find(item => normalize(item.text) === normalize(word.text));
    }
    function stopExample() {
      exampleVersion++;
      if (exampleTimer !== null) win.clearTimeout(exampleTimer);
      exampleTimer = null; exampleEnd = null;
      examplePlayer.pause();
      if (localUtterance && win.speechSynthesis) { win.speechSynthesis.cancel(); localUtterance = null; }
    }
    function armExampleStop() {
      if (exampleTimer !== null) win.clearTimeout(exampleTimer);
      if (exampleEnd != null) exampleTimer = win.setTimeout(stopExample, Math.max(0, exampleEnd - examplePlayer.currentTime) / (slow ? 0.75 : 1) * 1000 + 100);
    }
    function playExample(word, wholePhrase) {
      stopPlayback(); stopExample();
      const currentExample = exampleVersion;
      let example = exampleForPhrase();
      const targetWord = wholePhrase ? null : word || practiceWord;
      let located = example && targetWord ? exampleWord(example, targetWord) : null;
      let range = located ? rangeFor(located) : null;
      if (targetWord && !range) {
        for (const source of sources) {
          if (!source || typeof source.url !== 'string') continue;
          try { portableURL(source.url); } catch (_) { continue; }
          const candidate = { url: source.url, words: source.words || [], label: 'เสียงตัวอย่าง ' + String(source.label || 'A') };
          const candidateWord = exampleWord(candidate, targetWord);
          const candidateRange = candidateWord && rangeFor(candidateWord);
          if (candidateRange) { example = candidate; located = candidateWord; range = candidateRange; break; }
        }
      }
      if (example && example.url && (!targetWord || range)) {
        let url;
        try { url = portableURL(example.url); } catch (error) { showServiceError(error); return; }
        if (!/^(https?:|file:|blob:)$/.test(url.protocol)) { setStatus('ยังเปิดเสียงตัวอย่างนี้ไม่ได้', true); return; }
        exampleCaption.textContent = example.label || 'เสียงตัวอย่าง';
        const seek = () => {
          examplePlayer.currentTime = range ? range.start : 0;
          examplePlayer.playbackRate = slow ? 0.75 : 1;
          exampleEnd = range ? range.end : null; armExampleStop();
        };
        if (examplePlayer.src === url.href && examplePlayer.readyState >= 1) seek();
        else {
          examplePlayer.src = url.href;
          const activeURL = url.href;
          on(examplePlayer, 'loadedmetadata', () => { if (!disposed && currentExample === exampleVersion && examplePlayer.src === activeURL) seek(); }, { once: true });
        }
        const played = examplePlayer.play();
        if (played && played.catch) played.catch(error => { if (!disposed && currentExample === exampleVersion && error.name !== 'AbortError') setStatus('เปิดเสียงตัวอย่างไม่ได้ ลองเปิดบริการเสียงในเครื่องแล้วกดฟังอีกครั้ง', true); });
        return;
      }
      // This explicit fallback reads the English word, never IPA. Only an
      // installed local English voice is eligible; no network voice is used.
      const synthesis = win.speechSynthesis;
      const voice = synthesis && synthesis.getVoices().find(item => item.localService === true && /^en([-_]|$)/i.test(item.lang));
      if (!voice || !win.SpeechSynthesisUtterance) { setStatus('ยังไม่มีเสียงตัวอย่างคำนี้ เปิดหน้าเรียนผ่านบริการเสียงในเครื่องหรือติดตั้งเสียงอังกฤษในเครื่องก่อน', true); return; }
      const utterance = new win.SpeechSynthesisUtterance(targetWord ? targetWord.text : textarea.value.trim());
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = slow ? 0.75 : 1;
      localUtterance = utterance;
      utterance.onend = () => { if (localUtterance === utterance) localUtterance = null; };
      utterance.onerror = utterance.onend;
      exampleCaption.textContent = 'เสียงอ่านในเครื่อง';
      synthesis.speak(utterance);
    }
    function practice(word, focusRecord) {
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      practiceWord = { index: word.index, text: word.text, phones: word.phones || [] };
      mode = 'own'; updateTarget(); updateButtons();
      setStatus('พร้อมฝึกคำว่า ' + word.text + ' · กดบันทึกเมื่อพร้อม แล้วกดดูผล');
      if (focusRecord !== false) recordButton.focus();
    }
    function backToSentence() {
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      practiceWord = null; updateTarget(); updateButtons();
      if (sentenceResult) {
        const saved = sentenceResult;
        mode = saved.mode === 'ai' ? 'ai' : 'own'; updateButtons();
        if (saved.blob) setClip(saved.blob, saved.label, saved.kind, saved.info);
        renderAnalysis(saved.data);
      } else setStatus('กลับมาฝึกทั้งประโยคแล้ว กดบันทึกเมื่อพร้อม');
    }
    function updateTarget() {
      targetBanner.hidden = !practiceWord;
      targetText.textContent = practiceWord ? 'กำลังฝึกคำ: ' + practiceWord.text : '';
      recordHint.textContent = practiceWord ? 'พูดเฉพาะคำว่า “' + practiceWord.text + '” แล้วกดหยุด' : 'พูดประโยคด้านบนให้จบ แล้วกดหยุด';
      selectedPhrase.textContent = practiceWord ? 'กำลังฝึกคำ: ' + practiceWord.text : 'แตะคำเพื่อดูเสียงทีละส่วน';
    }
    function updateStudyHelp() {
      translation.textContent = ''; translation.hidden = true; chunks.replaceChildren(); chunks.hidden = true;
      let help = null;
      try { help = global.EGLStudyHelp && global.EGLStudyHelp.forText(textarea.value.trim()); } catch (_) {}
      if (!help) return;
      if (help.translation) { translation.textContent = help.translation; translation.hidden = false; }
      if (Array.isArray(help.chunks) && help.chunks.length > 1) {
        help.chunks.forEach(chunk => {
          const part = el('span', 'egl-ph-chunk');
          part.append(el('span', '', chunk.text));
          if (chunk.translation) part.append(el('small', '', chunk.translation));
          chunks.append(part);
        });
        chunks.hidden = false;
      }
    }
    function showPhoneGuide(holder, phone, explanation) {
      const guide = guideFor(phone);
      holder.replaceChildren(el('strong', 'egl-ph-guide-label', guide.label || phone));
      if (explanation) holder.append(el('p', 'egl-ph-note', explanation));
      if (guide.tip) holder.append(el('p', 'egl-ph-guide-tip', guide.tip));
      if (guide.example) holder.append(el('p', 'egl-ph-note', 'ตัวอย่าง: ' + guide.example));
    }
    function referenceWord(word) {
      if (practiceWord && String(practiceWord.index) !== String(word.index)) practice(word, false);
      selectedPhrase.textContent = 'คำที่เลือก: ' + word.text;
      let matching = -1;
      if (practiceWord) {
        // A word-only response starts at index 0. Its original sentence
        // index is retained in practiceWord, not in that response.
        const sameContext = String(word.index) === String(practiceWord.index) && wordKey(word.text) === wordKey(practiceWord.text);
        if (sameContext) matching = wordItems.findIndex(item => wordKey(item.word.text) === wordKey(word.text));
      } else {
        matching = wordItems.findIndex(item => String(item.word.index) === String(word.index) && wordKey(item.word.text) === wordKey(word.text));
      }
      if (analysisData && matching >= 0) { selectWord(matching); return; }
      referenceFocus.replaceChildren(el('h4', 'egl-ph-heading', 'แยกเสียงคำว่า ' + word.text));
      const meaning = wordMeaning(word);
      if (meaning) referenceFocus.append(el('p', 'egl-ph-word-meaning', meaning));
      const chips = el('div', 'egl-ph-phone-chips');
      const guide = el('div', 'egl-ph-guide');
      const phones = Array.isArray(word.phones) ? word.phones : [];
      const actions = el('div', 'egl-ph-actions');
      actions.append(button('ฟังคำตัวอย่าง', () => playExample(word), 'egl-ph-button', referenceListeners), button('ฝึกคำนี้', () => practice(word), 'egl-ph-button egl-ph-primary', referenceListeners));
      phones.forEach(phone => chips.append(button(phone, () => {
        showPhoneGuide(guide, phone, 'นี่คือเสียงอ้างอิงจากข้อความ ยังไม่ได้ฟังจากไฟล์เสียง');
      }, 'egl-ph-phone', referenceListeners)));
      referenceFocus.append(actions, chips, guide);
      if (phones.length) showPhoneGuide(guide, phones[0]);
      else guide.append(el('p', 'egl-ph-note', 'ดูคำอ่าน IPA ในรายละเอียดด้านล่างได้ครับ'));
      referenceFocus.hidden = false;
    }
    function renderReference(data) {
      if (!data || !Array.isArray(data.words)) throw new Error('Invalid pronunciation reference');
      if (practiceWord && data.text !== textarea.value.trim()) return;
      referenceListeners.splice(0).forEach(remove => remove());
      reference = data;
      expected.replaceChildren(el('p', 'egl-ph-note', 'แตะคำที่อยากฝึก เพื่อแยกดูหน่วยเสียง'));
      const words = el('div', 'egl-ph-words');
      data.words.slice(0, 200).forEach(word => {
        const token = button('', () => referenceWord(word), 'egl-ph-word egl-ph-ref-word', referenceListeners);
        token.append(el('span', 'egl-ph-token', word.text));
        if (Array.isArray(word.phones) && word.phones.length) token.append(el('span', 'egl-ph-word-status', word.phones.length + ' หน่วยเสียง'));
        words.append(token);
      });
      referenceFocus = el('div', 'egl-ph-reference-focus'); referenceFocus.hidden = true;
      const raw = el('details', 'egl-ph-technical');
      raw.append(el('summary', '', 'ดู IPA ฉบับเต็ม'), el('p', 'egl-ph-ipa', data.ipa || 'ยังสร้างคำอ่านไม่ได้'));
      const unitList = el('div', 'egl-ph-words');
      data.words.slice(0, 200).forEach(word => {
        const token = el('span', 'egl-ph-word');
        token.append(el('span', 'egl-ph-token', word.text), el('span', 'egl-ph-small-ipa', word.ipa || '—'));
        if (Array.isArray(word.phones)) token.append(el('span', 'egl-ph-units', word.phones.join(' · ')));
        unitList.append(token);
      });
      raw.append(unitList, el('p', 'egl-ph-note', 'ˈ เน้นเสียงหลัก · ˌ เน้นเสียงรอง · ː เสียงยาว · คำอ่านส่วนนี้สร้างจากข้อความ'));
      expected.append(words, referenceFocus, raw);
      expected.hidden = false;
    }
    function rangeFor(word) {
      const start = Number(word.start), end = Number(word.end);
      return word.start != null && word.end != null && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start ? { start: start, end: end } : null;
    }
    function stopPlayback() {
      playbackVersion++;
      if (playbackTimer !== null) win.clearTimeout(playbackTimer);
      playbackTimer = null;
      playbackEnd = null;
      player.pause();
    }
    function armPlaybackStop() {
      if (playbackTimer !== null) win.clearTimeout(playbackTimer);
      if (playbackEnd == null) return;
      const remaining = Math.max(0, playbackEnd - player.currentTime);
      playbackTimer = win.setTimeout(stopPlayback, remaining / (slow ? 0.75 : 1) * 1000 + 100);
    }
    function playRange(range) {
      stopPlayback();
      stopExample();
      if (!clipURL || disposed) return;
      const currentPlayback = playbackVersion;
      const play = () => {
        if (disposed || currentPlayback !== playbackVersion) return;
        try {
          player.currentTime = range.start;
          player.playbackRate = slow ? 0.75 : 1;
          playbackEnd = range.end;
          const result = player.play();
          if (result && result.catch) result.catch(error => { if (!disposed && currentPlayback === playbackVersion && error.name !== 'AbortError') setStatus('กดเล่นที่แถบเสียง แล้วลองฟังช่วงคำอีกครั้ง', true); });
          armPlaybackStop();
        } catch (_) { setStatus('ยังเล่นช่วงคำนี้ไม่ได้ ลองเล่นจากแถบเสียงก่อน', true); }
      };
      if (player.readyState >= 1) play();
      else {
        const currentURL = clipURL;
        const ready = () => { if (clipURL === currentURL) play(); };
        on(player, 'loadedmetadata', ready, { once: true });
        player.load();
      }
    }
    function wordOperations(word) {
      const operations = analysisData && analysisData.alignment && analysisData.alignment.operations;
      return Array.isArray(operations) ? operations.filter(op => String(op.word_index) === String(word.index)) : [];
    }
    function phoneRange(operation, word) {
      const time = rangeFor(operation);
      if (!time) return null;
      const bounds = rangeFor(word);
      const duration = Number.isFinite(player.duration) ? player.duration : Infinity;
      return {
        start: Math.max(bounds ? bounds.start : 0, time.start - 0.07),
        end: Math.min(bounds ? bounds.end : duration, duration, time.end + 0.07),
      };
    }
    function selectWord(index) {
      if (!wordItems[index] || !analysisData) return;
      inspectorListeners.splice(0).forEach(remove => remove());
      selectedIndex = index;
      const item = wordItems[index], word = item.word, operations = wordOperations(word);
      selectedPhrase.textContent = 'คำที่เลือก: ' + word.text;
      wordItems.forEach((entry, i) => entry.button.setAttribute('aria-pressed', String(i === index)));
      inspector.replaceChildren(el('h4', 'egl-ph-inspector-title', word.text + ' · ' + percentText(item.percent)));
      const meaning = wordMeaning(practiceWord || word);
      if (meaning) inspector.append(el('p', 'egl-ph-word-meaning', meaning));
      inspector.append(el('p', 'egl-ph-counts', countsText(word, operations) + ' จับคู่กับอ้างอิง'));
      const controls = el('div', 'egl-ph-actions');
      const range = rangeFor(word);
      const replay = button('ฟังคำนี้', () => { if (range) playRange(range); }, 'egl-ph-button egl-ph-primary', inspectorListeners);
      replay.disabled = !range;
      const slower = button(slow ? 'ช้า 0.75× ✓' : 'ช้า 0.75×', () => {
        slow = !slow; player.playbackRate = slow ? 0.75 : 1;
        slower.textContent = slow ? 'ช้า 0.75× ✓' : 'ช้า 0.75×';
        slower.setAttribute('aria-pressed', String(slow)); armPlaybackStop();
        examplePlayer.playbackRate = slow ? 0.75 : 1; armExampleStop();
      }, 'egl-ph-button egl-ph-slow', inspectorListeners);
      slower.setAttribute('aria-pressed', String(slow));
      const different = wordItems.map((entry, i) => ({ entry, i })).filter(x => x.entry.percent != null && x.entry.percent < 100 || x.entry.word.status === 'difference');
      const next = button('คำที่มีเสียงต่างถัดไป', () => {
        const following = different.find(x => x.i > selectedIndex) || different[0];
        if (following) selectWord(following.i);
      }, 'egl-ph-button', inspectorListeners);
      next.disabled = !different.length;
      controls.append(button('ฟังคำตัวอย่าง', () => playExample(practiceWord || word), 'egl-ph-button', inspectorListeners), replay, slower,
        button('ฝึกคำนี้', () => practice(practiceWord || word), 'egl-ph-button egl-ph-primary', inspectorListeners), next);
      inspector.append(controls);
      inspector.append(el('p', 'egl-ph-note', 'แตะหน่วยเสียงเพื่อฟังช่วงสั้น ๆ ในคำนี้ และดูวิธีวางปาก'));
      const pairs = el('div', 'egl-ph-phone-pairs');
      const headers = el('div', 'egl-ph-phone-row egl-ph-phone-head');
      headers.append(el('span', '', 'อ้างอิง'), el('span', '', 'เสียงที่ตรวจพบ')); pairs.append(headers);
      const guide = el('div', 'egl-ph-guide');
      const messages = {
        match: 'ระบบจับคู่เสียงนี้กับอ้างอิงได้ ลองฟังจังหวะและความยาวเสียง',
        substitute: 'ระบบได้ยินเสียงต่างจากอ้างอิง ลองฟังช่วงนี้แล้วเทียบวิธีวางปาก',
        delete: 'ระบบยังไม่พบช่วงเสียงที่จับคู่กับหน่วยนี้ จึงไม่มีเสียงช่วงนี้ให้เล่น',
        insert: 'ระบบตรวจพบเสียงเพิ่มในช่วงนี้ ลองฟังว่ามีเสียงเชื่อมระหว่างคำหรือไม่',
      };
      operations.forEach(op => {
        const row = el('div', 'egl-ph-phone-row egl-ph-op-' + (['match', 'substitute', 'delete', 'insert'].includes(op.type) ? op.type : 'unresolved'));
        const time = phoneRange(op, word);
        ['expected', 'observed'].forEach(side => {
          const phone = op[side];
          if (!phone) { row.append(el('span', 'egl-ph-phone-missing', '—')); return; }
          const chip = button('', () => {
            showPhoneGuide(guide, phone, messages[op.type] || 'การจับคู่หน่วยเสียงเป็นการประมาณจากไฟล์เสียง');
            if (time && time.end > time.start) playRange(time);
          }, 'egl-ph-phone', inspectorListeners);
          chip.append(el('span', 'egl-ph-phone-symbol', phone));
          const descriptor = guideFor(phone);
          if (descriptor.label && descriptor.label !== phone) chip.append(el('span', 'egl-ph-phone-label', descriptor.label));
          chip.setAttribute('aria-label', (side === 'expected' ? 'อ้างอิง ' : 'ตรวจพบ ') + phone + (time ? ' ฟังในบริบทของคำ' : ' ดูคำแนะนำ'));
          row.append(chip);
        });
        pairs.append(row);
      });
      if (!operations.length) {
        pairs.append(el('p', 'egl-ph-note', 'ยังไม่มีรายละเอียดจับคู่ทีละเสียง ฟังช่วงคำเต็มหรือดู IPA ในรายละเอียดได้ครับ'));
      }
      inspector.append(pairs, guide);
      const firstPhone = operations.find(op => op.expected || op.observed);
      if (firstPhone) showPhoneGuide(guide, firstPhone.expected || firstPhone.observed, messages[firstPhone.type]);
      else guide.append(el('p', 'egl-ph-note', 'ผลนี้ยังไม่พอสำหรับอธิบายตำแหน่งเสียงแต่ละหน่วย'));
      inspector.hidden = false;
    }
    function renderAnalysis(data) {
      clearObserved();
      if (data.reference && !practiceWord) renderReference(data.reference);
      analysisData = data;
      if (!practiceWord) sentenceResult = { data, blob: clip, label: clipLabel, kind: clipKind, info: clipInfo, mode };
      const found = data.observed || {};
      const metrics = data.metrics || {};
      const alignment = data.alignment || {}, operations = Array.isArray(alignment.operations) ? alignment.operations : [];
      const summary = alignment.summary || operationCounts(operations);
      const overall = percentage(summary, operations);
      const score = el('div', 'egl-ph-agreement egl-ph-' + percentLevel(overall));
      score.append(el('strong', 'egl-ph-percent', percentText(overall)), el('span', 'egl-ph-agreement-label', 'หน่วยเสียงจับคู่กับอ้างอิง'));
      score.append(el('span', 'egl-ph-counts', countsText(summary, operations)));
      observed.replaceChildren(el('h3', 'egl-ph-step-title', practiceWord ? '3 · ผลคำว่า ' + practiceWord.text : '3 · ดูผลทีละคำ'), score);
      if (demoMode && data.precomputed === true) observed.append(el('p', 'egl-ph-note egl-ph-demo-result', 'ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้ · ไม่ใช่ผลจากเสียงที่คุณบันทึก'));
      observed.append(el('p', 'egl-ph-note', 'เปอร์เซ็นต์นับการจับคู่หน่วยเสียง ไม่ใช่คะแนนความสามารถหรือระดับเจ้าของภาษา'));
      observed.append(el('p', 'egl-ph-note', 'ไฟล์ที่เปรียบเทียบ: ' + clipLabel));
      const phones = Array.isArray(found.phones) ? found.phones : [];
      const words = Array.isArray(alignment.words) ? alignment.words : [];
      if (words.length) {
        const legend = el('details', 'egl-ph-technical egl-ph-color-legend');
        legend.append(el('summary', '', 'ความหมายของสีและเปอร์เซ็นต์'));
        const tiers = [['purple', '95–100%'], ['blue', '90–<95%'], ['indigo', '80–<90%'], ['sky', '70–<80%'], ['green', '60–<70%'], ['yellow', '50–<60%'], ['orange', '40–<50%'], ['red', '0–<40%'], ['unassessed', '— ยังเทียบไม่ได้']];
        const labels = el('div', 'egl-ph-legend-items');
        tiers.forEach(([tier, text]) => labels.append(el('span', 'egl-ph-legend-item egl-ph-' + tier, text)));
        legend.append(labels); observed.append(legend);
        const grid = el('div', 'egl-ph-comparison');
        words.slice(0, 200).forEach(word => {
          const relevant = operations.filter(op => String(op.word_index) === String(word.index));
          const percent = percentage(word, relevant), index = wordItems.length;
          const token = button('', () => selectWord(index), 'egl-ph-word egl-ph-compare egl-ph-' + percentLevel(percent), observedListeners);
          token.setAttribute('aria-pressed', 'false');
          token.setAttribute('aria-label', word.text + ': ' + percentText(percent) + ' หน่วยเสียงตรงกับอ้างอิง ดูรายละเอียด');
          token.append(el('span', 'egl-ph-token', word.text), el('span', 'egl-ph-word-percent', percentText(percent)));
          wordItems.push({ word, percent, button: token });
          grid.append(token);
        });
        observed.append(grid);
      } else observed.append(el('p', 'egl-ph-note', 'ยังแบ่งช่วงคำไม่ได้ คุณฟังไฟล์เสียงเต็มจากแถบด้านบนได้'));
      inspector = el('section', 'egl-ph-inspector'); inspector.hidden = true;
      inspector.setAttribute('aria-label', 'แยกหน่วยเสียงของคำที่เลือก'); observed.append(inspector);
      const details = el('details', 'egl-ph-technical');
      details.append(el('summary', '', 'ดู IPA และรายละเอียดการเปรียบเทียบ'));
      details.append(el('h4', 'egl-ph-heading', 'เสียงที่ระบบตรวจพบจากไฟล์'), el('p', 'egl-ph-ipa egl-ph-detected', found.ipa || phones.map(phone => typeof phone === 'string' ? phone : phone.phone).join(' ') || 'ยังตรวจแยกหน่วยเสียงไม่ได้'));
      const duration = Number(metrics.duration_seconds == null ? found.duration_seconds : metrics.duration_seconds);
      if (Number.isFinite(duration)) details.append(el('p', 'egl-ph-note', 'ความยาวเสียง ' + duration.toFixed(2) + ' วินาที'));
      details.append(el('p', 'egl-ph-note', 'วิธีนับ: จำนวนเสียงที่จับคู่ตรง ÷ (จำนวนเสียงอ้างอิง + เสียงที่ตรวจพบเพิ่ม) × 100'));
      const limits = Array.isArray(data.limitations) ? data.limitations : [];
      if (limits.length) {
        const list = el('ul', 'egl-ph-limitations');
        limits.slice(0, 8).forEach(item => list.append(el('li', '', item)));
        details.append(list);
      }
      observed.append(details);
      observed.hidden = false;
      resultPlaceholder.hidden = true;
      const silent = !phones.length || (metrics.voiced_seconds != null && Number(metrics.voiced_seconds) === 0) || (metrics.rms_dbfs != null && Number(metrics.rms_dbfs) < -60);
      setStatus(demoMode && data.precomputed === true ? 'ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้ · แตะคำเพื่อดูรายละเอียด' : silent ? 'เสียงเบาหรือมีช่วงเงียบมาก ลองบันทึกในที่เงียบและพูดใกล้ไมโครโฟนขึ้น' : 'วิเคราะห์จากไฟล์เสียงแล้ว แตะคำเพื่อฟังและเปรียบเทียบด้วยตัวเอง', silent);
      if (wordItems.length) selectWord(0);
    }

    const root = el('details', 'egl-phonetics');
    root.open = options.expanded === true;
    root.append(el('summary', 'egl-ph-summary', 'ดู IPA / ฝึกออกเสียงทีละคำ'));
    const body = el('div', 'egl-ph-body');
    const steps = el('ol', 'egl-ph-steps');
    ['1 คำอ่าน / ฟัง', '2 ลองพูด', '3 ดูผล'].forEach(text => steps.append(el('li', '', text)));
    const firstStep = el('section', 'egl-ph-step');
    firstStep.append(el('h3', 'egl-ph-step-title', '1 · อ่านและฟังตัวอย่าง'));
    const phrase = el('p', 'egl-ph-phrase', options.text || 'ใส่ข้อความภาษาอังกฤษใน “แก้ข้อความ / สำเนียง”');
    const translation = el('p', 'egl-ph-translation'); translation.hidden = true;
    const chunks = el('div', 'egl-ph-chunks'); chunks.hidden = true;
    const selectedPhrase = el('p', 'egl-ph-selected', 'แตะคำเพื่อดูเสียงทีละส่วน');
    const advanced = el('details', 'egl-ph-technical egl-ph-editor');
    advanced.append(el('summary', '', 'แก้ข้อความ / สำเนียง'));
    const label = el('label', 'egl-ph-label', 'ข้อความที่ต้องการพูด');
    label.htmlFor = id + '-text';
    const textarea = el('textarea', 'egl-ph-text');
    textarea.id = id + '-text'; textarea.rows = 2; textarea.maxLength = 350;
    textarea.value = options.text == null ? '' : String(options.text);
    textarea.spellcheck = false;
    const accentLabel = el('label', 'egl-ph-accent-label', 'คำอ่านสำเนียง ');
    const accent = el('select', 'egl-ph-select');
    accent.setAttribute('aria-label', 'สำเนียงคำอ่านอ้างอิง');
    [['en-us', 'อเมริกัน (US)'], ['en-gb', 'อังกฤษ (UK)']].forEach(([value, text]) => {
      const option = el('option', '', text); option.value = value; accent.append(option);
    });
    accentLabel.append(accent);
    advanced.append(label, textarea, accentLabel);
    const controls = el('div', 'egl-ph-actions');
    const textButton = button('ดูคำอ่าน', () => request(async (values, signal) => {
      if (reference && reference.text === values.text && reference.accent === values.accent) return reference;
      const bundled = demoMode && demoData().texts && demoData().texts[values.text];
      const cached = options.precomputed && options.precomputed.text === values.text ? options.precomputed : bundled || global.EGL_PHONETIC_DATA && global.EGL_PHONETIC_DATA[values.text];
      if (cached && cached.accent === values.accent && Array.isArray(cached.words)) return cached;
      if (demoMode) throw friendly('เดโมนี้ยังไม่มีคำอ่านสำหรับข้อความหรือสำเนียงนี้ ต้องเปิดรุ่นในเครื่องเพื่อสร้างคำอ่านเพิ่มเติม');
      return jsonResponse(await win.fetch(apiBase + '/api/phonetics/text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), signal: signal,
      }));
    }, 'กำลังเตรียมคำอ่าน…'));
    const listenExample = button('ฟังประโยคตัวอย่าง', () => playExample(null, true));
    listenButtons.push(listenExample);
    const exampleCaption = el('p', 'egl-ph-note egl-ph-example-caption');
    controls.append(textButton, listenExample);
    const expected = el('section', 'egl-ph-reference'); expected.hidden = true;
    expected.setAttribute('aria-label', 'คำอ่านอ้างอิง');
    firstStep.append(phrase, translation, chunks, controls, exampleCaption, selectedPhrase, expected, advanced);

    const secondStep = el('section', 'egl-ph-step');
    secondStep.append(el('h3', 'egl-ph-step-title', '2 · ลองพูด แล้วเลือกดูผล'));
    const tabs = el('div', 'egl-ph-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'เลือกเสียงที่จะเปรียบเทียบ');
    const ownTab = button('เสียงของฉัน', () => changeMode('own'), 'egl-ph-tab');
    const aiTab = button('เสียง AI', () => changeMode('ai'), 'egl-ph-tab');
    ownTab.setAttribute('role', 'tab'); aiTab.setAttribute('role', 'tab');
    ownTab.setAttribute('aria-controls', id + '-own'); aiTab.setAttribute('aria-controls', id + '-ai');
    const ownPanel = el('div', 'egl-ph-mode-panel'); ownPanel.id = id + '-own'; ownPanel.setAttribute('role', 'tabpanel');
    const aiPanel = el('div', 'egl-ph-mode-panel'); aiPanel.id = id + '-ai'; aiPanel.setAttribute('role', 'tabpanel');
    const targetBanner = el('div', 'egl-ph-target'); targetBanner.hidden = true;
    const targetText = el('strong');
    targetBanner.append(targetText, button('กลับไปฝึกทั้งประโยค', backToSentence, 'egl-ph-button egl-ph-return'));
    const recordHint = el('p', 'egl-ph-record-hint', 'พูดประโยคด้านบนให้จบ แล้วกดหยุด');
    const audioControls = el('div', 'egl-ph-actions');
    const sources = Array.isArray(options.audioSources) ? options.audioSources : [];
    sources.forEach((source, index) => {
      if (!source || typeof source.url !== 'string') return;
      const sourceLabel = String(source.label || String.fromCharCode(65 + index));
      const node = button('วิเคราะห์เสียง ' + sourceLabel, () => {
        if (practiceWord) { practiceWord = null; updateTarget(); }
        changeMode('ai');
        if (demoMode) clearClip();
        request(async (values, signal, current) => {
        const cached = demoMode ? cachedAI(source, values) : null;
        const response = await win.fetch(resolveSource(source.url), { signal: signal, ...(demoMode ? { redirect: 'error' } : {}) });
        if (!response.ok) throw new Error('Unable to load local AI audio');
        const length = Number(response.headers && response.headers.get('content-length'));
        if (length > MAX_BYTES) throw friendly('ไฟล์เสียงต้องไม่เกิน 10 MB');
        const blob = await response.blob();
        checkBlob(blob);
        if (!current()) return null;
        setClip(blob, 'เสียง AI ' + sourceLabel, 'ai');
        return demoMode ? cached : upload(blob, values, signal);
        }, 'กำลังวิเคราะห์เสียง AI ' + sourceLabel + '…');
      });
      sourceButtons.push(node); audioControls.append(node);
    });
    aiTab.hidden = !sourceButtons.length;
    tabs.append(ownTab, aiTab);
    aiPanel.append(el('p', 'egl-ph-note', 'เลือกตัวอย่างเพื่อแยกดูเสียงที่ AI พูดจริง'), audioControls);
    const fileLabel = el('label', 'egl-ph-label', 'เลือกไฟล์เสียงของคุณ');
    const fileInput = el('input', 'egl-ph-file');
    fileInput.type = 'file'; fileInput.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac';
    fileInput.setAttribute('aria-label', 'เลือกไฟล์เสียง ไม่เกิน 15 วินาที และ 10 MB');
    fileLabel.append(fileInput);
    const recordButton = button('บันทึกเสียงของฉัน', record, 'egl-ph-button egl-ph-primary');
    const analyzeButton = button('ดูผลเสียงของฉัน', () => {
      if (demoMode) { setStatus(localAnalysisRequired, true); return; }
      if (!clip) { setStatus('เลือกไฟล์หรือบันทึกเสียงก่อน', true); return; }
      const selected = clip;
      request((values, signal) => upload(selected, values, signal));
    });
    if (demoMode) analyzeButton.title = localAnalysisRequired;
    const recordingControls = el('div', 'egl-ph-actions'); recordingControls.append(recordButton, analyzeButton);
    const uploadDetails = el('details', 'egl-ph-technical egl-ph-upload');
    uploadDetails.append(el('summary', '', 'หรือเลือกไฟล์เสียง'), fileLabel);
    ownPanel.append(recordHint, recordingControls, uploadDetails);
    if (demoMode) ownPanel.append(el('p', 'egl-ph-note egl-ph-demo-learner-notice', localAnalysisRequired + ' · เดโมนี้บันทึกและฟังเสียงของคุณได้ในเบราว์เซอร์'));
    const chosen = el('p', 'egl-ph-note');
    const player = el('audio', 'egl-ph-player');
    player.controls = true; player.preload = 'metadata'; player.hidden = true;
    player.setAttribute('aria-label', 'ไฟล์เสียงที่ใช้วิเคราะห์');
    const durationText = el('p', 'egl-ph-duration');
    const selfAudioControls = el('div', 'egl-ph-actions egl-ph-self-audio'); selfAudioControls.hidden = true;
    const selfListenButton = button('ฟังเสียงของฉัน', () => playOwn(false), 'egl-ph-button egl-ph-primary');
    const selfPauseButton = button('พักเสียง', stopPlayback);
    const selfRestartButton = button('ฟังใหม่ตั้งแต่ต้น', () => playOwn(true));
    selfAudioControls.append(selfListenButton, selfPauseButton, selfRestartButton);
    const examplePlayer = el('audio', 'egl-ph-example-player'); examplePlayer.preload = 'none'; examplePlayer.hidden = true;
    const status = el('p', 'egl-ph-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const service = el('div', 'egl-ph-service'); service.hidden = true;
    service.append(el('p', 'egl-ph-note', demoMode ? localAnalysisRequired : 'เปิดไฟล์ speech-training/start-phonetics.command แล้วลองอีกครั้ง'));
    const serviceLink = el('a', 'egl-ph-service-link', 'เปิดหน้าเรียนผ่านบริการเสียงในเครื่อง');
    if (api) serviceLink.href = api.origin + (location.pathname.includes('/app/') ? '/app/index.html' : '/speech-training/listen.html');
    serviceLink.hidden = demoMode;
    serviceLink.target = '_blank'; serviceLink.rel = 'noopener'; service.append(serviceLink);
    const observed = el('section', 'egl-ph-observed'); observed.hidden = true;
    observed.setAttribute('aria-label', 'ผลตรวจจากไฟล์เสียง');
    const resultPlaceholder = el('p', 'egl-ph-result-placeholder', '3 · เมื่อกดดูผล แตะคำที่ไฮไลต์เพื่อฟังและฝึกทีละเสียง');
    secondStep.append(tabs, targetBanner, ownPanel, aiPanel,
      el('p', 'egl-ph-note', demoMode ? 'ไม่เกิน 15 วินาที / 10 MB · บันทึกและเตรียมไฟล์เพื่อฟังในเบราว์เซอร์ เสียงของคุณไม่ถูกส่งไปวิเคราะห์' : 'ไม่เกิน 15 วินาที / 10 MB · เตรียมไฟล์เพื่อฟังในเบราว์เซอร์ หรือบริการในเครื่องเมื่อจำเป็น · กดดูผลเพื่อวิเคราะห์เสียง'), chosen, durationText, selfAudioControls, player);
    body.append(steps, firstStep, secondStep, status, service, resultPlaceholder, observed, examplePlayer);
    root.append(body); container.append(root);

    function stopCapture() {
      recordingVersion++;
      if (prepareController) prepareController.abort();
      prepareController = null; preparing = false;
      closeContext(decodeContext); decodeContext = null;
      if (recorder) {
        recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null;
        if (recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      }
      recorder = null; recording = false; requestingMic = false;
      stopTracks();
      if (!disposed) updateButtons();
    }
    function stopTracks() {
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      if (recordTimer !== null) win.clearTimeout(recordTimer);
      recordTimer = null;
    }
    async function record() {
      if (recording && recorder) { if (recorder.state !== 'inactive') recorder.stop(); return; }
      if (requestingMic || preparing || disposed) return;
      if (!win.navigator.mediaDevices || !win.navigator.mediaDevices.getUserMedia || !win.MediaRecorder) {
        setStatus('เบราว์เซอร์นี้ยังบันทึกเสียงไม่ได้ เลือกไฟล์เสียงแทนได้ครับ', true); return;
      }
      cancelRequest();
      stopExample(); stopPlayback();
      requestingMic = true; updateButtons();
      const attempt = ++recordingVersion;
      try {
        const acquired = await win.navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed || attempt !== recordingVersion) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
        const mimeType = types.find(type => win.MediaRecorder.isTypeSupported && win.MediaRecorder.isTypeSupported(type));
        const active = new win.MediaRecorder(stream, mimeType ? { mimeType: mimeType } : undefined);
        recorder = active;
        const chunks = [];
        active.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
        active.onerror = () => {
          if (disposed || attempt !== recordingVersion) return;
          active.onstop = null; active.ondataavailable = null; active.onerror = null;
          if (active.state !== 'inactive') { try { active.stop(); } catch (_) {} }
          stopTracks(); recording = false; recorder = null; requestingMic = false; updateButtons();
          setStatus('บันทึกเสียงไม่สำเร็จ ลองอีกครั้งหรือเลือกไฟล์เสียง', true);
        };
        active.onstop = async () => {
          if (disposed || attempt !== recordingVersion) return;
          stopTracks(); recording = false; recorder = null;
          preparing = true;
          const preparation = new win.AbortController(); prepareController = preparation;
          service.hidden = true; updateButtons(); setStatus('กำลังเตรียมเสียงให้ฟัง…');
          try {
            const blob = new win.Blob(chunks, { type: active.mimeType || 'audio/webm' });
            const prepared = await prepareRecording(blob, attempt, preparation.signal);
            assertPreparing(attempt, preparation.signal);
            setClip(prepared.blob, 'เสียงที่คุณบันทึก', 'recorded', prepared);
            const quiet = prepared.rmsDbfs < -55;
            setStatus('บันทึกแล้ว ' + prepared.duration.toFixed(2) + ' วินาที · ' + (quiet ? 'เสียงเบามาก ลองกดฟังหรือบันทึกใกล้ไมโครโฟนขึ้น' : 'กด “ฟังเสียงของฉัน” เพื่อลองฟัง'), quiet);
          } catch (error) {
            if (!disposed && attempt === recordingVersion && error.name !== 'AbortError') {
              clearClip();
              setStatus(demoMode ? error.userMessage || 'เดโมนี้ยังเตรียมไฟล์เสียงให้เล่นไม่ได้ ลองเลือกไฟล์ WAV หรือเปิดรุ่นในเครื่อง' : 'ยังเตรียมเสียงให้เล่นไม่ได้ ลองบันทึกใหม่ หรือเปิดบริการเสียงในเครื่องแล้วลองอีกครั้ง', true);
              service.hidden = demoMode;
            }
          } finally {
            if (!disposed && attempt === recordingVersion) {
              preparing = false;
              if (prepareController === preparation) prepareController = null;
              updateButtons();
            }
          }
        };
        active.start();
        clearClip();
        requestingMic = false; recording = true; updateButtons();
        setStatus('กำลังบันทึก… กดหยุดเมื่อพูดจบ (หยุดอัตโนมัติภายใน 15 วินาที)');
        recordTimer = win.setTimeout(() => { if (active.state !== 'inactive') active.stop(); }, 14500);
      } catch (error) {
        if (disposed || attempt !== recordingVersion) return;
        stopTracks(); requestingMic = false; recording = false;
        updateButtons();
        setStatus(error.name === 'NotAllowedError' ? 'ยังไม่ได้อนุญาตไมโครโฟน คุณเลือกไฟล์เสียงแทนได้ครับ' : 'เปิดไมโครโฟนไม่สำเร็จ ลองใหม่หรือเลือกไฟล์เสียง', true);
      }
    }
    on(textarea, 'input', changeText); on(accent, 'change', changeText);
    on(tabs, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const visibleTabs = [ownTab, aiTab].filter(tab => !tab.hidden);
      const current = visibleTabs.indexOf(doc.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
      const next = visibleTabs[index]; changeMode(next === ownTab ? 'own' : 'ai'); next.focus();
    });
    on(fileInput, 'change', () => {
      cancelRequest();
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try { setClip(file, file.name || 'ไฟล์เสียงที่เลือก'); setStatus('เลือกไฟล์แล้ว กดวิเคราะห์เสียงเมื่อต้องการ'); }
      catch (error) {
        clearClip();
        updateButtons(); showServiceError(error);
      }
    });
    on(player, 'timeupdate', () => { if (playbackEnd != null && player.currentTime >= playbackEnd) stopPlayback(); });
    on(examplePlayer, 'timeupdate', () => { if (exampleEnd != null && examplePlayer.currentTime >= exampleEnd) stopExample(); });
    on(root, 'toggle', event => {
      if (event.target === root && !root.open) {
        cancelRequest(); stopCapture(); stopPlayback(); stopExample();
        setStatus('พักการบันทึกและเล่นเสียงแล้ว');
      }
    });
    on(player, 'loadedmetadata', () => {
      if (clip && Number.isFinite(player.duration) && player.duration > 0 && !clipInfo) durationText.textContent = 'ความยาวเสียง ' + player.duration.toFixed(2) + ' วินาที';
      if (Number.isFinite(player.duration) && player.duration > 15.05) {
        clip = null; updateButtons(); setStatus('ไฟล์เสียงยาวเกิน 15 วินาที เลือกช่วงสั้นลงแล้วลองอีกครั้ง', true);
      }
    });
    on(player, 'error', () => {
      if (clip && !disposed) setStatus('เบราว์เซอร์ยังเปิดไฟล์เสียงนี้ไม่ได้ ลองบันทึกใหม่หรือเปิดหน้าเรียนในเบราว์เซอร์อีกครั้ง', true);
    });

    function cleanup() {
      if (disposed) return;
      disposed = true; version += 1; recordingVersion += 1;
      if (controller) controller.abort();
      stopCapture(); stopPlayback(); stopExample();
      referenceListeners.splice(0).forEach(remove => remove());
      observedListeners.splice(0).forEach(remove => remove());
      listeners.forEach(remove => remove());
      player.removeAttribute('src');
      examplePlayer.removeAttribute('src');
      objectURLs.forEach(url => win.URL.revokeObjectURL(url)); objectURLs.clear();
      clip = null; clipURL = null; sentenceResult = null; root.remove();
    }
    on(win, 'pagehide', cleanup);
    updateStudyHelp(); updateTarget();
    updateButtons();
    const precomputed = options.precomputed;
    if (precomputed && precomputed.text === textarea.value.trim() && precomputed.accent === accent.value && Array.isArray(precomputed.words)) {
      renderReference(precomputed);
    }
    return cleanup;
  }

  global.EGLPhonetics = Object.freeze({ mount: mount });
})(window);
