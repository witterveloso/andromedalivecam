'use strict';
// Celular simulado para o Tracking: a mesma geometria do app da câmera (janela = 1/zoom do quadro inteiro, deslocada pelo pan),
// atraso para o comando chegar, atraso para a imagem voltar, tempo de análise, ruído da detecção e a suavização do celular (ease).
const room = z => 0.5 - 0.5 / Math.max(1, z);

function simulate({ driver, subject, seconds = 30, zoom0 = 2, pan0 = { x: 0, y: 0 }, zoomMin = 1, zoomMax = 5, dCmd = 0.08, dVid = 0.12, tDet = 0.05, detHz = 8, noise = 0.008, miss = 0, tickHz = 25, easeMs = null, seed = 7, step = 0.005 }) {
  let rs = seed; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647 - 0.5;
  const ph = { pan: { ...pan0 }, zoom: zoom0 }, target = { pan: { ...pan0 }, zoom: zoom0 }; let easeTau = 0;
  const cmdQ = [], frames = [], dets = [], trace = [], sent = [];
  let nextDet = 0, nextTick = 0, nextFrame = 0, lastFrame = null, cmdCount = 0;
  const windowState = () => { const r = room(ph.zoom); return { cx: 0.5 + ph.pan.x * r, cy: 0.5 + ph.pan.y * r, z: ph.zoom }; };
  const view = () => ({ zoom: ph.zoom, pan: { ...ph.pan }, zoomMin, zoomMax });
  for (let t = 0; t <= seconds; t += step) {
    // 1) comandos que chegam ao celular
    while (cmdQ.length && cmdQ[0].t <= t) { const c = cmdQ.shift().c; if (c.pan) target.pan = { ...c.pan }; if (Number.isFinite(c.zoom)) target.zoom = c.zoom; if (c.ease !== undefined && easeMs !== false) easeTau = (easeMs ?? c.ease) / 1000; }
    // 2) o celular anda até o alvo do comando (suavização)
    const a = easeTau > 0 ? 1 - Math.exp(-step / easeTau) : 1;
    ph.pan.x += (target.pan.x - ph.pan.x) * a; ph.pan.y += (target.pan.y - ph.pan.y) * a; ph.zoom += (target.zoom - ph.zoom) * a;
    // 3) quadro de vídeo (30 por segundo) e detecção sobre o quadro mais recente que já chegou
    if (t >= nextFrame) { nextFrame += 1 / 30; const w = windowState(), s = subject(t); frames.push({ cap: t, arrive: t + dVid, view: { cx: (s.x - (w.cx - 0.5 / w.z)) * w.z, cy: (s.y - (w.cy - 0.5 / w.z)) * w.z, h: s.h * w.z } }); }
    if (t >= nextDet) {
      nextDet += 1 / detHz; let f = null; while (frames.length && frames[0].arrive <= t) f = frames.shift(); if (f) lastFrame = f;
      if (lastFrame) { const v = lastFrame.view, ok = rnd() + 0.5 >= miss && v.cx > 0 && v.cx < 1 && v.cy > 0 && v.cy < 1; dets.push({ ready: t + tDet, det: ok ? { cx: v.cx + rnd() * 2 * noise, cy: v.cy + rnd() * 2 * noise, w: v.h * 0.8, h: v.h * (1 + rnd() * 0.1), kind: 'face' } : null }); }
    }
    while (dets.length && dets[0].ready <= t) { const d = dets.shift(); driver.onDetection?.(d.det, t, view()); }
    // 4) ciclo de controle da mesa
    if (t >= nextTick) { nextTick += 1 / tickHz; const out = driver.onTick?.(view(), t); if (out && (out.pan || out.zoom)) { cmdCount++; cmdQ.push({ t: t + dCmd, c: out }); sent.push({ t, ...out }); } }
    if (Math.abs(t / (1 / 60) - Math.round(t / (1 / 60))) < step * 60 / 2) { const w = windowState(), s = subject(t); trace.push({ t, cx: w.cx, cy: w.cy, z: w.z, vx: (s.x - (w.cx - 0.5 / w.z)) * w.z, vy: (s.y - (w.cy - 0.5 / w.z)) * w.z, h: s.h * w.z, sx: s.x, sy: s.y }); }
  }
  return { trace, cmdCount, sent };
}

// Medidas de suavidade da janela e de qualidade do enquadramento
function metrics(trace, { skip = 3 } = {}) {
  const T = trace.filter(p => p.t >= skip), n = T.length; let maxV = 0, maxA = 0, sumJ2 = 0, jc = 0, stalls = 0, moving = 0, worstX = 0, worstY = 0, sumX = 0, out = 0;
  const v = [], a = [];
  for (let i = 1; i < n; i++) { const dt = T[i].t - T[i - 1].t; v.push({ x: (T[i].cx - T[i - 1].cx) / dt, y: (T[i].cy - T[i - 1].cy) / dt }); }
  for (let i = 1; i < v.length; i++) { const dt = T[i + 1].t - T[i].t; a.push({ x: (v[i].x - v[i - 1].x) / dt, y: (v[i].y - v[i - 1].y) / dt }); }
  for (const p of v) maxV = Math.max(maxV, Math.hypot(p.x, p.y));
  for (const p of a) maxA = Math.max(maxA, Math.hypot(p.x, p.y));
  for (let i = 1; i < a.length; i++) { const dt = T[i + 2].t - T[i + 1].t, j = Math.hypot(a[i].x - a[i - 1].x, a[i].y - a[i - 1].y) / dt; sumJ2 += j * j; jc++; }
  // "tranco": a janela anda, para um instante e volta a andar (velocidade cai quase a zero entre dois trechos rápidos)
  for (let i = 2; i < v.length - 2; i++) { const s = Math.hypot(v[i].x, v[i].y), around = Math.min(Math.hypot(v[i - 2].x, v[i - 2].y), Math.hypot(v[i + 2].x, v[i + 2].y)); if (around > 0.02) { moving++; if (s < around * 0.2) stalls++; } }
  for (const p of T) { worstX = Math.max(worstX, Math.abs(p.vx - 0.5)); worstY = Math.max(worstY, Math.abs(p.vy - 0.42)); sumX += Math.abs(p.vx - 0.5); if (p.vx < 0.04 || p.vx > 0.96 || p.vy < 0.04 || p.vy > 0.96) out++; }
  return { maxV, maxA, rmsJerk: Math.sqrt(sumJ2 / Math.max(1, jc)), stallRatio: moving ? stalls / moving : 0, worstX, worstY, meanX: sumX / n, outFrames: out / n };
}
module.exports = { simulate, metrics, room };
