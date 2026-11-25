// Mesa atrás do roteador doméstico (192.168.1.10): serviço real + mesa no navegador; gera o convite e mede o vídeo que chega.
const R=require('path').join(__dirname,'..','..')+'/', D=__dirname, { chromium } = require('playwright'), fs=require('fs'), os=require('os'), path=require('path');
const { createBridge } = require(R+'server.cjs');
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mesa-'));
  const bridge=createBridge({dataDir,port:3180,relayBrokers:['ws://203.0.113.5:34950/mqtt'],camPage:'https://203.0.113.5:3191/'});bridge.listen();await bridge.ready();
  const b=await chromium.launch({args:['--no-proxy-server']});const logs=[];
  try{
    const desk=await b.newPage();desk.on('pageerror',e=>logs.push('[mesa ERRO] '+e.message));
    await desk.goto('http://localhost:3180/');await desk.waitForFunction(()=>typeof liveTx!=='undefined',null,{timeout:20000});await desk.waitForTimeout(3000);
    const inv=await desk.evaluate(async()=>{const s=await(await fetch('/api/session')).json();return (await fetch('/api/cam/invite',{method:'POST',headers:{'X-Andromeda-Token':s.token,'Content-Type':'application/json'},body:JSON.stringify({slot:0,name:'CAM 1'})})).json()});
    fs.writeFileSync(path.join(D,'invite.txt'),inv.url);console.log('[mesa] convite gerado; servidores ICE:',JSON.stringify((await desk.evaluate(()=>camDesk.iceServers)).map(s=>s.urls)));
    let ok=false;for(let i=0;i<20;i++){await desk.waitForTimeout(2000);
      const st=await desk.evaluate(async()=>{const out=[];for(const [k,p] of camDesk.peers){let pair=null,loc=null,rem=null,cands=[];const s=await p.pc.getStats();s.forEach(x=>{if(x.type==='candidate-pair'&&x.nominated&&x.state==='succeeded'){pair=x}if(x.type==='remote-candidate')cands.push(x.candidateType+':'+x.address)});if(pair){loc=s.get(pair.localCandidateId)?.candidateType;rem=s.get(pair.remoteCandidateId)?.candidateType}out.push(k+' '+p.pc.connectionState+' ice='+p.pc.iceConnectionState+' quadros='+p.frames+(pair?' via '+loc+'↔'+rem:'')+' remotos=['+cands.join(',')+']')}return out});
      console.log('[mesa]',i,JSON.stringify(st));if(st.some(x=>/media .*quadros=[1-9]/.test(x))){ok=true;break}}
    await desk.evaluate(()=>{let e=document.querySelector('.invite-flow');while(e){e.hidden=false;e=e.parentElement}});await desk.waitForTimeout(16000);
    console.log('[mesa] TELA:',JSON.stringify(await desk.evaluate(()=>({passo1:document.querySelector('.link-detail .link-note')?.textContent,rede:document.querySelector('#turnState')?.textContent,aberto:document.querySelector('#turnBox')?.open,log:state.events.map(e=>e.message).filter(t=>/caminho|imagem não chega/.test(t)).slice(0,2)}))));
    console.log(ok?'[mesa] RESULTADO: VÍDEO CHEGOU':'[mesa] RESULTADO: VÍDEO NÃO CHEGOU');
  }finally{console.log(logs.join('\n'));await b.close();bridge.shutdown();setTimeout(()=>process.exit(0),500)}
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
