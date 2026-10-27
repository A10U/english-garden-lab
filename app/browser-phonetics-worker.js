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
// A conservative recognition diagnostic, not a calibrated probability that a
// pronunciation is correct. Blank CTC frames describe silence/timing and must
// not increase this average. Keep raw phone alignment separate from this flag.
const TOKEN_POSTERIOR_THRESHOLD = 0.65;
// Supported English units mirror phone-guide.js, independently of the current
// target word. Common phonetic variants are included for recognition only:
// this does not make e.g. /ɪ/ and /iː/ equivalent in the actual alignment.
const ENGLISH_PHONE_UNITS = [
  ...('iː i ɪ e ɛ æ ɑː ɑ ɔː ɔ ɒ ʊ uː u ʌ ə ɐ ɜː ɚ ɝ a o eː oː '
    + 'eɪ aɪ ɔɪ əʊ oʊ aʊ ɪə iə eə ʊə p b t d k ɡ f v θ ð s z ʃ ʒ tʃ dʒ '
    + 'm n ŋ h l ɹ r w j ɫ ɾ əl l̩ n̩ ɑːɹ ɑɹ ɔːɹ ɔɹ oːɹ ɪɹ ɛɹ ʊɹ aɪɚ aʊɚ').split(' '),
  // Glottal/aspirated stops, reduced vowels, retroflex r, and vowel-length
  // variants can occur in English without being separate learner targets.
  ...'ʔ pʰ tʰ kʰ ᵻ ɜ ɻ ɝː əː æː ɛː ɪː ʊː'.split(' '),
].sort((a, b) => b.length - a.length);
const UNSUPPORTED_PHONE_NOTICE = 'หน่วยเสียงที่ตรวจพบบางส่วนอยู่นอกชุดเสียงอังกฤษที่เครื่องมือนี้รองรับ จึงยังใช้ประเมินไม่ได้ ไม่ได้ยืนยันว่าผู้พูดออกเสียงผิด';

function supportedEnglishPhone(phone) {
  const symbol = alignment.canonical_phone(phone);
  let at = 0, units = 0;
  // Composite CTC tokens such as /ts/ or /aɪə/ remain supported when every
  // component is supported. Tonal/non-English tokens are never rewritten.
  while (at < symbol.length && units < 4) {
    const part = ENGLISH_PHONE_UNITS.find(unit => symbol.startsWith(unit, at));
    if (!part) return false;
    at += part.length; units++;
  }
  return units > 0 && at === symbol.length;
}

function readLogits(logits) {
  const dims = logits && logits.dims;
  if (!Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1
    || !Number.isSafeInteger(dims[1]) || dims[1] <= 0 || dims[2] !== 392
    || !logits.data || logits.data.length !== dims[1] * dims[2]) {
    throw new Error('ผลลัพธ์จากโมเดลไม่ถูกต้อง กรุณาลองวิเคราะห์ใหม่');
  }
  const [, frames, width] = dims, values = logits.data, ids = new Array(frames);
  let posteriorSum = 0, nonblankFrames = 0;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * width;
    let best = 0;
    for (let token = 0; token < width; token++) {
      if (!Number.isFinite(values[offset + token])) throw new Error('ผลลัพธ์จากโมเดลมีค่าที่ไม่ถูกต้อง กรุณาลองวิเคราะห์ใหม่');
      if (values[offset + token] > values[offset + best]) best = token;
    }
    ids[frame] = best;
    if (best !== model.blankId) {
      // Stable softmax: subtract the maximum before exponentiating.
      const maximum = values[offset + best];
      let total = 0;
      for (let token = 0; token < width; token++) total += Math.exp(values[offset + token] - maximum);
      posteriorSum += 1 / total;
      nonblankFrames++;
    }
  }
  const mean = nonblankFrames ? posteriorSum / nonblankFrames : null;
  const uncertain = mean === null || mean < TOKEN_POSTERIOR_THRESHOLD;
  return { ids, quality: {
    status: uncertain ? 'uncertain' : 'recognized',
    mean_token_posterior: mean === null ? null : Number(mean.toFixed(6)),
    nonblank_frames: nonblankFrames, threshold: TOKEN_POSTERIOR_THRESHOLD,
    reason: uncertain ? (mean === null ? 'no_nonblank_frames' : 'low_token_posterior') : null,
    calibrated: false,
  } };
}

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
      const { ids, quality } = readLogits(outputs && outputs.logits);
      const observed = alignment.decode_ctc_segments(ids, vocabulary, {
        blank_id: model.blankId, duration_seconds: metrics.duration_seconds, frame_seconds: model.frameSeconds,
      });
      const unsupported = [...new Set(observed.map(item => item.phone).filter(phone => !supportedEnglishPhone(phone)))];
      quality.unsupported_tokens = unsupported;
      quality.inventory_scope = 'app_supported_english_phones';
      if (unsupported.length) {
        // A multilingual token can have a high posterior and still be unusable
        // for this English tool. Preserve the raw output, never force a target.
        quality.status = 'uncertain'; quality.reason = 'unsupported_english_tokens';
        quality.limitation = UNSUPPORTED_PHONE_NOTICE;
      }
      const result = alignment.composeAnalysis(reference, observed, metrics);
      if (unsupported.length) result.limitations.push(UNSUPPORTED_PHONE_NOTICE);
      self.postMessage({ id, type: 'result', result: {
        ...result, precomputed: false, live_analysis: true, playback_source: 'learner_recording',
        recognition_quality: quality,
        processing: 'browser_wasm', model: { id: model.modelId, revision: model.revision, quantization: 'q8' },
      } });
    } finally {
      if (input.dispose) input.dispose();
      if (outputs) Object.values(outputs).forEach(tensor => { if (tensor && tensor.dispose) tensor.dispose(); });
    }
  } catch (error) {
    const thai = error && /[\u0e00-\u0e7f]/.test(error.message || '');
    self.postMessage({ id, type: 'error', message: thai ? error.message : 'ยังวิเคราะห์เสียงไม่ได้ ลองใช้ Chrome หรือ Edge บนคอมพิวเตอร์ ปิดแท็บที่ไม่ใช้ แล้วลองคลิปสั้นลง' });
  } finally { active = false; }
};
