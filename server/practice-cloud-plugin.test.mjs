import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { speechCloud, loadDevSpeechCloudEnv } from '../scripts/vite/speech-cloud-plugin.mjs';

const KEY = 'fake-local-bridge-key-not-a-real-secret';
const tick = () => new Promise(resolve => setImmediate(resolve));
function wav() {
  const b = Buffer.alloc(44 + 16000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(16000, 40);
  for(let at=0;at<8000;at++)b.writeInt16LE(Math.round(Math.sin(at*.12)*8192),44+at*2);return b;
}
function form() { const f = new FormData(); f.append('audio', new Blob([wav()], { type: 'audio/wav' }), 'test.wav'); f.append('target', 'ship'); f.append('accent', 'en-us'); return f; }
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function goodProvider(url, init) {
  if (url.endsWith('/audio/transcriptions')) return reply({ text: 'Ship.' });
  const schema = JSON.parse(init.body).text.format.schema;
  return reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ heardSummary: schema.properties.heardSummary.enum[0], practiceTip: schema.properties.practiceTip.enum[0] }) }] }] });
}
async function serving(t, options = {}) {
  let middleware;
  const plugin = speechCloud({ env: { OPENAI_API_KEY: KEY }, ...options });
  plugin.configureServer({ config: { root: '/not-read-in-tests' }, middlewares: { use(value) { middleware = value; } } });
  const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not a dev cloud endpoint'); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, url: origin + '/api/practice/cloud', server };
}
function rawRequest(port, headers, body = '') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/api/practice/cloud', method: 'POST', headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.end(body);
  });
}

test('plugin import/config are serve-only and do not read an environment file until dev server setup', () => {
  let loads = 0, middleware;
  const plugin = speechCloud({ loadEnv: () => { loads++; return {}; } });
  assert.equal(plugin.apply, 'serve'); assert.equal(loads, 0);
  assert.ok(plugin.config().server.fs.deny.includes('.env.*')); assert.equal(loads, 0);
  plugin.configureServer({ config: { root: '/fake-root' }, middlewares: { use(value) { middleware = value; } } });
  assert.equal(loads, 1); assert.equal(typeof middleware, 'function');
});

test('the local environment parser reads only an explicit fake fixture and returns only server credential/model fields', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'egl-cloud-fixture-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, '.env.speech-cloud'), 'OPENAI_API_KEY="' + KEY + '"\nOPENAI_TRANSCRIBE_MODEL=gpt-transcribe\nUNRELATED_VALUE=ignore\n', { mode: 0o600 });
  assert.deepEqual(loadDevSpeechCloudEnv(directory, {}), { OPENAI_API_KEY: KEY, OPENAI_TRANSCRIBE_MODEL: 'gpt-transcribe' });
});

test('real HTTP complete upload close does not abort a valid delayed provider operation', async t => {
  const signals = [];
  const app = await serving(t, { fetch: async (url, init) => {
    signals.push(init.signal); await new Promise(resolve => setTimeout(resolve, 15)); return goodProvider(url, init);
  } });
  const health = await fetch(app.url); assert.equal(health.status, 200); assert.equal((await health.json()).configured, true);
  const response = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form() });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.transcript, 'Ship.');
  assert.equal(body.pronunciation_grade, null); assert.equal(signals.length, 2); assert.ok(signals.every(signal => !signal.aborted));
  assert.equal(JSON.stringify(body).includes(KEY), false); assert.match(response.headers.get('cache-control'), /no-store/);
});

test('host/origin/fetch-site and declared size fail before buffering or calling a provider', async t => {
  let calls = 0; const app = await serving(t, { fetch: () => { calls++; throw Error(KEY); } });
  const port = app.server.address().port;
  for (const headers of [
    { Host: 'evil.example', Origin: 'http://evil.example' },
    { Host: '127.0.0.1:' + port, Origin: 'http://localhost:' + port },
    { Host: '127.0.0.1:' + port, Origin: app.origin, 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const response = await rawRequest(port, { ...headers, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': 11 * 1024 * 1024 });
    assert.equal(response.status, 403); assert.equal(response.text.includes(KEY), false);
  }
  const tooLarge = await rawRequest(port, { Host: '127.0.0.1:' + port, Origin: app.origin, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': 11 * 1024 * 1024 });
  assert.equal(tooLarge.status, 413); assert.equal(calls, 0);
});

test('HTTP client cancellation aborts provider work and releases the slot for the next upload', async t => {
  let blocked = true, entered = false, signal;
  const app = await serving(t, { fetch: async (url, init) => {
    if (blocked) { entered = true; signal = init.signal; return new Promise(() => {}); }
    return goodProvider(url, init);
  } });
  const controller = new AbortController();
  const pending = fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form(), signal: controller.signal }).catch(error => error);
  for (let i = 0; i < 80 && !entered; i++) await tick();
  assert.equal(entered, true); controller.abort(); await pending;
  for (let i = 0; i < 80 && !signal.aborted; i++) await tick();
  assert.equal(signal.aborted, true); blocked = false;
  await tick(); await tick();
  const next = await fetch(app.url, { method: 'POST', headers: { Origin: app.origin }, body: form() });
  assert.equal(next.status, 200);
});

test('an incomplete HTTP upload times out before a provider call and returns a redacted failure', async t => {
  let calls = 0; const app = await serving(t, { timeoutMs: 30, fetch: () => { calls++; throw Error(KEY); } });
  const result = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: app.server.address().port, path: '/api/practice/cloud', method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': 100 } }, response => {
      const chunks = []; response.on('data', b => chunks.push(b)); response.on('end', () => { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); request.destroy(); });
    });
    request.on('error', reject); request.write('partial');
  });
  assert.equal(result.status, 504); assert.equal(result.body.error.code, 'cloud_timeout'); assert.equal(calls, 0);
});
