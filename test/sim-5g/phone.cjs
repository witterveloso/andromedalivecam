// Celular no 5G (atrás do CGNAT): abre o convite e ativa a câmera.
const D=__dirname, { chromium } = require('playwright'), fs=require('fs'), path=require('path');
(async()=>{
  const f=path.join(D,'invite.txt');for(let i=0;i<60&&!fs.existsSync(f);i++)await new Promise(r=>setTimeout(r,500));const url=fs.readFileSync(f,'utf8').replace(/^http:/,'https:');
  const b=await chromium.launch({args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const ctx=await b.newContext({ignoreHTTPSErrors:true,permissions:['camera','microphone']});const cam=await ctx.newPage();const logs=[];
  await cam.addInitScript(()=>{window.ANDROMEDA_RELAY=['wss://203.0.113.5:34951/mqtt']});cam.on('pageerror',e=>logs.push('[cam ERRO] '+e.message));
  await cam.goto(url);await cam.waitForTimeout(1500);await cam.click('#start');
  for(let i=0;i<20;i++){await cam.waitForTimeout(2000);const s=await cam.evaluate(async()=>{const out=[];for(const [k,p] of cam.pcs){const st=await p.pc.getStats();const c=[];st.forEach(x=>{if(x.type==='local-candidate')c.push(x.candidateType+':'+x.address)});out.push(k+' '+p.pc.iceConnectionState+' locais=['+c.join(',')+']')}return {msg:document.querySelector('#status,#say,.status')?.textContent?.slice(0,90),out}});console.log('[cam]',i,JSON.stringify(s));if(fs.existsSync(path.join(D,'done')))break;}
  console.log(logs.join('\n'));await b.close();process.exit(0);
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
