/* Local acoustic measurements. No credentials, provider calls or audio retention. */
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const ACOUSTIC_PATH = '/api/acoustics/measure';
export const ACOUSTIC_AUDIO_LIMIT = 10 * 1024 * 1024;
export const ACOUSTIC_BODY_LIMIT = ACOUSTIC_AUDIO_LIMIT + 16 * 1024;
export const ACOUSTIC_WORK_TIMEOUT = 28900; // Leave one second for temporary-file cleanup.
const OUTPUT_LIMIT = 1024 * 1024;
const CLEANUP_GRACE = 1000;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const MESSAGES = {
  local_only: [403, 'เครื่องมือวัดเสียงนี้ใช้ได้จากหน้า dev ในเครื่องเท่านั้น'],
  origin_not_allowed: [403, 'คำขอนี้ไม่ได้มาจากหน้า dev เดียวกัน'],
  method_not_allowed: [405, 'ใช้ GET เพื่อตรวจความพร้อม หรือ POST เพื่อวัดเสียง'],
  invalid_request: [400, 'ส่งไฟล์ WAV พร้อมช่วงเวลาที่เลือกและการตั้งค่าให้ครบ'],
  invalid_settings: [400, 'การตั้งค่า pitch หรือ formant อยู่นอกช่วงที่รองรับ'],
  audio_too_large: [413, 'ไฟล์เสียงต้องไม่เกิน 10 MB'],
  unsupported_audio: [415, 'ใช้ไฟล์ WAV แบบ PCM16 หรือ float32 สำหรับเครื่องมือนี้'],
  invalid_audio: [422, 'ไฟล์เสียงไม่อยู่ในรูปแบบหรือช่วงความยาวที่เครื่องมือรองรับ'],
  invalid_selection: [422, 'เลือกเวลาเริ่มและเวลาจบให้อยู่ภายในคลิปเสียง'],
  engine_unavailable: [503, 'เครื่องมือ Python หรือ Praat ในเครื่องยังไม่พร้อม'],
  engine_unsupported: [503, 'รุ่นของ Praat ในเครื่องยังไม่รองรับการวัดนี้'],
  acoustic_busy: [409, 'กำลังวัดอีกคลิป กรุณารอให้เสร็จหรือยกเลิกก่อน'],
  analysis_timeout: [504, 'การวัดใช้เวลานานเกินกำหนด กรุณาลองช่วงเสียงสั้นลง'],
  analysis_cancelled: [499, 'ยกเลิกการวัดเสียงแล้ว'],
  analysis_failed: [502, 'เครื่องมือในเครื่องยังวัดเสียงนี้ไม่สำเร็จ'],
  invalid_engine_response: [502, 'ผลการวัดจากเครื่องมือในเครื่องไม่ครบหรือไม่ถูกต้อง'],
};
class AcousticError extends Error {
  constructor(code) { super(MESSAGES[code]?.[1] || MESSAGES.analysis_failed[1]); this.code = Object.hasOwn(MESSAGES, code) ? code : 'analysis_failed'; }
}
export const acousticProblem = code => new AcousticError(code);
const problem = acousticProblem;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
export function acousticFailure(error) {
  const code = error instanceof AcousticError ? error.code : 'analysis_failed';
  return json({ error: { code, message: MESSAGES[code][1] } }, MESSAGES[code][0]);
}
export function isAcousticLoopbackHost(host) {
  if (typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/iu.test(host)) return false;
  try { const url = new URL('http://' + host); return !url.username && !url.password; } catch { return false; }
}
export function acousticRequestProblem(url, method, headers) {
  if (url.protocol !== 'http:' || !isAcousticLoopbackHost(url.host)) return problem('local_only');
  const origin = headers.get('origin');
  if (headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && origin !== url.origin) || (method === 'POST' && origin !== url.origin)) return problem('origin_not_allowed');
  if (!['GET', 'POST'].includes(method)) return problem('method_not_allowed');
  return null;
}
function abortProblem(signal) { return problem(signal.reason?.name === 'TimeoutError' ? 'analysis_timeout' : 'analysis_cancelled'); }
function checkAbort(signal) { if (signal.aborted) throw abortProblem(signal); }
function waitFor(promise, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let done = false, cleanupTimer;
    const finish = (callback, value) => {
      if (done) return; done = true; clearTimeout(cleanupTimer); signal.removeEventListener('abort', abort); callback(value);
    };
    // The default runner terminates its process group and removes temporary
    // files before settling. The bound also handles a broken injected runner.
    const abort = () => { cleanupTimer = setTimeout(() => finish(reject, abortProblem(signal)), CLEANUP_GRACE + 50); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(signal.aborted ? reject : resolve, signal.aborted ? abortProblem(signal) : value), error => finish(reject, signal.aborted ? abortProblem(signal) : error));
    if (signal.aborted) abort();
  });
}
async function boundedBody(request, signal) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > ACOUSTIC_BODY_LIMIT)) throw problem('audio_too_large');
  if (!request.body) throw problem('invalid_request');
  const reader = request.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const next = await waitFor(reader.read(), signal); if (next.done) break;
      total += next.value.byteLength; if (total > ACOUSTIC_BODY_LIMIT) throw problem('audio_too_large');
      chunks.push(next.value);
    }
  } catch (error) { reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function numberField(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64 || !Number.isFinite(Number(value))) throw problem('invalid_selection');
  return Number(value);
}
function settingsField(value) {
  let supplied;
  try { supplied = JSON.parse(value); } catch { throw problem('invalid_settings'); }
  const allowed = ['pitch_floor_hz', 'pitch_top_hz', 'formant_ceiling_hz'];
  if (!record(supplied) || Object.keys(supplied).some(key => !allowed.includes(key)) || Object.values(supplied).some(number => typeof number !== 'number' || !Number.isFinite(number))) throw problem('invalid_settings');
  const result = { pitch_floor_hz: 50, pitch_top_hz: 800, formant_ceiling_hz: 5500, ...supplied };
  if (result.pitch_floor_hz < 40 || result.pitch_floor_hz > 300 || result.pitch_top_hz < 150 || result.pitch_top_hz > 1500
    || result.pitch_top_hz < 2 * result.pitch_floor_hz || result.formant_ceiling_hz < 3500 || result.formant_ceiling_hz > 8000) throw problem('invalid_settings');
  return result;
}
async function inputPayload(request, signal) {
  const type = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*;/iu.test(type)) throw problem('invalid_request');
  const body = await boundedBody(request, signal); checkAbort(signal);
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': type }, body }).formData(); } catch { throw problem('invalid_request'); }
  const allowed = ['audio', 'start_seconds', 'end_seconds', 'settings', 'vowel_confirmed'];
  const entries = [...form.entries()];
  if (entries.length !== allowed.length || new Set(entries.map(([key]) => key)).size !== allowed.length || entries.some(([key]) => !allowed.includes(key))) throw problem('invalid_request');
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || !audio.size) throw problem('invalid_audio');
  if (audio.size > ACOUSTIC_AUDIO_LIMIT) throw problem('audio_too_large');
  for (const key of allowed.slice(1)) if (typeof form.get(key) !== 'string') throw problem('invalid_request');
  const start = numberField(form.get('start_seconds')), end = numberField(form.get('end_seconds'));
  if (start < 0 || end <= start || end > 15) throw problem('invalid_selection');
  const settings = settingsField(form.get('settings'));
  const confirmed = form.get('vowel_confirmed'); if (!['true', 'false'].includes(confirmed)) throw problem('invalid_request');
  const bytes = Buffer.from(await audio.arrayBuffer()); checkAbort(signal);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw problem('unsupported_audio');
  return { audio_base64: bytes.toString('base64'), start_seconds: start, end_seconds: end, settings, vowel_confirmed: confirmed === 'true' };
}
function finiteTree(value, depth = 0) {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => finiteTree(item, depth + 1));
  return record(value) && Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && finiteTree(item, depth + 1));
}
function validatedResult(result, payload) {
  if (record(result?.error)) throw problem(Object.hasOwn(MESSAGES, result.error.code) ? result.error.code : 'analysis_failed');
  const fields = ['schema_version', 'measurement_type', 'source', 'pronunciation_grade', 'input', 'selection', 'engine', 'signal', 'f0', 'formants', 'flags', 'limitations'];
  if (!record(result) || result.schema_version !== 1 || result.measurement_type !== 'acoustic_signal' || result.source !== 'local_praat' || result.pronunciation_grade !== null
    || Object.keys(result).some(key => !fields.includes(key)) || !['input', 'selection', 'engine', 'signal', 'f0', 'formants'].every(key => record(result[key]))
    || Object.keys(result).length !== fields.length || !Array.isArray(result.flags) || !Array.isArray(result.limitations) || !finiteTree(result)) throw problem('invalid_engine_response');
  const { input, selection, engine, signal, f0, formants } = result;
  const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  const frequency = value => value === null || typeof value === 'number' && value > 0 && value <= input.sample_rate_hz / 2;
  const summary = value => ['median_hz', 'q25_hz', 'q75_hz'].every(key => frequency(value[key]));
  const state = value => ['ok', 'unreliable', 'insufficient_interval', 'unavailable'].includes(value.status) && (value.reason === null || typeof value.reason === 'string' && value.reason.length <= 128);
  const metrics = value => record(value) && typeof value.rms_dbfs === 'number' && typeof value.peak === 'number' && value.peak >= 0 && value.peak <= 16
    && typeof value.dc_offset === 'number' && integer(value.samples, input.frames) && value.samples > 0;
  const curve = (rows, keys) => Array.isArray(rows) && rows.length <= 3000 && rows.every((row, index) => record(row)
    && Object.keys(row).length === keys.length + 1 && typeof row.time_seconds === 'number' && row.time_seconds >= 0 && row.time_seconds <= input.duration_seconds + 1e-6
    && (!index || row.time_seconds > rows[index - 1].time_seconds) && keys.every(key => frequency(row[key])));
  if (!integer(input.sample_rate_hz, 96000) || input.sample_rate_hz < 16000 || ![1, 2].includes(input.channels) || !integer(input.frames, 1440000) || !input.frames
    || typeof input.duration_seconds !== 'number' || input.duration_seconds < .2 || input.duration_seconds > 15 || Math.abs(input.duration_seconds - input.frames / input.sample_rate_hz) > 1e-6
    || !['PCM16', 'FLOAT32'].includes(input.encoding) || !['mono', 'arithmetic_mean'].includes(input.channel_handling)
    || input.bytes !== Buffer.from(payload.audio_base64, 'base64').length || !integer(input.input_full_scale_samples, input.frames * input.channels)
    || !integer(selection.start_sample, input.frames) || !integer(selection.end_sample, input.frames) || selection.end_sample <= selection.start_sample
    || !['start_seconds', 'end_seconds', 'duration_ms'].every(key => typeof selection[key] === 'number')
    || selection.start_sample !== Math.floor(payload.start_seconds * input.sample_rate_hz + .5) || selection.end_sample !== Math.floor(payload.end_seconds * input.sample_rate_hz + .5)
    || Math.abs(selection.start_seconds - selection.start_sample / input.sample_rate_hz) > 1e-6 || Math.abs(selection.end_seconds - selection.end_sample / input.sample_rate_hz) > 1e-6
    || Math.abs(selection.duration_ms - 1000 * (selection.end_sample - selection.start_sample) / input.sample_rate_hz) > 1e-6
    || selection.boundary_source !== 'user_selected' || selection.vowel_confirmed !== payload.vowel_confirmed
    || engine.name !== 'Praat' || typeof engine.version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/u.test(engine.version)
    || engine.analysis_context !== 'full_original_sound' || engine.normalization !== 'none' || !record(engine.settings)
    || Object.entries(payload.settings).some(([key, value]) => engine.settings[key] !== value)
    || !metrics(signal.selected) || !metrics(signal.whole_clip) || signal.selected.samples !== selection.end_sample - selection.start_sample || signal.whole_clip.samples !== input.frames
    || !state(f0) || !summary(f0) || !integer(f0.total_frames, 3000) || !integer(f0.voiced_frames, f0.total_frames) || typeof f0.coverage !== 'number' || f0.coverage < 0 || f0.coverage > 1 || !curve(f0.frames, ['value_hz'])
    || !state(formants) || !Array.isArray(formants.tracks) || formants.tracks.length !== 3 || !formants.tracks.every((track, index) => record(track) && track.index === index + 1 && summary(track) && integer(track.valid_frames, 3000))
    || !curve(formants.frames, ['f1_hz', 'f2_hz', 'f3_hz']) || !Array.isArray(formants.sensitivity) || formants.sensitivity.length !== 3
    || !formants.sensitivity.every(row => record(row) && typeof row.ceiling_hz === 'number' && row.ceiling_hz > 0 && Array.isArray(row.medians_hz) && row.medians_hz.length === 3 && row.medians_hz.every(frequency))
    || result.flags.length > 40 || !result.flags.every(value => typeof value === 'string' && value.length <= 128)
    || result.limitations.length > 20 || !result.limitations.every(value => typeof value === 'string' && value.length <= 2000)) throw problem('invalid_engine_response');
  const serialized = JSON.stringify(result); if (Buffer.byteLength(serialized) > OUTPUT_LIMIT) throw problem('invalid_engine_response');
  return result;
}
function trustedPaths(root) {
  return { root, python: path.join(root, 'speech-training/.venv/bin/python'), script: path.join(root, 'speech-training/acoustic_measure.py'), praat: path.join(root, '.build/acoustic-tools/Praat.app/Contents/MacOS/Praat') };
}
function toolsAvailable(paths) {
  try { accessSync(paths.python, constants.X_OK); accessSync(paths.praat, constants.X_OK); return statSync(paths.script).isFile() && statSync(paths.script.replace(/\.py$/u, '.praat')).isFile(); } catch { return false; }
}

