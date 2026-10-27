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
  const events = [], contexts = [], nodes = [], streams = [], network = [], blobs = new Map(), revoked = [];
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
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream); return stream;
  }
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia(constraints) {
      events.push(['microphone', constraints]);
      return options.permission ? options.permission.promise : Promise.resolve(newStream());
    }
  } });
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
    constructor() { mediaRecorders++; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
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
  const cleanup = window.EGLPhonetics.mount(container, { text: 'leaf', expanded: true, precomputed: reference });
  const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
  t.after(() => { cleanup(); window.close(); });
  return { window, container, cleanup, events, contexts, nodes, streams, network, blobs, revoked, button, newStream,
    setTime: value => { time = value; }, mediaRecorders: () => mediaRecorders, decodeCalls: () => decodeCalls,
    status: () => container.querySelector('[role=status]').textContent,
    player: () => container.querySelector('.egl-ph-player') };
}

async function start(app) {
  app.button('บันทึกเสียงของฉัน').click();
  await until(() => Boolean(app.button('หยุดบันทึก')));
  const node = app.nodes.at(-1);
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
