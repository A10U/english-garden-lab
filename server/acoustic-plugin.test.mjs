import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { acoustics } from '../scripts/vite/acoustic-plugin.mjs';
import { ACOUSTIC_BODY_LIMIT } from './acoustic-measure.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function wave() {
  const bytes = Buffer.alloc(32044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); return bytes;
}
function form(start = '.1', end = '.4') {
  const value = new FormData(); value.append('audio', new Blob([wave()], { type: 'audio/wav' }), 'synthetic.wav');
  value.append('start_seconds', start); value.append('end_seconds', end); value.append('settings', '{}'); value.append('vowel_confirmed', 'false'); return value;
}
function result(payload) {
  const start = Math.floor(payload.start_seconds * 16000 + .5), end = Math.floor(payload.end_seconds * 16000 + .5);
  const summary = { median_hz: null, q25_hz: null, q75_hz: null }, metrics = samples => ({ rms_dbfs: -240, peak: 0, dc_offset: 0, samples });
  return { schema_version: 1, measurement_type: 'acoustic_signal', source: 'local_praat', pronunciation_grade: null,
    input: { sample_rate_hz: 16000, channels: 1, frames: 16000, duration_seconds: 1, encoding: 'PCM16', bytes: wave().length, channel_handling: 'mono', input_full_scale_samples: 0 },
    selection: { start_sample: start, end_sample: end, start_seconds: start / 16000, end_seconds: end / 16000, duration_ms: 1000 * (end - start) / 16000, boundary_source: 'user_selected', vowel_confirmed: false },
    engine: { name: 'Praat', version: '7.0.02', settings: payload.settings, analysis_context: 'full_original_sound', normalization: 'none' },
    signal: { selected: metrics(end - start), whole_clip: metrics(16000) },
    f0: { status: 'unavailable', reason: 'low_signal', ...summary, voiced_frames: 0, total_frames: 0, coverage: 0, frames: [] },
    formants: { status: 'unavailable', reason: 'low_signal', tracks: [1, 2, 3].map(index => ({ index, ...summary, valid_frames: 0 })), frames: [], sensitivity: [.9, 1, 1.1].map(factor => ({ ceiling_hz: payload.settings.formant_ceiling_hz * factor, medians_hz: [null, null, null] })) },
    flags: ['low_signal'], limitations: ['Measurements are not pronunciation grades.'] };
}
async function serving(t, options = {}) {
  let middleware;
  const plugin = acoustics({ configured: () => true, runner: async payload => result(payload), ...options });
  plugin.configureServer({ config: { root: '/trusted-not-client-controlled' }, middlewares: { use(callback) { middleware = callback; } } });
  const server = http.createServer((request, response) => middleware(request, response, () => { response.statusCode = 404; response.end('not an acoustic route'); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, url: origin + '/api/acoustics/measure', server, middleware };
}
function rawRequest(app, headers, body = '') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: app.server.address().port, path: '/api/acoustics/measure', method: 'POST', headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error', reject); request.end(body);
  });
}

test('plugin config is serve-only, credential-free and does not execute an engine before an explicit request', () => {
  let runs = 0;
  const plugin = acoustics({ configured: () => { throw Error('configuration must be lazy'); }, runner: () => { runs++; } });
  assert.equal(plugin.apply, 'serve'); assert.ok(plugin.config().server.fs.deny.includes('.env.*'));
  plugin.configureServer({ config: { root: '/does-not-read-environment' }, middlewares: { use() {} } });
  assert.equal(runs, 0);
});

test('real HTTP health is cheap and a completed upload does not cancel delayed local measurement', async t => {
  const calls = [];
  const app = await serving(t, { runner: async (payload, config) => { calls.push(config); await new Promise(resolve => setTimeout(resolve, 15)); return result(payload); } });
  const health = await fetch(app.url); assert.equal(health.status, 200); assert.equal((await health.json()).configured, true); assert.equal(calls.length, 0);
  assert.equal((await fetch(app.origin + '/api/another')).status, 404);
  const response = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form() }); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.source, 'local_praat'); assert.equal(body.pronunciation_grade, null);
  assert.equal(body.f0.median_hz, null, 'unavailable measurement stays null, never zero or a grade');
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, false); assert.match(response.headers.get('cache-control'), /no-store/);
});