export function runAcousticProcess(payload, { signal, paths }) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let child, output = [], total = 0, errorBytes = 0, failure = null, killTimer = null, settled = false;
    const terminate = error => {
      if (!failure) failure = error;
      if (!child?.pid || settled) return;
      child.stdin.destroy();
      const kill = which => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, which); } catch {} };
      kill('SIGTERM');
      if (killTimer === null) killTimer = setTimeout(() => { kill('SIGKILL'); finish(failure); }, CLEANUP_GRACE);
    };
    const abort = () => terminate(abortProblem(signal));
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(killTimer); signal.removeEventListener('abort', abort);
      output = []; if (error) reject(error); else resolve(value);
    };
    try {
      child = spawn(paths.python, [paths.script, '--praat', paths.praat], {
        cwd: paths.root, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1',
          OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', VECLIB_MAXIMUM_THREADS: '1' },
      });
    } catch { finish(problem('engine_unavailable')); return; }
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(problem('engine_unavailable')));
    child.stdout.on('data', chunk => { if (settled) return; total += chunk.length; if (total > OUTPUT_LIMIT) terminate(problem('invalid_engine_response')); else output.push(chunk); });
    child.stderr.on('data', chunk => { if (settled) return; errorBytes += chunk.length; if (errorBytes > 64 * 1024) terminate(problem('analysis_failed')); });
    child.stdin.on('error', () => { if (!failure) terminate(problem('analysis_failed')); });
    child.on('close', code => {
      if (settled) return;
      if (failure) {
        // A leader can exit while a Praat descendant ignores TERM and has no
        // inherited pipes. Keep group escalation alive until it is gone.
        let groupAlive = false;
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0); groupAlive = true; } catch (error) { groupAlive = error.code !== 'ESRCH'; }
        if (!groupAlive) finish(failure);
        return;
      }
      let result;
      try { result = JSON.parse(Buffer.concat(output, total).toString('utf8')); } catch { finish(problem('invalid_engine_response')); return; }
      if (![0, 2].includes(code) || (code === 2 && !record(result?.error))) { finish(problem('analysis_failed')); return; }
      finish(null, result);
    });
    if (signal.aborted) abort();
    else child.stdin.end(JSON.stringify(payload));
  });
}

