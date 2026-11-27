(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AndromedaComposition=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
/* Tela em pé (Instagram/TikTok): as laterais somem em celulares altos (~9% de cada lado), o cabeçalho cobre o topo (~11%) e os
   comentários o pé (~20%). Na tela em pé, tudo é ancorado dentro dessa área segura. */
const SAFE={x:.11,top:.11,bottom:.2};
function anchored(w,h,width,height,corner,margin=0.035){if(h>w){width=Math.min(width,w*(1-2*SAFE.x));height=Math.min(height,h*(1-SAFE.top-SAFE.bottom));const x=corner.endsWith('right')?w*(1-SAFE.x)-width:w*SAFE.x,y=corner.startsWith('bottom')?h*(1-SAFE.bottom)-height:h*SAFE.top;return {x,y,width,height};}const x=corner.endsWith('right')?w-width-w*margin:w*margin,y=corner.startsWith('bottom')?h-height-h*margin:h*margin;return {x,y,width,height};}
function fit(sw,sh,box,mode='contain'){const scale=mode==='cover'?Math.max(box.width/sw,box.height/sh):Math.min(box.width/sw,box.height/sh);const width=sw*scale,height=sh*scale;return {x:box.x+(box.width-width)/2,y:box.y+(box.height-height)/2,width,height};}
function lines(ctx,text,width,maxLines=2){const words=String(text||'').trim().split(/\s+/),out=[];let line='';for(const word of words){if(ctx.measureText((line?line+' ':'')+word).width>width&&line){out.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)out.push(line);if(out.length>maxLines){out.length=maxLines;out[maxLines-1]+='…';}return out.map(line=>{while(line.length>1&&ctx.measureText(line).width>width)line=line.slice(0,-2)+'…';return line;});}
function drawImage(ctx,image,box,mode='contain'){const sw=image.videoWidth||image.naturalWidth||image.width,sh=image.videoHeight||image.naturalHeight||image.height;if(!sw||!sh)return;ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();const rect=fit(sw,sh,box,mode);ctx.drawImage(image,rect.x,rect.y,rect.width,rect.height);ctx.restore();}
/* ---------- Pacote de GCs Andrômeda: modelos de tarja ----------
 * Cada modelo é um desenho próprio da tarja; cores, tamanho, largura, posição, opacidade e selo continuam personalizáveis.
 * Ao escolher um modelo, a mesa aplica as cores sugeridas dele (o operador pode trocar depois). */
const FONT_TEXT="'Montserrat','Segoe UI',system-ui,sans-serif",FONT_DISPLAY="'Exo 2','Montserrat','Segoe UI',system-ui,sans-serif";
const TEMPLATES=[
 {id:'classico',name:'Clássico',hint:'Caixa escura com filete de destaque',defaults:{background:'#101421',color:'#ffffff',accent:'#f5a623',opacity:88}},
 {id:'tarja',name:'Tarja dupla',hint:'Nome na faixa colorida, cargo na faixa de baixo',defaults:{background:'#0b1b3a',color:'#ffffff',accent:'#d71920',opacity:96}},
 {id:'jornal',name:'Telejornal',hint:'Painel claro com barra no topo e selo',defaults:{background:'#ffffff',color:'#10131c',accent:'#0057b8',opacity:97,tag:'AO VIVO'}},
 {id:'moderno',name:'Moderno',hint:'Cantos arredondados em degradê',defaults:{background:'#1d2671',color:'#ffffff',accent:'#c33764',opacity:94}},
 {id:'vidro',name:'Vidro',hint:'Fundo translúcido com borda fina',defaults:{background:'#0f172a',color:'#ffffff',accent:'#38bdf8',opacity:55}},
 {id:'minimal',name:'Minimalista',hint:'Só o texto, com sublinhado de destaque',defaults:{background:'#000000',color:'#ffffff',accent:'#ffd400',opacity:0}},
 {id:'esportivo',name:'Esportivo',hint:'Faixas inclinadas, letra itálica',defaults:{background:'#111111',color:'#ffffff',accent:'#00e676',opacity:94,tag:'AO VIVO'}},
 {id:'plantao',name:'Plantão',hint:'Faixa de urgência com selo',defaults:{background:'#111111',color:'#ffffff',accent:'#e10600',opacity:97,tag:'URGENTE'}},
 {id:'etiqueta',name:'Etiqueta',hint:'Nome numa etiqueta, cargo ao lado',defaults:{background:'#1f2937',color:'#ffffff',accent:'#f97316',opacity:92}},
 {id:'neon',name:'Neon',hint:'Painel escuro com contorno brilhante',defaults:{background:'#05010f',color:'#ffffff',accent:'#a855f7',opacity:85}},
 {id:'cartao',name:'Cartão',hint:'Cartão claro com faixa de cor no topo',defaults:{background:'#ffffff',color:'#111827',accent:'#7c3aed',opacity:100}},
 {id:'redes',name:'Redes sociais',hint:'Pílula com @ para o perfil',defaults:{background:'#000000',color:'#ffffff',accent:'#e1306c',opacity:82}},
];
const TEMPLATE_IDS=new Set(TEMPLATES.map(t=>t.id));
function rgba(hex,alpha){const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));const n=m?parseInt(m[1],16):0;return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+clamp(alpha,0,1)+')';}
function rounded(ctx,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
function slanted(ctx,x,y,w,h,k){ctx.beginPath();ctx.moveTo(x+k,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w-k,y+h);ctx.lineTo(x,y+h);ctx.closePath();}
function widest(ctx,rows){let m=0;for(const r of rows)m=Math.max(m,ctx.measureText(r).width);return m;}

// Uma tarja de GC: mede o texto, escolhe o tamanho da caixa pelo modelo, ancora na posição e desenha.
function drawGC(ctx,w,h,u,tall,layer){
 const style=TEMPLATE_IDS.has(layer.style)?layer.style:'classico',font=clamp(layer.size,22,64)*u/1920,pad=u*.015,alpha=clamp(layer.opacity,0,100)/100;
 const maxW=Math.min(tall?w*(1-2*SAFE.x):w*.94,u*clamp(layer.width,30,94)/100),bg=layer.background,fg=layer.color,ac=layer.accent;
 const upper=style==='plantao'||style==='esportivo',tf=(style==='esportivo'?'italic 800 ':'700 ')+font+'px '+(['esportivo','plantao','neon','moderno'].includes(style)?FONT_DISPLAY:FONT_TEXT),sf='500 '+font*.7+'px '+FONT_TEXT;
 const titleText=upper?String(layer.title||'').toUpperCase():layer.title,tag=String(layer.tag||'').trim().slice(0,24),subText=style==='redes'&&!layer.subtitle?'':layer.subtitle;
 const lead=style==='redes'?font*1.9:style==='esportivo'?font*.9:style==='etiqueta'?0:0; // espaço à esquerda do texto (ícone, faixa)
 ctx.font=tf;const title=lines(ctx,titleText,maxW-pad*2-lead,2);ctx.font=sf;const sub=lines(ctx,subText,maxW-pad*2-lead,2);
 ctx.font=tf;const tw=widest(ctx,title);ctx.font=sf;const sw=widest(ctx,sub);
 const th=title.length*font*1.25,sh=sub.length*font*.95,fit=['redes','etiqueta','minimal','neon','vidro','moderno','tarja','plantao','esportivo'].includes(style);
 let bw=fit?Math.min(maxW,Math.max(tw,sw)+pad*2+lead+(style==='esportivo'?font*.8:style==='plantao'?pad*3.4:style==='vidro'?pad*1.8:0)):maxW;
 let bh=pad*2+th+sh+(sub.length&&['tarja','plantao'].includes(style)?pad:0)+(style==='jornal'||style==='cartao'?u*.006:0);
 if(style==='etiqueta'){ctx.font=tf;bh=pad*2+th;}
 const tagH=tag&&['jornal','esportivo','plantao'].includes(style)?font*.95:0;
 const box=anchored(w,h,bw,bh+tagH,layer.corner,.05),x=box.x,y=box.y+tagH;bw=box.width;
 ctx.save();ctx.textBaseline='top';ctx.textAlign='left';
 const text=(rows,f,color,tx,ty,step)=>{ctx.font=f;ctx.fillStyle=color;for(const r of rows){ctx.fillText(r,tx,ty);ty+=step;}return ty;};
 const drawTag=(fill,color)=>{if(!tagH)return;ctx.font='800 '+font*.52+'px '+FONT_DISPLAY;const tw2=ctx.measureText(tag).width+pad*1.6;ctx.fillStyle=fill;if(style==='esportivo')slanted(ctx,x,y-tagH,tw2+font*.3,tagH*.92,font*.2);else ctx.beginPath(),ctx.rect(x,y-tagH,tw2,tagH*.92);ctx.fill();ctx.fillStyle=color;ctx.fillText(tag,x+pad*.8+(style==='esportivo'?font*.15:0),y-tagH+tagH*.2);};
 switch(style){
  case 'tarja':{ // nome na faixa de destaque; cargo numa faixa mais estreita, logo abaixo
   const t1=pad*2+th,t2=sub.length?pad*1.6+sh:0;ctx.fillStyle=rgba(ac,alpha);ctx.fillRect(x,y,bw,t1);
   if(t2){ctx.fillStyle=rgba(bg,alpha);ctx.fillRect(x+font*.6,y+t1,Math.max(sw+pad*2,bw*.55),t2);}
   text(title,tf,fg,x+pad,y+pad,font*1.25);if(t2)text(sub,sf,fg,x+font*.6+pad,y+t1+pad*.8,font*.95);break;}
  case 'jornal':{ // painel com barra grossa no topo e selo acima
   ctx.fillStyle=rgba(bg,alpha);ctx.fillRect(x,y,bw,bh);ctx.fillStyle=ac;ctx.fillRect(x,y,bw,u*.006);drawTag(ac,'#ffffff');
   const ty=text(title,tf,fg,x+pad,y+u*.006+pad,font*1.25);text(sub,sf,ac,x+pad,ty,font*.95);break;}
  case 'moderno':{const g=ctx.createLinearGradient(x,y,x+bw,y+bh);g.addColorStop(0,rgba(bg,alpha));g.addColorStop(1,rgba(ac,alpha));ctx.fillStyle=g;rounded(ctx,x,y,bw,bh,bh*.28);ctx.fill();
   const ty=text(title,tf,fg,x+pad,y+pad,font*1.25);text(sub,sf,rgba(fg,.85),x+pad,ty,font*.95);break;}
  case 'vidro':{ctx.fillStyle=rgba(bg,alpha);rounded(ctx,x,y,bw,bh,font*.35);ctx.fill();ctx.lineWidth=Math.max(1,u/1200);ctx.strokeStyle='rgba(255,255,255,.35)';ctx.stroke();
   ctx.fillStyle=ac;ctx.beginPath();ctx.arc(x+bw-pad*1.1,y+pad*1.1,font*.12,0,Math.PI*2);ctx.fill();
   const ty=text(title,tf,fg,x+pad,y+pad,font*1.25);text(sub,sf,rgba(fg,.8),x+pad,ty,font*.95);break;}
  case 'minimal':{ctx.shadowColor='rgba(0,0,0,.75)';ctx.shadowBlur=font*.35;ctx.shadowOffsetY=font*.04;
   const ty=text(title,tf,fg,x+pad,y+pad,font*1.25);ctx.shadowBlur=0;ctx.fillStyle=ac;ctx.fillRect(x+pad,ty+font*.02,Math.min(tw,bw-pad*2),Math.max(2,font*.08));
   ctx.shadowBlur=font*.3;text(sub,sf,fg,x+pad,ty+font*.18,font*.95);break;}
  case 'esportivo':{const k=font*.45;ctx.fillStyle=ac;slanted(ctx,x,y,font*.9,bh,k);ctx.fill();ctx.fillStyle=rgba(bg,alpha);slanted(ctx,x+font*.55,y,bw-font*.55,bh,k);ctx.fill();drawTag(ac,'#000000');
   const ty=text(title,tf,fg,x+lead+k*.5,y+pad,font*1.25);text(sub,sf,ac,x+lead+k*.2,ty,font*.95);break;}
  case 'plantao':{const t1=pad*2+th;ctx.fillStyle=rgba(ac,alpha);ctx.fillRect(x,y,bw,t1);drawTag('#ffffff',ac);
   if(sub.length){ctx.fillStyle=rgba(bg,alpha);ctx.fillRect(x,y+t1,bw,pad*1.6+sh);}
   ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<3;i++)ctx.fillRect(x+bw-pad*(1.2+i*.9),y,pad*.35,t1);
   text(title,tf,fg,x+pad,y+pad,font*1.25);if(sub.length)text(sub,sf,fg,x+pad,y+t1+pad*.8,font*.95);break;}
  case 'etiqueta':{ctx.font=tf;const lw=Math.min(bw,tw+pad*2);ctx.fillStyle=rgba(ac,Math.max(alpha,.9));ctx.fillRect(x,y,lw,bh);text(title,tf,fg,x+pad,y+pad,font*1.25);
   if(sub.length){ctx.font=sf;const rw=Math.min(maxW-lw,sw+pad*2),rh=sh+pad*1.4;ctx.fillStyle=rgba(bg,alpha);ctx.fillRect(x+lw,y+(bh-rh)/2,rw,rh);text(sub,sf,fg,x+lw+pad,y+(bh-rh)/2+pad*.7,font*.95);}break;}
  case 'neon':{ctx.fillStyle=rgba(bg,alpha);rounded(ctx,x,y,bw,bh,font*.3);ctx.fill();ctx.shadowColor=ac;ctx.shadowBlur=font*.6;ctx.lineWidth=Math.max(2,font*.07);ctx.strokeStyle=ac;ctx.stroke();ctx.shadowBlur=font*.25;
   const ty=text(title,tf,fg,x+pad,y+pad,font*1.25);ctx.shadowBlur=0;text(sub,sf,ac,x+pad,ty,font*.95);break;}
  case 'cartao':{ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=font*.5;ctx.shadowOffsetY=font*.1;ctx.fillStyle=rgba(bg,alpha);rounded(ctx,x,y,bw,bh,font*.25);ctx.fill();ctx.shadowColor='transparent';
   ctx.save();rounded(ctx,x,y,bw,bh,font*.25);ctx.clip();ctx.fillStyle=ac;ctx.fillRect(x,y,bw,u*.006);ctx.restore();
   const ty=text(title,tf,fg,x+pad,y+u*.006+pad,font*1.25);text(sub,sf,rgba(fg,.65),x+pad,ty,font*.95);break;}
  case 'redes':{ctx.fillStyle=rgba(bg,alpha);rounded(ctx,x,y,bw,bh,bh/2);ctx.fill();const r=Math.min(bh*.4,lead*.46),cx=x+pad*.45+r,cy=y+bh/2;
   ctx.fillStyle=ac;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='800 '+r*1.2+'px '+FONT_DISPLAY;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('@',cx,cy+r*.04);ctx.textAlign='left';ctx.textBaseline='top';
   const tx=x+pad+lead*.9,ty=text(title,tf,fg,tx,y+pad,font*1.25);text(sub,sf,rgba(fg,.8),tx,ty,font*.95);break;}
  default:{ // clássico
   ctx.fillStyle=rgba(bg,alpha);ctx.fillRect(x,y,bw,bh);ctx.fillStyle=ac;ctx.fillRect(x,y,u*.004,bh);
   const ty=text(title,tf,fg,x+pad,y+pad,font*1.25);text(sub,'400 '+font*.7+'px '+FONT_TEXT,fg,x+pad,ty,font*.95);}
 }
 ctx.restore();
 return {x,y:y-tagH,width:bw,height:bh+tagH};
}
function compose(ctx,w,h,settings,{pip,logo}={}){const u=Math.min(w,h)*16/9,tall=h>w;
 if(settings.pip.on&&pip){const width=Math.min(w*clamp(settings.pip.size,15,50)/100,h*.85*({'16:9':16/9,'4:3':4/3,'1:1':1,'9:16':9/16}[settings.pip.aspect]||16/9)),height=width/({'16:9':16/9,'4:3':4/3,'1:1':1,'9:16':9/16}[settings.pip.aspect]||16/9),box=anchored(w,h,width,height,settings.pip.corner);ctx.save();ctx.fillStyle='#000';ctx.fillRect(box.x,box.y,width,height);drawImage(ctx,pip,box,settings.pip.fit);ctx.lineWidth=Math.max(1,w/480);ctx.strokeStyle=settings.pip.border;ctx.strokeRect(box.x,box.y,width,height);ctx.restore();}
 for(const layer of settings.layers){if(!layer.on||!String(layer.title||'').trim()&&!String(layer.subtitle||'').trim())continue;drawGC(ctx,w,h,u,tall,layer);}
 if(settings.logo.on&&logo){const width=Math.min(w*.5,u*clamp(settings.logo.size,4,25)/100),sw=logo.naturalWidth||logo.width,sh=logo.naturalHeight||logo.height;if(sw&&sh){const height=Math.min(width*sh/sw,h*.25),box=anchored(w,h,width,height,settings.logo.corner);ctx.save();ctx.globalAlpha=clamp(settings.logo.opacity,0,100)/100;drawImage(ctx,logo,box);ctx.restore();}}
}
return {anchored,fit,lines,compose,drawGC,TEMPLATES};
});
