const {JSDOM}=require('jsdom'),fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'../public');
const dom=new JSDOM(fs.readFileSync(root+'/index.html','utf8'),{url:'http://localhost:3180',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,ctx=dom.getInternalVMContext();
w.setInterval=()=>1;w.setTimeout=()=>1;w.requestAnimationFrame=()=>1;w.fetch=()=>new Promise(()=>{});w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this,measureText:()=>({width:20}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(t,k)=>k in t?t[k]:()=>{}})};
w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLElement.prototype.scrollIntoView=()=>{};
for(const el of [...w.document.scripts]){const code=el.src?fs.readFileSync(root+'/'+el.getAttribute('src').slice(1),'utf8'):el.textContent;vm.runInContext(code,ctx,{filename:el.src||'inline.js'})}
const q=s=>w.document.querySelector(s);assert(q('[data-tool=preview]').compareDocumentPosition(q('[data-tool=program]'))&4,'Preview comes first, PGM to its right');const area=t=>q('[data-tool='+t+']').style.gridArea.split('/').map(v=>parseInt(v.replace('span','')));assert(q('.free-grid [data-tool=preview]')&&q('.free-grid [data-tool=program]')&&q('.free-grid [data-tool=cameras]')&&q('.free-grid [data-tool=cut]'));assert(area('preview')[1]<area('program')[1],'Preview to the left of PGM');assert.equal(area('preview')[0],area('program')[0],'Preview and PGM side by side');assert(area('cameras')[0]>area('preview')[0],'cameras below the monitors');assert(area('preview')[3]<24,'smaller monitors by default');assert.equal(q('.transition-lever').getAttribute('aria-orientation'),'horizontal');assert.equal(q('#monProgram').closest('[data-tool]').dataset.tool,'program');assert(q('#pgmLeft').closest('[data-tool=program]'));assert.equal(q('#layoutRows').children.length,16);
const lever=q('.transition-lever');function key(k){lever.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}))}
const initial=vm.runInContext('[state.pgm,state.prv]',ctx).join();key('PageUp');assert.equal(vm.runInContext('state.progress',ctx),.1);assert.equal(vm.runInContext('[state.pgm,state.prv]',ctx).join(),initial);for(let i=0;i<9;i++)key('PageUp');assert.equal(vm.runInContext('state.progress',ctx),0);assert.equal(vm.runInContext('[state.prv,state.pgm]',ctx).join(),initial);for(let i=0;i<10;i++)key('PageDown');assert.equal(vm.runInContext('[state.pgm,state.prv]',ctx).join(),initial);
vm.runInContext('state.busy=true',ctx);key('PageUp');assert.equal(vm.runInContext('state.progress',ctx),0);vm.runInContext('state.busy=false',ctx);
const rowOf=t=>[...q('#layoutRows').children].find(r=>r.querySelector('strong').textContent===t);
const sel=rowOf('PGM / AR').querySelector('select');sel.value='configuration';sel.dispatchEvent(new w.Event('change'));assert.equal(q('[data-tool=program]').parentElement,vm.runInContext('configuration',ctx),'PGM now on the Configurações page');assert(!q('.free-grid [data-tool=program]'),'panel moved to another page');assert(JSON.parse(w.localStorage.getItem('andromeda.workspace.v3')).items.find(i=>i.id==='program').page==='configuration');
q('#layoutRestore').click();assert(q('.free-grid [data-tool=program]'),'restore brings PGM back');
const cams=rowOf('Câmeras'),[wIn,hIn]=cams.querySelectorAll('.layout-pair')[1].querySelectorAll('input');wIn.value='30';wIn.dispatchEvent(new w.Event('change'));assert.match(q('[data-tool=cameras]').style.gridArea,/span 30$/,'free width');
const [, hIn2]=rowOf('Câmeras').querySelectorAll('.layout-pair')[1].querySelectorAll('input');hIn2.value='25';hIn2.dispatchEvent(new w.Event('change'));assert.match(q('[data-tool=cameras]').style.gridArea,/span 25 \/ span 30$/,'free height');
const [xIn,yIn]=rowOf('Preview').querySelectorAll('.layout-pair')[0].querySelectorAll('input');yIn.value='20';yIn.dispatchEvent(new w.Event('change'));
const r=n=>JSON.parse(w.localStorage.getItem('andromeda.workspace.v3')).items.find(i=>i.id===n).rect,ov=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;const placed=JSON.parse(w.localStorage.getItem('andromeda.workspace.v3')).items.filter(i=>i.page==='operation');for(const a of placed)for(const b of placed)if(a!==b)assert(!ov(a.rect,b.rect),'no overlapping panels: '+a.id+' / '+b.id);
assert.equal(r('preview').y,19,'preview dropped on the cameras: it stays, the cameras move down');
q('#layoutNavButton').click();assert(w.document.body.classList.contains('layout-editing'));assert(!q('.free-editbar').hidden);q('#freeDone').click();assert(!w.document.body.classList.contains('layout-editing'));

