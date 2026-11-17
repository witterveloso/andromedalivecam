'use strict';
/*
 * Pré-voo e perfil automático.
 *
 * Duas perguntas que decidem se uma transmissão corre bem num computador comum:
 *  1. Os servidores das plataformas respondem a partir daqui? (conexão TCP na porta que a transmissão vai usar)
 *  2. O computador codifica com folga? O teste codifica um sinal sintético com os mesmos parâmetros da transmissão e mede
 *     quantas vezes mais rápido que o tempo real ele roda. A mesa escolhe a melhor opção que deixa o codificador usando
 *     no máximo ~30% do computador: o resto fica para o navegador (que desenha a mesa e codifica o 1º trecho), o sistema e
 *     picos. Se o processador não aguentar com folga e houver um codificador de placa de vídeo, ela passa a ser a escolha.
 */
const net = require('node:net'), os = require('node:os'), { spawn } = require('node:child_process');

const BUDGET = .30; // fração do computador que os codificadores podem usar

/* ---------- alcance dos destinos ---------- */
function parseTarget(server) {
  let u; try { u = new URL(String(server)); } catch { return null; }
  if (!/^rtmps?:$/.test(u.protocol)) return null;
  return { host: u.hostname, port: Number(u.port) || (u.protocol === 'rtmps:' ? 443 : 1935) };
}
function reach(server, timeoutMs = 3000) {
  return new Promise(resolve => {
    const t = parseTarget(server); if (!t) { resolve({ ok: false, error: 'endereço inválido' }); return; }
    const start = Date.now(), socket = net.connect({ host: t.host, port: t.port });
    const done = r => { socket.destroy(); resolve({ host: t.host, port: t.port, ...r }); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ ok: true, ms: Date.now() - start }));
    socket.once('timeout', () => done({ ok: false, error: 'sem resposta em ' + timeoutMs / 1000 + ' s' }));
    socket.once('error', e => done({ ok: false, error: e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'nome não encontrado (sem internet ou DNS)' : e.code === 'ECONNREFUSED' ? 'conexão recusada' : (e.code || e.message) }));
  });
}
async function checkDestinations(list) {
  return Promise.all((list || []).slice(0, 8).map(async d => ({ name: String(d.name || 'Destino').slice(0, 40), ...(await reach(d.server)) })));
}

/* ---------- teste de velocidade do codificador ---------- */
// Mesmos parâmetros de codificação da transmissão, sobre um sinal sintético de movimento contínuo.
function benchmarkRun(ffmpeg, { width, height, preset, encoderArgs }, frames = 120, timeoutMs = 45000) {
  return new Promise(resolve => {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30`, '-frames:v', String(frames), '-vf', `scale=${width}:${height},setsar=1`,
      ...encoderArgs(preset), '-pix_fmt', 'yuv420p', '-g', '60', '-an', '-f', 'null', '-'];
    const t0 = process.hrtime.bigint(), child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', code => { clearTimeout(timer); const s = Number(process.hrtime.bigint() - t0) / 1e9; resolve(code === 0 && s > 0 ? frames / 30 / s : null); });
  });
}

// Candidatos do melhor para o mais leve. Cada um é (resolução horizontal, velocidade do x264).
const LADDER = [
  { resolution: '1080p', preset: 'veryfast', width: 1920, height: 1080, label: '1080p · equilibrado' },
  { resolution: '1080p', preset: 'superfast', width: 1920, height: 1080, label: '1080p · rápido' },
  { resolution: '720p', preset: 'veryfast', width: 1280, height: 720, label: '720p · equilibrado' },
  { resolution: '720p', preset: 'superfast', width: 1280, height: 720, label: '720p · rápido' },
  { resolution: '720p', preset: 'ultrafast', width: 1280, height: 720, label: '720p · máximo desempenho' },
];
const costOf = speed => speed ? 1 / speed : Infinity;

/*
 * opts: { ffmpeg, x264Args(preset)→args, hardware: ['h264_nvenc',…], vertical: null | { width, height }, onProgress }
 * Devolve { recommended: { resolution, preset, encoder, label, load }, tests: [...], cores, notes: [...] }
 */
async function chooseProfile(opts) {
  const { ffmpeg, x264Args, hardware = [], vertical = null, onProgress = () => {}, bench = benchmarkRun } = opts, tests = [], notes = [];
  const cores = os.cpus().length;
  // A saída vertical (se houver) custa o mesmo que um 720p: mede uma vez, com o preset de cada candidato.
  const cache = new Map();
  const speedOf = async c => {
    const key = c.width + 'x' + c.height + c.preset;
    if (!cache.has(key)) { onProgress('Medindo ' + c.label + '…'); const sp = await bench(ffmpeg, { width: c.width, height: c.height, preset: c.preset, encoderArgs: x264Args }); cache.set(key, sp); tests.push({ label: c.label, size: c.width + '×' + c.height, preset: c.preset, speed: sp ? Math.round(sp * 10) / 10 : null }); }
    return cache.get(key);
  };
  let chosen = null;
  for (const c of LADDER) {
    const sp = await speedOf(c); if (!sp) continue;
    let load = costOf(sp);
    if (vertical) { const v = await speedOf({ ...LADDER[2], width: vertical.width, height: vertical.height, preset: c.preset, label: 'vertical ' + vertical.width + '×' + vertical.height + ' · ' + c.preset }); load += costOf(v); }
    if (load <= BUDGET) { chosen = { ...c, encoder: 'libx264', load }; break; }
    if (c === LADDER.at(-1)) chosen = { ...c, encoder: 'libx264', load, over: true };
  }
  if (!chosen) { notes.push('Não foi possível medir o codificador. Confira a instalação do FFmpeg.'); return { recommended: null, tests, cores, notes }; }
  if (chosen.over) {
    if (hardware.length) { const encoder = hardware[0]; chosen = { ...LADDER[0], encoder, load: null, label: '1080p · codificador da placa de vídeo (' + encoder + ')' }; notes.push('O processador não codifica com folga: usando o codificador da placa de vídeo, que alivia a CPU.'); }
    else notes.push('Este computador está no limite para transmitir: feche outros programas, use o cabo de força e evite gravar nos dois formatos ao mesmo tempo.');
  }
  return { recommended: { resolution: chosen.resolution, preset: chosen.preset, encoder: chosen.encoder, label: chosen.label, load: chosen.load === null ? null : Math.round(chosen.load * 100) }, tests, cores, notes };
}

function machineInfo() {
  const cpus = os.cpus();
  return { cores: cpus.length, model: (cpus[0]?.model || '').replace(/\s+/g, ' ').trim(), freeMemoryMB: Math.round(os.freemem() / 1048576), totalMemoryMB: Math.round(os.totalmem() / 1048576), load1: Math.round(os.loadavg()[0] * 100) / 100, platform: process.platform };
}

module.exports = { parseTarget, reach, checkDestinations, benchmarkRun, chooseProfile, machineInfo, LADDER, BUDGET };
