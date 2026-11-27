const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {spawn,spawnSync}=require('node:child_process');const {WebSocket}=require('ws');
const {createBridge}=require('../server.cjs');const {createAudit}=require('../audit.cjs');
const {validateBroadcast,argsForBroadcast,destinationEvents,redact,findFFmpeg,PLATFORMS}=require('../encoder.cjs');

const base={resolution:'720p',bitrate:6};
const yt={platform:'youtube',server:'rtmps://a.rtmps.youtube.com:443/live2',key:'aaaa-bbbb-cccc-dddd'};
const fb={platform:'facebook',server:'rtmps://live-api-s.facebook.com:443/rtmp/',key:'FB-123456-0-AbCd?s_bl=1&s_psm=1&a=Xy_z'};

test('several platforms validate together; keys stay out of the server URL',()=>{
 const cfg=validateBroadcast({...base,destinations:[yt,fb,{platform:'twitch',server:'rtmps://live.twitch.tv/app',key:'live_123_abcDEF'},{platform:'custom',name:'Igreja',server:'rtmp://10.0.0.5/live',key:'culto'}]});
 assert.deepEqual(cfg.destinations.map(d=>d.name),['YouTube','Facebook','Twitch','Igreja']);
 assert.equal(cfg.destinations[1].target,'rtmps://live-api-s.facebook.com:443/rtmp/FB-123456-0-AbCd?s_bl=1&s_psm=1&a=Xy_z');
 assert(cfg.destinations.every(d=>d.warning===null));
 assert(Object.keys(PLATFORMS).includes('instagram')&&Object.keys(PLATFORMS).includes('kick')&&Object.keys(PLATFORMS).includes('tiktok'));
});

test('bad destinations are refused with a reason; a wrong host only warns',()=>{
 for(const destinations of [[],[{...yt,server:'https://youtube.com'}],[{...yt,server:'rtmps://a.rtmps.youtube.com/live2/key'}],[{...yt,server:'rtmp://evil.test/live2'}],[{...fb,key:'a b'}],[{...fb,key:"x'|[y]"}],[{...fb,server:'rtmp://user:pw@host/app'}],[{...fb,server:'rtmp://host/app?x=1'}],[yt,yt],Array(7).fill(0).map((_,i)=>({platform:'custom',server:'rtmp://h'+i+'/live',key:'kkkk'}))])
  assert.throws(()=>validateBroadcast({...base,destinations}));
 assert.throws(()=>validateBroadcast({...base,destinations:[yt],bitrate:50}));
 assert.throws(()=>validateBroadcast({...base,destinations:[yt],record:{dir:'relative/dir'}}));
 const odd=validateBroadcast({...base,destinations:[{...fb,server:'rtmps://elsewhere.example/rtmp'}]});
 assert.match(odd.destinations[0].warning,/não parece ser de Facebook/);
});

test('one encode feeds the Andromeda output distributor and the recording, each with its own path',()=>{
 const cfg=validateBroadcast({...base,destinations:[yt,fb],record:{dir:path.join(os.tmpdir(),"Lives [2026] d'agua")}});
 const args=argsForBroadcast(cfg),spec=args.at(-1);
 assert.equal(args.filter(a=>a==='libx264').length,1);assert.equal(args[args.lastIndexOf('-f')+1],'tee');
 const outputs=spec.split('|');assert.equal(outputs.length,2,'one feed for all destinations + the recording');
 assert.equal(outputs[0],'[f=flv:flvflags=no_duration_filesize:flush_packets=1:onfail=abort]pipe:1','destinations are fed through the distributor (saidas.cjs), never directly by the encoder');
 assert(!spec.includes(cfg.destinations[0].target)&&!spec.includes('FB-123456'),'no destination key in the encoder command');
 assert(outputs[1].startsWith("[f=fifo:fifo_format=matroska:format_opts='flush_packets=1':queue_size=2400:drop_pkts_on_overflow=1:onfail=ignore]"),'recording has its own queue: a slow disk never holds the live')
 assert(true&&outputs[1].includes("Lives \\[2026\\] d\\'agua")&&/Andromeda_\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d_16x9\.mkv$/.test(outputs[1]));
 assert.equal(validateBroadcast({...base,record:{dir:os.tmpdir()}}).destinations.length,0,'recording alone is allowed');
 assert(!argsForBroadcast(validateBroadcast({...base,record:{dir:os.tmpdir()}})).at(-1).includes('pipe:1'),'recording alone: no feed');
 assert.equal(validateBroadcast({...base,destinations:[{...yt,on:false}]}).destinations[0].on,false,'a destination can start on standby');
});

