const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

async function regressions(read, assert) {
 const camCode=read('public/cam/cam.js');
 const constraintText=camCode.slice(camCode.indexOf('function videoConstraints('),camCode.indexOf('function showCapabilities('));
 const fields={'#resolution':{value:'1920x1080'},'#fps':{value:'60'},'#lens':{value:'lens-a'}};
 const constraints=new Function('q',constraintText+';return videoConstraints;')(key=>fields[key]);
 assert.equal(constraints().frameRate.max,30);
 assert.equal(constraints().frameRate.ideal,30);
 fields['#resolution'].value='3840x2160';assert.equal(constraints().width.ideal,3840);assert.equal(constraints().frameRate.max,30);
 const rateText=camCode.slice(camCode.indexOf('async function bitrate('),camCode.indexOf('const MAX_MBPS'));
 let calls=0,applied;const sender={track:{kind:'video'},getParameters:()=>({encodings:[{}]}),async setParameters(p){calls++;if(calls===1)throw Error('unsupported priority');applied=JSON.parse(JSON.stringify(p));}};
 fields['#bitrate']={value:'5'};
 const rate=new Function('q','cam',rateText+';const MAX_MBPS=25;return bitrate;')(key=>fields[key],{pcs:new Map([['media',{pc:{getSenders:()=>[sender]}}]])});
 await rate();assert.equal(applied.encodings[0].maxFramerate,30);assert.equal(applied.encodings[0].maxBitrate,5000000);
 // Two outputs receive one copy each of an audio packet captured before the first video description.
 let clock=0,readCount=0,finishRead,flushes=0,deliver=true;
 const timers=[],audioPackets=[[],[]];let muxIndex=0;
 const mux={create(){const i=muxIndex++;return {header:()=>new Uint8Array([1]),video:()=>new Uint8Array([2]),audio(data,ms){audioPackets[i].push(ms);return new Uint8Array([3]);},restart:()=>new Uint8Array([1])};}};
 class VE {static async isConfigSupported(){clock+=100;return{supported:true};}constructor(cb){this.cb=cb;this.encodeQueueSize=0;}configure(){}encode(f,opts){if(deliver)this.cb.output({byteLength:1,copyTo:b=>{b[0]=1;},timestamp:f.timestamp,type:opts.keyFrame?'key':'delta'},{decoderConfig:{description:new Uint8Array([1,100,0,40])}});}async flush(){}close(){}}
 class AE {static async isConfigSupported(){return{supported:true};}constructor(cb){this.cb=cb;this.encodeQueueSize=0;}configure(){}encode(f){this.cb.output({timestamp:f.timestamp,byteLength:1,copyTo:b=>{b[0]=9;}},{});}async flush(){flushes++;}close(){}}
 const reader={read(){if(readCount++===0)return Promise.resolve({value:{sampleRate:48000,numberOfChannels:2,timestamp:0,duration:20000,close(){}},done:false});return new Promise(r=>finishRead=r);},async cancel(){finishRead?.({done:true});}};
 const module={exports:{}};
 const api=new Function('module','VideoEncoder','AudioEncoder','VideoFrame','AudioData','MediaStreamTrackProcessor','AndromedaMkv','setInterval','clearInterval','Worker','URL','Blob',
 read('public/engine.js')+';return module.exports;')(module,VE,AE,class{constructor(c,o){this.timestamp=o.timestamp;}close(){}},class{},class{constructor(){this.readable={getReader:()=>reader};}},mux,(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},()=>{},class{constructor(){throw Error('no worker')}},{createObjectURL:()=>''},class{});
 const failures=[];const session=api.create({audioTrack:{},now:()=>clock,outputs:['h','v'].map(id=>({id,canvas:{},width:1920,height:1080,bitrate:5000000,onChunk(){}})),onError:e=>failures.push(e.message)});
 await session.start();for(let i=0;i<8;i++)await Promise.resolve();
 const tick=timers.find(t=>t.ms===17).fn;tick();
 assert.equal(audioPackets[0].length,1);assert.equal(audioPackets[1].length,1);
 assert.equal(audioPackets[0][0],-20); // first audio aligned to reset start clock, not probe delay
 clock+=1000;let stats=session.stats();assert.equal(stats.outputs[0].emitted,1);
 deliver=false;clock+=34;tick();stats=session.stats();assert.equal(stats.fps,0);assert(stats.submittedFps>0);
 await session.stop();assert.equal(flushes,1);assert.equal(failures.length,0);
 assert.equal(read('docs/cam.js'),read('public/cam/cam.js'));
 assert.equal(read('docs/index.html'),read('public/cam/index.html'));
 assert.equal(read('docs/optics.js'),read('public/cam/optics.js'));
}

test('camera cap and transmission audio/startup/output regressions',()=>regressions(read,assert));
