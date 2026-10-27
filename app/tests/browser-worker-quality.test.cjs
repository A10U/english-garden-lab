const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const alignment = require('../phonetic-alignment.js');
const model = require('../browser-phoneme-model.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'browser-phonetics-worker.js'), 'utf8');

const reference = (phones = ['ɪ', 't', 's']) => ({
  text: "It's", accent: 'en-us', ipa: phones.join(''),
  words: [{ index: 0, text: "It's", ipa: phones.join(''), phones }],
  analysis_type: 'text_pronunciation_reference', audio_analyzed: false,
});
function waveform() {
  return Float32Array.from({ length: 9600 }, (_, at) => .2 * Math.sin(at / 10));
}
function logits(frames, shift = 0) {
  const width = 392, data = new Float64Array(frames.length * width).fill(-100 + shift);
  frames.forEach(({ token, posterior }, frame) => {
    data[frame * width + token] = Math.log(posterior) + shift;
    data[frame * width + (token === 0 ? 17 : 0)] = Math.log(1 - posterior) + shift;
  });
  return { dims: [1, frames.length, width], data };
}
const phoneFrames = (posterior = .8, tokens = [17, 6, 5]) => tokens.flatMap(token => [
  { token: 0, posterior: .99 }, { token, posterior },
]);

function setup(outputFactory) {
  const messages = [], inputs = [], outputDisposals = [];
  let creates = 0, runs = 0;
  class Tensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; this.disposals = 0; inputs.push(this); }
    dispose() { this.disposals++; }
  }
  const self = {
    location: { href: 'https://garden.example/app/browser-phonetics-worker.js' },
    EGLPhoneticAlignment: alignment,
    EGLBrowserPhonemeModel: { ...model, bytes: 1, sha256: '00'.repeat(32) },
    postMessage(message) { messages.push(message); },
    caches: { open: async () => ({ match: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) }) },
  };
  const ort = { env: { wasm: {} }, Tensor, InferenceSession: { create: async () => {
    creates++;
    return { run: async () => {
      const result = outputFactory(runs++);
      if (result && result.logits) {
        const record = { disposals: 0 }; outputDisposals.push(record);
        result.logits.dispose = () => { record.disposals++; };
      }
      return result;
    } };
  } } };
  const context = vm.createContext({
    self, ort, Float32Array, Uint8Array, URL, Response, importScripts() {},
    crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } },
    fetch() { throw new Error('Tests must not download weights or upload learner audio'); },
  });
  vm.runInContext(source, context, { filename: 'browser-phonetics-worker.js' });
  return {
    messages, inputs, outputDisposals, creates: () => creates, runs: () => runs,
    async analyze(id = 1, expected = reference(), samples = waveform()) {
      await self.onmessage({ data: { id, samples, reference: expected } });
      return messages.filter(message => message.id === id && message.type !== 'progress').at(-1);
    },
  };
}

test('weak token evidence is marked uncertain without changing a raw perfect alignment', async () => {
  const app = setup(() => ({ logits: logits(phoneFrames(.55)) }));
  const message = await app.analyze();
  assert.equal(message.type, 'result');
  assert.equal(message.result.alignment.summary.match_percent, 100);
  assert.deepEqual(Array.from(message.result.observed.phones, item => item.phone), ['ɪ', 't', 's']);
  assert.equal(message.result.recognition_quality.status, 'uncertain');
  assert.equal(message.result.recognition_quality.mean_token_posterior, .55);
  assert.equal(message.result.recognition_quality.nonblank_frames, 3);
  assert.equal(message.result.recognition_quality.threshold, .65);
  assert.equal(message.result.recognition_quality.reason, 'low_token_posterior');
  assert.equal(message.result.recognition_quality.calibrated, false);
  assert.equal(app.inputs[0].disposals, 1);
  assert.equal(app.outputDisposals[0].disposals, 1);
});

test('strong recognized speech can still have a genuine zero raw phone agreement', async () => {
  const app = setup(() => ({ logits: logits(phoneFrames(.9, [39, 14, 8])) }));
  const { result } = await app.analyze();
  assert.equal(result.alignment.summary.match_percent, 0);
  assert.equal(result.recognition_quality.status, 'recognized');
  assert.equal(result.recognition_quality.mean_token_posterior, .9);
  assert.equal(result.recognition_quality.reason, null);
  assert.equal(result.recognition_quality.calibrated, false);
});

