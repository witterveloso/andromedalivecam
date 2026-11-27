'use strict';
// Tecnologia Andrômeda Multiplataforma: a mesa manda UMA imagem (16:9) e o serviço entrega a várias plataformas ao mesmo tempo,
// inclusive DUAS CONTAS da mesma plataforma, cria o 9:16 na hora (Instagram entrando no meio da live), muda o enquadramento
// vertical ao vivo e grava 16:9 e 9:16 junto. Tudo com FFmpeg real e "plataformas" RTMP locais.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process'); const { WebSocket } = require('ws');
const { createBridge } = require('../server.cjs'); const { createAudit } = require('../audit.cjs'); const { findFFmpeg } = require('../encoder.cjs');
const exe = findFFmpeg();
const listener = (port, key, file) => spawn(exe, ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:' + port + '/live/' + key, '-c', 'copy', '-y', file], { stdio: 'ignore' });
const clip = (file, seconds) => { const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '600k', '-c:a', 'libopus', '-y', file], { timeout: 60000 }); assert.equal(r.status, 0); };
const feed = (ws, bytes, seconds) => { const step = Math.ceil(bytes.length / (seconds * 10)); let offset = 0; const timer = setInterval(() => { if (offset >= bytes.length || ws.readyState !== WebSocket.OPEN) { clearInterval(timer); return; } ws.send(bytes.subarray(offset, offset += step)); }, 100); return timer; };
const probe = file => { const r = spawnSync(exe, ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 32 << 20 }); const size = (spawnSync(exe, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr.match(/Video: h264[^\n]*?(\d{3,4})x(\d{3,4})/) || []).slice(1).join('x'); return { frames: r.stdout.split('\n').filter(l => l && !l.startsWith('#')).length, size }; };