test('SRT destination: caller mode, stream ID and passphrase encoded, never leaked in logs',()=>{
 const cfg=validateBroadcast({...base,destinations:[{id:'s',platform:'srt',name:'Restream SRT',server:'srt://ingest.example.com:9000',key:'#!::r=live/abc,m=publish',passphrase:'segredo-forte-123',latency:1500}]});
 const d=cfg.destinations[0];assert.equal(d.protocol,'srt');assert.equal(d.secure,true);
 assert.equal(d.target,'srt://ingest.example.com:9000?mode=caller&transtype=live&latency=1500000&pkt_size=1316&streamid=%23!%3A%3Ar%3Dlive%2Fabc%2Cm%3Dpublish&passphrase=segredo-forte-123&pbkeylen=16');
 const clean=redact('Connection to '+d.target+' failed; also srt://x:1?passphrase=zzz',cfg);assert(!clean.includes('segredo')&&!clean.includes('zzz')&&!clean.includes('abc'));
 assert.throws(()=>validateBroadcast({...base,destinations:[{platform:'srt',server:'srt://h:9000',passphrase:'curta'}]}),/10 a 79/);
 assert.throws(()=>validateBroadcast({...base,destinations:[{platform:'srt',server:'srt://h:9000?mode=listener'}]}),/caller/);
 assert.throws(()=>validateBroadcast({...base,destinations:[{platform:'srt',server:'srt://h'}]}),/srt:\/\/servidor:porta/);
 assert.match(validateBroadcast({...base,destinations:[{platform:'srt',server:'srt://h:9000'}]}).destinations[0].warning,/sem criptografia/);
 assert.equal(validateBroadcast({...base,destinations:[{platform:'srt',server:'srt://h:9000?latency=500000'}]}).destinations[0].latency,500,'latency pasted in microseconds is understood');
});

test('encoder log lines map to the right destination and never leak a key',()=>{
 const cfg=validateBroadcast({...base,destinations:[yt,{...fb,id:'fb1'}]});
 const line='[fifo @ 0x1] Error opening '+cfg.destinations[1].target+': Connection refused\n[flv @ 0x2] unrelated';
 assert.deepEqual(destinationEvents(line,cfg),[{id:'fb1',name:'Facebook',state:'retrying',reason:'conexão recusada'}]);
 const clean=redact(line+' and rtmp://other.host/app/SECRETKEY',cfg);
 assert(!clean.includes('FB-123456')&&!clean.includes('SECRETKEY')&&clean.includes('Facebook'));
});

