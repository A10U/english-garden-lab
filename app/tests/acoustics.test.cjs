const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(base,'acoustics.html'),'utf8');
const source=fs.readFileSync(path.join(base,'acoustics.js'),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
const health=()=>({configured:true,source:'local_praat',measurement_type:'acoustic_signal',pronunciation_grade:null});
function wav({duration=.5,rate=48000,channels=1,float=false,nonfinite=false}={}){
 const frames=Math.round(duration*rate),width=float?4:2,data=Buffer.alloc(44+frames*channels*width);
 data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(float?3:1,20);data.writeUInt16LE(channels,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*channels*width,28);data.writeUInt16LE(channels*width,32);data.writeUInt16LE(width*8,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
 for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){const at=44+(frame*channels+channel)*width;const value=Math.sin(frame/rate*2*Math.PI*180)*.2;if(float)data.writeFloatLE(nonfinite&&frame===10?NaN:value,at);else data.writeInt16LE(Math.round(value*32767),at);}
 return data;
}
function result(start=0,end=.5,vowel=false){
 const frames=[{time_seconds:.02,value_hz:180},{time_seconds:.03,value_hz:181},{time_seconds:.04,value_hz:null},{time_seconds:.05,value_hz:182},{time_seconds:.06,value_hz:183}];
 return{schema_version:1,measurement_type:'acoustic_signal',source:'local_praat',pronunciation_grade:null,input:{sample_rate_hz:48000,channels:1,frames:24000,duration_seconds:.5},selection:{start_sample:Math.round(start*48000),end_sample:Math.round(end*48000),start_seconds:start,end_seconds:end,duration_ms:(end-start)*1000,boundary_source:'user_selected',vowel_confirmed:vowel},engine:{name:'Praat',version:'7.0.02',normalization:'none',analysis_context:'full_original_sound',settings:{pitch_floor_hz:50,pitch_top_hz:800,formant_ceiling_hz:5500}},f0:{status:'ok',reason:null,median_hz:181.5,q25_hz:180.75,q75_hz:182.25,voiced_frames:4,total_frames:5,coverage:.8,frames},formants:{status:'unreliable',reason:'formant_ceiling_sensitive',tracks:[1,2,3].map(index=>({index,median_hz:index*700,q25_hz:index*700-20,q75_hz:index*700+20,valid_frames:4})),frames:frames.map((row,index)=>({time_seconds:row.time_seconds,f1_hz:index===2?null:700,f2_hz:index===2?null:1400,f3_hz:index===2?null:2100})),sensitivity:[{ceiling_hz:4950,medians_hz:[680,1400,2100]},{ceiling_hz:5500,medians_hz:[700,1400,2100]},{ceiling_hz:6050,medians_hz:[760,1400,2100]}]},flags:['unconfirmed_vowel_boundaries','formant_ceiling_sensitive']};
}
function setup(t,options={}){
 const dom=new JSDOM(html,{url:options.url||'http://127.0.0.1:5173/app/acoustics.html',runScripts:'outside-only'}),w=dom.window,effects={fetches:[],plays:0,urls:[],revoked:[],mounts:[],cleanups:0};
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.play=function(){effects.plays++;return Promise.resolve();};
 w.URL.createObjectURL=blob=>{effects.urls.push(blob);return'blob:acoustic-'+effects.urls.length;};w.URL.revokeObjectURL=url=>effects.revoked.push(url);
 w.fetch=(url,init)=>{effects.fetches.push([url,init]);return options.fetch?options.fetch(url,init):Promise.reject(new Error('Network forbidden unless explicit'));};
 w.Storage.prototype.setItem=()=>{throw new Error('No acoustic recording persistence');};
 if(options.publicRuntime)w.EGL_DEMO_RUNTIME={mode:'demo'};
 if(options.realWidget){w.eval(fs.readFileSync(path.join(base,'phonetics.js'),'utf8'));const mount=w.EGLPhonetics.mount;w.EGLPhonetics={mount(node,config){effects.mounts.push(config);const cleanup=mount(node,config);return()=>{effects.cleanups++;cleanup();};}};}
 else w.EGLPhonetics={mount(node,config){effects.mounts.push(config);node.innerHTML='<div class="egl-ph-input-controls">Microphone settings</div><details class="egl-ph-optional-analysis"><button>Analyze phonemes</button></details><details class="egl-ph-upload">Upload</details>';config.onCaptureStateChange({});return()=>{effects.cleanups++;node.replaceChildren();};}};
 w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const id=name=>w.document.getElementById('ac-'+name);
 async function load(data=wav(),name='fixture.wav'){
  const file=new w.File([data],name,{type:'audio/wav'});Object.defineProperty(id('file'),'files',{configurable:true,value:[file]});id('file').dispatchEvent(new w.Event('change'));for(let i=0;i<40&&!id('clip').textContent.includes('Hz')&&!/WAV|วินาที/.test(id('status').textContent);i++)await flush();await flush();return file;
 }
 t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
 return{w,id,effects,load,change(name,value){const node=id(name);if(typeof value==='boolean')node.checked=value;else node.value=value;node.dispatchEvent(new w.Event('input'));},async measure(){id('measure').click();await flush();await flush();}};
}
async function bytes(w,blob){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(Buffer.from(r.result));r.onerror=reject;r.readAsArrayBuffer(blob);});}