test('high-posterior multilingual tokens remain raw evidence but cannot become assessed English scores', async () => {
  for (const token of [82, 148, 47, 28]) { // i5, y5, y, French-style uvular r.
    const app = setup(() => ({ logits: logits(phoneFrames(.95, [5, token])) }));
    const { result } = await app.analyze();
    assert.equal(result.recognition_quality.mean_token_posterior, .95);
    assert.equal(result.recognition_quality.status, 'uncertain');
    assert.equal(result.recognition_quality.reason, 'unsupported_english_tokens');
    assert.deepEqual(Array.from(result.recognition_quality.unsupported_tokens), [Object.keys(model.vocab).find(phone => model.vocab[phone] === token)]);
    assert.equal(result.recognition_quality.calibrated, false);
    assert.equal(result.observed.phones[1].phone, result.recognition_quality.unsupported_tokens[0], 'do not substitute an English or target phone');
    assert.match(result.recognition_quality.limitation, /ไม่ได้ยืนยันว่าผู้พูดออกเสียงผิด/);
    assert.ok(result.limitations.includes(result.recognition_quality.limitation));
    assert.deepEqual(result.alignment, alignment.alignPhoneSequences(result.reference.words, result.observed.phones), 'raw phone edit agreement stays intact for diagnostics');
  }
});

test('guide-supported English tokens and common variants are assessed independently of the expected word', async () => {
  const guide = require('../phone-guide.js');
  const supported = Object.entries(model.vocab).filter(([phone]) => {
    const described = guide.describe(phone);
    return described.symbol === alignment.canonical_phone(phone) && !described.label.includes('ยังไม่มี');
  });
  for (const [phone, token] of [...supported, ...['ʔ', 'ᵻ', 'ɜ', 'pʰ', 'tʰ', 'kʰ', 'ɻ', 'æː', 'ɪː', 'ʊː'].map(phone => [phone, model.vocab[phone]])]) {
    const app = setup(() => ({ logits: logits(phoneFrames(.9, [token])) }));
    const { result } = await app.analyze();
    assert.equal(result.recognition_quality.status, 'recognized', phone + ' must not be rejected merely for differing from the target');
    assert.deepEqual(Array.from(result.recognition_quality.unsupported_tokens), []);
  }
});

test('English sentence recognition keeps actual counts, supported composites and quality unchanged', async () => {
  const words = [{ index: 0, text: 'a', ipa: 'ɐ', phones: ['ɐ'] },
    { index: 1, text: 'garden', ipa: 'ɡɑːɹdən', phones: ['ɡ', 'ɑːɹ', 'd', 'ə', 'n'] }];
  const expected = { ...reference(), text: 'a garden', ipa: 'ɐ ɡɑːɹdən', words };
  const tokens = words.flatMap(word => word.phones.map(phone => model.vocab[phone]));
  const app = setup(() => ({ logits: logits(phoneFrames(.88, tokens)) }));
  const { result } = await app.analyze(1, expected);
  assert.equal(result.alignment.summary.match_percent, 100);
  assert.equal(result.alignment.summary.matched_phones, tokens.length);
  assert.equal(result.recognition_quality.status, 'recognized');
  assert.equal(result.recognition_quality.mean_token_posterior, .88);
  assert.deepEqual(Array.from(result.recognition_quality.unsupported_tokens), []);
  assert.deepEqual(Array.from(result.observed.phones, item => item.phone), words.flatMap(word => word.phones));
});

test('silence is rejected before model inference and cannot receive recognition or a score', async () => {
  const app = setup(() => { throw new Error('silence must not reach inference'); });
  const message = await app.analyze(1, reference(), new Float32Array(9600));
  assert.equal(message.type, 'error');
  assert.match(message.message, /เสียงเงียบหรือเบาเกินไป/);
  assert.equal(app.creates(), 0);
  assert.equal(app.runs(), 0);
  assert.equal(app.messages.some(message => message.type === 'result'), false);
});

