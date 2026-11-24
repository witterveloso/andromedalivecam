const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validateBroadcast,groupsFor,argsForGroup}=require('../encoder.cjs');
test('4K30 profile carries 3840x2160 H264 without an extra video encode, and records the same group',()=>{
 const cfg=validateBroadcast({resolution:'2160p',bitrate:42,engine:'native',record:{dir:require('node:os').tmpdir(),formats:'16:9'},destinations:[{id:'local',platform:'custom',name:'Local',server:'rtmp://127.0.0.1/live',key:'test-key'}]});
 assert.equal(cfg.fps,30);const [group]=groupsFor(cfg);assert.equal(group.size,'3840:2160');assert(group.record);assert.equal(group.destinations.length,1);
 const args=argsForGroup(cfg,group).join(' ');assert.match(args,/-c:v copy/);assert.doesNotMatch(args,/-vf scale|-c:v libx264/);
});
test('4K bitrate limit and source resolution are not silently downgraded',()=>{
 for(const b of [0,61])assert.throws(()=>validateBroadcast({resolution:'2160p',bitrate:b,record:{dir:require('node:os').tmpdir()}}));
 const code=fs.readFileSync(require.resolve('../public/broadcast.js'),'utf8');assert.match(code,/outRes === '2160p' \? \[3840,2160\]/);assert.match(code,/fixed4k/);assert.match(code,/AndromedaEngine\.qualify/);
 const engine=fs.readFileSync(require.resolve('../public/engine.js'),'utf8');assert.match(engine,/blocks > 8192 \? '33'/);
 const publish=fs.readFileSync(require.resolve('../publish.cjs'),'utf8');assert.match(publish,/r\.group\.size === '3840:2160' \? 32 \* 1024 \* 1024/);
 const server=fs.readFileSync(require.resolve('../server.cjs'),'utf8');assert.match(server,/maxPayload:16\*1024\*1024/);
});
