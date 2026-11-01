const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'phonetics.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 60 && !predicate(); i++) await flush();
  assert.ok(predicate(), 'the expected capture state should be reached');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(t, options = {}) {
  const dom = new JSDOM('<audio id="other-audio"></audio><video id="other-video"></video><main id="widget"></main>', {
    url: 'https://garden.example/demo/app/index.html', runScripts: 'outside-only'
  });
  const window = dom.window;
  const events = [], contexts = [], nodes = [], streams = [], network = [], blobs = new Map(), revoked = [], encoded = [];
  let time = 0, mediaRecorders = 0, decodeCalls = 0, sequence = 0;
  Object.defineProperty(window.performance, 'now', { value: () => time, configurable: true });
  window.Date.now = () => 1000000 + time;
  window.URL.createObjectURL = blob => {
    const url = 'blob:capture-' + (++sequence); blobs.set(url, blob); return url;
  };
  window.URL.revokeObjectURL = url => { revoked.push(url); };
  window.HTMLMediaElement.prototype.pause = function () { events.push(['pause', this.id || this.className]); };
  window.HTMLMediaElement.prototype.load = function () {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.fetch = (...args) => { network.push(args); return Promise.reject(new Error('Capture must remain local')); };
  function newStream() {
    const track = { stopped: 0, stop() { this.stopped++; }, readyState: 'live' };
    Object.assign(track, typeof options.track === 'function' ? options.track(streams.length) : options.track || {});
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream); return stream;
  }
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia(constraints) {
      events.push(['microphone', constraints]);
      if (options.getUserMedia) return options.getUserMedia(constraints, newStream);
      return options.permission ? options.permission.promise : Promise.resolve(newStream());
    }
  } });
  if (options.enumerate !== undefined) window.navigator.mediaDevices.enumerateDevices = () => {
    events.push(['enumerate']); return typeof options.enumerate === 'function' ? options.enumerate() : Promise.resolve(options.enumerate);
  };
  class AudioContext {
    constructor() {
      this.sampleRate = 48000; this.state = 'suspended'; this.closed = 0;
      this.destination = { destination: true };
      this.audioWorklet = { addModule: url => {
        events.push(['module', String(url)]);
        return options.module ? options.module.promise : Promise.resolve();
      } };
      contexts.push(this); events.push(['context']);
    }
    resume() { events.push(['resume']); this.state = 'running'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource(stream) {
      this.source = { stream, disconnected: 0, connections: [],
        connect(target) { this.connections.push(target); return target; },
        disconnect() { this.disconnected++; } };
      return this.source;
    }
    decodeAudioData() { decodeCalls++; return Promise.reject(new Error('PCM capture must not decode a container')); }
  }
  class AudioWorkletNode {
    constructor(context, name) {
      this.context = context; this.name = name; this.disconnected = 0; this.connections = [];
      const listeners = [];
      this.port = {
        commands: [], onmessage: null, closed: false,
        postMessage: command => { this.port.commands.push(command); },
        addEventListener: (type, callback) => { if (type === 'message') listeners.push(callback); },
        removeEventListener: (type, callback) => {
          if (type === 'message') { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); }
        },
        start() {}, close() { this.closed = true; },
        emit: data => {
          const event = { data };
          if (this.port.onmessage) this.port.onmessage(event);
          listeners.slice().forEach(callback => callback(event));
        }
      };
      nodes.push(this);
    }
    connect(target) { this.connections.push(target); return target; }
    disconnect() { this.disconnected++; }
  }
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor() {
      mediaRecorders++; this.state = 'inactive'; this.mimeType = 'audio/webm'; encoded.push(this);
      if (options.nativeStartEvents) this.onstart = null;
    }
    start() { this.state = 'recording'; events.push(['encoded-start']); }
    stop() { this.state = 'inactive'; }
  }
  window.AudioContext = AudioContext; window.AudioWorkletNode = AudioWorkletNode;
  if (!options.withoutMediaRecorder) window.MediaRecorder = MediaRecorder;
  window.eval(source);
  const reference = { text: 'leaf', accent: 'en-us', ipa: 'liːf', words: [
    { index: 0, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] }
  ], analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
  const container = window.document.getElementById('widget');
  const mount = () => window.EGLPhonetics.mount(container, { text: 'leaf', expanded: true, precomputed: reference, ...(options.mount || {}) });
  let cleanup = mount();
  const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
  t.after(() => { cleanup(); window.close(); });
  return { window, container, cleanup: () => cleanup(), remount() { cleanup(); cleanup = mount(); }, events, contexts, nodes, streams, network, blobs, revoked, encoded, button, newStream,
    setTime: value => { time = value; }, mediaRecorders: () => mediaRecorders, decodeCalls: () => decodeCalls,
    status: () => container.querySelector('[role=status]').textContent,
    player: () => container.querySelector('.egl-ph-player') };
}