const exe=findFFmpeg();
function listener(port,key,file){return spawn(exe,['-hide_banner','-loglevel','error','-listen','1','-i','rtmp://127.0.0.1:'+port+'/live/'+key,'-c','copy','-y',file],{stdio:'ignore'})}
function clip(file,seconds){const r=spawnSync(exe,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t',String(seconds),'-c:v','libvpx','-deadline','realtime','-b:v','400k','-c:a','libopus','-y',file],{timeout:40000});assert.equal(r.status,0)}
// Sends the clip in real time, like MediaRecorder does, so progress keeps flowing on any FFmpeg version.
function feed(ws,bytes,seconds){const step=Math.ceil(bytes.length/(seconds*10));let offset=0;const timer=setInterval(()=>{if(offset>=bytes.length||ws.readyState!==WebSocket.OPEN){clearInterval(timer);return}ws.send(bytes.subarray(offset,offset+=step))},100);return timer}

test('real run: two RTMP destinations (one of them down) and an MP4 recording from a single encode',async t=>{
 if(!exe)return t.skip('FFmpeg ausente');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andromeda-multi-')),recDir=path.join(dir,"gravações [teste] d'hoje"),source=path.join(dir,'source.webm'),a=path.join(dir,'a.flv');
 clip(source,14);const upA=listener(19411,'keyAAAA1',a);await new Promise(r=>setTimeout(r,700));
 const audit=createAudit({write:false}),port=3182,bridge=createBridge({port,ffmpeg:exe,audit});bridge.listen();await once(bridge.server,'listening');let ws,timer;
 try{
  const session=await(await fetch('http://localhost:'+port+'/api/session')).json();assert(session.encoders.includes('libx264'));assert.equal(session.platforms.kick.name,'Kick');assert.equal(session.license.required,false);
  ws=new WebSocket('ws://localhost:'+port+'/publish','andromeda.'+session.token,{origin:'http://localhost:'+port});const seen=[];let stopSent=false;
  const done=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Timed out: '+JSON.stringify(seen.map(m=>m.type)))),60000);ws.on('message',raw=>{const m=JSON.parse(raw);seen.push(m);if(m.type==='ready')timer=feed(ws,fs.readFileSync(source),14);if(m.type==='sending'&&!stopSent&&m.frames>120&&(seen.some(x=>x.type==='destination'&&x.id==='b'&&x.state==='retrying')||m.frames>400)){stopSent=true;ws.send(JSON.stringify({type:'stop'}))}if(m.type==='stopped'){clearTimeout(timeout);resolve()}});ws.on('error',reject)});
  await once(ws,'open');
  ws.send(JSON.stringify({type:'start',...base,destinations:[{id:'a',platform:'custom',name:'Destino A',server:'rtmp://127.0.0.1:19411/live',key:'keyAAAA1'},{id:'b',platform:'custom',name:'Destino B',server:'rtmp://127.0.0.1:19412/live',key:'keyBBBB2'}],record:{dir:recDir}}));
  await done;
  assert(!seen.some(m=>m.type==='error'),JSON.stringify(seen.filter(m=>m.type==='error')));
  assert(seen.some(m=>m.type==='destination'&&m.id==='b'&&m.state==='retrying'),'the unreachable destination is reported');
  assert(!seen.some(m=>m.type==='destination'&&m.id==='a'&&m.state==='retrying'),'the healthy destination is not');
  const recorded=seen.find(m=>m.type==='recorded');assert(recorded&&recorded.file.endsWith('.mp4')&&recorded.file.startsWith(recDir),JSON.stringify(recorded));
  for(const file of [recorded.file,a]){assert(fs.statSync(file).size>20000,file);const probe=spawnSync(exe,['-hide_banner','-i',file],{encoding:'utf8'});assert(/Video: h264/.test(probe.stderr)&&/Audio: aac/.test(probe.stderr),probe.stderr)}
  assert(!fs.readdirSync(recDir).some(n=>n.endsWith('.mkv')),'the MKV is replaced by the MP4');
  const log=audit.export();assert(!log.includes('keyAAAA1')&&!log.includes('keyBBBB2'),'audit never stores stream keys');
  const codes=audit.since(0).map(e=>e.code);for(const code of ['inicio','enviando','destino-reconectando','fim','arquivo'])assert(codes.includes(code),code+' missing from '+codes);
  const feedLog=await(await fetch('http://localhost:'+port+'/api/audit?since=0')).json();assert(feedLog.events.length>=5&&feedLog.summary.counts.warn>=1);
 }finally{clearInterval(timer);ws?.terminate();upA.kill('SIGKILL');bridge.shutdown();try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch{/* Windows may still lock a file; never hide the test's own result */}}
});

test('storage and audit endpoints: token required for writes, volumes listed, folder checked',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andromeda-store-')),audit=createAudit({write:false}),port=3183,bridge=createBridge({port,ffmpeg:null,audit});bridge.listen();await once(bridge.server,'listening');const base='http://localhost:'+port;
 try{
  const {token}=await(await fetch(base+'/api/session')).json();const post=(url,body,auth=token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Andromeda-Token':auth},body:JSON.stringify(body)});
  const store=await(await fetch(base+'/api/storage')).json();assert(path.isAbsolute(store.defaultDir)&&Array.isArray(store.volumes));
  assert.equal((await post('/api/storage/check',{dir},'wrong')).status,403);
  const ok=await(await post('/api/storage/check',{dir:path.join(dir,'nova pasta')})).json();assert(ok.free>0&&fs.existsSync(ok.dir));
  assert.equal((await post('/api/storage/check',{dir:'relativa'})).status,400);
  assert.equal((await post('/api/audit',{level:'error',code:'teste',message:'falha rtmp://x.y/app/SEGREDO',data:{streamKey:'abc',fps:12}})).status,204);
  const last=audit.since(0).at(-1);assert.equal(last.level,'error');assert.equal(last.source,'mesa');assert(!JSON.stringify(last).includes('SEGREDO')&&last.data.streamKey==='•••'&&last.data.fps===12);
  const exported=await fetch(base+'/api/audit/export');assert.match(exported.headers.get('content-disposition'),/andromeda-auditoria-.*\.jsonl/);assert((await exported.text()).trim().split('\n').every(line=>JSON.parse(line).seq>0));
 }finally{bridge.shutdown();try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch{/* Windows may still lock a file; never hide the test's own result */}}
});

// Destino em espera que o operador corrige antes de pôr no ar (chave nova): entra no ar com a chave nova, não a antiga.
// E a gravação final sai em 30 fps cravados (cada quadro a 1/30 s exato), para os programas de edição lerem como taxa constante.
test('standby destination edited before going on air uses the new key; the MP4 recording is exact 30 fps',async t=>{
 if(!exe)return t.skip('FFmpeg ausente');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andromeda-edit-')),recDir=path.join(dir,'rec'),source=path.join(dir,'source.webm'),c=path.join(dir,'c.flv');
 clip(source,14);const up=listener(19413,'keyNEW999',c);await new Promise(r=>setTimeout(r,700));
 const audit=createAudit({write:false}),port=3184,bridge=createBridge({port,ffmpeg:exe,audit});bridge.listen();await once(bridge.server,'listening');let ws,timer;
 try{
  const session=await(await fetch('http://localhost:'+port+'/api/session')).json();
  ws=new WebSocket('ws://localhost:'+port+'/publish','andromeda.'+session.token,{origin:'http://localhost:'+port});const seen=[];let asked=false,stopSent=false;
  const dest={id:'c',platform:'custom',name:'Destino C',server:'rtmp://127.0.0.1:19413/live',key:'keyOLD000'};
  const done=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Timed out: '+JSON.stringify(seen.map(m=>m.type+':'+(m.state||''))))),60000);ws.on('message',raw=>{const m=JSON.parse(raw);seen.push(m);
   if(m.type==='ready')timer=feed(ws,fs.readFileSync(source),14);
   if(m.type==='sending'&&m.frames>60&&!asked){asked=true;ws.send(JSON.stringify({type:'output',id:'c',action:'start',destination:{...dest,key:'keyNEW999',on:true}}))}
   if(m.type==='sending'&&!stopSent&&(m.frames>300||seen.some(x=>x.type==='destination'&&x.id==='c'&&x.state==='sending')&&m.frames>200)){stopSent=true;ws.send(JSON.stringify({type:'stop'}))}
   if(m.type==='stopped'){clearTimeout(timeout);resolve()}});ws.on('error',reject)});
  await once(ws,'open');
  ws.send(JSON.stringify({type:'start',...base,resolution:'1080p',destinations:[{...dest,on:false}],record:{dir:recDir}}));
  await done;
  assert(seen.some(m=>m.type==='destination'&&m.id==='c'&&m.state==='standby'),'starts on standby');
  assert(seen.some(m=>m.type==='destination'&&m.id==='c'&&m.state==='sending'),'goes on air with the corrected key: '+JSON.stringify(seen.filter(m=>m.type==='destination')));
  await new Promise(r=>setTimeout(r,1500));assert(fs.existsSync(c)&&fs.statSync(c).size>20000,'the platform received the live');
  const recorded=seen.find(m=>m.type==='recorded');assert(recorded&&recorded.file.endsWith('.mp4'),JSON.stringify(recorded));
  const info=spawnSync(exe,['-hide_banner','-v','info','-i',recorded.file,'-map','0:v','-vf','showinfo','-f','null','-'],{encoding:'utf8',maxBuffer:32<<20}).stderr;
  const pts=[...info.matchAll(/pts:\s*(\d+)\s+pts_time/g)].map(m=>Number(m[1]));const steps=new Set(pts.slice(1).map((p,i)=>p-pts[i]));
  assert(pts.length>200,'recording has frames ('+pts.length+')');assert.deepEqual([...steps],[3000],'every frame exactly 1/30 s apart (90 kHz): '+[...steps].join(','));
 }finally{clearInterval(timer);ws?.terminate();up.kill('SIGKILL');bridge.shutdown();try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch{/* Windows */}}
});
