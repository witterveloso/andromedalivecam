'use strict';
// Actual Electron renderer -> WebCodecs worker -> WebSocket -> FFmpeg -> RTMP + disk.
// Synthetic local sources only. Never connects to a public broadcast destination.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'andromeda-tx-'));
const fourK=process.env.ANDROMEDA_TEST_4K==='1';let dimensions=fourK?'3840x2160':'1920x1080';const seconds=fourK?10:12;
const reportPath=path.join(root,'transmission-report.json');
app.setPath('userData',path.join(dir,'profile'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
for(const f of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(f);
process.env.ANDROMEDA_DATA_DIR=dir;process.env.ANDROMEDA_LOG_DIR=path.join(dir,'logs');
let bridge,win,receiver;const report={ok:false,platform:process.platform,electron:process.versions.electron,requestedOutput:dimensions,output:dimensions,source:'1920x1080 testsrc2 (4K test validates output scaling, not 4K ingest)',runs:[],errors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>finish(Error('Transmission test exceeded 240 seconds')),240000);
function finish(error){clearTimeout(deadline);if(error)report.errors.push(error.stack||String(error));report.ok=!error;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));receiver?.kill();bridge?.shutdown();win?.destroy();app.exit(error?1:0);}
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await wait(200);}throw Error('Timed out waiting for transmission state');}
app.whenReady().then(async()=>{
 const ffmpeg=require('../encoder.cjs').findFFmpeg();assert(ffmpeg,'FFmpeg required');
 const fixture=path.join(dir,'source.mp4');
 const made=spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-t','5','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart',fixture],{encoding:'utf8',timeout:30000});
 assert.equal(made.status,0,made.stderr);
 bridge=require('../server.cjs').createBridge({port:3180,camPort:null});bridge.listen();
 await new Promise(r=>bridge.server.listening?r():bridge.server.once('listening',r));
 win=new BrowserWindow({width:1440,height:1000,show:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
 await win.loadURL('http://localhost:3180/');
 const run=code=>win.webContents.executeJavaScript(code,true);
 await until(()=>run('typeof startBroadcast === "function" && !!window.andromedaBroadcast'));
 await run(`(async()=>{
   const src=${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(fixture).toString('base64'))};
   for(let i=0;i<3;i++){
     const el=document.createElement('video');el.src=src;el.loop=true;el.muted=true;el.playsInline=true;
     await el.play();el.currentTime=i;media[i].element=el;cams[i].conn=true;
   }
   state.pgm=0;state.prv=1;fx.live.layers[0].on=true;fx.live.layers[0].title='TESTE DE TRANSMISSÃO';
   const ac=await audioMixer.enable();const tone=ac.createOscillator(),gain=ac.createGain();gain.gain.value=.02;tone.connect(gain).connect(audioMixer.master);tone.start();window.testTone=tone;
   const m=andromedaBroadcast.model;Object.assign(m,{mode:'both',record:true,recordFormats:'16:9',dir:${JSON.stringify(dir)},resolution:${JSON.stringify(fourK?'2160p':'1080p')},bitrate:${fourK?42:6},policy:${JSON.stringify(fourK?'fixed4k':'fixed')},engine:'auto',encoder:'auto',destinations:[{id:'local',platform:'custom',name:'Local validation',server:'rtmp://127.0.0.1:19359/live',key:'test-stream',enabled:true,aspect:'16:9'}]});
   document.querySelector('#txAudio').value='silent';
   // A TCP preflight probe would consume FFmpeg's single RTMP listener; bypass only in this test.
   window.andromedaPreflight=async()=>({});sync();
 })()`);
 for(let attempt=0;attempt<(fourK?1:2);attempt++){
   const received=path.join(dir,`received-${attempt}.mkv`);let receiverLog='';
   receiver=spawn(ffmpeg,['-y','-hide_banner','-loglevel','warning','-listen','1','-i','rtmp://127.0.0.1:19359/live/test-stream','-c','copy',received],{stdio:['ignore','ignore','pipe']});
   receiver.stderr.on('data',b=>receiverLog+=b);const exited=new Promise(r=>receiver.once('exit',r));
   await wait(750);await run('startBroadcast()');
   try{await until(()=>run('liveTx.phase === "sending"'));}catch(e){throw Error(e.message+' '+await run('JSON.stringify({phase:liveTx.phase,status:document.querySelector("#txStatus")?.textContent,logs:document.querySelector(".log-list")?.textContent})'));}
   const actual=await run('liveTx.outputResolution');dimensions=actual==='720p'?'1280x720':actual==='1080p'?'1920x1080':actual==='540p'?'960x540':dimensions;report.output=dimensions;
   assert(['540p','720p','1080p','2160p'].includes(actual),'actual output resolution reported');
   const samples=[];
   for(let i=0;i<seconds;i++){
     await wait(1000);
     samples.push(await run('({phase:liveTx.phase,engine:liveTx.engine,stats:liveTx.nativeStats,pgm:window.andromedaProgramFrames})'));
     if(i===3||i===7)await run('state.prv=(state.pgm+1)%3;cut()');
   }
   await run('stopTransport()');await until(()=>run('liveTx.phase === "idle"'),15000);
   await Promise.race([exited,wait(5000)]);receiver.kill();receiver=null;
   const records=fs.readdirSync(dir).filter(f=>/^Andromeda_.*\.(mp4|mkv)$/.test(f));assert(records.length>attempt,'recording created');
   const record=path.join(dir,records.sort().at(-1));
   const analyze=file=>{
     const decoded=spawnSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0','-fps_mode','passthrough','-f','framemd5','-'],{encoding:'utf8',timeout:fourK?120000:30000,maxBuffer:5*1024*1024});assert.equal(decoded.status,0,decoded.stderr);
     assert(decoded.stdout.includes('#dimensions 0: '+dimensions),'expected dimensions '+dimensions);
     const rows=decoded.stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').map(x=>x.trim()));
     const pts=rows.map(r=>Number(r[2]));assert(pts.every((v,i)=>i===0||v>pts[i-1]),'strictly increasing timestamps');
     const audio=spawnSync(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-f','null','-'],{encoding:'utf8',timeout:20000});assert.equal(audio.status,0,audio.stderr);
     return {frames:rows.length,uniqueFrames:new Set(rows.map(r=>r[5])).size,firstPTS:pts[0],lastPTS:pts.at(-1),timebase:decoded.stdout.match(/#tb 0: (.*)/)?.[1],dimensions,audioDecoded:true};
   };
   const r={attempt:attempt+1,samples,received:analyze(received),recorded:analyze(record),receiverLog};report.runs.push(r);fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
   assert(samples.every(s=>s.phase==='sending'&&s.engine==='native'),'native engine remains active');
   const steady=samples.slice(3),average=name=>steady.reduce((n,s)=>n+(s.stats?.[name]||0),0)/steady.length;
   r.encodedFps=average('fps');r.freshFps=average('freshFps');
   assert(r.encodedFps>=28.5,'encoded frames >=28.5/s');assert(r.freshFps>=28.5,'new PGM compositions >=28.5/s');
   assert(r.received.frames>=seconds*28&&r.recorded.frames>=seconds*28,'at least 28 frames/s');
   assert(r.received.uniqueFrames/r.received.frames>.90,'moving received video, not repeated still frames');
   assert(Math.abs(r.received.frames-r.recorded.frames)<=3,'stream and recording share video frames');
 }
 await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(root,'transmission-screen.png'),img.toPNG()));finish();
}).catch(finish);
