const { test } = require('node:test'), assert = require('node:assert/strict'), net = require('node:net'), os = require('node:os'), fs = require('node:fs'), path = require('node:path'), { once, EventEmitter } = require('node:events');
const { Writable } = require('node:stream'), { WebSocket } = require('ws');
const pf = require('../preflight.cjs'), { findFFmpeg, ENCODERS } = require('../encoder.cjs'), { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs');

test('destinations: reachable, refused and malformed addresses are told apart, with the right default ports', async () => {
  assert.deepEqual(pf.parseTarget('rtmps://a.rtmps.youtube.com/live2'), { host: 'a.rtmps.youtube.com', port: 443 });
  assert.deepEqual(pf.parseTarget('rtmp://live.example.test/app'), { host: 'live.example.test', port: 1935 });
  assert.deepEqual(pf.parseTarget('rtmp://10.0.0.5:19350/live'), { host: '10.0.0.5', port: 19350 });
  // WHIP (https/http) é testado por TCP na porta do endereço; SRT (UDP) só pelo nome do servidor.
  assert.deepEqual(pf.parseTarget('https://whip.example.test/live'), { host: 'whip.example.test', port: 443 });
  assert.deepEqual(pf.parseTarget('http://192.168.0.10:8889/whip'), { host: '192.168.0.10', port: 8889 });
  assert.deepEqual(pf.parseTarget('srt://ingest.example.test:9000'), { host: 'ingest.example.test', port: 9000, udp: true });
  assert.equal(pf.parseTarget('srt://sem-porta'), null); assert.equal(pf.parseTarget('ftp://x'), null); assert.equal(pf.parseTarget('nada'), null);
  assert.deepEqual(await pf.reach('srt://127.0.0.1:9000'), { host: '127.0.0.1', port: 9000, ok: true, ms: 0, udp: true });
  const server = net.createServer(s => s.destroy()); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const free = net.createServer(); free.listen(0, '127.0.0.1'); await once(free, 'listening'); const closedPort = free.address().port; free.close(); await once(free, 'close');
  try {
    const [up, down, bad] = await pf.checkDestinations([{ name: 'No ar', server: 'rtmp://127.0.0.1:' + server.address().port + '/live' }, { name: 'Fora', server: 'rtmp://127.0.0.1:' + closedPort + '/live' }, { name: 'Torto', server: 'banana' }]);
    assert(up.ok && up.ms >= 0 && up.name === 'No ar'); assert(!down.ok && /recusada/.test(down.error)); assert(!bad.ok && /inválido/.test(bad.error));
  } finally { server.close(); }
});

test('profile choice: the best option that leaves the encoder under ~30% of the computer', async () => {
  const run = speeds => pf.chooseProfile({ ffmpeg: 'x', x264Args: () => [], bench: async (_f, c) => speeds[c.width + 'x' + c.height + c.preset] ?? 0.1, vertical: speeds.vertical || null, hardware: speeds.hardware || [] });
  // Computador forte: 1080p equilibrado (1/4 = 25%).
  let r = await run({ '1920x1080veryfast': 4 }); assert.deepEqual([r.recommended.resolution, r.recommended.preset, r.recommended.encoder], ['1080p', 'veryfast', 'libx264']); assert.equal(r.recommended.load, 25);
  // Notebook médio: 1080p pesa demais, 720p equilibrado serve.
  r = await run({ '1920x1080veryfast': 2, '1920x1080superfast': 2.6, '1280x720veryfast': 3.4 }); assert.deepEqual([r.recommended.resolution, r.recommended.preset], ['720p', 'veryfast']);
  // Notebook fraco: só o preset mais rápido, e ainda dá o aviso de limite.
  r = await run({ '1280x720ultrafast': 3.2, '1280x720superfast': 2, '1280x720veryfast': 1.5 }); assert.deepEqual([r.recommended.resolution, r.recommended.preset], ['720p', 'ultrafast']);
  r = await run({ '1280x720ultrafast': 1.2 }); assert.equal(r.recommended.preset, 'ultrafast'); assert(r.notes.some(n => /no limite/.test(n)));
  // No limite, com codificador de placa de vídeo disponível: usa a placa.
  r = await run({ '1280x720ultrafast': 1.2, hardware: ['h264_nvenc'] }); assert.equal(r.recommended.encoder, 'h264_nvenc'); assert(r.notes.some(n => /placa de vídeo/.test(n)));
  // Com saída vertical, as duas saídas dividem o orçamento: o mesmo computador que fazia 1080p sozinho desce de perfil.
  r = await run({ '1920x1080veryfast': 4, '720x1280veryfast': 9, '1920x1080superfast': 5.5, '720x1280superfast': 10, '1280x720veryfast': 7, vertical: { width: 720, height: 1280 } });
  assert.deepEqual([r.recommended.resolution, r.recommended.preset], ['1080p', 'superfast'], 'with the vertical output too, 1080p balanced no longer fits: the preset drops first'); assert(r.recommended.load <= 30);
  r = await run({ '1920x1080veryfast': 4 }); assert.equal(r.recommended.resolution, '1080p', 'the same computer alone still does 1080p');
  // Sem conseguir medir nada, não inventa um perfil.
  r = await pf.chooseProfile({ ffmpeg: 'x', x264Args: () => [], bench: async () => null }); assert.equal(r.recommended, null);
});

test('real benchmark: the profile is measured with the production x264 parameters', async t => {
  const exe = findFFmpeg(); if (!exe) return t.skip('FFmpeg ausente');
  const r = await pf.chooseProfile({ ffmpeg: exe, x264Args: p => ENCODERS.libx264(4000, p), hardware: [] });
  assert(r.recommended && ['720p', '1080p'].includes(r.recommended.resolution) && ['veryfast', 'superfast', 'ultrafast'].includes(r.recommended.preset), JSON.stringify(r));
  assert(r.tests.length >= 1 && r.tests.every(x => x.speed === null || x.speed > 0)); assert(r.cores >= 1);
});

test('encoder load: a computer that falls behind is reported once, with the speed, and never on a healthy stream', async () => {
  // Codificador de mentira: emite os blocos de progresso do FFmpeg. Saudável = 1,0 s de imagem por 100 ms de relógio acelerado não serve;
  // usamos relógio real: cada bloco a cada 100 ms, produzindo 100 ms (saudável) ou 45 ms (sobrecarregado) de imagem.
  async function scenario(outPerBlockMs, blocks) {
    const spawnProcess = () => {
      const child = new EventEmitter(); child.stdin = new Writable({ write(_c, _e, cb) { cb(); }, final(cb) { cb(); } }); child.stderr = new EventEmitter(); child.stdio = [null, null, child.stderr, new EventEmitter()]; child.kill = () => child.emit('close', 0);
      setImmediate(() => child.emit('spawn'));
      let n = 0, out = 0, last = Date.now(); const timer = setInterval(() => { if (n++ >= blocks) { clearInterval(timer); return; } const now = Date.now(); out += (now - last) * (outPerBlockMs / 100) * 1000; last = now; /* proporcional ao relógio real: o intervalo do Windows oscila (~15 ms) e não pode virar "lentidão" */ child.stdio[3].emit('data', Buffer.from('frame=' + (n * 20 + 100) + '\nout_time_us=' + out + '\nprogress=continue\n')); }, 100);
      child.stdin.on('finish', () => clearInterval(timer)); return child;
    };
    const audit = createAudit({ write: false }), bridge = createBridge({ port: 3198, ffmpeg: 'fake', spawnProcess, audit }); bridge.listen(); await once(bridge.server, 'listening');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-load-')); let ws; const seen = [];
    try {
      const s = await (await fetch('http://localhost:3198/api/session')).json();
      ws = new WebSocket('ws://localhost:3198/publish', 'andromeda.' + s.token, { origin: 'http://localhost:3198' }); await once(ws, 'open'); ws.on('message', raw => seen.push(JSON.parse(raw)));
      ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir, formats: '16:9' }, channels: 1 }));
      await new Promise(r => setTimeout(r, blocks * 100 + 600)); return { seen, audit };
    } finally { ws?.terminate(); bridge.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const slow = await scenario(45, 14), overload = slow.seen.filter(m => m.type === 'notice' && m.overload);
  assert.equal(overload.length, 1, 'one warning, not one per second: ' + JSON.stringify(slow.seen.map(m => m.type)));
  assert.match(overload[0].message, /não está acompanhando.*0,4\d×/); assert(slow.audit.since(0).some(e => e.code === 'sobrecarga'));
  assert(slow.seen.some(m => m.type === 'health' && m.speed < .6), 'health reports the real speed');
  const fine = await scenario(100, 14); assert(!fine.seen.some(m => m.type === 'notice' && m.overload), 'a healthy encoder raises no alarm'); assert(fine.seen.some(m => m.type === 'health' && m.speed >= .95));
});

