// Mesa que troca de rede no meio da transmissão (Wi-Fi → cabo): o vídeo da câmera precisa voltar sozinho.
const R=require('path').join(__dirname,'..','..')+'/', D=__dirname, { chromium } = require('playwright'), fs=require('fs'), os=require('os'), path=require('path');
const { createBridge } = require(R+'server.cjs');
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mesa-'));
  const bridge=createBridge({dataDir,port:3180,relayBrokers:['ws://203.0.113.5:34950/mqtt'],camPage:'https://203.0.113.5:3191/'});bridge.listen();await bridge.ready();
  const b=await chromium.launch({args:['--no-proxy-server']});let ok=false;
  try{
    const desk=await b.newPage();await desk.goto('http://localhost:3180/');await desk.waitForFunction(()=>typeof liveTx!=='undefined',null,{timeout:20000});await desk.waitForTimeout(3000);
    const inv=await desk.evaluate(async()=>{const s=await(await fetch('/api/session')).json();return (await fetch('/api/cam/invite',{method:'POST',headers:{'X-Andromeda-Token':s.token,'Content-Type':'application/json'},body:JSON.stringify({slot:0,name:'CAM 1'})})).json()});
    fs.writeFileSync(path.join(D,'invite.txt'),inv.url);
    const frames=()=>desk.evaluate(()=>{const p=camDesk.peers.get('0:media');return p?p.frames:0});
    for(let i=0;i<30&&!(await frames());i++)await desk.waitForTimeout(1000);
    const before=await frames();console.log('[mesa] vídeo antes da troca: quadros='+before);
    fs.writeFileSync(path.join(D,'trocar'),'1');const t0=Date.now();
    let after=0,base=null;
    for(let i=0;i<60;i++){await desk.waitForTimeout(1000);const f=await frames();const ips=await desk.evaluate(()=>JSON.stringify(camDesk.iceServers.flatMap(s=>s.urls).filter(u=>u.startsWith('turn:')&&u.includes('udp'))));
      if(i%5===0)console.log('[mesa]',i+'s','quadros',f,'turn',ips);
      if(base===null&&Date.now()-t0>3000)base=f; if(base!==null&&f>base+20&&ips.includes('192.168.1.11')){after=f;console.log('[mesa] vídeo voltou em '+Math.round((Date.now()-t0)/1000)+' s');ok=true;break}}
    const log=await desk.evaluate(()=>state.events.map(e=>e.message).filter(t=>/rede|reconect/i.test(t)).slice(0,4));console.log('[mesa] log:',JSON.stringify(log));
    console.log(ok?'[mesa] RESULTADO: VÍDEO VOLTOU SOZINHO DEPOIS DA TROCA DE REDE':'[mesa] RESULTADO: VÍDEO NÃO VOLTOU');
  }finally{await b.close();bridge.shutdown();setTimeout(()=>process.exit(0),500)}
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
