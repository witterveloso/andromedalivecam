const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process'); const { WebSocket } = require('ws');
const { createBridge } = require('../server.cjs'); const { createAudit } = require('../audit.cjs');
const { validateBroadcast, groupsFor, argsForGroup, findFFmpeg } = require('../encoder.cjs');

const yt = { id: 'yt', platform: 'youtube', server: 'rtmps://a.rtmps.youtube.com:443/live2', key: 'aaaa-bbbb-cccc-dddd' };
const fb = { id: 'fb', platform: 'facebook', server: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: 'FB-123456-0-AbCd' };
const ig = { id: 'ig', platform: 'instagram', server: 'rtmps://live-upload.instagram.com:443/rtmp/', key: 'IG-998877' };
const tk = { id: 'tk', platform: 'tiktok', server: 'rtmp://push-rtmp-l1.tiktokcdn.com/stage', key: 'stream-xyz' };

test('each platform gets its own screen format: YouTube/Facebook 16:9, Instagram/TikTok 9:16', () => {
  const cfg = validateBroadcast({ resolution: '1080p', bitrate: 6, destinations: [yt, fb, ig, tk] });
  assert.deepEqual(cfg.destinations.map(d => d.name + ' ' + d.aspect), ['YouTube 16:9', 'Facebook 16:9', 'Instagram 9:16', 'TikTok 9:16']);
  const [h, v] = groupsFor(cfg);
  assert.equal(h.size, '1920:1080'); assert.deepEqual(h.destinations.map(d => d.id), ['yt', 'fb']);
  assert.equal(v.size, '720:1280', 'Instagram live default is 720×1280'); assert.equal(v.bitrate, 4); assert.deepEqual(v.destinations.map(d => d.id), ['ig', 'tk']);
  assert(argsForGroup(cfg, v).includes('scale=720:1280:flags=bilinear,setsar=1')); assert(!argsForGroup(cfg, v).at(-1).includes('youtube'), 'vertical encode never reaches 16:9 destinations');
  const big = validateBroadcast({ resolution: '720p', bitrate: 4, destinations: [ig], vertical: { resolution: '1080p', bitrate: 7 } });
  assert.deepEqual(groupsFor(big).map(g => g.id + ' ' + g.size + ' ' + g.bitrate), ['v 1080:1920 7'], 'only Instagram: no 16:9 encode at all');
  // O operador pode mudar o formato de um destino (ex.: servidor próprio vertical).
  const custom = validateBroadcast({ resolution: '720p', bitrate: 4, destinations: [{ platform: 'custom', server: 'rtmp://10.0.0.5/live', key: 'vert', aspect: '9:16' }, { ...yt, aspect: 'banana' }] });
  assert.deepEqual(custom.destinations.map(d => d.aspect), ['9:16', '16:9']);
  // Gravação: 16:9, 9:16 ou os dois arquivos.
  const rec = f => groupsFor(validateBroadcast({ resolution: '720p', bitrate: 4, record: { dir: os.tmpdir(), formats: f } })).map(g => g.id + ':' + path.basename(g.record.file).replace(/\d/g, '#'));
  assert.deepEqual(rec('16:9'), ['h:Andromeda_####-##-##-##-##-##_##x#.mkv']);
  assert.deepEqual(rec('9:16'), ['v:Andromeda_####-##-##-##-##-##_#x##.mkv']);
  assert.deepEqual(rec('both'), ['h:Andromeda_####-##-##-##-##-##_##x#.mkv', 'v:Andromeda_####-##-##-##-##-##_#x##.mkv']);
  assert.deepEqual(rec(undefined).map(x => x[0]), ['h'], 'an older client without the field keeps its single 16:9 output');
  assert.throws(() => validateBroadcast({ resolution: '720p', bitrate: 4, destinations: [ig], vertical: { bitrate: 30 } }), /vertical/);
});