test('high posterior blank frames cannot make weak phone recognition appear reliable', async () => {
  const frames = Array.from({ length: 25 }, () => ({ token: 0, posterior: .99999 }));
  frames.push({ token: 17, posterior: .52 });
  const app = setup(() => ({ logits: logits(frames) }));
  const { result } = await app.analyze();
  assert.equal(result.recognition_quality.status, 'uncertain');
  assert.equal(result.recognition_quality.mean_token_posterior, .52);
  assert.equal(result.recognition_quality.nonblank_frames, 1);
});

test('repeated inference reuses the session but never carries quality or observed phones between takes', async () => {
  const app = setup(run => ({ logits: logits(run === 1 ? phoneFrames(.86, [8, 30, 23]) : phoneFrames(.54)) }));
  const first = (await app.analyze(1)).result;
  const second = (await app.analyze(2)).result;
  const repeated = (await app.analyze(3)).result;
  assert.equal(app.creates(), 1);
  assert.equal(app.runs(), 3);
  assert.equal(first.recognition_quality.status, 'uncertain');
  assert.equal(second.recognition_quality.status, 'recognized');
  assert.deepEqual(Array.from(second.observed.phones, item => item.phone), ['l', 'iː', 'f']);
  assert.deepEqual(repeated.observed, first.observed);
  assert.deepEqual(repeated.recognition_quality, first.recognition_quality);
  assert.deepEqual(app.inputs.map(input => input.disposals), [1, 1, 1]);
  assert.deepEqual(app.outputDisposals.map(output => output.disposals), [1, 1, 1]);
});

test('posterior uses stable softmax and does not depend on target text or absolute logit magnitude', async () => {
  const app = setup(run => ({ logits: logits(phoneFrames(.8), run ? 10000 : 0) }));
  const first = (await app.analyze(1)).result;
  const second = (await app.analyze(2, reference(['h', 'ɛ', 'l']))).result;
  assert.equal(first.alignment.summary.match_percent, 100);
  assert.equal(second.alignment.summary.match_percent, 0);
  assert.deepEqual(first.observed, second.observed);
  assert.deepEqual(first.recognition_quality, second.recognition_quality);
  assert.equal(second.recognition_quality.mean_token_posterior, .8);
});

test('NaN and either infinity anywhere in logits are errors, never partial scores, and allow retry', async () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const app = setup(run => {
      const output = logits(phoneFrames(.8));
      if (!run) output.data[391] = invalid; // A nonwinning token must still be validated.
      return { logits: output };
    });
    const failed = await app.analyze(1);
    assert.equal(failed.type, 'error');
    assert.match(failed.message, /ผลลัพธ์จากโมเดลมีค่าที่ไม่ถูกต้อง/);
    assert.equal(app.messages.some(message => message.id === 1 && message.type === 'result'), false);
    assert.equal(app.inputs[0].disposals, 1);
    assert.equal(app.outputDisposals[0].disposals, 1);
    assert.equal((await app.analyze(2)).type, 'result');
  }
});

test('invalid tensor dimensions and truncated or oversized data cannot publish a score', async () => {
  const invalid = [
    { dims: null, data: new Float32Array(392) },
    { dims: [1, 0, 392], data: new Float32Array() },
    { dims: [2, 1, 392], data: new Float32Array(784) },
    { dims: [1, 1, 391], data: new Float32Array(391) },
    { dims: [1, 1.5, 392], data: new Float32Array(588) },
    { dims: [1, 1, 392], data: new Float32Array(391) },
    { dims: [1, 1, 392], data: new Float32Array(393) },
    { dims: [1, 1, 392], data: null },
  ];
  for (const output of invalid) {
    const app = setup(() => ({ logits: output }));
    const failed = await app.analyze();
    assert.equal(failed.type, 'error');
    assert.match(failed.message, /ผลลัพธ์จากโมเดลไม่ถูกต้อง/);
    assert.equal(app.messages.some(message => message.type === 'result'), false);
    assert.equal(app.inputs[0].disposals, 1);
    assert.equal(app.outputDisposals[0].disposals, 1);
  }
});

test('missing output and blank-only recognition fail without manufacturing a pronunciation result', async () => {
  for (const output of [null, {}, { logits: logits([{ token: 0, posterior: .99 }]) }]) {
    const app = setup(() => output);
    const failed = await app.analyze();
    assert.equal(failed.type, 'error');
    assert.equal(app.messages.some(message => message.type === 'result'), false);
    assert.equal(app.inputs[0].disposals, 1);
  }
});