test('mount is idle, uses recording-only capture, and hides phonetic analysis without opening audio or network',t=>{
 const a=setup(t,{realWidget:true});assert.equal(a.effects.fetches.length,0);assert.equal(a.effects.plays,0);assert.equal(a.effects.urls.length,0);assert.equal(a.effects.mounts[0].recordingOnly,true);assert.equal(a.id('recorder').querySelector('.egl-ph-optional-analysis'),null);assert.equal(a.id('recorder').querySelector('.egl-ph-upload'),null);assert.equal(a.id('measure').disabled,true);assert.equal(a.id('recorder').querySelector('.egl-ph-input-controls').parentElement.open,false);assert.equal(a.w.EGLBrowserPhonetics,undefined);
});
test('PCM and float WAV parsing uses exact original frames/rate without audio context or ASR',async t=>{
 const a=setup(t);a.w.AudioContext=function(){throw new Error('Do not resample imported audio');};
 const data=wav({duration:120832/48000,float:true,channels:2});await a.load(data);
 assert.match(a.id('clip').textContent,/48000 Hz · 2 ช่อง/);assert.equal(Number(a.id('end').value),120832/48000);assert.equal(a.effects.fetches.length,0);assert.equal(a.effects.plays,0);assert.equal(a.id('vowel').checked,false);assert.match(a.id('duration').textContent,/ความยาวช่วงที่เลือก/);assert.ok(a.id('waveform').querySelector('polygon'));assert.equal(a.id('measure').disabled,false);
});
test('explicit measurement checks same-origin health then sends original float WAV bytes and only acoustic fields',async t=>{
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():result(.1,.3,true))});
 const data=wav({float:true});await a.load(data);a.change('start','.1');a.change('end','.3');a.change('vowel',true);await a.measure();
 assert.equal(a.effects.fetches.length,2);const [[url,get],[postURL,post]]=a.effects.fetches;assert.equal(url,'/api/acoustics/measure');assert.equal(postURL,url);assert.equal(get.method,'GET');assert.equal(post.method,'POST');assert.equal(get.signal,post.signal);assert.equal(post.headers,undefined);assert.equal(post.credentials,'same-origin');
 assert.deepEqual([...post.body.keys()],['audio','start_seconds','end_seconds','settings','vowel_confirmed']);assert.equal(post.body.get('start_seconds'),'.1'.replace(/^\./,'0.'));assert.equal(post.body.get('end_seconds'),'0.3');assert.equal(post.body.get('vowel_confirmed'),'true');assert.deepEqual(JSON.parse(post.body.get('settings')),{pitch_floor_hz:50,pitch_top_hz:800,formant_ceiling_hz:5500});assert.deepEqual(await bytes(a.w,post.body.get('audio')),data);
 assert.equal(a.id('results').hidden,false);assert.match(a.id('result-selection').textContent,/ช่วงสระที่คุณเลือก: 200.0 ms/);assert.match(a.id('summary').textContent,/181.5 Hz/);assert.match(a.id('summary').textContent,/Q25–Q75/);assert.doesNotMatch(a.id('summary').textContent,/%|ผ่าน|ถูกต้อง/);
});
test('full-clip curves keep null gaps and selection shading while summaries label only the selected interval',async t=>{
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():result(.1,.3))});await a.load();a.change('start','.1');a.change('end','.3');await a.measure();
 assert.equal(a.id('pitch').querySelectorAll('polyline[data-series="F0"]').length,2);assert.equal(a.id('formants').querySelectorAll('polyline[data-series="F1"]').length,2);assert.equal(a.id('pitch').querySelectorAll('.ac-selected').length,1);assert.match(a.id('pitch').textContent,/0.000 s.*0.500 s/);assert.match(a.id('result-selection').textContent,/ความยาวช่วงที่เลือก: 200.0 ms/);assert.match(a.id('flags').textContent,/ค่าฟอร์แมนต์เปลี่ยนมาก|ค่าฟอร์แมนต์ไว/);
});
test('unknown/unvoiced measurements show dashes and reliability information without drawing zero-valued pitch',async t=>{
 const r=result();r.f0={...r.f0,status:'unavailable',reason:'no_voiced_frames',median_hz:null,q25_hz:null,q75_hz:null,voiced_frames:0,coverage:0,frames:r.f0.frames.map(row=>({...row,value_hz:null}))};r.formants={...r.formants,status:'insufficient_interval',reason:'shorter_than_formant_window',tracks:r.formants.tracks.map(row=>({...row,median_hz:null,q25_hz:null,q75_hz:null,valid_frames:0})),frames:[]};r.flags=['full_scale_input_samples'];
 const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():r)});await a.load();await a.measure();assert.equal(a.id('results').hidden,false);assert.equal(a.id('pitch').querySelectorAll('polyline,circle').length,0);assert.match(a.id('summary').textContent,/—/);assert.match(a.id('flags').textContent,/เต็มสเกล/);assert.doesNotMatch(a.id('flags').textContent,/ไมค์เสีย|คลิปปิงแน่นอน/);
});
test('invalid bounds/settings reject before health or upload and never invent a duration',async t=>{
 for(const [field,value] of [['end','0'],['start','-1'],['end','1'],['floor','301'],['top','90'],['ceiling','8001']]){
  const a=setup(t);await a.load();a.change(field,value);await a.measure();assert.equal(a.effects.fetches.length,0);assert.equal(a.id('results').hidden,true);
 }
 const a=setup(t);await a.load(wav({rate:16000}));a.change('ceiling','8000');await a.measure();assert.equal(a.effects.fetches.length,0);assert.match(a.id('status').textContent,/สูงเกินอัตราเสียง/);
});
test('unsupported, short, nonfinite and oversized WAV files never become measurable',async t=>{
 for(const data of [wav({duration:.1}),wav({rate:8000}),wav({channels:3}),wav({float:true,nonfinite:true}),Buffer.from('not WAV'),Buffer.alloc(10*1024*1024+1)]){
  const a=setup(t);await a.load(data);assert.equal(a.id('measure').disabled,true);assert.equal(a.effects.fetches.length,0);assert.equal(a.id('waveform').children.length,0);assert.equal(a.id('results').hidden,true);
 }
});
test('public origins and built demo runtime never probe localhost even with an explicitly dispatched click',async t=>{
 for(const options of [{url:'https://a10u.github.io/english-garden-lab/app/acoustics.html'},{url:'file:///app/acoustics.html'},{url:'http://127.0.0.1:5173/app/acoustics.html',publicRuntime:true}]){
  const a=setup(t,options);await a.load();assert.equal(a.id('measure').disabled,true);a.id('measure').dispatchEvent(new a.w.Event('click'));await flush();assert.equal(a.effects.fetches.length,0);assert.match(a.id('local-notice').textContent,/local dev/);
 }
});
test('selection, settings and vowel-confirmation changes abort in-flight measurement and discard late results',async t=>{
 for(const [field,value] of [['start','.1'],['floor','60'],['vowel',true]]){
  const pending=deferred(),a=setup(t,{fetch:(_url,init)=>init.method==='GET'?Promise.resolve(response(health())):pending.promise});await a.load();a.id('measure').click();await flush();assert.equal(a.effects.fetches.length,2);const signal=a.effects.fetches[1][1].signal;a.change(field,value);assert.equal(signal.aborted,true);pending.resolve(response(result()));await flush();assert.equal(a.id('results').hidden,true);assert.equal(a.id('summary').children.length,0);assert.equal(a.id('measure').disabled,false);
 }
});
test('replacing a clip and starting capture cancel work, clear bounds/results and revoke old playback URLs',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});await a.load();a.id('measure').click();const signal=a.effects.fetches[0][1].signal;await a.load(wav({duration:.3}),'new.wav');assert.equal(signal.aborted,true);assert.equal(Number(a.id('end').value),.3);assert.equal(a.effects.revoked.length,1);pending.resolve(response(health()));await flush();assert.equal(a.effects.fetches.length,1);
 a.effects.mounts[0].onCaptureStateChange({requesting:true});assert.equal(a.id('measure').disabled,true);assert.equal(a.id('results').hidden,true);assert.equal(a.id('start').value,'');assert.equal(a.id('vowel').checked,false);assert.equal(a.id('file').disabled,true);
});
test('duplicate clicks, explicit cancel, unavailable health and backend errors do not upload unexpectedly',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});await a.load();a.id('measure').click();a.id('measure').click();assert.equal(a.effects.fetches.length,1);const signal=a.effects.fetches[0][1].signal;a.id('cancel').click();assert.equal(signal.aborted,true);assert.equal(a.id('measure').disabled,false);pending.resolve(response(health()));await flush();assert.equal(a.effects.fetches.length,1);
 const b=setup(t,{fetch:async()=>response({...health(),configured:false})});await b.load();await b.measure();assert.equal(b.effects.fetches.length,1);assert.match(b.id('status').textContent,/ยังไม่พร้อม/);
 const c=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():{error:{code:'analysis_timeout',message:'การวัดหมดเวลา'}},init.method==='GET'?200:504)});await c.load();await c.measure();assert.match(c.id('status').textContent,/การวัดหมดเวลา/);assert.equal(c.id('results').hidden,true);
});
test('wrong clip/selection, invented grade and malformed curves are rejected without partial result rendering',async t=>{
 for(const mutate of [r=>r.pronunciation_grade=100,r=>r.input.frames=24001,r=>r.selection.end_seconds=.4,r=>r.f0.frames[0].value_hz='180',r=>r.formants.tracks[0].median_hz=NaN]){
  const bad=result();mutate(bad);const a=setup(t,{fetch:async(_url,init)=>response(init.method==='GET'?health():bad)});await a.load();await a.measure();assert.equal(a.id('results').hidden,true);assert.equal(a.id('summary').children.length,0);
 }
});
test('pagehide aborts work, releases playback and ignores late callbacks',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});await a.load();a.id('measure').click();const signal=a.effects.fetches[0][1].signal;a.w.dispatchEvent(new a.w.Event('pagehide'));assert.equal(signal.aborted,true);assert.equal(a.effects.cleanups,1);assert.equal(a.effects.revoked.length,1);const prior=a.id('status').textContent;pending.resolve(response(health()));await flush();a.effects.mounts[0].onClipChange({blob:new a.w.Blob([wav()])});assert.equal(a.id('status').textContent,prior);assert.equal(a.effects.fetches.length,1);
});

