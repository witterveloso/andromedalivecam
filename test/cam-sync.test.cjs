const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const {createCameraHub}=require('../camera-hub.cjs');
const read=(...parts)=>fs.readFileSync(path.join(__dirname,'..',...parts),'utf8');
const shared=['index.html','cam.css','cam.js','manifest.json','relay.js'];

test('GitHub Pages client and gateway client are the same files',()=>{
 for(const name of shared)assert.equal(read('docs',name),read('public','cam',name),name+' differs between docs/ and public/cam/');
 assert(fs.readFileSync(path.join(__dirname,'..','docs','icon.png')).equals(fs.readFileSync(path.join(__dirname,'..','public','cam','icon.png'))),'icon.png differs');
});

test('camera page stays within the gateway content security policy',()=>{
 const html=read('docs','index.html');
 assert(!/\sstyle=/.test(html),'inline style attributes are blocked by style-src self');
 assert(!/<script(?![^>]*\ssrc=)/.test(html),'inline scripts are blocked by script-src self');
 assert(!/https?:\/\//.test(html.replace(/xmlns="[^"]+"/g,'')),'the page must not depend on other hosts');
 assert(!/url\(|@import/.test(read('docs','cam.css')),'the stylesheet must not load external resources');
});

test('gateway serves every file the camera page references',async()=>{
 const hub=createCameraHub({sessionToken:'t'.repeat(64)});hub.gateway.listen(0,'127.0.0.1');await once(hub.gateway,'listening');
 const base='http://127.0.0.1:'+hub.gateway.address().port;
 try{
  const page=await fetch(base+'/cam/');assert.equal(page.status,200);
  const html=await page.text();assert.equal(html,read('public','cam','index.html'));
  const refs=[...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(refs.sort(),['cam.css','cam.js','config.js','icon.png','icon.png','manifest.json','relay.js']);
  for(const name of refs){const r=await fetch(base+'/cam/'+name);assert.equal(r.status,200,name);assert((await r.arrayBuffer()).byteLength>10,name)}
  assert.match(await(await fetch(base+'/cam/config.js')).text(),/ANDROMEDA_GATEWAY\s*=\s*location\.origin/);
  const health=await fetch(base+'/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true},'health used by the container check and scripts/check-gateway.cjs');
 }finally{hub.close()}
});
