const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const names = ['phone-guide.js', 'sound-foundations.js', 'vowel-pairs.js', 'vowel-audio.js',
  'pronunciation-videos.js', 'articulation-images.js', 'spelling-guide.js', 'spelling-feedback.js', 'word-audio.js', 'phonetics.js'];
const scripts = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(options = {}) {
  const dom = new JSDOM('<audio id="sentence-audio"></audio><main id="widget"></main>', {
    url: options.url || 'https://example.test/prefix/speech-training/listen.html', runScripts: 'outside-only',
  });
  const win = dom.window, container = win.document.getElementById('widget');
  const plays = [], pauses = [], fetches = [], timers = new Map();
  let nextTimer = 0, mic = 0;
  win.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.HTMLMediaElement.prototype.play = function () {
    plays.push({ element: this, src: this.src });
    this.dispatchEvent(new win.Event('play'));
    return Promise.resolve();
  };
  win.HTMLMediaElement.prototype.pause = function () { pauses.push(this); };
  win.HTMLMediaElement.prototype.load = function () {};
  win.fetch = (...args) => { fetches.push(args); return Promise.reject(new Error('No automatic fetch expected')); };
  Object.defineProperty(win.navigator, 'mediaDevices', { value: { getUserMedia: () => { mic++; return options.microphone ? options.microphone() : Promise.reject(new Error('No microphone requested')); } } });
  win.MediaRecorder = class {};
  for (const name of names.slice(0, -1)) win.eval(scripts[name]);
  if (options.globals) Object.assign(win, options.globals);
  if (options.changeCatalog) options.changeCatalog(win.EGL_WORD_AUDIO);
  win.eval(scripts['phonetics.js']);
  const expected = options.reference || { text: 'leaf', accent: 'en-us', ipa: 'liːf', words: [
    { index: 0, text: 'leaf', ipa: 'liːf', phones: ['l', 'iː', 'f'] },
  ], analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
  const cleanup = win.EGLPhonetics.mount(container, { text: expected.text, precomputed: expected, expanded: true });
  const button = (label, scope = container) => [...scope.querySelectorAll('button')].find(node => node.textContent === label);
  function choose(group = 'ea') {
    const referenceWord = container.querySelector('.egl-ph-ref-word'); referenceWord.click();
    const node = [...container.querySelectorAll('.egl-ph-reference-focus .egl-ph-spelling-group')].find(item => item.querySelector('.egl-ph-grapheme').textContent === group);
    assert.ok(node, 'Missing group ' + group); node.click();
    return container.querySelector('.egl-ph-reference-focus .egl-ph-spelling-detail');
  }
  function runGap() {
    const pending = [...timers].filter(([, value]) => value.delay === 450);
    pending.forEach(([id, value]) => { timers.delete(id); value.callback(); });
    return pending.length;
  }
  return { dom, win, container, cleanup, button, choose, runGap, timers, plays, pauses, fetches, mic: () => mic,
    audio: () => container.querySelector('.egl-ph-example-player'), sentence: win.document.getElementById('sentence-audio') };
}
function close(app) { app.cleanup(); app.dom.window.close(); }
function metadata(app) { app.audio().dispatchEvent(new app.win.Event('loadedmetadata')); }

test('real vowel/video modules remain inert until an explicit control is used', () => {
  const app = setup();
  assert.equal(app.plays.length, 0);
  assert.equal(app.fetches.length, 0);
  assert.equal(app.mic(), 0);
  assert.equal(app.container.querySelector('iframe'), null);
  const panel = app.choose();
  assert.ok(panel.querySelector('.egl-ph-vowel-comparison'));
  assert.ok(panel.querySelector('.egl-ph-pure-vowels'));
  assert.ok(panel.querySelector('.egl-ph-vowel-words'));
  assert.equal(app.plays.length, 0);
  assert.equal(app.fetches.length, 0);
  assert.equal(app.mic(), 0);
  assert.equal(app.container.querySelector('iframe'), null);
  close(app);
});

test('whole-word A/B uses the actual seat/sit files and advances only after ended plus the 450ms gap', () => {
  const app = setup(), panel = app.choose(), words = panel.querySelector('.egl-ph-vowel-words');
  app.button('ฟังสลับ A → B → A → B', words).click(); metadata(app);
  const audio = app.audio(), catalog = app.win.EGL_WORD_AUDIO.by_word;
  const urls = ['seat', 'sit', 'seat', 'sit'].map(word => new URL(catalog[word].url, app.win.document.baseURI).href);
  assert.equal(audio.src, urls[0]); assert.equal(audio.currentTime, 0);
  assert.equal(app.plays.length, 1);
  assert.ok(app.pauses.includes(app.sentence), 'vowel playback pauses the page sentence audio');
  audio.currentTime = catalog.seat.duration_seconds - .01;
  audio.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(app.runGap(), 0, 'a model-timed boundary must not advance a full recording');
  assert.equal(app.plays.length, 1);
  for (let next = 1; next < 4; next++) {
    audio.dispatchEvent(new app.win.Event('ended'));
    assert.equal(app.plays.length, next, 'ended schedules a gap, rather than immediately starting B');
    assert.equal(app.runGap(), 1); metadata(app);
    assert.equal(audio.src, urls[next]); assert.equal(audio.currentTime, 0);
  }
  audio.dispatchEvent(new app.win.Event('ended')); app.runGap();
  assert.equal(app.plays.length, 4);
  assert.match(words.querySelector('.egl-ph-vowel-progress').textContent, /ฟังครบแล้ว/);
  assert.equal(app.fetches.length, 0);
  close(app);
});

test('slow mode is explicit, preserves pitch, and still plays the complete word from zero', () => {
  const app = setup(), words = app.choose().querySelector('.egl-ph-vowel-words');
  const slow = app.button('ฟังช้า 0.75×', words); slow.click();
  assert.equal(slow.getAttribute('aria-pressed'), 'true');
  assert.equal(app.plays.length, 0);
  app.button('ฟัง seat /iː/', words).click(); metadata(app);
  assert.equal(app.audio().playbackRate, .75);
  assert.equal(app.audio().preservesPitch, true);
  assert.equal(app.audio().currentTime, 0);
  close(app);
});

test('wrong-accent and wrong-phone word references disable their sample and the alternating sequence', () => {
  for (const mismatch of ['accent', 'phone']) {
    const app = setup({ changeCatalog: catalog => {
      if (mismatch === 'accent') catalog.by_word.seat.reference.accent = 'en-gb';
      else catalog.by_word.seat.reference.words[0].phones = ['s', 'ɛ', 't'];
    } });
    const words = app.choose().querySelector('.egl-ph-vowel-words');
    assert.equal(app.button('ฟัง seat /iː/', words).disabled, true);
    assert.equal(app.button('ฟัง sit /ɪ/', words).disabled, false);
    assert.equal(app.button('ฟังสลับ A → B → A → B', words).disabled, true);
    assert.match(words.textContent, /ยังไม่มีไฟล์ตัวอย่างที่ตรงกับคำอ่านและสำเนียง/);
    assert.equal(app.plays.length, 0);
    close(app);
  }
});

test('human vowels resolve to local app assets under the hosted Speech prefix with quality-only notes and real credits', () => {
  const app = setup(), pure = app.choose().querySelector('.egl-ph-pure-vowels');
  app.button('ฟัง /i/', pure).click(); metadata(app);
  assert.equal(app.audio().src, 'https://example.test/prefix/app/assets/vowels/vowel-i.ogg');
  assert.equal(app.audio().currentTime, 0);
  const data = app.win.EGLVowelAudio.forPhone('iː');
  assert.ok(pure.textContent.includes(data.author));
  assert.ok(pure.textContent.includes(data.note));
  assert.ok([...pure.querySelectorAll('a')].some(link => link.href === new URL(data.licenseURL).href));
  assert.match(pure.closest('.egl-ph-vowel-comparison').textContent, /คุณภาพ.*ความยาว.*สำเนียง/);
  const pauses = app.pauses.length;
  app.audio().currentTime = .2; app.audio().dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(app.pauses.length, pauses, 'human recordings have no automatic crop boundary');
  assert.equal(app.fetches.length, 0);
  close(app);
});

test('selecting another phone or cleaning up cancels pending A/B advancement and delayed metadata', () => {
  const app = setup(), panel = app.choose(), words = panel.querySelector('.egl-ph-vowel-words');
  app.button('ฟังสลับ A → B → A → B', words).click();
  app.audio().dispatchEvent(new app.win.Event('ended'));
  const plays = app.plays.length;
  const f = [...app.container.querySelectorAll('.egl-ph-reference-focus .egl-ph-spelling-group')].find(node => node.querySelector('.egl-ph-grapheme').textContent === 'f');
  f.click();
  assert.equal(app.runGap(), 0);
  app.audio().dispatchEvent(new app.win.Event('loadedmetadata'));
  assert.equal(app.plays.length, plays);
  const again = app.choose().querySelector('.egl-ph-vowel-words');
  app.button('ฟังสลับ A → B → A → B', again).click();
  app.audio().dispatchEvent(new app.win.Event('ended'));
  const beforeCleanup = app.plays.length;
  app.cleanup(); app.runGap();
  assert.equal(app.plays.length, beforeCleanup);
  assert.equal(app.container.children.length, 0);
  app.dom.window.close();
});

test('YouTube is click-to-load without autoplay and closes when another phone or page audio starts', () => {
  const app = setup(), panel = app.choose(), video = panel.querySelector('.egl-ph-video-card');
  const item = app.win.EGLPronunciationVideos.forPhone('iː')[0];
  const direct = [...video.querySelectorAll('a')].find(link => link.textContent === 'เปิดใน YouTube');
  assert.equal(direct.href, 'https://www.youtube.com/watch?v=' + item.id);
  assert.ok(direct.rel.includes('noopener'));
  assert.equal(app.container.querySelector('iframe'), null);
  app.button('ดูวิดีโอในหน้านี้', video).click();
  const frame = video.querySelector('iframe');
  assert.equal(frame.src, 'https://www.youtube-nocookie.com/embed/' + item.id + '?autoplay=0&rel=0');
  assert.equal(frame.title, item.title);
  assert.equal(app.plays.length, 0);
  app.sentence.play();
  assert.equal(app.container.querySelector('iframe'), null, 'native page audio must stop the embedded video');
  app.button('ดูวิดีโอในหน้านี้', video).click();
  assert.ok(video.querySelector('iframe'));
  const f = [...app.container.querySelectorAll('.egl-ph-reference-focus .egl-ph-spelling-group')].find(node => node.querySelector('.egl-ph-grapheme').textContent === 'f'); f.click();
  assert.equal(app.container.querySelector('iframe'), null);
  assert.equal(app.fetches.length, 0);
  close(app);
});

test('requesting the microphone stops teaching media and disables both comparison and video controls', async () => {
  let deny;
  const app = setup({ microphone: () => new Promise((_resolve, reject) => { deny = reject; }) });
  const panel = app.choose(), words = panel.querySelector('.egl-ph-vowel-words');
  const alternate = app.button('ฟังสลับ A → B → A → B', words), video = panel.querySelector('.egl-ph-video-load');
  alternate.click(); app.audio().dispatchEvent(new app.win.Event('ended'));
  app.button('บันทึกเสียงของฉัน').click();
  assert.equal(app.mic(), 1);
  assert.equal(alternate.disabled, true);
  assert.equal(video.disabled, true);
  assert.equal(app.runGap(), 0);
  const played = app.plays.length;
  alternate.dispatchEvent(new app.win.Event('click')); video.dispatchEvent(new app.win.Event('click'));
  assert.equal(app.plays.length, played);
  assert.equal(app.container.querySelector('iframe'), null);
  deny(Object.assign(new Error('denied fixture'), { name: 'NotAllowedError' })); await flush();
  assert.equal(alternate.disabled, false);
  assert.equal(video.disabled, false);
  close(app);
});

test('diphthongs have full-word comparisons and videos rather than an invented isolated-vowel recording', () => {
  const expected = { text: 'make', accent: 'en-us', ipa: 'meɪk', words: [
    { index: 0, text: 'make', ipa: 'meɪk', phones: ['m', 'eɪ', 'k'] },
  ], analysis_type: 'text_pronunciation_reference', audio_analyzed: false };
  const app = setup({ reference: expected }), panel = app.choose('a');
  assert.equal(app.win.EGLVowelAudio.forPhone('eɪ'), null);
  assert.equal(panel.querySelector('.egl-ph-pure-vowels'), null);
  const words = panel.querySelector('.egl-ph-vowel-words');
  assert.ok(words);
  app.button('ฟัง late /eɪ/', words).click(); metadata(app);
  assert.equal(app.audio().src, new URL(app.win.EGL_WORD_AUDIO.by_word.late.url, app.win.document.baseURI).href);
  assert.equal(app.audio().currentTime, 0);
  assert.ok(panel.querySelector('.egl-ph-video-card'));
  close(app);
});
