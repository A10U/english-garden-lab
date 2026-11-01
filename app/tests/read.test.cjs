const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'read.html'),'utf8');
const source=fs.readFileSync(path.join(root,'read.js'),'utf8');
const css=fs.readFileSync(path.join(root,'read.css'),'utf8');
const globals={};for(const file of ['core-word-data.js','phonetic-data.js','reference-audio.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),globals);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const health=()=>({configured:true,remaining_calls:3,models:{transcription:'test-transcribe',coaching:'test-coach'}});
function result(target='ship',transcript='Ship.'){return {source:'cloud',target,transcript,text_match:true,coaching:{summary:'ลองฟังคำที่ระบบถอดเทียบกับคลิปของคุณ',practiceTip:'ฟังตัวอย่างแล้วลองพูดอีกครั้งตามธรรมชาติ'},models:{transcription:'test-transcribe',coaching:'test-coach'},pronunciation_grade:null,estimated_cost_usd:null,usage:{}};}
function setup(t,options={}){
 const dom=new JSDOM(html,{url:options.url||'http://127.0.0.1:5173/app/read.html',runScripts:'outside-only'}),w=dom.window;
 const effects={plays:[],paused:[],fetches:[],cleanups:0,enumerations:0},mounts=[],playing=new Set();
 Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return !playing.has(this);}});
 w.HTMLMediaElement.prototype.pause=function(){playing.delete(this);effects.paused.push(this);this.dispatchEvent(new w.Event('pause'));};
 w.HTMLMediaElement.prototype.play=function(){playing.add(this);effects.plays.push(this);this.dispatchEvent(new w.Event('play'));return Promise.resolve();};
 w.HTMLMediaElement.prototype.load=function(){};
 w.fetch=(url,init)=>{effects.fetches.push([url,init]);return options.fetch?options.fetch(url,init):Promise.reject(new Error('No automatic network work'));};
 w.Storage.prototype.setItem=()=>{throw new Error('Read practice must not persist clips or keys');};
 Object.assign(w,JSON.parse(JSON.stringify(globals)));
 if(options.mutate)options.mutate(w);
 if(options.realWidget){
  w.eval(fs.readFileSync(path.join(root,'phonetics.js'),'utf8'));const originalMount=w.EGLPhonetics.mount;
  w.EGLPhonetics={mount(container,config){mounts.push(config);const cleanup=originalMount(container,config);return ()=>{effects.cleanups++;cleanup();};}};
 }else w.EGLPhonetics={mount(container,config){mounts.push(config);container.innerHTML='<div class="egl-ph-input-controls"><select aria-label="actual recorder microphone"></select><p class="egl-ph-input-actual">ไมค์ที่เบราว์เซอร์รายงาน</p></div><button type="button">บันทึกเสียงของฉัน</button><audio class="egl-ph-player"></audio>';config.onClipChange({blob:null});config.onCaptureStateChange({recording:false,requesting:false,preparing:false});return ()=>{effects.cleanups++;container.replaceChildren();};}};
 w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const byId=name=>w.document.getElementById('read-'+name);
 t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
 return {w,dom,effects,mounts,byId,change(name,value){const node=byId(name);node.value=value;node.dispatchEvent(new w.Event('change'));},clip(value){const blob=value||new w.Blob(['synthetic audio'],{type:'audio/wav'});mounts.at(-1).onClipChange({blob});return blob;}};
}

