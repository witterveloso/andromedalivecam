const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 let now=0;const timers=[],failures=[],encoded=[],closedFrames=[],keyRequests=[];let deliver=true,honor=()=>true;
 class Frame{constructor(src,o={}){this.timestamp=o.timestamp;this.src=src;}close(){closedFrames.push(this);}}
 class Encoder{static async isConfigSupported(){return{supported:true};}constructor(callbacks){this.cb=callbacks;this.encodeQueueSize=0;}configure(c){this.config=c;}encode(frame,opts){encoded.push(frame.timestamp);if(opts?.keyFrame)keyRequests.push(frame.timestamp);const isKey=!!opts?.keyFrame&&honor(frame.timestamp);if(deliver)this.cb.output({type:isKey?'key':'delta',timestamp:frame.timestamp,byteLength:1,copyTo(){}},{});}async flush(){}close(){}}
 const context={module:{exports:{}},VideoEncoder:Encoder,AudioEncoder:Encoder,VideoFrame:Frame,AudioData:class{},MediaStreamTrackProcessor:class{},performance:{now:()=>now},AndromedaMkv:{},setInterval(fn,ms){const t={fn,ms};timers.push(t);return t;},clearInterval(t){if(t)t.closed=true;},Uint8Array,ArrayBuffer};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/engine.js'),'utf8'),context);
 const api=context.module.exports;
 const session=api.create({dedicated:true,audioReadable:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{}})},outputs:[{id:'h',width:1920,height:1080,bitrate:6000000,onChunk(){}}],onError:e=>failures.push(e.message),now:()=>now});
 return{api,session,timers,failures,encoded,closedFrames,keyRequests,setHonor:f=>honor=f,frame:()=>new Frame({}),at:t=>now=t,deliver:v=>deliver=v,tick:()=>timers.find(t=>t.ms===4).fn()};
}
test('delayed first camera frame does not trigger a startup cadence failure',async()=>{
 const h=harness();await h.session.start();h.at(650);h.session.setFrame('h',h.frame());h.tick();
 assert.equal(h.failures.length,0);assert.equal(h.encoded.length,1);assert(h.encoded[0]>=600000,'first frame uses current clock instead of replaying stale slots');h.session.abort();
});
test('30 encoded frames can contain only 10 fresh PGM captures; metrics expose that',async()=>{
 const h=harness();await h.session.start();
 for(let i=0;i<30;i++){h.at(i*1000/30+.1);if(i%3===0)h.session.setFrame('h',h.frame());h.tick();}
 h.at(1000);const s=h.session.stats();assert.equal(s.fps,30);assert.equal(s.freshFps,10);assert.equal(s.repeated,20);assert.equal(s.outputs[0].emitted,30);
 assert(h.encoded.every((v,i)=>!i||(v-h.encoded[i-1]>=33333&&v-h.encoded[i-1]<=33334)));
 h.deliver(false);h.at(1000.1);h.tick();h.at(2000);const stalled=h.session.stats();assert.equal(stalled.fps,0);assert.equal(stalled.submittedFps,1);h.session.abort();
 assert.equal(h.closedFrames.length,41,'31 temporary encoder frames plus all 10 retained captures released');
});
test('dedicated output resumes on the current timestamp after a scheduler stall',async()=>{
 const h=harness();await h.session.start();h.session.setFrame('h',h.frame());h.tick();h.at(1000.1);h.tick();h.tick();assert.deepEqual(h.failures,[]);assert.deepEqual(h.encoded,[0,1000000]);h.session.abort();
});
test('H264 level is based on both dimensions, including portrait HD and 4K',async()=>{
 const h=harness();assert.equal((await h.api.probe({width:1280,height:720})).codec,'avc1.64001f');assert.equal((await h.api.probe({width:720,height:1280})).codec,'avc1.64001f');assert.equal((await h.api.probe({width:1080,height:1920})).codec,'avc1.640029','1080p30 em High@4.1');assert.equal((await h.api.probe({width:3840,height:2160})).codec,'avc1.640033');
});
test('two captures arriving before the next tick are both encoded in order',async()=>{
 const h=harness();await h.session.start();h.session.setFrame('h',h.frame());h.session.setFrame('h',h.frame());h.tick();h.at(34);h.tick();h.at(67);h.tick();h.at(100);const s=h.session.stats();
 assert.equal(s.outputs[0].frames,3);assert.equal(s.outputs[0].repeated,1);assert.equal(s.outputs[0].queueDropped,0);h.session.abort();
});
test('capture overload keeps at most four pending frames (absorbs bursts) and closes discarded resources',async()=>{
 const h=harness();await h.session.start();for(let i=0;i<10;i++)h.session.setFrame('h',h.frame());
 assert.equal(h.closedFrames.length,6);h.tick();assert.equal(h.session.stats().outputs[0].queueDropped,6);h.session.abort();assert.equal(h.closedFrames.length,11);
});
test('dedicated PGM uses a transferable capture stream and releases it on abort',async()=>{
 const workers=[],tracks=[];
 class Worker{constructor(){this.messages=[];workers.push(this);}postMessage(m,transfer){this.messages.push({m,transfer});if(m.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));if(m.type==='abort')queueMicrotask(()=>this.onmessage({data:{type:'aborted'}}));}terminate(){this.terminated=true;}}
 class Processor{constructor({track}){this.readable={track};}}
 const canvas={captureStream(rate){assert.equal(rate,0);const track={stopped:false,requests:0,requestFrame(){this.requests++;},stop(){this.stopped=true;}};tracks.push(track);return{getVideoTracks:()=>[track]};}};
 const ctx={module:{exports:{}},window:{andromedaProgramFrames:0},location:{origin:'http://localhost'},performance:{now:()=>0},Worker,URL:{createObjectURL:()=>'',revokeObjectURL(){}},Blob:class{},MediaStreamTrackProcessor:Processor,setTimeout:()=>1,clearTimeout(){},Map,Set,Promise};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/engine.js'),'utf8'),ctx);
 const session=ctx.module.exports.createDedicated({audioTrack:{},outputs:[{id:'h',canvas,width:1920,height:1080,bitrate:6000000,onChunk(){}}]});
 await session.start();const worker=workers[0],init=worker.messages[0];
 assert.equal(init.m.videos.length,1);assert.equal(init.m.videos[0].readable.track,tracks[0]);
 assert.equal(init.transfer.length,2,'audio and PGM streams transferred together');
 assert.equal(worker.messages.filter(x=>x.m.type==='frames').length,0,'no main-thread VideoFrame copying');
 assert.equal(tracks[0].requests,1);assert.equal(ctx.window.andromedaFrameSinks.size,1);
 ctx.window.andromedaFrameSinks.forEach(capture=>capture());assert.equal(tracks[0].requests,2);
 session.abort();await Promise.resolve();assert(tracks[0].stopped);assert(worker.terminated);assert.equal(ctx.window.andromedaFrameSinks.size,0);
});