async function opening(app) {
  const previous = app.nodes.length;
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => app.nodes.length > previous && app.nodes.at(-1).port.commands.some(command => command.type === 'start'));
  const node = app.nodes.at(-1);
  return node;
}
async function start(app) {
  const node = await opening(app);
  node.port.emit({ type: 'started' });
  await until(() => Boolean(app.button('หยุดบันทึก')));
  assert.ok(node, 'a PCM worklet should capture the microphone');
  assert.equal(node.name, 'egl-microphone');
  assert.ok(node.port.commands.some(command => command.type === 'start'));
  return node;
}
function samples(app, node, frames, value = .25) {
  node.port.emit({ type: 'samples', samples: new app.window.Float32Array(frames).fill(value) });
}
async function finish(app, node, duration = .6) {
  app.setTime(duration * 1000);
  app.button('หยุดบันทึก').click();
  assert.ok(node.port.commands.some(command => command.type === 'stop'));
  node.port.emit({ type: 'stopped' });
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
}
function bytes(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
}
function fakeTimers(app) {
  let now = 0, sequence = 0;
  const pending = new Map();
  app.window.setTimeout = (callback, delay) => {
    const id = ++sequence; pending.set(id, { callback, at: now + delay }); return id;
  };
  app.window.clearTimeout = id => { pending.delete(id); };
  return {
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...pending].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]); now = next[1].at; app.setTime(now); next[1].callback();
      }
      now = target; app.setTime(now);
    },
    count: () => pending.size
  };
}

test('word recording resumes audio inside the click, captures PCM without MediaRecorder, and keeps the flushed tail', async t => {
  const app = setup(t, { withoutMediaRecorder: true });
  assert.equal(app.contexts.length, 0, 'mounting must not open an audio capture context');
  app.container.querySelector('.egl-ph-ref-word').click(); app.button('ฝึกคำนี้').click();
  app.button('บันทึกเสียงของฉัน').click();
  assert.ok(app.events.findIndex(event => event[0] === 'resume') < app.events.findIndex(event => event[0] === 'microphone'),
    'iPhone audio activation must happen before awaiting microphone permission');
  await until(() => app.nodes.length && app.nodes[0].port.commands.some(command => command.type === 'start'));
  assert.equal(Boolean(app.button('หยุดบันทึก')), false, 'do not announce recording before the first microphone input');
  app.nodes[0].port.emit({ type: 'started' });
  await until(() => Boolean(app.button('หยุดบันทึก')));
  const node = app.nodes[0], context = app.contexts[0];
  assert.match(app.events.find(event => event[0] === 'module')[1], /\/app\/microphone-processor\.js(?:\?|$)/);
  assert.ok(context.source.connections.includes(node));
  assert.ok(node.connections.includes(context.destination));
  samples(app, node, 24000, .25);
  app.setTime(600); app.button('หยุดบันทึก').click();
  assert.equal(app.player().getAttribute('src'), null, 'the last worklet samples must arrive before publishing');
  samples(app, node, 4800, -.5); node.port.emit({ type: 'stopped' });
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  const blob = app.blobs.get(app.player().src);
  assert.equal(blob.type, 'audio/wav');
  const buffer = await bytes(app.window, blob), wav = new DataView(buffer);
  assert.equal(wav.getUint32(0), 0x52494646);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint32(24, true), 48000);
  assert.equal(wav.getUint32(40, true), 28800 * 2);
  assert.equal(buffer.byteLength, 44 + 28800 * 2);
  assert.equal(wav.getInt16(44, true), 8192);
  assert.equal(wav.getInt16(44 + 24000 * 2, true), -16384);
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.60 วินาที/);
  assert.match(app.container.querySelector('.egl-ph-target').textContent, /leaf/);
  assert.equal(app.mediaRecorders(), 0); assert.equal(app.decodeCalls(), 0); assert.equal(app.network.length, 0);
  assert.ok(context.closed >= 1); assert.ok(context.source.disconnected >= 1); assert.ok(node.disconnected >= 1);
  assert.equal(app.streams[0].track.stopped, 1);
});

test('a genuinely short 0.54-second word remains a valid recording', async t => {
  const app = setup(t), node = await start(app);
  samples(app, node, 25920);
  await finish(app, node, .54);
  assert.match(app.status(), /บันทึกแล้ว 0\.54 วินาที/);
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.54 วินาที/);
  assert.ok(app.player().src.startsWith('blob:'));
});

test('a 0.54-second fragment after three seconds of recording cannot be reported as successful', async t => {
  const app = setup(t), node = await start(app);
  samples(app, node, 25920);
  await finish(app, node, 3);
  assert.doesNotMatch(app.status(), /บันทึกแล้ว/);
  assert.equal(app.player().getAttribute('src'), null);
  assert.equal(app.container.querySelector('.egl-ph-self-audio').hidden, true);
  assert.equal(app.button('ดูผลเสียงของฉัน').disabled, true);
  assert.equal(app.network.length, 0);
  assert.equal(app.streams[0].track.stopped, 1);
});