test('read space defaults to ship with a visible sticky English prompt and makes no automatic audio/cloud work',t=>{
 const a=setup(t);
 assert.equal(a.byId('prompt').textContent,'ship');assert.equal(a.byId('prompt').lang,'en');
 assert.equal(a.byId('prompt').closest('details'),null);assert.equal(a.byId('prompt').hidden,false);
 assert.match(css,/\.read-prompt-panel\{position:sticky/);assert.match(css,/clamp\(42px/);
 assert.equal(a.mounts[0].recordingOnly,true);assert.equal(a.mounts[0].expanded,true);assert.equal(a.mounts[0].demo,true);
 assert.equal(a.mounts[0].precomputed.text,'ship');assert.equal(a.mounts[0].accent,'en-us');
 assert.deepEqual(a.effects.fetches,[]);assert.deepEqual(a.effects.plays,[]);
 assert.equal(a.byId('translation').hidden,true);a.byId('translation-toggle').click();assert.equal(a.byId('translation').textContent,'เรือ');
 const settings=a.byId('recorder').querySelector('.read-microphone');assert.equal(settings.open,false);assert.ok(settings.querySelector('.egl-ph-input-controls'));
 assert.equal(a.byId('cloud').disabled,true);assert.match(a.byId('cloud-notice').textContent,/OpenAI.*มีค่าใช้จ่าย.*ไม่ส่งอัตโนมัติ/);
});
test('sentence selection uses a complete existing AI clip and target reference, keeping text readable during capture',t=>{
 const a=setup(t);a.change('mode','sentence');
 assert.equal(a.byId('selection').options.length,8);assert.equal(a.byId('prompt').textContent,'This is a leaf.');
 assert.equal(a.mounts.at(-1).precomputed.text,'This is a leaf.');assert.equal(a.mounts.at(-1).precomputed.accent,'en-us');
 assert.ok(a.byId('audio').src.endsWith('/speech-training/demo-assets/audio/practice/tts-110.wav'));
 assert.match(a.byId('source').textContent,/AI.*ไม่ใช่เสียงคน/);assert.match(a.byId('cue-note').textContent,/ประมาณ.*เต็มคลิป/);
 a.mounts.at(-1).onCaptureStateChange({recording:true});assert.equal(a.byId('prompt').textContent,'This is a leaf.');assert.equal(a.byId('prompt').hidden,false);
 assert.equal(a.byId('selection').disabled,true);assert.equal(a.byId('mode').disabled,true);
});
test('all selectable assets exist with honest human versus AI source labels and mismatched paths/references are excluded',t=>{
 const a=setup(t);assert.equal(a.byId('selection').options.length,39);assert.match(a.byId('source').textContent,/คนพูดจริง.*US/);
 assert.ok(a.mounts[0].wordAudio.by_word.ship.source_kind==='human');
 for(const option of a.byId('selection').options){const row=globals.EGL_CORE_WORDS.words.find(x=>x.word===option.value&&x.reference.accent==='en-us');assert.ok(fs.existsSync(path.join(root,row.url)));}
 const b=setup(t,{mutate(w){w.EGL_CORE_WORDS.words.find(x=>x.word==='ship'&&x.reference.accent==='en-us').url='https://foreign.invalid/audio.wav';w.EGL_REFERENCE_AUDIO['This is a leaf.'].url='https://foreign.invalid/audio.wav';w.EGL_PHONETIC_DATA['The leaf is green.'].accent='en-gb';}});
 assert.notEqual(b.byId('prompt').textContent,'ship');b.change('mode','sentence');assert.equal(b.byId('selection').options.length,6);
 assert.equal(b.effects.fetches.length,0);
});
test('karaoke cue follows currentTime approximately and clears on pause/seek/end without cropping the audio',t=>{
 const a=setup(t);a.change('mode','sentence');const audio=a.byId('audio');audio.currentTime=.28;a.byId('listen').click();
 assert.equal(a.byId('prompt').querySelector('.is-reading').textContent,'is');
 audio.currentTime=.6;audio.dispatchEvent(new a.w.Event('timeupdate'));assert.equal(a.byId('prompt').querySelector('.is-reading').textContent,'leaf.');
 audio.pause();assert.equal(a.byId('prompt').querySelector('.is-reading'),null);
 a.byId('listen').click();audio.dispatchEvent(new a.w.Event('seeking'));assert.equal(a.byId('prompt').querySelector('.is-reading'),null);
 audio.dispatchEvent(new a.w.Event('seeked'));assert.equal(a.byId('prompt').querySelector('.is-reading').textContent,'leaf.');
 audio.dispatchEvent(new a.w.Event('ended'));assert.equal(a.byId('prompt').querySelector('.is-reading'),null);assert.equal(audio.currentTime,.6,'cue logic must not reposition or crop playback');
});
test('whole-word highlighting and slow playback require explicit play and capture pauses/disables example audio',t=>{
 const a=setup(t);a.byId('slow').click();assert.equal(a.effects.plays.length,0);a.byId('listen').click();assert.equal(a.byId('audio').playbackRate,.75);
 assert.equal(a.byId('prompt').querySelector('.is-reading').textContent,'ship');a.mounts[0].onCaptureStateChange({requesting:true});
 assert.equal(a.byId('listen').disabled,true);assert.equal(a.byId('audio').controls,false);assert.equal(a.byId('prompt').querySelector('.is-reading'),null);
 const before=a.effects.plays.length;a.byId('listen').click();assert.equal(a.effects.plays.length,before);assert.ok(a.effects.paused.includes(a.byId('audio')));
 a.mounts[0].onCaptureStateChange({});assert.equal(a.byId('listen').disabled,false);
});
test('cloud click checks same-origin health then posts the exact selected clip, target and accent without keys',async t=>{
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():result())});
 const blob=a.clip();assert.equal(a.effects.fetches.length,0);a.byId('cloud').click();await flush();await flush();
 assert.equal(a.effects.fetches.length,2);const [[url,get],[postUrl,post]]=a.effects.fetches;
 assert.equal(url,'/api/practice/cloud');assert.equal(postUrl,url);assert.equal(get.method,'GET');assert.equal(post.method,'POST');assert.equal(get.signal,post.signal);
 assert.equal(post.body.get('target'),'ship');assert.equal(post.body.get('accent'),'en-us');assert.equal(post.body.get('audio').size,blob.size);assert.equal(post.body.get('audio').type,blob.type);
 assert.deepEqual([...post.body.keys()],['audio','target','accent']);assert.equal(post.headers,undefined);
 assert.equal(a.byId('feedback').querySelector('.read-feedback-heard').textContent,'Ship.');assert.match(a.byId('feedback').textContent,/ยังไม่มีคะแนน/);assert.doesNotMatch(a.byId('feedback').textContent,/%/);
});
test('cloud text is literal and a word match never creates a pronunciation percentage or success grade',async t=>{
 const transcript='<img src=x onerror=alert(1)> ship';
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():result('ship',transcript))});a.clip();a.byId('cloud').click();await flush();await flush();
 assert.equal(a.byId('feedback').querySelector('img'),null);assert.equal(a.byId('feedback').querySelector('.read-feedback-heard').textContent,transcript);
 assert.equal(a.byId('feedback').querySelector('[data-grade]'),null);assert.doesNotMatch(a.byId('feedback').textContent,/100|ผ่านแล้ว|ออกเสียงถูกต้อง/);
});
test('selection change aborts a pending cloud job and late old callbacks/results cannot activate or overwrite the new target',async t=>{
 const pending=deferred();const a=setup(t,{fetch:()=>pending.promise});a.clip();a.byId('cloud').click();const old=a.mounts[0],signal=a.effects.fetches[0][1].signal;
 a.byId('next').click();assert.equal(signal.aborted,true);const target=a.byId('prompt').textContent;assert.notEqual(target,'ship');
 old.onClipChange({blob:new a.w.Blob(['old'])});assert.equal(a.byId('cloud').disabled,true);pending.resolve(response(health()));await flush();await flush();
 assert.equal(a.effects.fetches.length,1);assert.equal(a.byId('prompt').textContent,target);assert.equal(a.byId('feedback').children.length,0);assert.equal(a.effects.cleanups,1);
});
test('new capture cancels an in-flight POST and stale cloud output cannot become feedback for the next clip',async t=>{
 const pending=deferred();const a=setup(t,{fetch:(_url,init)=>init.method==='GET'?Promise.resolve(response(health())):pending.promise});a.clip();a.byId('cloud').click();await flush();
 assert.equal(a.effects.fetches.length,2);const signal=a.effects.fetches[1][1].signal;
 a.mounts[0].onCaptureStateChange({recording:true});assert.equal(signal.aborted,true);assert.equal(a.byId('cloud').disabled,true);
 pending.resolve(response(result()));await flush();a.mounts[0].onCaptureStateChange({});a.clip(new a.w.Blob(['new']));
 assert.equal(a.byId('feedback').children.length,0);assert.equal(a.byId('cloud').disabled,false);
});
test('duplicate cloud clicks are blocked and explicit cancellation aborts the whole job while retaining the clip',async t=>{
 const pending=deferred();const a=setup(t,{fetch:()=>pending.promise});a.clip();a.byId('cloud').click();a.byId('cloud').click();assert.equal(a.effects.fetches.length,1);
 const signal=a.effects.fetches[0][1].signal;assert.equal(a.byId('cloud-cancel').hidden,false);a.byId('cloud-cancel').click();assert.equal(signal.aborted,true);
 assert.equal(a.byId('cloud').disabled,false);pending.resolve(response(health()));await flush();assert.equal(a.effects.fetches.length,1);
});
test('public and non-http origins cannot probe localhost or send cloud requests even after receiving a clip',async t=>{
 for(const url of ['https://a10u.github.io/english-garden-lab/app/read.html','https://garden.example/app/read.html','file:///app/read.html']){
  const a=setup(t,{url});a.clip();assert.equal(a.byId('cloud').disabled,true);assert.match(a.byId('cloud-notice').textContent,/local dev/);a.byId('cloud').dispatchEvent(new a.w.Event('click'));await flush();assert.equal(a.effects.fetches.length,0);
 }
});
test('unconfigured/exhausted health prevents audio upload and credit errors show only the backend message and billing link',async t=>{
 for(const state of [{configured:false},{...health(),remaining_calls:0}]){const a=setup(t,{fetch:async()=>response(state)});a.clip();a.byId('cloud').click();await flush();await flush();assert.equal(a.effects.fetches.length,1);assert.equal(a.byId('feedback').querySelector('.read-feedback-heard'),null);}
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():{error:{code:'cloud_credit_exhausted',message:'เครดิต API ไม่เพียงพอ'}},init.method==='GET'?200:429)});
 a.clip();a.byId('cloud').click();await flush();await flush();assert.match(a.byId('feedback').textContent,/เครดิต API ไม่เพียงพอ/);assert.ok(a.byId('feedback').querySelector('a').href.startsWith('https://platform.openai.com/'));assert.equal(a.byId('feedback').querySelector('.read-feedback-heard'),null);
});
test('malformed target or an invented pronunciation grade never renders as a valid cloud result',async t=>{
 for(const bad of [{...result(),target:'different'},{...result(),pronunciation_grade:100},{...result(),coaching:{summary:'Your pronunciation is100%',practiceTip:'Try again'}}]){
  const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():bad)});a.clip();a.byId('cloud').click();await flush();await flush();assert.equal(a.byId('feedback').querySelector('.read-feedback-heard'),null);assert.doesNotMatch(a.byId('feedback').textContent,/100/);
 }
});
test('page cleanup aborts cloud work and prevents late responses from mutating the page',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});a.clip();a.byId('cloud').click();const signal=a.effects.fetches[0][1].signal;
 a.w.dispatchEvent(new a.w.Event('pagehide'));assert.equal(signal.aborted,true);const prior=a.byId('status').textContent;pending.resolve(response(health()));await flush();await flush();assert.equal(a.byId('status').textContent,prior);assert.equal(a.effects.fetches.length,1);assert.equal(a.effects.cleanups,1);
});