test('0.28.1: capturas em rajadas de 3 (comum na captura do canvas) chegam todas novas ao codificador',async()=>{
 const h=harness();await h.session.start();
 // 30 quadros em 1 s, entregues em grupos de 3 a cada 100 ms; o codificador pede um quadro a cada 33,3 ms.
 for(let slot=0;slot<30;slot++){h.at(slot*1000/30+.1);if(slot%3===0)for(let k=0;k<3;k++)h.session.setFrame('h',h.frame());h.tick();}
 h.at(1000);const s=h.session.stats();assert.equal(s.outputs[0].queueDropped,0,'nenhuma captura descartada');assert.equal(s.repeated,0,'nenhum quadro repetido');assert.equal(s.freshFps,30);h.session.abort();
});
test('0.28.1: quadro-chave pedido e ignorado pelo codificador é pedido de novo antes de 2,3 s (nunca 4 s sem quadro-chave)',async()=>{
 const h=harness();await h.session.start();
 // O codificador ignora o pedido de quadro-chave em 2,0 s (como no ensaio 4K do CI); os outros ele atende.
 h.setHonor(ts=>Math.abs(ts-2000000)>1);
 for(let slot=0;slot<150;slot++){h.at(slot*1000/30+.1);h.session.setFrame('h',h.frame());h.tick();}
 const keys=h.keyRequests.filter(ts=>ts>0);assert(keys.includes(2000000),'pedido em 2 s');
 const retry=keys.find(ts=>ts>2000000);assert(retry!==undefined&&retry<=2300000,'novo pedido logo depois: '+retry);h.session.abort();
});
