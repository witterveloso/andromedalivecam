'use strict';
// Trilha: o tocador de links (proxy local) só entrega áudio público, com token, e entende listas .pls/.m3u.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { createBridge } = require('../server.cjs'), { isPrivateAddress, firstStream, parseTarget } = require('../trilha-proxy.cjs');

// Porta livre de verdade (pedida ao sistema) e o endereço 127.0.0.1: sem colisão de porta nem demora do "localhost" (IPv6) em máquinas de CI.
const freePort = () => new Promise((resolve, reject) => { const s = require('node:net').createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function fetchSession(base) { let last; for (let i = 0; i < 8; i++) { try { return await (await fetch(base + '/api/session')).json(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 150)); } } throw last; }
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

async function withBridge(env, fn) {
  const saved = {}; for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-trilha-test-')), port = await freePort();
  const bridge = createBridge({ dataDir: dir, port, camPort: null, lanPort: 0, relayBrokers: ['ws://127.0.0.1:1'] });
  await new Promise(resolve => bridge.server.listen(port, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + port, await fetchSession('http://127.0.0.1:' + port)); }
  finally { bridge.shutdown(); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(dir, { recursive: true, force: true }); }
}

test('endereços de rede interna e deste computador são reconhecidos e bloqueados', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '224.0.0.1']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '1.1.1.1', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(a), false, a);
  assert.equal(parseTarget('ftp://x/y'), null); assert.equal(parseTarget('http://user:pass@x.com/'), null); assert.equal(parseTarget('javascript:alert(1)'), null); assert.ok(parseTarget('https://radio.exemplo.com:8000/stream'));
  assert.equal(firstStream('[playlist]\nNumberOfEntries=1\nFile1=http://radio.exemplo.com:8000/live\nTitle1=Rádio'), 'http://radio.exemplo.com:8000/live');
  assert.equal(firstStream('#EXTM3U\n#EXTINF:-1,Rádio\nhttps://radio.exemplo.com/a.mp3\n'), 'https://radio.exemplo.com/a.mp3'); assert.equal(firstStream('nada aqui'), null);
});

test('o serviço exige o token e bloqueia a rede interna (sem a exceção de teste)', async () => {
  await withBridge({}, async (base, session) => {
    const url = e => base + '/api/trilha/stream?url=' + encodeURIComponent(e) + '&t=' + session.token;
    assert.equal((await fetch(base + '/api/trilha/stream?url=' + encodeURIComponent('http://example.com/a.mp3'))).status, 403, 'sem token');
    assert.equal((await fetch(base + '/api/trilha/stream?url=x&t=errado')).status, 403, 'token errado');
    for (const bad of ['ftp://x/y.mp3', 'não é um endereço', 'file:///etc/passwd']) { const r = await fetch(url(bad)); assert.equal(r.status, 400, bad); assert.equal((await r.json()).code, 'bad-url'); }
    for (const internal of ['http://127.0.0.1:' + base.split(':').pop() + '/api/session', 'http://localhost:3180/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/a.mp3']) { const r = await fetch(url(internal)); assert.ok(r.status === 400 || r.status === 502, internal + ' → ' + r.status); assert.notEqual(r.headers.get('content-type'), 'audio/mpeg'); await r.arrayBuffer(); }
  });
});

test('o serviço entrega áudio de um endereço (com Range e lista .pls) e recusa o que não é áudio', async () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4000, 7)]);
  const origin = http.createServer((req, res) => {
    if (req.url === '/a.wav') { const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); if (m) { const a = +m[1], b = m[2] ? +m[2] : wav.length - 1; res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': `bytes ${a}-${b}/${wav.length}`, 'Content-Length': b - a + 1 }); res.end(wav.subarray(a, b + 1)); } else { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); res.end(wav); } }
    else if (req.url === '/redir') { res.writeHead(302, { Location: '/a.wav' }); res.end(); }
    else if (req.url === '/live.pls') { res.writeHead(200, { 'Content-Type': 'audio/x-scpls' }); res.end('[playlist]\nFile1=http://127.0.0.1:' + origin.address().port + '/a.wav\n'); }
    else if (req.url === '/hls.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\nseg.ts\n'); }
    else if (req.url === '/erro') { res.writeHead(500); res.end('x'); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html></html>'); }
  });
  await new Promise(r => origin.listen(0, '127.0.0.1', r)); const op = origin.address().port;
  try {
    await withBridge({ ANDROMEDA_PROXY_ALLOW_PRIVATE: '1' }, async (base, session) => {
      const get = (p, headers = {}) => fetch(base + '/api/trilha/stream?url=' + encodeURIComponent('http://127.0.0.1:' + op + p) + '&t=' + session.token, { headers });
      let r = await get('/a.wav'); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav'); assert.equal((await r.arrayBuffer()).byteLength, wav.length);
      r = await get('/a.wav', { Range: 'bytes=100-199' }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100, 'Range repassado');
      r = await get('/redir'); assert.equal(r.status, 200, 'segue redirecionamento'); await r.arrayBuffer();
      r = await get('/live.pls'); assert.equal(r.status, 200, 'lista .pls vira o fluxo'); assert.equal((await r.arrayBuffer()).byteLength, wav.length);
      r = await get('/pagina.html'); assert.equal(r.status, 415); assert.equal((await r.json()).code, 'not-audio');
      r = await get('/hls.m3u8'); assert.equal(r.status, 415); assert.equal((await r.json()).code, 'hls');
      r = await get('/erro'); assert.ok(r.status >= 400); assert.ok((await r.json()).error);
    });
  } finally { origin.close(); }
});

test('a mesa carrega a trilha e liga atalhos, comandos e controle remoto', () => {
  const html = read('public/index.html'), server = read('server.cjs'), commands = read('public/commands.js'), desk = read('public/remote-desk.js');
  assert.ok(html.indexOf('/rundown.js') < html.indexOf('/trilha.js') && html.indexOf('/trilha.js') < html.indexOf('/workspace-custom.js'));
  assert.match(server, /'\/trilha\.js':'trilha\.js'/);
  assert.match(commands, /\{ id: 'trilha', name:/); assert.doesNotMatch(commands, /\{ id: 'trilhanext', name:/, 'PRÓXIMA FAIXA saiu dos Comandos (a tecla N continua)'); assert.match(commands, /\{ id: 'trilhanext', label:/);
  assert.match(commands, /id: 'trilha', label: [^\n]*key: 'T'/);
  for (const c of ['trilha', 'trilhanext']) assert.match(desk, new RegExp("case '" + c + "'"));
  const js = read('public/trilha.js'); assert.match(js, /fadeIn: 2, fadeOut: 3/, 'fade in 2 s e fade out 3 s já programados');
});
