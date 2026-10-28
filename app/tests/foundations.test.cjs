const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'foundations.html'),'utf8');
const code=fs.readFileSync(path.join(root,'foundations.js'),'utf8');
const dataCode=fs.readFileSync(path.join(root,'core-word-data.js'),'utf8');
const scope={};vm.runInNewContext(dataCode,scope);const data=scope.EGL_CORE_WORDS;
function setup(t,mutate) {
  const dom=new JSDOM(html,{url:'https://garden.example/prefix/app/foundations.html',runScripts:'outside-only'}),w=dom.window;
  const mounts=[],effects={plays:[],cleanups:0,network:0,storage:[]};
  w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
  w.HTMLMediaElement.prototype.play=function(){effects.plays.push(this);this.dispatchEvent(new w.Event('play'));return Promise.resolve();};
  w.fetch=()=>{effects.network++;throw Error('No automatic network');};
  w.Storage.prototype.setItem=function(k,v){effects.storage.push([k,v]);};
  w.EGL_CORE_WORDS=JSON.parse(JSON.stringify(data));if(mutate)mutate(w.EGL_CORE_WORDS);
  w.EGLPhoneGuide=require('../phone-guide.js');
  w.EGLPhonetics={mount(container,options){mounts.push(options);container.innerHTML='<audio class="egl-ph-player"></audio><p class="egl-ph-record-hint"></p>';options.onClipChange({blob:null});return()=>{effects.cleanups++;container.replaceChildren();};}};
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
  const byId=name=>w.document.getElementById('foundation-'+name);
  return {w,mounts,effects,byId,button(text,area=w.document){return [...area.querySelectorAll('button')].find(n=>n.textContent===text);}};
}
function recordAndHear(app){app.mounts.at(-1).onClipChange({blob:new app.w.Blob(['test fixture']),clipId:1});app.byId('recorder').querySelector('audio').dispatchEvent(new app.w.Event('play'));}