test('custom English text remains literal and recordable without inventing example audio, IPA or word timings',async t=>{
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():result('<img src=x> I can read this.','I can read this.'))});
 a.byId('custom').value='<img src=x> I can read this.';a.byId('custom-use').click();
 assert.equal(a.byId('prompt').textContent,'<img src=x> I can read this.');assert.equal(a.byId('prompt').querySelector('img'),null);
 assert.equal(a.mounts.at(-1).precomputed,null);assert.equal(a.mounts.at(-1).text,'<img src=x> I can read this.');
 assert.equal(a.byId('listen').disabled,true);assert.equal(a.byId('audio').getAttribute('src'),null);assert.equal(a.byId('audio').hidden,true);
 assert.match(a.byId('cue-note').textContent,/ยังไม่มีเสียงตัวอย่าง/);assert.match(a.byId('ipa').textContent,/ยังไม่มีคำอ่านอ้างอิง/);
 const before=a.effects.plays.length;a.byId('listen').dispatchEvent(new a.w.Event('click'));assert.equal(a.effects.plays.length,before);
 a.clip();a.byId('cloud').click();await flush();await flush();assert.equal(a.effects.fetches[1][1].body.get('target'),'<img src=x> I can read this.');
});
test('custom input limits reject non-English alphabet/oversize text while an exact catalog phrase retains its licensed audio',t=>{
 const a=setup(t);
 for(const text of ['ภาษาไทย','123','x'.repeat(201),'']){a.byId('custom').value=text;a.byId('custom-use').click();assert.equal(a.byId('prompt').textContent,'ship');}
 a.byId('custom').value='This is a leaf.';a.byId('custom-use').click();assert.equal(a.byId('mode').value,'sentence');assert.equal(a.byId('listen').disabled,false);assert.ok(a.byId('audio').src.endsWith('tts-110.wav'));
 a.mounts.at(-1).onCaptureStateChange({recording:true});assert.equal(a.byId('custom').disabled,true);assert.equal(a.byId('custom-use').disabled,true);
});
test('the real recorder exposes its record/replay controls beside the prompt with microphone and phoneme details closed',t=>{
 const a=setup(t,{realWidget:true});
 const recorder=a.byId('recorder');assert.ok([...recorder.querySelectorAll('button')].find(button=>button.textContent==='บันทึกเสียงของฉัน'));
 assert.equal(recorder.querySelector('.read-microphone').open,false);assert.equal(recorder.querySelector('.egl-ph-optional-analysis').open,false);
 assert.deepEqual(a.effects.fetches,[]);assert.deepEqual(a.effects.plays,[]);
 a.byId('custom').value='Could you help me please?';a.byId('custom-use').click();assert.equal(a.byId('prompt').textContent,'Could you help me please?');
 assert.ok([...recorder.querySelectorAll('button')].find(button=>button.textContent==='บันทึกเสียงของฉัน'));
 assert.equal(recorder.querySelector('.egl-ph-optional-analysis').hidden,true);assert.equal(a.effects.fetches.length,0);
});