test('cleanup while iPhone permission is pending closes the activated context and stops a late stream', async t => {
  const permission = deferred(), app = setup(t, { permission });
  app.button('บันทึกเสียงของฉัน').click();
  assert.equal(app.contexts.length, 1);
  app.cleanup();
  assert.ok(app.contexts[0].closed >= 1);
  const late = app.newStream(); permission.resolve(late);
  await flush(); await flush();
  assert.equal(late.track.stopped, 1);
  assert.equal(app.nodes.length, 0); assert.equal(app.mediaRecorders(), 0); assert.equal(app.network.length, 0);
  assert.equal(app.container.children.length, 0);
});

test('cleanup during worklet loading prevents a late module from starting capture', async t => {
  const module = deferred(), app = setup(t, { module });
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => app.events.some(event => event[0] === 'module'));
  app.cleanup(); module.resolve();
  await flush(); await flush();
  assert.ok(app.contexts[0].closed >= 1);
  assert.equal(app.streams[0].track.stopped, 1);
  assert.equal(app.nodes.length, 0); assert.equal(app.mediaRecorders(), 0); assert.equal(app.network.length, 0);
  assert.equal(app.container.children.length, 0);
});

test('cleanup while waiting for the final PCM acknowledgement discards late samples and preview', async t => {
  const app = setup(t), node = await start(app);
  samples(app, node, 24000); app.setTime(600); app.button('หยุดบันทึก').click();
  assert.ok(node.port.commands.some(command => command.type === 'stop'));
  app.cleanup(); samples(app, node, 4800); node.port.emit({ type: 'stopped' });
  await flush(); await flush();
  assert.ok(app.contexts[0].closed >= 1); assert.ok(node.disconnected >= 1);
  assert.equal(app.streams[0].track.stopped, 1);
  assert.equal(app.blobs.size, 0); assert.equal(app.network.length, 0); assert.equal(app.container.children.length, 0);
});

test('a second recording uses a fresh graph, revokes the old preview, and contains only the new samples', async t => {
  const app = setup(t), first = await start(app);
  samples(app, first, 28800, .25); await finish(app, first);
  const firstURL = app.player().src;
  app.setTime(1000);
  const second = await start(app);
  samples(app, second, 38400, -.25);
  app.setTime(1800); app.button('หยุดบันทึก').click(); second.port.emit({ type: 'stopped' });
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.equal(app.contexts.length, 2); assert.equal(app.nodes.length, 2); assert.equal(app.streams.length, 2);
  assert.ok(app.revoked.includes(firstURL)); assert.notEqual(app.player().src, firstURL);
  assert.match(app.container.querySelector('.egl-ph-duration').textContent, /0\.80 วินาที/);
  const wav = new DataView(await bytes(app.window, app.blobs.get(app.player().src)));
  assert.equal(wav.getUint32(40, true), 38400 * 2); assert.equal(wav.getInt16(44, true), -8192);
  assert.ok(app.contexts.every(context => context.closed >= 1));
  assert.ok(app.streams.every(stream => stream.track.stopped === 1));
  assert.equal(app.decodeCalls(), 0); assert.equal(app.network.length, 0);
});

test('worklet loading failure releases its context and falls back to an available encoded recorder', async t => {
  const module = deferred(), app = setup(t, { module });
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => app.events.some(event => event[0] === 'module'));
  module.reject(new Error('Worklet blocked'));
  await until(() => Boolean(app.button('หยุดบันทึก')));
  assert.equal(app.mediaRecorders(), 1); assert.equal(app.nodes.length, 0);
  assert.ok(app.contexts[0].closed >= 1); assert.equal(app.streams[0].track.stopped, 0);
  assert.equal(app.network.length, 0);
  app.cleanup(); assert.equal(app.streams[0].track.stopped, 1);
});

test('recording pauses other page audio and video before requesting the microphone', async t => {
  const app = setup(t);
  await start(app);
  const mic = app.events.findIndex(event => event[0] === 'microphone');
  for (const id of ['other-audio', 'other-video']) {
    const paused = app.events.findIndex(event => event[0] === 'pause' && event[1] === id);
    assert.ok(paused >= 0 && paused < mic, id + ' must stop before microphone capture');
  }
});

test('a missing worklet stop acknowledgement times out within two seconds, releases capture, and permits retry', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await start(app);
  samples(app, node, 28800); timers.advance(600); app.button('หยุดบันทึก').click();
  assert.ok(node.port.commands.some(command => command.type === 'stop'));
  assert.equal(app.streams[0].track.stopped, 0, 'capture must allow time for the final PCM tail');
  timers.advance(2000);
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.doesNotMatch(app.status(), /บันทึกแล้ว/);
  assert.equal(app.player().getAttribute('src'), null);
  assert.equal(app.streams[0].track.stopped, 1);
  assert.ok(app.contexts[0].closed >= 1); assert.ok(app.contexts[0].source.disconnected >= 1);
  assert.ok(node.disconnected >= 1); assert.equal(node.port.closed, true);
  assert.equal(timers.count(), 0, 'the stop watchdog and duration timer should both be cleared');
  const next = await start(app);
  assert.notEqual(next, node); assert.equal(app.streams.length, 2);
  node.port.emit({ type: 'stopped' }); await flush();
  assert.ok(app.button('หยุดบันทึก'), 'a stale acknowledgement cannot finish the new recording');
  assert.equal(app.streams[1].track.stopped, 0); assert.equal(app.network.length, 0);
});

