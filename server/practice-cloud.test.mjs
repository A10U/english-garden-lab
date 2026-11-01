import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeCloudService } from './practice-cloud.mjs';

const URL = 'http://127.0.0.1:5173/api/practice/cloud';
const KEY = 'fake-dev-only-credential-not-a-real-key';
const env = { OPENAI_API_KEY: KEY };
const tick = () => new Promise(resolve => setImmediate(resolve));
function wav(frames = 8000) {
  const raw = Buffer.alloc(44 + frames * 2);
  raw.write('RIFF', 0); raw.writeUInt32LE(raw.length - 8, 4); raw.write('WAVEfmt ', 8);
  raw.writeUInt32LE(16, 16); raw.writeUInt16LE(1, 20); raw.writeUInt16LE(1, 22);
  raw.writeUInt32LE(16000, 24); raw.writeUInt32LE(32000, 28); raw.writeUInt16LE(2, 32); raw.writeUInt16LE(16, 34);
  raw.write('data', 36); raw.writeUInt32LE(frames * 2, 40);
  for (let at = 0; at < frames; at++) raw.writeInt16LE(Math.round(Math.sin(at * .12) * 8192), 44 + at * 2);
  return raw;
}
function post(options = {}) {
  const form = new FormData();
  form.append('audio', new Blob([options.audio ?? wav()], { type: 'audio/wav' }), 'recording.wav');
  form.append('target', options.target ?? 'ship'); form.append('accent', options.accent ?? 'en-us');
  if (options.extra) form.append(...options.extra);
  return new Request(options.url ?? URL, { method: 'POST', headers: { Origin: options.origin ?? 'http://127.0.0.1:5173' }, body: form, signal: options.signal });
}
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function cloud(options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/audio/transcriptions')) return reply({ text: options.text ?? 'Ship.', usage: { type: 'tokens', input_tokens: 40, output_tokens: 3, total_tokens: 43, input_token_details: { audio_tokens: 30, text_tokens: 10, secret: 'ignored-field' }, raw_secret: 'ignored-field' } });
    const input = JSON.parse(init.body), schema = input.text.format.schema;
    return reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(options.coach ?? {
      heardSummary: schema.properties.heardSummary.enum[0], practiceTip: schema.properties.practiceTip.enum[0],
    }) }] }], usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70, extra: 'ignored-field' } });
  };
  return { calls, fetch };
}

test('health reveals configured state and a bounded dev budget without contacting a provider or exposing credentials', async () => {
  let calls = 0;
  const service = createPracticeCloudService(env, { fetch: () => { calls++; throw Error(KEY); } });
  const response = await service.handle(new Request(URL)); const body = await response.json();
  assert.equal(body.configured, true); assert.equal(body.remaining_calls, 20); assert.equal(body.coaching_mode, 'general_text_practice');
  assert.equal(body.pronunciation_grade, false); assert.equal(calls, 0);
  assert.equal(JSON.stringify(body).includes(KEY), false); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await (await createPracticeCloudService().handle(new Request(URL))).json()).configured, false);
});

test('loopback host and exact origin are checked before reading data or making calls', async () => {
  const mock = cloud(), service = createPracticeCloudService(env, mock);
  for (const request of [post({ origin: 'https://evil.example' }), post({ url: 'http://evil.example/api/practice/cloud', origin: 'http://evil.example' }),
    new Request(URL, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'bad' }),
    new Request(URL, { headers: { Origin: 'http://localhost:5173' } }), new Request(URL, { headers: { 'Sec-Fetch-Site': 'cross-site' } })]) {
    assert.equal((await service.handle(request)).status, 403);
  }
  assert.equal(mock.calls.length, 0); assert.equal((await (await service.handle(new Request(URL))).json()).remaining_calls, 20);
});

