/* Acoustic phoneme recognition runs in this worker. Audio is never uploaded. */
'use strict';
importScripts('vendor/onnxruntime/ort.wasm.min.js', 'phonetic-alignment.js', 'browser-phoneme-model.js');
const model = self.EGLBrowserPhonemeModel;
const alignment = self.EGLPhoneticAlignment;
const vocabulary = Object.fromEntries(Object.entries(model.vocab).map(([phone, id]) => [id, phone]));
ort.env.wasm.numThreads = 1; // GitHub Pages does not supply cross-origin isolation.
ort.env.wasm.proxy = false; // Already running in a dedicated worker.
ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', self.location.href).href;
ort.env.logLevel = 'error';
let session = null, active = false;

function progress(id, message) { self.postMessage({ id, type: 'progress', message }); }
async function verifiedModel(bytes) {
  if (bytes.byteLength !== model.bytes) throw new Error('ไฟล์โมเดลโหลดไม่ครบ กรุณาลองใหม่');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== model.sha256) throw new Error('ไฟล์โมเดลไม่ผ่านการตรวจสอบ กรุณาลองใหม่');
  return bytes;
}
async function loadModel(id) {
  if (session) return session;
  let cache = null, bytes = null;
  try {
    cache = await self.caches.open('egl-phoneme-model-q8-v1');
    const cached = await cache.match(model.url);
    if (cached) {
      progress(id, 'กำลังเปิดโมเดลที่เก็บไว้ในเบราว์เซอร์…');
      try { bytes = await verifiedModel(await cached.arrayBuffer()); }
      catch (_) { await cache.delete(model.url); }
    }
  } catch (_) { cache = null; }
  if (!bytes) {
    progress(id, 'กำลังดาวน์โหลดโมเดล 318 MB ครั้งแรก…');
    // This is the only external request: a GET of pinned public model weights.
    const response = await fetch(model.url, { credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error('ดาวน์โหลดโมเดลไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    const reader = response.body.getReader(), chunks = [];
    let size = 0, lastUpdate = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > model.bytes) { await reader.cancel(); throw new Error('ขนาดไฟล์โมเดลไม่ถูกต้อง'); }
      chunks.push(value);
      if (Date.now() - lastUpdate > 300) {
        progress(id, 'กำลังโหลดโมเดล ' + Math.floor(size / model.bytes * 100) + '% · ' + (size / 1e6).toFixed(0) + ' / 318 MB');
        lastUpdate = Date.now();
      }
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) { combined.set(chunks[i], offset); offset += chunks[i].byteLength; chunks[i] = null; }
    progress(id, 'โหลดครบแล้ว กำลังตรวจสอบไฟล์โมเดล…');
    bytes = await verifiedModel(combined.buffer);
    if (cache) {
      progress(id, 'กำลังเก็บโมเดลไว้สำหรับฝึกครั้งถัดไป…');
      try { await cache.put(model.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
      catch (_) { /* Low storage must not prevent this analysis. */ }
    }
  }
  progress(id, 'กำลังเปิดเครื่องมือวิเคราะห์เสียงในเบราว์เซอร์…');
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return session;
}

self.onmessage = async event => {
  const { id, samples, reference } = event.data || {};
  if (active) { self.postMessage({ id, type: 'error', message: 'กำลังวิเคราะห์เสียงอีกไฟล์อยู่ กรุณารอสักครู่' }); return; }
  active = true;
  try {
    if (!(samples instanceof Float32Array) || !reference || !Array.isArray(reference.words) || !reference.words.length) throw new Error('ข้อมูลเสียงหรือคำอ่านอ้างอิงไม่ครบ');
    const [audio, metrics] = alignment.waveform_metrics(samples);
    const engine = await loadModel(id);
    progress(id, 'กำลังวิเคราะห์เสียงของคุณ… กด “ยกเลิก” ได้หากต้องการหยุด');
    const input = new ort.Tensor('float32', alignment.normalizeWaveform(audio), [1, audio.length]);
    let outputs;
    try {
      outputs = await engine.run({ input_values: input });
      const logits = outputs.logits;
      if (!logits || logits.dims.length !== 3 || logits.dims[0] !== 1 || logits.dims[2] !== 392) throw new Error('ผลลัพธ์จากโมเดลไม่ถูกต้อง');
      const [batch, frames, width] = logits.dims;
      const ids = new Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let best = 0;
        for (let token = 1; token < width; token++) if (logits.data[frame * width + token] > logits.data[frame * width + best]) best = token;
        ids[frame] = best;
      }
      const observed = alignment.decode_ctc_segments(ids, vocabulary, {
        blank_id: model.blankId, duration_seconds: metrics.duration_seconds, frame_seconds: model.frameSeconds,
      });
      const result = alignment.composeAnalysis(reference, observed, metrics);
      self.postMessage({ id, type: 'result', result: {
        ...result, precomputed: false, live_analysis: true, playback_source: 'learner_recording',
        processing: 'browser_wasm', model: { id: model.modelId, revision: model.revision, quantization: 'q8' },
      } });
    } finally {
      if (input.dispose) input.dispose();
      if (outputs) Object.values(outputs).forEach(tensor => { if (tensor.dispose) tensor.dispose(); });
    }
  } catch (error) {
    const thai = error && /[\u0e00-\u0e7f]/.test(error.message || '');
    self.postMessage({ id, type: 'error', message: thai ? error.message : 'ยังวิเคราะห์เสียงไม่ได้ ลองใช้ Chrome หรือ Edge บนคอมพิวเตอร์ ปิดแท็บที่ไม่ใช้ แล้วลองคลิปสั้นลง' });
  } finally { active = false; }
};
