'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');const {WebSocketServer,WebSocket}=require('ws');
const {validateConfig,argsFor,findFFmpeg,safeError}=require('./encoder.cjs');
const {createCameraHub}=require('./camera-hub.cjs');const {createCloudClient}=require('./cloud-client.cjs');
const {streamPreset}=require('./network.cjs');
const {createReceiverPool}=require('./receiver-pool.cjs');
function createBridge({port=3180,ffmpeg=findFFmpeg(),spawnProcess=spawn,camPort=null}={}){
 const token=crypto.randomBytes(32).toString('hex');let active=null;const receivers=createReceiverPool({ffmpeg});
 let iceServers=[];try{iceServers=JSON.parse(process.env.ANDROMEDA_ICE_SERVERS||'[]');if(!Array.isArray(iceServers))throw Error()}catch{throw Error('ANDROMEDA_ICE_SERVERS deve ser uma lista JSON')}
 const cameraHub=createCameraHub({sessionToken:token,iceServers});if(process.env.ANDROMEDA_CAM_URL)cameraHub.configure(process.env.ANDROMEDA_CAM_URL);
 const cloud=process.env.ANDROMEDA_CLOUD_URL?createCloudClient({url:process.env.ANDROMEDA_CLOUD_URL,token:process.env.ANDROMEDA_CLOUD_TOKEN}):null;
 const hosts=new Set(['localhost:'+port,'127.0.0.1:'+port]);const origins=new Set([...hosts].map(x=>'http://'+x));
 const files={'/':'index.html','/index.html':'index.html','/live-client.js':'live-client.js','/live.css':'live.css','/blackmagic-client.js':'blackmagic-client.js','/operation.js':'operation.js','/cam-desk.js':'cam-desk.js','/composition.js':'composition.js','/effects.js':'effects.js','/program-audio.js':'program-audio.js'};
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(!hosts.has(req.headers.host)||req.headers.origin&&!origins.has(req.headers.origin)){res.writeHead(403).end();return}
  if(cloud&&req.url.startsWith('/api/cam/')){if(req.method!=='GET'&&req.headers['x-andromeda-token']!==token){res.writeHead(403).end();return}const action=req.url.slice('/api/cam/'.length);if(!['status','config','invite','revoke'].includes(action)||!['GET','POST'].includes(req.method)||(action==='status')!==(req.method==='GET')){res.writeHead(404).end();return}const forward=async body=>{res.setHeader('Content-Type','application/json');try{const data=await cloud.request(action,body);if(action==='invite')receivers.stop(Number(body.slot));res.end(JSON.stringify(data))}catch(e){res.writeHead(502).end(JSON.stringify({error:'Gateway: '+e.message}))}};if(req.method==='GET'){forward();return}let body='';req.on('data',d=>{body+=d;if(body.length>4096)req.destroy()});req.on('end',()=>{try{forward(JSON.parse(body))}catch{res.writeHead(400).end()}});return}
  if(req.url==='/api/cam/status'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(cameraHub.state()));return}
  if(req.method==='POST'&&['/api/cam/config','/api/cam/invite','/api/cam/revoke'].includes(req.url)){if(req.headers['x-andromeda-token']!==token){res.writeHead(403).end();return}let body='';req.on('data',d=>{body+=d;if(body.length>4096)req.destroy()});req.on('end',()=>{res.setHeader('Content-Type','application/json');try{const m=JSON.parse(body);let out;if(req.url.endsWith('/config'))out=cameraHub.configure(m.url);else if(req.url.endsWith('/invite')){out=cameraHub.invite(Number(m.slot),m.name,m.profile);receivers.stop(Number(m.slot));}else{cameraHub.revoke(Number(m.slot));out={ok:true}}res.end(JSON.stringify(out))}catch(e){res.writeHead(400).end(JSON.stringify({error:e.message}))}});return}
  if(req.method==='POST'&&['/api/input/start','/api/input/stop','/api/input/preset'].includes(req.url)){
   if(req.headers['x-andromeda-token']!==token){res.writeHead(403).end();return}
   let body='',tooLarge=false;req.on('data',d=>{body+=d;if(body.length>2048){tooLarge=true;req.destroy()}});req.on('end',async()=>{if(tooLarge)return;res.setHeader('Content-Type','application/json');try{const input=JSON.parse(body||'{}');const receiver=receivers.get(input.slot);if(req.url.endsWith('/preset')){const st=receiver.status();if(!st.enabled||!st.host)throw Error('Ative a recepção antes de exportar o XML.');res.end(JSON.stringify({xml:streamPreset({host:st.host,port:st.port,key:st.key,quality:input.quality,slot:receivers.slotOf(input.slot)})}));return;}let out;if(req.url.endsWith('/start')){if(cloud)await cloud.request('revoke',{slot:receivers.slotOf(input.slot)});out=receivers.start(input);cameraHub.revoke(receivers.slotOf(input.slot));}else out=receiver.stop();res.end(JSON.stringify(out))}catch(e){res.writeHead(400).end(JSON.stringify({error:e.message}))}});return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return}
  if(req.url==='/api/input/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...receivers.get(6).status(),inputs:receivers.status(),maximum:8}));return}
  const inputURL=new URL(req.url,'http://localhost');if(['/api/input/video.mjpeg','/api/input/audio.pcm'].includes(inputURL.pathname)){try{const receiver=receivers.get(inputURL.searchParams.has('slot')?inputURL.searchParams.get('slot'):undefined);if(inputURL.pathname.endsWith('.mjpeg'))receiver.subscribe(res);else receiver.subscribeAudio(res);}catch(e){res.writeHead(400).end(e.message)}return}
  if(req.url==='/api/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token,ffmpegReady:!!ffmpeg,busy:!!active,version:'0.9.0'}));return}
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return}
  const name=files[req.url];if(!name){res.writeHead(404).end();return}
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');fs.createReadStream(path.join(__dirname,'public',name)).pipe(res);
 });
 const inputWss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
 inputWss.on('connection',ws=>{const {EventEmitter}=require('node:events');const sinks=[];for(let slot=0;slot<10;slot++)for(const kind of [1,2]){const sink=new EventEmitter();Object.assign(sink,{destroyed:false,writableLength:0,writeHead(){},flushHeaders(){},end(){},destroy(){this.destroyed=true;this.emit('close')},write(data){if(ws.readyState!==WebSocket.OPEN||ws.bufferedAmount>2*1024*1024)return;if(kind===1){const start=data.indexOf(Buffer.from([255,216])),end=data.lastIndexOf(Buffer.from([255,217]));if(start<0||end<0)return;data=data.subarray(start,end+2);}ws.send(Buffer.concat([Buffer.from([slot,kind]),data]));}});sinks.push(sink);if(kind===1)receivers.get(slot).subscribe(sink);else receivers.get(slot).subscribeAudio(sink);}ws.on('error',()=>{});ws.on('close',()=>sinks.forEach(s=>s.destroy()));});
 const wss=new WebSocketServer({noServer:true,maxPayload:4*1024*1024,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{if(req.url==='/inputs'&&hosts.has(req.headers.host)&&origins.has(req.headers.origin)&&req.headers['sec-websocket-protocol']==='andromeda.'+token){inputWss.handleUpgrade(req,socket,head,ws=>inputWss.emit('connection',ws));return}if(req.url==='/camera-signal'&&hosts.has(req.headers.host)&&origins.has(req.headers.origin)){if(cloud){if(req.headers['sec-websocket-protocol']!=='andromeda.'+token){socket.destroy();return}cloud.upgrade(req,socket,head)}else cameraHub.deskUpgrade(req,socket,head);return}if(req.url!=='/publish'||!hosts.has(req.headers.host)||!origins.has(req.headers.origin)||req.headers['sec-websocket-protocol']!=='andromeda.'+token){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req))});
 wss.on('connection',ws=>{
  let child=null,stopping=false,lastInput=Date.now(),lastFrame=0,lastProgress=Date.now(),stderr='',progress='',ready=false,everStarted=false,killTimer=null;
  const send=data=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))};
  const stop=()=>{if(stopping)return;stopping=true;if(child){child.stdin.end();killTimer=setTimeout(()=>child?.kill('SIGKILL'),3500);killTimer.unref()}else{send({type:'stopped'});ws.close()}};
  const fail=message=>{send({type:'error',message});stop()};
  const watchdog=setInterval(()=>{if(!child)return;if(!stopping&&Date.now()-lastInput>10000)fail('O navegador parou de enviar o sinal. Transmissão encerrada.');else if(!stopping&&Date.now()-lastProgress>30000)fail('Sem progresso do codificador por 30 segundos. Confira a conexão e reinicie.')},1000);
  watchdog.unref();
  ws.on('message',(data,binary)=>{
   if(binary){if(!child||!ready||stopping)return;lastInput=Date.now();if(child.stdin.writableLength+data.length>8*1024*1024){fail('O codificador não está acompanhando o sinal. Reduza para 720p e tente novamente.');return}child.stdin.write(data,err=>{if(err&&!stopping)fail('O codificador encerrou a entrada de vídeo.');else if(!err)send({type:'ack',bytes:data.length})});return}
   let msg;try{msg=JSON.parse(data.toString())}catch{fail('Comando inválido.');return}
   if(msg.type==='stop'){stop();return}if(msg.type!=='start'){fail('Comando não suportado.');return}
   if(everStarted){fail('Abra uma nova sessão para iniciar outra transmissão.');return}everStarted=true;
   if(active){fail('Já existe uma transmissão ativa neste serviço. Encerre-a na outra aba.');return}if(!ffmpeg){fail('FFmpeg não encontrado. Execute INSTALAR.bat e depois INICIAR.bat.');return}
   let cfg;try{cfg=validateConfig(msg)}catch(e){fail(e.message);return}
   active=ws;lastInput=Date.now();lastProgress=Date.now();child=spawnProcess(ffmpeg,argsFor(cfg),{shell:false,windowsHide:true,stdio:['pipe','ignore','pipe','pipe']});cfg.target='';msg.key='';
   child.on('spawn',()=>{ready=true;send({type:'ready',message:'Codificador iniciado. Aguardando sinal PGM.'})});
   child.on('error',()=>{fail('Não foi possível iniciar o FFmpeg. Execute o diagnóstico do pacote.')});
   child.stdin.on('error',()=>{if(!stopping)fail('Entrada do codificador interrompida.')});
   child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-8192)});
   child.stdio[3].on('data',d=>{progress+=d.toString();let idx;while((idx=progress.indexOf('\n'))>=0){const line=progress.slice(0,idx).trim();progress=progress.slice(idx+1);if(line.startsWith('frame=')){const frames=Number(line.slice(6));if(frames>lastFrame){lastProgress=Date.now();lastFrame=frames;if(!stopping)send({type:'sending',frames,message:'Sinal sendo enviado. Confirme a recepção no YouTube Studio.'})}}}});
   child.on('close',code=>{clearTimeout(killTimer);child=null;if(active===ws)active=null;if(!stopping)send({type:'error',message:safeError(stderr)});stderr='';send({type:'stopped',code:code??null});ws.close();clearInterval(watchdog)});
  });
  ws.on('error',()=>stop());ws.on('close',()=>{clearInterval(watchdog);stop();if(!child&&active===ws)active=null});
 });
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'A porta 3180 já está em uso. Feche a outra instância do Andromeda.':'Não foi possível iniciar o serviço local: '+e.code)});
 function shutdown(){cloud?.close();for(const ws of inputWss.clients)ws.terminate();inputWss.close();cameraHub.close();receivers.close();for(const ws of wss.clients)ws.close();wss.close();server.close()}
 return {server,wss,cameraHub,shutdown,listen:()=>{if(camPort!==null)cameraHub.gateway.listen(camPort,'127.0.0.1');return server.listen(port,'127.0.0.1',()=>{console.log('Andromeda Live — saída real YouTube');console.log('Abra http://localhost:'+port);console.log(ffmpeg?'FFmpeg pronto. Inicie o envio pela mesa.':'FFmpeg ausente. Execute INSTALAR.bat ou configure FFMPEG_PATH.');console.log('Mantenha esta janela aberta. Ctrl+C para encerrar.');if(process.env.ANDROMEDA_OPEN_BROWSER==='1'&&process.platform==='win32'){const browser=spawn('cmd.exe',['/c','start','','http://localhost:'+port],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>{})}})}};
}
if(require.main===module){const bridge=createBridge({camPort:3185});bridge.listen();process.on('SIGINT',()=>{bridge.shutdown();setTimeout(()=>process.exit(),4000).unref()});process.on('SIGTERM',()=>{bridge.shutdown();setTimeout(()=>process.exit(),4000).unref()})}
module.exports={createBridge};
