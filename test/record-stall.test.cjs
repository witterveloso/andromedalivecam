'use strict';
// Gravar e transmitir ao mesmo tempo: se o disco da gravação engasgar (HD externo, antivírus, disco lento), a live NÃO pode
// parar. Gravação Andrômeda: a gravação é uma saída do distribuidor (como um destino), com fila própria de minutos; o
// codificador nunca escreve no disco.
// Aqui o "disco" é um pipe que para de ler por 3,5 s no meio do envio; medimos o maior buraco na chegada à "plataforma".
const { test } = require('node:test'), assert = require('node:assert/strict'), net = require('node:net');
const { spawn, spawnSync, execFileSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validateBroadcast, argsForBroadcast, groupsFor, findFFmpeg } = require('../encoder.cjs');
const { createOutputs } = require('../saidas.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('disco da gravação travado 3,5 s não trava a transmissão, e a gravação fica completa', { timeout: 60000, skip: process.platform === 'win32' ? 'pipe nomeado (mkfifo) só no Linux/macOS' : false }, async t => {
  const ffmpeg = findFFmpeg(); if (!ffmpeg) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-rec-')), pipe = path.join(dir, 'disco_16x9.mkv'), out = path.join(dir, 'gravado.mkv');
  execFileSync('mkfifo', [pipe]);
  // "Disco": lê o pipe e grava no arquivo; parar este processo = disco engasgado.
  const outFd = fs.openSync(out, 'w'), disk = spawn('cat', [pipe], { stdio: ['ignore', outFd, 'ignore'] }), diskDone = new Promise(r => disk.once('exit', r));
  const recvPort = 19471, proxyPort = 19472;
  const receiver = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:' + recvPort + '/live/test-stream-key-123', '-c', 'copy', '-f', 'null', '-'], { stdio: 'ignore' });
  const receiverDone = new Promise(r => receiver.once('exit', r));
  // "Plataforma" atrás de um repasse que anota quando cada pedaço de vídeo chega.
  const arrivals = [];
  const socks = new Set();
  const proxy = net.createServer(c => { const up = net.connect(recvPort, '127.0.0.1'); socks.add(c); socks.add(up); c.on('data', d => { arrivals.push(Date.now()); up.write(d); }); up.pipe(c); c.on('error', () => up.destroy()); up.on('error', () => c.destroy()); });
  await new Promise(r => proxy.listen(proxyPort, '127.0.0.1', r)); await wait(700);
  const cfg = validateBroadcast({ destinations: [{ platform: 'custom', server: 'rtmp://127.0.0.1:' + proxyPort + '/live', key: 'test-stream-key-123' }], record: { dir, formats: '16:9' }, resolution: '1080p', bitrate: 6 });
  const tee = argsForBroadcast(cfg).slice(-5); assert.match(tee[4], /pipe:1/); assert.doesNotMatch(tee[4], /\.mkv/, 'o codificador não grava: só alimenta o distribuidor');
  // O destino sai pelo distribuidor (saidas.cjs), alimentado pela saída do codificador, como no programa.
  const g = groupsFor(cfg)[0], outputs = createOutputs({ ffmpeg, spawnProcess: spawn });
  outputs.group(g.id, { size: g.size }); outputs.add(cfg.destinations[0], g.id); outputs.start(cfg.destinations[0].id);
  // Gravador como na sessão real (publish.cjs): fila grande e vigia tolerante; o "disco" é o pipe.
  outputs.add({ id: '__rec_h', name: 'Gravação 16:9', protocol: 'derive', internal: true, limit: 256 * 1024 * 1024, stallMs: 45000,
    args: ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-nostats', '-f', 'flv', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-progress', 'pipe:3', '-stats_period', '1', '-flush_packets', '1', '-f', 'matroska', '-y', pipe] }, g.id);
  outputs.start('__rec_h');
  const sender = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=r=48000', '-t', '10',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6M', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-map', '0:v', '-map', '1:a', ...tee], { stdio: ['ignore', 'pipe', 'ignore'] });
  sender.stdout.on('data', d => outputs.feed(g.id, d));
  const senderDone = new Promise(r => sender.once('exit', r));
  let stallFrom = 0, stallTo = 0;
  try {
    await wait(3000); stallFrom = Date.now(); disk.kill('SIGSTOP'); await wait(3500); disk.kill('SIGCONT'); stallTo = Date.now();
    await Promise.race([senderDone, wait(20000)]); outputs.endGroup(g.id); await Promise.race([diskDone, wait(5000)]); await Promise.race([receiverDone, wait(5000)]);
    // Maior buraco na chegada à plataforma durante a trava do disco.
    const during = arrivals.filter(a => a >= stallFrom - 500 && a <= stallTo + 500);
    let gap = 0; for (let i = 1; i < during.length; i++) gap = Math.max(gap, during[i] - during[i - 1]);
    if (!during.length) gap = stallTo - stallFrom;
    assert(gap < 1000, 'a transmissão continuou chegando enquanto o disco travava (maior buraco ' + gap + ' ms)');
    const frames = spawnSync(ffmpeg, ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 8 << 20 }).stdout.split('\n').filter(l => l && !l.startsWith('#')).length;
    assert(frames >= 298, 'a gravação ficou completa depois da trava (' + frames + ' de 300 quadros)');
  } finally { outputs.close(); sender.kill(); receiver.kill(); disk.kill('SIGCONT'); disk.kill(); for (const k of socks) k.destroy(); proxy.close(); try { fs.closeSync(outFd); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
});
