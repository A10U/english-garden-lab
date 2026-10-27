/* English Garden Lab: opt-in local phonetic reference and audio comparison. */
(function (global) {
  'use strict';
  const MAX_BYTES = 10 * 1024 * 1024;
  const runtimeScriptURL = global.document && global.document.currentScript && global.document.currentScript.src;
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
  function recognitionIssue(data) {
    const metrics = data && data.metrics || {};
    // A decoder can emit phones even over silence, and older services may
    // return an explicit zero after emitting none. Neither is score evidence.
    if (typeof metrics.voiced_seconds === 'number' && Number.isFinite(metrics.voiced_seconds) && metrics.voiced_seconds <= 0
      || typeof metrics.rms_dbfs === 'number' && Number.isFinite(metrics.rms_dbfs) && metrics.rms_dbfs < -60) return 'insufficient_audio_signal';
    const phones = data && data.observed && data.observed.phones;
    if (!Array.isArray(phones) || !phones.some(item => typeof item === 'string' ? item.trim() : item && typeof item.phone === 'string' && item.phone.trim())) return 'no_detected_phones';
    const quality = data && data.recognition_quality;
    return quality && quality.status === 'uncertain' ? quality.reason || 'uncertain_recognition' : null;
  }
  function uncertainRecognition(data) { return Boolean(recognitionIssue(data)); }
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

  // Capture PCM before a browser encoder/container can truncate a short take.
  // The worklet outputs silence, so connecting it keeps capture running without
  // playing the microphone through the speakers.
  async function pcmRecorder(win, context, stream, moduleURL, current) {
    await context.audioWorklet.addModule(moduleURL);
    if (!current()) throw new win.DOMException('Recording canceled', 'AbortError');
    const source = context.createMediaStreamSource(stream);
    let node;
    try { node = new win.AudioWorkletNode(context, 'egl-microphone'); }
    catch (error) { source.disconnect(); throw error; }
    let blocks = [], frames = 0, collecting = false, finished = false, released = false, stopTimer = null, startTimer = null;
    let readiness = null, resolveReady = null, rejectReady = null;
    const clearStopTimer = () => { if (stopTimer !== null) win.clearTimeout(stopTimer); stopTimer = null; };
    const settleReady = error => {
      if (startTimer !== null) win.clearTimeout(startTimer);
      startTimer = null;
      const resolve = resolveReady, reject = rejectReady;
      resolveReady = null; rejectReady = null;
      if (error) { if (reject) reject(error); }
      else if (resolve) resolve();
    };
    const active = {
      state: 'inactive', prepared: null,
      start() {
        if (readiness) return readiness;
        if (finished) return Promise.reject(new win.DOMException('Recording canceled', 'AbortError'));
        collecting = true; this.state = 'recording';
        readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        startTimer = win.setTimeout(() => {
          const error = new Error('ไมโครโฟนยังไม่ส่งเสียงเข้ามา ลองกดบันทึกใหม่แล้วรอข้อความ “เริ่มพูดได้” ก่อนครับ');
          error.userMessage = error.message; fail(error);
        }, 2000);
        try { node.port.postMessage({ type: 'start' }); }
        catch (error) { fail(error); }
        return readiness;
      },
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        settleReady(new win.DOMException('Recording stopped before ready', 'AbortError'));
        stopTimer = win.setTimeout(() => fail(new Error('Microphone stop timed out')), 2000);
        node.port.postMessage({ type: 'stop' });
      },
      release() {
        if (released) return;
        released = true; clearStopTimer();
        finished = true; collecting = false; blocks = [];
        settleReady(new win.DOMException('Recording canceled', 'AbortError'));
        node.port.onmessage = null; node.onprocessorerror = null;
        source.disconnect(); node.disconnect(); node.port.close();
      }
    };
    const fail = error => {
      if (finished) return;
      finished = true; clearStopTimer();
      settleReady(error);
      active.state = 'inactive';
      if (active.onerror) active.onerror(error);
    };
    node.onprocessorerror = fail;
    node.port.onmessage = event => {
      if (!collecting || finished) return;
      const data = event.data || {};
      try {
        if (data.type === 'started') {
          if (active.state === 'recording') settleReady();
        } else if (data.type === 'samples') {
          const samples = new Float32Array(data.samples);
          if (frames + samples.length > Math.floor(context.sampleRate * 14.5)) throw new Error('Too many microphone frames');
          blocks.push(samples); frames += samples.length;
        } else if (data.type === 'stopped') {
          clearStopTimer();
          settleReady(new win.DOMException('Recording stopped before ready', 'AbortError'));
          finished = true; collecting = false; active.state = 'inactive';
          const samples = new Float32Array(frames);
          let offset = 0;
          blocks.forEach(block => { samples.set(block, offset); offset += block.length; });
          blocks = [];
          active.prepared = monoWave([samples], context.sampleRate);
          if (active.onstop) active.onstop();
        }
      } catch (error) { finished = false; fail(error); }
    };
    try { source.connect(node); node.connect(context.destination); }
    catch (error) { active.release(); throw error; }
    return active;
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
    const browserAnalysisNotice = 'วิเคราะห์เสียงในเบราว์เซอร์ · ครั้งแรกดาวน์โหลดโมเดลประมาณ 318 MB และ WASM · เสียงของคุณอยู่ในเบราว์เซอร์ ไม่ส่งไปเซิร์ฟเวอร์';
    const unsupportedBrowserNotice = 'เบราว์เซอร์นี้ยังวิเคราะห์เสียงในหน้าเว็บไม่ได้ · บันทึกและฟังได้ หรือเปิดรุ่นในเครื่องเพื่อวิเคราะห์';
    const id = 'egl-phonetics-' + (++nextId);
    let disposed = false, version = 0, controller = null, busy = false, browserRequest = false;
    let stream = null, recorder = null, recording = false, requestingMic = false, preparing = false;
    let prepareController = null, decodeContext = null, captureContext = null;
    let recordingVersion = 0, recordTimer = null;
    let clip = null, clipLabel = '', clipURL = null, clipKind = '', clipInfo = null, reference = null, clipId = 0;
    let mode = 'own', analysisData = null, wordItems = [], selectedIndex = null, slow = false;
    let practiceWord = null, practicePhone = null, sentenceResult = null, referenceFocus = null, inspector = null;
    let localUtterance = null, exampleVersion = 0, diagramSequence = 0;
    let exampleEndCleanup = null, comparisonTimer = null, comparisonOwner = null;
    const listeners = [], referenceListeners = [], observedListeners = [], inspectorListeners = [], soundListeners = [], objectURLs = new Set();
    const spellingRefreshers = new Set();
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
    function listeningControl(node, bucket) {
      listenButtons.push(node);
      node.disabled = busy || preparing || recording || requestingMic;
      bucket.push(() => { const index = listenButtons.indexOf(node); if (index >= 0) listenButtons.splice(index, 1); });
    }
    function friendly(message) { const error = new Error(message); error.userMessage = message; return error; }
    function setStatus(message, error) {
      if (disposed) return;
      status.textContent = message || '';
      status.classList.toggle('egl-ph-status-error', Boolean(error));
    }
    function browserEngine() {
      const engine = global.EGLBrowserPhonetics;
      try {
        return engine && typeof engine.supported === 'function' && typeof engine.analyze === 'function' && engine.supported() === true ? engine : null;
      } catch (_) { return null; }
    }
    function updateButtons() {
      const occupied = busy || preparing;
      textButton.disabled = occupied || recording || requestingMic;
      const browserAvailable = demoMode && Boolean(browserEngine());
      analyzeButton.disabled = (demoMode && !browserAvailable) || occupied || recording || requestingMic || !clip;
      analyzeButton.title = demoMode && !browserAvailable ? unsupportedBrowserNotice : '';
      cancelBrowserButton.hidden = !browserRequest || !busy;
      if (browserNotice) browserNotice.textContent = browserAvailable ? browserAnalysisNotice : unsupportedBrowserNotice;
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
      busy = false; browserRequest = false;
      updateButtons();
    }
    function clearObserved() {
      observedListeners.splice(0).forEach(remove => remove());
      inspectorListeners.splice(0).forEach(remove => remove());
      analysisData = null; wordItems = []; selectedIndex = null;
      observed.replaceChildren(); observed.hidden = true; stopPlayback();
      resultPlaceholder.hidden = false;
      refreshSpellingScores();
    }
    function changeText() {
      cancelRequest();
      stopCapture();
      reference = null;
      practiceWord = null; practicePhone = null; sentenceResult = null; stopExample(); clearClip();
      referenceListeners.splice(0).forEach(remove => remove());
      phrase.textContent = textarea.value.trim() || 'ใส่ข้อความภาษาอังกฤษใน “แก้ข้อความ / สำเนียง”';
      updateStudyHelp(); updateTarget();
      selectedPhrase.textContent = 'แตะคำเพื่อดูเสียงทีละส่วน';
      expected.replaceChildren();
      expected.hidden = true;
      textButton.setAttribute('aria-expanded', 'false');
      clearObserved();
      setStatus('กด “ดูคำอ่าน” เพื่อดู IPA ตามข้อความและสำเนียงที่เลือก');
    }
    function inputValues(textReference) {
      const text = !textReference && practiceWord ? String(practiceWord.text).trim() : textarea.value.trim();
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
    async function request(action, message, revealTextReference) {
      if (disposed) return;
      let values;
      try { values = inputValues(revealTextReference === true); } catch (error) { showServiceError(error); return; }
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
        else if (result) {
          renderReference(result);
          if (revealTextReference) revealReference();
          setStatus('แสดงคำอ่านอ้างอิงจากข้อความแล้ว ยังไม่ได้วิเคราะห์เสียง' + (revealTextReference ? ' · เปิด IPA ฉบับเต็มด้านล่างแล้ว แตะคำเพื่อดูเสียงทีละส่วน' : ''));
        }
      } catch (error) {
        if (!disposed && current === version && error.name !== 'AbortError') showServiceError(error);
      } finally {
        if (!disposed && current === version) { busy = false; browserRequest = false; controller = null; updateButtons(); }
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
    function notifyHost(name, value) {
      if (disposed || typeof options[name] !== 'function') return;
      try { options[name](value); } catch (_) { /* Host UI must not interrupt audio cleanup. */ }
    }
    function notifyClip() {
      notifyHost('onClipChange', { blob: clip, label: clipLabel, kind: clipKind, info: clipInfo,
        target: practiceWord ? practiceWord.text : textarea.value.trim(), clipId: ++clipId });
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
      notifyClip();
    }
    function clearClip() {
      clearObserved(); revokeURL(clipURL);
      clip = null; clipURL = null; clipLabel = ''; clipKind = ''; clipInfo = null;
      player.removeAttribute('src'); player.hidden = true; chosen.textContent = '';
      durationText.textContent = '';
      fileInput.value = '';
      notifyClip();
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
      if (nextMode === 'ai' && practiceWord) { practiceWord = null; practicePhone = null; updateTarget(); }
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
      if (practiceWord && Number.isInteger(practiceWord.index) && practiceWord.index >= 0 && (!practiceWord.isolated || practicePhone)) {
        form.append('context_text', practiceWord.isolated ? values.text : textarea.value.trim());
        form.append('context_word_index', String(practiceWord.isolated ? 0 : practiceWord.index));
        if (practicePhone) form.append('context_phone_index', String(practicePhone.index));
      }
      return jsonResponse(await win.fetch(apiBase + '/api/phonetics/analyze', { method: 'POST', body: form, signal: signal }));
    }
    function browserReference(values) {
      if (practiceWord && practiceWord.isolated) {
        const isolated = practiceWord.targetReference || isolatedReference(values.text);
        if (!isolated || isolated.accent !== values.accent) throw friendly('ยังไม่มีคำอ่านของคำเดี่ยวนี้ในสำเนียงที่เลือก ลองใช้คำตัวอย่างและสำเนียง US ครับ');
        if (!practicePhone) return isolated;
        const phone = isolated.words[0].phones[practicePhone.index];
        if (!phone || phone !== practicePhone.phone) throw friendly('เสียงที่เลือกไม่ตรงกับคำอ่านของคำเดี่ยว เลือกเสียงใหม่ครับ');
        return { ...isolated, ipa: phone, words: [{ ...isolated.words[0], ipa: phone, phones: [phone] }],
          reference_context: 'phone_in_word', context: { text: values.text, word_index: 0, phone_index: practicePhone.index },
          notes: ['ฝึกหน่วยเสียงเดียวในคำเดี่ยว ไม่ใช่ผลการออกเสียงทั้งคำ'],
        };
      }
      const originalText = textarea.value.trim();
      const bundled = demoData().texts && demoData().texts[originalText];
      const candidates = [reference, options.precomputed, bundled, global.EGL_PHONETIC_DATA && global.EGL_PHONETIC_DATA[originalText]];
      const original = candidates.find(item => item && item.text === originalText && item.accent === values.accent && Array.isArray(item.words) && item.words.some(word => Array.isArray(word.phones) && word.phones.length));
      if (!original) throw friendly('ยังไม่มีคำอ่านอ้างอิงสำหรับข้อความหรือสำเนียงนี้ เลือกข้อความตัวอย่างและสำเนียง US หรือเปิดรุ่นในเครื่อง');
      if (!practiceWord) return original;
      const selected = original.words.find(word => String(word.index) === String(practiceWord.index));
      const normalize = text => String(text).trim().toLowerCase().replace(/’/g, "'");
      if (!selected || normalize(selected.text) !== normalize(values.text) || !Array.isArray(selected.phones) || !selected.phones.length) {
        throw friendly('ยังไม่พบคำอ่านของคำที่เลือกในประโยคเดิม กลับไปเลือกคำอีกครั้งครับ');
      }
      if (practicePhone) {
        const phone = selected.phones[practicePhone.index];
        if (!phone || phone !== practicePhone.phone) throw friendly('เสียงที่เลือกไม่ตรงกับคำอ่านเดิม เลือกเสียงใหม่อีกครั้งครับ');
        return { text: values.text, accent: values.accent, ipa: phone,
          words: [{ ...selected, index: 0, ipa: phone, phones: [phone] }],
          analysis_type: 'text_pronunciation_reference', audio_analyzed: false,
          reference_context: 'phone_in_word', context: { text: originalText, word_index: practiceWord.index, phone_index: practicePhone.index },
          notes: ['ฝึกหน่วยเสียงเดียวในคำนี้ เป็นการทดลอง ไม่ใช่ผลการออกเสียงทั้งคำ'],
        };
      }
      return {
        text: values.text, accent: values.accent, ipa: selected.ipa,
        words: [{ ...selected, index: 0, phones: selected.phones.slice() }],
        analysis_type: 'text_pronunciation_reference', audio_analyzed: false,
        reference_context: 'word_in_sentence',
        context: { text: originalText, word_index: practiceWord.index },
        notes: ['ใช้คำอ่านตามตำแหน่งในประโยคเดิม รวมรูปเสียงเบาของคำสั้น ๆ'],
      };
    }
    async function analyzeInBrowser(blob, values, signal, current) {
      const expectedReference = browserReference(values);
      const engine = browserEngine();
      if (!engine) throw friendly(unsupportedBrowserNotice);
      checkBlob(blob);
      browserRequest = true; updateButtons();
      const data = await engine.analyze({
        blob, text: values.text, accent: values.accent, reference: expectedReference, signal,
        onProgress: message => {
          if (current() && busy && browserRequest && !signal.aborted && typeof message === 'string') setStatus(message);
        },
      });
      // A learner clip must never receive the bundled AI result as its own.
      if (!data || data.audio_analyzed !== true || data.analysis_type !== 'acoustic_phone_comparison' || data.precomputed === true || data.live_analysis === false || data.playback_source === 'prerecorded_ai' || !data.reference || data.reference.text !== values.text || data.reference.accent !== values.accent) {
        throw friendly('ยังวิเคราะห์เสียงของคุณไม่สำเร็จ ลองบันทึกใหม่แล้วกดดูผลอีกครั้ง');
      }
      return data;
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
    function stopExample() {
      exampleVersion++;
      root.querySelectorAll('.egl-ph-video-card').forEach(card => {
        card.querySelector('.egl-ph-video-player').replaceChildren();
        card.querySelector('.egl-ph-video-load').hidden = false;
        card.querySelector('.egl-ph-video-close').hidden = true;
      });
      if (comparisonTimer !== null) { win.clearTimeout(comparisonTimer); comparisonTimer = null; }
      if (exampleEndCleanup) { exampleEndCleanup(); exampleEndCleanup = null; }
      if (comparisonOwner) { comparisonOwner.dataset.playing = 'false'; comparisonOwner = null; }
      examplePlayer.pause();
      if (localUtterance && win.speechSynthesis) { win.speechSynthesis.cancel(); localUtterance = null; }
    }
    function wordAudioFor(word) {
      const key = wordKey(typeof word === 'string' ? word : word.text);
      const catalog = global.EGL_WORD_AUDIO && global.EGL_WORD_AUDIO.by_word;
      const item = catalog && Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : null;
      return item && item.standalone === true && typeof item.url === 'string' && wordKey(item.text) === key ? item : null;
    }
    function isolatedReference(text) {
      const item = wordAudioFor(text), data = item && item.reference;
      if (!data || data.accent !== accent.value || !Array.isArray(data.words) || data.words.length !== 1 || !Array.isArray(data.words[0].phones) || !data.words[0].phones.length) return null;
      return { ...data, text, words: [{ ...data.words[0], index: 0, text, phones: data.words[0].phones.slice() }], reference_context: 'isolated_word' };
    }
    function playCompleteExample(url, label, finished, rate) {
      let resolved;
      try { resolved = portableURL(url); } catch (error) { showServiceError(error); return; }
      const current = exampleVersion;
      if (exampleEndCleanup) { exampleEndCleanup(); exampleEndCleanup = null; }
      if (finished) {
        const ended = () => {
          if (disposed || current !== exampleVersion || examplePlayer.src !== resolved.href) return;
          if (exampleEndCleanup) { exampleEndCleanup(); exampleEndCleanup = null; }
          finished();
        };
        const failed = () => { stopExample(); setStatus('เปิดเสียงคู่เทียบไม่ได้ ลองโหลดหน้าใหม่แล้วกดฟังอีกครั้งครับ', true); };
        examplePlayer.addEventListener('ended', ended);
        examplePlayer.addEventListener('error', failed);
        exampleEndCleanup = () => { examplePlayer.removeEventListener('ended', ended); examplePlayer.removeEventListener('error', failed); };
      }
      const start = () => {
        if (disposed || current !== exampleVersion) return;
        examplePlayer.currentTime = 0;
        examplePlayer.playbackRate = rate || (slow ? 0.75 : 1);
        examplePlayer.preservesPitch = true;
      };
      if (examplePlayer.src === resolved.href && examplePlayer.readyState >= 1) start();
      else {
        examplePlayer.src = resolved.href;
        on(examplePlayer, 'loadedmetadata', () => { if (examplePlayer.src === resolved.href) start(); }, { once: true });
      }
      exampleCaption.textContent = label;
      doc.querySelectorAll('audio').forEach(audio => { if (audio !== examplePlayer) audio.pause(); });
      const played = examplePlayer.play();
      if (played && played.catch) played.catch(error => { if (!disposed && current === exampleVersion && error.name !== 'AbortError') { stopExample(); setStatus('เปิดเสียงตัวอย่างไม่ได้ ลองโหลดหน้าใหม่แล้วกดฟังอีกครั้งครับ', true); } });
    }
    function playTeachingSequence(items, owner, progress, rate) {
      if (recording || requestingMic || preparing) { setStatus('หยุดบันทึกเสียงก่อน แล้วค่อยฟังตัวอย่างครับ', true); return; }
      stopPlayback(); stopExample();
      const current = exampleVersion;
      comparisonOwner = owner; owner.dataset.playing = 'true';
      function next(index) {
        if (disposed || current !== exampleVersion || !owner.isConnected) return;
        comparisonTimer = null;
        if (index >= items.length) { owner.dataset.playing = 'false'; comparisonOwner = null; progress.textContent = 'ฟังครบแล้ว ลองพูดตามทีละเสียงครับ'; return; }
        const item = items[index];
        progress.textContent = 'กำลังฟัง ' + item.label;
        playCompleteExample(item.url, item.label, () => {
          if (current === exampleVersion && owner.isConnected) comparisonTimer = win.setTimeout(() => next(index + 1), 450);
        }, rate);
      }
      next(0);
    }
    function speakEnglish(text, label) {
      const synthesis = win.speechSynthesis;
      const novelty = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Pipe Organ|Trinoids|Whisper|Zarvox/i;
      const voices = synthesis ? synthesis.getVoices().filter(item => item.localService === true && /^en([-_]|$)/i.test(item.lang) && !novelty.test(item.name || '')) : [];
      const desired = accent.value.toLowerCase();
      const voice = voices.find(item => String(item.lang).toLowerCase() === desired && /Samantha|Alex|Daniel|Serena|Microsoft|Ava|Allison/i.test(item.name || ''))
        || voices.find(item => String(item.lang).toLowerCase() === desired) || voices[0];
      if (!voice || !win.SpeechSynthesisUtterance) { setStatus('ยังไม่มีเสียงอ่านคำนี้ในเครื่อง ลองเลือกคำที่มีไฟล์ตัวอย่าง หรือติดตั้งเสียงอังกฤษในเครื่องก่อนครับ', true); return; }
      const utterance = new win.SpeechSynthesisUtterance(text);
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = slow ? 0.75 : 1;
      localUtterance = utterance;
      utterance.onend = utterance.onerror = () => { if (localUtterance === utterance) localUtterance = null; };
      exampleCaption.textContent = label;
      synthesis.speak(utterance);
    }
    function playExample(word, wholePhrase) {
      if (recording || requestingMic || preparing) { setStatus('หยุดบันทึกเสียงก่อน แล้วค่อยฟังตัวอย่างครับ', true); return; }
      stopPlayback(); stopExample();
      const target = wholePhrase ? null : word || practiceWord;
      if (target) {
        const item = wordAudioFor(target);
        if (item && (!item.reference || item.reference.accent === accent.value)) {
          playCompleteExample(item.url, 'เสียงคำเดี่ยว: ' + target.text + ' · สร้างเสียงคำนี้แยกต่างหาก');
        } else speakEnglish(target.text, 'เสียงคำเดี่ยว: ' + target.text + ' · เสียงอังกฤษในเครื่อง');
        return;
      }
      const example = exampleForPhrase();
      if (example && example.url) playCompleteExample(example.url, 'ตัวอย่างประโยคเต็ม · ' + (example.label || 'เสียง AI'));
      else speakEnglish(textarea.value.trim(), 'เสียงอ่านประโยคเต็มในเครื่อง');
    }
    function practice(word, focusRecord) {
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      practicePhone = null;
      const target = isolatedReference(word.text);
      practiceWord = { index: word.index, text: word.text, phones: target ? target.words[0].phones.slice() : word.phones || [], isolated: true, targetReference: target };
      if (referenceFocus && !referenceFocus.hidden) referenceWord({ ...word, phones: practiceWord.phones.slice(), ipa: target ? target.ipa : word.ipa });
      mode = 'own'; updateTarget(); updateButtons();
      setStatus('พร้อมฝึกคำว่า ' + word.text + ' · กดบันทึกเมื่อพร้อม แล้วกดดูผล');
      if (focusRecord !== false) recordButton.focus();
    }
    function backToSentence() {
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      practiceWord = null; practicePhone = null; updateTarget(); updateButtons();
      if (sentenceResult) {
        const saved = sentenceResult;
        mode = saved.mode === 'ai' ? 'ai' : 'own'; updateButtons();
        if (saved.blob) setClip(saved.blob, saved.label, saved.kind, saved.info);
        renderAnalysis(saved.data);
      } else setStatus('กลับมาฝึกทั้งประโยคแล้ว กดบันทึกเมื่อพร้อม');
    }
    function updateTarget() {
      soundListeners.splice(0).forEach(remove => remove());
      soundTarget.replaceChildren(); soundTarget.hidden = !practicePhone;
      targetBanner.hidden = !practiceWord;
      targetText.textContent = practicePhone ? 'กำลังฝึกเสียง /' + practicePhone.phone + '/ · ' + (practicePhone.letters || 'ส่วนหนึ่งของ') + ' ในคำ ' + practiceWord.text : practiceWord ? 'กำลังฝึกคำ: ' + practiceWord.text : '';
      recordHint.textContent = practicePhone ? 'รอ “เริ่มพูดได้” แล้วออกเสียงเฉพาะ /' + practicePhone.phone + '/ ไม่ต้องพูดชื่ออักษรหรือทั้งคำ แล้วเว้นจังหวะก่อนกดหยุด' : practiceWord ? 'รอ “เริ่มพูดได้” แล้วพูดคำว่า “' + practiceWord.text + '” ตามธรรมชาติหนึ่งครั้ง เว้นจังหวะก่อนกดหยุด' : 'รอ “เริ่มพูดได้” แล้วพูดประโยคด้านบนให้จบ เว้นจังหวะก่อนกดหยุด';
      wordPracticeHint.hidden = !practiceWord || Boolean(practicePhone);
      selectedPhrase.textContent = practicePhone ? 'ฝึกเสียง /' + practicePhone.phone + '/ ของ ' + practiceWord.text : practiceWord ? 'กำลังฝึกคำ: ' + practiceWord.text : 'แตะคำเพื่อดูเสียงทีละส่วน';
      if (practicePhone) {
        const word = { ...practiceWord }, selected = { ...practicePhone }, guide = el('div', 'egl-ph-guide');
        showPhoneGuide(guide, selected.phone, null, soundListeners);
        const actions = el('div', 'egl-ph-actions');
        actions.append(button('ฟังเสียงตัวอย่าง /' + selected.phone + '/', () => playPhoneExample(word, selected.index), 'egl-ph-button', soundListeners),
          button('กลับไปฝึกคำ ' + word.text, () => practice(word), 'egl-ph-button', soundListeners));
        const next = button('ฝึกเสียงถัดไป', () => startPhonePractice(word, (selected.index + 1) % word.phones.length), 'egl-ph-button', soundListeners);
        next.disabled = word.phones.length < 2; actions.append(next);
        soundTarget.append(guide, actions, el('p', 'egl-ph-note', singlePhoneHint(selected.phone)));
      }
    }
    function originalWord(word) {
      const index = practiceWord ? practiceWord.index : word.index;
      if (practiceWord && practiceWord.isolated && practiceWord.targetReference) {
        return { ...practiceWord.targetReference.words[0], index: practiceWord.index, text: practiceWord.text };
      }
      const text = textarea.value.trim();
      const choices = [reference, options.precomputed, demoData().texts && demoData().texts[text], global.EGL_PHONETIC_DATA && global.EGL_PHONETIC_DATA[text]];
      for (const item of choices) {
        if (!item || item.text !== text || item.accent !== accent.value || !Array.isArray(item.words)) continue;
        const found = item.words.find(entry => String(entry.index) === String(index) && wordKey(entry.text) === wordKey(word.text));
        if (found && Array.isArray(found.phones) && found.phones.length) return found;
      }
      return null;
    }
    function spellingFor(word) {
      try { return global.EGLSpellingGuide && global.EGLSpellingGuide.forWord(word.text, word.phones); } catch (_) { return null; }
    }
    function spellingFeedback(source, groups) {
      const helper = global.EGLSpellingFeedback;
      if (!analysisData || !helper || typeof helper.analyzeWord !== 'function') return null;
      const expected = analysisData.reference;
      if (!expected || !Array.isArray(expected.words) || expected.accent !== accent.value) return null;
      let index;
      if (expected.text === textarea.value.trim()) index = source.index;
      else if (practiceWord && wordKey(expected.text) === wordKey(source.text) && expected.words.length === 1) index = expected.words[0].index;
      else return null;
      try { return helper.analyzeWord(analysisData, index, groups); } catch (_) { return null; }
    }
    function refreshSpellingScores() {
      if (!disposed) [...spellingRefreshers].forEach(refresh => refresh());
    }
    function phoneResultText(result, phone) {
      if (!result || validPercent(result.match_percent) == null) return 'ยังไม่มีผลที่ประเมินได้สำหรับเสียงนี้ บันทึกแล้วกดดูผล หรือบันทึกใหม่ให้ชัดขึ้น';
      const observed = Array.isArray(result.observed) ? result.observed.map(item => typeof item === 'string' ? item : item.phone).filter(Boolean).join(' ') : '';
      const counts = result.counts || {};
      if (result.match_percent === 100) return 'โมเดลจับคู่เสียง /' + phone + '/ กับอ้างอิงได้ในคลิปนี้ ลองเชื่อมเสียงนี้กับคำเต็มต่อครับ';
      if (counts.deleted_phones) return 'โมเดลยังไม่พบเสียง /' + phone + '/ ที่ตำแหน่งนี้ ลองดูวิธีวางปาก แล้วออกเสียงในคำเต็มให้ชัดขึ้น';
      if (counts.substituted_phones) return 'อ้างอิง /' + phone + '/ แต่โมเดลตรวจพบ /' + (observed || 'เสียงอื่น') + '/ ลองเปรียบเทียบตำแหน่งลิ้นและการปล่อยลมด้านล่าง';
      if (counts.inserted_phones) return 'โมเดลพบเสียงเพิ่มใกล้ /' + phone + '/ ลองฟังคำเต็มช้า ๆ และระวังเติมสระหรือเสียงอื่นแทรก';
      return 'ลองฝึก /' + phone + '/ แยก แล้วเชื่อมกลับเป็นคำเต็ม เปอร์เซ็นต์นี้นับการจับคู่เสียงที่โมเดลตรวจพบ';
    }
    function singlePhoneHint(phone) {
      const stop = preferWordPractice(phone);
      return (stop ? 'เสียงนี้ปล่อยสั้น ๆ อย่าเติมสระตาม หากระบบตรวจไม่พบ ให้ฝึกในคำเต็มแทน' : 'ลองค้างเสียงที่ลากได้ประมาณ 1 วินาที โดยไม่เติมสระหรือชื่ออักษร') + ' · ผลเสียงเดี่ยวเป็นการทดลอง โดยเฉพาะเสียงสั้น ระบบอาจประเมินไม่ได้ ไม่ได้แปลว่าคุณออกเสียงผิด';
    }
    function preferWordPractice(phone) { return /^(p|b|t|d|k|ɡ|g|tʃ|dʒ)$/.test(String(phone).replace(/[ˈˌ͜͡]/g, '')); }
    function recommendedMethod(phone, word) {
      return preferWordPractice(phone) ? 'ฝึกในคำเต็ม ' + word + ' โดยเน้น /' + phone + '/ ที่ปล่อยสั้น ๆ อย่าฝืนลากหรือเติมสระตาม'
        : 'ลองฝึก /' + phone + '/ แยกสั้น ๆ ตามภาพวางปาก แล้วเชื่อมกลับเป็นคำเต็ม ' + word;
    }
    function startPhonePractice(word, phoneIndex, letters) {
      const source = originalWord(word);
      if (!source || !Number.isInteger(phoneIndex) || !source.phones[phoneIndex]) { setStatus('ยังไม่พบคำอ่านของเสียงที่เลือก กลับไปเลือกคำอีกครั้งครับ', true); return; }
      if (Array.isArray(word.phones) && word.phones[phoneIndex] !== source.phones[phoneIndex]) { setStatus('รูปเสียงเปลี่ยนจากในประโยคเป็นคำเดี่ยวแล้ว กรุณาเลือกเสียงจากช่องที่อัปเดตใหม่ครับ', true); return; }
      const isolated = Boolean(practiceWord && practiceWord.isolated);
      const targetReference = isolated ? practiceWord.targetReference : null;
      cancelRequest(); stopCapture(); stopExample(); clearClip();
      const spelling = spellingFor(source);
      const group = spelling && spelling.available && spelling.groups.find(item => item.phoneIndices.includes(phoneIndex));
      practiceWord = { ...source, phones: source.phones.slice(), isolated, targetReference };
      practicePhone = { index: phoneIndex, phone: source.phones[phoneIndex], letters: letters || group && group.letters || '' };
      mode = 'own'; updateTarget(); updateButtons();
      setStatus('พร้อมฝึกเฉพาะเสียง /' + practicePhone.phone + '/ ของ ' + source.text + ' · ฟังตัวอย่าง แล้วกดบันทึกเมื่อพร้อม');
      recordButton.focus();
    }
    function playLetterName(letter) {
      if (recording || requestingMic || preparing) { setStatus('หยุดบันทึกเสียงก่อน แล้วค่อยฟังชื่ออักษรครับ', true); return; }
      stopPlayback(); stopExample();
      const synthesis = win.speechSynthesis;
      const voice = synthesis && synthesis.getVoices().find(item => item.localService === true && /^en([-_]|$)/i.test(item.lang));
      if (!voice || !win.SpeechSynthesisUtterance) { setStatus('ยังไม่มีเสียงอ่านชื่ออักษรในเครื่อง ติดตั้งเสียงอังกฤษก่อน หรือใช้ตัวอย่างเสียงในคำด้านล่าง', true); return; }
      const utterance = new win.SpeechSynthesisUtterance(letter.toUpperCase());
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.8;
      localUtterance = utterance; utterance.onend = utterance.onerror = () => { if (localUtterance === utterance) localUtterance = null; };
      exampleCaption.textContent = 'ชื่ออักษร ' + letter.toUpperCase() + ' ใช้สะกดคำ · ต่างจากเสียงในคำ';
      synthesis.speak(utterance);
    }
    function playPhoneExample(word, phoneIndex) {
      if (recording || requestingMic || preparing) { setStatus('หยุดบันทึกเสียงก่อน แล้วค่อยฟังตัวอย่างครับ', true); return; }
      const source = originalWord(word);
      if (!source || !source.phones[phoneIndex]) return;
      const phone = source.phones[phoneIndex], isolated = isolatedReference(source.text);
      // Weak forms can differ from a separately spoken word. Keep the whole
      // sentence as the example in that case, without inventing a phone cut.
      if (isolated && !isolated.words[0].phones.includes(phone)) {
        playExample(null, true);
        exampleCaption.textContent = 'ฟัง /' + phone + '/ ในประโยคเต็ม · คำเดี่ยว ' + source.text + ' ใช้รูปเต็ม /' + isolated.ipa + '/ ซึ่งอาจต่างจากรูปเบาในประโยค';
      } else {
        playExample(source);
        exampleCaption.textContent += ' · ฟังเสียง /' + phone + '/ ภายในคำเต็มนี้';
      }
    }
    function spellingSection(word, bucket) {
      const source = originalWord(word);
      if (!source) return null;
      const section = el('section', 'egl-ph-spelling');
      section.setAttribute('aria-label', 'แยกตัวสะกดและฝึกเสียงของ ' + source.text);
      section.append(el('h4', 'egl-ph-heading', 'แกะตัวสะกด · ' + source.text), el('p', 'egl-ph-note', 'แตะส่วนตัวสะกดเพื่อดูเปอร์เซ็นต์และวิธีฝึก ตัวอักษรหลายตัวอาจรวมเป็นเสียงเดียว'));
      const alphabet = el('details', 'egl-ph-letter-names');
      alphabet.append(el('summary', '', 'ชื่ออักษรที่ใช้สะกด ' + source.text.toUpperCase().split('').join('–')));
      const letters = el('div', 'egl-ph-letter-strip');
      [...source.text].filter(letter => /[a-z]/i.test(letter)).forEach(letter => {
        const name = button(letter.toUpperCase(), () => playLetterName(letter), 'egl-ph-letter-name', bucket);
        name.setAttribute('aria-label', 'ฟังชื่ออักษร ' + letter.toUpperCase()); letters.append(name);
      });
      alphabet.append(letters, el('p', 'egl-ph-note', 'ชื่ออักษรใช้สะกดคำ ส่วนเปอร์เซ็นต์ด้านล่างเปรียบเทียบเสียงในคำ'));
      section.append(alphabet);
      const spelling = spellingFor(source);
      const groups = spelling && spelling.available ? spelling.groups : source.phones.map((phone, index) => ({ letters: '', phoneIndices: [index], phones: [phone], silent: false }));
      if (!spelling || !spelling.available) section.append(el('p', 'egl-ph-note', 'คำนี้ยังไม่ได้ตรวจการจับคู่ตัวสะกดกับเสียง จึงให้เปอร์เซ็นต์รายหน่วยเสียง โดยไม่เดาว่าตัวอักษรใดแทนเสียงอะไร'));
      const summary = el('div', 'egl-ph-spelling-summary'), strip = el('div', 'egl-ph-spelling-groups'), panel = el('div', 'egl-ph-spelling-detail');
      const buttons = [], detailListeners = [], summaryListeners = [];
      let feedback = null, currentGroup = null, currentPhone = null;
      bucket.push(() => detailListeners.splice(0).forEach(remove => remove()));
      bucket.push(() => summaryListeners.splice(0).forEach(remove => remove()));
      const phoneData = index => feedback && feedback.phones && feedback.phones.find(item => item.phoneIndex === index);
      function labelFor(index) {
        const group = groups.find(item => item.phoneIndices.includes(index));
        return (group && group.letters ? group.letters + ' ' : '') + '/' + source.phones[index] + '/';
      }
      function assessedPhones() {
        return feedback && Array.isArray(feedback.phones) ? feedback.phones.filter(item => validPercent(item.match_percent) != null) : [];
      }
      function priorities() {
        return assessedPhones().filter(item => item.match_percent < 95).sort((a, b) => a.match_percent - b.match_percent || a.phoneIndex - b.phoneIndex);
      }
      function choose(group, phoneIndex) {
        stopExample();
        detailListeners.splice(0).forEach(remove => remove());
        currentGroup = group;
        currentPhone = phoneIndex == null ? group.phoneIndices[0] : phoneIndex;
        buttons.forEach(item => item.node.setAttribute('aria-pressed', String(item.group === group)));
        panel.replaceChildren();
        if (group.silent) { panel.append(el('strong', '', 'ตัวสะกด ' + group.letters + ' ไม่ออกเสียงแยกในคำนี้'), el('p', 'egl-ph-note', 'ส่วนนี้แสดง — เพราะไม่มีหน่วยเสียงให้เทียบ ไม่ใช่ 0% หรือ 100% ลองฟังคำเต็มโดยไม่เติมเสียงให้ตัวอักษรนี้')); return; }
        const index = currentPhone, phone = source.phones[index], result = phoneData(index), percent = result ? validPercent(result.match_percent) : null;
        panel.append(el('strong', 'egl-ph-spelling-focus', (group.letters ? group.letters + ' → ' : '') + '/' + phone + '/'));
        if (group.phoneIndices.length > 1) {
          panel.append(el('p', 'egl-ph-note', 'เปอร์เซ็นต์ช่องบนรวมเสียงทั้งกลุ่ม ด้านล่างเลือกดูผลทีละเสียงได้'));
          const parts = el('div', 'egl-ph-actions');
          group.phoneIndices.forEach(at => {
            const item = phoneData(at), score = item ? validPercent(item.match_percent) : null;
            const node = button('/' + source.phones[at] + '/ · ' + percentText(score), () => choose(group, at), 'egl-ph-button egl-ph-' + percentLevel(score), detailListeners);
            node.setAttribute('aria-pressed', String(at === index)); parts.append(node);
          });
          panel.append(parts);
        }
        const resultBox = el('div', 'egl-ph-part-result egl-ph-' + percentLevel(percent));
        resultBox.append(el('strong', 'egl-ph-part-percent', percentText(percent)), el('span', 'egl-ph-part-result-label', 'หน่วยเสียงตรงกับอ้างอิง'));
        if (result && result.counts && percent != null) resultBox.append(el('small', 'egl-ph-part-counts', countsText(result.counts, result.operations)));
        const advice = el('p', 'egl-ph-part-advice', phoneResultText(result, phone));
        resultBox.append(advice, el('p', 'egl-ph-part-method', 'วิธีฝึก: ' + recommendedMethod(phone, source.text))); panel.append(resultBox);
        const guide = el('div', 'egl-ph-guide'); showPhoneGuide(guide, phone, null, detailListeners); panel.append(guide);
        const actions = el('div', 'egl-ph-actions');
        actions.append(button('ฟังเสียง /' + phone + '/ ในคำ', () => playPhoneExample(source, index), 'egl-ph-button', detailListeners),
          button('ฝึกเฉพาะเสียง /' + phone + '/', () => startPhonePractice(source, index, group.letters), 'egl-ph-button egl-ph-primary', detailListeners),
          button('ฟังรวมเป็นคำ', () => playExample(source), 'egl-ph-button', detailListeners));
        panel.append(actions, el('p', 'egl-ph-note', singlePhoneHint(phone)));
      }
      groups.forEach(group => {
        const node = button('', () => choose(group), 'egl-ph-spelling-group' + (group.silent ? ' egl-ph-silent' : ''), bucket);
        const score = el('span', 'egl-ph-part-percent', '—'), counts = el('small', 'egl-ph-part-counts');
        node.append(el('strong', 'egl-ph-grapheme', group.letters || group.phones.join(' ')), el('span', 'egl-ph-grapheme-sound', group.silent ? 'ไม่ออกเสียง' : '/' + group.phones.join(' ') + '/'), score, counts);
        node.setAttribute('aria-pressed', 'false'); strip.append(node); buttons.push({ node, group, score, counts });
      });
      function update(initial) {
        summaryListeners.splice(0).forEach(remove => remove());
        feedback = spellingFeedback(source, groups);
        buttons.forEach((item, at) => {
          const result = feedback && feedback.groups && feedback.groups[at], percent = result ? validPercent(result.match_percent) : null;
          item.node.className = 'egl-ph-spelling-group egl-ph-' + percentLevel(percent) + (item.group.silent ? ' egl-ph-silent' : '');
          item.score.textContent = percentText(percent);
          item.counts.textContent = item.group.silent ? 'ไม่มีเสียงแยก' : result && result.counts && percent != null ? result.counts.matched_phones + ' / ' + result.counts.compared_phones + ' เสียง' : 'ยังประเมินไม่ได้';
          item.node.setAttribute('aria-label', (item.group.letters || item.group.phones.join(' ')) + ' · ' + percentText(percent) + ' หน่วยเสียงตรงกับอ้างอิง');
        });
        const weak = priorities(), known = assessedPhones();
        summary.replaceChildren();
        summary.className = 'egl-ph-spelling-summary egl-ph-' + percentLevel(weak.length ? weak[0].match_percent : known.length ? 100 : null);
        const sourceLabel = analysisData ? (mode === 'ai' || analysisData.precomputed === true ? 'ผลจากเสียงตัวอย่าง AI' : 'ผลจากเสียงของฉัน') : 'ยังไม่ได้วิเคราะห์เสียง';
        summary.append(el('small', 'egl-ph-feedback-source', sourceLabel));
        if (weak.length) {
          summary.append(el('strong', '', 'ควรฝึกก่อน: ' + labelFor(weak[0].phoneIndex) + ' · ' + percentText(weak[0].match_percent)), el('p', 'egl-ph-note', phoneResultText(weak[0], weak[0].expected)), el('p', 'egl-ph-part-method', 'วิธีฝึก: ' + recommendedMethod(weak[0].expected, source.text)));
          const actions = el('div', 'egl-ph-actions');
          weak.slice(0, 4).forEach(item => {
            const group = groups.find(candidate => candidate.phoneIndices.includes(item.phoneIndex));
            if (group) actions.append(button('ดู ' + labelFor(item.phoneIndex) + ' · ' + percentText(item.match_percent), () => choose(group, item.phoneIndex), 'egl-ph-button egl-ph-' + percentLevel(item.match_percent), summaryListeners));
          });
          actions.append(button(preferWordPractice(weak[0].expected) ? 'ฝึกคำเต็มโดยเน้นเสียงที่แนะนำ' : 'ฝึกเสียงที่แนะนำ', () => {
            const item = weak[0], group = groups.find(candidate => candidate.phoneIndices.includes(item.phoneIndex));
            if (preferWordPractice(item.expected)) practice(source);
            else startPhonePractice(source, item.phoneIndex, group && group.letters);
          }, 'egl-ph-button egl-ph-primary', summaryListeners));
          summary.append(actions);
        } else if (known.length) summary.append(el('strong', '', 'ส่วนที่ประเมินได้จับคู่ตรงดีแล้ว ลองฝึกเชื่อมเป็นคำเต็มต่อครับ'));
        else summary.append(el('p', 'egl-ph-note', 'บันทึกเสียงแล้วกดดูผล จะเห็นว่าส่วนไหนควรฝึกก่อน · — หมายถึงยังไม่มีข้อมูลพอ ไม่ใช่ออกเสียงผิด'));
        summary.append(el('p', 'egl-ph-feedback-explainer', 'เปอร์เซ็นต์นับเสียงที่จับคู่ตรง ไม่ใช่ความมั่นใจของโมเดล เสียงเดี่ยวจึงอาจได้ 0% หรือ 100%; เสียงเพิ่มทำให้เปอร์เซ็นต์ลดลง'));
        if (feedback && feedback.note && feedback.phones.some(item => item.match_percent == null)) summary.append(el('p', 'egl-ph-note', feedback.note));
        const first = initial && weak.length ? groups.find(group => group.phoneIndices.includes(weak[0].phoneIndex)) : currentGroup;
        if (groups.length) choose(first || groups[0], initial && weak.length ? weak[0].phoneIndex : currentPhone);
      }
      section.append(summary, strip, panel);
      update(true);
      const refresh = () => { if (!section.isConnected) { spellingRefreshers.delete(refresh); return; } update(false); };
      spellingRefreshers.add(refresh); bucket.push(() => spellingRefreshers.delete(refresh));
      return section;
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
    function showPhoneGuide(holder, phone, explanation, bucket) {
      stopExample();
      if (holder.eglGuideCleanup) holder.eglGuideCleanup();
      const controls = [];
      const clear = () => { controls.splice(0).forEach(remove => remove()); };
      holder.eglGuideCleanup = clear;
      (bucket || listeners).push(clear);
      const guide = guideFor(phone);
      holder.replaceChildren(el('strong', 'egl-ph-guide-label', guide.label || phone));
      if (explanation) holder.append(el('p', 'egl-ph-note', explanation));
      if (guide.tip) holder.append(el('p', 'egl-ph-guide-tip', guide.tip));
      if (guide.example) holder.append(el('p', 'egl-ph-note', 'ตัวอย่าง: ' + guide.example));
      const comparison = vowelComparison(phone, controls);
      if (comparison) holder.append(comparison);
      const videos = pronunciationVideos(phone, controls);
      if (videos) holder.append(videos);
      let foundation;
      try { foundation = global.EGLSoundFoundations && global.EGLSoundFoundations.describe(phone); } catch (_) {}
      if (foundation && foundation.known) holder.append(soundFoundation(foundation));
    }
    function vowelAsset(phone) {
      let asset;
      try { asset = global.EGLVowelAudio && global.EGLVowelAudio.forPhone(phone); } catch (_) {}
      if (!asset || !/^assets\/vowels\/[a-z0-9._-]+\.ogg$/i.test(asset.url)) return null;
      const base = runtimeScriptURL || new win.URL(location.pathname.includes('/speech-training/') ? '../app/phonetics.js' : 'phonetics.js', doc.baseURI).href;
      return { ...asset, url: new win.URL(asset.url, base).href };
    }
    function teachingAudio(section, heading, entries, bucket, className) {
      const box = el('section', 'egl-ph-vowel-audio ' + className);
      box.setAttribute('aria-label', heading);
      box.append(el('h5', 'egl-ph-heading', heading));
      const cards = el('div', 'egl-ph-vowel-cards');
      const progress = el('p', 'egl-ph-note egl-ph-vowel-progress', 'กดฟังทีละช่อง แล้วลองฟังสลับกัน');
      progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
      let slower = false;
      const available = entries.filter(entry => entry && entry.url);
      entries.filter(Boolean).forEach((entry, index) => {
        const card = el('div', 'egl-ph-vowel-card');
        card.append(el('strong', 'egl-ph-small-ipa', (index ? 'B' : 'A') + ' · ' + entry.label));
        if (entry.meaning) card.append(el('span', 'egl-ph-note', entry.meaning));
        const listen = button('ฟัง ' + entry.label, () => playTeachingSequence([entry], section, progress, slower ? .75 : 1), 'egl-ph-button egl-ph-primary', bucket);
        listen.disabled = !entry.url; card.append(listen);
        if (entry.url) listeningControl(listen, bucket);
        if (!entry.url) card.append(el('p', 'egl-ph-note', 'ยังไม่มีไฟล์ตัวอย่างที่ตรงกับคำอ่านและสำเนียงนี้'));
        if (entry.note) card.append(el('p', 'egl-ph-note', entry.note));
        if (entry.credit) card.append(entry.credit);
        cards.append(card);
      });
      const actions = el('div', 'egl-ph-actions');
      if (entries.filter(Boolean).length > 1) {
        const alternate = button('ฟังสลับ A → B → A → B', () => playTeachingSequence([available[0], available[1], available[0], available[1]], section, progress, slower ? .75 : 1), 'egl-ph-button', bucket);
        alternate.disabled = available.length !== 2; actions.append(alternate);
        if (available.length === 2) listeningControl(alternate, bucket);
      }
      const speed = button('ฟังช้า 0.75×', () => {
        slower = !slower; stopExample(); speed.setAttribute('aria-pressed', String(slower));
        speed.textContent = slower ? 'ฟังช้า 0.75× ✓' : 'ฟังช้า 0.75×';
        progress.textContent = slower ? 'เลือกโหมดช้าแล้ว กดฟังอีกครั้งได้เลย' : 'เลือกความเร็วปกติแล้ว กดฟังอีกครั้งได้เลย';
      }, 'egl-ph-button', bucket); speed.setAttribute('aria-pressed', 'false');
      actions.append(speed, button('หยุดเสียงคู่เทียบ', () => { stopExample(); progress.textContent = 'หยุดแล้ว กดฟังใหม่ได้ครับ'; }, 'egl-ph-button', bucket));
      box.append(cards, actions, progress); return box;
    }
    function vowelComparison(phone, bucket) {
      let pair;
      try { pair = global.EGLVowelPairs && global.EGLVowelPairs.forPhone(phone); } catch (_) {}
      const target = vowelAsset(phone);
      if (!pair && !target) return null;
      const section = el('section', 'egl-ph-vowel-comparison');
      section.append(el('h5', 'egl-ph-heading', 'ฟังให้รู้ว่าเสียงนี้ต่างอย่างไร'));
      function pureEntry(asset) {
        if (!asset) return null;
        const credit = el('p', 'egl-ph-image-credit', (asset.author || '') + ' · ');
        [[asset.source, 'แหล่งเสียง'], [asset.licenseURL, asset.license]].forEach(([url, label]) => {
          try { const parsed = new win.URL(url); if (parsed.protocol !== 'https:') return; const link = el('a', '', label || 'สิทธิ์การใช้'); link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link, doc.createTextNode(' ')); } catch (_) {}
        });
        return {url: asset.url, label: '/' + (asset.audioSymbol || asset.symbol) + '/', note: [asset.caption, asset.note].filter(Boolean).join(' · '), credit};
      }
      const other = pair && vowelAsset(pair.other.phone);
      if (target) {
        section.append(teachingAudio(section, '1 · ฟังเสียงสระเดี่ยวจากผู้สาธิต', [pureEntry(target), other && other.url !== target.url ? pureEntry(other) : null], bucket, 'egl-ph-pure-vowels'));
        section.append(el('p', 'egl-ph-note', 'ไฟล์สาธิตเสียงสระเต็ม ไม่ตัดจากประโยค · ใช้ฟังคุณภาพและตำแหน่งของสระ ความยาวและสำเนียงในคำอังกฤษอาจต่างกัน'));
      }
      if (pair) {
        const sameSound = value => String(value).replace(/ː/g, '').replace(/^e$/, 'ɛ');
        const entries = [pair.targetWord, pair.other].map(item => {
          const asset = wordAudioFor(item.word);
          const ref = asset && asset.reference;
          const matches = ref && ref.accent === pair.accent && ref.words && ref.words[0] && ref.words[0].phones.some(value => sameSound(value) === sameSound(item.phone));
          return {label: item.word + ' /' + item.phone + '/', meaning: item.meaning, url: matches ? asset.url : null};
        });
        section.append(teachingAudio(section, (target ? '2' : '1') + ' · ฟังสระในคำเต็ม · เสียง AI ' + (pair.accent === 'en-gb' ? 'อังกฤษ' : 'อเมริกัน'), entries, bucket, 'egl-ph-vowel-words'));
        section.append(el('p', 'egl-ph-note', 'เสียง AI สร้างทีละคำ ไม่ตัดจากประโยค · ใช้ฝึกรวมเสียงเป็นคำ ส่วนเสียงสระเดี่ยวและวิดีโอผู้สอนใช้เทียบตำแหน่งเสียง'));
        section.append(el('p', 'egl-ph-vowel-difference', pair.difference));
        const steps = el('ol', 'egl-ph-mouth-steps'); pair.steps.forEach(step => steps.append(el('li', '', step))); section.append(steps);
        if (pair.note) section.append(el('p', 'egl-ph-note', pair.note));
      }
      return section;
    }
    function pronunciationVideos(phone, bucket) {
      let items;
      try { items = global.EGLPronunciationVideos && global.EGLPronunciationVideos.forPhone(phone); } catch (_) {}
      if (!Array.isArray(items) || !items.length) return null;
      const section = el('section', 'egl-ph-videos');
      section.append(el('h5', 'egl-ph-heading', 'ดูรูปปากและฟังผู้สอนในวิดีโอ'));
      items.slice(0, 2).forEach(item => {
        if (!/^[A-Za-z0-9_-]{11}$/.test(item.id)) return;
        const card = el('div', 'egl-ph-video-card');
        card.append(el('strong', '', item.title), el('p', 'egl-ph-note', item.creator + ' · ' + item.focusThai));
        const actions = el('div', 'egl-ph-actions'), playerHost = el('div', 'egl-ph-video-player');
        const load = button('ดูวิดีโอในหน้านี้', () => {
          if (busy || recording || requestingMic || preparing) { setStatus('รอให้บันทึกหรือประมวลผลเสร็จก่อน แล้วค่อยดูวิดีโอครับ', true); return; }
          stopExample(); stopPlayback();
          doc.querySelectorAll('audio').forEach(audio => audio.pause());
          const frame = el('iframe'); frame.title = item.title;
          frame.src = 'https://www.youtube-nocookie.com/embed/' + item.id + '?autoplay=0&rel=0';
          frame.allow = 'encrypted-media; picture-in-picture; fullscreen'; frame.allowFullscreen = true;
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          playerHost.replaceChildren(frame); load.hidden = true; closeVideo.hidden = false;
        }, 'egl-ph-button egl-ph-video-load', bucket);
        listeningControl(load, bucket);
        const closeVideo = button('ปิดวิดีโอ', () => { playerHost.replaceChildren(); load.hidden = false; closeVideo.hidden = true; }, 'egl-ph-button egl-ph-video-close', bucket); closeVideo.hidden = true;
        const link = el('a', 'egl-ph-button', 'เปิดใน YouTube'); link.href = 'https://www.youtube.com/watch?v=' + item.id; link.target = '_blank'; link.rel = 'noopener noreferrer';
        actions.append(load, closeVideo, link); card.append(actions, playerHost); section.append(card);
        try {
          const source = new win.URL(item.source);
          if (source.protocol === 'https:') { const original = el('a', 'egl-ph-note', 'บทเรียนต้นฉบับของผู้สอน'); original.href = source.href; original.target = '_blank'; original.rel = 'noopener noreferrer'; card.append(original); }
        } catch (_) {}
        bucket.push(() => playerHost.replaceChildren());
      });
      section.append(el('p', 'egl-ph-note', 'วิดีโอเป็นภาษาอังกฤษ ดูรูปปากประกอบคำอธิบายไทยด้านบน · กดดูจึงเชื่อมต่อ YouTube หากเล่นฝังไม่ได้ให้เปิดใน YouTube'));
      return section;
    }
    function mouthDiagram(foundation) {
      const visual = foundation.visual || {}, namespace = 'http://www.w3.org/2000/svg';
      function node(tag, attrs, text) {
        const item = doc.createElementNS(namespace, tag);
        Object.entries(attrs || {}).forEach(([key, value]) => item.setAttribute(key, String(value)));
        if (text) item.textContent = text;
        return item;
      }
      const svg = node('svg', { viewBox: '0 0 310 220', role: 'img', class: 'egl-ph-mouth-diagram' });
      svg.append(node('title', {}, 'แผนภาพตำแหน่งโดยย่อของเสียง /' + foundation.symbol + '/ · ' + foundation.place + ' · ' + foundation.airflow));
      const markerId = id + '-air-' + (++diagramSequence), defs = node('defs'), marker = node('marker', { id: markerId, markerWidth: 7, markerHeight: 7, refX: 5, refY: 3, orient: 'auto' });
      marker.append(node('path', { d: 'M0 0L6 3L0 6', fill: 'none', stroke: '#43859a', 'stroke-width': 1.5 })); defs.append(marker); svg.append(defs);
      svg.append(node('path', { d: 'M66 171L66 139Q70 87 100 65Q158 34 213 63L231 88L247 91M247 116Q242 148 210 165Q140 192 82 174', fill: '#fffdf6', stroke: '#b6c4ac', 'stroke-width': 3, 'stroke-linecap': 'round' }));
      svg.append(node('path', { d: 'M83 58Q147 14 218 33L251 49L241 60L219 60', fill: 'none', stroke: '#c7d1be', 'stroke-width': 3 }));
      svg.append(node('path', { d: 'M224 84L224 100L232 100L232 91M232 121L226 121L226 131', fill: '#fff', stroke: '#b8b18a', 'stroke-width': 2 }));
      const positions = { lips: [247, 106], teeth: [229, 102], ridge: [211, 72], palate: [161, 53], velum: [105, 62], throat: [69, 152] };
      const vowels = { 'front-high': [196, 88], 'front-mid': [192, 113], 'front-low': [186, 145], central: [148, 122], 'back-high': [109, 87], 'back-mid': [111, 111], 'back-low': [115, 143] };
      const point = visual.place === 'vowel' ? vowels[visual.tongue] : positions[visual.place];
      const tonguePlace = point && ['ridge', 'palate', 'velum'].includes(visual.place);
      const crest = tonguePlace ? [point[0], point[1] + (visual.contact === true ? 0 : 15)] : visual.place === 'vowel' && point ? point : [176, 137];
      svg.append(node('path', { d: 'M91 164Q112 144 ' + crest[0] + ' ' + crest[1] + 'Q219 142 223 155Q182 179 91 174Z', fill: '#d4c3bd', stroke: '#ad9288', 'stroke-width': 2 }));
      const airPath = visual.nasal ? 'M72 153Q85 107 92 66Q150 26 245 45' : 'M76 153Q119 115 162 108Q212 109 266 106';
      svg.append(node('path', { d: airPath, fill: 'none', stroke: '#43859a', 'stroke-width': 2.5, 'stroke-dasharray': '5 5', 'marker-end': 'url(#' + markerId + ')' }));
      if (point) { svg.append(node('circle', { cx: point[0], cy: point[1], r: 12, fill: '#b8d1a0', opacity: 0.45 })); svg.append(node('circle', { cx: point[0], cy: point[1], r: 5, fill: '#3b6e43' })); }
      svg.append(node('circle', { cx: 68, cy: 161, r: 15, fill: visual.voiced ? '#e1d6ec' : '#eef0e8', stroke: visual.voiced ? '#9379ad' : '#bdc6b5', 'stroke-width': 2 }));
      if (visual.voiced) svg.append(node('path', { d: 'M57 162q4-10 8 0t8 0t7 0', fill: 'none', stroke: '#80619e', 'stroke-width': 2 }));
      svg.append(node('text', { x: 43, y: 201, fill: '#63735c', 'font-size': 12 }, visual.voiced ? 'คอสั่น' : 'คอไม่สั่น'));
      svg.append(node('text', { x: 179, y: 21, fill: '#63735c', 'font-size': 12 }, 'จมูก'));
      svg.append(node('text', { x: 250, y: 143, fill: '#63735c', 'font-size': 12 }, 'ปาก'));
      svg.append(node('text', { x: 133, y: 180, fill: '#8b7168', 'font-size': 12 }, 'ลิ้น'));
      return svg;
    }
    function soundFoundation(foundation) {
      const section = el('section', 'egl-ph-foundation');
      section.setAttribute('aria-label', 'วิธีสร้างเสียง /' + foundation.symbol + '/ ตั้งแต่พื้นฐาน');
      section.append(el('h5', 'egl-ph-heading', 'สร้างเสียง /' + foundation.symbol + '/ ทีละขั้น'));
      const facts = el('div', 'egl-ph-sound-facts');
      [['ประเภทเสียง', foundation.category], ['ตำแหน่ง', foundation.place], ['การปล่อยลม', foundation.manner], ['สังเกตที่คอ', foundation.voice]].forEach(([label, value]) => {
        if (!value) return;
        const fact = el('div', 'egl-ph-sound-fact'); fact.append(el('small', '', label), el('span', '', value)); facts.append(fact);
      });
      section.append(facts);
      const steps = el('ol', 'egl-ph-mouth-steps');
      (Array.isArray(foundation.steps) ? foundation.steps : []).forEach(step => steps.append(el('li', '', step)));
      section.append(steps);
      if (foundation.commonMistake) section.append(el('p', 'egl-ph-sound-caution', 'จุดที่ต้องระวัง: ' + foundation.commonMistake));
      const anatomy = el('details', 'egl-ph-anatomy');
      anatomy.append(el('summary', '', 'ดูตำแหน่งลิ้น–ปาก และทางเดินลม'));
      const layout = el('div', 'egl-ph-anatomy-layout'), notes = el('dl', 'egl-ph-anatomy-notes');
      [['ริมฝีปาก', foundation.lips], ['ลิ้น', foundation.tongue], ['ทางออกของลม', foundation.airflow], ['ลากเสียงได้ไหม', foundation.canSustain ? 'ค้างเสียงสั้น ๆ ได้ โดยไม่เติมสระตาม' : 'เป็นเสียงปล่อยสั้นหรือเสียงเลื่อน อย่าฝืนลากส่วนที่กั้นลม']].forEach(([label, value]) => {
        if (!value) return; notes.append(el('dt', '', label), el('dd', '', value));
      });
      const image = articulationImage(foundation);
      anatomy.open = Boolean(image);
      layout.append(image || mouthDiagram(foundation), notes); anatomy.append(layout);
      if (image) {
        const schematic = el('details', 'egl-ph-air-schematic');
        schematic.append(el('summary', '', 'ดูแผนภาพย่อของทางเดินลมและคอสั่น'), mouthDiagram(foundation)); anatomy.append(schematic);
      }
      anatomy.append(el('p', 'egl-ph-note', 'แผนภาพย่อ: จุดสีเขียวชี้ตำแหน่งที่ใช้สร้างเสียง ลูกศรสีฟ้าชี้ทางลม · รูปปากเปลี่ยนได้ตามสำเนียงและเสียงข้างเคียง ไม่ใช่ภาพการเคลื่อนไหวจริง'));
      if (foundation.compare && foundation.compare.phone) anatomy.append(el('p', 'egl-ph-note', 'ลองเทียบ /' + foundation.compare.phone + '/' + (foundation.compare.word ? ' ในคำ ' + foundation.compare.word : '') + ' · ' + (foundation.compare.note || '')));
      if (Array.isArray(foundation.sources) && foundation.sources.length) {
        const sources = el('p', 'egl-ph-note', 'แหล่งอ้างอิงวิธีสร้างเสียง: ');
        foundation.sources.forEach((url, index) => { try { const parsed = new win.URL(url); if (parsed.protocol !== 'https:') return; const link = el('a', '', '[' + (index + 1) + ']'); link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link, doc.createTextNode(' ')); } catch (_) {} });
        anatomy.append(sources);
      }
      section.append(anatomy);
      return section;
    }
    function articulationImage(foundation) {
      let asset;
      try { asset = global.EGLArticulationImages && global.EGLArticulationImages.describe(foundation.symbol); } catch (_) {}
      if (!asset || !/^assets\/articulation\/[a-z0-9._-]+\.svg$/i.test(asset.src)) return null;
      const base = runtimeScriptURL || new win.URL(location.pathname.includes('/speech-training/') ? '../app/phonetics.js' : 'phonetics.js', doc.baseURI).href;
      const figure = el('figure', 'egl-ph-articulation-figure'), img = el('img', 'egl-ph-articulation-image');
      img.src = new win.URL(asset.src, base).href;
      img.alt = asset.altThai || 'ภาพตำแหน่งอวัยวะในช่องปากสำหรับเสียง /' + foundation.symbol + '/';
      img.width = 400; img.height = 400; img.loading = 'lazy'; img.decoding = 'async';
      const caption = el('figcaption', 'egl-ph-articulation-caption', asset.captionThai || 'ภาพตำแหน่งช่องปากของเสียงนี้');
      const credit = el('p', 'egl-ph-image-credit', (asset.author || 'ผู้สร้างตามแหล่งภาพ') + ' · ภาพต้นฉบับไม่ดัดแปลง · ');
      [[asset.source, 'แหล่งภาพ'], [asset.licenseURL, asset.license || 'สิทธิ์การใช้ภาพ']].forEach(([url, label]) => {
        try { const parsed = new win.URL(url); if (parsed.protocol !== 'https:') return; const link = el('a', '', label); link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link, doc.createTextNode(' ')); } catch (_) {}
      });
      figure.append(img, caption, credit);
      img.addEventListener('error', () => {
        if (disposed) return;
        img.replaceWith(mouthDiagram(foundation));
        caption.textContent = 'โหลดภาพต้นฉบับไม่สำเร็จ จึงแสดงแผนภาพตำแหน่งแบบย่อของแอป';
        credit.replaceChildren();
      }, { once: true });
      return figure;
    }
    function referenceWord(word) {
      stopExample();
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
      if (practiceWord && practiceWord.isolated) referenceFocus.append(el('p', 'egl-ph-note', 'กำลังแสดงคำอ่านแบบคำเดี่ยว รูปเสียงอาจต่างจากคำเบาในประโยค'));
      const chips = el('div', 'egl-ph-phone-chips');
      const guide = el('div', 'egl-ph-guide');
      const phones = Array.isArray(word.phones) ? word.phones : [];
      const actions = el('div', 'egl-ph-actions');
      actions.append(button('ฟังคำตัวอย่าง', () => playExample(word), 'egl-ph-button', referenceListeners), button('ฝึกคำนี้', () => practice(word), 'egl-ph-button egl-ph-primary', referenceListeners));
      phones.forEach(phone => chips.append(button(phone, () => {
        showPhoneGuide(guide, phone, 'นี่คือเสียงอ้างอิงจากข้อความ ยังไม่ได้ฟังจากไฟล์เสียง', referenceListeners);
      }, 'egl-ph-phone', referenceListeners)));
      const spelling = spellingSection(word, referenceListeners);
      if (spelling) referenceFocus.append(spelling, actions);
      else referenceFocus.append(actions, chips, guide);
      if (phones.length) showPhoneGuide(guide, phones[0], null, referenceListeners);
      else guide.append(el('p', 'egl-ph-note', 'ดูคำอ่าน IPA ในรายละเอียดด้านล่างได้ครับ'));
      referenceFocus.hidden = false;
    }
    function renderReference(data) {
      if (!data || !Array.isArray(data.words)) throw new Error('Invalid pronunciation reference');
      if (practiceWord && data.text !== textarea.value.trim()) return;
      stopExample();
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
      textButton.setAttribute('aria-expanded', 'false');
      on(raw, 'toggle', () => textButton.setAttribute('aria-expanded', String(raw.open)), undefined, referenceListeners);
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
    function revealReference() {
      const raw = expected.querySelector('details');
      if (expected.hidden || !raw) return;
      root.open = true;
      raw.open = true;
      textButton.setAttribute('aria-expanded', 'true');
      const heading = raw.querySelector('summary');
      if (heading) heading.focus({ preventScroll: true });
      if (typeof raw.scrollIntoView === 'function') raw.scrollIntoView({ block: 'nearest' });
    }
    function stopPlayback() { player.pause(); }
    function wordOperations(word) {
      const operations = analysisData && analysisData.alignment && analysisData.alignment.operations;
      return Array.isArray(operations) ? operations.filter(op => String(op.word_index) === String(word.index)) : [];
    }
    function selectWord(index) {
      if (!wordItems[index] || !analysisData) return;
      stopExample();
      inspectorListeners.splice(0).forEach(remove => remove());
      selectedIndex = index;
      const item = wordItems[index], word = item.word, operations = wordOperations(word);
      const uncertain = uncertainRecognition(analysisData);
      selectedPhrase.textContent = 'คำที่เลือก: ' + word.text;
      wordItems.forEach((entry, i) => entry.button.setAttribute('aria-pressed', String(i === index)));
      inspector.replaceChildren(el('h4', 'egl-ph-inspector-title', word.text + ' · ' + percentText(item.percent)));
      const meaning = wordMeaning(practiceWord || word);
      if (meaning) inspector.append(el('p', 'egl-ph-word-meaning', meaning));
      inspector.append(el('p', 'egl-ph-counts', uncertain ? 'ยังประเมินคำนี้ไม่ได้ เพราะระบบแยกหน่วยเสียงได้ไม่มั่นคง' : countsText(word, operations) + ' จับคู่กับอ้างอิง'));
      const controls = el('div', 'egl-ph-actions');
      const replay = button(mode === 'own' ? 'ฟังเสียงของฉันทั้งคลิป' : 'ฟังเสียง AI ทั้งคลิป', () => { playOwn(true); player.playbackRate = slow ? 0.75 : 1; }, 'egl-ph-button egl-ph-primary', inspectorListeners);
      replay.disabled = !clip;
      const slower = button(slow ? 'ช้า 0.75× ✓' : 'ช้า 0.75×', () => {
        slow = !slow; player.playbackRate = slow ? 0.75 : 1;
        slower.textContent = slow ? 'ช้า 0.75× ✓' : 'ช้า 0.75×';
        slower.setAttribute('aria-pressed', String(slow));
        examplePlayer.playbackRate = slow ? 0.75 : 1;
      }, 'egl-ph-button egl-ph-slow', inspectorListeners);
      slower.setAttribute('aria-pressed', String(slow));
      const different = uncertain ? [] : wordItems.map((entry, i) => ({ entry, i })).filter(x => x.entry.percent != null && x.entry.percent < 100 || x.entry.word.status === 'difference');
      const next = button('คำที่มีเสียงต่างถัดไป', () => {
        const following = different.find(x => x.i > selectedIndex) || different[0];
        if (following) selectWord(following.i);
      }, 'egl-ph-button', inspectorListeners);
      next.disabled = !different.length;
      controls.append(button('ฟังคำตัวอย่าง', () => playExample(practiceWord || word), 'egl-ph-button', inspectorListeners), replay, slower,
        button('ฝึกคำนี้', () => practice(practiceWord || word), 'egl-ph-button egl-ph-primary', inspectorListeners), next);
      inspector.append(controls);
      const spelling = spellingSection(practiceWord || word, inspectorListeners);
      if (spelling) inspector.append(spelling);
      if (uncertain) {
        inspector.append(el('p', 'egl-ph-note', 'ฟังเสียงของคุณเทียบกับตัวอย่างได้ แล้วลองบันทึกใหม่ · ผลตรวจครั้งนี้ยังใช้ระบุว่าเสียงใดออกผิดไม่ได้'));
        inspector.hidden = false;
        return;
      }
      inspector.append(el('p', 'egl-ph-note', 'แตะเสียงอ้างอิงเพื่อฟังตัวอย่างคำเดี่ยว หรือแตะเสียงที่ตรวจพบเพื่อฟังคลิปที่วิเคราะห์เต็มคลิป'));
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
        ['expected', 'observed'].forEach(side => {
          const phone = op[side];
          if (!phone) { row.append(el('span', 'egl-ph-phone-missing', '—')); return; }
          const chip = button('', () => {
            showPhoneGuide(guide, phone, messages[op.type] || 'การจับคู่หน่วยเสียงเป็นการประมาณจากไฟล์เสียง', inspectorListeners);
            if (side === 'expected') playExample(practiceWord || word);
            else playOwn(true);
          }, 'egl-ph-phone', inspectorListeners);
          chip.append(el('span', 'egl-ph-phone-symbol', phone));
          const descriptor = guideFor(phone);
          if (descriptor.label && descriptor.label !== phone) chip.append(el('span', 'egl-ph-phone-label', descriptor.label));
          chip.setAttribute('aria-label', (side === 'expected' ? 'อ้างอิง ' : 'ตรวจพบ ') + phone + (side === 'expected' ? ' ฟังตัวอย่างคำเดี่ยว' : ' ฟังคลิปที่วิเคราะห์เต็มคลิป'));
          row.append(chip);
        });
        pairs.append(row);
      });
      if (!operations.length) {
        pairs.append(el('p', 'egl-ph-note', 'ยังไม่มีรายละเอียดจับคู่ทีละเสียง ฟังช่วงคำเต็มหรือดู IPA ในรายละเอียดได้ครับ'));
      }
      inspector.append(pairs, guide);
      const firstPhone = operations.find(op => op.expected || op.observed);
      if (firstPhone) showPhoneGuide(guide, firstPhone.expected || firstPhone.observed, messages[firstPhone.type], inspectorListeners);
      else guide.append(el('p', 'egl-ph-note', 'ผลนี้ยังไม่พอสำหรับอธิบายตำแหน่งเสียงแต่ละหน่วย'));
      inspector.hidden = false;
    }
    function renderAnalysis(data) {
      clearObserved();
      const issue = recognitionIssue(data);
      if (issue) data = { ...data, recognition_quality: { ...data.recognition_quality, status: 'uncertain', reason: issue, calibrated: false } };
      if (practiceWord && practiceWord.isolated && !practicePhone && data.reference && data.reference.text === practiceWord.text && data.reference.accent === accent.value && Array.isArray(data.reference.words) && data.reference.words.length === 1) {
        practiceWord.targetReference = data.reference;
        practiceWord.phones = data.reference.words[0].phones.slice();
      }
      if (data.reference && !practiceWord) renderReference(data.reference);
      analysisData = data; refreshSpellingScores();
      if (!practiceWord) sentenceResult = { data, blob: clip, label: clipLabel, kind: clipKind, info: clipInfo, mode };
      const found = data.observed || {};
      const metrics = data.metrics || {};
      const alignment = data.alignment || {}, operations = Array.isArray(alignment.operations) ? alignment.operations : [];
      const summary = alignment.summary || operationCounts(operations);
      const uncertain = uncertainRecognition(data);
      const overall = uncertain ? null : percentage(summary, operations);
      const score = el('div', 'egl-ph-agreement egl-ph-' + percentLevel(overall));
      score.append(el('strong', 'egl-ph-percent', percentText(overall)), el('span', 'egl-ph-agreement-label', uncertain ? 'ยังประเมินการออกเสียงไม่ได้' : 'หน่วยเสียงจับคู่กับอ้างอิง'));
      score.append(el('span', 'egl-ph-counts', uncertain ? issue === 'insufficient_audio_signal' ? 'สัญญาณเสียงยังไม่เพียงพอสำหรับเปรียบเทียบ' : 'ระบบยังแยกหน่วยเสียงสำหรับเปรียบเทียบไม่ได้อย่างมั่นคง' : countsText(summary, operations)));
      observed.replaceChildren(el('h3', 'egl-ph-step-title', practicePhone ? '3 · ผลเฉพาะเสียง /' + practicePhone.phone + '/ ในคำ ' + practiceWord.text : practiceWord ? '3 · ผลคำว่า ' + practiceWord.text : '3 · ดูผลทีละคำ'), score);
      if (uncertain) {
        const explanation = issue === 'insufficient_audio_signal'
          ? 'สัญญาณเสียงเบาหรือมีช่วงเสียงสั้นเกินกว่าจะประเมินได้ ลองกดฟังไฟล์ก่อน แล้วบันทึกใหม่เมื่อขึ้น “เริ่มพูดได้”'
          : issue === 'no_detected_phones'
            ? 'ระบบยังตรวจแยกหน่วยเสียงจากคลิปนี้ไม่ได้ จึงยังประเมินไม่ได้ ไม่ได้หมายความว่าคุณออกเสียงผิด ลองฟังเสียงเทียบกับตัวอย่างได้'
            : 'ผลครั้งนี้ยังไม่น่าเชื่อถือพอสำหรับให้เปอร์เซ็นต์ ลองฟังเสียงของคุณเทียบกับตัวอย่าง คำสั้นอาจตรวจพลาดได้โดยไม่ใช่ความผิดของผู้เรียน';
        observed.append(el('p', 'egl-ph-note egl-ph-recognition-warning', explanation));
        if (practiceWord && textarea.value.trim().split(/\s+/).length > 1) observed.append(button('ลองฝึกคำนี้ในประโยคเดิม', () => {
          backToSentence();
          setStatus('กลับมาฝึกประโยคด้านบนแล้ว · กดบันทึกใหม่ รอ “เริ่มพูดได้” แล้วพูดทั้งประโยคตามธรรมชาติ');
          recordButton.focus();
        }, 'egl-ph-button', observedListeners));
      }
      if (practicePhone) observed.append(el('p', 'egl-ph-note', 'ผลนี้เปรียบเทียบเฉพาะเสียงที่เลือก ไม่ใช่ผลของทั้งคำ · เสียงเดี่ยวที่สั้นมากอาจตรวจไม่พบ'));
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
          const percent = uncertain ? null : percentage(word, relevant), index = wordItems.length;
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
      if (uncertain) details.append(el('p', 'egl-ph-note', 'หน่วยเสียงที่แสดงด้านบนเป็นผลคาดเดาที่ไม่มั่นคง จึงไม่นำมาให้เปอร์เซ็นต์หรือแนะนำว่าออกเสียงส่วนใดผิด'));
      const limits = Array.isArray(data.limitations) ? data.limitations : [];
      if (limits.length) {
        const list = el('ul', 'egl-ph-limitations');
        limits.slice(0, 8).forEach(item => list.append(el('li', '', item)));
        details.append(list);
      }
      observed.append(details);
      observed.hidden = false;
      resultPlaceholder.hidden = true;
      setStatus(uncertain ? issue === 'insufficient_audio_signal'
        ? 'สัญญาณเสียงยังไม่เพียงพอ จึงยังให้เปอร์เซ็นต์ไม่ได้ · กดฟังไฟล์แล้วลองบันทึกเมื่อขึ้น “เริ่มพูดได้”'
        : 'ระบบยังแยกหน่วยเสียงได้ไม่มั่นคง จึงยังให้เปอร์เซ็นต์ไม่ได้ · ฟังเทียบหรือลองฝึกในประโยคได้'
        : demoMode && data.precomputed === true ? 'ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้ · แตะคำเพื่อดูรายละเอียด' : 'วิเคราะห์จากไฟล์เสียงแล้ว แตะคำเพื่อฟังและเปรียบเทียบด้วยตัวเอง', uncertain);
      if (wordItems.length) selectWord(0);
      notifyHost('onAnalysis', { data, clipKind, target: data.reference && data.reference.text || '', clipId });
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
    }, 'กำลังเตรียมคำอ่าน…', true));
    const listenExample = button('ฟังประโยคตัวอย่าง', () => playExample(null, true));
    listenButtons.push(listenExample);
    const exampleCaption = el('p', 'egl-ph-note egl-ph-example-caption');
    controls.append(textButton, listenExample);
    const expected = el('section', 'egl-ph-reference'); expected.hidden = true;
    expected.id = id + '-reference';
    textButton.setAttribute('aria-controls', expected.id);
    textButton.setAttribute('aria-expanded', 'false');
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
    const wordPracticeHint = el('p', 'egl-ph-note', 'คำเดี่ยวมีช่วงเสียงให้ระบบใช้สั้น และโมเดลอาจแยกเสียงพลาดได้ ฟังเทียบกับคำตัวอย่าง หรือกลับไปฝึกคำนี้ในประโยคเดิมได้ ไม่ต้องลากเสียงหรือพูดซ้ำหลายครั้ง');
    wordPracticeHint.hidden = true;
    targetBanner.append(targetText, wordPracticeHint, button('กลับไปฝึกทั้งประโยค', backToSentence, 'egl-ph-button egl-ph-return'));
    const soundTarget = el('div', 'egl-ph-sound-target'); soundTarget.hidden = true; targetBanner.append(soundTarget);
    const recordHint = el('p', 'egl-ph-record-hint', 'พูดประโยคด้านบนให้จบ แล้วกดหยุด');
    const audioControls = el('div', 'egl-ph-actions');
    const sources = Array.isArray(options.audioSources) ? options.audioSources : [];
    sources.forEach((source, index) => {
      if (!source || typeof source.url !== 'string') return;
      const sourceLabel = String(source.label || String.fromCharCode(65 + index));
      const node = button('วิเคราะห์เสียง ' + sourceLabel, () => {
        if (practiceWord) { practiceWord = null; practicePhone = null; updateTarget(); }
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
      if (!clip) { setStatus('เลือกไฟล์หรือบันทึกเสียงก่อน', true); return; }
      const selected = clip;
      if (demoMode) {
        if (!browserEngine()) { setStatus(unsupportedBrowserNotice, true); return; }
        request((values, signal, current) => analyzeInBrowser(selected, values, signal, current), 'กำลังเตรียมการวิเคราะห์ในเบราว์เซอร์…');
      } else request((values, signal) => upload(selected, values, signal));
    });
    const cancelBrowserButton = button('ยกเลิกการวิเคราะห์', () => {
      cancelRequest(); setStatus('ยกเลิกการวิเคราะห์ในเบราว์เซอร์แล้ว');
    });
    cancelBrowserButton.hidden = true;
    const recordingControls = el('div', 'egl-ph-actions'); recordingControls.append(recordButton, analyzeButton, cancelBrowserButton);
    const uploadDetails = el('details', 'egl-ph-technical egl-ph-upload');
    uploadDetails.append(el('summary', '', 'หรือเลือกไฟล์เสียง'), fileLabel);
    ownPanel.append(recordHint, recordingControls, uploadDetails);
    const browserNotice = demoMode ? el('p', 'egl-ph-note egl-ph-demo-learner-notice') : null;
    if (browserNotice) ownPanel.append(browserNotice);
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
      el('p', 'egl-ph-note', demoMode ? 'ไม่เกิน 15 วินาที / 10 MB · ขอใช้เฉพาะไมโครโฟนเมื่อกดบันทึก ไม่ใช้กล้อง · ไฟล์เสียงอยู่ในเบราว์เซอร์ กดดูผลจึงเริ่มวิเคราะห์' : 'ไม่เกิน 15 วินาที / 10 MB · เตรียมไฟล์เพื่อฟังในเบราว์เซอร์ หรือบริการในเครื่องเมื่อจำเป็น · กดดูผลเพื่อวิเคราะห์เสียง'), chosen, durationText, selfAudioControls, player);
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
      stopTracks();
      recorder = null; recording = false; requestingMic = false;
      if (!disposed) updateButtons();
    }
    function stopTracks() {
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      if (recorder && recorder.release) recorder.release();
      closeContext(captureContext); captureContext = null;
      if (recordTimer !== null) win.clearTimeout(recordTimer);
      recordTimer = null;
    }
    async function record() {
      if (recording && recorder) { if (recorder.state !== 'inactive') recorder.stop(); return; }
      if (requestingMic || preparing || disposed) return;
      const Context = win.AudioContext || win.webkitAudioContext;
      if (!win.navigator.mediaDevices || !win.navigator.mediaDevices.getUserMedia || (!win.MediaRecorder && !(Context && win.AudioWorkletNode))) {
        setStatus('เบราว์เซอร์นี้ยังบันทึกเสียงไม่ได้ เลือกไฟล์เสียงแทนได้ครับ', true); return;
      }
      cancelRequest();
      stopExample(); stopPlayback();
      doc.querySelectorAll('audio, video').forEach(media => media.pause());
      requestingMic = true; updateButtons();
      setStatus('กำลังเปิดไมโครโฟน… รอข้อความ “เริ่มพูดได้” ก่อนครับ');
      const attempt = ++recordingVersion;
      const current = () => !disposed && attempt === recordingVersion;
      let context = null, resumed = null;
      try {
        // iOS needs resume() in the tap handler, before microphone permission
        // or module loading yields away the user activation.
        if (Context && win.AudioWorkletNode) {
          try {
            context = new Context(); captureContext = context;
            if (!context.audioWorklet || !context.audioWorklet.addModule) throw new Error('AudioWorklet unavailable');
            resumed = Promise.resolve(context.resume()).then(() => true, () => false);
          } catch (_) {
            closeContext(context); captureContext = null; context = null;
          }
        }
        const acquired = await win.navigator.mediaDevices.getUserMedia({ audio: true });
        if (!current()) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        let active = null;
        if (context) {
          try {
            if (!await resumed || context.state !== 'running') throw new Error('Microphone AudioContext could not resume');
            if (!current()) return;
            const moduleURL = new win.URL('microphone-processor.js' + (runtimeScriptURL ? new win.URL(runtimeScriptURL).search : ''), runtimeScriptURL || doc.baseURI).href;
            active = await pcmRecorder(win, context, acquired, moduleURL, current);
          } catch (error) {
            closeContext(context);
            if (captureContext === context) captureContext = null;
            if (!current()) return;
          }
        }
        if (!active) {
          if (!win.MediaRecorder) throw new Error('No microphone recorder available');
          const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
          const mimeType = types.find(type => win.MediaRecorder.isTypeSupported && win.MediaRecorder.isTypeSupported(type));
          active = new win.MediaRecorder(stream, mimeType ? { mimeType: mimeType } : undefined);
          // Native recorders acknowledge start asynchronously. Older wrappers
          // without an onstart event keep their existing synchronous contract.
          if ('onstart' in active) {
            const native = active, nativeStart = native.start.bind(native);
            let timer = null, rejectReady = null;
            const settle = error => {
              if (timer !== null) win.clearTimeout(timer);
              timer = null; native.onstart = null;
              const reject = rejectReady; rejectReady = null;
              if (error && reject) reject(error);
            };
            native.start = () => new Promise((resolve, reject) => {
              rejectReady = reject;
              native.onstart = () => { settle(); resolve(); };
              timer = win.setTimeout(() => {
                const error = friendly('ไมโครโฟนยังไม่พร้อม ลองกดบันทึกใหม่แล้วรอข้อความ “เริ่มพูดได้” ก่อนครับ');
                settle(error);
                if (native.onerror) native.onerror(error);
              }, 2000);
              try { nativeStart(); } catch (error) { settle(error); }
            });
            native.release = () => settle(new win.DOMException('Recording canceled', 'AbortError'));
          }
        }
        recorder = active;
        let startedAt = null, stoppedAt = null;
        const stop = active.stop.bind(active);
        active.stop = () => {
          if (active.state === 'recording' && stoppedAt === null) stoppedAt = win.performance.now();
          if (current()) { preparing = true; updateButtons(); setStatus('กำลังเตรียมเสียงให้ฟัง…'); }
          return stop();
        };
        const chunks = [];
        active.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
        active.onerror = () => {
          if (disposed || attempt !== recordingVersion) return;
          active.onstop = null; active.ondataavailable = null; active.onerror = null;
          if (active.state !== 'inactive') { try { active.stop(); } catch (_) {} }
          stopTracks(); recording = false; recorder = null; requestingMic = false; preparing = false; updateButtons();
          setStatus('บันทึกเสียงไม่สำเร็จ ลองอีกครั้งหรือเลือกไฟล์เสียง', true);
        };
        active.onstop = async () => {
          if (disposed || attempt !== recordingVersion) return;
          if (stoppedAt === null) stoppedAt = win.performance.now();
          stopTracks(); recording = false; recorder = null;
          preparing = true;
          const preparation = new win.AbortController(); prepareController = preparation;
          service.hidden = true; updateButtons(); setStatus('กำลังเตรียมเสียงให้ฟัง…');
          try {
            const blob = active.prepared ? null : new win.Blob(chunks, { type: active.mimeType || 'audio/webm' });
            const prepared = active.prepared || await prepareRecording(blob, attempt, preparation.signal);
            assertPreparing(attempt, preparation.signal);
            const elapsed = ((stoppedAt === null ? win.performance.now() : stoppedAt) - startedAt) / 1000;
            if (elapsed - prepared.duration > Math.max(0.75, elapsed * 0.35)) {
              throw friendly('เสียงที่บันทึกขาดหายหรือไมโครโฟนหยุดทำงาน ลองบันทึกใหม่โดยเปิดหน้านี้ค้างไว้ หรือเลือกไฟล์เสียงแทน');
            }
            setClip(prepared.blob, 'เสียงที่คุณบันทึก', 'recorded', prepared);
            const quiet = prepared.rmsDbfs < -55;
            setStatus('บันทึกแล้ว ' + prepared.duration.toFixed(2) + ' วินาที · ' + (quiet ? 'เสียงเบามาก ลองกดฟังหรือบันทึกใกล้ไมโครโฟนขึ้น' : 'กด “ฟังเสียงของฉัน” เพื่อลองฟัง'), quiet);
          } catch (error) {
            if (!disposed && attempt === recordingVersion && error.name !== 'AbortError') {
              clearClip();
              setStatus(error.userMessage || (demoMode ? 'เดโมนี้ยังเตรียมไฟล์เสียงให้เล่นไม่ได้ ลองเลือกไฟล์ WAV หรือเปิดรุ่นในเครื่อง' : 'ยังเตรียมเสียงให้เล่นไม่ได้ ลองบันทึกใหม่ หรือเปิดบริการเสียงในเครื่องแล้วลองอีกครั้ง'), true);
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
        const ready = active.start();
        clearClip();
        if (ready && typeof ready.then === 'function') await ready;
        if (!current()) return;
        startedAt = win.performance.now();
        requestingMic = false; recording = true; updateButtons();
        setStatus('เริ่มพูดได้… กำลังบันทึกเสียง กดหยุดเมื่อพูดจบ (หยุดอัตโนมัติภายใน 15 วินาที)');
        recordTimer = win.setTimeout(() => { if (active.state !== 'inactive') active.stop(); }, 14500);
      } catch (error) {
        if (disposed || attempt !== recordingVersion || error.name === 'AbortError') return;
        if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
        stopTracks(); requestingMic = false; recording = false; preparing = false;
        recorder = null;
        updateButtons();
        setStatus(error.userMessage || (error.name === 'NotAllowedError' ? 'ยังไม่ได้อนุญาตไมโครโฟน คุณเลือกไฟล์เสียงแทนได้ครับ' : 'เปิดไมโครโฟนไม่สำเร็จ ลองใหม่หรือเลือกไฟล์เสียง'), true);
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
    on(doc, 'play', event => {
      if (event.target !== examplePlayer && event.target && event.target.tagName === 'AUDIO') stopExample();
    }, true);

    function cleanup() {
      if (disposed) return;
      disposed = true; version += 1; recordingVersion += 1;
      if (controller) controller.abort();
      stopCapture(); stopPlayback(); stopExample();
      referenceListeners.splice(0).forEach(remove => remove());
      observedListeners.splice(0).forEach(remove => remove());
      inspectorListeners.splice(0).forEach(remove => remove());
      soundListeners.splice(0).forEach(remove => remove());
      spellingRefreshers.clear();
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
