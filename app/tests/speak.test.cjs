const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../speak.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../speak.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const health = (cloud = true) => ({mode: cloud ? 'configured' : 'not_configured', cloud: {conversation: cloud, transcription: cloud, speech: false}, assessment: {provider: 'local_browser', available: true}});
const ok = value => ({ok: true, json: async () => value});
function setup(options = {}) {
  const dom = new JSDOM(html, {url: options.url || 'https://garden.example/app/speak.html', runScripts: 'outside-only'});
  const win = dom.window, calls = [], mounts = [], played = [], revoked = [], voices = [];
  let cleaned = 0, microphones = 0, nextURL = 0;
  win.URL.createObjectURL = () => 'blob:speak-' + ++nextURL;
  win.URL.revokeObjectURL = value => revoked.push(value);
  win.HTMLMediaElement.prototype.pause = function () {};
  win.HTMLMediaElement.prototype.play = function () { played.push(this); return Promise.resolve(); };
  win.speechSynthesis = {getVoices: () => [{name: 'local test voice', lang: 'en-US', localService: true}], cancel() {}, speak: value => voices.push(value)};
  win.SpeechSynthesisUtterance = class {constructor(text) {this.text = text;}};
  Object.defineProperty(win.navigator, 'mediaDevices', {value: {getUserMedia() {microphones++; throw new Error('No automatic microphone');}}, configurable: true});
  win.EGLPhonetics = {mount(container, config) {mounts.push(config); container.textContent = 'Local pronunciation fixture'; return () => {cleaned++;};}};
  win.fetch = async (url, init = {}) => {
    calls.push([url, init]);
    return options.fetch ? options.fetch(url, init) : url === '/api/speak/health' ? ok(health(options.cloud !== false)) : Promise.reject(new Error('Unexpected request'));
  };
  win.eval(source);
  return {dom, win, doc: win.document, calls, mounts, played, revoked, voices,
    byId: id => win.document.getElementById(id), cleaned: () => cleaned, microphones: () => microphones,
    close() {win.dispatchEvent(new win.Event('pagehide')); win.close();}};
}
async function ready(options) {const app = setup(options); await flush(); await flush(); return app;}
function fill(app, text) {app.byId('speak-transcript').value = text; app.byId('speak-transcript').dispatchEvent(new app.win.Event('input', {bubbles: true}));}
function submit(app) {app.byId('conversation-form').dispatchEvent(new app.win.Event('submit', {bubbles: true, cancelable: true}));}
function clip(app, id = 7, target = "This is a leaf. It's green and soft.", kind = 'recorded') {
  const selected = {blob: new app.win.Blob(['learner PCM'], {type: 'audio/wav'}), label: 'เสียงของฉัน', kind, info: {duration: 2.52}, target, clipId: id};
  app.mounts.at(-1).onClipChange(selected); return selected;
}
function analysis(target, options = {}) {
  return {audio_analyzed: true, analysis_type: 'acoustic_phone_comparison', precomputed: false,
    reference: {text: target, words: []}, observed: {ipa: 'ʔ i', phones: []},
    recognition_quality: {status: 'uncertain', calibrated: false, mean_token_posterior: .54, private_debug: 'DO NOT SEND'},
    alignment: {summary: {match_percent: 0, matched_phones: 0, reference_phones: 3, inserted_phones: 0, compared_phones: 3, debug_audio_url: 'DO NOT SEND'},
      operations: [{type: 'substitute', expected: 'ɪ', observed: 'i', private_path: 'DO NOT SEND'}]},
    private_data: 'DO NOT SEND', ...options};
}

test('loading mounts local practice and checks health without opening mic, uploading, or starting a conversation', async t => {
  const app = await ready(); t.after(() => app.close());
  assert.equal(app.mounts.length, 1);
  assert.equal(app.mounts[0].demo, true); assert.equal(app.mounts[0].apiBase, null);
  assert.equal(app.mounts[0].text, "This is a leaf. It's green and soft.");
  assert.equal(app.microphones(), 0); assert.equal(app.played.length, 0); assert.equal(app.voices.length, 0);
  assert.deepEqual(app.calls.map(([url, init]) => [url, init.method || 'GET']), [['/api/speak/health', 'GET']]);
  assert.equal(app.byId('cloud-badge').textContent, 'Cloud พร้อม');
  assert.equal(app.byId('send-message').disabled, true);
  assert.match(app.byId('conversation-thread').textContent, /ลองบทสนทนาตัวอย่าง/);
  assert.equal(app.doc.querySelectorAll('.chat-turn').length, 0);
});