test('uma imagem na mesa → YouTube em 2 contas + Instagram (9:16 criado no serviço, no meio da live) + gravação 16:9 e 9:16', { timeout: 150000, skip: !exe && 'FFmpeg ausente' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-multi-')), rec = path.join(dir, 'rec'), src = path.join(dir, 'pgm.webm');
  const files = { yt1: path.join(dir, 'yt1.flv'), yt2: path.join(dir, 'yt2.flv'), ig: path.join(dir, 'ig.flv') };
  clip(src, 20);
  const rx = [listener(19521, 'conta-1-abcd', files.yt1), listener(19522, 'conta-2-efgh', files.yt2), listener(19523, 'insta-ijkl', files.ig)];
  await new Promise(r => setTimeout(r, 800));
  const audit = createAudit({ write: false }), port = 3186, bridge = createBridge({ port, ffmpeg: exe, audit }); bridge.listen(); await once(bridge.server, 'listening');
  let ws, timer;
  try {
    const session = await (await fetch('http://localhost:' + port + '/api/session')).json(); assert.equal(session.derive, true, 'o serviço oferece o 9:16 criado no serviço');
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + session.token, { origin: 'http://localhost:' + port });
    const seen = []; let step = 0;
    const yt = (id, p, key) => ({ id, platform: 'custom', name: id, server: 'rtmp://127.0.0.1:' + p + '/live', key, aspect: '16:9' });
    const done = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(Error('tempo esgotado: ' + JSON.stringify(seen.filter(m => m.type !== 'ack' && m.type !== 'outputs').map(m => m.type + ':' + (m.id || '') + ':' + (m.state || '')).slice(-30)))), 120000);
      ws.on('message', raw => {
        const m = JSON.parse(raw); seen.push(m);
        if (m.type === 'ready') timer = feed(ws, fs.readFileSync(src), 20);
        if (m.type === 'sending') {
          // ~3 s: segunda conta do YouTube e o Instagram (9:16) entram no meio da live
          if (step === 0 && m.frames > 90) { step = 1; ws.send(JSON.stringify({ type: 'output', id: 'yt2', action: 'start', destination: { ...yt('yt2', 19522, 'conta-2-efgh'), on: true } })); ws.send(JSON.stringify({ type: 'output', id: 'ig', action: 'start', destination: { id: 'ig', platform: 'custom', name: 'Instagram', server: 'rtmp://127.0.0.1:19523/live', key: 'insta-ijkl', aspect: '9:16', on: true } })); }
          // ~9 s: o operador arrasta o recorte vertical
          if (step === 1 && m.frames > 270) { step = 2; ws.send(JSON.stringify({ type: 'vertical', vertical: { mode: 'crop', pos: 0.1 } })); }
          if (step === 2 && m.frames > 480) { step = 3; ws.send(JSON.stringify({ type: 'stop' })); }
        }
        if (m.type === 'stopped') { clearTimeout(to); resolve(); }
      });
      ws.on('error', reject);
    });
    await once(ws, 'open');
    // A live começa só com o YouTube (conta 1): nenhum 9:16 rodando. Gravação dos dois formatos.
    ws.send(JSON.stringify({ type: 'start', resolution: '1080p', bitrate: 6, derive: true, channels: 1, vertical: { resolution: '1080p', bitrate: 6, mode: 'crop', pos: 0.5 }, destinations: [yt('yt1', 19521, 'conta-1-abcd')], record: { dir: rec, formats: 'both' } }));
    await done;
    await Promise.race([Promise.all(rx.map(r => once(r, 'exit'))), new Promise(r => setTimeout(r, 8000))]);
    assert(!seen.some(m => m.type === 'error'), JSON.stringify(seen.filter(m => m.type === 'error')));
    for (const id of ['yt1', 'yt2', 'ig']) assert(seen.some(m => m.type === 'destination' && m.id === id && m.state === 'sending'), id + ' no ar');
    const a = probe(files.yt1), b = probe(files.yt2), c = probe(files.ig);
    assert.equal(a.size, '1920x1080'); assert(a.frames > 400, 'YouTube conta 1 recebeu a live inteira (' + a.frames + ')');
    assert.equal(b.size, '1920x1080'); assert(b.frames > 250, 'YouTube conta 2 (mesma plataforma, outra conta) entrou no meio (' + b.frames + ')');
    assert.equal(c.size, '1080x1920', 'Instagram recebeu o 9:16 criado no serviço'); assert(c.frames > 150, 'Instagram no ar (' + c.frames + ')');
    const recs = fs.readdirSync(rec).filter(f => f.endsWith('.mp4')).sort();
    assert(recs.some(f => /_16x9\.mp4$/.test(f)), 'gravação 16:9: ' + recs.join(', ')); assert.equal(recs.filter(f => /_9x16/.test(f)).length, 1, 'gravação 9:16 num arquivo só, mesmo com o enquadramento mudando: ' + recs.join(', '));
    const v = probe(path.join(rec, recs.find(f => /_9x16\.mp4$/.test(f)))); assert.equal(v.size, '1080x1920'); assert(v.frames > 330, 'gravação 9:16 contínua (' + v.frames + ' quadros)');
    // Enquadramento 9:16 mudado ao vivo: o Instagram continua na MESMA conexão (sem cair e voltar).
    const igEvents = seen.filter(m => m.type === 'destination' && m.id === 'ig').map(m => m.state);
    assert.deepEqual(igEvents.filter((s, i) => (i === 0 || s !== igEvents[i - 1]) && s !== 'off'), ['connecting', 'sending'], 'Instagram sem reconexão (só o fim da live no final): ' + igEvents.join(' '));
    assert(c.frames > 330, 'Instagram recebeu a live sem buraco grande depois do novo enquadramento (' + c.frames + ' quadros)');
    const codes = audit.since(0).map(e => e.code); for (const c2 of ['vertical-servico', 'vertical-enquadramento']) assert(codes.includes(c2), c2 + ' em ' + codes.join(','));
  } finally { clearInterval(timer); ws?.terminate(); for (const r of rx) r.kill('SIGKILL'); bridge.shutdown(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ } }
});