export function createAcousticMeasureService(options = {}) {
  const paths = trustedPaths(path.resolve(options.root || process.cwd()));
  const configured = options.configured || (() => toolsAvailable(paths));
  const runner = options.runner || runAcousticProcess;
  const timeout = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(ACOUSTIC_WORK_TIMEOUT, options.timeoutMs)) : ACOUSTIC_WORK_TIMEOUT;
  let active = false;
  return { async handle(request) {
    const denied = acousticRequestProblem(new URL(request.url), request.method, request.headers); if (denied) return acousticFailure(denied);
    if (request.method === 'GET') return json({ configured: configured() === true, source: 'local_praat', measurement_type: 'acoustic_signal', pronunciation_grade: null,
      configuration_check: 'executable_files_only', audio_retention: 'memory_and_temporary_processing_only', maximum_audio_bytes: ACOUSTIC_AUDIO_LIMIT, maximum_seconds: 15, timeout_seconds: 30 });
    if (active) return acousticFailure(problem('acoustic_busy'));
    if (configured() !== true) return acousticFailure(problem('engine_unavailable'));
    active = true;
    const controller = new AbortController(), cancel = () => controller.abort(request.signal.reason || new DOMException('Canceled', 'AbortError'));
    request.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
    try {
      if (request.signal.aborted) cancel(); checkAbort(controller.signal);
      const payload = await inputPayload(request, controller.signal); checkAbort(controller.signal);
      const result = await waitFor(runner(payload, { signal: controller.signal, paths }), controller.signal);
      return json(validatedResult(result, payload));
    } catch (error) { return acousticFailure(controller.signal.aborted ? abortProblem(controller.signal) : error); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); active = false; }
  } };
}