test('basic lesson starts on one attributed human word without playback, microphone, inference or cloud',t=>{
 const a=setup(t);assert.equal(a.mounts.length,1);assert.equal(a.byId('word').textContent,'it');
 assert.equal(a.mounts[0].recordingOnly,true);assert.equal(a.mounts[0].demo,true);
 assert.equal(a.mounts[0].wordAudio.by_word.it.source_kind,'human');
 assert.match(a.byId('source').textContent,/ผู้พูดจริง/);assert.equal(a.byId('complete').disabled,true);
 assert.deepEqual(a.effects.plays,[]);assert.equal(a.effects.network,0);assert.deepEqual(a.effects.storage,[]);
 assert.ok(a.byId('audio').src.startsWith('https://garden.example/prefix/app/assets/native-words/'));
});
test('learner completion requires example, clip, own playback and voluntary reflection, then stores no audio or scores',t=>{
 const a=setup(t);a.byId('listen').click();assert.equal(a.byId('complete').disabled,true);
 recordAndHear(a);assert.ok([...a.byId('reflection').children].every(n=>!n.disabled));
 a.button('ยังไม่แน่ใจ').click();assert.equal(a.byId('complete').disabled,false);a.byId('complete').click();
 const [key,value]=a.effects.storage.at(-1);assert.equal(key,'egl.basicWordPractice.v1');
 assert.deepEqual(JSON.parse(value),{schema:1,completed:['it']});assert.match(a.byId('status').textContent,/ไม่ใช่คะแนน/);
 assert.equal(a.effects.network,0);
});
test('hearing the example after own playback also unlocks reflection without re-recording',t=>{
 const a=setup(t);recordAndHear(a);assert.ok([...a.byId('reflection').children].every(n=>n.disabled));
 a.byId('listen').click();assert.ok([...a.byId('reflection').children].every(n=>!n.disabled));
});
test('word changes clean up the recorder and reset current evidence; late old callbacks cannot unlock progress',t=>{
 const a=setup(t);a.byId('listen').click();recordAndHear(a);a.button('ใกล้ตัวอย่าง').click();
 const old=a.mounts[0],audio=a.byId('audio');a.byId('next').click();assert.equal(a.byId('word').textContent,'bit');
 assert.equal(a.effects.cleanups,1);assert.notEqual(a.byId('audio'),audio);assert.equal(a.byId('complete').disabled,true);
 old.onClipChange({blob:new a.w.Blob(['late'])});a.byId('recorder').querySelector('audio').dispatchEvent(new a.w.Event('play'));
 assert.ok([...a.byId('reflection').children].every(n=>n.disabled));assert.equal(a.effects.plays.length,1);
});
test('new takes reset self-report and own-listening while keeping the selected word',t=>{
 const a=setup(t);a.byId('listen').click();recordAndHear(a);a.button('อยากฝึกเพิ่ม').click();assert.equal(a.byId('complete').disabled,false);
 a.mounts.at(-1).onClipChange({blob:new a.w.Blob(['new'])});assert.equal(a.byId('complete').disabled,true);
 assert.ok([...a.byId('reflection').children].every(n=>n.disabled&&n.getAttribute('aria-pressed')==='false'));
});
test('example playback is disabled during microphone preparation/recording and cannot leak into a take',t=>{
 const a=setup(t);a.byId('listen').click();recordAndHear(a);a.button('ใกล้ตัวอย่าง').click();
 a.mounts.at(-1).onCaptureStateChange({requesting:true});
 assert.equal(a.byId('listen').disabled,true);assert.equal(a.byId('audio').controls,false);assert.equal(a.byId('complete').disabled,true);
 a.byId('listen').click();assert.equal(a.effects.plays.length,1);
 a.mounts.at(-1).onCaptureStateChange({recording:false,requesting:false,preparing:false});
 assert.equal(a.byId('listen').disabled,false);assert.equal(a.byId('audio').controls,true);assert.equal(a.byId('complete').disabled,true);
});
test('phoneme buttons provide reference instructions and do not start audio or inference',t=>{
 const a=setup(t);a.button('ลิ้นกับเสียง th · 8 คำ').click();assert.equal(a.byId('word').textContent,'this');
 a.byId('phone-choices').children[0].click();assert.match(a.byId('guide').textContent,/ð/);
 assert.equal(a.effects.plays.length,0);assert.equal(a.effects.network,0);
});
test('slow playback changes rate only on an explicit play; reset removes only self-reported practice',t=>{
 const a=setup(t);a.byId('slow').click();assert.equal(a.effects.plays.length,0);a.byId('listen').click();assert.equal(a.byId('audio').playbackRate,.75);
 recordAndHear(a);a.button('ใกล้ตัวอย่าง').click();a.byId('complete').click();a.byId('reset').click();
 assert.deepEqual(JSON.parse(a.effects.storage.at(-1)[1]),{schema:1,completed:[]});
});
test('unapproved audio paths are excluded and are never sent to the recorder or media element',t=>{
 const a=setup(t,d=>{d.words.find(x=>x.word==='it').url='https://foreign.example/private.wav';});
 assert.notEqual(a.byId('word').textContent,'it');assert.equal(a.mounts[0].wordAudio.by_word.it,undefined);
 assert.equal(a.effects.network,0);
});
test('the shipped native set has explicit source/license/reference provenance and no expert or trained claim',()=>{
 const available=data.words.filter(w=>w.available);assert.ok(available.length>=30);
 assert.equal(data.training_performed,false);
 for(const word of available){assert.equal(word.source_kind,'human');assert.equal(word.reference.reference_context,'isolated_word');assert.ok(word.arpabet_variants.length);assert.ok(['Public domain','CC BY-SA 3.0'].includes(word.license));assert.match(word.native_status,/self-declared/);assert.match(word.audio_label_review,/no expert listening review/);assert.ok(fs.existsSync(path.join(root,word.url)));}
});
