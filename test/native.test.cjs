const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process'), { WebSocket } = require('ws');
const { createBridge } = require('../server.cjs'), { createAudit } = require('../audit.cjs'), { findFFmpeg, argsForGroup, validateBroadcast, groupsFor } = require('../encoder.cjs');
const Mkv = require('../public/mkvmux.js'), { readMkv } = require('./mkv-reader.cjs');
const exe = findFFmpeg();

// Fonte de teste: H.264 + Opus gerados pelo FFmpeg e reempacotados pelo empacotador do motor, como o navegador faria.
function nativeStream(dir, seconds = 8) {
  const file = path.join(dir, 'src.mkv');
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-c:a', 'libopus', '-ac', '2', '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
  const src = readMkv(fs.readFileSync(file)), v = src.tracks[1], a = src.tracks[2];
  const mk = () => Mkv.create({ video: { width: v.width, height: v.height, description: v.private }, audio: { channels: 2, sampleRate: 48000, description: a.private } });
  const sorted = [...src.packets].sort((x, y) => x.ms - y.ms);
  return { packets: sorted, mk, send: (mux, p) => (p.track === 1 ? mux.video(p.data, p.ms, p.key) : mux.audio(p.data, p.ms)) };
}
function makeWebm(file) {
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '500k', '-g', '30', '-c:a', 'libopus', '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
}
const streams = f => { const p = spawnSync(exe, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr; return { video: /Stream #0:\d.*Video: (\w+)/.exec(p)?.[1], audio: /Stream #0:\d.*Audio: (\w+)/.exec(p)?.[1], frames: Number(/frame=\s*(\d+)/.exec(spawnSync(exe, ['-hide_banner', '-i', f, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1] || 0) }; };

async function open(port) {
  const children = [], spawnProcess = (cmd, args, opts) => { const c = spawn(cmd, args, opts); children.push({ c, args }); return c; };
  const audit = createAudit({ write: false }), bridge = createBridge({ port, ffmpeg: exe, spawnProcess, audit }); bridge.listen(); await once(bridge.server, 'listening');
  const s = await (await fetch('http://localhost:' + port + '/api/session')).json();
  const ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + s.token, { origin: 'http://localhost:' + port }); await once(ws, 'open');
  const seen = []; ws.on('message', raw => seen.push(JSON.parse(raw)));
  const waitFor = (fn, ms = 30000) => new Promise((resolve, reject) => { const t0 = Date.now(), i = setInterval(() => { const v = fn(); if (v) { clearInterval(i); resolve(v); } else if (Date.now() - t0 > ms) { clearInterval(i); reject(Error('Timed out: ' + JSON.stringify(seen.map(m => m.type)))); } }, 50); });
  return { ws, seen, waitFor, audit, children, close: () => { ws.terminate(); bridge.shutdown(); } };
}

test('native engine arguments: the video is copied, the sound becomes AAC, and no delay filter is added twice', () => {
  const cfg = validateBroadcast({ destinations: [{ platform: 'youtube', server: 'rtmp://a.rtmp.youtube.com/live2', key: 'abcd-efgh-ijkl-mnop-qrst' }], resolution: '720p', bitrate: 4, engine: 'native', avSyncMs: 120 });
  assert.equal(cfg.engine, 'native'); const args = argsForGroup(cfg, groupsFor(cfg)[0]).join(' ');
  assert.match(args, /-f matroska -i pipe:0/); assert.match(args, /-c:v copy/); assert.match(args, /-c:a aac/); assert.doesNotMatch(args, /libx264|scale=|adelay|setpts/);
  assert.equal(validateBroadcast({ destinations: [], record: { dir: os.tmpdir(), formats: '16:9' }, resolution: '720p', bitrate: 4, engine: 'qualquer' }).engine, 'webm', 'unknown values fall back to the standard engine');
});

test('native engine: H.264 + Opus from the browser are recorded with the video untouched and AAC sound', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-native-')), c = await open(3310);
  try {
    const src = nativeStream(dir, 8);
    c.ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir: path.join(dir, 'rec'), formats: '16:9' }, channels: 1, engine: 'native', resync: true }));
    await c.waitFor(() => c.seen.some(m => m.type === 'ready')); const mux = src.mk(); c.ws.send(mux.header());
    // Tempo real, como o navegador: cada pacote sai no seu instante.
    const t0 = Date.now(); for (const p of src.packets) { const wait = p.ms - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait)); const out = src.send(mux, p); if (out.length) c.ws.send(out); }
    await c.waitFor(() => c.seen.some(m => m.type === 'sending' && m.frames > 100)); c.ws.send(JSON.stringify({ type: 'stop' }));
    await c.waitFor(() => c.seen.some(m => m.type === 'stopped'));
    assert(!c.seen.some(m => m.type === 'error'), JSON.stringify(c.seen.filter(m => m.type === 'error')));
    const rec = c.seen.find(m => m.type === 'recorded'); assert(rec, 'a recording came back'); const info = streams(rec.file);
    assert.equal(info.video, 'h264'); assert.equal(info.audio, 'aac', 'Opus became AAC for the platforms'); assert(info.frames > 200, 'frames: ' + info.frames);
    // Vídeo copiado: o tamanho do arquivo de vídeo é o do H.264 que o navegador mandou (nenhuma recodificação).
    const sent = src.packets.filter(p => p.track === 1).reduce((a, p) => a + p.data.length, 0), got = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-i', rec.file, '-map', '0:v:0', '-c', 'copy', '-f', 'h264', '-'], { maxBuffer: 1 << 28 }).stdout.length;
    assert(Math.abs(got - sent) / sent < .08, 'video bytes sent ' + sent + ' vs recorded ' + got + ' (only the container framing differs)');
  } finally { c.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('native engine: if the browser cannot keep it, the service switches to the standard encoder without ending the session', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-native-')), c = await open(3311), webm = path.join(dir, 'fallback.webm');
  try {
    makeWebm(webm); const webmBytes = fs.readFileSync(webm), src = nativeStream(dir, 6);
    c.ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, destinations: [], record: { dir: path.join(dir, 'rec'), formats: '16:9' }, channels: 1, engine: 'native', resync: true }));
    await c.waitFor(() => c.seen.some(m => m.type === 'ready')); const mux = src.mk(); c.ws.send(mux.header());
    const t0 = Date.now(); for (const p of src.packets.filter(p => p.ms < 3000)) { const wait = p.ms - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait)); const out = src.send(mux, p); if (out.length) c.ws.send(out); }
    await c.waitFor(() => c.seen.some(m => m.type === 'sending' && m.frames > 30));
    // O navegador desiste do motor próprio: avisa e passa a mandar WebM.
    c.ws.send(JSON.stringify({ type: 'engine', engine: 'webm', reason: 'codificador de vídeo recusou o quadro' }));
    const sw = await c.waitFor(() => c.seen.find(m => m.type === 'engine')); assert.equal(sw.engine, 'webm'); assert.match(sw.message, /continua com o codificador padrão/);
    const step = Math.ceil(webmBytes.length / 60); for (let off = 0; off < webmBytes.length; off += step) { c.ws.send(webmBytes.subarray(off, off + step)); await new Promise(r => setTimeout(r, 90)); }
    c.ws.send(JSON.stringify({ type: 'stop' })); await c.waitFor(() => c.seen.some(m => m.type === 'stopped'));
    assert(!c.seen.some(m => m.type === 'error'), JSON.stringify(c.seen.filter(m => m.type === 'error')));
    const files = c.seen.filter(m => m.type === 'recorded').map(m => m.file); assert.equal(files.length, 2, 'two parts, the first one is never overwritten: ' + files.map(f => path.basename(f)));
    assert(/_p2\.mp4$/.test(files[1]) || /_p2\.mp4$/.test(files[0]));
    for (const f of files) assert(streams(f).frames > 20, path.basename(f) + ' has picture');
    assert(c.audit.since(0).some(e => e.code === 'motor-padrao'), 'the switch is in the audit log');
  } finally { c.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