test('a loopback server without the cloud route fails plainly before uploading any audio',async t=>{
 const a=setup(t,{fetch:async()=>({ok:false,status:404,json:async()=>{throw new SyntaxError('HTML response');}})});a.clip();a.byId('cloud').click();await flush();await flush();
 assert.equal(a.effects.fetches.length,1);assert.match(a.byId('feedback').textContent,/local dev/);assert.doesNotMatch(a.byId('feedback').textContent,/SyntaxError|HTML response/);
});

test('own-clip replay pauses the example and clears its cue instead of mixing two voices',t=>{
 const a=setup(t);a.byId('listen').click();assert.ok(a.byId('prompt').querySelector('.is-reading'));
 const own=a.byId('recorder').querySelector('.egl-ph-player');own.play();
 assert.equal(a.byId('audio').paused,true);assert.equal(a.byId('prompt').querySelector('.is-reading'),null);
 assert.equal(own.paused,false);
});

test('an authored coaching fallback is labeled separately from the literal cloud transcript',async t=>{
 const body=result();body.coaching.provider_output_used=false;body.coaching_warning={code:'cloud_credit_exhausted',message:'เครดิต API ไม่เพียงพอสำหรับคำแนะนำ'};
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():body)});a.clip();a.byId('cloud').click();await flush();await flush();
 assert.equal(a.byId('feedback').querySelector('.read-feedback-heard').textContent,'Ship.');
 assert.match(a.byId('feedback').textContent,/แบบฝึกทั่วไปที่เตรียมไว้.*คำแนะนำจากโมเดลไม่พร้อมใช้/);
 assert.doesNotMatch(a.byId('feedback').textContent,/แบบฝึกทั่วไปที่ AI เลือก/);assert.match(a.byId('feedback').textContent,/เครดิต API ไม่เพียงพอ/);assert.ok(a.byId('feedback').querySelector('a').href.startsWith('https://platform.openai.com/'));
});
