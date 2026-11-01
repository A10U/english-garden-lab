/* Local acoustic measurements: preserve the original WAV; no ASR or grades. */
(function (global) {
  'use strict';
  const MAX_BYTES = 10 * 1024 * 1024;
  const SVG = 'http://www.w3.org/2000/svg';
  const REASONS = {shorter_than_pitch_window:'ช่วงที่เลือกสั้นกว่าหน้าต่างวัด F0',low_signal:'ระดับสัญญาณต่ำ',no_voiced_frames:'ยังไม่มีเฟรมที่ตรวจพบความเป็นคาบในช่วงนี้',low_voiced_coverage:'มีเฟรมที่วัด F0 ได้เพียงบางส่วน',pitch_discontinuity:'เส้น F0 เปลี่ยนกระโดด ควรฟังและตรวจเส้นร่วมกัน',shorter_than_formant_window:'ช่วงที่เลือกสั้นกว่าหน้าต่างวัดฟอร์แมนต์',no_valid_voiced_formant_frames:'ยังไม่มีเฟรมฟอร์แมนต์ที่ใช้สรุปได้',few_valid_frames:'มีเฟรมที่ใช้สรุปได้จำนวนน้อย',formant_ceiling_sensitive:'ค่าฟอร์แมนต์เปลี่ยนมากเมื่อเปลี่ยนเพดานการค้นหา',formant_sensitivity_incomplete:'ข้อมูลการลองหลายเพดานยังไม่ครบ จึงยืนยันความนิ่งไม่ได้',low_formant_coverage:'มีเฟรมฟอร์แมนต์ที่ใช้ได้เพียงบางส่วน',partial_formant_tracks:'มีค่าได้เพียงบางเส้นฟอร์แมนต์'};
  const FLAGS = {unconfirmed_vowel_boundaries:'ยังไม่ได้ยืนยันว่าขอบเขตที่เลือกเป็นช่วงสระ',stereo_averaged:'ไฟล์สเตอริโอใช้ค่าเฉลี่ยสองช่องเพื่อวัด',full_scale_input_samples:'พบตัวอย่างเสียงแตะหรือเกินระดับเต็มสเกล ควรตรวจรูปคลื่นร่วมด้วย',dc_offset:'พบค่ากลางสัญญาณเลื่อนจากศูนย์',low_signal:'ระดับสัญญาณในช่วงที่เลือกต่ำ',pitch_interval_too_short:'ช่วงที่เลือกสั้นกว่าหน้าต่างวัด F0',low_voiced_coverage:'มีเฟรมที่วัด F0 ได้เพียงบางส่วน',pitch_discontinuity:'เส้น F0 เปลี่ยนกระโดด ควรตรวจร่วมกับเสียง',formant_interval_too_short:'ช่วงที่เลือกสั้นกว่าหน้าต่างวัดฟอร์แมนต์',invalid_formant_frames:'บางเฟรมฟอร์แมนต์ใช้สรุปไม่ได้',formant_ceiling_sensitive:'ค่าฟอร์แมนต์ไวต่อการเปลี่ยนเพดานค้นหา',few_formant_frames:'เฟรมฟอร์แมนต์ที่ใช้สรุปได้มีจำนวนน้อย',formant_sensitivity_incomplete:'ข้อมูลการลองหลายเพดานยังไม่ครบ จึงยืนยันความนิ่งไม่ได้',low_formant_coverage:'มีเฟรมฟอร์แมนต์ที่ใช้ได้เพียงบางส่วน',partial_formant_tracks:'มีค่าได้เพียงบางเส้นฟอร์แมนต์'};
  const QUALITY = {ok:'มีค่าประมาณให้ดู',unreliable:'ค่าประมาณยังไม่นิ่ง',insufficient_interval:'ช่วงนี้สั้นหรือมีข้อมูลไม่พอ',unavailable:'ยังคำนวณค่านี้ไม่ได้'};
  function decodeWave(bytes) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 44 || bytes.byteLength > MAX_BYTES) throw new Error('เลือกไฟล์ WAV ที่ไม่ว่างและไม่เกิน 10 MB');
    const view = new DataView(bytes), tag = at => String.fromCharCode(...new Uint8Array(bytes, at, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4,true) + 8 !== bytes.byteLength) throw new Error('ไฟล์ WAV ไม่สมบูรณ์ หรือรูปแบบนี้ยังไม่รองรับ');
    let format = null, data = null;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const size = view.getUint32(offset + 4,true), start = offset + 8;
      if (start + size > bytes.byteLength) throw new Error('ไฟล์ WAV มีข้อมูลไม่ครบ');
      if (tag(offset) === 'fmt ') {
        if (format || size < 16) throw new Error('ข้อมูลรูปแบบ WAV ไม่ถูกต้อง');
        format = {kind:view.getUint16(start,true),channels:view.getUint16(start+2,true),rate:view.getUint32(start+4,true),byteRate:view.getUint32(start+8,true),align:view.getUint16(start+12,true),bits:view.getUint16(start+14,true)};
      }
      if (tag(offset) === 'data') {if (data) throw new Error('WAV ต้องมีช่วงข้อมูลเสียงเดียว');data={start,size};}
      offset = start + size + size % 2;
    }
    if (!format || !data || !data.size || ![1,2].includes(format.channels) || format.rate < 16000 || format.rate > 96000
      || !((format.kind === 1 && format.bits === 16) || (format.kind === 3 && format.bits === 32))
      || format.align !== format.channels * format.bits / 8 || format.byteRate !== format.rate * format.align || data.size % format.align) {
      throw new Error('ใช้ WAV PCM 16 บิต หรือ float 32 บิต โมโน/สเตอริโอ 16–96 kHz');
    }
    const frames = data.size / format.align, duration = frames / format.rate;
    if (duration < .2 || duration > 15) throw new Error('เลือกเสียงยาว 0.2 ถึง 15 วินาที');
    const samples = new Float32Array(frames), sampleBytes = format.bits / 8;
    for (let frame = 0; frame < frames; frame++) {
      let sum = 0;
      for (let channel = 0; channel < format.channels; channel++) {
        const at = data.start + frame * format.align + channel * sampleBytes;
        const value = format.kind === 1 ? view.getInt16(at,true)/32768 : view.getFloat32(at,true);
        if (!Number.isFinite(value) || Math.abs(value)>16) throw new Error('ไฟล์เสียงมีค่าที่ไม่สามารถวัดได้');
        sum += value / format.channels;
      }
      samples[frame] = sum;
    }
    return {samples,rate:format.rate,channels:format.channels,bits:format.bits,duration,waveBytes:bytes,dataStart:data.start,blockAlign:format.align,kind:format.kind};
  }
  function segments(frames, key, start, end, low, high) {
    const runs = []; let run = [];
    for (const frame of frames) {
      const value = frame[key];
      if (!Number.isFinite(value) || value < low || value > high) {if (run.length) runs.push(run);run=[];continue;}
      run.push([48+(frame.time_seconds-start)/(end-start)*692,214-(value-low)/(high-low)*190]);
    }
    if (run.length) runs.push(run);
    return runs;
  }
  function mount(doc, widget) {
    if (!doc) return null;
    const win = doc.defaultView, id = name => doc.getElementById('ac-'+name);
    const ui = Object.fromEntries(['file','recorder','clip','audio','waveform','waveform-note','start','end','start-range','end-range','selection-play','selection-stop','selection-audio','duration','vowel','floor','top','ceiling','measure','cancel','status','results','result-selection','summary','pitch','formants','flags','engine','sensitivity','local-notice'].map(name=>[name,id(name)]));
    if (Object.values(ui).some(node=>!node)) return null;
    const local = /^https?:$/.test(win.location.protocol) && ['127.0.0.1','localhost','[::1]'].includes(win.location.hostname) && win.EGL_DEMO_RUNTIME?.mode !== 'demo';
    let disposed = false, revision = 0, clip = null, audio = null, clipURL = null, selectionURL = null, captureBusy = false, decoding = null, job = null, recorderCleanup = null;
    const listeners = [];
    const on = (node,type,fn,options) => {node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));};
    const el = (tag,text,cls) => {const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
    const svg = (tag,attrs,text) => {const node=doc.createElementNS(SVG,tag);for(const [key,value] of Object.entries(attrs||{}))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;};
    const status = text => {if(!disposed)ui.status.textContent=text;};
    function clearResults() {ui.results.hidden=true;for(const key of ['summary','pitch','formants','flags','sensitivity'])ui[key].replaceChildren();ui.engine.textContent='';ui['result-selection'].textContent='';}
    function abortJob() {const old=job;job=null;if(old){win.clearTimeout(old.timer);old.controller.abort();}}
    function invalidate(message) {revision++;abortJob();stopSelection();clearResults();update();if(message)status(message);}
    function update() {
      ui.file.disabled=captureBusy;
      for(const key of ['start','end','start-range','end-range','vowel','selection-play'])ui[key].disabled=!audio||captureBusy;
      for(const key of ['floor','top','ceiling'])ui[key].disabled=captureBusy;
      ui.measure.disabled=!local||!clip||!audio||captureBusy||Boolean(decoding)||Boolean(job);
      ui.cancel.hidden=!job;ui['selection-stop'].disabled=!selectionURL;
      ui.audio.controls=!captureBusy;
    }
    function bounds() {
      if(!audio||!ui.start.value.trim()||!ui.end.value.trim())throw new Error('เลือกจุดเริ่มและจุดจบก่อนครับ');
      const start=Number(ui.start.value),end=Number(ui.end.value);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>audio.duration||end-start<1/audio.rate)throw new Error('จุดจบต้องอยู่หลังจุดเริ่ม และอยู่ภายในคลิป');
      return {start,end};
    }
    function settings() {
      const value={pitch_floor_hz:Number(ui.floor.value),pitch_top_hz:Number(ui.top.value),formant_ceiling_hz:Number(ui.ceiling.value)};
      if(!Object.values(value).every(Number.isFinite)||value.pitch_floor_hz<40||value.pitch_floor_hz>300||value.pitch_top_hz<150||value.pitch_top_hz>1500||value.pitch_top_hz<2*value.pitch_floor_hz||value.formant_ceiling_hz<3500||value.formant_ceiling_hz>8000)throw new Error('ตรวจช่วง F0 และเพดานฟอร์แมนต์ตามขอบเขตในช่องตั้งค่า');
      if(audio&&value.formant_ceiling_hz*1.1>=audio.rate/2)throw new Error('เพดานฟอร์แมนต์สูงเกินอัตราเสียงของไฟล์นี้ ลองลดค่านี้ก่อนวัด');
      return value;
    }
    function drawWave() {
      ui.waveform.replaceChildren();if(!audio)return;
      ui.waveform.append(svg('line',{x1:38,y1:82,x2:740,y2:82,class:'ac-axis'}));
      const step=Math.max(1,Math.ceil(audio.samples.length/700)),upper=[],lower=[];
      let peak=1;for(const value of audio.samples)peak=Math.max(peak,Math.abs(value));
      for(let at=0;at<audio.samples.length;at+=step){let lo=0,hi=0;for(let i=at;i<Math.min(at+step,audio.samples.length);i++){lo=Math.min(lo,audio.samples[i]);hi=Math.max(hi,audio.samples[i]);}const x=38+at/(audio.samples.length-1)*702;upper.push(x+','+(82-hi/peak*65));lower.push(x+','+(82-lo/peak*65));}
      ui.waveform.append(svg('polygon',{points:upper.concat(lower.reverse()).join(' '),class:'ac-wave'}));
      try {const {start,end}=bounds();ui.waveform.append(svg('rect',{x:38+start/audio.duration*702,y:10,width:(end-start)/audio.duration*702,height:144,class:'ac-selected'}));}catch(_){}
      ui.waveform.append(svg('text',{x:38,y:171,class:'ac-graph-label'},'0 s'),svg('text',{x:740,y:171,'text-anchor':'end',class:'ac-graph-label'},audio.duration.toFixed(3)+' s'));
    }
    function selectionChanged() {
      invalidate('เปลี่ยนช่วงหรือการตั้งค่าแล้ว กดวัดเพื่อดูค่าใหม่');
      try{const {start,end}=bounds();ui.duration.textContent=(ui.vowel.checked?'ช่วงสระที่คุณเลือก':'ความยาวช่วงที่เลือก')+': '+((end-start)*1000).toFixed(1)+' ms · ขอบเขตที่คุณกำหนดเอง';}catch(_){ui.duration.textContent='ความยาวช่วงที่เลือก: —';}
      if(audio){ui['start-range'].value=ui.start.value;ui['end-range'].value=ui.end.value;}
      drawWave();
    }
    function stopSelection() {ui['selection-audio'].pause();ui['selection-audio'].removeAttribute('src');if(selectionURL){win.URL.revokeObjectURL(selectionURL);selectionURL=null;}ui['selection-stop'].disabled=true;}
    function playSelection() {
      if(disposed||captureBusy||!audio||!win.URL.createObjectURL)return;
      let selected;try{selected=bounds();}catch(error){status(error.message);return;}
      stopSelection();ui.audio.pause();
      const first=Math.floor(selected.start*audio.rate+.5),last=Math.floor(selected.end*audio.rate+.5),length=(last-first)*audio.blockAlign;
      const bytes=new ArrayBuffer(44+length),view=new DataView(bytes),write=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
      write(0,'RIFF');view.setUint32(4,36+length,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,audio.kind,true);view.setUint16(22,audio.channels,true);view.setUint32(24,audio.rate,true);view.setUint32(28,audio.rate*audio.blockAlign,true);view.setUint16(32,audio.blockAlign,true);view.setUint16(34,audio.bits,true);write(36,'data');view.setUint32(40,length,true);
      new Uint8Array(bytes,44).set(new Uint8Array(audio.waveBytes,audio.dataStart+first*audio.blockAlign,length));
      selectionURL=win.URL.createObjectURL(new win.Blob([bytes],{type:'audio/wav'}));const url=selectionURL;ui['selection-audio'].src=url;ui['selection-stop'].disabled=false;
      try{const playing=ui['selection-audio'].play();if(playing?.catch)playing.catch(()=>{if(!disposed&&selectionURL===url){stopSelection();status('เบราว์เซอร์ยังเล่นช่วงนี้ไม่ได้ ลองฟังคลิปเต็มและตรวจช่วงอีกครั้ง');}});}catch(_){stopSelection();status('ยังเล่นช่วงนี้ไม่ได้ ลองฟังคลิปเต็ม');}
    }
    function releaseAudio() {stopSelection();ui.audio.pause();ui.audio.removeAttribute('src');ui.audio.hidden=true;if(clipURL){win.URL.revokeObjectURL(clipURL);clipURL=null;}}
    function readBytes(blob, signal) {
      if(typeof blob.arrayBuffer==='function')return blob.arrayBuffer();
      return new Promise((resolve,reject)=>{const reader=new win.FileReader();const cancel=()=>{reader.abort();reject(new win.DOMException('Canceled','AbortError'));};signal.addEventListener('abort',cancel,{once:true});const finish=()=>signal.removeEventListener('abort',cancel);reader.onload=()=>{finish();resolve(reader.result);};reader.onerror=()=>{finish();reject(new Error('อ่านไฟล์เสียงไม่ได้'));};reader.onabort=finish;reader.readAsArrayBuffer(blob);});
    }
    async function loadClip(blob,label) {
      if(disposed)return;
      invalidate();decoding?.abort();decoding=null;releaseAudio();clip=null;audio=null;ui.start.value='';ui.end.value='';ui.vowel.checked=false;ui.waveform.replaceChildren();ui.duration.textContent='ความยาวช่วงที่เลือก: —';
      ui['waveform-note'].textContent='รูปคลื่นจะปรากฏเมื่อเลือกเสียงแล้ว';ui.clip.textContent='ยังไม่มีคลิปเสียง';update();
      if(!blob){status('เลือกเสียงเพื่อเริ่มต้น');return;}
      if(!blob.size||blob.size>MAX_BYTES){status('เลือกไฟล์ WAV ที่ไม่ว่างและไม่เกิน 10 MB');return;}
      const controller=new win.AbortController();decoding=controller;status('กำลังอ่านรูปคลื่นในเบราว์เซอร์…');update();
      try {
        const bytes=await readBytes(blob,controller.signal);
        if(disposed||decoding!==controller||controller.signal.aborted)return;
        const decoded=decodeWave(bytes);
        clip=blob;audio=decoded;ui.start.value='0';ui.end.value=String(audio.duration);ui.start.max=ui.end.max=ui['start-range'].max=ui['end-range'].max=String(audio.duration);
        ui.clip.textContent=(label||'คลิปของฉัน')+' · '+audio.duration.toFixed(3)+' s · '+audio.rate+' Hz · '+audio.channels+' ช่องเสียง · เก็บต้นฉบับไว้สำหรับวัด';
        ui['waveform-note'].textContent='รูปคลื่นแสดงคลิปเต็ม · ช่วงสีอ่อนคือขอบเขตที่คุณกำหนด';
        if(win.URL.createObjectURL){clipURL=win.URL.createObjectURL(blob);ui.audio.src=clipURL;ui.audio.hidden=false;}
        selectionChanged();status('เลือกจุดเริ่มกับจุดจบ แล้วกด “วัดช่วงเสียงนี้”');
      } catch(error) {if(!disposed&&decoding===controller&&!controller.signal.aborted)status(error.message||'อ่านไฟล์ WAV ไม่ได้');}
      finally {if(decoding===controller){decoding=null;update();}}
    }
    const finite = value => typeof value==='number'&&Number.isFinite(value);
    const hz = value => value===null||finite(value)&&value>0&&value<20000;
    function validateResult(result,active) {
      if(!result||result.schema_version!==1||result.measurement_type!=='acoustic_signal'||result.source!=='local_praat'||result.pronunciation_grade!==null)throw new Error('ข้อมูลการวัดจากบริการไม่ครบ');
      const selected=result.selection,tolerance=2/audio.rate;
      if(result.engine?.name!=='Praat'||result.engine.analysis_context!=='full_original_sound'||result.engine.normalization!=='none'||Object.keys(active.settings).some(key=>result.engine.settings?.[key]!==active.settings[key]))throw new Error('การตั้งค่าในผลไม่ตรงกับการวัดครั้งนี้');
      if(!result.input||result.input.sample_rate_hz!==audio.rate||result.input.channels!==audio.channels||result.input.frames!==audio.samples.length||!finite(result.input.duration_seconds)||Math.abs(result.input.duration_seconds-audio.duration)>1e-8)throw new Error('ต้นฉบับในผลไม่ตรงกับคลิปนี้');
      if(!selected||selected.boundary_source!=='user_selected'||selected.vowel_confirmed!==active.vowel||!finite(selected.start_seconds)||!finite(selected.end_seconds)||!finite(selected.duration_ms)||Math.abs(selected.start_seconds-active.bounds.start)>tolerance||Math.abs(selected.end_seconds-active.bounds.end)>tolerance||selected.end_seconds<=selected.start_seconds||Math.abs(selected.duration_ms-(selected.end_seconds-selected.start_seconds)*1000)>tolerance*1000)throw new Error('ช่วงเสียงในผลไม่ตรงกับช่วงที่เลือก');
      for(const part of [result.f0,result.formants])if(!part||!Object.hasOwn(QUALITY,part.status)||!(part.reason===null||typeof part.reason==='string'&&part.reason.length<1000)||!Array.isArray(part.frames)||part.frames.length>10000)throw new Error('รายละเอียดการวัดไม่ครบ');
      for(const [part,keys] of [[result.f0,['value_hz']],[result.formants,['f1_hz','f2_hz','f3_hz']]]){let previous=-1;for(const frame of part.frames){if(!frame||!finite(frame.time_seconds)||frame.time_seconds<0||frame.time_seconds>audio.duration+tolerance||frame.time_seconds<=previous||keys.some(key=>!hz(frame[key])))throw new Error('ข้อมูลเส้นติดตามเสียงไม่ถูกต้อง');previous=frame.time_seconds;}}
      if(![result.f0.median_hz,result.f0.q25_hz,result.f0.q75_hz].every(hz)||!Number.isSafeInteger(result.f0.voiced_frames)||!Number.isSafeInteger(result.f0.total_frames)||result.f0.voiced_frames<0||result.f0.total_frames<result.f0.voiced_frames||!finite(result.f0.coverage)||result.f0.coverage<0||result.f0.coverage>1)throw new Error('สรุป F0 ไม่ครบ');
      if(!Array.isArray(result.formants.tracks)||result.formants.tracks.length!==3||new Set(result.formants.tracks.map(track=>track.index)).size!==3||result.formants.tracks.some(track=>![1,2,3].includes(track.index)||![track.median_hz,track.q25_hz,track.q75_hz].every(hz)||!Number.isSafeInteger(track.valid_frames)||track.valid_frames<0))throw new Error('สรุปฟอร์แมนต์ไม่ครบ');
      if(!Array.isArray(result.flags)||result.flags.length>100||result.flags.some(flag=>typeof flag!=='string'||flag.length>1000))throw new Error('ข้อจำกัดของข้อมูลไม่ครบ');
      return result;
    }
    function chart(node,frames,lines,selected,low,high) {
      node.replaceChildren();node.append(svg('line',{x1:48,y1:24,x2:48,y2:214,class:'ac-axis'}),svg('line',{x1:48,y1:214,x2:740,y2:214,class:'ac-axis'}));
      for(const value of [low,(low+high)/2,high]){const y=214-(value-low)/(high-low)*190;node.append(svg('text',{x:40,y:y+4,'text-anchor':'end',class:'ac-graph-label'},String(Math.round(value))));}
      node.append(svg('rect',{x:48+selected.start_seconds/audio.duration*692,y:24,width:(selected.end_seconds-selected.start_seconds)/audio.duration*692,height:190,class:'ac-selected'}));
      for(const [value,x,anchor] of [[0,48,'start'],[audio.duration,740,'end']])node.append(svg('text',{x,y:237,'text-anchor':anchor,class:'ac-graph-label'},value.toFixed(3)+' s'));
      for(const [key,label,color] of lines)for(const run of segments(frames,key,0,audio.duration,low,high)){
        if(run.length===1)node.append(svg('circle',{cx:run[0][0],cy:run[0][1],r:2.5,fill:color,'data-series':label}));
        else node.append(svg('polyline',{points:run.map(point=>point.join(',')).join(' '),stroke:color,'data-series':label}));
      }
    }
    const num = value => finite(value)?value.toFixed(1):'—';
    function metric(label,part,count) {
      const node=el('article',undefined,'ac-metric');node.append(el('h3',label),el('p',part.median_hz===null?'—':num(part.median_hz)+' Hz','ac-value'),el('p','มัธยฐาน · Q25–Q75: '+num(part.q25_hz)+'–'+num(part.q75_hz)+' Hz'),el('p',count),el('p',QUALITY[part.status],'ac-quality'));return node;
    }
    function render(result,active) {
      ui['result-selection'].textContent=(result.selection.vowel_confirmed?'ช่วงสระที่คุณเลือก':'ความยาวช่วงที่เลือก')+': '+result.selection.duration_ms.toFixed(1)+' ms · '+result.selection.start_seconds.toFixed(3)+'–'+result.selection.end_seconds.toFixed(3)+' s · ขอบเขตที่คุณกำหนดเอง';
      ui.summary.append(metric('F0',result.f0,'เฟรมที่มี F0: '+result.f0.voiced_frames+' / '+result.f0.total_frames));
      for(const track of result.formants.tracks.slice().sort((a,b)=>a.index-b.index))ui.summary.append(metric('F'+track.index,{...track,status:result.formants.status},'เฟรมที่มีค่า: '+track.valid_frames));
      chart(ui.pitch,result.f0.frames,[['value_hz','F0','#315f49']],result.selection,active.settings.pitch_floor_hz,active.settings.pitch_top_hz);
      chart(ui.formants,result.formants.frames,[['f1_hz','F1','#8a5d1f'],['f2_hz','F2','#276a89'],['f3_hz','F3','#74518a']],result.selection,0,active.settings.formant_ceiling_hz);
      const notes=['F0: '+QUALITY[result.f0.status],'ฟอร์แมนต์: '+QUALITY[result.formants.status]];
      if(result.f0.reason)notes.push('F0 · '+(REASONS[result.f0.reason]||result.f0.reason));
      if(result.formants.reason)notes.push('ฟอร์แมนต์ · '+(REASONS[result.formants.reason]||result.formants.reason));
      notes.push(...result.flags.map(flag=>FLAGS[flag]||flag));
      notes.forEach(note=>ui.flags.append(el('li',note)));
      ui.engine.textContent='แหล่งการวัด: Praat '+(typeof result.engine?.version==='string'?result.engine.version.slice(0,50):'')+' ในเครื่อง · ขอบเขตจากผู้ใช้ · F0 '+active.settings.pitch_floor_hz+'–'+active.settings.pitch_top_hz+' Hz · เพดานฟอร์แมนต์ '+active.settings.formant_ceiling_hz+' Hz';
      if(Array.isArray(result.formants.sensitivity))for(const item of result.formants.sensitivity){if(!item||!finite(item.ceiling_hz)||!Array.isArray(item.medians_hz)||item.medians_hz.length!==3||!item.medians_hz.every(hz))continue;ui.sensitivity.append(el('p','เพดาน '+num(item.ceiling_hz)+' Hz · F1/F2/F3: '+item.medians_hz.map(num).join(' / ')+' Hz'));}
      ui.results.hidden=false;
    }
    const current = active => !disposed&&job===active&&active.revision===revision&&active.clip===clip&&!active.controller.signal.aborted;
    async function readJSON(response) {try{return await response.json();}catch(_){throw new Error('บริการส่งข้อมูลที่อ่านไม่ได้');}}
    function failure(payload) {return new Error(typeof payload?.error?.message==='string'?payload.error.message.slice(0,1000):'ยังวัดเสียงไม่ได้ ลองตรวจบริการในเครื่องแล้วกดใหม่');}
    async function measure() {
      if(!local){status('การวัดใช้ได้ใน local dev เท่านั้น ไม่มีการติดต่อ localhost จากหน้านี้');return;}
      if(!clip||!audio||captureBusy||decoding||job)return;
      let selected,config;try{selected=bounds();config=settings();}catch(error){clearResults();status(error.message);return;}
      stopSelection();ui.audio.pause();clearResults();const active={clip,revision,bounds:selected,settings:config,vowel:ui.vowel.checked,controller:new win.AbortController(),timer:null};job=active;update();status('กำลังตรวจบริการวัดเสียงในเครื่อง…');
      active.timer=win.setTimeout(()=>{if(current(active)){abortJob();update();status('การวัดใช้เวลานานเกิน 30 วินาที กดวัดใหม่ได้');}},30000);
      try {
        const options={signal:active.controller.signal,credentials:'same-origin',cache:'no-store'};
        const healthResponse=await win.fetch('/api/acoustics/measure',{...options,method:'GET'});
        const health=await readJSON(healthResponse);if(!current(active))return;
        if(!healthResponse.ok)throw failure(health);
        if(health?.configured!==true||health.source!=='local_praat'||health.measurement_type!=='acoustic_signal'||health.pronunciation_grade!==null)throw new Error('บริการ Praat ในเครื่องยังไม่พร้อม ตรวจการติดตั้งแล้วกดวัดอีกครั้ง');
        const body=new win.FormData();body.append('audio',active.clip,'recording.wav');body.append('start_seconds',String(active.bounds.start));body.append('end_seconds',String(active.bounds.end));body.append('settings',JSON.stringify(active.settings));body.append('vowel_confirmed',String(active.vowel));
        status('กำลังวัดช่วงที่เลือกด้วย Praat ในเครื่อง…');
        const response=await win.fetch('/api/acoustics/measure',{...options,method:'POST',body});
        const result=await readJSON(response);if(!current(active))return;if(!response.ok)throw failure(result);
        validateResult(result,active);render(result,active);status('วัดช่วงที่เลือกแล้ว · ดูค่าประมาณและข้อจำกัดของข้อมูลด้านล่าง');
      }catch(error){if(current(active)&&error.name!=='AbortError'){clearResults();status(error.message||'ยังวัดเสียงไม่ได้');}}
      finally {if(job===active){win.clearTimeout(active.timer);job=null;update();}}
    }
    on(ui.file,'change',()=>{if(captureBusy)return;const file=ui.file.files?.[0];if(file)loadClip(file,file.name||'ไฟล์ WAV ของฉัน');});
    for(const key of ['start','end','vowel','floor','top','ceiling'])for(const type of ['input','change'])on(ui[key],type,selectionChanged);
    for(const [slider,input] of [['start-range','start'],['end-range','end']])on(ui[slider],'input',()=>{ui[input].value=ui[slider].value;selectionChanged();});
    on(ui['selection-play'],'click',playSelection);on(ui['selection-stop'],'click',stopSelection);on(ui['selection-audio'],'ended',stopSelection);
    on(ui.measure,'click',measure);on(ui.cancel,'click',()=>{invalidate('ยกเลิกการวัดแล้ว · คลิปยังอยู่ในหน้านี้');});
    on(ui.audio,'play',()=>{stopSelection();if(captureBusy)ui.audio.pause();else doc.querySelectorAll('audio').forEach(other=>{if(other!==ui.audio)other.pause();});});
    if(!local)ui['local-notice'].textContent='หน้านี้ฟังและดูรูปคลื่นได้ · การวัดใช้ได้เมื่อเปิด local dev เท่านั้น ไม่มีการติดต่อ localhost อัตโนมัติ';
    if(widget&&typeof widget.mount==='function'){
      recorderCleanup=widget.mount(ui.recorder,{text:'Audio',accent:'en-us',demo:true,expanded:true,recordingOnly:true,
        onCaptureStateChange(value){if(disposed)return;const active=Boolean(value?.recording||value?.requesting||value?.preparing);if(active&&!captureBusy){loadClip(null);ui.file.value='';}captureBusy=active;update();},
        onClipChange(value){if(!disposed)loadClip(value?.blob||null,'เสียงที่คุณบันทึก');}});
      ui.recorder.querySelector('.egl-ph-optional-analysis')?.remove();ui.recorder.querySelector('.egl-ph-upload')?.remove();
      const controls=ui.recorder.querySelector('.egl-ph-input-controls');if(controls){const details=el('details');controls.replaceWith(details);details.append(el('summary','เลือกไมโครโฟนและการปรับเสียง'),controls);}
    }else ui.recorder.textContent='ยังเปิดตัวบันทึกไม่ได้ คุณเลือกไฟล์ WAV ด้านบนได้';
    function cleanup(){if(disposed)return;disposed=true;revision++;abortJob();decoding?.abort();decoding=null;listeners.forEach(remove=>remove());recorderCleanup?.();releaseAudio();clip=null;audio=null;}
    on(win,'pagehide',cleanup);update();
    return {cleanup,loadClip};
  }
  global.EGLAcoustics=Object.freeze({mount,decodeWave,segments});
  if(global.document)global.document.addEventListener('DOMContentLoaded',()=>mount(global.document,global.EGLPhonetics),{once:true});
})(globalThis);
