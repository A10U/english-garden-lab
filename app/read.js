/* Read while speaking; cloud audio leaves the browser only after an explicit click. */
(function(global){
  'use strict';
  const SENTENCES=['This is a leaf.','The leaf is green.','This is my plant.','I like plants.','Please help me.','Please say it again.','Help me, please.','Thank you!'];
  const MEANINGS={ship:'เรือ',sheep:'แกะ',it:'มัน / สิ่งนั้น',bit:'นิดหน่อย',beat:'ตี / จังหวะ',sit:'นั่ง',seat:'ที่นั่ง',see:'เห็น',this:'นี้',that:'นั้น',these:'เหล่านี้',those:'เหล่านั้น',thin:'บาง / ผอม',then:'จากนั้น',think:'คิด',three:'สาม',leaf:'ใบไม้',leave:'ออกไป / ทิ้งไว้',lip:'ริมฝีปาก',leap:'กระโดด',light:'แสง / เบา',right:'ขวา / ถูกต้อง',write:'เขียน',"it's":'รูปย่อของ it is หรือ it has',with:'กับ / ด้วย',we:'พวกเรา',you:'คุณ',what:'อะไร',where:'ที่ไหน',when:'เมื่อไร',who:'ใคร',why:'ทำไม',how:'อย่างไร',yes:'ใช่',no:'ไม่',can:'สามารถ',"can't":'ไม่สามารถ',want:'ต้องการ',water:'น้ำ',work:'ทำงาน / งาน',
    'This is a leaf.':'นี่คือใบไม้','The leaf is green.':'ใบไม้มีสีเขียว','This is my plant.':'นี่คือต้นไม้ของฉัน','I like plants.':'ฉันชอบต้นไม้','Please help me.':'ช่วยฉันด้วย','Please say it again.':'ช่วยพูดอีกครั้งได้ไหม','Help me, please.':'ช่วยฉันหน่อย','Thank you!':'ขอบคุณ!'};
  function mount(doc,data,widget){
    if(!doc||!data||!widget||typeof widget.mount!=='function')return null;
    const win=doc.defaultView,id=name=>doc.getElementById('read-'+name);
    const ui=Object.fromEntries(['mode','selection','custom','custom-use','kind','prompt','translation-toggle','translation','listen','slow','prev','next','audio','cue-note','status','recorder','cloud','cloud-cancel','cloud-notice','feedback','ipa','source','credit'].map(name=>[name,id(name)]));
    if(Object.values(ui).some(value=>!value))return null;
    const refs=data.references||{},examples=data.examples||{},core=data.core||{};
    const words=(Array.isArray(core.words)?core.words:[]).filter(row=>row&&row.available===true&&row.source_kind==='human'&&row.standalone===true
      &&typeof row.word==='string'&&/^[a-z]+(?:'[a-z]+)?$/.test(row.word)&&/^assets\/native-words\/word-[a-f0-9]{20}\.wav$/.test(row.url)
      &&row.reference?.accent==='en-us'&&row.reference.text===row.word&&typeof row.reference.ipa==='string'&&row.reference.words?.length===1&&row.reference.words[0].phones?.length)
      .map(row=>({text:row.word,kind:'word',accent:'en-us',url:row.url,reference:row.reference,source:row,translation:MEANINGS[row.word]||''}));
    const sentences=SENTENCES.flatMap(text=>{
      const audio=examples[text],ref=refs[text];
      if(!audio||audio.text!==text||audio.playback_source!=='prerecorded_ai'||!/^\.\.\/speech-training\/demo-assets\/audio\/(?:baseline|candidate|practice)\/tts-\d{3}\.wav$/.test(audio.url)
        ||!ref||ref.text!==text||ref.accent!=='en-us'||typeof ref.ipa!=='string'||!Array.isArray(ref.words)||!ref.words.length||ref.words.some(word=>!word.phones?.length))return [];
      return [{text,kind:'sentence',accent:'en-us',url:audio.url,reference:ref,source:audio,translation:MEANINGS[text]||''}];
    });
    const groups={word:words,sentence:sentences,custom:[]};
    if(!words.length&&!sentences.length){ui.status.textContent='ยังไม่มีเสียงอ้างอิงที่พร้อมใช้';return null;}
    let items=words.length?words:sentences,current=items.find(item=>item.text==='ship')||items[0],generation=0,disposed=false,captureBusy=false,slow=false,playing=false;
    let clip=null,cleanupRecorder=null,job=null;
    const listeners=[],wordListeners=[];
    const local=/^https?:$/.test(win.location.protocol)&&['127.0.0.1','localhost','[::1]'].includes(win.location.hostname);
    const on=(node,type,fn,bucket=listeners,options)=>{node.addEventListener(type,fn,options);bucket.push(()=>node.removeEventListener(type,fn,options));};
    const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
    function status(text){if(!disposed)ui.status.textContent=text;}
    function clearFeedback(){ui.feedback.replaceChildren();}
    function cancelCloud(message){const old=job;job=null;old?.controller.abort();update();if(message)status(message);}
    function update(){
      ui.listen.disabled=captureBusy||!current.url;ui.slow.disabled=captureBusy||!current.url;ui.audio.controls=!captureBusy&&Boolean(current.url);
      ui.mode.disabled=captureBusy;ui.selection.disabled=captureBusy;
      ui.custom.disabled=captureBusy;ui['custom-use'].disabled=captureBusy;
      ui.prev.disabled=captureBusy||items.indexOf(current)<=0;ui.next.disabled=captureBusy||items.indexOf(current)>=items.length-1;
      ui.cloud.disabled=!local||!clip||captureBusy||Boolean(job);ui['cloud-cancel'].hidden=!job;
    }
    function clearCue(){ui.prompt.querySelectorAll('.is-reading').forEach(node=>{node.classList.remove('is-reading');node.removeAttribute('aria-current');});}
    function cue(){
      clearCue();if(!playing||captureBusy)return;
      const nodes=[...ui.prompt.querySelectorAll('.read-token')];
      let index=current.kind==='word'?0:-1;
      if(current.kind==='sentence'){
        const ranges=current.source.words||[],at=ui.audio.currentTime;
        index=ranges.findIndex(range=>Number.isFinite(range.start)&&Number.isFinite(range.end)&&at>=range.start&&at<range.end);
      }
      if(index>=0&&nodes[index]){nodes[index].classList.add('is-reading');nodes[index].setAttribute('aria-current','true');}
    }
    function choose(item,focus){
      if(!item||disposed)return;
      generation++;const version=generation;cancelCloud();wordListeners.splice(0).forEach(remove=>remove());cleanupRecorder?.();cleanupRecorder=null;
      ui.audio.pause();playing=false;clearCue();clip=null;captureBusy=false;slow=false;clearFeedback();
      current=item;items=groups[item.kind];ui.mode.value=item.kind;ui['slow'].setAttribute('aria-pressed','false');
      ui.selection.replaceChildren();items.forEach(value=>{const option=el('option',value.text);option.value=value.text;ui.selection.append(option);});ui.selection.value=item.text;
      ui.kind.textContent=item.kind==='custom'?'ข้อความของฉัน · มองข้อความขณะอัดได้เลย':(item.kind==='word'?'คำเดี่ยว':'ประโยคสั้น')+' · อ้างอิง US';
      ui.prompt.replaceChildren();
      const tokens=item.kind==='word'?[item.text]:item.text.split(/\s+/);
      tokens.forEach((token,index)=>{if(index)ui.prompt.append(doc.createTextNode(' '));ui.prompt.append(el('span',token,'read-token'));});
      ui.prompt.setAttribute('aria-label',item.text);
      ui.translation.textContent=item.translation;ui.translation.hidden=true;ui['translation-toggle'].hidden=!item.translation;ui['translation-toggle'].setAttribute('aria-expanded','false');
      const audio=el('audio');audio.id='read-audio';audio.controls=true;audio.preload='none';audio.hidden=!item.url;if(item.url)audio.src=new URL(item.url,doc.baseURI).href;audio.setAttribute('aria-label','เสียงตัวอย่างเต็มคลิป '+item.text);ui.audio.removeAttribute('src');ui.audio.load();ui.audio.replaceWith(audio);ui.audio=audio;
      on(audio,'play',()=>{if(version!==generation)return;if(captureBusy){audio.pause();return;}doc.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});playing=true;cue();},wordListeners);
      for(const event of ['pause','ended','seeking'])on(audio,event,()=>{if(version===generation){playing=false;clearCue();}},wordListeners);
      on(audio,'seeked',()=>{if(version===generation&&!captureBusy&&!audio.paused){playing=true;cue();}},wordListeners);
      on(audio,'timeupdate',()=>{if(version===generation)cue();},wordListeners);
      on(audio,'error',()=>{if(version===generation)status('ยังเปิดเสียงตัวอย่างไม่ได้ ตรวจการเชื่อมต่อแล้วลองกดฟังอีกครั้ง');},wordListeners);
      ui['cue-note'].textContent=item.kind==='custom'?'ยังไม่มีเสียงตัวอย่างของข้อความนี้ · อ่านตามข้อความแล้วบันทึกหรือส่งให้ Cloud ฟังได้':item.kind==='sentence'?'แถบคำตามเสียงเป็นจังหวะประมาณ ไม่ใช่ขอบเขตคำที่ผู้เชี่ยวชาญตรวจ · เล่นไฟล์เต็มคลิป':'ฟังคำเต็มจากผู้พูดจริง แล้วอ่านตามขณะอัดได้';
      ui.ipa.textContent=item.reference?'/'+item.reference.ipa.replace(/[ˈˌ]/g,'')+'/':'ยังไม่มีคำอ่านอ้างอิงสำหรับข้อความนี้';
      ui.credit.replaceChildren();
      if(item.kind==='word'){
        ui.source.textContent='เสียงคนพูดจริง · US ตามต้นฉบับ · '+item.source.author;
        ui.credit.append(el('p',item.source.license+' · '+item.source.changes));
        if(typeof item.source.source_page==='string'&&item.source.source_page.startsWith('https://commons.wikimedia.org/')){const link=el('a','ที่มาและเครดิตเสียงคำนี้');link.href=item.source.source_page;link.target='_blank';link.rel='noreferrer';ui.credit.append(link);}
        if(typeof item.source.license_url==='string'&&item.source.license_url.startsWith('https://')){const license=el('a','เงื่อนไขสิทธิ์ใช้งาน');license.href=item.source.license_url;license.target='_blank';license.rel='noreferrer';ui.credit.append(doc.createTextNode(' · '),license);}
      }else if(item.kind==='sentence'){
        ui.source.textContent='เสียงตัวอย่าง AI ที่บันทึกไว้ · อ้างอิง US · ไม่ใช่เสียงคนพูดจริง';
        const link=el('a','ที่มาและสิทธิ์เสียงตัวอย่าง');link.href='../speech-training/demo-assets/ATTRIBUTION.txt';ui.credit.append(link);
      }else ui.source.textContent='ข้อความที่คุณเลือก · ยังไม่มีไฟล์เสียงตัวอย่าง';
      const catalog={by_word:Object.fromEntries(words.map(word=>[word.text,{...word.source,text:word.text}]))};
      cleanupRecorder=widget.mount(ui.recorder,{text:item.text,accent:item.accent,precomputed:item.reference,demo:true,expanded:true,recordingOnly:true,wordAudio:catalog,
        onCaptureStateChange(value){if(disposed||version!==generation)return;captureBusy=Boolean(value?.recording||value?.requesting||value?.preparing);if(captureBusy){cancelCloud();clip=null;clearFeedback();ui.audio.pause();playing=false;clearCue();}update();},
        onClipChange(value){if(disposed||version!==generation)return;cancelCloud();clip=value?.blob||null;clearFeedback();update();}});
      on(ui.recorder,'play',event=>{if(version===generation&&event.target.tagName==='AUDIO'){ui.audio.pause();playing=false;clearCue();}},wordListeners,true);
      const microphone=ui.recorder.querySelector('.egl-ph-input-controls');
      if(microphone){const settings=el('details',undefined,'read-microphone');microphone.replaceWith(settings);settings.append(el('summary','เลือกไมโครโฟน'),microphone);}
      const optional=ui.recorder.querySelector('.egl-ph-optional-analysis');if(optional&&item.kind==='custom')optional.hidden=true;
      update();status('พร้อมอ่าน '+item.text+' · มองข้อความนี้ขณะบันทึกได้เลย');if(focus)ui.prompt.focus();
    }
    function failure(payload,fallback){const error=new Error(typeof payload?.error?.message==='string'?payload.error.message.slice(0,1000):fallback);error.code=payload?.error?.code;return error;}
    async function readJSON(response,message){try{return await response.json();}catch(_){throw new Error(message);}}
    function currentJob(active){return !disposed&&job===active&&active.generation===generation&&active.clip===clip&&!active.controller.signal.aborted;}
    async function cloud(){
      if(!local){status('Cloud เปิดใช้จาก local dev เท่านั้น');return;}
      if(!clip||captureBusy||job)return;
      clearFeedback();const active={controller:new win.AbortController(),clip,generation,target:current.text,accent:current.accent};job=active;update();status('กำลังตรวจการเชื่อมต่อ Cloud…');
      try{
        const healthResponse=await win.fetch('/api/practice/cloud',{method:'GET',signal:active.controller.signal,credentials:'same-origin'});
        const health=await readJSON(healthResponse,'ยังไม่พบ Cloud ในเซิร์ฟเวอร์นี้ กรุณาเปิดผ่าน local dev ของโปรเจกต์');if(!currentJob(active))return;
        if(!healthResponse.ok)throw failure(health,'ตรวจการเชื่อมต่อ Cloud ไม่สำเร็จ');
        if(health.configured!==true)throw failure(health,'ยังไม่ได้ตั้งค่า Cloud สำหรับ local dev');
        if(health.remaining_calls===0)throw failure(health,'ครบจำนวนครั้งที่ตั้งไว้สำหรับรอบทดสอบแล้ว');
        const form=new win.FormData();form.append('audio',active.clip,'read-practice.wav');form.append('target',active.target);form.append('accent',active.accent);
        status('กำลังส่งคลิปนี้ให้ Cloud ฟัง…');
        const response=await win.fetch('/api/practice/cloud',{method:'POST',body:form,signal:active.controller.signal,credentials:'same-origin'});
        const result=await readJSON(response,'อ่านผล Cloud ไม่สำเร็จ กรุณาลองใหม่');if(!currentJob(active))return;
        if(!response.ok)throw failure(result,'Cloud ยังวิเคราะห์คลิปนี้ไม่สำเร็จ');
        if(result?.source!=='cloud'||result.target!==active.target||typeof result.transcript!=='string'||result.transcript.length>4000||result.pronunciation_grade!==null
          ||typeof result.coaching?.summary!=='string'||typeof result.coaching?.practiceTip!=='string'
          ||result.coaching.summary.length>4000||result.coaching.practiceTip.length>4000||/\d+(?:\.\d+)?\s*%/.test(result.coaching.summary+' '+result.coaching.practiceTip))throw new Error('ผล Cloud ไม่ตรงกับคลิปที่เลือก กรุณาลองใหม่');
        ui.feedback.append(el('p','ข้อความที่ Cloud ได้ยิน','read-feedback-label'),el('p',result.transcript,'read-feedback-heard'));
        if(!result.transcript.trim())ui.feedback.append(el('p','Cloud ยังถอดข้อความจากคลิปนี้ไม่ได้'));
        if(result.coaching.provider_output_used===false)ui.feedback.append(el('p','แบบฝึกทั่วไปที่เตรียมไว้ · คำแนะนำจากโมเดลไม่พร้อมใช้','read-feedback-label'));
        ui.feedback.append(el('p',result.coaching.summary),el('p',result.coaching.practiceTip));
        if(result.coaching.provider_output_used===false&&typeof result.coaching_warning?.message==='string'){
          ui.feedback.append(el('p',result.coaching_warning.message.slice(0,1000),'read-note'));
          if(result.coaching_warning.code==='cloud_credit_exhausted'){const link=el('a','ตรวจเครดิต OpenAI');link.href='https://platform.openai.com/settings/organization/billing/overview';link.target='_blank';link.rel='noreferrer';ui.feedback.append(link);}
        }
        ui.feedback.append(el('p',result.coaching.provider_output_used===false
          ? 'คำถอดมาจาก Cloud · ใช้แบบฝึกสำรองที่เตรียมไว้ · ยังไม่มีคะแนนรับรองการออกเสียง'
          : 'คำถอดจาก Cloud และแบบฝึกทั่วไปที่ AI เลือก · ยังไม่มีคะแนนรับรองการออกเสียง','read-note'));
        status('ได้รับผล Cloud แล้ว · ฟังคลิปของคุณเทียบกับข้อความที่ถอดได้');
      }catch(error){
        if(!currentJob(active)||error?.name==='AbortError')return;
        ui.feedback.replaceChildren(el('p',error?.message||'Cloud ยังไม่พร้อม กรุณาลองใหม่'));
        if(error?.code==='cloud_credit_exhausted'){
          const link=el('a','ตรวจเครดิตและการเรียกเก็บเงิน OpenAI');link.href='https://platform.openai.com/settings/organization/billing/overview';link.target='_blank';link.rel='noreferrer';ui.feedback.append(link);
        }
        status('ยังไม่ได้ผล Cloud · คุณยังฟังและบันทึกเสียงในหน้านี้ได้');
      }finally{if(job===active){job=null;update();}}
    }
    on(ui.listen,'click',()=>{if(captureBusy||!current.url)return;const version=generation;ui.audio.playbackRate=slow ? 0.75 : 1;ui.audio.play()?.catch(()=>{if(version===generation&&!disposed)status('กดเล่นบนแถบเสียงได้ครับ');});});
    on(ui.slow,'click',()=>{if(captureBusy||!current.url)return;slow=!slow;ui.slow.setAttribute('aria-pressed',String(slow));ui.audio.playbackRate=slow ? 0.75 : 1;});
    on(ui['translation-toggle'],'click',()=>{ui.translation.hidden=!ui.translation.hidden;ui['translation-toggle'].setAttribute('aria-expanded',String(!ui.translation.hidden));});
    on(ui.mode,'change',()=>{if(captureBusy){ui.mode.value=current.kind;return;}const requested=ui.mode.value,next=groups[requested];if(next?.length)choose(next[0],true);else{ui.mode.value=current.kind;status(requested==='custom'?'วางข้อความอักษรอังกฤษ แล้วกด “ใช้ข้อความนี้”':'ยังไม่มีเสียงอ้างอิงของแบบฝึกนี้');if(requested==='custom')ui.custom.focus();}});
    on(ui['custom-use'],'click',()=>{
      if(captureBusy)return;
      const text=ui.custom.value.trim().replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ');
      if(!text||text.length>200||!/[A-Za-z]/.test(text)||/[^\x20-\x7e]/.test(text)){status('ใช้ข้อความอักษรอังกฤษ 1–200 ตัวอักษร พร้อมตัวเลขหรือเครื่องหมายทั่วไปได้');return;}
      const existing=[...words,...sentences].find(item=>item.text===text);
      if(existing){choose(existing,true);return;}
      const item={text,kind:'custom',accent:'en-us',url:null,reference:null,source:null,translation:''};groups.custom=[item];choose(item,true);
    });
    on(ui.selection,'change',()=>{if(captureBusy){ui.selection.value=current.text;return;}choose(items.find(item=>item.text===ui.selection.value),true);});
    on(ui.prev,'click',()=>{if(!captureBusy)choose(items[items.indexOf(current)-1],true);});on(ui.next,'click',()=>{if(!captureBusy)choose(items[items.indexOf(current)+1],true);});
    on(ui.cloud,'click',cloud);on(ui['cloud-cancel'],'click',()=>{cancelCloud('ยกเลิกการรอผล Cloud แล้ว');clearFeedback();});
    if(!local)ui['cloud-notice'].textContent='Cloud เปิดใช้จาก local dev เท่านั้น · หน้านี้ยังฟังตัวอย่างและบันทึกเสียงได้';
    choose(current,false);
    const cleanup=()=>{if(disposed)return;disposed=true;generation++;cancelCloud();wordListeners.splice(0).forEach(remove=>remove());listeners.splice(0).forEach(remove=>remove());cleanupRecorder?.();ui.audio.pause();ui.audio.removeAttribute('src');ui.audio.load();};
    on(win,'pagehide',cleanup);return cleanup;
  }
  global.EGLRead={mount};
  function start(){if(global.document)mount(global.document,{core:global.EGL_CORE_WORDS,references:global.EGL_PHONETIC_DATA,examples:global.EGL_REFERENCE_AUDIO},global.EGLPhonetics);}
  if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