test('real Cloud contract separates prompt-free transcription from target-informed general text exercise selection', async () => {
  const mock = cloud(), service = createPracticeCloudService(env, mock);
  const response = await service.handle(post()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.source, 'cloud'); assert.equal(body.target, 'ship'); assert.equal(body.transcript, 'Ship.');
  assert.equal(body.text_match, true); assert.equal(body.pronunciation_grade, null); assert.equal(body.estimated_cost_usd, null);
  assert.equal(body.remaining_calls, 19); assert.equal(body.coaching.provider_output_used, true); assert.equal(body.coaching.basis, 'transcript_and_target_only');
  assert.deepEqual([...mock.calls[0].init.body.keys()], ['model', 'file', 'languages[]']);
  assert.equal(mock.calls[0].init.body.get('languages[]'), 'en'); assert.equal(mock.calls[0].init.body.has('prompt'), false);
  assert.equal(mock.calls[0].init.body.has('target'), false); assert.equal(mock.calls[0].init.body.has('accent'), false);
  assert.deepEqual(Buffer.from(await mock.calls[0].init.body.get('file').arrayBuffer()), wav());
  assert.equal(mock.calls.length, 2); assert.ok(mock.calls.every(call => call.init.redirect === 'error'));
  const coach = JSON.parse(mock.calls[1].init.body);
  assert.equal(coach.store, false); assert.equal(coach.max_output_tokens, 500); assert.deepEqual(coach.reasoning, { effort: 'none' });
  assert.match(coach.instructions, /not audio/); assert.match(coach.instructions, /untrusted/);
  assert.deepEqual(JSON.parse(coach.input[0].content), { untrusted_transcript: 'Ship.', untrusted_target: 'ship', target_reference_accent: 'en-us' });
  assert.equal(JSON.stringify(body).includes(KEY), false); assert.deepEqual(body.usage.transcription, { input_tokens: 40, output_tokens: 3, total_tokens: 43, input_token_details: { audio_tokens: 30, text_tokens: 10 } });
  assert.equal(body.usage.audio_duration_seconds, .5);
});

test('wrong word transcription is not converted into a pronunciation score or forced to match the target', async () => {
  const mock = cloud({ text: 'Soup.' }), service = createPracticeCloudService(env, mock);
  const body = await (await service.handle(post())).json();
  assert.equal(body.transcript, 'Soup.'); assert.equal(body.text_match, false); assert.equal(body.pronunciation_grade, null);
  assert.equal(body.coaching.mode, 'general_text_practice'); assert.equal('phones' in body, false);
});

test('unsafe or unsupported model coaching is explicitly replaced with an authored general exercise', async () => {
  const mock = cloud({ coach: { heardSummary: 'Your pronunciation score is 99%.', practiceTip: 'Your tongue is wrong for /s/.' } });
  const body = await (await createPracticeCloudService(env, mock).handle(post())).json();
  assert.equal(body.coaching.provider_output_used, false); assert.equal(body.coaching.fallback_reason, 'unusable_coaching_response');
  assert.doesNotMatch(JSON.stringify(body.coaching), /99|tongue|\/s\//); assert.equal(body.pronunciation_grade, null);
});

test('oversize, invalid WAV duration, unsupported media, duplicate fields and non-English targets cannot reach the provider', async () => {
  for (const input of [post({ audio: wav(3199) }), post({ audio: wav(240001) }), post({ audio: Buffer.from('not a WAV') }),
    post({ extra: ['target', 'another'] }), post({ accent: 'en-au' }), post({ target: 'ไทย' }), post({ target: 'x'.repeat(201) })]) {
    const mock = cloud(); const response = await createPracticeCloudService(env, mock).handle(input);
    assert.ok(response.status >= 400); assert.equal(mock.calls.length, 0);
  }
  const mock = cloud(); const large = new Request(URL, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(11 * 1024 * 1024) }, body: 'x' });
  assert.equal((await createPracticeCloudService(env, mock).handle(large)).status, 413); assert.equal(mock.calls.length, 0);
});

test('failed reserved analyses consume budget, concurrent requests do not, and all outcomes release the single slot', async () => {
  let started = false, abortedSignal;
  const service = createPracticeCloudService(env, { maxCalls: 2, fetch: (_url, init) => { started = true; abortedSignal = init.signal; return new Promise(() => {}); } });
  const controller = new AbortController(), pending = service.handle(post({ signal: controller.signal }));
  for (let i = 0; i < 20 && !started; i++) await tick();
  assert.equal(started, true); assert.equal((await service.handle(post())).status, 409);
  controller.abort(); assert.equal((await pending).status, 499); assert.equal(abortedSignal.aborted, true);
  assert.equal((await (await service.handle(new Request(URL))).json()).remaining_calls, 1);
  const next = new AbortController(); next.abort(); assert.equal((await service.handle(post({ signal: next.signal }))).status, 499);
  assert.equal((await service.handle(post())).status, 429);
});

test('the cap cannot be configured above twenty analyses and no request automatically retries', async () => {
  let calls = 0;
  const service = createPracticeCloudService(env, { maxCalls: 1000, fetch: async () => { calls++; return reply({ error: { code: 'server_error', message: KEY } }, 500); } });
  for (let i = 0; i < 20; i++) assert.equal((await service.handle(post())).status, 502);
  assert.equal((await service.handle(post())).status, 429); assert.equal(calls, 20);
});