test('a worklet processor error releases all capture resources and allows a fresh recording', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await start(app);
  samples(app, node, 12000);
  assert.equal(typeof node.onprocessorerror, 'function');
  node.onprocessorerror(new app.window.Event('processorerror'));
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.doesNotMatch(app.status(), /บันทึกแล้ว/);
  assert.equal(app.player().getAttribute('src'), null);
  assert.equal(app.streams[0].track.stopped, 1);
  assert.ok(app.contexts[0].closed >= 1); assert.ok(app.contexts[0].source.disconnected >= 1);
  assert.ok(node.disconnected >= 1); assert.equal(node.port.closed, true);
  assert.equal(node.port.onmessage, null); assert.equal(node.onprocessorerror, null);
  assert.equal(timers.count(), 0);
  const next = await start(app);
  assert.notEqual(next, node); assert.equal(app.contexts.length, 2); assert.equal(app.streams.length, 2);
  assert.equal(app.streams[1].track.stopped, 0); assert.equal(app.network.length, 0);
});

test('opening guidance stays visible until first input and preserves samples arriving before the ready cue renders', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await opening(app);
  assert.match(app.status(), /^กำลังเปิดไมโครโฟน/);
  assert.equal(Boolean(app.button('หยุดบันทึก')), false);
  assert.equal(app.button('กำลังขอใช้ไมโครโฟน…').disabled, true);
  timers.advance(1000);
  assert.doesNotMatch(app.status(), /^เริ่มพูดได้/);
  node.port.emit({ type: 'started' });
  samples(app, node, 128, -.5); // Already captured before the awaiting UI resumes.
  await until(() => Boolean(app.button('หยุดบันทึก')));
  assert.match(app.status(), /^เริ่มพูดได้/);
  samples(app, node, 28672, .25);
  timers.advance(600); app.button('หยุดบันทึก').click(); node.port.emit({ type: 'stopped' });
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.match(app.status(), /บันทึกแล้ว 0\.60 วินาที/);
  const wav = new DataView(await bytes(app.window, app.blobs.get(app.player().src)));
  assert.equal(wav.getUint32(40, true), 28800 * 2);
  assert.equal(wav.getInt16(44, true), -16384, 'the first captured block must not be trimmed');
  assert.equal(timers.count(), 0);
});

test('no microphone input times out before ready, releases resources, and ignores a stale start acknowledgement', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await opening(app);
  timers.advance(1999);
  assert.doesNotMatch(app.status(), /^เริ่มพูดได้/);
  assert.equal(app.streams[0].track.stopped, 0);
  timers.advance(1);
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.match(app.status(), /ไมโครโฟนยังไม่ส่งเสียง/);
  assert.equal(app.streams[0].track.stopped, 1);
  assert.ok(app.contexts[0].closed >= 1); assert.ok(node.disconnected >= 1);
  assert.equal(node.port.closed, true); assert.equal(timers.count(), 0);
  node.port.emit({ type: 'started' }); samples(app, node, 24000); node.port.emit({ type: 'stopped' });
  await flush();
  assert.equal(app.player().getAttribute('src'), null);
  assert.equal(app.blobs.size, 0);
  const next = await start(app);
  assert.notEqual(next, node); assert.match(app.status(), /^เริ่มพูดได้/);
  assert.equal(app.streams[1].track.stopped, 0);
});

test('changing target before the first input stops capture and a late start cannot revive the canceled attempt', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await opening(app);
  const input = app.container.querySelector('textarea');
  input.value = 'root'; input.dispatchEvent(new app.window.Event('input'));
  await flush();
  assert.ok(node.port.commands.some(command => command.type === 'stop'));
  assert.equal(node.port.closed, true); assert.equal(app.streams[0].track.stopped, 1);
  assert.ok(app.contexts[0].closed >= 1); assert.equal(timers.count(), 0);
  node.port.emit({ type: 'started' }); node.port.emit({ type: 'stopped' });
  await flush();
  assert.doesNotMatch(app.status(), /^เริ่มพูดได้/);
  assert.ok(app.button('บันทึกเสียงของฉัน')); assert.equal(app.blobs.size, 0);
});