const remote=vm.runInContext('window.andromedaRemote',ctx);assert.equal(q('[data-tool=remote]').parentElement,vm.runInContext('configuration',ctx),'cloud panel lives in Configurações');assert(remote.panel.closest('[data-tool=remote]'));
assert.equal(remote.apply({cmd:'prv',i:2}),true);assert.equal(vm.runInContext('state.prv',ctx),2,'remote PRV selection');assert.equal(remote.state().prvName,q('.bus-src').children[2].textContent.trim());
assert.equal(remote.apply({cmd:'eval',i:1}),false,'unknown command refused');assert.equal(remote.apply({cmd:'prv',i:'3'}),false,'malformed index refused');assert.equal(vm.runInContext('state.prv',ctx),2);
remote.apply({cmd:'cut'});assert.equal(vm.runInContext('state.pgm',ctx),2,'remote CUT puts the preview on air');
// Monitores: a imagem fica numa caixa de encaixe e a escala do operador é salva.
assert(q('[data-tool=preview] .mon-fit #monPreview')&&q('[data-tool=program] .mon-fit #monProgram'),'monitors fit their panel');assert.equal(q('#monPreview').style.width,'','no measured width left behind');
q('#layoutNavButton').click();q('[data-tool=preview] .mon-scale button').click();assert.equal(q('[data-tool=preview] .mon-scale output').textContent,'95%');assert.equal(q('[data-tool=preview]').style.getPropertyValue('--mon-scale'),'0.95');
assert.equal(JSON.parse(w.localStorage.getItem('andromeda.workspace.v3')).items.find(i=>i.id==='preview').scale,95,'operator scale saved');q('#freeDone').click();
// Layouts gravados com nome.
const layoutRow=t=>[...q('#layoutRows').children].find(r=>r.querySelector('strong').textContent===t);
q('#freeName').value='Entrevista';q('#freeSave').click();const savedList=JSON.parse(w.localStorage.getItem('andromeda.layouts.v1'));assert.equal(savedList.length,1);assert.equal(savedList[0].name,'Entrevista');
assert.equal(q('#freePreset').value,'meu:0');const camW=()=>q('[data-tool=cameras]').style.gridArea;const before=camW();
const wIn2=layoutRow('Câmeras').querySelectorAll('.layout-pair')[1].querySelector('input');wIn2.value='20';wIn2.dispatchEvent(new w.Event('change'));assert.notEqual(camW(),before);assert.equal(q('#freePreset').value,'','manual change leaves the saved model');
q('#freePreset').value='meu:0';q('#freePreset').dispatchEvent(new w.Event('change'));assert.equal(camW(),before,'saved layout restored');
q('#freeDelete').click();assert.equal(JSON.parse(w.localStorage.getItem('andromeda.layouts.v1')).length,0);
console.log('PASS: monitor fit and operator scale; named layouts saved, restored and deleted');
// Transmitir e gravar / só transmitir / só gravar.
const modes=[...q('.tx-mode').children];assert.deepEqual(modes.map(b=>b.textContent),['Transmitir e gravar','Só transmitir','Só gravar']);
const start=q('#transmitYouTube');modes[2].click();assert.equal(start.textContent,'● GRAVAR');modes[1].click();assert.match(start.textContent,/^▶ TRANSMITIR/);modes[0].click();assert.match(start.textContent,/^▶ TRANSMITIR \+ GRAVAR/);
modes[2].click();start.click();assert.doesNotMatch(q('#txStatus').textContent,/falta servidor ou chave/,'record only ignores incomplete destinations');
modes[1].click();start.click();assert.match(q('#txStatus').textContent,/destino/,'stream needs a ready destination');
console.log('PASS: output mode: transmit and record, transmit only, record only');
console.log('PASS: remote control applies PRV/CUT through the desk buttons and refuses anything else');
console.log('PASS: all application scripts load; Preview left / PGM right; audio attached; 15 tool panels; partial transition; both T-bar directions; AUTO lock; free layout: size, position, page, no overlap, edit mode');dom.window.close();
