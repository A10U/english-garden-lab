import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAcousticMeasureService, runAcousticProcess, ACOUSTIC_AUDIO_LIMIT, ACOUSTIC_BODY_LIMIT } from './acoustic-measure.mjs';

const URL = 'http://127.0.0.1:5173/api/acoustics/measure';
const tick = () => new Promise(resolve => setImmediate(resolve));
export function acousticWave(frames = 16000, rate = 16000) {
  const bytes = Buffer.alloc(44 + frames * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(i * .1) * 8192), 44 + i * 2);
  return bytes;
}
export function acousticForm(options = {}) {
  const form = new FormData(); form.append('audio', new Blob([options.audio ?? acousticWave()], { type: 'audio/wav' }), 'test.wav');
  form.append('start_seconds', options.start ?? '.1'); form.append('end_seconds', options.end ?? '.4');
  form.append('settings', options.settings ?? '{}'); form.append('vowel_confirmed', options.confirmed ?? 'false');
  if (options.extra) form.append(...options.extra);
  return form;
}
function post(options = {}) {
  return new Request(options.url || URL, { method: 'POST', headers: { Origin: options.origin ?? 'http://127.0.0.1:5173', ...(options.headers || {}) }, body: acousticForm(options), signal: options.signal });
}
export function acousticResult(payload) {
  const bytes = Buffer.from(payload.audio_base64, 'base64'), rate = bytes.readUInt32LE(24), frames = bytes.readUInt32LE(40) / 2;
  const start = Math.floor(payload.start_seconds * rate + .5), end = Math.floor(payload.end_seconds * rate + .5);
  const quantiles = value => ({ median_hz: value, q25_hz: value, q75_hz: value });
  const signal = samples => ({ rms_dbfs: -20, peak: .25, dc_offset: 0, samples });
  return { schema_version: 1, source: 'local_praat', measurement_type: 'acoustic_signal', pronunciation_grade: null,
    input: { sample_rate_hz: rate, channels: 1, frames, duration_seconds: frames / rate, encoding: 'PCM16', bytes: bytes.length, channel_handling: 'mono', input_full_scale_samples: 0 },
    selection: { start_sample: start, end_sample: end, start_seconds: start / rate, end_seconds: end / rate, duration_ms: 1000 * (end - start) / rate, boundary_source: 'user_selected', vowel_confirmed: payload.vowel_confirmed },
    engine: { name: 'Praat', version: '7.0.02', settings: payload.settings, analysis_context: 'full_original_sound', normalization: 'none' },
    signal: { selected: signal(end - start), whole_clip: signal(frames) },
    f0: { status: 'ok', reason: null, ...quantiles(200), voiced_frames: 1, total_frames: 1, coverage: 1, frames: [{ time_seconds: .2, value_hz: 200 }] },
    formants: { status: 'unreliable', reason: 'formant_ceiling_sensitive', tracks: [500, 1500, 2500].map((value, index) => ({ index: index + 1, ...quantiles(value), valid_frames: 3 })),
      frames: [{ time_seconds: .2, f1_hz: 500, f2_hz: 1500, f3_hz: 2500 }], sensitivity: [.9, 1, 1.1].map(factor => ({ ceiling_hz: payload.settings.formant_ceiling_hz * factor, medians_hz: [500, 1500, 2500] })) },
    flags: ['unconfirmed_vowel_boundaries'], limitations: ['Acoustic estimates are not a pronunciation grade.'] };
}
const service = options => createAcousticMeasureService({ configured: () => true, runner: async payload => acousticResult(payload), ...options });

test('health is configuration metadata only and reveals no paths or credentials', async () => {
  let runs = 0; const app = service({ configured: () => false, runner: () => { runs++; throw Error('must not execute'); } });
  const response = await app.handle(new Request(URL)), body = await response.json();
  assert.equal(body.configured, false); assert.equal(body.pronunciation_grade, null); assert.equal(body.configuration_check, 'executable_files_only');
  assert.equal(runs, 0); assert.match(response.headers.get('cache-control'), /no-store/); assert.doesNotMatch(JSON.stringify(body), /\/Users\/|\.env|API_KEY/);
  assert.equal((await app.handle(post())).status, 503);
});

