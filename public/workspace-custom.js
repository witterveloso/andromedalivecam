'use strict';
(()=>{
 /*
  * Mesa personalizável (layout v3).
  * Operação: grade livre de 48 colunas por 48 linhas, que ocupa uma tela. Cada painel tem posição e tamanho próprios:
  * em "Personalizar", arraste pelo título para mover e pelo canto para mudar o tamanho (ou use as setas; Shift muda o tamanho).
  * Um painel solto sobre outro empurra o outro para baixo. As demais páginas mantêm painéis em fluxo (largura total ou meia).
  * Layouts v2 salvos são ignorados: o padrão novo tem monitores menores.
  */
 const key='andromeda.workspace.v3',COLS=48,ROWS=48,MIN_W=6,MIN_H=4,GAP=8;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e};
 const grid=make('div','free-grid');
 operation.classList.add('custom-workspace','free-workspace');operation.append(grid);
 const pages={operation:grid,configuration,transmission,effects:effectsPage};
 const pageNames={operation:'Operação',configuration:'Configurações',transmission:'Transmissão',effects:'GC e efeitos'};
 const definitions=[['preview','Preview',$('#monPreview'),'operation','half'],['program','PGM / AR',programCard,'operation','half'],['cameras','Câmeras',multiview,'operation','full'],['cut','Corte e transições',controls,'operation','full'],['bus','Seleção de fontes',bus,'operation','full'],['layers','Camadas no ar',fxQuick,'operation','full'],['intercom','Intercom',intercom,'operation','full'],['audio','Mixer de áudio',audioPanel,'operation','full'],['camera-links','Convites Andromeda Cam',camSettings,'configuration','full'],['blackmagic','Entradas Blackmagic',bmPanel,'configuration','full'],['transport','Codificador',transportPanel,'transmission','full'],['destinations','Destinos',$('.stream-panel'),'transmission','full'],['events','Eventos',$('.events'),'configuration','full'],['fx-editor','Ajustes GC / PiP',$('.effects-editor'),'effects','half'],['fx-preview','Prévia dos efeitos',$('.effects-preview'),'effects','half'],['remote','Mesa na nuvem',$('.remote-panel'),'configuration','full']];
 // [coluna, linha, largura, altura] na grade de 48 × 48 (uma tela).
 const PRESETS={
  padrao:{name:'Padrão · monitores menores',rects:{preview:[0,0,16,22],program:[16,0,16,22],bus:[32,0,16,11],layers:[32,11,16,11],cameras:[0,22,48,17],cut:[0,39,48,9],audio:[0,48,28,18],intercom:[28,48,20,18]}},
  cameras:{name:'Câmeras em destaque',rects:{cameras:[0,0,30,28],preview:[30,0,18,14],program:[30,14,18,14],cut:[0,28,48,9],bus:[0,37,24,11],layers:[24,37,24,11],audio:[0,48,28,18],intercom:[28,48,20,18]}},
  grandes:{name:'Monitores grandes',rects:{preview:[0,0,24,26],program:[24,0,24,26],cameras:[0,26,48,13],cut:[0,39,48,9],bus:[0,48,24,11],layers:[24,48,24,11],audio:[0,59,28,18],intercom:[28,59,20,18]}},
 };
 let items=definitions.filter(d=>d[2]).map(([id,title,content,page,width],order)=>{const shell=make('section','dock-panel');shell.dataset.tool=id;const header=make('div','dock-handle',title);const size=make('span','free-size');header.append(size);const grip=make('span','free-resize');grip.title='Arraste para mudar o tamanho';shell.append(header,content,grip);return {id,title,shell,header,size,grip,page,width,order,rect:null,defaultPage:page,defaultWidth:width}});
 // Mover os nós existentes, nunca recriar mídia ou áudio. O monitor de chave do PiP fica no painel de camadas.
 items.find(i=>i.id==='layers')?.shell.append(keyPanel);
 // Monitores: a imagem ocupa o espaço que o painel dá (encaixe por CSS, sem medir e sem realimentação) vezes a escala
 // escolhida pelo operador. Antes, cada novo cálculo encolhia a imagem um pouco, até o mínimo.
 const SCALE_MIN=25,SCALE_MAX=100,SCALE_STEP=5;
 for(const [id,monId] of [['preview','monPreview'],['program','monProgram']]){const item=items.find(i=>i.id===id),mon=item?.shell.querySelector('#'+monId);if(!item||!mon)continue;mon.style.width='';
  const fit=make('div','mon-fit');mon.before(fit);fit.append(mon);item.scale=SCALE_MAX;
  const ctl=make('span','mon-scale'),minus=make('button','','−'),out=make('output','',''),plus=make('button','','+');minus.type=plus.type='button';
  minus.setAttribute('aria-label','Diminuir a imagem de '+item.title);plus.setAttribute('aria-label','Aumentar a imagem de '+item.title);ctl.append(minus,out,plus);item.header.insertBefore(ctl,item.size);
  for(const b of [minus,plus])b.addEventListener('pointerdown',e=>e.stopPropagation());
  minus.onclick=()=>setScale(item,item.scale-SCALE_STEP);plus.onclick=()=>setScale(item,item.scale+SCALE_STEP);item.scaleOut=out}
 rightStage.remove();monitors.remove();
 const byId=id=>items.find(i=>i.id===id);
 function setScale(item,v){item.scale=Math.min(SCALE_MAX,Math.max(SCALE_MIN,Math.round(v/SCALE_STEP)*SCALE_STEP));paintScale(item);paintRows();save()}
 function paintScale(item){if(!item.scaleOut)return;item.shell.style.setProperty('--mon-scale',String(item.scale/100));item.scaleOut.textContent=item.scale+'%'}
 const opItems=()=>items.filter(i=>i.page==='operation');
 const bottomRow=except=>Math.max(0,...opItems().filter(i=>i!==except&&i.rect).map(i=>i.rect.y+i.rect.h));
 function applyPreset(name){const preset=PRESETS[name];for(const item of items){if(item.scaleOut)item.scale=SCALE_MAX;const r=preset.rects[item.id];if(r){item.page='operation';item.rect={x:r[0],y:r[1],w:r[2],h:r[3]};}else{item.page=item.defaultPage;item.width=item.defaultWidth;if(item.page==='operation')item.rect={x:0,y:bottomRow(item),w:COLS,h:12};}item.order=definitions.findIndex(d=>d[0]===item.id);}}
 const panel=make('section','layout-settings');
 panel.innerHTML='<h2>Personalizar a mesa</h2><p>Na Operação, cada painel tem o tamanho e o lugar que você quiser. Toque em <b>Personalizar</b> no topo: arraste o painel pelo título para mover e pelo canto inferior direito para mudar o tamanho. Com o título selecionado, as setas movem e Shift + setas mudam o tamanho. A grade tem 48 colunas e 48 linhas por tela. Os ajustes ficam salvos neste computador e não mudam o sinal do AR.</p><div class="layout-actions"><button id="layoutEdit">Editar posições</button><label>Modelo <select id="layoutPreset"></select></label><span class="layout-save"><input id="layoutName" maxlength="40" placeholder="Nome do layout" aria-label="Nome do layout para salvar"><button id="layoutSave">Salvar layout</button><button id="layoutDelete">Excluir</button></span><button id="layoutPack">Juntar painéis</button><button id="layoutRestore">Restaurar padrão</button><button id="layoutExport">Exportar layout</button><label>Importar layout <input id="layoutImport" type="file" accept="application/json,.json"></label></div><div class="layout-head" aria-hidden="true"><span>Painel</span><span>Página</span><span>Coluna · Linha</span><span>Largura · Altura</span><span>Ordem · imagem</span></div><div id="layoutRows"></div><p id="layoutMessage" role="status"></p>';
 configuration.prepend(panel);
 const editBar=make('div','free-editbar');editBar.setAttribute('role','toolbar');editBar.setAttribute('aria-label','Personalizar a mesa');
 editBar.innerHTML='<strong>Personalizando</strong><span>Título: mover · canto ◢: tamanho · setas e Shift + setas no teclado · Esc conclui</span><label>Modelo <select id="freePreset"></select></label><span class="layout-save"><input id="freeName" maxlength="40" placeholder="Nome do layout" aria-label="Nome do layout para salvar"><button id="freeSave">Salvar layout</button><button id="freeDelete">Excluir</button></span><button id="freePack">Juntar painéis</button><button id="freeRestore">Restaurar padrão</button><button id="freeDone" class="free-done">Concluir</button>';
 operation.prepend(editBar);editBar.hidden=true;
 // Layouts gravados pelo operador: um nome por arrumação (ex.: "Culto domingo", "Entrevista"), até 20.
 const SAVED_KEY='andromeda.layouts.v1',SAVED_MAX=20;
 let savedLayouts=[];try{const list=JSON.parse(localStorage.getItem(SAVED_KEY)||'[]');if(Array.isArray(list))savedLayouts=list.filter(l=>l&&typeof l.name==='string'&&l.data).slice(0,SAVED_MAX)}catch{/* sem armazenamento */}
 let currentModel='padrao';
 function paintModels(){for(const id of ['layoutPreset','freePreset']){const sel=$('#'+id);sel.replaceChildren();const ready=document.createElement('optgroup');ready.label='Prontos';for(const [key,p] of Object.entries(PRESETS))ready.append(new Option(p.name,key));sel.append(ready);
   if(savedLayouts.length){const mine=document.createElement('optgroup');mine.label='Meus layouts';savedLayouts.forEach((l,i)=>mine.append(new Option(l.name,'meu:'+i)));sel.append(mine)}
   if(!currentModel.startsWith('meu:')&&!PRESETS[currentModel]){const custom=new Option('Personalizado (não salvo)','');custom.disabled=true;sel.prepend(custom)}
   sel.value=currentModel}
  for(const id of ['layoutDelete','freeDelete'])$('#'+id).disabled=!currentModel.startsWith('meu:');
  const saved=savedLayouts[Number(currentModel.slice(4))];for(const id of ['layoutName','freeName'])if(document.activeElement!==$('#'+id))$('#'+id).value=currentModel.startsWith('meu:')&&saved?saved.name:''}
 function storeSaved(){try{localStorage.setItem(SAVED_KEY,JSON.stringify(savedLayouts));return true}catch{return false}}
 function saveNamed(input){const name=input.value.replace(/\s+/g,' ').trim().slice(0,40);if(!name){input.focus();$('#layoutMessage').textContent='Dê um nome ao layout para salvar.';flash('Dê um nome ao layout.');return}
  const data=JSON.parse(JSON.stringify(snapshot())),i=savedLayouts.findIndex(l=>l.name.toLowerCase()===name.toLowerCase());
  if(i<0&&savedLayouts.length>=SAVED_MAX){flash('Limite de '+SAVED_MAX+' layouts: exclua um antes.');return}
  if(i>=0)savedLayouts[i]={name,data,at:Date.now()};else savedLayouts.push({name,data,at:Date.now()});
  const ok=storeSaved();currentModel='meu:'+(i>=0?i:savedLayouts.length-1);paintModels();
  const text=ok?(i>=0?'Layout "'+name+'" atualizado.':'Layout "'+name+'" salvo. Ele aparece em Modelo → Meus layouts.'):'Armazenamento indisponível: use Exportar layout.';$('#layoutMessage').textContent=text;flash(text);
  window.andromedaAudit?.('info','layout-salvo','Layout salvo: '+name)}
 function useSaved(index){const l=savedLayouts[index];if(!l)return;applying=true;try{applyPreset('padrao');load(l.data);currentModel='meu:'+index;settle(null);render();save();paintModels();$('#layoutMessage').textContent='Layout aplicado: '+l.name+'.';flash('Layout aplicado: '+l.name+'.')}catch(e){$('#layoutMessage').textContent='Layout "'+l.name+'" inválido: '+e.message}finally{applying=false}}
 function deleteSaved(){if(!currentModel.startsWith('meu:'))return;const i=Number(currentModel.slice(4)),l=savedLayouts[i];if(!l)return;savedLayouts.splice(i,1);storeSaved();currentModel='';paintModels();$('#layoutMessage').textContent='Layout "'+l.name+'" excluído. A mesa continua com a arrumação atual.';flash('Layout "'+l.name+'" excluído.')}
 const flashBox=make('span','free-flash');flashBox.setAttribute('role','status');let flashTimer=null;editBar.append(flashBox);
 function flash(text){flashBox.textContent=text;clearTimeout(flashTimer);flashTimer=setTimeout(()=>{flashBox.textContent=''},4000)}
 const navButton=make('button','','Personalizar');navButton.id='layoutNavButton';navButton.onclick=()=>{openWorkspace('operation');setEditing(!editing)};nav.append(navButton);
 let editing=false,drag=null,rowPx=20;
 function snapshot(){return {version:3,items:items.map(({id,page,width,order,rect,scale})=>({id,page,width,order,rect,...(scale?{scale}:{})}))}}
 function validRect(r){return r===null||(r&&[r.x,r.y,r.w,r.h].every(Number.isInteger)&&r.x>=0&&r.y>=0&&r.y<1000&&r.w>=MIN_W&&r.h>=MIN_H&&r.h<=400&&r.x+r.w<=COLS)}
 function validate(data){if(data?.version!==3||!Array.isArray(data.items)||!data.items.length||data.items.length>items.length)throw Error('Layout inválido');const seen=new Set();for(const r of data.items){if(!byId(r.id)||seen.has(r.id)||!pages[r.page]||!['half','full'].includes(r.width)||!Number.isFinite(r.order)||!validRect(r.rect)||(r.page==='operation'&&!r.rect)||(r.scale!==undefined&&!(Number.isInteger(r.scale)&&r.scale>=SCALE_MIN&&r.scale<=SCALE_MAX)))throw Error('Painel inválido');seen.add(r.id)}return data}
 function load(data){validate(data);for(const r of data.items){const item=byId(r.id);Object.assign(item,{page:r.page,width:r.width,order:r.order,rect:r.rect&&{...r.rect}});if(item.scaleOut)item.scale=r.scale||SCALE_MAX}}
 let applying=false;
 function save(){if(!applying&&currentModel){currentModel='';paintModels()}try{localStorage.setItem(key,JSON.stringify({...snapshot(),model:currentModel}));$('#layoutMessage').textContent='Layout salvo neste computador.'}catch{$('#layoutMessage').textContent='Armazenamento indisponível. Exporte o layout para guardar.'}}
 const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
 // O painel movido fica onde foi solto; quem estiver embaixo dele desce o necessário.
 function settle(moved){const placed=moved?[moved]:[];const rest=opItems().filter(i=>i!==moved).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);for(const item of rest){let hit;while((hit=placed.find(p=>overlap(item.rect,p.rect))))item.rect.y=hit.rect.y+hit.rect.h;placed.push(item)}}
 // Sobe cada painel até encostar no de cima: remove buracos sem trocar a ordem.
 function pack(){const done=[];for(const item of opItems().sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x)){while(item.rect.y>0&&!done.some(p=>overlap({...item.rect,y:item.rect.y-1},p.rect)))item.rect.y--;done.push(item)}}
 function fitRows(){const top=grid.getBoundingClientRect().top+(window.scrollY||0),footer=$('.sim-footer')?.getBoundingClientRect().height||32,available=window.innerHeight-top-footer-12;rowPx=Math.max(18,Math.floor(available/ROWS*100)/100);grid.style.setProperty('--free-row',rowPx+'px')}
 function place(item){const r=item.rect;item.shell.style.gridArea=(r.y+1)+' / '+(r.x+1)+' / span '+r.h+' / span '+r.w;item.size.textContent=r.w+' × '+r.h}
 function render(){fitRows();items.sort((a,b)=>a.order-b.order);
  for(const item of items){item.shell.dataset.width=item.width;item.shell.dataset.page=item.page;if(item.page==='operation'){if(!item.rect)item.rect={x:0,y:bottomRow(item),w:COLS,h:12};place(item);item.header.tabIndex=editing?0:-1;grid.append(item.shell)}else{item.shell.style.gridArea='';item.header.removeAttribute('tabindex');pages[item.page].append(item.shell)}}
  for(const item of items)paintScale(item);paintRows();requestAnimationFrame?.(()=>{fitRows();fitContents()})}
 function numberInput(label,value,min,max,onchange){const input=make('input');input.type='number';input.min=min;input.max=max;input.step=1;input.value=value;input.setAttribute('aria-label',label);input.onchange=()=>{const v=Math.round(Number(input.value));if(Number.isFinite(v))onchange(Math.min(max,Math.max(min,v)))};return input}
 function paintRows(){const rows=$('#layoutRows');rows.replaceChildren();
  for(const item of items){const row=make('div','layout-row'),label=make('strong','',item.title),page=make('select'),where=make('div','layout-pair'),size=make('div','layout-pair'),order=make('div','layout-pair');
   page.setAttribute('aria-label','Página de '+item.title);for(const [id,title] of Object.entries(pageNames))page.add(new Option(title,id));page.value=item.page;
   page.onchange=()=>{item.page=page.value;if(item.page==='operation'){item.rect={x:0,y:bottomRow(item),w:COLS,h:12}}else item.order=Math.max(...items.map(i=>i.order))+1;render();save()};
   if(item.page==='operation'){const r=item.rect;const set=(k,v)=>{r[k]=v;if(k==='w')r.x=Math.min(r.x,COLS-r.w);if(k==='x')r.x=Math.min(v,COLS-r.w);settle(item);render();save()};
    where.append(numberInput('Coluna de '+item.title,r.x+1,1,COLS-r.w+1,v=>set('x',v-1)),numberInput('Linha de '+item.title,r.y+1,1,400,v=>set('y',v-1)));
    size.append(numberInput('Largura de '+item.title+' em colunas',r.w,MIN_W,COLS,v=>set('w',v)),numberInput('Altura de '+item.title+' em linhas',r.h,MIN_H,120,v=>set('h',v)));}
   else{const width=make('select');width.setAttribute('aria-label','Largura de '+item.title);width.add(new Option('Largura total','full'));width.add(new Option('Meia largura','half'));width.value=item.width;width.onchange=()=>{item.width=width.value;render();save()};size.append(width);where.append(make('small','','em fluxo'));
    for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=make('button','',text);b.setAttribute('aria-label',(delta<0?'Subir ':'Descer ')+item.title);b.onclick=()=>{const group=items.filter(i=>i.page===item.page),target=group[group.indexOf(item)+delta];if(target){[target.order,item.order]=[item.order,target.order];render();save()}};order.append(b)}}
   if(item.scaleOut){const sel=make('select');sel.setAttribute('aria-label','Tamanho da imagem de '+item.title);for(let v=SCALE_MAX;v>=SCALE_MIN;v-=SCALE_STEP)sel.add(new Option('Imagem '+v+'%',String(v)));sel.value=String(item.scale);sel.onchange=()=>setScale(item,Number(sel.value));order.append(sel)}
   row.append(label,page,where,size,order);rows.append(row)}}
 // Monitores e câmeras se ajustam ao tamanho do painel: a imagem inteira em 16:9, sem rolagem.
 function chrome(shell,el){let extra=0,node=el;while(node&&node!==shell){const parent=node.parentElement;if(!parent)break;const cs=getComputedStyle(parent),column=cs.display.includes('flex')?cs.flexDirection.startsWith('column'):true;for(const c of parent.children){if(c===node||c.hidden)continue;const s=getComputedStyle(c);if(s.position==='absolute'||s.position==='fixed'||s.display==='none')continue;if(column)extra+=c.getBoundingClientRect().height}extra+=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.rowGap)||0);node=parent}return extra}
 const freeMode=()=>window.innerWidth>900;
 function fitCameras(){const item=byId('cameras'),mv=multiview?.querySelector('.mv-grid');if(!item||!mv)return;if(item.page!=='operation'||!freeMode()){mv.style.gridTemplateColumns='';mv.style.maxWidth='';return}
  const n=[...mv.children].filter(c=>!c.hidden).length||1,W=item.shell.clientWidth-24,H=item.shell.clientHeight-chrome(item.shell,mv)-20;let best={c:Math.min(5,n),t:0};
  for(let c=1;c<=n;c++){const r=Math.ceil(n/c),t=Math.min((W-(c-1)*GAP)/c,((H-(r-1)*GAP)/r)*16/9);if(t>best.t+.5)best={c,t}}
  const t=Math.max(90,best.t);mv.style.gridTemplateColumns='repeat('+best.c+',minmax(0,1fr))';mv.style.maxWidth=Math.floor(best.c*t+(best.c-1)*GAP+24)+'px'}
 // Preview e PGM lado a lado com a mesma altura ficam do mesmo tamanho: o limite vem da caixa de encaixe
 // (que não depende do tamanho da imagem), então medir de novo nunca muda o resultado.
 function fitContents(){try{const boxes=['preview','program'].map(id=>{const item=byId(id),fit=item?.shell.querySelector('.mon-fit');return {item,fit,w:fit?Math.min(fit.clientWidth,fit.clientHeight*16/9):0}});
  const [a,b]=boxes,same=a.item?.page==='operation'&&b.item?.page==='operation'&&a.item.rect&&b.item.rect&&a.item.rect.y===b.item.rect.y&&a.item.rect.h===b.item.rect.h&&a.w>0&&b.w>0;
  for(const box of boxes)box.fit?.style.setProperty('--mon-max',same?Math.floor(Math.min(a.w,b.w))+'px':'100000px');fitCameras()}catch{/* DOM emulado */}}
 if(typeof ResizeObserver==='function'){const ro=new ResizeObserver(()=>fitContents());for(const id of ['preview','program','cameras'])ro.observe(byId(id).shell)}
 window.addEventListener('resize',()=>{fitRows();fitContents()});
 let lastCount=-1;setInterval(()=>{const n=$$('.mv-cell').filter(c=>!c.hidden).length;if(n!==lastCount){lastCount=n;fitContents()}},1000);
 // Arrastar: título move, canto redimensiona. A grade mostra o encaixe enquanto arrasta.
 function cell(){const r=grid.getBoundingClientRect();return {cw:(r.width+GAP)/COLS,rh:rowPx}}
 function startGesture(item,mode,e){if(!editing||item.page!=='operation'||e.button!==0)return;e.preventDefault();const {cw,rh}=cell();drag={item,mode,px:e.clientX,py:e.clientY,start:{...item.rect},cw,rh};item.shell.classList.add('free-active');e.currentTarget.setPointerCapture?.(e.pointerId)}
 function moveGesture(e){if(!drag)return;const {item,mode,start,cw,rh}=drag,dx=Math.round((e.clientX-drag.px)/cw),dy=Math.round((e.clientY-drag.py)/rh),r=item.rect;
  if(mode==='move'){r.x=Math.min(COLS-r.w,Math.max(0,start.x+dx));r.y=Math.max(0,start.y+dy)}else{r.w=Math.min(COLS-r.x,Math.max(MIN_W,start.w+dx));r.h=Math.max(MIN_H,start.h+dy)}place(item);if(mode==='size')fitContents()}
 function endGesture(){if(!drag)return;const {item}=drag;drag=null;item.shell.classList.remove('free-active');settle(item);render();save()}
 for(const item of items){item.header.addEventListener('pointerdown',e=>startGesture(item,'move',e));item.grip.addEventListener('pointerdown',e=>startGesture(item,'size',e));
  for(const el of [item.header,item.grip]){el.addEventListener('pointermove',moveGesture);el.addEventListener('pointerup',endGesture);el.addEventListener('pointercancel',endGesture)}
  item.header.addEventListener('keydown',e=>{if(!editing||item.page!=='operation')return;const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();e.stopPropagation();const r=item.rect;
   if(e.shiftKey){r.w=Math.min(COLS-r.x,Math.max(MIN_W,r.w+d[0]));r.h=Math.max(MIN_H,r.h+d[1])}else{r.x=Math.min(COLS-r.w,Math.max(0,r.x+d[0]));r.y=Math.max(0,r.y+d[1])}settle(item);render();save();item.header.focus()})}
 function setEditing(on){editing=on;document.body.classList.toggle('layout-editing',editing);editBar.hidden=!editing;navButton.setAttribute('aria-pressed',String(editing));$('#layoutEdit').textContent=editing?'Concluir edição':'Editar posições';render();fitRows()}
 function usePreset(name){applying=true;try{applyPreset(name);settle(null);render();save()}finally{applying=false}$('#layoutMessage').textContent='Modelo aplicado: '+PRESETS[name].name+'.'}
 $('#layoutEdit').onclick=()=>{if(!editing)openWorkspace('operation');setEditing(!editing)};
 $('#freeDone').onclick=()=>setEditing(false);
 for(const id of ['layoutPreset','freePreset'])$('#'+id).onchange=e=>{const v=e.target.value;if(v.startsWith('meu:'))useSaved(Number(v.slice(4)));else if(PRESETS[v]){currentModel=v;usePreset(v);paintModels()}};
 for(const [input,button] of [['layoutName','layoutSave'],['freeName','freeSave']]){$('#'+button).onclick=()=>saveNamed($('#'+input));$('#'+input).addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();saveNamed($('#'+input))}})}
 for(const id of ['layoutDelete','freeDelete'])$('#'+id).onclick=deleteSaved;
 for(const id of ['layoutPack','freePack'])$('#'+id).onclick=()=>{pack();render();save()};
 for(const id of ['layoutRestore','freeRestore'])$('#'+id).onclick=()=>{currentModel='padrao';usePreset('padrao');paintModels()};
 document.addEventListener('keydown',e=>{if(editing&&e.key==='Escape')setEditing(false)});
 $('#layoutExport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download='andromeda-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('#layoutImport').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>50000)throw Error('Arquivo muito grande');load(JSON.parse(await f.text()));render();save()}catch(err){$('#layoutMessage').textContent='Não importado: '+err.message}finally{e.target.value=''}};
 applyPreset('padrao');
 try{const saved=localStorage.getItem(key);if(saved){const d=JSON.parse(saved);load(d);currentModel=typeof d.model==='string'?d.model:''}}catch{applyPreset('padrao');currentModel='padrao'}
 if(currentModel.startsWith('meu:')&&!savedLayouts[Number(currentModel.slice(4))])currentModel='';
 settle(null);render();paintModels();
 // A barra do topo termina de se montar depois deste script: medir de novo quando a página assenta.
 window.addEventListener('load',()=>{fitRows();fitContents()});setTimeout(()=>{fitRows();fitContents()},400);

 // T-bar horizontal: o arrasto é relativo (clicar no trilho não corta) e os extremos se alternam.
 const wrap=$('.tbar-wrap'),track=$('.tbar-track'),native=$('#tbar');wrap.classList.add('lever-wrap');track.hidden=true;
 const lever=make('div','transition-lever');lever.tabIndex=0;lever.setAttribute('role','slider');lever.setAttribute('aria-label','T-bar de transição');lever.setAttribute('aria-orientation','horizontal');lever.setAttribute('aria-valuemin','0');lever.setAttribute('aria-valuemax','100');
 lever.innerHTML='<div class="lever-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><div class="lever-rail"><div class="lever-fill"></div><div class="lever-grip"><i></i><i></i><i></i></div></div><output class="lever-readout">0%</output>';wrap.append(lever);const hint=make('small','lever-hint','Arraste o T-bar · setas ajustam · fim do curso conclui');wrap.append(hint);
 let physical=0,reverse=false,gesture=null,manual=false;
 function paintLever(){lever.style.setProperty('--lever-pos',physical.toFixed(2));lever.setAttribute('aria-valuenow',String(Math.round(state.progress*100)));lever.setAttribute('aria-valuetext',Math.round(state.progress*100)+'% da transição');lever.querySelector('output').textContent=Math.round(state.progress*100)+'%';lever.setAttribute('aria-disabled',String(state.busy))}
 const previousProgress=setProgress;setProgress=function(p){previousProgress(p);if(!manual)physical=(reverse?1-p:p)*100;paintLever()};
 function move(value){if(state.busy)return;physical=Math.min(100,Math.max(0,value));const p=reverse?1-physical/100:physical/100;manual=true;try{native.value=p*100;native.oninput({target:native});if(p>=1){reverse=!reverse;gesture=null}}finally{manual=false}paintLever()}
 // O curso útil é a largura do trilho menos a do punho, medida na hora do gesto.
 const travel=()=>{const rail=lever.querySelector('.lever-rail'),grip=lever.querySelector('.lever-grip');return Math.max(40,rail.getBoundingClientRect().width-grip.getBoundingClientRect().width)};
 lever.onpointerdown=e=>{if(state.busy||e.button!==0)return;e.preventDefault();gesture={x:e.clientX,start:physical,travel:travel()};lever.setPointerCapture(e.pointerId);lever.focus()};lever.onpointermove=e=>{if(gesture)move(gesture.start+(e.clientX-gesture.x)/gesture.travel*100)};for(const name of ['pointerup','pointercancel','lostpointercapture'])lever.addEventListener(name,()=>gesture=null);
 lever.onkeydown=e=>{const steps={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:10,PageDown:-10};if(!(e.key in steps)&&!['Home','End',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key===' ')return;move(e.key==='Home'?0:e.key==='End'?100:physical+steps[e.key])};
 const prevSync=sync;sync=function(){prevSync();paintLever()};paintLever();
})();
