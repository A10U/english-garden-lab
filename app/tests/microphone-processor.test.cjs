const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'microphone-processor.js'), 'utf8');

function setup(sampleRate = 48000) {
  const messages = [], transfers = [];
  let Processor;
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage(message, transfer = []) {
          transfers.push(transfer.length);
          // Transfer and detach the real buffer, as an AudioWorklet port does.
          // This catches accidental reuse of a batch after it has been sent.
          messages.push(structuredClone(message, { transfer }));
        }
      };
    }
  }
  vm.runInNewContext(source, {
    AudioWorkletProcessor, Float32Array, sampleRate,
    registerProcessor(name, type) {
      assert.equal(name, 'egl-microphone');
      assert.equal(Processor, undefined);
      Processor = type;
    }
  });
  const processor = new Processor();
  return {
    processor, messages, transfers,
    command(type) { processor.port.onmessage({ data: { type } }); },
    samples() { return messages.filter(message => message.type === 'samples').flatMap(message => [...message.samples]); }
  };
}

test('microphone processor ignores input until start and always silences every output', () => {
  const app = setup();
  const outputs = [[new Float32Array(128).fill(1), new Float32Array(128).fill(-1)], [new Float32Array(128).fill(.5)]];
  assert.equal(app.processor.process([[new Float32Array(128).fill(.75)]], outputs), true);
  assert.deepEqual(app.messages, []);
  for (const output of outputs) for (const channel of output) assert.ok(channel.every(sample => sample === 0));
  outputs[0][0].fill(1);
  app.command('start');
  assert.equal(app.processor.process([], outputs), true);
  assert.ok(outputs[0][0].every(sample => sample === 0));
  assert.equal(app.processor.process([[]], []), true);
  assert.equal(app.processor.process([[new Float32Array(0)]], []), true);
  assert.deepEqual(app.messages, []);
  app.command('stop');
  assert.deepEqual(app.messages, [{ type: 'stopped' }]);
  app.processor.process([[new Float32Array(128).fill(.25)]], []);
  assert.deepEqual(app.messages, [{ type: 'stopped' }], 'late input after stop must not acknowledge a canceled start');
});

test('stereo channels are averaged into mono and the final partial batch precedes stopped', () => {
  const app = setup();
  app.command('start');
  assert.equal(app.processor.process([
    [new Float32Array([1, .5, -1, -.5]), new Float32Array([-1, .5, .5, -.5])]
  ], [[new Float32Array(4).fill(1)]]), true);
  assert.deepEqual(app.messages.map(message => message.type), ['started']);
  app.command('stop');
  assert.deepEqual(app.samples(), [0, .5, -.25, -.5]);
  assert.deepEqual(app.messages.map(message => message.type), ['started', 'samples', 'stopped']);
  assert.equal(app.messages[1].samples.length, 4);
  assert.deepEqual(app.transfers, [0, 1, 0]);
});

test('PCM batches retain frame order and copy samples before input buffers are reused', () => {
  const app = setup();
  app.command('start');
  const input = new Float32Array(128);
  for (let quantum = 0; quantum < 35; quantum++) {
    for (let frame = 0; frame < input.length; frame++) input[frame] = quantum * input.length + frame;
    app.processor.process([[input]], []);
    input.fill(-999);
  }
  assert.deepEqual(app.messages.filter(message => message.type === 'samples').map(message => message.samples.length), [2048, 2048]);
  app.command('stop');
  assert.deepEqual(app.messages.filter(message => message.type === 'samples').map(message => message.samples.length), [2048, 2048, 384]);
  assert.deepEqual(app.samples(), Array.from({ length: 4480 }, (_, frame) => frame));
  assert.deepEqual(app.transfers, [0, 1, 1, 1, 0]);
});

test('stop excludes subsequent audio, is idempotent, and a fresh start has no stale tail', () => {
  const app = setup();
  app.processor.process([[new Float32Array([9, 9])]], []);
  app.command('start');
  app.processor.process([[new Float32Array([1, 2])]], []);
  app.command('start'); // Repeated start must not erase an active capture.
  app.processor.process([[new Float32Array([3])]], []);
  app.command('stop');
  app.processor.process([[new Float32Array([8, 8])]], []);
  app.command('stop');
  assert.deepEqual(app.samples(), [1, 2, 3]);
  assert.equal(app.messages.filter(message => message.type === 'stopped').length, 1);
  app.command('start');
  app.processor.process([[new Float32Array([4, 5])]], []);
  app.command('stop');
  assert.deepEqual(app.samples(), [1, 2, 3, 4, 5]);
  assert.equal(app.messages.filter(message => message.type === 'stopped').length, 2);
  assert.equal(app.messages.filter(message => message.type === 'started').length, 2, 'acknowledge input exactly once per capture');
});

test('capture stops at exactly 14.5 seconds, flushing only the allowed tail frames', () => {
  const sampleRate = 48000, limit = Math.floor(sampleRate * 14.5), app = setup(sampleRate);
  app.command('start');
  const input = new Float32Array(128).fill(.25);
  for (let frames = 0; frames < limit + 1024; frames += input.length) {
    assert.equal(app.processor.process([[input]], []), true);
  }
  const samples = app.samples();
  assert.equal(samples.length, limit);
  assert.ok(samples.every(sample => sample === .25));
  const batches = app.messages.filter(message => message.type === 'samples');
  assert.ok(batches.slice(0, -1).every(message => message.samples.length === 2048));
  assert.equal(batches.at(-1).samples.length, limit % 2048);
  assert.equal(app.messages.at(-1).type, 'stopped');
  assert.equal(app.messages.filter(message => message.type === 'stopped').length, 1);
  app.command('stop');
  assert.equal(app.messages.filter(message => message.type === 'stopped').length, 1);
});

test('a nonintegral duration limit uses floor and still downmixes more than two channels', () => {
  const app = setup(3); // floor(3 * 14.5) = 43 frames.
  app.command('start');
  app.processor.process([[new Float32Array(50).fill(.75), new Float32Array(50).fill(.75), new Float32Array(50)]], []);
  assert.equal(app.samples().length, 43);
  assert.ok(app.samples().every(sample => sample === .5));
  assert.equal(app.messages.at(-1).type, 'stopped');
});