test('explicit samples show authored correction and translation without pretending to call cloud', async t => {
  const app = await ready({cloud: false}); t.after(() => app.close());
  assert.equal(app.byId('cloud-mode').disabled, true);
  app.byId('try-sample').click();
  app.doc.querySelector('[data-sample-reply="1"]').click();
  const thread = app.byId('conversation-thread');
  assert.match(thread.textContent, /My plant has two leaves/);
  assert.match(thread.textContent, /ต้นไม้หนึ่งต้นใช้ has/);
  assert.match(thread.textContent, /คำตอบตัวอย่าง/); assert.match(thread.textContent, /เตรียมไว้/);
  assert.doesNotMatch(thread.textContent, /Cloud AI/);
  assert.equal(app.calls.length, 1); assert.equal(app.byId('send-message').disabled, true);
  app.doc.querySelector('.chat-actions button').click();
  assert.equal(app.voices.length, 1); assert.equal(app.calls.length, 1);
});

test('health failures keep prepared examples usable and cannot silently generate a cloud reply', async t => {
  const app = await ready({fetch: async () => ({ok: false, json: async () => ({error: 'not configured'})})}); t.after(() => app.close());
  assert.match(app.byId('cloud-badge').textContent, /ยังไม่เชื่อม/);
  app.byId('try-sample').click(); fill(app, 'Hello there'); submit(app); await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.byId('cloud-mode').disabled, true);
  assert.doesNotMatch(app.byId('conversation-thread').textContent, /Cloud AI/);
});

test('cloud sends only explicit typed history and renders provider/user strings as text', async t => {
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : ok({source: 'cloud', reply: '<img src=x onerror=alert(1)>', translation: '<b>คำแปล</b>', followUp: '<script>bad()</script>', correction: {original: '<i>old</i>', suggested: '<u>new</u>', explanation: '<img onerror=bad()>'}, pronunciationExplanation: 'MUST NOT APPEAR WITHOUT EVIDENCE'})}); t.after(() => app.close());
  fill(app, '<svg onload=bad()>'); assert.equal(app.byId('send-message').disabled, true);
  app.byId('cloud-mode').click(); assert.equal(app.byId('send-message').disabled, false);
  submit(app); await flush(); await flush();
  assert.equal(app.calls.length, 2); const [url, init] = app.calls[1];
  assert.equal(url, '/api/speak/chat'); assert.equal(init.method, 'POST');
  const sent = JSON.parse(init.body); assert.equal(sent.scenario, 'garden');
  assert.equal(sent.messages.at(-1).content, '<svg onload=bad()>'); assert.equal('assessment' in sent, false);
  assert.equal(app.byId('conversation-thread').querySelectorAll('img,svg,script,b,i,u').length, 0);
  assert.match(app.byId('conversation-thread').textContent, /<img src=x/);
  assert.doesNotMatch(app.byId('conversation-thread').textContent, /MUST NOT APPEAR/);
  assert.match(app.byId('conversation-thread').textContent, /Cloud AI/);
  assert.equal(app.doc.querySelectorAll('[data-cloud-speech]').length, 0, 'cloud speech unavailable should not expose a dead control');
});

test('selected learner audio uploads only after explicit transcription and text is editable before chat', async t => {
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : url === '/api/speak/transcribe' ? ok({text: "It's a leaf.", source: 'cloud'}) : ok({source: 'cloud', reply: 'What color is it?'})}); t.after(() => app.close());
  clip(app); assert.equal(app.calls.length, 1); assert.equal(app.byId('transcribe-audio').disabled, false);
  app.byId('transcribe-audio').click(); await flush(); await flush();
  assert.equal(app.calls[1][0], '/api/speak/transcribe'); assert.equal(app.calls[1][1].method, 'POST');
  assert.equal(app.calls[1][1].body.get('audio').size, 11);
  assert.equal(app.byId('speak-transcript').value, "It's a leaf.");
  assert.equal(app.calls.length, 2, 'transcription must not automatically send chat');
  fill(app, 'This is a leaf.'); app.byId('cloud-mode').click(); submit(app); await flush(); await flush();
  assert.equal(JSON.parse(app.calls[2][1].body).messages.at(-1).content, 'This is a leaf.');
});