const exe = findFFmpeg();
const listener = (port, key, file) => spawn(exe, ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:' + port + '/live/' + key, '-c', 'copy', '-y', file], { stdio: 'ignore' });
function clip(file, size, seconds, rate = 30) { const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=' + size + ':rate=' + rate, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '400k', '-c:a', 'libopus', '-y', file], { timeout: 40000 }); assert.equal(r.status, 0); }
// Como o navegador: cada pedaço leva 1 byte de canal (0 = 16:9, 1 = 9:16), em tempo real.
function feed(ws, channel, bytes, seconds) { const step = Math.ceil(bytes.length / (seconds * 10)); let offset = 0; const timer = setInterval(() => { if (offset >= bytes.length || ws.readyState !== WebSocket.OPEN) { clearInterval(timer); return; } ws.send(Buffer.concat([Buffer.from([channel]), bytes.subarray(offset, offset += step)])); }, 100); return timer; }
const dims = file => { const p = spawnSync(exe, ['-hide_banner', '-i', file], { encoding: 'utf8' }); const m = /Video: h264[^\n]*?, (\d+)x(\d+)/.exec(p.stderr); return m ? m[1] + 'x' + m[2] : p.stderr.slice(-300); };

async function session(t, port, run) {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-aspect-')), audit = createAudit({ write: false }), bridge = createBridge({ port, ffmpeg: exe, audit });
  bridge.listen(); await once(bridge.server, 'listening');
  const timers = [], procs = []; let ws;
  try {
    const s = await (await fetch('http://localhost:' + port + '/api/session')).json();
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + s.token, { origin: 'http://localhost:' + port }); await once(ws, 'open');
    await run({ dir, ws, audit, timers, procs });
  } finally { timers.forEach(clearInterval); ws?.terminate(); procs.forEach(p => p.kill('SIGKILL')); bridge.shutdown(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ } }
}
function collect(ws, onMessage, ms = 70000) {
  const seen = [];
  return { seen, done: new Promise((resolve, reject) => { const to = setTimeout(() => reject(Error('Timed out: ' + JSON.stringify(seen.map(m => m.type + (m.state ? ':' + m.state : ''))))), ms); ws.on('message', raw => { const m = JSON.parse(raw); seen.push(m); onMessage(m); if (m.type === 'stopped') { clearTimeout(to); resolve(); } }); ws.on('error', reject); }) };
}

test('real run: 16:9 and 9:16 go out together, each to its own platform, and both are recorded', async t => session(t, 3186, async ({ dir, ws, audit, timers, procs }) => {
  const h = path.join(dir, 'h.webm'), v = path.join(dir, 'v.webm'), outH = path.join(dir, 'youtube.flv'), outV = path.join(dir, 'instagram.flv'), recDir = path.join(dir, 'gravações');
  clip(h, '320x180', 14); clip(v, '180x320', 14);
  procs.push(listener(19421, 'keyH1111', outH), listener(19422, 'keyV2222', outV)); await new Promise(r => setTimeout(r, 700));
  let stopSent = false;
  const { seen, done } = collect(ws, m => {
    if (m.type === 'ready') { assert.deepEqual(m.groups, ['h', 'v']); timers.push(feed(ws, 0, fs.readFileSync(h), 14), feed(ws, 1, fs.readFileSync(v), 14)); }
    if (m.type === 'sending' && !stopSent && m.frames > 150) { stopSent = true; setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 1500); }
  });
  ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, channels: 2, vertical: { resolution: '720p', bitrate: 3 },
    destinations: [{ id: 'h', platform: 'custom', name: 'Horizontal', server: 'rtmp://127.0.0.1:19421/live', key: 'keyH1111', aspect: '16:9' }, { id: 'v', platform: 'custom', name: 'Vertical', server: 'rtmp://127.0.0.1:19422/live', key: 'keyV2222', aspect: '9:16' }],
    record: { dir: recDir, formats: 'both' } }));
  await done;
  assert(!seen.some(m => m.type === 'error' || m.state === 'error'), JSON.stringify(seen.filter(m => m.type === 'error' || m.state === 'error')));
  assert(!seen.some(m => m.type === 'notice' && /poucos quadros/.test(m.message)), 'a full 30 frames/s signal never triggers the missing-frames warning');
  assert.equal(dims(outH), '1280x720', 'the 16:9 platform receives 16:9');
  assert.equal(dims(outV), '720x1280', 'the 9:16 platform receives 9:16');
  const recorded = seen.filter(m => m.type === 'recorded').map(m => m.file).sort();
  assert.equal(recorded.length, 2, JSON.stringify(recorded));
  assert.deepEqual(recorded.map(f => dims(f)).sort(), ['1280x720', '720x1280']);
  assert(recorded.some(f => f.endsWith('_9x16.mp4')) && recorded.some(f => f.endsWith('_16x9.mp4')), 'file names say the format');
  const log = audit.export(); assert(!log.includes('keyH1111') && !log.includes('keyV2222'), 'no keys in the audit');
  assert(audit.since(0).some(e => e.code === 'inicio' && /16:9 e 9:16/.test(e.message)));
}));

