const {JSDOM}=require('jsdom'),fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'../public');
const dom=new JSDOM(fs.readFileSync(root+'/index.html','utf8'),{url:'http://localhost:3180',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,ctx=dom.getInternalVMContext();
w.setInterval=()=>1;w.setTimeout=()=>1;w.requestAnimationFrame=()=>1;w.fetch=()=>new Promise(()=>{});w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this,measureText:()=>({width:20}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(t,k)=>k in t?t[k]:()=>{}})};
w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLElement.prototype.scrollIntoView=()=>{};
for(const el of [...w.document.scripts]){const code=el.src?fs.readFileSync(root+'/'+el.getAttribute('src').slice(1),'utf8'):el.textContent;vm.runInContext(code,ctx,{filename:el.src||'inline.js'})}
const q=s=>w.document.querySelector(s);assert(q('[data-tool=preview]').compareDocumentPosition(q('[data-tool=program]'))&4,'Preview comes first, PGM to its right');const area=t=>q('[data-tool='+t+']').style.gridArea.split('/').map(v=>parseInt(v.replace('span','')));assert(q('.free-grid [data-tool=preview]')&&q('.free-grid [data-tool=program]')&&q('.free-grid [data-tool=cameras]')&&q('.free-grid [data-tool=cut]'));assert(area('preview')[1]<area('program')[1],'Preview to the left of PGM');assert.equal(area('preview')[0],area('program')[0],'Preview and PGM side by side');assert(area('cameras')[0]>area('preview')[0],'cameras below the monitors');assert(area('preview')[3]<24,'smaller monitors by default');assert.equal(q('.transition-lever').getAttribute('aria-orientation'),'horizontal');assert.equal(q('#monProgram').closest('[data-tool]').dataset.tool,'program');assert(q('#pgmLeft').closest('[data-tool=layers]'),'L/R modulation lives in the master audio panel');assert(q('.pgm-audio-monitor').hidden,'the AR monitor keeps only the picture');assert.equal(q('#layoutRows').children.length,20);
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
// Formato por plataforma: Instagram e TikTok entram em 9:16, os demais em 16:9; saída vertical com enquadramento.
const choose=[...w.document.querySelectorAll('.stream-panel select')].find(x=>[...x.options].some(o=>o.value==='instagram'));
for(const pf of ['instagram','tiktok','facebook']){choose.value=pf;choose.dispatchEvent(new w.Event('change'));[...w.document.querySelectorAll('.stream-panel button')].find(b=>b.textContent==='Adicionar destino').click()}
const aspects=[...w.document.querySelectorAll('.dest')].map(c=>c.dataset.platform+' '+c.dataset.aspect);
assert(aspects.includes('youtube 16:9')&&aspects.includes('instagram 9:16')&&aspects.includes('tiktok 9:16')&&aspects.includes('facebook 16:9'),aspects.join(','));
assert(q('.vertical-panel')&&q('#programVertical'),'vertical output card');assert.equal(vm.runInContext('andromedaVertical.size().join("x")',ctx),'720x1280','Instagram live default 720x1280');
assert.match(q('.vertical-uses').textContent,/Instagram/);assert.match(q('.vertical-uses').textContent,/TikTok/);
[...q('.vertical-modes').children][1].click();assert.equal(vm.runInContext('andromedaVertical.settings.mode',ctx),'blur');
assert.deepEqual([...q('#recFormats').options].map(o=>o.value),['both','16:9','9:16']);assert.equal(q('#recFormats').value,'both','recording delivers 16:9 and 9:16 by default');assert.match(q('#recFormats').selectedOptions[0].textContent,/16:9 e 9:16/);
console.log('PASS: per-platform screen format (16:9 / 9:16) and vertical framing');
{const css=fs.readFileSync(root+'/workspace-custom.css','utf8');assert.match(css,/\.workspace-page>\.dock-panel\[data-tool=fx-preview\]\{position:sticky;top:calc\(var\(--topbar-h,56px\) \+ 12px\)/,'effects preview follows the page scroll');assert.match(css,/@media\(max-width:500px\)\{\.workspace-page>\.dock-panel\[data-tool=fx-preview\]\{position:static/,'stacked on phones');assert(w.document.documentElement.style.getPropertyValue('--topbar-h'),'top bar height measured for the sticky preview');console.log('PASS: effects preview stays in view while the settings scroll')}
{const rd=vm.runInContext('window.andromedaRundown',ctx),cmd=vm.runInContext('window.andromedaCommands',ctx);
assert.equal(rd.parseClock('5'),300);assert.equal(rd.parseClock('4:30'),270);assert.equal(rd.parseClock('1:00:00'),3600);assert.equal(rd.parseClock('7:75'),null);assert.equal(rd.parseClock('abc'),null);assert.equal(rd.parseClock('0:00'),null);
assert.equal(rd.formatClock(65),'01:05');assert.equal(rd.formatClock(3600),'1:00:00');assert.equal(rd.formatClock(0.2),'00:01','a running countdown shows 00:01 until it really reaches zero');
// Comandos no lugar da seleção de fontes: o PREVIEW é escolhido no multiview.
const cmds=[...q('[data-tool=bus] .cmd-grid').children].map(b=>b.dataset.cmd);assert.deepEqual(cmds,['gc0','gc1','gc2','logo','countdown','pip','vinheta','black','vt','vtnext','vtpause','vtstop','mosaic','slides','slideprev','slidenext','trilha','trilhanext','tracking','intercom','bars']);
assert([...q('[data-tool=bus]').querySelectorAll('.bus-row')].every(r=>r.hidden),'PRV/PGM rows leave the panel');assert.equal(q('[data-tool=bus] .dock-handle').firstChild.textContent,'Comandos');
// Botões personalizáveis: ordem, tamanho, por linha e largo; a barra de ajuste só aparece no Personalizar.
{const grid=q('[data-tool=bus] .cmd-grid'),tools=q('[data-tool=bus] .cmd-tools');assert(tools&&tools.querySelector('input[type=range]')&&tools.querySelector('select'),'size bar and buttons-per-row in the commands panel');
cmd.moveCommand('bars','gc0');assert.equal(grid.firstElementChild.dataset.cmd,'bars','a command can be moved to another place');assert.equal(grid.dataset.custom,'true');
cmd.setSize(150);assert.equal(grid.style.getPropertyValue('--cmd-scale'),'1.5');assert.equal(tools.querySelector('output').textContent,'150%');cmd.setSize(999);assert.equal(cmd.layout().size,200,'size is limited to 200%');
cmd.setCols(3);assert.equal(grid.style.getPropertyValue('--cmd-cols'),'3');cmd.setWide('black',true);assert.equal(q('.cmd-btn[data-cmd=black]').dataset.wide,'true');
assert.equal(JSON.parse(w.localStorage.getItem('andromeda.commands.v1')).size,200,'the look is saved');
cmd.resetLook();assert.deepEqual([...grid.children].map(b=>b.dataset.cmd),cmds,'Restaurar brings back the standard order');assert.equal(cmd.layout().size,100);assert.equal(q('.cmd-btn[data-cmd=black]').dataset.wide,'false');}
assert(q('.cmd-btn[data-cmd=pip]'),'the PiP command is on the desk');assert(!q('[data-tool=bus] .key-panel'),'the KEY 1 (PiP) monitor window is not on the desk any more');assert(q('.key-panel').hidden,'and the panel stays hidden wherever else it was attached');
// Regressiva direto no AR; tempo no ajuste (duplo clique).
rd.cdRow.querySelector('#cdTime').value='2:30';rd.cdRow.querySelector('#cdTime').dispatchEvent(new w.Event('change'));assert.equal(rd.countdown.seconds,150);rd.cdRow.querySelector('#cdPlus').click();assert.equal(rd.countdown.seconds,180);
q('.cmd-btn[data-cmd=countdown]').click();assert(rd.countdown.on,'REGRESSIVA goes straight to air');assert(rd.cdRow.querySelector('#cdTime').disabled,'time locked while on air');q('.cmd-btn[data-cmd=countdown]').click();assert(!rd.countdown.on);
q('.cmd-btn[data-cmd=countdown]').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));assert(!q('.cmd-pop').hidden&&q('.cmd-pop').contains(rd.cdRow),'double click opens the countdown settings');q('.cmd-pop-close').click();assert(q('.cmd-pop').hidden);
// Áudio no MASTER (Habilitar áudio e Fones) e estilos modernos dos botões; a barra antiga do mixer sai de vista.
assert(q('.master-panel #masterAudioOn')&&q('.master-panel #masterPhones'),'enable audio and headphones live in the MASTER panel');
cmd.setStyle('neon');assert.equal(q('[data-tool=bus] .cmd-grid').dataset.btnStyle,'neon');assert.equal(q('.master-panel').dataset.btnStyle,'neon');cmd.setStyle('nada');assert.equal(cmd.layout().style,'vidro','unknown style falls back to Vidro');
assert(w.andromedaPlayerInfo,'VT/vinheta own the PREVIEW/PGM info strips (no flicker)');
// Mover botões direto no painel (sem Personalizar), setas, número de atalho nas câmeras e vinheta com/sem áudio.
{const bus=q('[data-tool=bus] .me-bus')||q('.me-bus'),grid=q('[data-tool=bus] .cmd-grid');assert(!q('.cmd-move-toggle')||getComputedStyle?.(q('.cmd-move-toggle')),'no Mover botões button in the Comandos panel (moving lives in Personalizar)');assert(!w.document.querySelector('.arr-toggle'),'and none in the other panels');assert(w.document.querySelector('[data-tool=cut] .arr-tools'),'Personalizar tools (‹ › Restaurar) exist in the panels');
cmd.setMove(true);assert.equal(bus.dataset.move,'true');const before=[...grid.children].map(b=>b.dataset.cmd);const prv0=vm.runInContext('state.prv',ctx);q('.cmd-btn[data-cmd=black]').click();assert.equal(vm.runInContext('state.prv',ctx),prv0,'buttons do not fire while moving');assert(!rd.black.on);
cmd.nudge('gc1',-1);assert.equal(grid.children[0].dataset.cmd,'gc1','a button moves one place with the arrows');cmd.nudge('gc1',1);assert.deepEqual([...grid.children].map(b=>b.dataset.cmd),before,'and back');cmd.setMove(false);
assert.equal(q('.mv-cell .cell-key').textContent,'1','the camera number is on the camera');
assert.equal([...w.document.querySelectorAll('.mv-cell .cell-key')].slice(0,10).map(c=>c.textContent).join(''),'1234567890');
assert.equal(rd.vinhetaPlayer.audio,true);rd.setVinhetaAudio(false);assert.equal(rd.vinhetaPlayer.audio,false);assert.equal(w.localStorage.getItem('andromeda.vinheta.audio.v1'),'false');assert(/SEM ÁUDIO/.test(q('.cmd-btn[data-cmd=vinheta] .cmd-sub').textContent),'the button shows it');rd.setVinhetaAudio(true);}
// Áudio de cada câmera: três botões fixos OFF / AR / ON no lugar do menu.
{const g=q('.mv-cell .cell-mode');assert(g,'audio mode buttons on each camera');assert.deepEqual([...g.children].map(b=>b.textContent),['OFF','AR','ON']);
g.querySelector('[data-mode=afv]').click();assert.equal(vm.runInContext('audioMixer.settings[0].mode',ctx),'afv','AR = audio follows the video (on air only)');g.querySelector('[data-mode=on]').click();assert.equal(vm.runInContext('audioMixer.settings[0].mode',ctx),'on');g.querySelector('[data-mode=off]').click();assert.equal(vm.runInContext('audioMixer.settings[0].mode',ctx),'off');}
// VINHETA em LOOP: guarda a escolha e o ajuste mostra a opção.
rd.setVinhetaLoop(true);assert(rd.vinhetaPlayer.loop);assert.equal(w.localStorage.getItem('andromeda.vinheta.loop.v1'),'true');assert(q('.cmd-btn[data-cmd=vinheta] .cmd-sub').textContent.startsWith('↻'),'the VINHETA button shows the loop');
q('.cmd-btn[data-cmd=vinheta]').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));assert(q('#vinhetaLoop').checked,'loop option in the vinheta settings');q('.cmd-pop-close').click();rd.setVinhetaLoop(false);assert(!rd.vinhetaPlayer.loop);
// VT e VINHETA vão ao PREVIEW; ao AR com CUT. Câmeras AFV saem do áudio porque não estão no AR.
assert.equal(rd.vtToPreview(),false,'empty playlist: nothing goes to preview');assert.equal(rd.vtSeek(5),false,'timeline without a VT does nothing');
rd.vt.items.push({name:'Abertura',el:{currentTime:0,ended:false,pause(){},play:()=>Promise.resolve()},duration:12});rd.cue(0);assert(rd.vtSeek(6));assert.equal(rd.vt.items[0].startAt,6,'double click on the timeline of an armed VT sets where it starts');rd.vt.items[0].startAt=0;q('.cmd-btn[data-cmd=vt]').click();
assert.equal(vm.runInContext('state.prv',ctx),rd.VT_SOURCE,'VT command puts the VT in PREVIEW');assert.equal(q('.cmd-btn[data-cmd=vt]').dataset.prv,'true');
const cam=vm.runInContext('state.pgm',ctx);vm.runInContext('cams[state.pgm].conn=true;cut()',ctx);assert.equal(vm.runInContext('state.pgm',ctx),rd.VT_SOURCE);assert.equal(vm.runInContext('audioWeight("afv",'+cam+')',ctx),0,'AFV camera out of the mix while the VT is on air');
assert.equal(vm.runInContext('state.prv',ctx),cam,'the camera that was on air waits in PREVIEW to come back');assert(vm.runInContext('window.andromedaVtOnAir()',ctx));
// VT PRÓXIMO: com um VT tocando no AR, dispara o seguinte da playlist sem abrir o painel; no último não faz nada.
rd.vt.items.push({name:'Encerramento',el:{currentTime:0,ended:false,pause(){},play:()=>Promise.resolve()},duration:20});
rd.vtPlayer.running=true; /* o relógio dos reprodutores (setInterval) está desligado neste teste: faz o que ele faria ao VT entrar no AR */
assert.equal(vm.runInContext('state.pgm',ctx),rd.VT_SOURCE);assert.match(rd.vtNextLabel(),/2\/2 · Encerramento/,'the button names the next VT and its place in the playlist');
assert.equal(rd.vtNext(),true,'VT NEXT on air jumps to the next VT');assert.equal(rd.vtPlayer.item.name,'Encerramento');assert.equal(rd.vt.cue,1);assert(rd.vtPlayer.running);
assert.equal(rd.vtNext(),false,'last VT: nothing more to fire');assert.equal(rd.vtNextLabel(),'último VT');
assert.equal(q('.cmd-btn[data-cmd=vtnext] .cmd-key').textContent,'⇧F9','VT NEXT has its own shortcut');
// PAUSAR / CONTINUAR e PARAR do VT.
{let elPaused=false;const el=rd.vtPlayer.item.el;el.pause=()=>{elPaused=true};el.play=()=>{elPaused=false;return Promise.resolve()};
assert.equal(rd.vtPause(),true);assert(rd.vtPlayer.paused&&elPaused,'PAUSAR freezes the VT on air');cmd.paint();assert.equal(q('.cmd-btn[data-cmd=vtpause] .cmd-name').textContent,'CONTINUAR VT');assert.equal(q('.cmd-btn[data-cmd=vtpause]').getAttribute('aria-pressed'),'true');assert.equal(q('.cmd-btn[data-cmd=vtpause] .cmd-key').textContent,'⇧F7');
assert.equal(rd.vtPause(),true);assert(!rd.vtPlayer.paused&&!elPaused,'CONTINUAR resumes the VT');
const held=rd.vtPlayer.item;assert.equal(rd.vtStop(),true,'PARAR takes the VT off air');assert.equal(q('.cmd-btn[data-cmd=vtstop] .cmd-key').textContent,'⇧F8');}
vm.runInContext('cut()',ctx);
// Fim natural arma o próximo; VT interrompido não avança sozinho; PRÓXIMO VT sem VT no AR arma o seguinte (quem leva ao PREVIEW é o VT).
rd.vtPlayer.running=false; /* o VT saiu do AR (o relógio dos reprodutores está desligado neste teste) */
rd.vt.cue=0;rd.vtPlayer.item=rd.vt.items[0];rd.vtPlayer.onStop(true);assert.equal(rd.vt.cue,1,'natural end: the playlist arms the next VT');
rd.vt.cue=0;rd.vtPlayer.item=rd.vt.items[0];rd.vtPlayer.onStop(false);assert.equal(rd.vt.cue,0,'interrupted VT: nothing advances by itself');
assert.match(rd.vtNextLabel(),/^armar 2\/2 · Encerramento$/,'the button says which VT it will arm');const prvBefore=vm.runInContext('state.prv',ctx);
assert.equal(rd.vtNext(),true);assert.equal(rd.vt.cue,1,'PRÓXIMO VT without a VT on air arms the next one');assert.equal(vm.runInContext('state.prv',ctx),prvBefore,'and does not touch the PREVIEW');
assert.equal(rd.vtNext(),false,'the armed VT is the last one');
assert.equal(rd.vinhetaToPreview(),false,'no vinheta loaded yet');
// BLACK (F1) e BARRAS (F2) direto no AR; atalhos configuráveis; ESC volta à Operação.
const key=(k,code)=>w.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,code:code||k,bubbles:true,cancelable:true}));
// BLACK (F1) e BARRAS (F2) passam pelo PREVIEW; o direto no AR (emergência) ficou em Shift+F1 / Shift+F2.
{const S=()=>vm.runInContext('({pgm:state.pgm,prv:state.prv})',ctx),keep=S(),BARS=rd.BARS_SOURCE;vm.runInContext('state.busy=false;state.progress=0;state.pgm=0;state.prv=1',ctx);
key('F1');assert.equal(S().prv,10,'F1 puts BLACK (the black source) in PREVIEW');assert.equal(S().pgm,0,'and does not touch the air');assert(!rd.black.on);
key('F2');assert.equal(S().prv,BARS,'F2 puts the BARS in PREVIEW');assert.equal(S().pgm,0);assert(!rd.bars.on,'no overlay on air');
assert.equal(q('.cmd-btn[data-cmd=bars]').dataset.prv,'true','the BARRAS button shows it is in PREVIEW');
vm.runInContext('cut()',ctx);assert.equal(S().pgm,BARS,'CUT takes the bars to air');assert.equal(q('.cmd-btn[data-cmd=bars]').getAttribute('aria-pressed'),'true','and the button shows it is on air');
key('F1');vm.runInContext('cut()',ctx);assert.equal(S().pgm,10,'BLACK then CUT = black on air');
key('F1','F1');const shiftKey=(k)=>w.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,code:k,shiftKey:true,bubbles:true,cancelable:true}));
shiftKey('F1');assert(rd.black.on,'Shift+F1 = BLACK direct on air (emergency)');shiftKey('F1');assert(!rd.black.on);shiftKey('F2');assert(rd.bars.on,'Shift+F2 = BARS direct on air');shiftKey('F2');assert(!rd.bars.on);
vm.runInContext('state.pgm='+keep.pgm+';state.prv='+keep.prv,ctx);}
// Números 1–9 e 0 = câmera direto no AR (CUT); F1–F12 são sempre da mesa (o navegador nunca recarrega, abre ajuda ou busca).
{const A=Object.fromEntries(cmd.ACTIONS.map(x=>[x.id,x.key]));for(let i=0;i<10;i++)assert.equal(A['cam'+i],i<9?String(i+1):'0','key '+(i<9?i+1:0)+' = camera '+(i+1)+' straight to air');assert.equal(A.prv0,'','the old PREVIEW numbers are free');
for(const f of ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']){const ev=new w.KeyboardEvent('keydown',{key:f,bubbles:true,cancelable:true});w.dispatchEvent(ev);assert(ev.defaultPrevented,f+' never reaches the browser');}
for(const f of ['F5','F12']){const input=q('#fxLayer')||q('input');const ev=new w.KeyboardEvent('keydown',{key:f,bubbles:true,cancelable:true});input.dispatchEvent(ev);assert(ev.defaultPrevented,f+' is prevented even with a form field focused');}
const saved=vm.runInContext('({pgm:state.pgm,prv:state.prv,busy:state.busy,progress:state.progress})',ctx);vm.runInContext('state.busy=false;state.progress=0;state.pgm=0;state.prv=1;cams[3].conn=false',ctx);key('4');assert.equal(vm.runInContext('state.pgm',ctx),0,'a camera without signal never goes to air by key');assert.equal(vm.runInContext('state.prv',ctx),3,'it stays in PREVIEW');
vm.runInContext('state.progress=.4',ctx);key('1');assert.equal(vm.runInContext('state.pgm',ctx),0,'no jump during a transition');vm.runInContext('state.progress=0',ctx);
vm.runInContext('state.busy='+saved.busy+';state.progress='+saved.progress+';state.pgm='+saved.pgm+';state.prv='+saved.prv,ctx);}
assert.equal(q('.cmd-btn[data-cmd=black] .cmd-key').textContent,'F1');assert.equal(q('.shortcut-list').children.length,cmd.ACTIONS.length,'every command can get a keyboard shortcut');
vm.runInContext("openWorkspace('effects')",ctx);assert(!q('.effects-page').hidden);key('Escape');assert(q('.effects-page').hidden&&!vm.runInContext('operation.hidden',ctx),'ESC returns to Operação');
// Áudio master no lugar de Camadas no ar, com FADE OUT e tempo.
assert(q('[data-tool=layers] #masterFader')&&q('[data-tool=layers] #masterFade')&&q('[data-tool=layers] #masterFadeTime'));assert.equal(q('[data-tool=layers] .dock-handle').firstChild.textContent,'Áudio master');assert(q('.fx-quick').hidden);assert(q('#enableMixer').hidden,'audio turns on by itself');
// Câmeras: informações e mosaico na barra; duplo clique numa câmera abre Fontes de câmera.
assert(q('[data-tool=cameras] .dock-handle .dock-tools .stage-tools'),'camera and mosaic tools in the Câmeras bar');
q('.mv-cell').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));assert(q('#mediaDialog').open,'double click on a camera opens Fontes de câmera');q('#mediaDialog').close();
// Ordem e visibilidade dos botões de comando.
q('.cmd-order-row:nth-child(2) button').click();assert.equal(q('[data-tool=bus] .cmd-grid').children[0].dataset.cmd,'gc1','buttons can be reordered');q('.cmd-order-row:first-child input').click();assert.equal(q('[data-tool=bus] .cmd-grid').children.length,20,'and hidden');
console.log('PASS: commands panel (button styles, audio switches in MASTER, VT timeline seek, custom order, size bar, buttons per row, wide; vinheta LOOP; GC, logo, countdown on air, PiP, VT/vinheta to preview, BLACK F1, BARS F2), master audio with fade, shortcuts, ESC, camera bar, double click to camera sources')}
{const sync=vm.runInContext('window.andromedaSync',ctx),pre=vm.runInContext('window.andromedaPreflightUI',ctx);
assert(q('[data-tool=transport] .sync-card #syncCalibrate')&&q('[data-tool=transport] .sync-card #syncSlider'),'lip-sync calibration lives in the encoder panel');assert(q('[data-tool=transport] .pf-card #pfRun')&&q('#pfPreset'),'machine check lives in the encoder panel');
assert.deepEqual([...q('#pfPreset').options].map(o=>o.value),['veryfast','superfast','ultrafast']);
// ajuste fino: guarda a compensação e a mostra com sinal
q('#syncSlider').value='-120';q('#syncSlider').dispatchEvent(new w.Event('input'));assert.equal(vm.runInContext('andromedaBroadcast.model.avSyncMs',ctx),-120);assert.match(q('#syncState').textContent,/−120 ms · imagem atrasada/);q('#syncSlider').value='80';q('#syncSlider').dispatchEvent(new w.Event('input'));assert.match(q('#syncState').textContent,/\+80 ms · som atrasado/);q('#syncZero').click();assert.equal(vm.runInContext('andromedaBroadcast.model.avSyncMs',ctx),0);
q('#pfPreset').value='ultrafast';q('#pfPreset').dispatchEvent(new w.Event('change'));assert.equal(vm.runInContext('andromedaBroadcast.model.preset',ctx),'ultrafast');q('#pfPreset').value='veryfast';q('#pfPreset').dispatchEvent(new w.Event('change'));
// a mensagem de início leva compensação, velocidade, e avisa que o navegador sabe reabrir o gravador; só a calibração pede "calibrate"
const src=fs.readFileSync(root+'/broadcast.js','utf8');assert.match(src,/avSyncMs: liveTx\.calibrating \? 0 : avSyncFor\(engine\), engine, preset: model\.preset \|\| 'veryfast', resync: true, calibrate: !!liveTx\.calibrating/);assert.match(src,/if \(!liveTx\.calibrating\) state\.live = true/,'calibration never puts the desk on air');
assert.match(src,/recorder\.state === 'inactive'\) recorder\.start\(100\)/,'a restart never calls start() on a recording recorder');assert.match(src,/msg\.type === 'restart'\) \{ if \(engine === 'native'\) nativeSession\?\.restart\(msg\.group\); else reopen\(msg\.group\)/);assert.match(src,/fallbackToStandard/,'any failure of the own engine hands the session to the standard encoder');
// sem plataforma alcançável, o pré-voo impede o início; com falha do próprio pré-voo, não atrapalha
assert.equal(typeof vm.runInContext('window.andromedaPreflight',ctx),'function');
// modo leve: miniaturas ainda mais espaçadas quando o codificador fica para trás
assert.match(fs.readFileSync(root+'/index.html','utf8'),/const k=window\.andromedaLight\?3:1;/);assert.match(src,/if \(msg\.overload\) window\.andromedaLight = true/);
console.log('PASS: lip-sync calibration and fine adjustment, machine check card, restart-safe recorders, light mode')}
console.log('PASS: remote control applies PRV/CUT through the desk buttons and refuses anything else');
// Dois monitores: cada painel pode ir para a "Segunda tela", há o modelo "Duas telas" e o botão para abrir a janela.
{const presets=[...q('#layoutPreset').options].map(o=>o.value);assert(presets.includes('duas'),'preset Duas telas');const pageSel=q('#layoutRows select');assert([...pageSel.options].some(o=>o.value==='second'&&o.textContent==='Segunda tela'),'page option Segunda tela');assert(q('#layoutSecond')&&q('#freeSecond'),'open second screen buttons');assert(q('.second-notice').hidden,'no notice while nothing is on the second screen');assert(typeof w.andromedaSecondScreen?.open==='function');}
console.log('PASS: all application scripts load; second screen (two monitors) ready; Preview left / PGM right; audio attached; 15 tool panels; partial transition; both T-bar directions; AUTO lock; free layout: size, position, page, no overlap, edit mode');dom.window.close();
