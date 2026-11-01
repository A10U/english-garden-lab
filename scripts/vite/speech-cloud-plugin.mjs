/* Server-side development bridge only. Never mounts in a production build. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createPracticeCloudService, localRequestProblem, isLoopbackHost, PRACTICE_CLOUD_PATH, PRACTICE_AUDIO_LIMIT } from '../../server/practice-cloud.mjs';

const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_TRANSCRIBE_MODEL', 'OPENAI_SPEAK_MODEL'];
const BODY_LIMIT = PRACTICE_AUDIO_LIMIT + 16 * 1024;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export function loadDevSpeechCloudEnv(root, inherited = process.env) {
  let file = {};
  try { file = parseEnv(readFileSync(path.join(root, '.env.speech-cloud'), 'utf8')); } catch {}
  const result = {};
  for (const key of ENV_KEYS) if (typeof (file[key] ?? inherited[key]) === 'string') result[key] = file[key] ?? inherited[key];
  return result;
}
function loopbackAddress(address) { return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'; }
function nodeHeaders(request) {
  const result = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach(item => result.append(name, item));
    else if (typeof value === 'string') result.set(name, value);
  }
  return result;
}
function inputFailure(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function requestBody(request, signal) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); signal.removeEventListener('abort', cancel);
    };
    const fail = failure => { cleanup(); request.pause(); reject(failure); };
    const data = chunk => {
      total += chunk.length;
      if (total > BODY_LIMIT) { fail(inputFailure(413, 'audio_too_large', 'ไฟล์เสียงต้องไม่เกิน 10 MB')); return; }
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, total)); };
    const error = () => fail(inputFailure(400, 'invalid_input', 'อ่านไฟล์เสียงที่ส่งมาไม่ได้'));
    const aborted = () => fail(inputFailure(499, 'request_aborted', 'ยกเลิกการวิเคราะห์แล้ว'));
    const cancel = () => fail(signal.reason?.name === 'TimeoutError'
      ? inputFailure(504, 'cloud_timeout', 'คำขอใช้เวลานานเกิน 45 วินาที') : inputFailure(499, 'request_aborted', 'ยกเลิกการวิเคราะห์แล้ว'));
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
function sendFailure(response, failure) {
  if (response.destroyed) return;
  const messages = { local_only: 'บริการนี้ใช้ได้จากหน้า dev ในเครื่องเท่านั้น', origin_not_allowed: 'คำขอนี้ไม่ได้มาจากหน้า dev เดียวกัน',
    cloud_busy: 'กำลังวิเคราะห์อีกคลิป กรุณารอให้เสร็จก่อน', audio_too_large: 'ไฟล์เสียงต้องไม่เกิน 10 MB',
    invalid_input: 'อ่านไฟล์เสียงที่ส่งมาไม่ได้', request_aborted: 'ยกเลิกการวิเคราะห์แล้ว', cloud_timeout: 'คำขอใช้เวลานานเกิน 45 วินาที' };
  const known = Object.hasOwn(messages, failure?.code);
  response.statusCode = known && Number.isInteger(failure.status) ? failure.status : 502;
  for (const [name, value] of Object.entries(JSON_HEADERS)) response.setHeader(name, value);
  response.setHeader('Connection', 'close');
  response.end(JSON.stringify({ error: { code: known ? failure.code : 'cloud_unavailable', message: known ? messages[failure.code] : 'ยังติดต่อบริการ Cloud ไม่สำเร็จ' } }));
}

export function speechCloud(options = {}) {
  return {
    name: 'egl-dev-speech-cloud',
    apply: 'serve',
    config() { return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sites-runtime/**'] } } }; },
    configureServer(vite) {
      // This is intentionally the only environment-file read. Importing this
      // plugin or running a production build never reads personal credentials.
      const env = options.env ?? (options.loadEnv || loadDevSpeechCloudEnv)(vite.config.root);
      const service = createPracticeCloudService(env, { fetch: options.fetch, timeoutMs: options.timeoutMs, maxCalls: options.maxCalls });
      let posting = false;
      vite.middlewares.use(async (request, response, next) => {
        const host = request.headers.host;
        let url;
        try { url = new URL(request.url || '/', 'http://' + (isLoopbackHost(host) ? host : 'invalid.local')); }
        catch { next(); return; }
        if (url.pathname !== PRACTICE_CLOUD_PATH) { next(); return; }
        const headers = nodeHeaders(request);
        const denied = !isLoopbackHost(host) || url.origin !== new URL('http://' + host).origin || !loopbackAddress(request.socket.remoteAddress)
          ? inputFailure(403, 'local_only', 'บริการนี้ใช้ได้จากหน้า dev ในเครื่องเท่านั้น')
          : localRequestProblem(url, request.method, headers);
        if (denied) { sendFailure(response, denied); return; }
        if (request.method === 'POST' && posting) { sendFailure(response, inputFailure(409, 'cloud_busy', 'กำลังวิเคราะห์อีกคลิป กรุณารอให้เสร็จก่อน')); return; }
        const length = request.headers['content-length'];
        if (length !== undefined && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > BODY_LIMIT)) {
          sendFailure(response, inputFailure(413, 'audio_too_large', 'ไฟล์เสียงต้องไม่เกิน 10 MB')); return;
        }
        if (request.method === 'POST') posting = true;
        const controller = new AbortController();
        const cancel = () => controller.abort(new DOMException('Canceled', 'AbortError'));
        const closed = () => { if (!response.writableEnded) cancel(); };
        request.once('aborted', cancel); response.once('close', closed);
        const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(45000, options.timeoutMs)) : 45000);
        try {
          const body = request.method === 'POST' ? await requestBody(request, controller.signal) : undefined;
          const webRequest = new Request(url, { method: request.method, headers, ...(body ? { body } : {}), signal: controller.signal });
          const result = await service.handle(webRequest);
          if (response.destroyed) return;
          response.statusCode = result.status;
          result.headers.forEach((value, name) => response.setHeader(name, value));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch (failure) { sendFailure(response, failure); }
        finally {
          clearTimeout(timer); request.off('aborted', cancel); response.off('close', closed);
          if (request.method === 'POST') posting = false;
        }
      });
    },
  };
}
