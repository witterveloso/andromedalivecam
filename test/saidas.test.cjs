'use strict';
// Saídas Andrômeda: cada destino liga, desliga e reconecta sozinho, com a live no ar, sem tocar nos outros.
// Tudo com FFmpeg de verdade: o "codificador" usa a mesma saída do programa (tee → MPEG-TS para o distribuidor) e as
// "plataformas" são servidores RTMP e SRT locais que gravam o que receberam.
const { test } = require('node:test'), assert = require('node:assert/strict'), net = require('node:net');
const { spawn, spawnSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validateBroadcast, argsForGroup, groupsFor, findFFmpeg } = require('../encoder.cjs');
const { createOutputs, outputArgs, reasonOf, _internal: { scan, createFeed, header } } = require('../saidas.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const ffmpeg = findFFmpeg();
const hasSrt = ffmpeg && /\bsrt\b/.test(spawnSync(ffmpeg, ['-hide_banner', '-protocols'], { encoding: 'utf8' }).stdout || '');

// Codificador do programa: 1080p30, quadro-chave a cada 2 s, AAC 48 kHz, saída igual à do Andrômeda Live (tee → distribuidor).
function encoder(seconds, cfg) {
  const tail = argsForGroup(cfg, groupsFor(cfg)[0]).slice(-5);
  assert.deepEqual(tail.slice(0, 4), ['-flags', '+global_header', '-f', 'tee']);
  return spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=r=48000', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-map', '0:v', '-map', '1:a', ...tail], { stdio: ['ignore', 'pipe', 'ignore'] });
}
const rtmpServer = (port, file) => spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:' + port + '/live/chave-teste-123', '-c', 'copy', file], { stdio: 'ignore' });
// Espera um evento (no Windows, conexões recusadas e encerramentos demoram alguns segundos a mais).
const until = async (cond, ms) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await wait(100); return cond(); };
const exited = child => new Promise(r => { if (child.exitCode != null || child.signalCode != null) r(); else child.once('exit', r); });
// Leitor para conferir o que o servidor SRT recebeu (MPEG-TS). O FFmpeg empacotado falha ao LER MPEG-TS em alguns processadores
// (gerar funciona, e é só isso que o Andrômeda Live faz no SRT); a conferência usa o primeiro FFmpeg que lê MPEG-TS nesta máquina.
const tsReader = (() => {
  if (!ffmpeg) return null;
  const sample = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x120:r=30', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mpegts', 'pipe:1'], { maxBuffer: 8 << 20 }).stdout;
  return [process.env.FFMPEG_READER, ffmpeg, '/usr/bin/ffmpeg', 'ffmpeg'].filter(Boolean).find(exe => { try { return spawnSync(exe, ['-v', 'error', '-f', 'mpegts', '-i', 'pipe:0', '-f', 'null', '-'], { input: sample, timeout: 10000 }).status === 0; } catch { return false; } }) || null;
})();
// Quadros decodificados e erros de decodificação de um arquivo recebido.
function inspect(file, exe = ffmpeg) {
  if (!fs.existsSync(file)) return { frames: 0, errors: 'sem arquivo', firstKey: false, keyGap: Infinity };
  const dec = spawnSync(exe, ['-v', 'error', '-i', file, '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 32 << 20 });
  const frames = dec.stdout.split('\n').filter(l => l && !l.startsWith('#')).length;
  const probe = spawnSync(exe, ['-v', 'info', '-i', file, '-map', '0:v', '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 32 << 20 }).stderr || '';
  const lines = [...probe.matchAll(/n:\s*(\d+).*?pts_time:([0-9.]+).*?iskey:(\d)/g)].map(m => ({ n: +m[1], t: +m[2], key: m[3] === '1' }));
  const keys = lines.filter(l => l.key).map(l => l.t);
  return { frames, errors: dec.stderr.trim(), firstKey: !!lines[0]?.key, keyGap: keys.length > 1 ? Math.max(...keys.slice(1).map((k, i) => k - keys[i])) : 0 };
}
function hub(events) {
  return createOutputs({ ffmpeg, spawnProcess: spawn, send: m => { if (m.type === 'destination') events.push(m.id + ':' + m.state); }, tickMs: 250 });
}
const dest = (id, port, extra = {}) => ({ id, platform: 'custom', name: 'Destino ' + id, server: 'rtmp://127.0.0.1:' + port + '/live', key: 'chave-teste-123', ...extra });

test('leitura do FLV interno: guarda as configurações e acha cada quadro-chave, com pedaços de qualquer tamanho', { skip: !ffmpeg && 'FFmpeg ausente' }, () => {
  const flv = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-f', 'lavfi', '-i', 'sine', '-t', '6', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-c:a', 'aac', '-flags', '+global_header', '-f', 'tee', '[f=flv:flvflags=no_duration_filesize:flush_packets=1:onfail=abort]pipe:1'], { maxBuffer: 64 << 20 }).stdout;
  const feed = createFeed(); let firsts = 0, total = 0;
  for (let i = 0; i < flv.length;) { const n = 1 + ((i * 7919) % 5000); const r = scan(feed, flv.subarray(i, i + n)); total += r.data.length; if (r.firstKey >= 0) firsts++; i += n; }
  assert(feed.head && feed.avc && feed.aac, 'assinatura e configurações de vídeo e som guardadas');
  assert.equal(feed.keys, 6, 'um quadro-chave por segundo em 6 s'); assert.equal(firsts, 6);
  assert.equal(total + 13, flv.length, 'repassa todas as etiquetas, sem perder bytes');
  assert(feed.cacheOk && feed.cache[0][0] === 9 && feed.cache[0][11] >> 4 === 1, 'cache começa na etiqueta do quadro-chave');
  // Quem entra no meio recebe cabeçalhos + GOP: um FLV válido que decodifica desde o primeiro quadro.
  const join = Buffer.concat([...header(feed), ...feed.cache]);
  const dec = spawnSync(ffmpeg, ['-v', 'error', '-f', 'flv', '-i', 'pipe:0', '-f', 'null', '-'], { input: join, encoding: 'utf8' });
  assert.equal(dec.status, 0); assert.equal(dec.stderr.trim(), '');
});

test('argumentos: só copia (sem nova codificação), RTMP com marca e versão, SRT em MPEG-TS', () => {
  const [r, s] = validateBroadcast({ destinations: [dest('a', 1935), { platform: 'srt', name: 'Servidor', server: 'srt://10.0.0.5:9000', key: 'live/abc', passphrase: 'senha-segura-123' }], resolution: '1080p', bitrate: 6 }).destinations;
  const ra = outputArgs(r), sa = outputArgs(s);
  for (const a of [ra, sa]) { assert(a.includes('copy')); assert(!a.includes('libx264')); assert.equal(a[a.indexOf('-i') + 1], 'pipe:0'); }
  assert.equal(ra[ra.lastIndexOf('-f') + 1], 'flv'); assert(ra.includes('-rtmp_flashver'));
  assert.equal(sa[sa.lastIndexOf('-f') + 1], 'mpegts'); assert.match(sa.at(-1), /^srt:\/\/10\.0\.0\.5:9000\?mode=caller&transtype=live&latency=2000000&pkt_size=1316&streamid=live%2Fabc&passphrase=senha-segura-123&pbkeylen=16$/);
  assert.equal(reasonOf('Connection refused'), 'conexão recusada');
  assert.match(reasonOf('[rtmp] Server error: NetStream.Publish.BadName'), /recusado pelo servidor/);
});

test('destino liga no meio da live, outro sai do ar, e ninguém atrapalha ninguém', { timeout: 90000, skip: !ffmpeg && 'FFmpeg ausente' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-saidas-')), events = [];
  const fa = path.join(dir, 'a.flv'), fb = path.join(dir, 'b.flv');
  const sa = rtmpServer(19481, fa), sb = rtmpServer(19482, fb); await wait(700);
  const cfg = validateBroadcast({ destinations: [dest('a', 19481), dest('b', 19482, { on: false })], resolution: '1080p', bitrate: 6 });
  const outputs = hub(events), g = groupsFor(cfg)[0];
  for (const d of cfg.destinations) outputs.add(d, g.id);
  outputs.group(g.id, { size: g.size });
  const enc = encoder(12, cfg); enc.stdout.on('data', d => outputs.feed(g.id, d));
  try {
    outputs.start('a');
    await wait(4000); outputs.start('b');            // B entra no meio da live
    await wait(4000); outputs.stop('a');             // A sai do ar; B continua
    await exited(enc); outputs.endGroup(g.id);
    await Promise.race([Promise.all([exited(sa), exited(sb)]), wait(10000)]); await until(() => events.includes('b:off'), 10000);
    const a = inspect(fa), b = inspect(fb);
    assert(a.frames >= 200 && a.frames <= 280, 'A ficou no ar ~8 s (' + a.frames + ' quadros)');
    assert(b.frames >= 200 && b.frames <= 280, 'B entrou no meio e ficou ~8 s (' + b.frames + ' quadros)');
    assert(b.firstKey && a.firstKey, 'cada destino começa num quadro-chave (imagem inteira desde o 1º quadro)');
    assert.equal(b.errors, '', 'B decodifica sem erro: ' + b.errors.slice(0, 200));
    assert(b.keyGap <= 2.1 && a.keyGap <= 2.1, 'quadro-chave a cada 2 s nos dois (' + a.keyGap + ' / ' + b.keyGap + ')');
    for (const e of ['a:connecting', 'a:sending', 'a:stopping', 'a:off', 'b:connecting', 'b:sending', 'b:off']) assert(events.includes(e), 'evento ' + e + ' em ' + events.join(' '));
    assert(events.indexOf('a:off') < events.indexOf('b:off'), 'A saiu do ar antes do fim, B só no fim');
    assert(!events.slice(events.indexOf('a:stopping')).includes('a:sending'), 'saindo do ar, A não volta a aparecer como no ar (' + events.join(' ') + ')');
  } finally { enc.kill(); sa.kill(); sb.kill(); outputs.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SRT com Stream ID e senha recebe a live inteira', { timeout: 60000, skip: !ffmpeg ? 'FFmpeg ausente' : false }, async t => {
  assert(hasSrt, 'o FFmpeg do Andrômeda Live precisa ter SRT (' + process.platform + ')');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-srt-')), file = path.join(dir, 'srt.ts'), events = [];
  // Servidor SRT que só guarda os bytes recebidos (sem interpretar), com a mesma senha.
  const server = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'data', '-i', 'srt://127.0.0.1:19491?mode=listener&latency=200000&passphrase=senha-segura-123&pbkeylen=16', '-map', '0', '-c', 'copy', '-f', 'data', file], { stdio: 'ignore' });
  await wait(700);
  const cfg = validateBroadcast({ destinations: [{ id: 's', platform: 'srt', name: 'Servidor SRT', server: 'srt://127.0.0.1:19491', key: 'live/andromeda', passphrase: 'senha-segura-123', latency: 200 }], resolution: '1080p', bitrate: 6 });
  const outputs = hub(events), g = groupsFor(cfg)[0]; outputs.add(cfg.destinations[0], g.id); outputs.group(g.id, { size: g.size });
  const enc = encoder(8, cfg); enc.stdout.on('data', d => outputs.feed(g.id, d));
  try {
    outputs.start('s'); await exited(enc); outputs.endGroup(g.id); await Promise.race([exited(server), wait(8000)]); server.kill(); await exited(server);
    assert(events.includes('s:sending'), events.join(' '));
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    assert(size > 2e6, 'o servidor SRT recebeu a live (' + Math.round(size / 1e3) + ' KB)');
    if (!tsReader) { t.diagnostic('nenhum FFmpeg desta máquina lê MPEG-TS: conferidos só os bytes recebidos'); return; }
    const r = inspect(file, tsReader);
    assert(r.frames >= 225, 'SRT recebeu a live inteira (' + r.frames + ' de 240 quadros)'); assert(r.firstKey, 'começa num quadro-chave');
  } finally { enc.kill(); server.kill(); outputs.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('destino fora do ar reconecta sozinho quando o servidor volta', { timeout: 60000, skip: !ffmpeg && 'FFmpeg ausente' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-volta-')), file = path.join(dir, 'r.flv'), events = [];
  const cfg = validateBroadcast({ destinations: [dest('r', 19485)], resolution: '1080p', bitrate: 6 });
  const outputs = hub(events), g = groupsFor(cfg)[0]; outputs.add(cfg.destinations[0], g.id); outputs.group(g.id, { size: g.size });
  const enc = encoder(20, cfg); enc.stdout.on('data', d => outputs.feed(g.id, d)); let server;
  try {
    outputs.start('r'); await until(() => events.includes('r:retrying'), 15000);
    assert(events.includes('r:retrying'), 'sem servidor: tentando de novo (' + events.join(' ') + ')');
    assert.match(outputs.status()[0].reason, /conexão recusada/);
    server = rtmpServer(19485, file);
    await exited(enc); outputs.endGroup(g.id); await Promise.race([exited(server), wait(8000)]);
    const r = inspect(file);
    assert(events.includes('r:sending'), 'voltou ao ar sozinho (' + events.join(' ') + ')');
    assert(r.frames > 120 && r.firstKey, 'recebeu imagem inteira depois de voltar (' + r.frames + ' quadros)');
  } finally { enc.kill(); server?.kill(); outputs.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('destino que trava 3,5 s não perde quadros nem quadro-chave, e o outro destino não sente nada', { timeout: 60000, skip: !ffmpeg && 'FFmpeg ausente' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-trava-')), fs1 = path.join(dir, 'lento.flv'), fs2 = path.join(dir, 'normal.flv'), events = [];
  const slow = rtmpServer(19501, fs1), ok = rtmpServer(19503, fs2); let client = null;
  const proxy = net.createServer(c => { client = c; const up = net.connect(19501, '127.0.0.1'); c.pipe(up); up.pipe(c); c.on('error', () => up.destroy()); up.on('error', () => c.destroy()); });
  await new Promise(r => proxy.listen(19502, '127.0.0.1', r)); await wait(700);
  const cfg = validateBroadcast({ destinations: [dest('lento', 19502), dest('normal', 19503)], resolution: '1080p', bitrate: 6 });
  const outputs = hub(events), g = groupsFor(cfg)[0]; for (const d of cfg.destinations) outputs.add(d, g.id); outputs.group(g.id, { size: g.size });
  const enc = encoder(12, cfg); enc.stdout.on('data', d => outputs.feed(g.id, d));
  try {
    outputs.start('lento'); outputs.start('normal');
    await wait(3500); assert(client, 'destino conectado'); client.pause(); await wait(3500); client.resume();
    await exited(enc); outputs.endGroup(g.id); await Promise.race([Promise.all([exited(slow), exited(ok)]), wait(10000)]);
    const a = inspect(fs1), b = inspect(fs2);
    t.diagnostic('travado ' + a.frames + ' / normal ' + b.frames + ' / gap ' + a.keyGap);
    assert(a.frames >= 358, 'destino travado recebeu tudo depois da trava (' + a.frames + ' de 360)');
    assert(a.keyGap <= 2.1, 'quadro-chave a cada 2 s mesmo com a trava (' + a.keyGap + ' s)');
    assert(b.frames >= 358 && b.errors === '', 'o outro destino seguiu normal (' + b.frames + ' quadros)');
  } finally { enc.kill(); slow.kill(); ok.kill(); proxy.close(); client?.destroy(); outputs.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
