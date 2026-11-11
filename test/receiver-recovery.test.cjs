const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createReceiver}=require('../receiver.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('stalled video restarts listener with same key; explicit stop cancels retries',async()=>{
 const children=[];function spawn(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.stdio=[p.stdin,p.stdout,p.stderr,new PassThrough()];p.kill=()=>{if(!p.dead){p.dead=true;queueMicrotask(()=>p.emit('close',0))}};children.push(p);return p}
 const r=createReceiver({ffmpeg:'mock',spawnProcess:spawn,stallTimeoutMs:60});
 try{const initial=r.start({host:'127.0.0.1',port:19401});children[0].stdout.write(Buffer.from([255,216,1,255,217]));assert(r.status().receiving);await wait(200);assert.equal(r.status().reconnects,1);assert(children[0].dead);await wait(450);assert.equal(children.length,4);assert.equal(r.status().key,initial.key);children[2].stdout.write(Buffer.from([255,216,2,255,217]));assert(r.status().receiving);r.stop();await wait(500);assert.equal(children.length,4);assert.equal(r.status().enabled,false)}finally{r.close()}
});
test('idle listener without a publisher is not repeatedly restarted',async()=>{let killed=0;function spawn(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.stdio=[p.stdin,p.stdout,p.stderr,new PassThrough()];p.kill=()=>{killed++;queueMicrotask(()=>p.emit('close',0))};return p}const r=createReceiver({ffmpeg:'mock',spawnProcess:spawn,stallTimeoutMs:50});try{r.start({host:'127.0.0.1',port:19402});await wait(180);assert.equal(killed,0);assert.equal(r.status().reconnects,0)}finally{r.close()}});
test('real RTMP publisher can reconnect to the same channel after disconnect',async t=>{
 const {spawn}=require('node:child_process'),{once}=require('node:events'),{findFFmpeg}=require('../encoder.cjs');const ffmpeg=findFFmpeg();if(!ffmpeg)return t.skip('FFmpeg ausente');const r=createReceiver({ffmpeg});let sender;
 const until=async predicate=>{const end=Date.now()+12000;while(!predicate()){if(Date.now()>end)throw Error('RTMP did not resume');await wait(100)}};
 try{const st=r.start({host:'127.0.0.1',port:19403});await wait(300);
 const publish=()=>spawn(ffmpeg,['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-g','30','-f','flv',st.server+'/'+st.key],{stdio:'ignore'});
 sender=publish();await until(()=>r.status().frames>3);const closed=once(sender,'close');sender.kill();await closed;await wait(1100);const before=r.status().frames;sender=publish();await until(()=>r.status().frames>before+3);assert(r.status().receiving);assert.equal(r.status().key,st.key);
 }finally{if(sender){const done=once(sender,'close');sender.kill();await done}r.close()}
});