test('preflight API: needs the session token, reports destinations, machine and disk', async () => {
  const audit = createAudit({ write: false }), bridge = createBridge({ port: 3199, ffmpeg: findFFmpeg(), audit }); bridge.listen(); await once(bridge.server, 'listening');
  const up = net.createServer(s => s.destroy()); up.listen(0, '127.0.0.1'); await once(up, 'listening');
  try {
    const base = 'http://localhost:3199', body = JSON.stringify({ destinations: [{ name: 'Local', server: 'rtmp://127.0.0.1:' + up.address().port + '/x' }], dir: os.tmpdir() });
    assert.equal((await fetch(base + '/api/preflight', { method: 'POST', body })).status, 403);
    const { token } = await (await fetch(base + '/api/session')).json();
    const r = await (await fetch(base + '/api/preflight', { method: 'POST', headers: { 'X-Andromeda-Token': token }, body })).json();
    assert(r.destinations[0].ok && r.machine.cores >= 1 && r.disk && !r.disk.error, JSON.stringify(r));
    assert(!JSON.stringify(r).includes('/x'), 'the stream path/key never comes back');
    assert.equal((await fetch(base + '/api/benchmark', { method: 'POST', body: '{}' })).status, 403);
  } finally { up.close(); bridge.shutdown(); }
});
