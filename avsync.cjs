'use strict';
/*
 * Medição do sincronismo entre imagem e som de uma gravação.
 *
 * A mesa gera um sinal de teste (tela preta com clarões brancos e, no mesmo instante, um bipe de 1 kHz) e o passa pela
 * cadeia real de envio: navegador → codificador → arquivo. Este módulo lê o arquivo, acha cada clarão e cada bipe e
 * mede a diferença entre eles. Resultado positivo: o som chega depois da imagem (atrasado). Negativo: adiantado.
 *
 * Só usa o FFmpeg (já presente na instalação): decodifica a imagem em miniatura (brilho médio por quadro) e o áudio em
 * janelas de 10 ms (nível RMS), ambos com o instante de cada amostra no arquivo.
 */
const { spawn } = require('node:child_process');

function run(ffmpeg, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('A análise demorou demais.')); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Error('FFmpeg ' + code + ': ' + err.trim().split('\n').slice(-2).join(' '))); });
  });
}

// "frame:12 pts:360 pts_time:0.4" seguido de "chave=valor": devolve [{ t, v }].
function parseMetadata(text, key) {
  const rows = []; let t = null;
  for (const line of text.split('\n')) {
    const m = /pts_time:(-?[\d.]+)/.exec(line);
    if (m) { t = Number(m[1]); continue; }
    const k = line.indexOf('=');
    if (k > 0 && t !== null && line.slice(0, k).trim() === key) { const raw = line.slice(k + 1).trim(); rows.push({ t, v: raw === '-inf' || raw === 'nan' ? -120 : Number(raw) }); }
  }
  return rows;
}
// Agrupa amostras seguidas acima do limite: cada grupo é um evento que começa no primeiro instante.
function events(rows, over, gap) {
  const out = []; let last = null;
  for (const r of rows) {
    if (!over(r.v)) continue;
    if (last === null || r.t - last > gap) out.push(r.t);
    last = r.t;
  }
  return out;
}
const median = list => { const s = [...list].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

async function analyze(ffmpeg, file) {
  const [video, audio] = await Promise.all([
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', 'scale=32:18,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']),
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-af', 'asetnsamples=n=480:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-']),
  ]);
  const frames = parseMetadata(video, 'lavfi.signalstats.YAVG'), windows = parseMetadata(audio, 'lavfi.astats.Overall.RMS_level');
  if (frames.length < 10) throw Error('Poucos quadros de vídeo para medir.');
  if (windows.length < 10) throw Error('Poucas amostras de áudio para medir.');
  const flashes = events(frames, v => v > 110, .25), beeps = events(windows, v => v > -35, .25);
  // Cada clarão se emparelha com o bipe mais próximo (até 0,6 s de distância).
  const pairs = [];
  for (const f of flashes) {
    let best = null; for (const b of beeps) if (best === null || Math.abs(b - f) < Math.abs(best - f)) best = b;
    if (best !== null && Math.abs(best - f) < .6) pairs.push({ flash: f, beep: best, offsetMs: (best - f) * 1000 });
  }
  if (pairs.length < 3) throw Error('Não foi possível achar clarões e bipes suficientes (' + flashes.length + ' clarões, ' + beeps.length + ' bipes).');
  const offsets = pairs.map(p => p.offsetMs), m = median(offsets), spread = median(offsets.map(o => Math.abs(o - m)));
  // Um quadro (cerca de 33 ms) é a resolução natural da imagem: acima de 2 quadros de dispersão, a medição não é confiável.
  return { offsetMs: Math.round(m), spreadMs: Math.round(spread), pairs: pairs.length, flashes: flashes.length, beeps: beeps.length, reliable: pairs.length >= 3 && spread <= 40, detail: pairs.map(p => Math.round(p.offsetMs)) };
}

// Compensação a aplicar no codificador: positivo atrasa o áudio; negativo atrasa a imagem. Limites de ±500 ms.
function clampOffset(ms) { const v = Number(ms); return Number.isFinite(v) ? Math.max(-500, Math.min(500, Math.round(v))) : 0; }
function compensation(measuredMs) { return clampOffset(-measuredMs); }

module.exports = { analyze, parseMetadata, events, clampOffset, compensation };