// O caso do diagnóstico real: live começou só com o Instagram (9:16) e o YouTube (16:9) não entrava no meio. E o contrário:
// live só com YouTube e o Instagram ligando no meio, sem nenhum 9:16 rodando antes.
for (const [first, later] of [['ig', 'yt'], ['yt', 'ig']]) test('formato ligado no meio da live: começa com ' + (first === 'ig' ? 'Instagram (9:16), YouTube entra depois' : 'YouTube (16:9), Instagram entra depois'), { timeout: 120000, skip: !exe && 'FFmpeg ausente' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-meio-')), src = path.join(dir, 'pgm.webm'), port = first === 'ig' ? 3187 : 3188, base = first === 'ig' ? 19531 : 19541;
  const files = { yt: path.join(dir, 'yt.flv'), ig: path.join(dir, 'ig.flv') };
  clip(src, 14);
  const rx = [listener(base, 'yt-key-0001', files.yt), listener(base + 1, 'ig-key-0002', files.ig)]; await new Promise(r => setTimeout(r, 800));
  const dest = { yt: { id: 'yt', platform: 'custom', name: 'YouTube', server: 'rtmp://127.0.0.1:' + base + '/live', key: 'yt-key-0001', aspect: '16:9' }, ig: { id: 'ig', platform: 'custom', name: 'Instagram', server: 'rtmp://127.0.0.1:' + (base + 1) + '/live', key: 'ig-key-0002', aspect: '9:16' } };
  const bridge = createBridge({ port, ffmpeg: exe, audit: createAudit({ write: false }) }); bridge.listen(); await once(bridge.server, 'listening');
  let ws, timer;
  try {
    const session = await (await fetch('http://localhost:' + port + '/api/session')).json();
    ws = new WebSocket('ws://localhost:' + port + '/publish', 'andromeda.' + session.token, { origin: 'http://localhost:' + port });
    const seen = []; let step = 0;
    const done = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(Error('tempo esgotado')), 100000);
      ws.on('message', raw => { const m = JSON.parse(raw); seen.push(m);
        if (m.type === 'ready') timer = feed(ws, fs.readFileSync(src), 14);
        if (m.type === 'sending' && step === 0 && m.frames > 90) { step = 1; ws.send(JSON.stringify({ type: 'output', id: later, action: 'start', destination: { ...dest[later], on: true } })); }
        if (m.type === 'sending' && step === 1 && m.frames > 330) { step = 2; ws.send(JSON.stringify({ type: 'stop' })); }
        if (m.type === 'stopped') { clearTimeout(to); resolve(); } });
      ws.on('error', reject);
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'start', resolution: '1080p', bitrate: 6, derive: true, channels: 1, vertical: { resolution: '1080p', bitrate: 6, mode: 'blur' }, destinations: [{ ...dest[first], on: true }], record: null }));
    await done; await Promise.race([Promise.all(rx.map(r => once(r, 'exit'))), new Promise(r => setTimeout(r, 8000))]);
    assert(!seen.some(m => m.type === 'destination' && m.state === 'error'), JSON.stringify(seen.filter(m => m.state === 'error')));
    const y = probe(files.yt), i = probe(files.ig);
    assert.equal(y.size, '1920x1080'); assert.equal(i.size, '1080x1920');
    assert(y.frames > 150 && i.frames > 150, 'as duas plataformas no ar (YouTube ' + y.frames + ', Instagram ' + i.frames + ')');
  } finally { clearInterval(timer); ws?.terminate(); for (const r of rx) r.kill('SIGKILL'); bridge.shutdown(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ } }
});

test('9:16 com o quadro inteiro: 16:9 dentro da área que aparece em qualquer celular e fundo desfocado só de cor (sem manchas)', () => {
  const { verticalFilter } = require('../encoder.cjs');
  const blur = verticalFilter({ mode: 'blur' }), bars = verticalFilter({ mode: 'bars' });
  assert.match(blur, /\[b\]scale=864:-2/); assert.match(blur, /overlay=\(W-w\)\/2:\(H-h\)\/2/); assert.match(blur, /scale=4:7:flags=area/); assert.match(blur, /boxblur=/);
  assert.doesNotMatch(blur, /scale=36:64/, 'miniatura 36×64 deixava manchas brancas de letras e relógio');
  assert.match(bars, /scale=864:-2/); assert.match(bars, /pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2/);
  assert.match(verticalFilter({ mode: 'crop', pos: 0.5 }), /crop=trunc\(ih\*1080\/1920\/2\)\*2:ih/, 'recorte continua ocupando a tela toda');
});