test('authorization and methods fail before parsing any audio or starting a runner', async () => {
  let runs = 0; const app = service({ runner: () => { runs++; throw Error('private diagnostic'); } });
  for (const request of [post({ origin: 'https://evil.example' }), post({ url: 'http://evil.example/api/acoustics/measure', origin: 'http://evil.example' }), post({ headers: { 'Sec-Fetch-Site': 'cross-site' } }),
    new Request(URL, { method: 'POST', body: 'bad' }), new Request(URL, { headers: { Origin: 'http://localhost:5173' } })]) assert.equal((await app.handle(request)).status, 403);
  assert.equal((await app.handle(new Request(URL, { method: 'DELETE' }))).status, 405); assert.equal(runs, 0);
});

test('explicit measurement preserves original bytes and interval/settings without arbitrary executable arguments', async () => {
  let received, options; const app = service({ runner: async (payload, config) => { received = payload; options = config; return acousticResult(payload); } });
  const response = await app.handle(post({ start: '.125', end: '.375', settings: '{"pitch_floor_hz":80,"pitch_top_hz":900,"formant_ceiling_hz":5000}', confirmed: 'true' }));
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.selection.duration_ms, 250);
  assert.deepEqual(Buffer.from(received.audio_base64, 'base64'), acousticWave());
  assert.deepEqual(received.settings, { pitch_floor_hz: 80, pitch_top_hz: 900, formant_ceiling_hz: 5000 }); assert.equal(received.vowel_confirmed, true);
  assert.ok(options.paths.praat.endsWith('/.build/acoustic-tools/Praat.app/Contents/MacOS/Praat')); assert.equal(options.signal.aborted, false);
  assert.equal(body.source, 'local_praat'); assert.equal(body.measurement_type, 'acoustic_signal'); assert.equal(body.pronunciation_grade, null);
});

test('duplicate/unknown fields, invalid settings/selections and corrupt WAV never start a runner', async () => {
  let runs = 0; const app = service({ runner: () => { runs++; } });
  for (const input of [{ extra: ['audio', 'duplicate'] }, { extra: ['script', '/private/file.py'] }, { start: '-1' }, { end: '.01' }, { end: 'NaN' }, { start: '' }, { confirmed: 'yes' },
    { settings: '{"pitch_floor_hz":1}' }, { settings: '{"pitch_floor_hz":200,"pitch_top_hz":300}' }, { settings: '{"binary":"bad"}' }, { settings: '[]' }, { settings: '{"pitch_floor_hz":"50"}' }, { audio: Buffer.from('bad') }]) {
    assert.ok((await app.handle(post(input))).status >= 400);
  }
  assert.equal(runs, 0);
  const declared = new Request(URL, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(ACOUSTIC_BODY_LIMIT + 1) }, body: 'x' });
  assert.equal((await app.handle(declared)).status, 413);
  assert.equal((await app.handle(post({ audio: Buffer.alloc(ACOUSTIC_AUDIO_LIMIT + 1) }))).status, 413); assert.equal(runs, 0);
});

test('one active run, client abort and stale completion cannot block or overwrite the next selection', async () => {
  let started = false, oldResolve, signal, calls = 0;
  const app = service({ runner: (payload, config) => {
    calls++; if (calls > 1) return Promise.resolve(acousticResult(payload)); started = true; signal = config.signal;
    return new Promise((resolve, reject) => { oldResolve = () => resolve(acousticResult(payload)); signal.addEventListener('abort', () => reject(new Error('private cancel details')), { once: true }); });
  } });
  const controller = new AbortController(), pending = app.handle(post({ signal: controller.signal }));
  for (let i = 0; i < 50 && !started; i++) await tick(); assert.equal(started, true);
  assert.equal((await app.handle(post())).status, 409); controller.abort();
  assert.equal((await pending).status, 499); assert.equal(signal.aborted, true);
  const next = await app.handle(post({ start: '.2', end: '.5' })); assert.equal(next.status, 200); assert.equal((await next.json()).selection.start_seconds, .2);
  oldResolve(); await tick(); assert.equal(calls, 2);
});