test('Host, exact Origin, fetch-site and declared size guards precede buffering or execution', async t => {
  let runs = 0; const app = await serving(t, { runner: () => { runs++; throw Error('/private/audio.wav'); } });
  const port = app.server.address().port;
  for (const headers of [{ Host: 'evil.example', Origin: 'http://evil.example' }, { Host: '127.0.0.1:' + port, Origin: 'http://localhost:' + port },
    { Host: '127.0.0.1:' + port, Origin: app.origin, 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await rawRequest(app, { ...headers, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': ACOUSTIC_BODY_LIMIT + 1 });
    assert.equal(response.status, 403); assert.doesNotMatch(JSON.stringify(response.body), /private|audio\.wav/);
  }
  const response = await rawRequest(app, { Host: '127.0.0.1:' + port, Origin: app.origin, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': ACOUSTIC_BODY_LIMIT + 1 });
  assert.equal(response.status, 413); assert.equal(runs, 0);
});

test('a non-loopback socket is denied even with a forged loopback Host', async t => {
  const app = await serving(t); let sent;
  const request = { url: '/api/acoustics/measure', method: 'GET', headers: { host: 'localhost:5173' }, socket: { remoteAddress: '203.0.113.4' } };
  const response = { destroyed: false, setHeader() {}, end(bytes) { sent = JSON.parse(bytes); } };
  await app.middleware(request, response, () => assert.fail('must reject the acoustic route'));
  assert.equal(response.statusCode, 403); assert.equal(sent.error.code, 'local_only');
});

test('concurrent upload is rejected and browser cancellation releases the slot for a fresh selection', async t => {
  let entered = false, blocked = true, capturedSignal, calls = 0;
  const app = await serving(t, { runner: (payload, config) => {
    calls++; if (!blocked) return Promise.resolve(result(payload)); entered = true; capturedSignal = config.signal;
    return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => reject(Error('redact cancellation')), { once: true }));
  } });
  const controller = new AbortController(), pending = fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form(), signal: controller.signal }).catch(error => error);
  for (let i = 0; i < 80 && !entered; i++) await tick(); assert.equal(entered, true);
  const simultaneous = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form() }); assert.equal(simultaneous.status, 409);
  controller.abort(); await pending;
  for (let i = 0; i < 80 && !capturedSignal.aborted; i++) await tick(); assert.equal(capturedSignal.aborted, true);
  blocked = false; await tick(); await tick();
  const next = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form('.2', '.5') });
  assert.equal(next.status, 200); assert.equal((await next.json()).selection.start_seconds, .2); assert.equal(calls, 2);
});

test('an incomplete upload times out without executing Python and reports a fixed public error', async t => {
  let runs = 0; const app = await serving(t, { timeoutMs: 25, runner: () => { runs++; throw Error('/private/key'); } });
  const response = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: app.server.address().port, path: '/api/acoustics/measure', method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': 100 } }, response => {
      const chunks = []; response.on('data', bytes => chunks.push(bytes)); response.on('end', () => { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); request.destroy(); });
    });
    request.on('error', reject); request.write('partial');
  });
  assert.equal(response.status, 504); assert.equal(response.body.error.code, 'analysis_timeout'); assert.equal(runs, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /private|key/);
});

test('untrusted engine errors are redacted over HTTP and cannot become a successful measurement', async t => {
  const app = await serving(t, { runner: () => ({ error: { code: 'unexpected_private_error', message: '/Users/private/recording.wav' } }) });
  const response = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form() });
  const body = await response.json(); assert.equal(response.status, 502); assert.equal(body.error.code, 'analysis_failed'); assert.doesNotMatch(JSON.stringify(body), /Users|recording/);
});
