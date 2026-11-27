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
async function session(port, { resync = true, kills = [2], killAtFrames = 0, killRecorderAtFrames = 0, reopen = true, durationMs = 7000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-heal-')), source = path.join(dir, 'source.webm'); makeWebm(source); const bytes = fs.readFileSync(source);
  const children = [], spawnProcess = (cmd, args, opts) => { const c = spawn(cmd, args, opts); children.push({ c, args }); return c; };
  const audit = createAudit({ write: false }), bridge = createBridge({ port, ffmpeg: exe, spawnProcess, audit }); bridge.listen(); await once(bridge.server, 'listening');
  let ws, timer, killed = false; const seen = []; const timers = [];
  const killEncoder = () => children.filter(x => x.args.includes('tee')).at(-1)?.c.kill('SIGKILL');
  try {
    const s = await (await fetch('http://localhost:' + port + '/api/session')).json();
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + s.token, { origin: 'http://localhost:' + port }); await once(ws, 'open');
    const done = new Promise((resolve, reject) => { const to = setTimeout(() => reject(Error('Timed out: ' + JSON.stringify(seen.map(m => m.type)))), 90000);
      ws.on('message', raw => { const m = JSON.parse(raw); seen.push(m);
        if (m.type === 'ready' && !seen.slice(0, -1).some(x => x.type === 'ready')) { timer = feed(ws, bytes); if (!killAtFrames) kills.forEach(sec => timers.push(setTimeout(killEncoder, sec * 1000))); timers.push(setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), durationMs)); }
        // Em computadores lentos (Windows no CI) o FFmpeg demora a gravar; matar só depois de haver imagem evita testar um arquivo vazio.
        if (killAtFrames && !killed && m.type === 'sending' && m.frames >= killAtFrames) { killed = true; killEncoder(); }
        // Disco da gravação falhando: só o gravador (Gravação Andrômeda) cai; o codificador e a transmissão nem percebem.
        if (killRecorderAtFrames && !killed && m.type === 'sending' && m.frames >= killRecorderAtFrames) { killed = true; children.filter(x => x.args.includes('matroska') && x.args.includes('pipe:0')).at(-1)?.c.kill('SIGKILL'); }
        if (m.type === 'restart' && reopen) { clearInterval(timer); for (let i = 0; i < 3; i++) ws.send(bytes.subarray(40000 + i * 3000, 43000 + i * 3000)); /* restos do gravador antigo: sem cabeçalho */ ws.send(bytes.subarray(0, 1)); setTimeout(() => { timer = feed(ws, bytes, 1); }, 100); /* como o Chrome: 1º pedaço de 1 byte, o resto do cabeçalho no seguinte */ }
        // Depois de um erro o serviço ainda fecha e junta a gravação (Gravação Andrômeda): espera o fim da sessão ("stopped" ou a
        // conexão fechada) antes de apagar a pasta, senão os arquivos ainda estão sendo escritos (Windows: ENOTEMPTY).
        if (m.type === 'stopped') { clearTimeout(to); resolve(); }
        if (m.type === 'error') { clearTimeout(to); setTimeout(resolve, 30000); } });
      ws.on('close', () => { clearTimeout(to); setTimeout(resolve, 200); }); });
    ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir: path.join(dir, 'rec'), formats: '16:9' }, channels: 1, resync }));
    await done; return { seen, audit, dir };
  } finally { clearInterval(timer); timers.forEach(clearTimeout); ws?.terminate(); bridge.shutdown(); }
}

test('self-healing: the encoder is killed mid-session, restarts by itself, and the recording keeps both parts in one file', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const { seen, audit, dir } = await session(3300, { killAtFrames: 45, durationMs: 9000 });
  try {
    assert(!seen.some(m => m.type === 'error'), JSON.stringify(seen.filter(m => m.type === 'error')));
    const restart = seen.filter(m => m.type === 'restart'); assert.equal(restart.length, 1); assert.match(restart[0].message, /reiniciado sozinho \(tentativa 1 de 3\)/);
    assert(audit.since(0).some(e => e.code === 'reinicio') && audit.since(0).some(e => e.code === 'codificador-encerrou'));
    // Gravação Andrômeda: a parte de antes e a de depois do reinício viram um arquivo só (nenhuma escreve por cima da outra).
    const recs = seen.filter(m => m.type === 'recorded'), files = recs.map(m => path.basename(m.file)); assert.equal(files.length, 1, JSON.stringify(files));
    assert.match(files[0], /_16x9\.mp4$/); assert(audit.since(0).some(e => e.code === 'partes-juntadas'), 'parts joined into one file');
    assert(duration(recs[0].file) > 3, 'the joined file holds both parts: ' + duration(recs[0].file) + ' s');
    assert.deepEqual(fs.readdirSync(path.dirname(recs[0].file)).filter(f => /_p\d|\.juntando|\.partes/.test(f)), [], 'no leftover parts');
    const after = seen.filter(m => m.type === 'sending').at(-1); assert(after.frames > 60, 'frames kept flowing after the restart: ' + after.frames);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('Gravação Andrômeda: o gravador cai no meio da live (disco), volta sozinho numa parte nova sem tocar na transmissão, e no fim sai um arquivo só', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const { seen, audit, dir } = await session(3303, { killRecorderAtFrames: 60, kills: [], durationMs: 9000 });
  try {
    assert(!seen.some(m => m.type === 'error' || m.type === 'restart'), 'o codificador não foi reiniciado: ' + JSON.stringify(seen.filter(m => m.type === 'error' || m.type === 'restart')));
    assert(audit.since(0).some(e => e.code === 'gravacao-reiniciando'), 'falha da gravação registrada');
    assert(seen.some(m => m.type === 'notice' && /Gravação 16:9 falhou .* retomada sozinha/.test(m.message)), 'a mesa foi avisada');
    assert(seen.some(m => m.type === 'recording-state' && m.state === 'recording' && m.part === 2), 'voltou a gravar na parte 2');
    const recs = seen.filter(m => m.type === 'recorded'); assert.equal(recs.length, 1, JSON.stringify(recs.map(m => path.basename(m.file))));
    assert(audit.since(0).some(e => e.code === 'partes-juntadas'), 'as duas partes viraram um arquivo');
    assert(duration(recs[0].file) > 4, 'arquivo com as duas partes: ' + duration(recs[0].file) + ' s');
    assert.deepEqual(fs.readdirSync(path.dirname(recs[0].file)).filter(f => /_p\d|\.juntando|\.partes/.test(f)), [], 'sem sobras');
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
