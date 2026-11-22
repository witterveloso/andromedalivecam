const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 let now=0;const timers=[],failures=[],encoded=[],closedFrames=[];let deliver=true;
 class Frame{constructor(src,o={}){this.timestamp=o.timestamp;this.src=src;}close(){closedFrames.push(this);}}
 class Encoder{static async isConfigSupported(){return{supported:true};}constructor(callbacks){this.cb=callbacks;this.encodeQueueSize=0;}configure(c){this.config=c;}encode(frame){encoded.push(frame.timestamp);if(deliver)this.cb.output({type:'delta',timestamp:frame.timestamp,byteLength:1,copyTo(){}},{});}async flush(){}close(){}}
 const context={module:{exports:{}},VideoEncoder:Encoder,AudioEncoder:Encoder,VideoFrame:Frame,AudioData:class{},MediaStreamTrackProcessor:class{},performance:{now:()=>now},AndromedaMkv:{},setInterval(fn,ms){const t={fn,ms};timers.push(t);return t;},clearInterval(t){if(t)t.closed=true;},Uint8Array,ArrayBuffer};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/engine.js'),'utf8'),context);
 const api=context.module.exports;
 const session=api.create({dedicated:true,audioReadable:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{}})},outputs:[{id:'h',width:1920,height:1080,bitrate:6000000,onChunk(){}}],onError:e=>failures.push(e.message),now:()=>now});
 return{api,session,timers,failures,encoded,closedFrames,frame:()=>new Frame({}),at:t=>now=t,deliver:v=>deliver=v,tick:()=>timers.find(t=>t.ms===4).fn()};
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
test('encoder overload stops unbounded catch-up and surfaces a cadence failure',async()=>{
 const h=harness();await h.session.start();h.session.setFrame('h',h.frame());h.tick();h.at(1000);h.tick();h.tick();assert.equal(h.failures.length,1);assert.match(h.failures[0],/200 ms/);assert.equal(h.encoded.length,1);h.session.abort();
});
test('H264 level is based on both dimensions, including portrait HD and 4K',async()=>{
 const h=harness();assert.equal((await h.api.probe({width:1280,height:720})).codec,'avc1.64001f');assert.equal((await h.api.probe({width:720,height:1280})).codec,'avc1.64001f');assert.equal((await h.api.probe({width:1080,height:1920})).codec,'avc1.640028');assert.equal((await h.api.probe({width:3840,height:2160})).codec,'avc1.640033');
});