test('cleanup while waiting for the first input rejects readiness and discards a late acknowledgement', async t => {
  const app = setup(t), timers = fakeTimers(app), node = await opening(app);
  app.cleanup(); node.port.emit({ type: 'started' });
  await flush(); await flush();
  assert.equal(app.container.children.length, 0);
  assert.equal(node.port.closed, true); assert.equal(app.streams[0].track.stopped, 1);
  assert.equal(timers.count(), 0); assert.equal(app.blobs.size, 0);
});

test('native MediaRecorder fallback waits for its start event before announcing readiness', async t => {
  const module = deferred(), app = setup(t, { module, nativeStartEvents: true }), timers = fakeTimers(app);
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => app.events.some(event => event[0] === 'module'));
  module.reject(new Error('Worklet unavailable'));
  await until(() => app.encoded.length === 1 && app.encoded[0].state === 'recording');
  assert.equal(Boolean(app.button('หยุดบันทึก')), false);
  assert.match(app.status(), /^กำลังเปิดไมโครโฟน/);
  const native = app.encoded[0], started = native.onstart;
  started(); await until(() => Boolean(app.button('หยุดบันทึก')));
  assert.match(app.status(), /^เริ่มพูดได้/);
  app.cleanup(); started(); await flush();
  assert.equal(app.container.children.length, 0); assert.equal(timers.count(), 0);
  assert.equal(app.streams[0].track.stopped, 1);
});

test('native start timeout cleans up and never announces ready from a stale event', async t => {
  const module = deferred(), app = setup(t, { module, nativeStartEvents: true }), timers = fakeTimers(app);
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => app.events.some(event => event[0] === 'module'));
  module.reject(new Error('Worklet unavailable'));
  await until(() => app.encoded.length === 1 && app.encoded[0].state === 'recording');
  const native = app.encoded[0], started = native.onstart;
  timers.advance(2000);
  await until(() => Boolean(app.button('บันทึกเสียงของฉัน')));
  assert.match(app.status(), /ไมโครโฟนยังไม่พร้อม/);
  assert.equal(native.state, 'inactive'); assert.equal(app.streams[0].track.stopped, 1);
  assert.equal(timers.count(), 0);
  started(); await flush();
  assert.doesNotMatch(app.status(), /^เริ่มพูดได้/); assert.equal(app.blobs.size, 0);
});

const micSelect = app => app.container.querySelector('.egl-ph-input-select');
const micActual = app => app.container.querySelector('.egl-ph-input-actual').textContent;
const processingSelect = app => app.container.querySelector('.egl-ph-input-processing');
async function refreshMics(app) {
  app.button('ดูไมค์ที่ใช้งานได้').click();
  await until(() => !app.button('ดูไมค์ที่ใช้งานได้').disabled);
}
function chooseMic(app, id) {
  const select = micSelect(app); select.value = id; select.dispatchEvent(new app.window.Event('change'));
}
function chooseProcessing(app, value) {
  const select = processingSelect(app); select.value = value; select.dispatchEvent(new app.window.Event('change'));
}
const usbInput = () => ({ kind:'audioinput', deviceId:'fake-usb-input', label:'Example USB microphone' });

test('microphone controls are idle on mount and explicit refresh enumerates inputs without opening a microphone', async t => {
  const app = setup(t, { enumerate:[usbInput(), {kind:'videoinput',deviceId:'camera',label:'Camera'}, {kind:'audiooutput',deviceId:'speaker',label:'Speaker'}, {kind:'audioinput',deviceId:'private-label',label:''}] });
  assert.equal(app.events.some(e=>['microphone','enumerate','context'].includes(e[0])),false); assert.equal(app.contexts.length,0);
  assert.equal(micSelect(app).value,''); assert.equal(micSelect(app).options.length,1);
  assert.equal(processingSelect(app).value,'browser'); assert.equal(processingSelect(app).options.length,2);
  await refreshMics(app);
  assert.equal(app.events.filter(e=>e[0]==='enumerate').length,1);
  assert.equal(app.events.some(e=>e[0]==='microphone'),false); assert.equal(app.contexts.length,0);
  assert.equal(micSelect(app).options.length,3); assert.doesNotMatch(micSelect(app).textContent,/Camera|Speaker/);
  assert.match(micSelect(app).textContent,/เบราว์เซอร์ยังไม่แจ้งชื่อ/);
  assert.equal(app.network.length,0);
});

