'use strict';
// A plataforma (ou a rede) trava por alguns segundos no meio da live: a fila de cada destino precisa segurar esse tempo sem
// descartar pacotes. Descarte no meio do GOP perde um quadro-chave (intervalo de 4 s, fora da diretriz de 2 s) e corrompe a
// imagem até o próximo. Medido no CI: fila de 80 pacotes (~1 s) perdeu ~60 quadros numa trava de ~3,5 s.
const { test } = require('node:test'), assert = require('node:assert/strict'), net = require('node:net');
const { spawn, spawnSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validateBroadcast, argsForBroadcast, findFFmpeg } = require('../encoder.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('destino que trava 3,5 s não perde quadros nem quadro-chave (fila de cada destino)', { timeout: 60000 }, async t => {
  const ffmpeg = findFFmpeg(); if (!ffmpeg) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-fifo-')), file = path.join(dir, 'rec.mkv'), recvPort = 19461, proxyPort = 19462;
  const receiver = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:' + recvPort + '/live/test-stream-key-123', '-c', 'copy', file], { stdio: 'ignore' });
  const receiverDone = new Promise(r => receiver.once('exit', r));
  // "Plataforma" atrás de um repasse TCP que para de ler por 3,5 s (funciona igual no Windows e no Linux).
  let client = null;
  const proxy = net.createServer(c => { client = c; const up = net.connect(recvPort, '127.0.0.1'); c.pipe(up); up.pipe(c); c.on('error', () => up.destroy()); up.on('error', () => c.destroy()); });
  await new Promise(r => proxy.listen(proxyPort, '127.0.0.1', r)); await wait(700);
  const cfg = validateBroadcast({ destinations: [{ platform: 'custom', server: 'rtmp://127.0.0.1:' + proxyPort + '/live', key: 'test-stream-key-123' }], resolution: '1080p', bitrate: 6 });
  const tee = argsForBroadcast(cfg).slice(-5); assert.deepEqual(tee.slice(0, 3), ['-flags', '+global_header', '-f']);
  const sender = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30', '-f', 'lavfi', '-i', 'sine=r=48000', '-t', '12',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-map', '0:v', '-map', '1:a', ...tee], { stdio: 'ignore' });
  const senderDone = new Promise(r => sender.once('exit', r));
  try {
    await wait(3500); assert(client, 'destino conectado'); client.pause(); await wait(3500); client.resume();
    await senderDone; await Promise.race([receiverDone, wait(3000)]); receiver.kill(); await receiverDone;
    const frames = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 8 << 20 }).stdout.split('\n').filter(l => l && !l.startsWith('#')).length;
    const keys = [...(spawnSync(ffmpeg, ['-v', 'info', '-skip_frame', 'nokey', '-i', file, '-map', '0:v', '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '').matchAll(/pts_time:([0-9.]+)/g)].map(m => Number(m[1]));
    const gap = Math.max(...keys.slice(1).map((k, i) => k - keys[i]));
    assert(frames >= 358, 'todos os quadros chegaram depois da trava (' + frames + ' de 360)');
    assert(gap <= 2.1, 'quadro-chave a cada 2 s mesmo com a trava (máx. ' + gap + ' s)');
  } finally { sender.kill(); receiver.kill(); proxy.close(); client?.destroy(); fs.rmSync(dir, { recursive: true, force: true }); }
});
