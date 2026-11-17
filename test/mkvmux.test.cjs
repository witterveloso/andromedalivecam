const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const Mkv = require('../public/mkvmux.js'), { findFFmpeg } = require('../encoder.cjs');
const exe = findFFmpeg();

const { readMkv, lastFrame } = require('./mkv-reader.cjs');

function source(dir, extra = []) {
  const file = path.join(dir, 'src.mkv');
  const r = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-ac', '2', ...extra, '-y', file], { timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr)); return file;
}
const probe = (file, args) => spawnSync(exe, ['-hide_banner', '-v', 'error', '-i', file, ...args, '-f', 'null', '-'], { encoding: 'utf8' });

test('Matroska engine muxer: its own output is read back by FFmpeg with the same frames, sizes and timing', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-mkv-'));
  try {
    const src = readMkv(fs.readFileSync(source(dir))), v = src.tracks[1], a = src.tracks[2];
    assert.equal(v.codec, 'V_MPEG4/ISO/AVC'); assert.equal(a.codec, 'A_OPUS'); assert(v.private.length > 7 && a.private.length >= 19);
    const mux = Mkv.create({ video: { width: v.width, height: v.height, description: v.private }, audio: { channels: 2, sampleRate: 48000, description: a.private } });
    const chunks = [mux.header()]; const frames = src.packets.filter(p => p.track === 1), sounds = src.packets.filter(p => p.track === 2);
    // Intercala como o navegador: pelos instantes, e sem passar dos instantes de cada faixa.
    for (const p of [...src.packets].sort((x, y) => x.ms - y.ms)) chunks.push(p.track === 1 ? mux.video(p.data, p.ms, p.key) : mux.audio(p.data, p.ms));
    const out = path.join(dir, 'out.mkv'); fs.writeFileSync(out, Buffer.concat(chunks.map(Buffer.from)));
    const mine = readMkv(fs.readFileSync(out));
    assert.equal(mine.packets.filter(p => p.track === 1).length, frames.length, 'every video packet kept'); assert.equal(mine.packets.filter(p => p.track === 2).length, sounds.length, 'every audio packet kept');
    assert.deepEqual(mine.packets.filter(p => p.track === 1 && p.key).map(p => p.ms), frames.filter(p => p.key).map(p => p.ms), 'keyframes at the same instants');
    const r = probe(out, ['-map', '0:v:0', '-map', '0:a:0']); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr.trim(), '', 'FFmpeg decodes both tracks with no complaint: ' + r.stderr);
    const count = spawnSync(exe, ['-hide_banner', '-i', out, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; assert(Math.abs(lastFrame(count) - frames.length) <= 1, 'decoded frames: ' + count.slice(-200));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('Matroska engine muxer: a restart waits for a keyframe, and a stream cut anywhere still opens', async t => {
  if (!exe) return t.skip('FFmpeg ausente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-mkv-'));
  try {
    const src = readMkv(fs.readFileSync(source(dir))), v = src.tracks[1], a = src.tracks[2];
    const mux = Mkv.create({ video: { width: v.width, height: v.height, description: v.private }, audio: { channels: 2, sampleRate: 48000, description: a.private } });
    mux.header(); assert.equal(mux.waitingKey, true);
    const frames = src.packets.filter(p => p.track === 1); const firstDelta = frames.find(p => !p.key);
    assert.equal(mux.video(firstDelta.data, firstDelta.ms, false).length, 0, 'a delta frame before the first keyframe is dropped');
    assert(mux.video(frames[0].data, frames[0].ms, true).length > 0); assert.equal(mux.waitingKey, false);
    // Recomeço: cabeçalho novo e o vídeo volta só no quadro-chave seguinte (instante 2000 ms com -g 60 a 30 q/s).
    const h = Mkv.create({ video: { width: v.width, height: v.height, description: v.private }, audio: { channels: 2, sampleRate: 48000, description: a.private } });
    const first = Buffer.from(h.header()); assert.equal(first.readUInt32BE(0), 0x1a45dfa3, 'starts with the EBML signature the service looks for');
    const keys = frames.filter(p => p.key); assert(keys.length >= 2);
    const tail = [h.header(), ...frames.filter(p => p.ms >= keys[1].ms).map(p => h.video(p.data, p.ms, p.key)), ...src.packets.filter(p => p.track === 2 && p.ms >= keys[1].ms).map(p => h.audio(p.data, p.ms))];
    const out = path.join(dir, 'tail.mkv'); fs.writeFileSync(out, Buffer.concat(tail.map(Buffer.from)));
    const cut = Buffer.concat(tail.map(Buffer.from)).subarray(0, Math.floor(fs.statSync(out).size * .8)); fs.writeFileSync(out, cut);
    const r = spawnSync(exe, ['-hide_banner', '-i', out, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }); const n = lastFrame(r.stderr); assert(n > 20, 'a cut file still decodes: ' + r.stderr.slice(-300));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