test('explicit device selection uses exact routing while the displayed actual track and clip metadata remain separate', async t => {
  const changes=[],app=setup(t,{enumerate:[usbInput()],track:{label:'Actual capture input',getSettings:()=>({deviceId:'secret-actual-id',groupId:'secret-group',sampleRate:44100,channelCount:2,echoCancellation:false,noiseSuppression:true,autoGainControl:false})},mount:{onClipChange:value=>changes.push(value)}});
  let stores=0;app.window.Storage.prototype.setItem=()=>{stores++;};
  await refreshMics(app);chooseMic(app,'fake-usb-input');
  assert.equal(app.events.some(e=>e[0]==='microphone'),false);assert.doesNotMatch(micActual(app),/Actual capture input|Example USB/);
  const node=await start(app);
  const request=app.events.find(e=>e[0]==='microphone')[1];assert.deepEqual(JSON.parse(JSON.stringify(request)),{audio:{deviceId:{exact:'fake-usb-input'}}});
  assert.match(micActual(app),/ไมค์ที่เบราว์เซอร์เปิด: Actual capture input/);
  assert.match(micActual(app),/44100 Hz.*2 ช่องเสียง.*ลดเสียงสะท้อนปิด.*ลดเสียงรบกวนเปิด.*ปรับระดับอัตโนมัติปิด/);
  assert.doesNotMatch(micActual(app),/secret-actual-id|secret-group|fake-usb-input|Example USB/);
  samples(app,node,28800);await finish(app,node);
  assert.match(micActual(app),/ไมค์ของคลิปนี้: Actual capture input/);
  const wav=new DataView(await bytes(app.window,app.blobs.get(app.player().src)));
  assert.equal(wav.getUint32(24,true),48000,'recorded AudioContext sample rate stays separate from track settings');
  const clip=changes.find(value=>value.blob);assert.ok(clip);
  assert.doesNotMatch(JSON.stringify(clip.info),/input|label|deviceId|Actual capture|secret-/);
  assert.equal(stores,0);assert.equal(app.network.length,0);
});

test('default recording preserves audio:true and absent or throwing track settings cannot break capture', async t => {
  for (const track of [{}, {label:'Unnamed settings input',getSettings(){throw new Error('Not available');}}]) {
    const app=setup(t,{track}),node=await start(app);
    assert.equal(app.events.find(e=>e[0]==='microphone')[1].audio,true);
    assert.match(micActual(app),/เบราว์เซอร์ไม่แจ้งค่ารูปแบบเสียง/);
    samples(app,node,28800);await finish(app,node);assert.ok(app.player().src.startsWith('blob:'));
    assert.doesNotMatch(micActual(app),/NaN|undefined|deviceId/);
  }
});

test('experimental input processing requests ideal false only when selected, preserving exact routing and actual reported settings', async t => {
  for (const explicitDevice of [false, true]) {
    const changes=[],app=setup(t,{enumerate:[usbInput()],track:{label:'Reported processing input',getSettings:()=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true})},mount:{onClipChange:value=>changes.push(value)}});
    let stores=0;app.window.Storage.prototype.setItem=()=>{stores++;};
    if(explicitDevice){await refreshMics(app);chooseMic(app,'fake-usb-input');}
    chooseProcessing(app,'less-processing');
    assert.equal(app.events.some(event=>event[0]==='microphone'),false,'selecting a profile must not open a microphone');
    assert.equal(app.contexts.length,0);
    const node=await start(app);
    const request=JSON.parse(JSON.stringify(app.events.find(event=>event[0]==='microphone')[1]));
    assert.deepEqual(request,{audio:{...(explicitDevice?{deviceId:{exact:'fake-usb-input'}}:{}),echoCancellation:{ideal:false},noiseSuppression:{ideal:false},autoGainControl:{ideal:false}}});
    assert.match(micActual(app),/ลดเสียงสะท้อนเปิด.*ลดเสียงรบกวนเปิด.*ปรับระดับอัตโนมัติเปิด/,'a browser may ignore ideal:false; report the track settings');
    assert.doesNotMatch(micActual(app),/ลดเสียงสะท้อนปิด|ลดเสียงรบกวนปิด|ปรับระดับอัตโนมัติปิด/);
    samples(app,node,28800);await finish(app,node);
    const previousActual=micActual(app);chooseProcessing(app,'browser');
    assert.equal(micActual(app),previousActual,'changing the next recording profile must not relabel the existing clip');
    assert.match(previousActual,/ไมค์ของคลิปนี้: Reported processing input/);
    assert.doesNotMatch(JSON.stringify(changes.find(value=>value.blob).info),/processing|echoCancellation|noiseSuppression|autoGainControl|Reported processing/);
    assert.equal(stores,0);assert.equal(app.network.length,0);
  }
});

test('experimental requests leave unreported processing unknown and switching back restores audio:true on the next take', async t => {
  const app=setup(t);chooseProcessing(app,'less-processing');
  const node=await start(app);
  assert.match(micActual(app),/เบราว์เซอร์ไม่แจ้งค่ารูปแบบเสียง/);
  assert.doesNotMatch(micActual(app),/ลดเสียงสะท้อนปิด|ลดเสียงรบกวนปิด|ปรับระดับอัตโนมัติปิด/);
  samples(app,node,28800);await finish(app,node);chooseProcessing(app,'browser');
  await start(app);
  assert.equal(app.events.filter(event=>event[0]==='microphone').at(-1)[1].audio,true);
});