test('selected playback copies sample-aligned original PCM bytes only on click, and revokes its URL on edits or cancel',async t=>{
 const a=setup(t),data=wav({float:true,channels:2});await a.load(data);a.change('start','.10001');a.change('end','.20001');assert.equal(a.effects.plays,0);assert.equal(a.effects.urls.length,1);
 a.id('selection-play').click();assert.equal(a.effects.plays,1);assert.equal(a.effects.urls.length,2);const cut=await bytes(a.w,a.effects.urls[1]),first=Math.floor(.10001*48000+.5),last=Math.floor(.20001*48000+.5);assert.equal(cut.readUInt32LE(24),48000);assert.equal(cut.readUInt16LE(20),3);assert.equal(cut.readUInt16LE(22),2);assert.equal(cut.length,44+(last-first)*8);assert.deepEqual(cut.subarray(44),data.subarray(44+first*8,44+last*8));assert.equal(a.effects.fetches.length,0);
 a.change('end','.25');assert.equal(a.effects.revoked.length,1);assert.equal(a.id('selection-stop').disabled,true);a.id('selection-play').click();assert.equal(a.effects.plays,2);a.id('selection-stop').click();assert.equal(a.effects.revoked.length,2);assert.equal(a.id('selection-stop').disabled,true);
});
test('selection sliders retain numeric controls and abort stale measurement work',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});await a.load();a.id('measure').click();const signal=a.effects.fetches[0][1].signal;a.change('start-range','.1');assert.equal(Number(a.id('start').value),.1);assert.equal(signal.aborted,true);assert.match(a.id('duration').textContent,/400.0 ms/);pending.resolve(response(health()));await flush();assert.equal(a.effects.fetches.length,1);assert.equal(a.id('results').hidden,true);
});
test('late file decoding and the UI deadline cannot restore old clips or stale results',async t=>{
 const pending=deferred(),a=setup(t,{fetch:()=>pending.promise});const old=new a.w.File([wav()],'old.wav',{type:'audio/wav'});Object.defineProperty(old,'arrayBuffer',{value:()=>pending.promise});a.effects.mounts[0].onClipChange({blob:old});await a.load(wav({duration:.3}),'new.wav');const original=new a.w.ArrayBuffer(wav().length);new a.w.Uint8Array(original).set(wav());pending.resolve(original);await flush();assert.match(a.id('clip').textContent,/new.wav/);assert.equal(Number(a.id('end').value),.3);
 const wait=deferred(),b=setup(t,{fetch:()=>wait.promise});await b.load();const oldSet=b.w.setTimeout;let deadline;b.w.setTimeout=(fn,delay)=>delay===30000?(deadline=fn,12345):oldSet(fn,delay);b.id('measure').click();assert.equal(typeof deadline,'function');const signal=b.effects.fetches[0][1].signal;deadline();assert.equal(signal.aborted,true);assert.match(b.id('status').textContent,/30 วินาที/);assert.equal(b.id('measure').disabled,false);wait.resolve(response(health()));await flush();assert.equal(b.effects.fetches.length,1);
});
