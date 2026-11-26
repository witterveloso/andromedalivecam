const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {issue,verify,createLicense,GRACE_DAYS}=require('../license.cjs');const {createBridge}=require('../server.cjs');const {createAudit}=require('../audit.cjs');const {WebSocket}=require('ws');
const pair=()=>{const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');return {pub:publicKey.export({type:'spki',format:'pem'}),priv:privateKey.export({type:'pkcs8',format:'pem'})}};
const DAY=86400000,now=Date.UTC(2027,0,10);

test('a token carries plan and expiry, and only the seller key can sign it',()=>{
 const k=pair(),other=pair(),token=issue(k.priv,{plan:'anual',customer:'Igreja Central',email:'a@b.c',now});
 const ok=verify(k.pub,token,now+DAY);assert(ok.valid&&ok.plan==='anual'&&ok.customer==='Igreja Central'&&ok.daysLeft===365&&ok.warning===null);
 assert.equal(verify(other.pub,token,now).valid,false,'another key does not validate it');
 const [head,body,sig]=token.split('.'),forged=JSON.parse(Buffer.from(body,'base64url'));forged.expires='2099-01-01T00:00:00.000Z';
 assert.equal(verify(k.pub,[head,Buffer.from(JSON.stringify(forged)).toString('base64url'),sig].join('.'),now).valid,false,'editing the expiry breaks the signature');
 for(const junk of ['','abc','ALV1.x.y',token.slice(0,-4)])assert.equal(verify(k.pub,junk,now).valid,false);
 assert.throws(()=>issue(k.priv,{plan:'vitalicio',customer:'x'}));assert.throws(()=>issue(k.priv,{plan:'mensal',customer:''}));
});

test('expiry: warning in the last week, a short grace period, then blocked',()=>{
 const k=pair(),token=issue(k.priv,{plan:'mensal',customer:'Produtora',now});
 assert.match(verify(k.pub,token,now+26*DAY).warning,/vence em 5 dia/);
 const grace=verify(k.pub,token,now+32*DAY);assert(grace.valid&&grace.grace);
 const dead=verify(k.pub,token,now+(31+GRACE_DAYS+1)*DAY);assert(!dead.valid&&dead.expired&&/Renove/.test(dead.reason));
});

test('this computer: licensing is off without a public key and enforced once one is installed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andromeda-lic-')),k=pair(),publicKeyFile=path.join(dir,'license-public.pem'),tokenFile=path.join(dir,'licenca.txt');let clock=now;
 const license=createLicense({publicKeyFile,tokenFile,clock:()=>clock});
 try{
  assert.deepEqual([license.status().required,license.status().valid],[false,true]);assert.throws(()=>license.activate('x'));
  fs.writeFileSync(publicKeyFile,k.pub);assert.deepEqual([license.status().required,license.status().valid,license.status().mode],[true,false,'pendente']);
  assert.throws(()=>license.activate(issue(pair().priv,{plan:'anual',customer:'x',now})),/não reconhecido/);
  const port=3184,bridge=createBridge({port,ffmpeg:'ffmpeg',spawnProcess:()=>{throw Error('must not start the encoder')},audit:createAudit({write:false}),license});bridge.listen();await once(bridge.server,'listening');
  try{
   const session=await(await fetch('http://localhost:'+port+'/api/session')).json();assert.equal(session.license.mode,'pendente');
   const start=()=>new Promise((resolve,reject)=>{const ws=new WebSocket('ws://localhost:'+port+'/publish','andromeda.'+session.token,{origin:'http://localhost:'+port});ws.on('open',()=>ws.send(JSON.stringify({type:'start',resolution:'720p',bitrate:6,destinations:[{platform:'custom',server:'rtmp://127.0.0.1:9/live',key:'kkkk'}]})));ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='error'){ws.terminate();resolve(m.message)}});ws.on('error',reject)});
   assert.match(await start(),/token de ativação/i,'no broadcast without a licence');
   const activated=await fetch('http://localhost:'+port+'/api/license',{method:'POST',headers:{'Content-Type':'application/json','X-Andromeda-Token':session.token},body:JSON.stringify({token:issue(k.priv,{plan:'teste',customer:'Cliente Piloto',now})})});
   assert.equal(activated.status,200);assert.equal((await activated.json()).planName,'Teste');assert.equal(license.status().mode,'ativa');
   clock=now+40*DAY;assert.equal(license.status().mode,'vencida');assert.match(await start(),/vencida/i);
  }finally{bridge.shutdown()}
 }finally{try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch{/* Windows may still lock a file; never hide the test's own result */}}
});

test('licença presa ao computador: vale só no código para o qual foi emitida; o código vem do próprio sistema', () => {
  const { issue, verify, createLicense, machineCode } = require('../license.cjs');
  const { publicKey, privateKey } = require('node:crypto').generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }), priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const token = issue(priv, { plan: 'anual', customer: 'Cliente', device: '71ef-5cea-7cbe-38ae' });
  assert.equal(verify(pub, token, Date.now(), '71EF-5CEA-7CBE-38AE').valid, true, 'no computador certo');
  const other = verify(pub, token, Date.now(), 'AAAA-BBBB-CCCC-DDDD'); assert.equal(other.valid, false); assert.equal(other.otherDevice, true);
  assert.match(other.reason, /outro computador.*AAAA-BBBB-CCCC-DDDD/);
  assert.throws(() => issue(priv, { plan: 'anual', customer: 'C', device: 'xyz' }), /Código do computador inválido/);
  // o mesmo licenca.txt copiado para outro computador não ativa
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  fs.writeFileSync(path.join(dir, 'pub.pem'), pub); fs.writeFileSync(path.join(dir, 'licenca.txt'), token);
  assert.equal(createLicense({ publicKeyFile: path.join(dir, 'pub.pem'), tokenFile: path.join(dir, 'licenca.txt'), device: '71EF-5CEA-7CBE-38AE' }).status().valid, true);
  const copied = createLicense({ publicKeyFile: path.join(dir, 'pub.pem'), tokenFile: path.join(dir, 'licenca.txt'), device: '1111-2222-3333-4444' }).status();
  assert.equal(copied.valid, false); assert.equal(copied.device, '1111-2222-3333-4444', 'a tela mostra o código deste computador para pedir a licença');
  // impressão digital estável e no formato certo
  const code = machineCode({ platform: 'linux', read: () => 'abc123\n' }); assert.match(code, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/); assert.equal(code, machineCode({ platform: 'linux', read: () => 'ABC123' }));
  assert.equal(machineCode({ platform: 'win32', exec: () => '\r\n    MachineGuid    REG_SZ    9f1c-77aa\r\n' }), machineCode({ platform: 'win32', exec: () => 'MachineGuid REG_SZ 9F1C-77AA' }));
  fs.rmSync(dir, { recursive: true, force: true });
});
