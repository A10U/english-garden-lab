const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'browser-phonetics.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const reference = () => ({
  text: 'A leaf.', accent: 'en-us', ipa: 'ə liːf',
  words: [{ index: 0, text: 'A', ipa: 'ə', phones: ['ə'] }, { index: 1, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }],
  analysis_type: 'text_pronunciation_reference', audio_analyzed: false,
});

function wave({ rate = 16000, frames = Math.round(rate * .4), channels = 1 } = {}) {
  const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
  const text = (at, value) => [...value].forEach((char, offset) => view.setUint8(at + offset, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  const expected = new Float32Array(frames), pattern = [-32768, -16384, 0, 8192, 16384, 32767];
  for (let frame = 0; frame < frames; frame++) {
    let mono = 0;
    for (let channel = 0; channel < channels; channel++) {
      const sample = pattern[(frame + channel * 2) % pattern.length];
      view.setInt16(44 + (frame * channels + channel) * 2, sample, true);
      mono += sample / (sample < 0 ? 32768 : 32767) / channels;
    }
    expected[frame] = mono;
  }
  return { blob: new Blob([bytes], { type: 'audio/wav' }), expected };
}

function setup(options = {}) {
  const workers = [], contexts = [], timers = new Map(), requests = [];
  let timerId = 0;
  class FakeWorker {
    constructor(url) { this.url = url; this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(message, transfer) {
      this.transferredBuffers = transfer;
      this.messages.push(structuredClone(message, { transfer }));
    }
    terminate() { this.terminated = true; }
    emit(data) { if (this.onmessage) this.onmessage({ data }); }
  }
  class AudioContext {
    constructor(config) { this.config = config; this.closed = 0; contexts.push(this); }
    decodeAudioData(bytes) { return options.decode ? options.decode(bytes, this) : Promise.reject(new Error('No decoder fixture')); }
    close() { this.closed++; return Promise.resolve(); }
  }
  const context = vm.createContext({
    document: { currentScript: { src: options.scriptURL || 'https://garden.example/prefix/app/browser-phonetics.js' } },
    Worker: FakeWorker, WebAssembly, AudioContext, Blob, URL, DOMException, AbortController,
    OfflineAudioContext: options.OfflineAudioContext,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (...args) => { requests.push(args); throw new Error('The client must not fetch model or learner audio'); },
  });
  vm.runInContext(source, context, { filename: 'browser-phonetics.js' });
  return { api: context.EGLBrowserPhonetics, context, workers, contexts, timers, requests };
}
function begin(app, overrides = {}) {
  const expected = reference();
  return app.api.analyze({ blob: wave().blob, text: expected.text, accent: expected.accent, reference: expected, ...overrides });
}
async function waitForWorker(app, count = 1) {
  for (let i = 0; i < 20; i++) {
    if (app.workers.length >= count && app.workers[count - 1].messages.length) return app.workers[count - 1];
    await flush();
  }
  throw new Error('Expected an explicit analysis request to reach the worker');
}
function result(worker, data = { audio_analyzed: true, marker: 'actual selected audio result' }) {
  worker.emit({ id: worker.messages.at(-1).id, type: 'result', result: data });
  return data;
}
function decodedAudio() {
  return { length: 6400, sampleRate: 16000, duration: .4, numberOfChannels: 1,
    getChannelData: () => new Float32Array(6400).fill(.25) };
}

test('loading and checking support do not create a worker, decoder, timer, or request', () => {
  const app = setup();
  assert.equal(app.api.supported(), true);
  assert.equal(app.workers.length, 0);
  assert.equal(app.contexts.length, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.requests.length, 0);
});

test('a published runtime version also refreshes the worker under the hosted prefix', async () => {
  const app = setup({ scriptURL: 'https://garden.example/prefix/app/browser-phonetics.js?v=release-hash' });
  const job = begin(app), worker = await waitForWorker(app);
  assert.equal(worker.url, 'https://garden.example/prefix/app/browser-phonetics-worker.js?v=release-hash');
  result(worker); await job;
  assert.equal(app.requests.length, 0);
});

test('explicit analysis transfers actual selected PCM16 stereo samples, forwards progress, and returns its worker result', async () => {
  const app = setup(), selected = wave({ channels: 2 }), expected = reference(), progress = [];
  const controller = new AbortController();
  const job = begin(app, { blob: selected.blob, reference: expected, signal: controller.signal, onProgress: text => progress.push(text) });
  const worker = await waitForWorker(app), sent = worker.messages[0];
  assert.equal(worker.url, 'https://garden.example/prefix/app/browser-phonetics-worker.js');
  assert.equal(sent.samples.length, selected.expected.length);
  assert.deepEqual(Array.from(sent.samples), Array.from(selected.expected));
  assert.deepEqual(sent.reference, expected);
  assert.equal(worker.transferredBuffers.length, 1);
  assert.equal(worker.transferredBuffers[0].byteLength, 0, 'the PCM buffer must be transferred rather than copied');
  assert.equal(app.contexts.length, 0, 'known PCM16 WAVs need no browser container decoder');
  assert.match(progress[0], /กำลังเตรียมเสียง/);
  worker.emit({ id: sent.id + 1, type: 'progress', message: 'different job' });
  worker.emit({ id: sent.id, type: 'progress', message: 'กำลังโหลดโมเดล 42%' });
  assert.equal(progress.at(-1), 'กำลังโหลดโมเดล 42%');
  assert.equal(progress.includes('different job'), false);
  const observed = result(worker);
  assert.equal(await job, observed);
  assert.equal(controller.signal.aborted, false);
  assert.equal(app.timers.size, 0);
  assert.equal(app.requests.length, 0);
});

test('missing, mismatched, and empty-phone references fail before worker creation or audio decoding', async () => {
  const app = setup();
  for (const expected of [null, { ...reference(), text: 'Other text.' }, { ...reference(), accent: 'en-gb' }, { ...reference(), words: [] }, { ...reference(), words: [{ index: 0, text: 'A', phones: [] }] }]) {
    await assert.rejects(begin(app, { reference: expected }), error => /ยังไม่มีคำอ่านอ้างอิง/.test(error.userMessage));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(begin(app, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(app.workers.length, 0);
  assert.equal(app.contexts.length, 0);
  assert.equal(app.requests.length, 0);
});

test('cancellation terminates the worker, rejects with AbortError, ignores late results, and allows a clean retry', async () => {
  const app = setup(), controller = new AbortController(), progress = [];
  const job = begin(app, { signal: controller.signal, onProgress: value => progress.push(value) });
  const canceled = assert.rejects(job, error => error.name === 'AbortError');
  const worker = await waitForWorker(app), oldId = worker.messages[0].id;
  controller.abort(); await canceled;
  assert.equal(worker.terminated, true);
  assert.equal(app.timers.size, 0);
  const progressLength = progress.length;
  worker.emit({ id: oldId, type: 'progress', message: 'late download' });
  worker.emit({ id: oldId, type: 'result', result: { marker: 'must not publish' } });
  assert.equal(progress.length, progressLength);
  const retry = begin(app), fresh = await waitForWorker(app, 2);
  const expected = result(fresh, { marker: 'retry audio' });
  assert.equal(await retry, expected);
  assert.notEqual(fresh.messages[0].id, oldId);
  assert.equal(app.requests.length, 0);
});

test('decode failure closes AudioContext, releases the pending reservation, and does not download a model', async () => {
  const app = setup({ decode: async () => { throw new Error('Unsupported container'); } });
  await assert.rejects(begin(app, { blob: new Blob(['not a playable container'], { type: 'audio/webm' }) }), error => /อ่านไฟล์เสียงไม่ได้/.test(error.userMessage));
  assert.equal(app.contexts.length, 1);
  assert.equal(app.contexts[0].config.sampleRate, 16000);
  assert.equal(app.contexts[0].closed, 1);
  assert.equal(app.workers.length, 0);
  const retry = begin(app), worker = await waitForWorker(app);
  const expected = result(worker);
  assert.equal(await retry, expected);
  assert.equal(app.requests.length, 0);
});

test('non-16k WAVs are rendered from their actual source rate and transfer the rendered 16k samples', async () => {
  const offline = [];
  class OfflineAudioContext {
    constructor(channels, frames, rate) { this.channels = channels; this.frames = frames; this.rate = rate; this.destination = {}; offline.push(this); }
    createBuffer(channels, frames, rate) {
      this.inputRate = rate; this.inputFrames = frames; this.input = new Float32Array(frames);
      return { getChannelData: () => this.input };
    }
    createBufferSource() { return { connect: () => {}, start: () => { this.started = true; } }; }
    async startRendering() {
      this.rendered = Float32Array.from({ length: this.frames }, (_, i) => (i % 5 - 2) / 8);
      return { sampleRate: this.rate, getChannelData: () => this.rendered };
    }
  }
  const app = setup({ OfflineAudioContext }), selected = wave({ rate: 48000 });
  const job = begin(app, { blob: selected.blob }), worker = await waitForWorker(app);
  assert.equal(offline.length, 1);
  assert.equal(offline[0].channels, 1);
  assert.equal(offline[0].frames, 6400);
  assert.equal(offline[0].rate, 16000);
  assert.equal(offline[0].inputRate, 48000);
  assert.equal(offline[0].inputFrames, 19200);
  assert.deepEqual(Array.from(offline[0].input), Array.from(selected.expected));
  assert.equal(offline[0].started, true);
  assert.deepEqual(Array.from(worker.messages[0].samples), Array.from(offline[0].rendered));
  result(worker); await job;
  assert.equal(app.contexts.length, 0);
});

test('a resampler returning the wrong rate is rejected before model loading', async () => {
  class WrongRateOffline {
    constructor() { this.destination = {}; }
    createBuffer(_channels, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { return { connect() {}, start() {} }; }
    startRendering() { return Promise.resolve({ sampleRate: 44100, getChannelData: () => new Float32Array(6400) }); }
  }
  const app = setup({ OfflineAudioContext: WrongRateOffline });
  await assert.rejects(begin(app, { blob: wave({ rate: 48000 }).blob }), error => /แปลงอัตราเสียงไม่สำเร็จ/.test(error.userMessage));
  assert.equal(app.workers.length, 0);
  assert.equal(app.requests.length, 0);
});

test('an error event queued by a canceled worker cannot reject or terminate a subsequent analysis', async () => {
  const app = setup(), controller = new AbortController();
  const job = begin(app, { signal: controller.signal }), canceled = assert.rejects(job, error => error.name === 'AbortError');
  const oldWorker = await waitForWorker(app); controller.abort(); await canceled;
  const retry = begin(app), fresh = await waitForWorker(app, 2);
  if (oldWorker.onerror) oldWorker.onerror(new Error('queued after terminate'));
  if (oldWorker.onmessageerror) oldWorker.onmessageerror(new Error('queued message error'));
  assert.equal(fresh.terminated, false);
  const expected = result(fresh, { marker: 'fresh analysis survives stale worker events' });
  assert.equal(await retry, expected);
});

test('cancel during container decoding closes the decoder, blocks simultaneous widgets, and permits retry', async () => {
  let complete;
  const app = setup({ decode: () => new Promise(resolve => { complete = resolve; }) }), controller = new AbortController();
  const job = begin(app, { blob: new Blob(['container'], { type: 'audio/webm' }), signal: controller.signal });
  const canceled = assert.rejects(job, error => error.name === 'AbortError');
  await flush();
  assert.equal(typeof complete, 'function');
  await assert.rejects(begin(app), error => /กำลังวิเคราะห์เสียงอีกไฟล์/.test(error.userMessage));
  controller.abort();
  assert.equal(app.contexts[0].closed, 1, 'abort must promptly close the live decoder');
  complete(decodedAudio()); await canceled;
  assert.ok(app.contexts[0].closed >= 1);
  assert.equal(app.workers.length, 0);
  const retry = begin(app), worker = await waitForWorker(app);
  result(worker); await retry;
});

test('an idle worker error during the next decode cannot call a missing reservation reject handler', async () => {
  let complete;
  const app = setup({ decode: () => new Promise(resolve => { complete = resolve; }) });
  const first = begin(app), oldWorker = await waitForWorker(app); result(oldWorker); await first;
  const second = begin(app, { blob: new Blob(['container'], { type: 'audio/webm' }) });
  await flush();
  assert.equal(typeof complete, 'function');
  assert.doesNotThrow(() => oldWorker.onerror(new Error('idle worker failed while a decoder reservation is active')));
  assert.doesNotThrow(() => oldWorker.onmessageerror(new Error('stale after the first error')));
  assert.equal(oldWorker.terminated, true);
  complete(decodedAudio());
  const replacement = await waitForWorker(app, 2);
  const expected = result(replacement, { marker: 'replacement worker after successful decode' });
  assert.equal(await second, expected);
});

test('unsupported browser capability rejects without a worker or any download even for a valid WAV', async () => {
  const app = setup(); app.context.AudioContext = undefined;
  assert.equal(app.api.supported(), false);
  await assert.rejects(begin(app), error => /WebAssembly.*Web Worker/.test(error.userMessage));
  assert.equal(app.workers.length, 0);
  assert.equal(app.requests.length, 0);
});
