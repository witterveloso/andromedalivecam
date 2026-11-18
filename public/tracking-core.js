'use strict';
/*
 * TRACKING · núcleo (contas puras, sem DOM): a câmera segue a pessoa ou o movimento.
 *
 * O celular (Andromeda Cam) não gira; ele "anda" com um recorte digital: com zoom maior que 1× a janela visível pode ser movida
 * (pan x/y de −1 a 1) e o zoom pode ser trocado. A mesa vê a imagem já recortada, mede onde o alvo está nela e manda o pan e o
 * zoom que o colocam no lugar certo do quadro (malha fechada). Aqui ficam as contas; o navegador (tracking.js) só traz as detecções.
 *
 * Geometria (igual à do app da câmera): a janela visível tem largura 1/zoom do quadro inteiro e o pan ±1 a desloca ±(0,5 − 0,5/zoom)
 * do quadro; portanto 1 unidade de pan move o conteúdo (zoom − 1)/2 larguras da janela visível.
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.andromedaTrackingCore = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Enquadramentos: altura do ROSTO (ou do corpo) na imagem, em fração da altura do quadro.
  const FRAMES = {
    seguir: { label: 'Só seguir (não mexe no zoom)', h: 0, src: null },
    rosto: { label: 'Rosto (close)', h: 0.36, src: 'face' },
    busto: { label: 'Busto', h: 0.21, src: 'face' },
    meio: { label: 'Meio corpo', h: 0.12, src: 'face' },
    corpo: { label: 'Corpo inteiro', h: 0.8, src: 'person' },
  };
  // Onde o alvo deve ficar no quadro (x, y em fração): olhos na linha do terço de cima, corpo com a cabeça no terço superior.
  const AIM = { face: { x: 0.5, y: 0.42 }, person: { x: 0.5, y: 0.5 }, motion: { x: 0.5, y: 0.5 } };
  // tau: suavização da medida · ctl: constante de tempo do controle (quanto menor, mais rápido corrige) · rate: velocidade máxima da janela
  // em larguras de imagem por segundo · zoomRate: variação máxima do zoom por segundo (fração). Tudo em função do tempo, não do número
  // de quadros analisados: com 3 ou com 10 análises por segundo a câmera anda igual.
  const SPEEDS = { suave: { tau: 0.35, ctl: 0.7, rate: 0.25, zoomRate: 0.25 }, normal: { tau: 0.2, ctl: 0.35, rate: 0.55, zoomRate: 0.45 }, rapido: { tau: 0.1, ctl: 0.18, rate: 1.1, zoomRate: 0.8 } };

  // 1 unidade de pan desloca o conteúdo (zoom − 1)/2 larguras visíveis; sem zoom não há folga para andar.
  const travel = zoom => Math.max(0, (zoom - 1) / 2);

  /**
   * Seguidor de um alvo. update(det, view, dt) recebe a detecção (ou null), a visão atual {zoom, pan, zoomMin, zoomMax} e o intervalo
   * em segundos; devolve {pan?, zoom?, state, atEdge}. Só devolve pan/zoom quando há o que mudar.
   */
  class Tracker {
    constructor(options = {}) { this.options = { frame: 'seguir', speed: 'normal', deadzone: 0.05, lostHold: 2.5, lostReturn: false, followZoom: 1.4, ...options }; this.reset(); }
    reset() { this.sm = null; this.lostFor = 0; this.state = 'search'; this.hold = 0; }
    holdOff(seconds) { this.hold = Math.max(this.hold, seconds); }
    update(det, view, dt) {
      const o = this.options, sp = SPEEDS[o.speed] || SPEEDS.normal, out = { state: this.state, atEdge: false };
      if (this.hold > 0) { this.hold = Math.max(0, this.hold - dt); out.state = this.state = 'hold'; return out; }
      if (!det) {
        this.lostFor += dt;
        if (this.lostFor > 0.4) this.state = 'lost';
        if (this.lostFor > o.lostHold) {
          this.sm = null; this.state = 'search';
          if (o.lostReturn && (Math.abs(view.pan.x) > 0.01 || Math.abs(view.pan.y) > 0.01)) { const k = 1 - Math.exp(-dt / 0.8); out.pan = { x: lerp(view.pan.x, 0, k), y: lerp(view.pan.y, 0, k) }; }
        }
        out.state = this.state; return out;
      }
      this.lostFor = 0; this.state = 'track';
      const a = 1 - Math.exp(-dt / sp.tau);
      this.sm = this.sm ? { cx: lerp(this.sm.cx, det.cx, a), cy: lerp(this.sm.cy, det.cy, a), h: lerp(this.sm.h, det.h, a), kind: det.kind } : { ...det };
      const aim = AIM[det.kind] || AIM.person, frame = FRAMES[o.frame] || FRAMES.seguir;
      // zoom: enquadramento escolhido (devagar, com folga para não "respirar"), ou o mínimo para ter folga de seguir
      let zoom = view.zoom;
      if (frame.h > 0 && frame.src === (det.kind === 'person' ? 'person' : 'face') && this.sm.h > 0.01) {
        const want = clamp(view.zoom * frame.h / this.sm.h, view.zoomMin, view.zoomMax), ratio = Math.log(want / view.zoom);
        if (Math.abs(ratio) > 0.1) { zoom = view.zoom * Math.exp(clamp(ratio * (1 - Math.exp(-dt / (sp.ctl * 2))), -sp.zoomRate * dt, sp.zoomRate * dt)); zoom = clamp(zoom, view.zoomMin, view.zoomMax); }
      } else if (frame.h === 0 && view.zoom < 1.05) zoom = Math.min(view.zoomMax, Math.max(view.zoom, o.followZoom));
      if (Math.abs(zoom - view.zoom) > 0.004) out.zoom = Math.round(zoom * 1000) / 1000;
      // posição: erro do alvo em relação ao ponto desejado, com zona morta
      const dz = o.deadzone, soft = e => (Math.abs(e) <= dz ? 0 : e - Math.sign(e) * dz);
      const ex = soft(this.sm.cx - aim.x), ey = soft(this.sm.cy - aim.y), k = travel(out.zoom ?? view.zoom);
      if (k > 0.001 && (ex || ey)) {
        const gain = 1 - Math.exp(-dt / sp.ctl), cap = sp.rate * dt / k;
        const step = (e, cur) => { const d = clamp(gain * e / k, -cap, cap), next = clamp(cur + d, -1, 1); if (next === cur && d !== 0) out.atEdge = true; return next; };
        const nx = step(ex, view.pan.x), ny = step(ey, view.pan.y);
        if (Math.abs(nx - view.pan.x) > 0.0008 || Math.abs(ny - view.pan.y) > 0.0008) out.pan = { x: Math.round(nx * 10000) / 10000, y: Math.round(ny * 10000) / 10000 };
      }
      out.state = this.state; return out;
    }
  }

  // Escolhe quem seguir entre as detecções: o mais perto do último alvo (ou do ponto clicado); sem referência, o maior.
  function pickSubject(dets, last) {
    if (!dets?.length) return null;
    if (last) {
      let best = null, bd = Infinity; for (const d of dets) { const dist = Math.hypot(d.cx - last.cx, d.cy - last.cy); if (dist < bd) { bd = dist; best = d; } }
      if (bd < 0.35) return best;
    }
    return dets.reduce((m, d) => (d.w * d.h > m.w * m.h ? d : m));
  }

  /**
   * Movimento: compara dois quadros em cinza (w×h) e devolve o centro do que mexeu. Acumula as últimas diferenças para o centro
   * não pular quando a pessoa para um instante. Devolve null se quase nada mexeu (ruído do sensor).
   */
  class MotionDetector {
    constructor(w = 96, h = 54, options = {}) { this.w = w; this.h = h; this.prev = null; this.acc = new Float32Array(w * h); this.o = { threshold: 22, decay: 0.55, minFraction: 0.004, ...options }; }
    reset() { this.prev = null; this.acc.fill(0); }
    update(gray) {
      const { w, h, acc, o } = this, n = w * h;
      if (!this.prev || this.prev.length !== n) { this.prev = Uint8Array.from(gray); acc.fill(0); return null; }
      let count = 0, sx = 0, sy = 0, sw = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(gray[i] - this.prev[i]); acc[i] = acc[i] * o.decay + (d > o.threshold ? 1 : 0); this.prev[i] = gray[i];
        if (acc[i] >= 0.9) { const x = i % w, y = (i / w) | 0, wt = acc[i]; count++; sx += x * wt; sy += y * wt; sw += wt; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (count < n * o.minFraction || sw === 0) return null;
      return { cx: (sx / sw + 0.5) / w, cy: (sy / sw + 0.5) / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h, kind: 'motion', score: Math.min(1, count / (n * 0.05)) };
    }
  }

  return { Tracker, MotionDetector, pickSubject, travel, FRAMES, AIM, SPEEDS, clamp };
});
