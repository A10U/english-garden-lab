/* Same-origin local development bridge; never a production endpoint. */
import { ACOUSTIC_PATH, ACOUSTIC_BODY_LIMIT, ACOUSTIC_WORK_TIMEOUT, acousticFailure, acousticProblem,
  acousticRequestProblem, isAcousticLoopbackHost, createAcousticMeasureService } from '../../server/acoustic-measure.mjs';

const loopbackAddress = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
function headers(request) {
  const result = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach(item => result.append(key, item));
    else if (typeof value === 'string') result.set(key, value);
  }
  return result;
}
function bodyBytes(request, signal) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], done = false;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); signal.removeEventListener('abort', cancel); };
    const finish = (failure, body) => {
      if (done) return; done = true; cleanup();
      if (failure) { request.pause(); chunks = []; reject(failure); } else resolve(body);
    };
    const data = chunk => { size += chunk.length; if (size > ACOUSTIC_BODY_LIMIT) finish(acousticProblem('audio_too_large')); else chunks.push(chunk); };
    const end = () => finish(null, Buffer.concat(chunks, size));
    const error = () => finish(acousticProblem('invalid_request'));
    const aborted = () => finish(acousticProblem('analysis_cancelled'));
    const cancel = () => finish(acousticProblem(signal.reason?.name === 'TimeoutError' ? 'analysis_timeout' : 'analysis_cancelled'));
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
async function send(response, result, close = false) {
  if (response.destroyed) return;
  response.statusCode = result.status; result.headers.forEach((value, name) => response.setHeader(name, value));
  if (close) response.setHeader('Connection', 'close');
  response.end(Buffer.from(await result.arrayBuffer()));
}

export function acoustics(options = {}) {
  return {
    name: 'egl-dev-acoustics', apply: 'serve',
    config() { return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sites-runtime/**'] } } }; },
    configureServer(vite) {
      const service = createAcousticMeasureService({ root: vite.config.root, configured: options.configured, runner: options.runner, timeoutMs: options.timeoutMs });
      let posting = false;
      vite.middlewares.use(async (request, response, next) => {
        const host = request.headers.host; let url;
        try { url = new URL(request.url || '/', 'http://' + (isAcousticLoopbackHost(host) ? host : 'invalid.local')); } catch { next(); return; }
        if (url.pathname !== ACOUSTIC_PATH) { next(); return; }
        const inputHeaders = headers(request);
        const denied = !isAcousticLoopbackHost(host) || url.origin !== new URL('http://' + host).origin || !loopbackAddress(request.socket.remoteAddress)
          ? acousticProblem('local_only') : acousticRequestProblem(url, request.method, inputHeaders);
        if (denied) { await send(response, acousticFailure(denied), true); return; }
        if (request.method === 'POST' && posting) { await send(response, acousticFailure(acousticProblem('acoustic_busy')), true); return; }
        const length = request.headers['content-length'];
        if (length !== undefined && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > ACOUSTIC_BODY_LIMIT)) {
          await send(response, acousticFailure(acousticProblem('audio_too_large')), true); return;
        }
        if (request.method === 'POST') posting = true;
        const controller = new AbortController();
        const cancel = () => controller.abort(new DOMException('Canceled', 'AbortError'));
        const closed = () => { if (!response.writableEnded) cancel(); };
        request.once('aborted', cancel); response.once('close', closed);
        const timeout = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(ACOUSTIC_WORK_TIMEOUT, options.timeoutMs)) : ACOUSTIC_WORK_TIMEOUT;
        const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
        try {
          const body = request.method === 'POST' ? await bodyBytes(request, controller.signal) : undefined;
          const webRequest = new Request(url, { method: request.method, headers: inputHeaders, ...(body ? { body } : {}), signal: controller.signal });
          await send(response, await service.handle(webRequest));
        } catch (error) { await send(response, acousticFailure(error), true); }
        finally {
          clearTimeout(timer); request.off('aborted', cancel); response.off('close', closed);
          if (request.method === 'POST') posting = false;
        }
      });
    },
  };
}
