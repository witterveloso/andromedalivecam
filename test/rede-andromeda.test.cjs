'use strict';
// Rede Andrômeda: STUN/TURN próprio (andromeda-turn.cjs), abertura de porta no roteador (upnp.cjs) e a mesa usando os dois (turn.cjs).
const { test } = require('node:test'), assert = require('node:assert/strict'), dgram = require('node:dgram'), http = require('node:http'), crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTurnServer, credentials, _internal: T } = require('../andromeda-turn.cjs');
const upnp = require('../upnp.cjs');
const { createTurn } = require('../turn.cjs');

function request(port, msg) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4'); s.on('message', b => { s.close(); resolve(T.parse(b)); }); s.on('error', reject);
    s.send(msg, port, '127.0.0.1'); setTimeout(() => { try { s.close(); } catch {} reject(Error('sem resposta')); }, 2000);
  });
}
const tid = () => crypto.randomBytes(12);

test('STUN próprio: responde Binding com o endereço visto (XOR-MAPPED-ADDRESS) e FINGERPRINT válido', async () => {
  const srv = await createTurnServer({ secret: 'x'.repeat(32), port: 34801, relayAddress: '127.0.0.1' }).listen();
  try {
    const t = tid(), res = await request(34801, T.build(0x001, 0x000, t, []));
    assert.equal(res.method, 0x001); assert.equal(res.cls, 0x100); assert(res.tid.equals(t));
    const mapped = T.xorAddress(res.get(0x0020).value, res.tid); assert.equal(mapped.address, '127.0.0.1'); assert(mapped.port > 0);
    const fp = res.get(0x8028), head = Buffer.from(res.raw.subarray(0, fp.offset)); head.writeUInt16BE(fp.offset + 8 - 20, 2);
    assert.equal(fp.value.readUInt32BE(0), (T.crc32(head) ^ 0x5354554e) >>> 0, 'FINGERPRINT confere');
  } finally { srv.close(); }
});

test('TURN próprio: sem credencial → 401 com REALM e NONCE; credencial vencida ou errada é recusada; certa aloca', async () => {
  const secret = 's'.repeat(40), srv = await createTurnServer({ secret, port: 34802, relayAddress: '127.0.0.1', relayBind: '127.0.0.1' }).listen();
  const transport = Buffer.from([17, 0, 0, 0]);
  try {
    const first = await request(34802, T.build(0x003, 0x000, tid(), [[0x0019, transport]]));
    assert.equal(first.cls, 0x110); const code = first.get(0x0009).value; assert.equal(code[2] * 100 + code[3], 401);
    const realm = first.get(0x0014).value.toString(), nonce = first.get(0x0015).value.toString();
    const tryWith = async (username, password) => {
      const key = crypto.createHash('md5').update(username + ':' + realm + ':' + password).digest();
      return request(34802, T.build(0x003, 0x000, tid(), [[0x0019, transport], [0x0006, Buffer.from(username)], [0x0014, Buffer.from(realm)], [0x0015, Buffer.from(nonce)]], key));
    };
    const old = credentials(secret, { ttl: -10 }); assert.equal((await tryWith(old.username, old.credential)).cls, 0x110, 'credencial vencida recusada');
    const wrong = credentials('outro-segredo-qualquer-1234567890'); assert.equal((await tryWith(wrong.username, wrong.credential)).cls, 0x110, 'credencial de outro segredo recusada');
    const ok = credentials(secret, { ttl: 600 }), res = await tryWith(ok.username, ok.credential);
    assert.equal(res.cls, 0x100, 'alocação aceita'); const relayed = T.xorAddress(res.get(0x0016).value, res.tid);
    assert.equal(relayed.address, '127.0.0.1'); assert(relayed.port > 0); assert.equal(srv.stats().active, 1);
  } finally { srv.close(); }
});

test('UPnP próprio: acha o serviço WAN do roteador, abre UDP e TCP, lê o IP público e reconhece CGNAT', async () => {
  const calls = [];
  const igd = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.url === '/desc.xml') { res.end('<root><URLBase>http://127.0.0.1:34803/</URLBase><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>'); return; }
      const action = /#(\w+)"/.exec(req.headers.soapaction || '')?.[1]; calls.push({ action, body });
      if (action === 'GetExternalIPAddress') res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>' + igd.ip + '</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
      else res.end('<s:Envelope><s:Body><u:AddPortMappingResponse/></s:Body></s:Envelope>');
    });
  });
  await new Promise(r => igd.listen(34803, '127.0.0.1', r));
  try {
    igd.ip = '203.0.113.7';
    const r = await upnp.openPorts({ internalClient: '192.168.0.10', ports: [{ port: 3478, protocol: 'UDP' }, { port: 3478, protocol: 'TCP' }], location: 'http://127.0.0.1:34803/desc.xml' });
    assert(r.ok, r.error); assert.equal(r.externalIP, '203.0.113.7'); assert.equal(r.reachable, true); assert.deepEqual(r.mapped, ['UDP 3478', 'TCP 3478']);
    const add = calls.filter(c => c.action === 'AddPortMapping'); assert.equal(add.length, 2);
    assert.match(add[0].body, /<NewInternalClient>192\.168\.0\.10<\/NewInternalClient>/); assert.match(add[0].body, /<NewProtocol>UDP<\/NewProtocol>/);
    igd.ip = '100.72.9.1';
    const cg = await upnp.openPorts({ internalClient: '192.168.0.10', ports: [{ port: 3478, protocol: 'UDP' }], location: 'http://127.0.0.1:34803/desc.xml' });
    assert.equal(cg.reachable, false, 'IP de CGNAT não é alcançável de fora');
  } finally { igd.close(); }
});

