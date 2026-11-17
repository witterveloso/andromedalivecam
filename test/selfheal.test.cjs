const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process'), { WebSocket } = require('ws');
const { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs'), { findFFmpeg } = require('../encoder.cjs');
const exe = findFFmpeg();

function makeWebm(file) {
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '9', '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '500k', '-g', '30', '-c:a', 'libopus', '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
}
const feed = (ws, bytes, from = 0) => { const step = Math.ceil(bytes.length / 90); let off = from; const t = setInterval(() => { if (off >= bytes.length || ws.readyState !== WebSocket.OPEN) { clearInterval(t); return; } ws.send(bytes.subarray(off, off += step)); }, 100); return t; };
const duration = f => { const p = spawnSync(exe, ['-hide_banner', '-i', f], { encoding: 'utf8' }), m = /Duration: (\d+):(\d+):([\d.]+)/.exec(p.stderr); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };

// Sessão só de gravação; "kills" diz em que segundos matar o codificador. O navegador simulado reabre o gravador ao receber "restart".
async function session(port, { resync = true, kills = [2], reopen = true, durationMs = 7000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-heal-')), source = path.join(dir, 'source.webm'); makeWebm(source); const bytes = fs.readFileSync(source);
  const children = [], spawnProcess = (cmd, args, opts) => { const c = spawn(cmd, args, opts); children.push({ c, args }); return c; };
  const audit = createAudit({ write: false }), bridge = createBridge({ port, ffmpeg: exe, spawnProcess, audit }); bridge.listen(); await once(bridge.server, 'listening');
  let ws, timer; const seen = []; const timers = [];
  try {
    const s = await (await fetch('http://localhost:' + port + '/api/session')).json();
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + s.token, { origin: 'http://localhost:' + port }); await once(ws, 'open');
    const done = new Promise((resolve, reject) => { const to = setTimeout(() => reject(Error('Timed out: ' + JSON.stringify(seen.map(m => m.type)))), 90000);
      ws.on('message', raw => { const m = JSON.parse(raw); seen.push(m);
        if (m.type === 'ready' && !seen.slice(0, -1).some(x => x.type === 'ready')) { timer = feed(ws, bytes); kills.forEach(sec => timers.push(setTimeout(() => children.filter(x => x.args.includes('tee')).at(-1)?.c.kill('SIGKILL'), sec * 1000))); timers.push(setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), durationMs)); }
        if (m.type === 'restart' && reopen) { clearInterval(timer); for (let i = 0; i < 3; i++) ws.send(bytes.subarray(40000 + i * 3000, 43000 + i * 3000)); /* restos do gravador antigo: sem cabeçalho */ ws.send(bytes.subarray(0, 1)); setTimeout(() => { timer = feed(ws, bytes, 1); }, 100); /* como o Chrome: 1º pedaço de 1 byte, o resto do cabeçalho no seguinte */ }
        if (m.type === 'stopped' || m.type === 'error') { clearTimeout(to); setTimeout(resolve, m.type === 'error' ? 500 : 0); } }); });
    ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir: path.join(dir, 'rec'), formats: '16:9' }, channels: 1, resync }));
    await done; return { seen, audit, dir };
  } finally { clearInterval(timer); timers.forEach(clearTimeout); ws?.terminate(); bridge.shutdown(); }
}

test('self-healing: the encoder is killed mid-session, restarts by itself, and both recordings are kept', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const { seen, audit, dir } = await session(3300, { kills: [2.2] });
  try {
    assert(!seen.some(m => m.type === 'error'), JSON.stringify(seen.filter(m => m.type === 'error')));
    const restart = seen.filter(m => m.type === 'restart'); assert.equal(restart.length, 1); assert.match(restart[0].message, /reiniciado sozinho \(tentativa 1 de 3\)/);
    assert(audit.since(0).some(e => e.code === 'reinicio') && audit.since(0).some(e => e.code === 'codificador-encerrou'));
    const files = seen.filter(m => m.type === 'recorded').map(m => path.basename(m.file)); assert.equal(files.length, 2, JSON.stringify(files));
    assert(files.some(f => /_16x9\.mp4$/.test(f)) && files.some(f => /_16x9_p2\.mp4$/.test(f)), 'second part never overwrites the first: ' + files);
    for (const m of seen.filter(m => m.type === 'recorded')) assert(duration(m.file) > 1, path.basename(m.file) + ' is playable: ' + duration(m.file) + ' s');
    const after = seen.filter(m => m.type === 'sending').at(-1); assert(after.frames > 60, 'frames kept flowing after the restart: ' + after.frames);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('self-healing: a client that cannot reopen its recorder keeps the old behaviour (clear error, no loop)', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const { seen, dir } = await session(3301, { resync: false, kills: [2], reopen: false });
  try { assert(!seen.some(m => m.type === 'restart')); assert(seen.some(m => m.type === 'error'), 'ends with an error message'); } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('self-healing: after 3 restarts in 2 minutes it gives up instead of looping', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const { seen, dir } = await session(3302, { kills: [1.5, 3, 4.5, 6], durationMs: 12000 });
  try {
    assert.equal(seen.filter(m => m.type === 'restart').length, 3, 'three restarts, no more');
    assert(seen.some(m => m.type === 'error'), 'the fourth fall ends the session with an error');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