test('processing preferences survive word-widget remount only in page memory without activity or persistence', async t => {
  const app=setup(t);let stores=0;app.window.Storage.prototype.setItem=()=>{stores++;};
  chooseProcessing(app,'less-processing');app.remount();
  assert.equal(processingSelect(app).value,'less-processing');
  assert.equal(app.events.some(event=>['microphone','enumerate','context'].includes(event[0])),false);
  assert.equal(app.network.length,0);assert.equal(stores,0);
  const fresh=setup(t);assert.equal(processingSelect(fresh).value,'browser','a separate page must reset to browser defaults');
  chooseProcessing(app,'browser');app.remount();assert.equal(processingSelect(app).value,'browser');
});

test('enumeration disables the processing selector and ignores stale programmatic profile changes', async t => {
  const enumeration=deferred(),app=setup(t,{enumerate:()=>enumeration.promise});
  chooseProcessing(app,'less-processing');app.button('ดูไมค์ที่ใช้งานได้').click();
  assert.equal(processingSelect(app).disabled,true);chooseProcessing(app,'browser');assert.equal(processingSelect(app).value,'less-processing');
  enumeration.resolve([usbInput()]);await until(()=>!processingSelect(app).disabled);
  assert.equal(app.events.some(event=>event[0]==='microphone'),false);
  chooseProcessing(app,'browser');assert.equal(processingSelect(app).value,'browser');
});

test('refresh preserves an explicit preference, missing devices remain explicit, and routing failures never retry default', async t => {
  let list=[usbInput()],calls=0;
  const app=setup(t,{enumerate:()=>Promise.resolve(list),getUserMedia:()=>{calls++;return Promise.reject(Object.assign(new Error('Missing input'),{name:calls===1?'NotFoundError':'OverconstrainedError'}));}});
  await refreshMics(app);chooseMic(app,'fake-usb-input');await refreshMics(app);assert.equal(micSelect(app).value,'fake-usb-input');
  list=[];await refreshMics(app);assert.equal(micSelect(app).value,'fake-usb-input');
  assert.match(app.container.querySelector('.egl-ph-input-list-note').textContent,/ไม่อยู่ในรายการ/);
  for(let i=0;i<2;i++){
    app.button('บันทึกเสียงของฉัน').click();await until(()=>Boolean(app.button('บันทึกเสียงของฉัน')));
    assert.match(app.status(),/เปิดไมค์ที่เลือกไม่ได้.*ไม่ได้เปลี่ยนไปใช้ไมค์อื่น/);
    assert.doesNotMatch(micActual(app),/Example USB/);
  }
  assert.equal(calls,2);assert.ok(app.events.filter(e=>e[0]==='microphone').every(e=>e[1].audio.deviceId.exact==='fake-usb-input'));
  assert.equal(app.nodes.length,0);assert.ok(app.contexts.every(c=>c.closed>=1));
});

test('route controls stay disabled through permission, capture and preparation; stale route change events cannot change the active request', async t => {
  const permission=deferred(),app=setup(t,{permission,enumerate:[usbInput(),{kind:'audioinput',deviceId:'second-input',label:'Second input'}]});
  await refreshMics(app);chooseMic(app,'fake-usb-input');chooseProcessing(app,'less-processing');app.button('บันทึกเสียงของฉัน').click();
  assert.equal(micSelect(app).disabled,true);assert.equal(app.button('ดูไมค์ที่ใช้งานได้').disabled,true);
  assert.equal(processingSelect(app).disabled,true);chooseProcessing(app,'browser');assert.equal(processingSelect(app).value,'less-processing');
  chooseMic(app,'second-input');assert.equal(micSelect(app).value,'fake-usb-input');
  permission.resolve(app.newStream());await until(()=>app.nodes.length&&app.nodes[0].port.commands.some(c=>c.type==='start'));
  app.nodes[0].port.emit({type:'started'});await until(()=>Boolean(app.button('หยุดบันทึก')));
  assert.equal(processingSelect(app).disabled,true);chooseProcessing(app,'browser');assert.equal(processingSelect(app).value,'less-processing');
  const node=app.nodes[0];assert.equal(micSelect(app).disabled,true);samples(app,node,28800);app.setTime(600);app.button('หยุดบันทึก').click();
  assert.equal(micSelect(app).disabled,true);assert.equal(app.button('ดูไมค์ที่ใช้งานได้').disabled,true);
  assert.equal(processingSelect(app).disabled,true);chooseProcessing(app,'browser');assert.equal(processingSelect(app).value,'less-processing');
  node.port.emit({type:'stopped'});await until(()=>Boolean(app.button('บันทึกเสียงของฉัน')));assert.equal(micSelect(app).disabled,false);
  assert.equal(processingSelect(app).disabled,false);app.remount();assert.equal(processingSelect(app).value,'less-processing','ignored changes must not overwrite the remembered profile');
  assert.equal(app.events.filter(e=>e[0]==='microphone').length,1);
  const request=app.events.find(e=>e[0]==='microphone')[1];assert.equal(request.audio.deviceId.exact,'fake-usb-input');assert.equal(request.audio.autoGainControl.ideal,false);
});