test('quota exhaustion is distinguished from rate limiting without exposing provider messages or secrets', async () => {
  for (const code of ['credit_balance_exhausted', 'insufficient_quota', 'billing_hard_limit_reached', 'rate_limit_exceeded']) {
    let calls = 0;
    const service = createPracticeCloudService(env, { fetch: async () => { calls++; return reply({ error: { code, message: KEY } }, 429); } });
    const response = await service.handle(post()), body = await response.json();
    assert.equal(response.status, 429); assert.equal(body.error.code, code === 'rate_limit_exceeded' ? 'cloud_rate_limited' : 'cloud_credit_exhausted');
    assert.equal(JSON.stringify(body).includes(KEY), false); assert.equal(calls, 1);
  }
});

test('bad upstream authentication, raw errors, secret echo, refusals and malformed output cannot fabricate success', async () => {
  const variants = [async () => { throw Error(KEY); }, async () => reply({ error: { message: KEY } }, 401),
    async () => reply({ text: KEY }), async () => new Response('not JSON', { status: 200 }), async () => reply({ text: '' })];
  for (const fetch of variants) {
    const response = await createPracticeCloudService(env, { fetch }).handle(post()), body = await response.json();
    assert.equal(response.status, 502); assert.equal(body.source, undefined); assert.equal(JSON.stringify(body).includes(KEY), false);
  }
});

test('the total operation deadline aborts a stalled provider and a subsequent request remains usable', async () => {
  let count = 0, signal;
  const mock = cloud();
  const service = createPracticeCloudService(env, { timeoutMs: 20, fetch: (url, init) => {
    if (count++ === 0) { signal = init.signal; return new Promise(() => {}); }
    return mock.fetch(url, init);
  } });
  const timeout = await service.handle(post()); assert.equal(timeout.status, 504); assert.equal((await timeout.json()).error.code, 'cloud_timeout');
  assert.equal(signal.aborted, true); assert.equal((await service.handle(post())).status, 200);
});

test('a missing server credential performs no paid calls and cannot be supplied by browser headers', async () => {
  const mock = cloud(), service = createPracticeCloudService({}, mock), request = post(); request.headers.set('x-speak-api-key', KEY);
  assert.equal((await service.handle(request)).status, 503); assert.equal(mock.calls.length, 0);
});

test('silence and nearly silent WAVs fail the energy check before any provider call; audible quiet input stays usable', async () => {
  for (const sample of [0, 1]) {
    const raw=wav(); for(let at=44;at<raw.length;at+=2)raw.writeInt16LE(sample,at);
    const mock=cloud(),response=await createPracticeCloudService(env,mock).handle(post({audio:raw}));
    assert.equal(response.status,422);assert.equal((await response.json()).error.code,'insufficient_audio_signal');assert.equal(mock.calls.length,0);
  }
  const raw=wav();for(let at=44;at<raw.length;at+=2)raw.writeInt16LE(64,at);
  assert.equal((await createPracticeCloudService(env,cloud()).handle(post({audio:raw}))).status,200,'energy check is not a VAD or a demand for loud speech');
});

test('custom English punctuation is accepted as literal target data without becoming transcription hints', async()=>{
  const mock=cloud(), service=createPracticeCloudService(env,mock), target='Please say: "Hello" (again).';
  const response=await service.handle(post({target}));assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.target,target);
  assert.equal(mock.calls[0].init.body.has('prompt'),false);
  assert.equal(JSON.parse(JSON.parse(mock.calls[1].init.body).input[0].content).untrusted_target,target);
});

test('a failed optional coach preserves the successful transcription with an explicit authored fallback and no retries',async()=>{
 const mock=cloud();let calls=0;
 const service=createPracticeCloudService(env,{fetch:async(url,init)=>{calls++;if(url.endsWith('/audio/transcriptions'))return mock.fetch(url,init);return reply({error:{code:'credit_balance_exhausted',message:KEY}},429);}});
 const response=await service.handle(post()),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.transcript,'Ship.');assert.equal(body.coaching.provider_output_used,false);
 assert.equal(body.coaching_warning.code,'cloud_credit_exhausted');assert.equal(body.usage.coaching,null);
 assert.equal(body.pronunciation_grade,null);assert.equal(calls,2);assert.equal(JSON.stringify(body).includes(KEY),false);
});
