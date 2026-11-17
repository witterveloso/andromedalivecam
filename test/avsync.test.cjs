const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyze, compensation, clampOffset, parseMetadata, events } = require('../avsync.cjs'), { findFFmpeg } = require('../encoder.cjs');
const exe = findFFmpeg();

// Sinal de teste como o da mesa: tela preta com clarão brancos de 100 ms a cada 1,2 s e, com um atraso conhecido, um bipe de 1 kHz.
function makeClip(file, audioDelayMs) {
  const flashes = [1.5, 2.7, 3.9, 5.1, 6.3, 7.5], d = audioDelayMs / 1000;
  const vexpr = flashes.map(t => `between(T,${t.toFixed(3)},${(t + 0.1).toFixed(3)})`).join('+');
  const aexpr = flashes.map(t => `between(t,${(t + d).toFixed(3)},${(t + d + 0.1).toFixed(3)})`).join('+');
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=30,geq=lum='if(${vexpr},235,16)':cb=128:cr=128`,
    '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*1000*t)*(${aexpr})':s=48000:c=mono`, '-t', '9', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
}

test('the sync probe reads the offset between flashes and beeps from a recording', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sync-'));
  try {
    for (const delay of [0, 120, -90]) {
      const file = path.join(dir, 'clip' + delay + '.mp4'); makeClip(file, delay);
      const r = await analyze(exe, file);
      assert(r.reliable, JSON.stringify(r));
      assert(Math.abs(r.offsetMs - delay) <= 45, 'expected about ' + delay + ' ms, measured ' + r.offsetMs + ' ms (' + JSON.stringify(r.detail) + ')');
      assert.equal(r.pairs, 6);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a recording without flashes or beeps is reported, not guessed', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sync-')), file = path.join(dir, 'silent.mp4');
  try {
    spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file], { timeout: 30000 });
    await assert.rejects(analyze(exe, file), /clarões e bipes suficientes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compensation delays the side that is early, within ±500 ms', () => {
  assert.equal(compensation(80), -80, 'audio 80 ms late: delay the picture');
  assert.equal(compensation(-60), 60, 'audio 60 ms early: delay the audio');
  assert.equal(clampOffset(9000), 500); assert.equal(clampOffset(-9000), -500); assert.equal(clampOffset('x'), 0);
  assert.deepEqual(parseMetadata('frame:0 pts:0 pts_time:0.5\nlavfi.signalstats.YAVG=16\nframe:1 pts:1 pts_time:0.533\nlavfi.signalstats.YAVG=235\n', 'lavfi.signalstats.YAVG'), [{ t: .5, v: 16 }, { t: .533, v: 235 }]);
  assert.deepEqual(events([{ t: 0, v: 1 }, { t: .1, v: 9 }, { t: .2, v: 9 }, { t: 2, v: 9 }], v => v > 5, .25), [.1, 2]);
});

// ---- Circuito fechado: sinal alinhado → motor de envio com compensação → gravação → medição.
const { once } = require('node:events'), { WebSocket } = require('ws'), { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs');

function makeWebm(file) {
  const flashes = [1.2, 2.4, 3.6, 4.8, 6.0], vexpr = flashes.map(t => `between(T,${t.toFixed(3)},${(t + 0.1).toFixed(3)})`).join('+'), aexpr = flashes.map(t => `between(t,${t.toFixed(3)},${(t + 0.1).toFixed(3)})`).join('+');
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=30,geq=lum='if(${vexpr},235,16)':cb=128:cr=128`, '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*1000*t)*(${aexpr})':s=48000:c=mono`,
    '-t', '7.5', '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '600k', '-g', '30', '-c:a', 'libopus', '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
}
function feedRealtime(ws, bytes, seconds) { const step = Math.ceil(bytes.length / (seconds * 10)); let off = 0; const timer = setInterval(() => { if (off >= bytes.length || ws.readyState !== WebSocket.OPEN) { clearInterval(timer); return; } ws.send(bytes.subarray(off, off += step)); }, 100); return timer; }

async function recordThroughEngine(port, source, recDir, extra) {
  const audit = createAudit({ write: false }), bridge = createBridge({ port, ffmpeg: exe, audit }); bridge.listen(); await once(bridge.server, 'listening'); let ws, timer;
  try {
    const s = await (await fetch('http://localhost:' + port + '/api/session')).json();
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + s.token, { origin: 'http://localhost:' + port }); await once(ws, 'open');
    const seen = [], done = new Promise((resolve, reject) => { const to = setTimeout(() => reject(Error('Timed out: ' + JSON.stringify(seen.map(m => m.type)))), 60000);
      ws.on('message', raw => { const m = JSON.parse(raw); seen.push(m); if (m.type === 'ready') timer = feedRealtime(ws, fs.readFileSync(source), 7.5); if (m.type === 'sending' && !ws.__stop && m.frames > 190) { ws.__stop = true; ws.send(JSON.stringify({ type: 'stop' })); } if (m.type === 'stopped') { clearTimeout(to); resolve(); } }); });
    ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir: recDir, formats: '16:9' }, channels: 1, ...extra }));
    await done; return { seen, audit };
  } finally { clearInterval(timer); ws?.terminate(); bridge.shutdown(); }
}

test('real run: the engine shifts sound against picture by the requested compensation, in both directions', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sync-')), source = path.join(dir, 'source.webm'); makeWebm(source);
  try {
    const measured = {};
    for (const [i, ms] of [0, 150, -150].entries()) {
      const rec = path.join(dir, 'rec' + i), { seen } = await recordThroughEngine(3192 + i, source, rec, { avSyncMs: ms });
      const file = seen.find(m => m.type === 'recorded')?.file; assert(file, 'recording for ' + ms + ' ms');
      const r = await analyze(exe, file); assert(r.reliable, JSON.stringify(r)); measured[ms] = r.offsetMs;
    }
    // A diferença entre as gravações é a compensação pedida (a imagem tem resolução de um quadro, ~33 ms).
    assert(Math.abs((measured[150] - measured[0]) - 150) <= 50, 'audio delayed by 150 ms: ' + JSON.stringify(measured));
    assert(Math.abs((measured[-150] - measured[0]) + 150) <= 50, 'picture delayed by 150 ms: ' + JSON.stringify(measured));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('calibration mode: the engine records the probe, measures it, answers and leaves nothing behind', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sync-')), source = path.join(dir, 'source.webm'); makeWebm(source);
  try {
    const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('andromeda-sync-') && n !== path.basename(dir));
    const { seen, audit } = await recordThroughEngine(3195, source, path.join(dir, 'ignored'), { calibrate: true, avSyncMs: 400, destinations: [{ platform: 'custom', server: 'rtmp://127.0.0.1:1/x', key: 'nunca-usado-1' }] });
    const result = seen.find(m => m.type === 'avsync'); assert(result && !result.error, JSON.stringify(result)); assert(result.reliable && result.pairs >= 3);
    assert(Math.abs(result.offsetMs) <= 60, 'the raw chain (no compensation, even though the request said 400 ms) is close to zero: ' + result.offsetMs);
    assert(!fs.existsSync(path.join(dir, 'ignored')), 'the client folder is ignored: calibration records in its own temporary folder');
    const after = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('andromeda-sync-') && n !== path.basename(dir));
    assert.deepEqual(after, before, 'the temporary recording is deleted');
    assert(!seen.some(m => m.type === 'destination'), 'calibration never touches a platform');
    assert(audit.since(0).some(e => e.code === 'calibracao'), 'recorded in the audit');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
