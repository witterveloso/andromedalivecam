const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { createTurn } = require('../turn.cjs');

// Resposta no formato do endpoint generate-ice-servers da Cloudflare (com a porta 53, que os navegadores bloqueiam).
const cfResponse = { iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u-temp', credential: 'c-temp' },
] };
const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function fakeFetch(calls, { status = 200 } = {}) {
  return async (url, opts) => { calls.push({ url, opts }); return { ok: status === 200, status, json: async () => cfResponse }; };
}

test('4G/5G relay: Cloudflare TURN credentials are generated on the desk, the key never leaves it, port 53 is dropped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-turn-')), calls = [];
  const turn = createTurn({ dataDir: dir, fetchImpl: fakeFetch(calls) });
  try {
    assert.equal(turn.status().provider, 'off');
    assert(!turn.servers().some(s => s.urls.some(u => u.startsWith('turn'))), 'without configuration: STUN only');
    await assert.rejects(turn.save({ provider: 'cloudflare', keyId: 'curto', token: TOKEN }), /ID da chave/);
    const st = await turn.save({ provider: 'cloudflare', keyId: KEY, token: TOKEN });
    assert.equal(calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/' + KEY + '/credentials/generate-ice-servers');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + TOKEN); assert.equal(JSON.parse(calls[0].opts.body).ttl, 86400);
    assert(st.ready && st.hasToken && st.keyId === KEY);
    assert(!JSON.stringify(st).includes(TOKEN), 'the API token is never returned to the browser');
    const relay = turn.servers().find(s => s.username);
    assert.deepEqual(relay, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u-temp', credential: 'c-temp' });
    assert(turn.servers().some(s => s.urls.includes('stun:stun.cloudflare.com:3478')), 'STUN stays first for direct paths');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'turn.json'), 'utf8')).token, TOKEN, 'saved on this computer only');
    // Reabrir a mesa: mantém o token salvo; editar só o ID sem reenviar o token continua válido.
    const again = createTurn({ dataDir: dir, fetchImpl: fakeFetch(calls) }); await again.start();
    assert(again.status().ready); await again.save({ provider: 'cloudflare', keyId: KEY, token: '' }); again.stop();
    // Chave recusada pela Cloudflare: não salva e mantém a que funcionava.
    const bad = createTurn({ dataDir: dir, fetchImpl: fakeFetch([], { status: 401 }) });
    await assert.rejects(bad.save({ provider: 'cloudflare', keyId: 'f'.repeat(32), token: TOKEN }), /recusou/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'turn.json'), 'utf8')).keyId, KEY);
    bad.stop();
  } finally { turn.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('4G/5G relay: own TURN server (coturn) and switching off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-turn-')), turn = createTurn({ dataDir: dir, fetchImpl: null });
  try {
    await assert.rejects(turn.save({ provider: 'custom', urls: 'stun:x.example.test', username: 'a', credential: 'b' }), /turn:/);
    await assert.rejects(turn.save({ provider: 'custom', urls: 'turn:turn.example.test:3478', username: '', credential: '' }), /usuário e a senha/);
    const st = await turn.save({ provider: 'custom', urls: 'turn:turn.example.test:3478\nturns:turn.example.test:443?transport=tcp', username: 'mesa', credential: 'segredo' });
    assert(st.ready); assert.deepEqual(st.urls, ['turn:turn.example.test:3478', 'turns:turn.example.test:443?transport=tcp']); assert(!JSON.stringify(st).includes('segredo'));
    assert.equal(turn.servers().find(s => s.username).credential, 'segredo');
    const off = await turn.save({ provider: 'off' }); assert.equal(off.provider, 'off'); assert(!turn.servers().some(s => s.username));
  } finally { turn.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('4G/5G relay: the desk API shows the state and only accepts changes with the session token', async () => {
  const { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-turn-api-')), port = 3197;
  const bridge = createBridge({ port, dataDir: dir, ffmpeg: null, audit: createAudit({ write: false }) }); bridge.listen(); await once(bridge.server, 'listening');
  try {
    const base = 'http://localhost:' + port;
    assert.equal((await (await fetch(base + '/api/turn')).json()).provider, 'off');
    assert.equal((await fetch(base + '/api/turn', { method: 'POST', body: JSON.stringify({ provider: 'off' }) })).status, 403);
    const { token } = await (await fetch(base + '/api/session')).json();
    const r = await fetch(base + '/api/turn', { method: 'POST', headers: { 'X-Andromeda-Token': token }, body: JSON.stringify({ provider: 'custom', urls: 'turn:turn.example.test:3478', username: 'u', credential: 'p' }) });
    assert.equal(r.status, 200); assert.equal((await r.json()).provider, 'custom');
    assert.equal((await fetch(base + '/api/ice')).status, 403, 'TURN credentials only with the session token');
    const ice = await (await fetch(base + '/api/ice', { headers: { 'X-Andromeda-Token': token } })).json();
    assert(ice.iceServers.some(s => s.urls.includes('turn:turn.example.test:3478') && s.credential === 'p'), 'the cloud desk links get STUN + TURN');
    assert(ice.iceServers.some(s => s.urls.some(u => u.startsWith('stun:'))));
    const status = await (await fetch(base + '/api/cam/status')).json();
    assert.equal(status.turn.provider, 'custom'); assert(!JSON.stringify(status).includes('"p"'), 'no TURN password in the camera status');
  } finally { bridge.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