test('matching same-clip learner evidence is whitelisted, preserves uncertainty, and can be excluded', async t => {
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : ok({source: 'cloud', reply: 'Try again when ready.', pronunciationExplanation: 'ระบบยังตรวจเสียงได้ไม่มั่นคง'})}); t.after(() => app.close());
  const selected = clip(app); const data = analysis(selected.target); const original = JSON.stringify(data);
  app.mounts[0].onAnalysis({data, clipKind: 'recorded', target: selected.target, clipId: selected.clipId});
  fill(app, selected.target); assert.equal(app.byId('attach-assessment').disabled, false);
  app.byId('cloud-mode').click(); submit(app); await flush(); await flush();
  const payload = JSON.parse(app.calls[1][1].body);
  assert.equal(payload.assessment.target, selected.target);
  assert.equal(payload.assessment.recognition_quality.status, 'uncertain');
  assert.equal(payload.assessment.summary.match_percent, 0);
  assert.deepEqual(payload.assessment.differences, [{type: 'substitute', expected: 'ɪ', observed: 'i'}]);
  assert.equal(JSON.stringify(payload).includes('DO NOT SEND'), false);
  assert.equal(JSON.stringify(data), original, 'UI must not rewrite raw acoustic evidence');
  assert.match(app.byId('conversation-thread').textContent, /ระบบยังตรวจเสียงได้ไม่มั่นคง/);
  fill(app, selected.target); app.byId('attach-assessment').checked = false; submit(app); await flush(); await flush();
  assert.equal('assessment' in JSON.parse(app.calls[2][1].body), false);
});

test('different clip, target, transcript, and prerecorded AI cannot reuse pronunciation evidence', async t => {
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : ok({source: 'cloud', reply: 'Hello!'})}); t.after(() => app.close());
  const selected = clip(app); const data = analysis(selected.target);
  fill(app, selected.target);
  const variants = [
    {data, clipKind: 'recorded', target: selected.target, clipId: 6},
    {data, clipKind: 'ai', target: selected.target, clipId: 7},
    {data: {...data, precomputed: true}, clipKind: 'recorded', target: selected.target, clipId: 7},
    {data, clipKind: 'recorded', target: 'leaf', clipId: 7}
  ];
  for (const value of variants) {app.mounts[0].onAnalysis(value); assert.equal(app.byId('attach-assessment').disabled, true);}
  app.mounts[0].onAnalysis({data, clipKind: 'recorded', target: selected.target, clipId: 7});
  fill(app, 'I love coffee.'); assert.equal(app.byId('attach-assessment').disabled, true);
  app.byId('cloud-mode').click(); submit(app); await flush(); await flush();
  assert.equal('assessment' in JSON.parse(app.calls[1][1].body), false);
  app.mounts[0].onClipChange({blob: null, kind: '', target: selected.target, clipId: 8});
  assert.equal(app.byId('transcribe-audio').disabled, true);
});

test('a stale chat response after changing scenario is aborted and never enters the new conversation', async t => {
  let finish;
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : new Promise(resolve => {finish = resolve;})}); t.after(() => app.close());
  app.byId('cloud-mode').click(); fill(app, 'Hello'); submit(app); await flush();
  const signal = app.calls[1][1].signal; assert.equal(signal.aborted, false);
  app.doc.querySelector('[data-scenario="cafe"]').click();
  assert.equal(signal.aborted, true); assert.equal(app.cleaned(), 1);
  assert.equal(app.mounts[1].text, 'Please say it again.');
  finish(ok({source: 'cloud', reply: 'STALE REPLY'})); await flush(); await flush();
  assert.doesNotMatch(app.byId('conversation-thread').textContent, /STALE REPLY|Hello/);
  assert.match(app.byId('conversation-thread').textContent, /What would you like to drink/);
});

test('cloud failure shows an actionable error with no prepared reply substituted for the failed live call', async t => {
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : {ok: false, json: async () => ({error: {message: 'Cloud unavailable right now'}})}}); t.after(() => app.close());
  app.byId('cloud-mode').click(); fill(app, 'I like plants.'); submit(app); await flush(); await flush();
  assert.match(app.byId('speak-action-status').textContent, /Cloud unavailable/);
  assert.equal(app.doc.querySelectorAll('.chat-turn.assistant').length, 0);
  assert.equal(app.byId('speak-transcript').value, 'I like plants.');
  assert.equal(app.byId('send-message').disabled, false);
});

test('pagehide aborts an in-flight transcription and late text cannot repopulate the page', async t => {
  let finish;
  const app = await ready({fetch: async url => url === '/api/speak/health' ? ok(health()) : new Promise(resolve => {finish = resolve;})}); t.after(() => app.close());
  clip(app); app.byId('transcribe-audio').click(); await flush();
  const signal = app.calls[1][1].signal;
  app.win.dispatchEvent(new app.win.Event('pagehide'));
  assert.equal(signal.aborted, true); assert.equal(app.cleaned(), 1);
  finish(ok({source: 'cloud', text: 'LATE PRIVATE TRANSCRIPT'})); await flush(); await flush();
  assert.doesNotMatch(app.byId('speak-transcript').value, /LATE PRIVATE/);
});