test('late enumeration after cleanup or a fresh recording cannot repopulate or change microphone controls', async t => {
  const request=deferred(),app=setup(t,{enumerate:()=>request.promise});
  const select=micSelect(app);app.button('ดูไมค์ที่ใช้งานได้').click();app.cleanup();request.resolve([usbInput()]);await flush();await flush();
  assert.equal(app.container.children.length,0);assert.equal(select.options.length,1);assert.equal(app.streams.length,0);
  const second=deferred(),active=setup(t,{enumerate:()=>second.promise});
  active.button('ดูไมค์ที่ใช้งานได้').click();await start(active);second.resolve([usbInput()]);await flush();await flush();
  assert.equal(micSelect(active).options.length,1);assert.equal(micSelect(active).disabled,true);
});

test('a remembered microphone survives word-widget remount in page memory but never carries actual clip provenance', async t => {
  const app=setup(t,{enumerate:[usbInput()],track:{label:'Actual USB input'}});
  await refreshMics(app);chooseMic(app,'fake-usb-input');const first=await start(app);samples(app,first,28800);await finish(app,first);
  app.remount();assert.equal(micSelect(app).value,'fake-usb-input');assert.match(micSelect(app).selectedOptions[0].textContent,/เลือกไว้ก่อนหน้า.*ยังไม่ยืนยัน/);
  chooseMic(app,'fake-usb-input');app.remount();
  assert.equal((micSelect(app).selectedOptions[0].textContent.match(/เลือกไว้ก่อนหน้า/g)||[]).length,1,'remembered labels must not accumulate status prefixes');
  assert.doesNotMatch(micActual(app),/Actual USB input/);
  const node=await start(app);assert.equal(app.events.filter(e=>e[0]==='microphone').at(-1)[1].audio.deviceId.exact,'fake-usb-input');
  samples(app,node,28800);app.setTime(1200);app.button('หยุดบันทึก').click();node.port.emit({type:'stopped'});await until(()=>Boolean(app.button('บันทึกเสียงของฉัน')));
  const file=new app.window.File(['test-audio'],'local-test.wav',{type:'audio/wav'}),input=app.container.querySelector('.egl-ph-file');
  Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new app.window.Event('change'));
  assert.match(micActual(app),/ไฟล์ที่เลือกไม่มีข้อมูลยืนยัน/);assert.doesNotMatch(micActual(app),/Actual USB input/);
  const independent=setup(t);assert.equal(micSelect(independent).value,'','a separate page has no remembered device');
});

test('failed enumeration preserves the explicit choice and analysis busy state prevents route changes', async t => {
  let failure=false;
  const app=setup(t,{enumerate:()=>failure?Promise.reject(new Error('Enumeration unavailable')):Promise.resolve([usbInput(),{kind:'audioinput',deviceId:'second-input',label:'Second input'}])});
  await refreshMics(app);chooseMic(app,'fake-usb-input');failure=true;await refreshMics(app);
  assert.equal(micSelect(app).value,'fake-usb-input');assert.match(app.container.querySelector('.egl-ph-input-list-note').textContent,/อ่านรายการไมค์ไม่ได้/);
  const analysis=deferred();app.window.EGLBrowserPhonetics={supported:()=>true,analyze:()=>analysis.promise};
  const input=app.container.querySelector('.egl-ph-file');Object.defineProperty(input,'files',{configurable:true,value:[new app.window.File(['fixture'],'fixture.wav',{type:'audio/wav'})]});
  input.dispatchEvent(new app.window.Event('change'));app.button('ดูผลเสียงของฉัน').click();
  assert.equal(micSelect(app).disabled,true);assert.equal(app.button('ดูไมค์ที่ใช้งานได้').disabled,true);
  assert.equal(processingSelect(app).disabled,true);chooseProcessing(app,'less-processing');assert.equal(processingSelect(app).value,'browser');
  chooseMic(app,'second-input');assert.equal(micSelect(app).value,'fake-usb-input');
  app.cleanup();analysis.resolve(null);await flush();assert.equal(app.container.children.length,0);
});

test('a fresh permission attempt clears an older clip route and a late denied stream cannot restore it after cleanup', async t => {
  const next=deferred();let count=0;
  const app=setup(t,{track:{label:'Earlier input'},getUserMedia:(_constraints,newStream)=>++count===1?Promise.resolve(newStream()):next.promise});
  const node=await start(app);samples(app,node,28800);await finish(app,node);assert.match(micActual(app),/Earlier input/);
  app.button('บันทึกเสียงของฉัน').click();assert.match(micActual(app),/ยังไม่ทราบไมค์ของการบันทึกครั้งนี้/);assert.doesNotMatch(micActual(app),/Earlier input/);
  app.cleanup();const late=app.newStream();next.resolve(late);await flush();await flush();
  assert.equal(late.track.stopped,1);assert.equal(app.container.children.length,0);
});
