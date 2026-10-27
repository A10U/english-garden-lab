/* Browser-only learner audio analysis. Model downloads start on analyze(), never page load. */
(function (root) {
  'use strict';
  const scriptURL = root.document && root.document.currentScript && root.document.currentScript.src;
  const workerURL = scriptURL ? new URL('browser-phonetics-worker.js' + new URL(scriptURL).search, scriptURL).href : null;
  let worker = null, pending = null, sequence = 0;
  function friendly(message) { const error = new Error(message); error.userMessage = message; return error; }
  function aborted() { return new root.DOMException('Analysis canceled', 'AbortError'); }
  function checkAbort(signal) { if (signal && signal.aborted) throw aborted(); }
  function waitFor(promise, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (done, value) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', cancel);
        done(value);
      };
      const cancel = () => finish(reject, aborted());
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      // Keep both handlers attached even after cancellation. An old native
      // promise may settle much later; its rejection must still be handled.
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
      if (signal && signal.aborted) cancel();
    });
  }
  function supported() { return Boolean(workerURL && root.Worker && root.WebAssembly && (root.AudioContext || root.webkitAudioContext)); }
  function stopWorker() { if (worker) worker.terminate(); worker = null; }
  function getWorker() {
    if (worker) return worker;
    const created = new root.Worker(workerURL);
    worker = created;
    created.onmessage = event => {
      if (worker !== created) return;
      const message = event.data || {}, job = pending;
      if (!job || message.id !== job.id) return;
      if (message.type === 'progress') { if (job.onProgress) job.onProgress(message.message); }
      else if (message.type === 'result') job.resolve(message.result);
      else if (message.type === 'error') { job.reject(friendly(message.message || 'วิเคราะห์เสียงไม่สำเร็จ กรุณาลองใหม่')); stopWorker(); }
    };
    created.onerror = () => {
      if (worker !== created) return;
      if (pending && typeof pending.reject === 'function') pending.reject(friendly('เปิดเครื่องมือวิเคราะห์ไม่ได้ ลองโหลดหน้าใหม่ หรือใช้ Chrome / Edge บนคอมพิวเตอร์'));
      stopWorker();
    };
    created.onmessageerror = () => { if (worker !== created) return; if (pending && typeof pending.reject === 'function') pending.reject(friendly('อ่านผลวิเคราะห์ไม่ได้ กรุณาลองใหม่')); stopWorker(); };
    return worker;
  }
  function pcmWave(bytes) {
    const view = new DataView(bytes);
    const tag = at => String.fromCharCode(...new Uint8Array(bytes, at, 4));
    if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let channels = 0, rate = 0, bits = 0, format = 0, data = 0, length = 0;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const kind = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > bytes.byteLength) return null;
      if (kind === 'fmt ' && size >= 16) { format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); rate = view.getUint32(start + 4, true); bits = view.getUint16(start + 14, true); }
      if (kind === 'data') { data = start; length = size; }
      offset = start + size + size % 2;
    }
    if (format !== 1 || bits !== 16 || channels < 1 || channels > 8 || !rate || !data || length % (channels * 2)) return null;
    const samples = new Float32Array(length / (channels * 2));
    for (let i = 0; i < samples.length; i++) {
      let value = 0;
      for (let c = 0; c < channels; c++) { const raw = view.getInt16(data + (i * channels + c) * 2, true); value += raw / (raw < 0 ? 32768 : 32767); }
      samples[i] = value / channels;
    }
    return { samples, rate };
  }
  async function decode(blob, signal) {
    if (!blob || !blob.size || blob.size > 10 * 1024 * 1024) throw friendly('เลือกเสียงที่ไม่ว่างและขนาดไม่เกิน 10 MB');
    checkAbort(signal);
    const bytes = await waitFor(blob.arrayBuffer(), signal);
    checkAbort(signal);
    let audio = pcmWave(bytes);
    if (!audio) {
      const Context = root.AudioContext || root.webkitAudioContext;
      const context = new Context({ sampleRate: 16000 });
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { const done = context.close(); if (done && done.catch) done.catch(() => {}); } catch (_) {}
      };
      if (signal) signal.addEventListener('abort', close, { once: true });
      try {
        const decoded = await waitFor(context.decodeAudioData(bytes), signal);
        checkAbort(signal);
        if (!decoded.numberOfChannels || !Number.isFinite(decoded.duration) || decoded.duration > 15) throw friendly('เลือกเสียงยาว 0.3 ถึง 15 วินาที');
        const samples = new Float32Array(decoded.length);
        for (let c = 0; c < decoded.numberOfChannels; c++) {
          const channel = decoded.getChannelData(c);
          for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / decoded.numberOfChannels;
        }
        audio = { samples, rate: decoded.sampleRate };
      } catch (error) { checkAbort(signal); throw error.userMessage ? error : friendly('อ่านไฟล์เสียงไม่ได้ ลองอัดใหม่หรือเลือกไฟล์ WAV'); }
      finally { if (signal) signal.removeEventListener('abort', close); close(); }
    }
    const duration = audio.samples.length / audio.rate;
    if (!Number.isFinite(duration) || duration < 0.3 || duration > 15) throw friendly('เลือกเสียงยาว 0.3 ถึง 15 วินาที');
    if (audio.rate !== 16000) {
      const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      if (!Offline) throw friendly('เบราว์เซอร์นี้ยังแปลงเสียงเพื่อวิเคราะห์ไม่ได้ ลองใช้ Chrome / Edge');
      const context = new Offline(1, Math.round(duration * 16000), 16000);
      let source = null, released = false;
      const release = () => {
        if (released) return;
        released = true;
        // OfflineAudioContext has no close(). Release its graph even when a
        // browser never settles startRendering(); late results are ignored.
        if (source) {
          try { if (source.stop) source.stop(); } catch (_) {}
          try { if (source.disconnect) source.disconnect(); } catch (_) {}
          try { source.buffer = null; } catch (_) {}
        }
      };
      if (signal) signal.addEventListener('abort', release, { once: true });
      try {
        const buffer = context.createBuffer(1, audio.samples.length, audio.rate);
        buffer.getChannelData(0).set(audio.samples);
        source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
        const rendered = await waitFor(context.startRendering(), signal);
        checkAbort(signal);
        audio = { samples: new Float32Array(rendered.getChannelData(0)), rate: rendered.sampleRate };
      } finally {
        if (signal) signal.removeEventListener('abort', release);
        release();
      }
    }
    if (audio.rate !== 16000) throw friendly('เบราว์เซอร์แปลงอัตราเสียงไม่สำเร็จ กรุณาลองใหม่');
    return audio.samples;
  }
  async function prepare(blob, signal, releaseReservation) {
    checkAbort(signal);
    const controller = new root.AbortController();
    let timedOut = false, finished = false;
    const cancel = () => controller.abort();
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      if (finished) return;
      timedOut = true; releaseReservation(); controller.abort();
    }, 30000);
    try {
      checkAbort(signal);
      return await decode(blob, controller.signal);
    } catch (error) {
      checkAbort(signal);
      if (timedOut) throw friendly('เตรียมไฟล์เสียงนานเกิน 30 วินาที ลองบันทึกใหม่หรือเลือกไฟล์ WAV แล้วกดดูผลอีกครั้ง');
      throw error;
    } finally {
      finished = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', cancel);
    }
  }
  async function analyze(options) {
    const { blob, text, accent, reference, signal, onProgress } = options || {};
    if (!supported()) throw friendly('เครื่องมือวิเคราะห์บนเว็บต้องใช้เบราว์เซอร์ที่รองรับ WebAssembly และ Web Worker เช่น Chrome / Edge บนคอมพิวเตอร์');
    if (pending) throw friendly('กำลังวิเคราะห์เสียงอีกไฟล์อยู่ กรุณารอสักครู่');
    if (!reference || reference.text !== text || reference.accent !== accent || !Array.isArray(reference.words) || !reference.words.length || reference.words.some(word => !Array.isArray(word.phones) || !word.phones.length)) throw friendly('ยังไม่มีคำอ่านอ้างอิงสำหรับประโยคหรือสำเนียงนี้ ลองใช้ประโยคที่เตรียมไว้และสำเนียง US');
    checkAbort(signal);
    // Reserve before decoding too, so simultaneous widgets cannot overlap.
    const reservation = {}; pending = reservation;
    const releaseReservation = () => { if (pending === reservation) pending = null; };
    if (signal) signal.addEventListener('abort', releaseReservation, { once: true });
    try {
      if (onProgress) onProgress('กำลังเตรียมเสียงสำหรับวิเคราะห์ในเบราว์เซอร์…');
      const samples = await prepare(blob, signal, releaseReservation);
      checkAbort(signal);
      return await new Promise((resolve, reject) => {
        const id = ++sequence;
        let timer;
        const abort = () => { stopWorker(); finish(reject, aborted()); };
        const finish = (done, value) => {
          if (!pending || pending.id !== id) return;
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abort);
          pending = null; done(value);
        };
        pending = { id, onProgress, resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
        timer = setTimeout(() => { stopWorker(); finish(reject, friendly('การวิเคราะห์ใช้เวลานานเกินไป ลองคลิปสั้นลงแล้วกดดูผลอีกครั้ง')); }, 10 * 60 * 1000);
        if (signal) signal.addEventListener('abort', abort, { once: true });
        try { checkAbort(signal); getWorker().postMessage({ id, samples, reference }, [samples.buffer]); }
        catch (error) { stopWorker(); finish(reject, error); }
      });
    } finally {
      if (signal) signal.removeEventListener('abort', releaseReservation);
      releaseReservation();
    }
  }
  root.EGLBrowserPhonetics = Object.freeze({ supported, analyze });
})(globalThis);
