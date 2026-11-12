const { test } = require('node:test'), assert = require('node:assert/strict'), https = require('node:https'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { once } = require('node:events');
const { WebSocket } = require('ws');
const { createCameraHub } = require('../camera-hub.cjs'), { startLan, certificateFor } = require('../lan.cjs'), { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs');

const get = (url, pathname) => new Promise((resolve, reject) => {
  https.get(url + pathname, { rejectUnauthorized: false, agent: false }, res => { const cert = res.socket.getPeerCertificate(); let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, cert })); }).on('error', reject);
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-lan-'));
const clean = dir => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows pode segurar arquivos */ } };

test('local network mode: HTTPS on the computer IP serves the camera page and signaling without internet', async () => {
  const dir = tmp(), hub = createCameraHub({ sessionToken: 't' });
  let lan, cam;
  try {
    lan = await startLan({ hub, dataDir: dir, address: '127.0.0.1', port: 0 });
    assert.equal(lan.origin, 'https://127.0.0.1:' + lan.port);
    const page = await get(lan.origin, '/cam/');
    assert.equal(page.status, 200); assert.match(page.body, /relay\.js/); assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(page.cert.subjectaltname, /IP Address:127\.0\.0\.1/);
    assert.equal((await get(lan.origin, '/cam/config.js')).body.trim(), 'window.ANDROMEDA_GATEWAY = location.origin;');
    assert.equal((await get(lan.origin, '/health')).body, '{"ok":true}');

    const inv = hub.invite(0, 'CAM 1');
    assert.equal(inv.url, lan.origin + '/cam/#' + inv.key, 'the invite carries the computer IP');
    cam = new WebSocket(lan.origin.replace('https', 'wss') + '/signal', { origin: lan.origin, rejectUnauthorized: false });
    await once(cam, 'open');
    const ready = new Promise(r => cam.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'ready') r(m); }));
    cam.send(JSON.stringify({ type: 'join', key: inv.key }));
    assert.equal((await ready).name, 'CAM 1');
  } finally { cam?.terminate(); await lan?.close(); hub.close(); clean(dir); }
});

test('the certificate is kept while the IPs stay the same and renewed when the network changes', async () => {
  const dir = tmp();
  try {
    const a = await certificateFor(dir, ['10.1.2.3']), b = await certificateFor(dir, ['10.1.2.3']);
    assert.equal(a.fingerprint, b.fingerprint, 'phones accept the warning only once per network');
    const c = await certificateFor(dir, ['10.1.2.3', '192.168.50.7']);
    assert.notEqual(c.fingerprint, a.fingerprint);
    assert.match(new crypto.X509Certificate(c.cert).subjectAltName, /IP Address:192\.168\.50\.7/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'certificado-rede-local.json')).mode & 0o777, 0o600);
  } finally { clean(dir); }
});

test('desk switches between internet and local network; internet invites need no address and the choice is remembered', async () => {
  const dir = tmp(), port = 3187;
  let bridge = createBridge({ port, ffmpeg: null, dataDir: dir, lanPort: 0, relayBrokers: ['ws://127.0.0.1:9'], camPage: 'https://cam.example.test/', audit: createAudit({ write: false }) });
  bridge.listen(); await once(bridge.server, 'listening');
  const base = 'http://localhost:' + port;
  try {
    const { token } = await (await fetch(base + '/api/session')).json();
    const post = (url, body, auth = token) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': auth }, body: JSON.stringify(body) });
    const first = await (await fetch(base + '/api/cam/status')).json();
    assert.equal(first.mode, 'internet'); assert.equal(first.page, 'https://cam.example.test/'); assert(Array.isArray(first.lanAddresses));
    const inv = await (await post('/api/cam/invite', { slot: 0, name: 'CAM 1', profile: { width: 1280, height: 720, fps: 30, bitrate: 3 } })).json();
    assert.match(inv.url, /^https:\/\/cam\.example\.test\/#r=[a-f0-9]{48}$/);
    assert.equal((await post('/api/cam/mode', { mode: 'lan', address: '127.0.0.1' }, 'wrong')).status, 403);
    const lanState = await (await post('/api/cam/mode', { mode: 'lan', address: '127.0.0.1' })).json();
    assert.equal(lanState.mode, 'lan'); assert.match(lanState.lan.origin, /^https:\/\/127\.0\.0\.1:\d+$/);
    const lanInvite = await (await post('/api/cam/invite', { slot: 1, name: 'CAM 2', profile: { width: 1280, height: 720, fps: 30, bitrate: 3 } })).json();
    assert.equal(lanInvite.url.startsWith(lanState.lan.origin + '/cam/#'), true);
    assert.equal((await get(lanState.lan.origin, '/cam/')).status, 200);

    bridge.shutdown(); await new Promise(r => setTimeout(r, 300));
    bridge = createBridge({ port, ffmpeg: null, dataDir: dir, lanPort: 0, relayBrokers: ['ws://127.0.0.1:9'], camPage: 'https://cam.example.test/', audit: createAudit({ write: false }) });
    bridge.listen(); await once(bridge.server, 'listening');
    const restored = await bridge.ready();
    assert.equal(restored.mode, 'lan', 'the mode survives a restart'); assert.match(restored.lan.origin, /^https:\/\/127\.0\.0\.1:/);
    const back = await (await post('/api/cam/mode', { mode: 'internet' }, (await (await fetch(base + '/api/session')).json()).token)).json();
    assert.equal(back.mode, 'internet'); assert.equal(back.lan, null);
  } finally { bridge.shutdown(); clean(dir); }
});