test('real run: record only, both formats — two MP4 files, 16:9 and 9:16, same length, with audio', async t => session(t, 3188, async ({ dir, ws, audit, timers }) => {
  const h = path.join(dir, 'h.webm'), v = path.join(dir, 'v.webm'), recDir = path.join(dir, 'gravações');
  clip(h, '320x180', 12, 15); clip(v, '180x320', 12, 15); // como um computador sobrecarregado: só 15 quadros/s chegam
  let stopSent = false;
  const { seen, done } = collect(ws, m => {
    if (m.type === 'ready') { assert.deepEqual(m.groups, ['h', 'v']); timers.push(feed(ws, 0, fs.readFileSync(h), 12), feed(ws, 1, fs.readFileSync(v), 12)); }
    if (m.type === 'sending' && !stopSent && m.frames > 150) { stopSent = true; setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 1500); }
  });
  // Como a mesa manda em "Só gravar" com o padrão da 0.18: sem destinos, gravação nos dois formatos.
  ws.send(JSON.stringify({ type: 'start', resolution: '1080p', bitrate: 4, channels: 2, vertical: { resolution: '1080p', bitrate: 4 }, destinations: [], record: { dir: recDir, formats: 'both' } }));
  await done;
  assert(!seen.some(m => m.type === 'error'), JSON.stringify(seen.filter(m => m.type === 'error')));
  // Com só metade dos quadros chegando, a mesa avisa o operador (uma vez por formato) e o arquivo continua íntegro.
  const notices = seen.filter(m => m.type === 'notice').map(m => m.message);
  assert(notices.some(n => /poucos quadros para a saída 16:9/.test(n)) && notices.some(n => /poucos quadros para a saída 9:16/.test(n)), JSON.stringify(notices));
  assert.equal(notices.length, 2, 'warned once per format, not every second');
  assert.deepEqual(seen.filter(m => m.type === 'recording').map(m => m.format), ['16:9', '9:16'], 'the desk is told both files are being recorded');
  const files = seen.filter(m => m.type === 'recorded');
  assert.deepEqual(files.map(m => m.format), ['16:9', '9:16']);
  assert.deepEqual(files.map(m => dims(m.file)), ['1920x1080', '1080x1920']);
  assert(files[0].file.endsWith('_16x9.mp4') && files[1].file.endsWith('_9x16.mp4'));
  const probe = f => spawnSync(exe, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr, secs = f => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe(f)); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
  for (const f of files) assert(/Audio: aac/.test(probe(f.file)), 'audio in ' + f.format);
  assert(secs(files[0].file) > 4 && Math.abs(secs(files[0].file) - secs(files[1].file)) < 1.5, 'both files cover the same time: ' + files.map(f => secs(f.file)));
  assert.deepEqual(fs.readdirSync(recDir).filter(n => n.endsWith('.mkv')), [], 'no MKV left behind');
  // Vídeo e áudio com a mesma duração, a 30 quadros/s constantes: sem dessincronizar mesmo com quadros faltando na entrada.
  const track = (f, sel) => +spawnSync(exe.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), ['-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration,avg_frame_rate', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().split(',').at(-1);
  const hasProbe = spawnSync(exe.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), ['-version']).status === 0;
  if (hasProbe) for (const f of files) { const vd = track(f.file, 'v:0'), ad = track(f.file, 'a:0'); assert(Math.abs(vd - ad) < 0.5, f.format + ': video ' + vd + ' s vs audio ' + ad + ' s'); }
  assert.deepEqual(audit.since(0).filter(e => e.code === 'arquivo').map(e => e.data.formato), ['16:9', '9:16']);
}));

test('if the 9:16 output fails, the 16:9 output stays on air', async t => session(t, 3187, async ({ dir, ws, timers, procs }) => {
  const h = path.join(dir, 'h.webm'), outH = path.join(dir, 'youtube.flv');
  clip(h, '320x180', 14);
  procs.push(listener(19431, 'keyH3333', outH)); await new Promise(r => setTimeout(r, 700));
  let stopSent = false;
  const { seen, done } = collect(ws, m => {
    // O canal vertical recebe lixo: o FFmpeg 9:16 não consegue ler e encerra.
    if (m.type === 'ready') { timers.push(feed(ws, 0, fs.readFileSync(h), 14), feed(ws, 1, Buffer.alloc(400000, 7), 4)); }
    if (m.type === 'sending' && !stopSent && m.frames > 200 && seen.some(x => x.type === 'destination' && x.id === 'v' && x.state === 'error')) { stopSent = true; ws.send(JSON.stringify({ type: 'stop' })); }
  });
  ws.send(JSON.stringify({ type: 'start', resolution: '720p', bitrate: 3, channels: 2,
    destinations: [{ id: 'h', platform: 'custom', name: 'Horizontal', server: 'rtmp://127.0.0.1:19431/live', key: 'keyH3333', aspect: '16:9' }, { id: 'v', platform: 'custom', name: 'Vertical', server: 'rtmp://127.0.0.1:19432/live', key: 'keyV4444', aspect: '9:16' }] }));
  await done;
  assert(seen.some(m => m.type === 'destination' && m.id === 'v' && m.state === 'error'), 'the vertical platform is marked as failed');
  assert(!seen.some(m => m.type === 'error'), 'the session itself did not fail');
  assert(seen.filter(m => m.type === 'sending').at(-1).frames > 200, '16:9 kept sending');
  assert.equal(dims(outH), '1280x720');
}));
