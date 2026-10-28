const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const scope={};vm.runInNewContext(read('core-word-data.js'),scope);
const item=scope.EGL_CORE_WORDS.words.find(w=>w.word==='this');
function setup(t,recordingOnly){
 const dom=new JSDOM('<main></main>',{url:'https://garden.example/prefix/app/foundations.html',runScripts:'outside-only'}),w=dom.window;
 const played=[],network=[];w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.play=function(){played.push(this.src);return Promise.resolve();};
 w.fetch=(...args)=>{network.push(args);throw Error('No automatic requests');};
 w.URL.createObjectURL=()=> 'blob:public-test';w.URL.revokeObjectURL=()=>{};
 for(const name of ['phone-guide.js','spelling-guide.js','spelling-feedback.js','word-audio.js','phonetics.js'])w.eval(read(name));
 w.EGLBrowserPhonetics={supported:()=>true,analyze:()=>{throw Error('No automatic inference');}};
 const container=w.document.querySelector('main');
 const cleanup=w.EGLPhonetics.mount(container,{text:item.word,precomputed:JSON.parse(JSON.stringify(item.reference)),demo:true,expanded:true,recordingOnly,
   wordAudio:{by_word:{this:{...JSON.parse(JSON.stringify(item)),text:'this'}}}});
 t.after(()=>{cleanup();w.close();});return {w,container,played,network};
}
test('beginner recorder hides editing/reference tabs and keeps optional analysis closed without starting work',t=>{
 const a=setup(t,true),c=a.container;
 assert.equal(c.querySelector('.egl-ph-steps').hidden,true);assert.equal(c.querySelector('.egl-ph-tabs').hidden,true);
 const optional=c.querySelector('.egl-ph-optional-analysis');assert.ok(optional);assert.equal(optional.open,false);
 const buttons=[...c.querySelectorAll('button')];const record=buttons.find(b=>b.textContent==='บันทึกเสียงของฉัน');const analyze=buttons.find(b=>b.textContent==='ดูผลเสียงของฉัน');
 assert.ok(record);assert.equal(record.closest('.egl-ph-optional-analysis'),null);assert.equal(analyze.closest('.egl-ph-optional-analysis'),optional);
 assert.equal(analyze.disabled,true);assert.deepEqual(a.played,[]);assert.deepEqual(a.network,[]);
});
test('the per-widget human catalog takes precedence over synthesized assets and labels the full recording honestly',t=>{
 const a=setup(t,false);a.container.querySelector('.egl-ph-ref-word').click();
 const focus=a.container.querySelector('.egl-ph-reference-focus');const listen=[...focus.querySelectorAll('button')].find(b=>b.textContent==='ฟังคำตัวอย่าง');
 assert.ok(listen);listen.click();
 assert.ok(a.played.at(-1).includes('/prefix/app/assets/native-words/'));
 assert.match(a.container.querySelector('.egl-ph-example-caption').textContent,/ผู้พูดจริง/);
 assert.doesNotMatch(a.container.querySelector('.egl-ph-example-caption').textContent,/สร้างเสียงคำนี้/);assert.deepEqual(a.network,[]);
});
