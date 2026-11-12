const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), { once } = require('node:events'), { WebSocket } = require('ws');
const { createCameraHub } = require('../camera-hub.cjs'), { createRelay } = require('../relay.cjs');
const { Channel, mqtt, deriveChannel, seal, open } = require('../public/cam/relay.js');
const { startBroker } = require('./helpers/mqtt-broker.cjs');

const wait = ms => new Promise(r => setTimeout(r, ms));
function nextEnv(channel, sid, type, ms = 4000) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => { off(); reject(Error('Timed out: ' + type)); }, ms); const off = channel.on(env => { if (env.sid === sid && env.msg?.type === type) { clearTimeout(t); off(); resolve(env.msg); } }); });
}
function nextWs(ws, type) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Timed out: ' + type)), 4000); ws.on('message', function l(raw) { const m = JSON.parse(raw); if (m.type === type) { clearTimeout(t); ws.off('message', l); resolve(m); } }); }); }

test('MQTT packets survive being split across WebSocket frames', () => {
  const big = new Uint8Array(70000).fill(7), bytes = mqtt.publish('a/b', big), parser = new mqtt.Parser();
  const got = [...parser.push(bytes.subarray(0, 3)), ...parser.push(bytes.subarray(3, 40000)), ...parser.push(bytes.subarray(40000))];
  assert.equal(got.length, 1); const m = mqtt.readPublish(got[0]); assert.equal(m.topic, 'a/b'); assert.equal(m.payload.length, 70000);
});

test('each invite has its own topic and key; the broker only sees ciphertext', async () => {
  const k1 = 'a'.repeat(48), k2 = 'b'.repeat(48), c1 = await deriveChannel(k1), c2 = await deriveChannel(k2);
  assert.notEqual(c1.topic, c2.topic); assert(!c1.topic.includes(k1)); assert.equal(c1.topic, (await deriveChannel(k1)).topic);
  const box = await seal(c1.key, { sdp: 'v=0 secret' });
  assert(!Buffer.from(box).toString('latin1').includes('secret'));
  assert.deepEqual(await open(c1.key, box), { sdp: 'v=0 secret' });
  assert.equal(await open(c2.key, box), null, 'another invite cannot read it');
  box[20] ^= 1; assert.equal(await open(c1.key, box), null, 'tampering is rejected');
});

test('internet mode: phone and desk meet through the broker; invite, signaling, tally and revocation', async () => {
  const broker = await startBroker(); let relay;
  const hub = createCameraHub({ sessionToken: 'tok', iceServers: [{ urls: ['stun:stun.example.test:3478'] }], inviteURL: key => 'https://cam.example.test/#r=' + key, onInvite: key => relay.watch(key), onInviteEnd: key => relay.unwatch(key) });
  // O segundo mensageiro está fora do ar: tudo deve funcionar pelo primeiro.
  relay = createRelay({ hub, brokers: [broker.url, 'ws://127.0.0.1:9'] });
  const deskServer = http.createServer(); deskServer.on('upgrade', (r, s, h) => hub.deskUpgrade(r, s, h)); deskServer.listen(0, '127.0.0.1'); await once(deskServer, 'listening');
  let desk, phone;
  try {
    const inv = hub.invite(2, 'CAM 3 — Palco', { width: 1920, height: 1080, fps: 30, bitrate: 5 });
    assert.equal(inv.url, 'https://cam.example.test/#r=' + inv.key, 'no gateway address needed');
    desk = new WebSocket('ws://127.0.0.1:' + deskServer.address().port, 'andromeda.tok'); await once(desk, 'open');
    phone = new Channel({ inviteKey: inv.key, role: 'cam', brokers: [broker.url, 'ws://127.0.0.1:9'] });
    assert.equal(await phone.whenConnected(5000), true);
    await wait(200); // a mesa termina de se inscrever no tópico do convite

    const session = nextEnv(phone, 's1', 'session'); phone.send({ sid: 's1', msg: { type: 'session' } });
    const info = await session; assert.equal(info.ok, true); assert.equal(info.name, 'CAM 3 — Palco'); assert.deepEqual(info.profile, { width: 1920, height: 1080, fps: 30, bitrate: 5 });

    const discovered = nextWs(desk, 'camera'), ready = nextEnv(phone, 'j1', 'ready'), negotiate = nextEnv(phone, 'j1', 'negotiate');
    phone.send({ sid: 'j1', msg: { type: 'join' } });
    assert.equal((await discovered).slot, 2); assert.equal((await ready).slot, 2);
    assert.equal((await negotiate).iceServers[0].urls[0], 'stun:stun.example.test:3478');

    const offer = nextWs(desk, 'signal'); phone.send({ sid: 'j1', msg: { type: 'signal', lane: 'media', signal: { description: { type: 'offer', sdp: 'v=0' } } } });
    const sig = await offer; assert.equal(sig.slot, 2); assert.equal(sig.signal.description.type, 'offer');
    const answer = nextEnv(phone, 'j1', 'signal'); desk.send(JSON.stringify({ type: 'signal', slot: 2, lane: 'media', signal: { description: { type: 'answer', sdp: 'v=0' } } }));
    assert.equal((await answer).signal.description.type, 'answer');

    desk.send(JSON.stringify({ type: 'tally', pgm: 2, prv: 0, live: true })); await wait(50);
    const tally = nextEnv(phone, 'j1', 'tally'); hub.heartbeat(); assert.equal((await tally).state, 'program');

    const closed = nextEnv(phone, 'j1', 'closed'), left = nextWs(desk, 'camera-left');
    hub.revoke(2); assert.equal((await closed).code, 4002); assert.equal((await left).slot, 2);
    const gone = nextEnv(phone, 's2', 'session'); phone.send({ sid: 's2', msg: { type: 'session' } });
    assert.equal((await gone).ok, false, 'a revoked invite is refused');
    assert(broker.published() > 8);
  } finally { phone?.close(); desk?.terminate(); relay.close(); hub.close(); deskServer.close(); broker.close(); }
});
