/* Small, local-first word practice. Completion is a learner report, never a grade. */
(function (global) {
  'use strict';
  const STORAGE = 'egl.basicWordPractice.v2', LEGACY_STORAGE = 'egl.basicWordPractice.v1';
  const ACCENTS = {'en-us':'US','en-gb':'UK'};
  const completionKey = item => item.reference.accent + ':' + item.word;
  const MEANINGS = {it:'มัน / สิ่งนั้น',bit:'นิดหน่อย',beat:'ตี / จังหวะ',sit:'นั่ง',seat:'ที่นั่ง',ship:'เรือ',sheep:'แกะ',see:'เห็น',this:'นี้',that:'นั้น',these:'เหล่านี้',those:'เหล่านั้น',thin:'บาง / ผอม',then:'จากนั้น',think:'คิด',three:'สาม',leaf:'ใบไม้',leave:'ออกไป / ทิ้งไว้',lip:'ริมฝีปาก',leap:'กระโดด',light:'แสง / เบา',right:'ขวา / ถูกต้อง',write:'เขียน',"it's":'รูปย่อของ it is หรือ it has',with:'กับ / ด้วย',we:'พวกเรา',you:'คุณ',what:'อะไร',where:'ที่ไหน',when:'เมื่อไร',who:'ใคร',why:'ทำไม',how:'อย่างไร',yes:'ใช่',no:'ไม่',can:'สามารถ',"can't":'ไม่สามารถ',want:'ต้องการ',water:'น้ำ',work:'ทำงาน / งาน'};
  const PAIRS = {bit:'beat',beat:'bit',sit:'seat',seat:'sit',ship:'sheep',sheep:'ship',leaf:'leave',leave:'leaf',light:'right',right:'light'};
  function mount(doc, data, widget) {
    if (!doc || !data || !Array.isArray(data.words) || !Array.isArray(data.groups) || !widget || typeof widget.mount !== 'function') return null;
    const win = doc.defaultView, byId = id => doc.getElementById('foundation-' + id);
    const ui = Object.fromEntries(['status','accent','accent-note','compare','compare-audio','compare-caption','groups','progress','reset','word','ipa','meaning','position','word-choices','listen','slow','audio','source','credit','contrast','phone-choices','guide','recorder','reflection','checklist','complete','prev','next'].map(name => [name,byId(name)]));
    if (Object.values(ui).some(node => !node)) return null;
    const allRecords = data.words.filter(item => item && item.available === true && item.source_kind === 'human' && item.standalone === true
      && typeof item.word === 'string' && /^[a-z]+(?:'[a-z]+)?$/.test(item.word)
      && /^assets\/native-words\/word-[a-f0-9]{20}\.wav$/.test(item.url)
      && item.reference && item.reference.text === item.word && ACCENTS[item.reference.accent]
      && (!item.accent || item.accent === item.reference.accent)
      && Array.isArray(item.reference.words) && item.reference.words.length === 1 && item.reference.words[0].phones.length);
    if (!allRecords.length) { ui.status.textContent = 'ยังเตรียมเสียงคนพูดไม่ครบ กรุณากลับมาเปิดหน้านี้อีกครั้ง'; return null; }
    let targetAccent = allRecords.some(item => item.reference.accent === 'en-us') ? 'en-us' : allRecords[0].reference.accent;
    let records = allRecords.filter(item => item.reference.accent === targetAccent);
    for (const [code,label] of Object.entries(ACCENTS)) {
      const count = allRecords.filter(item => item.reference.accent === code).length;
      if (count) { const option = doc.createElement('option');option.value=code;option.textContent=label+' · '+count+' คำ';ui.accent.append(option); }
    }
    ui.accent.value=targetAccent;
    const listeners = [], wordListeners = [], choiceListeners = [];
    let disposed = false, cleanupRecorder = null, current = records[0], generation = 0, slow = false, comparison = null;
    let heard = false, recorded = false, ownHeard = false, reflection = '', storageAvailable = true, captureBusy = false;
    const completed = new Set();
    function listen(node, type, handler, bucket = listeners, options) { node.addEventListener(type,handler,options); bucket.push(() => node.removeEventListener(type,handler,options)); }
    function el(tag, text, className) { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
    try {
      const raw=win.localStorage.getItem(STORAGE),saved=JSON.parse(raw || 'null');
      if(saved?.schema === 2 && Array.isArray(saved.completed)) saved.completed.forEach(value=>{const item=allRecords.find(item=>item.word===value?.word&&item.reference.accent===value?.accent);if(item)completed.add(completionKey(item));});
      else if(raw === null){const old=JSON.parse(win.localStorage.getItem(LEGACY_STORAGE)||'null');if(old?.schema===1&&Array.isArray(old.completed))old.completed.forEach(word=>{const item=allRecords.find(item=>item.word===word&&item.reference.accent==='en-us');if(item)completed.add(completionKey(item));});}
    } catch (_) { storageAvailable = false; }
    function save() { try { win.localStorage.setItem(STORAGE,JSON.stringify({schema:2,completed:[...completed].map(key=>{const [accent,word]=key.split(':');return {accent,word};})})); } catch (_) { storageAvailable = false; } }
    function status(text) { if (!disposed) ui.status.textContent = text; }
    function pauseOtherAudio(playing) { doc.querySelectorAll('audio').forEach(audio=>{if(audio!==playing)audio.pause();}); }
    function checklist() {
      ui.complete.disabled = !(heard && recorded && ownHeard && reflection);
      [...ui.reflection.children].forEach(node => { node.disabled = !(heard && recorded && ownHeard); });
      ui.checklist.textContent = [['ฟังตัวอย่าง',heard],['อัดเสียง',recorded],['ฟังคลิปตัวเอง',ownHeard],['เลือกสิ่งที่สังเกต',Boolean(reflection)]].map(([text,done]) => (done?'✓ ':'○ ') + text).join(' · ');
    }
    function progress() {
      ui.progress.textContent = ACCENTS[targetAccent]+' · คุณบันทึกว่าฝึกแล้ว ' + records.filter(item=>completed.has(completionKey(item))).length + ' / ' + records.length + ' คำ';
      ui.reset.disabled = !completed.size;
      if (!storageAvailable) status('เบราว์เซอร์เก็บประวัติไม่ได้ · ยังฝึกได้ตามปกติในหน้านี้');
    }
    function choosePhone(index) {
      const phones = current.reference.words[0].phones, phone = phones[index];
      let exercise = null, description = null;
      try { exercise = global.EGLPhoneGuide?.practiceForWord(current.word,phones); description = global.EGLPhoneGuide?.describe(phone); } catch (_) {}
      const step = exercise?.steps?.find(item => item.phoneIndex === index);
      ui.guide.replaceChildren(el('strong','ลองสังเกต /' + phone + '/'),el('p',step?.instruction || description?.tip || 'ฟังเสียงนี้ภายในคำเต็ม แล้วลองเชื่อมเสียงตามตัวอย่าง'));
      if (step?.selfCheck) ui.guide.append(el('p',step.selfCheck));
      if (exercise?.variantNote) ui.guide.append(el('p',exercise.variantNote));
      [...ui['phone-choices'].children].forEach((button,at) => button.setAttribute('aria-pressed',String(at === index)));
    }
    function renderChoices() {
      choiceListeners.splice(0).forEach(remove => remove());
      ui['word-choices'].replaceChildren();
      records.filter(item => item.group === current.group).forEach(item => {
        const button = el('button',item.word,completed.has(completionKey(item))?'has-practiced':''); button.type='button'; button.lang='en';
        button.setAttribute('aria-current',String(item === current)); listen(button,'click',() => choose(item,true),choiceListeners); ui['word-choices'].append(button);
      });
      ui.groups.replaceChildren();
      data.groups.forEach(group => {
        const items = records.filter(item => item.group === group.id), button = el('button',group.title + ' · ' + items.length + ' คำ'); button.type='button';button.disabled=!items.length;
        button.setAttribute('aria-current',String(group.id === current.group));listen(button,'click',() => choose(items[0],true),choiceListeners);ui.groups.append(button);
      });
      progress();
    }
    function choose(item, focus) {
      if (!item || disposed) return;
      generation++; const version = generation;
      wordListeners.splice(0).forEach(remove => remove());
      if (cleanupRecorder) cleanupRecorder(); cleanupRecorder=null;
      ui.audio.pause(); ui.audio.removeAttribute('src'); ui.audio.load();
      ui['compare-audio'].pause();ui['compare-audio'].removeAttribute('src');ui['compare-audio'].load();
      current=item;heard=recorded=ownHeard=false;reflection='';slow=false;captureBusy=false;ui.listen.disabled=false;ui.slow.disabled=false;ui.slow.setAttribute('aria-pressed','false');
      ui.word.textContent=item.word;ui.ipa.textContent='/' + item.reference.ipa.replace(/[ˈˌ]/g,'') + '/';ui.meaning.textContent=MEANINGS[item.word] || '';
      ui.position.textContent='คำที่ ' + (records.indexOf(item)+1) + ' จาก ' + records.length;
      const audio = el('audio');audio.id='foundation-audio';audio.controls=true;audio.preload='none';audio.setAttribute('aria-label','เสียงคำเต็ม ' + item.word + ' จากผู้พูดจริง');audio.src=new URL(item.url,doc.baseURI).href;
      ui.audio.replaceWith(audio);ui.audio=audio;
      listen(audio,'play',() => {if (version === generation) {if(captureBusy){audio.pause();return;}pauseOtherAudio(audio);heard=true;checklist();}},wordListeners);
      listen(audio,'error',() => {if (version === generation) status('ยังเปิดเสียงตัวอย่างไม่ได้ ลองกดฟังอีกครั้งหรือตรวจการเชื่อมต่อ');},wordListeners);
      ui.source.textContent='ผู้พูดจริง · '+ACCENTS[targetAccent]+' ตามข้อมูลต้นฉบับ · ' + item.author + (item.speaker_region ? ' · '+item.speaker_region : '');
      comparison=allRecords.find(other=>other.word===item.word&&other.reference.accent!==targetAccent)||null;
      ui.compare.disabled=!comparison;
      ui.compare.textContent=comparison?'ฟัง '+ACCENTS[comparison.reference.accent]+' เทียบ':'ยังไม่มีอีกสำเนียงของคำนี้';
      ui['compare-caption'].replaceChildren();ui['compare-audio'].hidden=!comparison;ui['compare-audio'].controls=Boolean(comparison);
      if(comparison){
        ui['compare-audio'].src=new URL(comparison.url,doc.baseURI).href;
        ui['compare-audio'].setAttribute('aria-label','เสียงเทียบ '+comparison.word+' '+ACCENTS[comparison.reference.accent]);
        const link=el('a','ที่มาและเครดิต');link.href=comparison.source_page;link.target='_blank';link.rel='noreferrer';
        ui['compare-caption'].append(doc.createTextNode(ACCENTS[comparison.reference.accent]+' /'+comparison.reference.ipa.replace(/[ˈˌ]/g,'')+'/ · '+comparison.author+' · '+comparison.license+' · '),link);
      }else ui['compare-caption'].textContent='ฝึกเสียงที่เลือกได้ตามปกติ เราจะไม่ใช้เสียง US แทนป้าย UK';
      listen(ui['compare-audio'],'play',()=>{if(version!==generation||captureBusy||!comparison){ui['compare-audio'].pause();return;}pauseOtherAudio(ui['compare-audio']);},wordListeners);
      listen(ui['compare-audio'],'error',()=>{if(version===generation&&comparison)status('ยังเปิดเสียงเทียบไม่ได้ ลองกดฟังอีกครั้ง');},wordListeners);
      ui.credit.replaceChildren(el('p','ผู้บันทึก: ' + item.author + ' · ' + item.license),el('p',item.changes));
      for (const [label,url] of [['ไฟล์ต้นฉบับ',item.source_page],['สิทธิ์ใช้งาน',item.license_url],['ข้อมูลผู้พูด',item.speaker_profile]]) {
        if (typeof url !== 'string' || !/^https:\/\//.test(url)) continue;
        const link=el('a',label);link.href=url;link.target='_blank';link.rel='noreferrer';ui.credit.append(link,doc.createTextNode(' · '));
      }
      const pair=PAIRS[item.word];ui.contrast.textContent=pair ? 'ลองฟัง ' + item.word + ' เทียบ ' + pair + ' แล้วสังเกตเสียงที่ต่างกัน' : item.word === "it's" ? "It's กับ its ออกเสียงเหมือนกันในรูปเต็ม เสียงคำเดียวจึงบอกการสะกดไม่ได้" : 'ดูเสียงทีละส่วน แล้วเชื่อมกลับเป็นคำเต็ม ไม่ต้องอ่านชื่ออักษร';
      ui['phone-choices'].replaceChildren();
      item.reference.words[0].phones.forEach((phone,index) => {const button=el('button','/' + phone + '/');button.type='button';listen(button,'click',() => choosePhone(index),wordListeners);ui['phone-choices'].append(button);});
      choosePhone(0);renderChoices();
      ui.reflection.replaceChildren();
      ['ใกล้ตัวอย่าง','อยากฝึกเพิ่ม','ยังไม่แน่ใจ'].forEach(label => {
        const button=el('button',label);button.type='button';button.disabled=true;button.setAttribute('aria-pressed','false');
        listen(button,'click',() => {if (!(heard&&recorded&&ownHeard)) return;reflection=label;[...ui.reflection.children].forEach(node => node.setAttribute('aria-pressed',String(node===button)));checklist();},wordListeners);ui.reflection.append(button);
      });
      const catalog={by_word:Object.fromEntries(records.map(record=>[record.word,{...record,text:record.word}]))};
      cleanupRecorder=widget.mount(ui.recorder,{text:item.word,accent:targetAccent,precomputed:item.reference,demo:true,expanded:true,recordingOnly:true,wordAudio:catalog,
        onCaptureStateChange(value) {if(version !== generation || disposed)return;captureBusy=Boolean(value?.recording || value?.requesting || value?.preparing);ui.listen.disabled=captureBusy;ui.slow.disabled=captureBusy;ui.compare.disabled=captureBusy||!comparison;ui['compare-audio'].controls=!captureBusy&&Boolean(comparison);audio.controls=!captureBusy;if(captureBusy){audio.pause();ui['compare-audio'].pause();recorded=ownHeard=false;reflection='';[...ui.reflection.children].forEach(node=>node.setAttribute('aria-pressed','false'));checklist();}},
        onClipChange(value) {if (version !== generation || disposed) return;recorded=Boolean(value?.blob);ownHeard=false;reflection='';[...ui.reflection.children].forEach(node => {node.disabled=true;node.setAttribute('aria-pressed','false');});checklist();}});
      listen(ui.recorder,'play',event => {if (version === generation && recorded && event.target.classList.contains('egl-ph-player')) {pauseOtherAudio(event.target);ownHeard=true;[...ui.reflection.children].forEach(node => {node.disabled=!(heard&&recorded&&ownHeard);});checklist();}},wordListeners,true);
      const hint=ui.recorder.querySelector('.egl-ph-record-hint');if (hint) hint.textContent='รอ “เริ่มพูดได้” แล้วพูดคำว่า “' + item.word + '” หนึ่งครั้ง เว้นจังหวะก่อนกดหยุด';
      ui.prev.disabled=records.indexOf(item)===0;ui.next.disabled=records.indexOf(item)===records.length-1;
      checklist();status('พร้อมฝึก ' + item.word + ' · ฟังตัวอย่างก่อน แล้วค่อยบันทึกเสียง');if (focus) ui.word.focus();
    }
    listen(ui.listen,'click',() => {const version=generation;ui.audio.playbackRate=slow ? 0.75 : 1;const promise=ui.audio.play();promise?.catch(() => {if (version===generation) status('กดเล่นบนแถบเสียงได้ครับ หากยังไม่ได้ให้ลองโหลดหน้าใหม่');});});
    listen(ui.slow,'click',() => {slow=!slow;ui.slow.setAttribute('aria-pressed',String(slow));ui.audio.playbackRate=slow ? 0.75 : 1;});
    listen(ui.compare,'click',()=>{if(captureBusy||!comparison)return;const version=generation;ui['compare-audio'].play()?.catch(()=>{if(version===generation)status('กดเล่นเสียงเทียบบนแถบเสียงได้ครับ');});});
    listen(ui.accent,'change',()=>{
      const next=ui.accent.value;if(!ACCENTS[next])return;
      const items=allRecords.filter(item=>item.reference.accent===next);if(!items.length)return;
      const same=items.find(item=>item.word===current.word),oldWord=current.word;
      targetAccent=next;records=items;choose(same||items[0],true);
      if(!same)status('ยังไม่มี '+ACCENTS[next]+' สำหรับ '+oldWord+' · เปลี่ยนมาฝึก '+current.word+' ที่มีเสียงจริงในสำเนียงนี้');
    });
    listen(ui.prev,'click',() => choose(records[records.indexOf(current)-1],true));
    listen(ui.next,'click',() => choose(records[records.indexOf(current)+1],true));
    listen(ui.complete,'click',() => {if (ui.complete.disabled) return;completed.add(completionKey(current));save();renderChoices();status('บันทึกว่าฝึก ' + current.word + ' '+ACCENTS[targetAccent]+' แล้ว · เป็นบันทึกของคุณ ไม่ใช่คะแนนความถูกต้อง');});
    listen(ui.reset,'click',() => {completed.clear();save();renderChoices();status('ล้างบันทึกการฝึกแล้ว');});
    choose(current,false);
    const cleanup=() => {if(disposed)return;disposed=true;generation++;wordListeners.splice(0).forEach(remove=>remove());choiceListeners.splice(0).forEach(remove=>remove());listeners.splice(0).forEach(remove=>remove());cleanupRecorder?.();for(const audio of [ui.audio,ui['compare-audio']]){audio.pause();audio.removeAttribute('src');audio.load();}};
    listen(win,'pagehide',cleanup);return cleanup;
  }
  global.EGLFoundations={mount};
  function start(){if(global.document)mount(global.document,global.EGL_CORE_WORDS,global.EGLPhonetics);}
  if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