test('mesa com a Rede Andrômeda: retransmissão própria por padrão, credenciais temporárias, IP público quando o roteador abre a porta, nada de terceiros', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-rede-'));
  const turn = createTurn({ dataDir: dir, port: 34810, lan: () => '127.0.0.1', openPorts: async () => ({ ok: true, reachable: true, externalIP: '203.0.113.9', mapped: ['UDP 34810', 'TCP 34810'] }), closePorts: async () => {} });
  try {
    const st = await turn.start(); assert.equal(st.provider, 'andromeda'); assert.equal(st.ready, true); assert.equal(st.port, 34810);
    await new Promise(r => setTimeout(r, 50));
    const servers = turn.servers(), urls = servers.flatMap(s => s.urls);
    assert(urls.includes('turn:203.0.113.9:34810?transport=udp') && urls.includes('turn:203.0.113.9:34810?transport=tcp'), 'IP público para o celular no 5G');
    assert(urls.includes('turn:127.0.0.1:34810?transport=udp'), 'endereço local para o celular no Wi-Fi');
    assert(urls.includes('stun:203.0.113.9:34810'), 'STUN próprio');
    assert(!urls.some(u => /google|cloudflare|twilio|metered/.test(u)), 'nenhum servidor de terceiros');
    const relay = servers.find(s => s.username); assert.match(relay.username, /^\d+:camera$/);
    assert.equal(relay.credential, crypto.createHmac('sha1', JSON.parse(fs.readFileSync(path.join(dir, 'turn.json'), 'utf8')).secret).update(relay.username).digest('base64'), 'credencial temporária assinada pelo segredo da mesa');
    assert.equal(Number(relay.username.split(':')[0]) * 1000 > Date.now() + 23 * 3600 * 1000, true, 'vale 24 h');
    const status = turn.status(); assert.equal(status.router.reachable, true); assert(!JSON.stringify(status).includes(JSON.parse(fs.readFileSync(path.join(dir, 'turn.json'), 'utf8')).secret), 'o segredo nunca vai para a tela');
  } finally { turn.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ponto de encontro próprio: celular e mesa conversam pelo servidor da Rede Andrômeda com o cliente real do app (cifrado, sem terceiros)', async () => {
  const { startRede } = require('../andromeda-rede.cjs'), { Channel } = require('../public/cam/relay.js'), WebSocket = require('ws');
  const rede = await startRede({ port: 34830, bind: '127.0.0.1', turnSecret: 'z'.repeat(40), turnPort: 34831, publicIp: '127.0.0.1', onEvent: () => {} });
  const brokers = ['ws://127.0.0.1:34830/mqtt'], key = 'convite-' + crypto.randomBytes(8).toString('hex');
  const desk = new Channel({ inviteKey: key, role: 'desk', brokers, WebSocketImpl: WebSocket }), cam = new Channel({ inviteKey: key, role: 'cam', brokers, WebSocketImpl: WebSocket });
  try {
    assert(await desk.whenConnected(5000) && await cam.whenConnected(5000), 'os dois lados conectados ao ponto de encontro');
    const got = new Promise(r => desk.on(env => r(env)));
    assert.equal(await cam.send({ type: 'join', sid: 'abc' }), 1, 'enviado por 1 ponto de encontro (o próprio)');
    const env = await got; assert.equal(env.type, 'join'); assert.equal(env.from, 'cam');
    const reply = new Promise(r => cam.on(env => r(env))); await desk.send({ type: 'session', ok: true }); assert.equal((await reply).type, 'session');
    const st = rede.broker.stats(); assert.equal(st.topics, 1); assert(st.messages >= 2);
    // outro convite não ouve esta conversa
    const intruder = new Channel({ inviteKey: 'outro-convite', role: 'desk', brokers, WebSocketImpl: WebSocket }); let leaked = false; intruder.on(() => { leaked = true; });
    await intruder.whenConnected(5000); await cam.send({ type: 'ping' }); await new Promise(r => setTimeout(r, 300)); intruder.close(); assert.equal(leaked, false);
    const health = await (await fetch('http://127.0.0.1:34830/health')).json(); assert.equal(health.ok, true); assert(health.turn, 'retransmissão no mesmo servidor');
  } finally { desk.close(); cam.close(); rede.close(); }
});

test('mesa + servidor da empresa: retransmissão da mesa primeiro e a da Rede Andrômeda da empresa de reserva, com credencial temporária', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-rede-net-')), netSecret = 'n'.repeat(64);
  const turn = createTurn({ dataDir: dir, port: 34840, lan: () => '127.0.0.1', openPorts: async () => ({ ok: false, reachable: false, error: 'sem UPnP' }), closePorts: async () => {},
    network: { urls: ['turn:rede.exemplo.com.br:3478?transport=udp', 'turn:rede.exemplo.com.br:3478?transport=tcp'], secret: netSecret } });
  try {
    await turn.start(); const servers = turn.servers(), urls = servers.flatMap(s => s.urls);
    assert(urls.indexOf('turn:127.0.0.1:34840?transport=udp') < urls.indexOf('turn:rede.exemplo.com.br:3478?transport=udp'), 'a mesa vem antes do servidor da empresa');
    assert(urls.includes('stun:rede.exemplo.com.br:3478'), 'STUN do próprio servidor da empresa');
    const net = servers.find(s => s.urls.includes('turn:rede.exemplo.com.br:3478?transport=udp'));
    assert.equal(net.credential, crypto.createHmac('sha1', netSecret).update(net.username).digest('base64'), 'credencial temporária válida no servidor da Rede Andrômeda');
    assert(!urls.some(u => /google|cloudflare/.test(u)));
  } finally { turn.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