test('timeout aborts one run, redacts internal failures and releases the slot without retry', async () => {
  let calls = 0, signal;
  const app = service({ timeoutMs: 15, runner: (_payload, config) => { calls++; signal = config.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('/private/audio.wav')))); } });
  const response = await app.handle(post()); assert.equal(response.status, 504); assert.equal(signal.aborted, true); assert.equal(calls, 1);
  assert.doesNotMatch(await response.text(), /\/private\/|audio\.wav/);
  const thrown = await service({ runner: () => { throw Error('/private/key=secret'); } }).handle(post()); assert.equal(thrown.status, 502); assert.doesNotMatch(await thrown.text(), /secret|private/);
});

test('engine errors are fixed and malformed/graded/nonfinite/oversized responses are never exposed as measurements', async () => {
  const failure = await service({ runner: () => ({ error: { code: 'invalid_audio', message: '/private/recording.wav secret' } }) }).handle(post());
  assert.equal(failure.status, 422); assert.doesNotMatch(await failure.text(), /recording|secret|private/);
  for (const mutate of [value => { value.source = 'cloud'; }, value => { value.pronunciation_grade = 99; }, value => { value.f0.median_hz = Infinity; },
    value => { value.selection.start_seconds = .9; }, value => { delete value.formants; }, value => { value.extra = 'secret'; }, value => { value.f0.frames = Array(3001).fill(value.f0.frames[0]); }]) {
    const response = await service({ runner: payload => { const value = acousticResult(payload); mutate(value); return value; } }).handle(post());
    assert.equal(response.status, 502); const error = await response.json(); assert.equal(error.error.code, 'invalid_engine_response');
  }
});

test('the subprocess uses trusted argument arrays, bounded stdout and process-group cancellation with cleanup grace', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'egl-acoustic-runner-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'engine.cjs');
  writeFileSync(script, 'process.stdin.resume(); process.stdin.on("end",()=>{console.log(JSON.stringify({args:process.argv.slice(2),inherited:process.env.OPENAI_API_KEY??null}));});');
  const paths = { root: directory, python: process.execPath, script, praat: '/trusted/Praat;$(not-a-shell)' };
  const response = await runAcousticProcess({ harmless: true }, { paths, signal: new AbortController().signal });
  assert.deepEqual(response.args, ['--praat', paths.praat]); assert.equal(response.inherited, null);
  writeFileSync(script, 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("x".repeat(1024*1024+1)));');
  await assert.rejects(runAcousticProcess({}, { paths, signal: new AbortController().signal }), error => error.code === 'invalid_engine_response');
  writeFileSync(script, 'process.on("SIGTERM",()=>process.exit(0));process.stdin.resume();setInterval(()=>{},1000);');
  const controller = new AbortController(), pending = runAcousticProcess({}, { paths, signal: controller.signal });
  setTimeout(() => controller.abort(), 30); await assert.rejects(pending, error => error.code === 'analysis_cancelled');
});

test('group escalation survives an exited leader and kills a TERM-ignoring descendant with closed pipes', { skip: process.platform === 'win32' }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'egl-acoustic-group-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'parent.cjs'), ready = path.join(directory, 'ready'), pidFile = path.join(directory, 'pid');
  const descendant = 'require("node:fs").writeFileSync(' + JSON.stringify(ready) + ',"ready");process.on("SIGTERM",()=>{});setInterval(()=>{},1000);';
  writeFileSync(script, 'const c=require("node:child_process").spawn(process.execPath,["-e",' + JSON.stringify(descendant) + '],{stdio:"ignore"});'
    + 'require("node:fs").writeFileSync(' + JSON.stringify(pidFile) + ',String(c.pid));process.on("SIGTERM",()=>process.exit(0));process.stdin.resume();setInterval(()=>{},1000);');
  const controller = new AbortController(), pending = runAcousticProcess({}, { paths: { root: directory, python: process.execPath, script, praat: '/trusted/Praat' }, signal: controller.signal });
  for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(existsSync(ready), true); const pid = Number(readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  const began = Date.now(); controller.abort();
  await assert.rejects(pending, error => error.code === 'analysis_cancelled');
  assert.ok(Date.now() - began >= 800, 'the leader closing must not clear the pending group kill');
  let running = false;
  try { process.kill(pid, 0); running = !/^\s*Z/u.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout); } catch {}
  assert.equal(running, false, 'the descendant must not survive group escalation');
});
