'use strict';
/*
 * TRACKING · núcleo (contas puras, sem DOM): a câmera segue a pessoa ou o movimento, com movimento de operador de câmera.
 *
 * O celular (Andromeda Cam) não gira; ele "anda" com um recorte digital: com zoom maior que 1× a janela visível pode ser movida
 * (pan x/y de −1 a 1) e o zoom pode ser trocado. A mesa vê a imagem já recortada, acha o alvo e manda ao celular o pan e o zoom.
 *
 * Por que o movimento é suave (as mesmas ideias das câmeras de rastreio do mercado: PTZ com auto tracking, OBSBOT, Insta360 Link):
 *  1. A detecção (3 a 10 por segundo) é uma coisa; o MOVIMENTO é outra (25 por segundo). Entre uma detecção e outra um filtro de Kalman
 *     (posição + velocidade) continua o caminho do alvo, em vez de a câmera andar aos pulos a cada detecção.
 *  2. O alvo é medido no MUNDO (quadro inteiro do sensor), não na janela: quando a câmera anda a imagem anda junto, e o filtro, se
 *     visse a imagem, confundiria o movimento da câmera com o da pessoa. As posições são devolvidas ao que a câmera mostrava no instante
 *     do quadro (compensação do atraso de rede + análise).
 *  3. Antecipação (feed-forward): a câmera mira onde o alvo ESTARÁ, pela velocidade estimada, e não onde ele estava.
 *  4. Zona de conforto com histerese: dentro dela a câmera não se mexe; ao sair, ela vai ao alvo e só para quando ele está bem
 *     centrado (sem "respirar" nem ficar corrigindo detalhes).
 *  5. O movimento é uma mola criticamente amortecida com limites de velocidade e de aceleração: parte e para suavemente (curva em S),
 *     sem solavancos, e o zoom segue o mesmo princípio, em escala logarítmica, mantendo o centro da imagem.
 *
 * Geometria (igual à do app da câmera): a janela visível tem largura 1/zoom do quadro inteiro e o pan ±1 a desloca ±(0,5 − 0,5/zoom)
 * do quadro. Aqui o estado é o CENTRO da janela (em coordenadas do quadro inteiro); o pan é derivado dele.
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

  // Estilos de movimento. omega: rapidez da mola (rad/s, ~ 4/omega s para assentar) · vmax: velocidade máxima da janela (quadros inteiros/s)
  // amax: aceleração máxima · zoom*: o mesmo para o zoom (em ln) · lead: quanto da antecipação usar · ease: suavização no celular (ms).
  const SPEEDS = {
    suave: { omega: 1.5, vmax: 0.2, amax: 0.45, zOmega: 0.8, zVmax: 0.22, lead: 0.7, ease: 140, label: 'Suave (cinema)' },
    normal: { omega: 2.6, vmax: 0.4, amax: 1.1, zOmega: 1.2, zVmax: 0.4, lead: 1, ease: 100, label: 'Normal' },
    rapido: { omega: 4.6, vmax: 0.8, amax: 2.8, zOmega: 2, zVmax: 0.7, lead: 1.1, ease: 70, label: 'Rápida (esporte)' },
  };
  // Zona de conforto (em larguras da imagem): fora de "out" a câmera passa a andar; dentro de "in" ela para.
  const COMFORT = { pequena: { out: 0.06, inn: 0.02, label: 'Pequena' }, media: { out: 0.12, inn: 0.04, label: 'Média' }, grande: { out: 0.2, inn: 0.07, label: 'Grande' } };
  // Atraso entre mandar um comando e ver o resultado na imagem que volta (rede + codificação + análise + suavização do celular).
  const LATENCY = { lan: { value: 0.22, label: 'Rede local (Wi-Fi)' }, normal: { value: 0.35, label: 'Internet (Wi-Fi/4G)' }, lenta: { value: 0.6, label: 'Internet lenta (4G/5G fraco)' } };

  const room = zoom => Math.max(0, 0.5 - 0.5 / Math.max(1, zoom)); // folga total do recorte, em quadros inteiros
  // 1 unidade de pan desloca o conteúdo (zoom − 1)/2 larguras visíveis; sem zoom não há folga para andar.
  const travel = zoom => Math.max(0, (zoom - 1) / 2);

  /** Filtro de Kalman de uma dimensão (posição e velocidade) com ruído de aceleração. */
  class Kalman1D {
    constructor(q = 0.2) { this.q = q; this.x = null; this.v = 0; this.t = 0; this.P = [[1, 0], [0, 1]]; }
    init(x, t, r) { this.x = x; this.v = 0; this.t = t; this.P = [[r, 0], [0, 4]]; }
    predict(t) {
      const dt = Math.max(0, t - this.t); if (!dt) return;
      const [[a, b], [c, d]] = this.P, q = this.q, dt2 = dt * dt;
      this.x += this.v * dt;
      // P = F P Fᵀ + Q, com F = [[1, dt], [0, 1]] e Q de aceleração constante por tramo
      const p00 = a + dt * (b + c) + dt2 * d + q * dt2 * dt2 / 4, p01 = b + dt * d + q * dt2 * dt / 2, p10 = c + dt * d + q * dt2 * dt / 2, p11 = d + q * dt2;
      this.P = [[p00, p01], [p10, p11]]; this.t = t;
    }
    update(z, r) {
      const [[p00, p01], [p10, p11]] = this.P, s = p00 + r, k0 = p00 / s, k1 = p10 / s, y = z - this.x;
      this.x += k0 * y; this.v += k1 * y;
      this.P = [[(1 - k0) * p00, (1 - k0) * p01], [p10 - k1 * p00, p11 - k1 * p01]];
    }
    at(t) { return this.x + this.v * (t - this.t); }
  }

  /** Mola criticamente amortecida com limites de velocidade e de aceleração (o que dá a curva em S). */
  function spring(s, target, dt, omega, vmax, amax) {
    // passos curtos: estável e suave mesmo com intervalos maiores entre os ciclos
    const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
    for (let i = 0; i < n; i++) {
      let a = omega * omega * (target - s.x) - 2 * omega * s.v;
      a = clamp(a, -amax, amax); s.v = clamp(s.v + a * h, -vmax, vmax); s.x += s.v * h;
    }
  }

  /**
   * Seguidor de um alvo. Duas entradas:
   *   observe(det, t, view)  quando chega uma detecção (ou null) do quadro que foi capturado há `latency` segundos;
   *   tick(view, t)          a cada ciclo de controle (~25 por segundo): devolve {pan?, zoom?, state, atEdge, ease}.
   * t em segundos. view = { zoom, pan: {x, y}, zoomMin, zoomMax } (o que o celular informou; só serve para começar e para voltar
   * a seguir depois de o operador mexer à mão).
   */
  class Tracker {
    constructor(options = {}) { this.options = { frame: 'seguir', speed: 'normal', comfort: 'media', latency: 0.35, lostHold: 2.5, lostReturn: false, followZoom: 1.4, ...options }; this.reset(); }
    reset() {
      this.st = null; this.kx = new Kalman1D(0.25); this.ky = new Kalman1D(0.25); this.hw = null; this.kind = null; this.lastSeen = -Infinity; this.lastT = null;
      this.hist = []; this.hold = 0; this.mv = { x: false, y: false, z: false }; this.state = 'search'; this.sent = null; this.kt = 0;
    }
    holdOff(seconds) { this.hold = Math.max(this.hold, seconds); }

    _init(view) {
      const z = clamp(view.zoom, view.zoomMin ?? 1, view.zoomMax ?? 8), r = room(z);
      this.st = { cx: 0.5 + view.pan.x * r, cy: 0.5 + view.pan.y * r, z, vx: 0, vy: 0, vz: 0 }; this.hist = []; this.mv = { x: false, y: false, z: false }; this.sent = null;
    }
    // O que a câmera mostrava no instante `t` (a partir dos comandos já enviados).
    _stateAt(t) {
      const h = this.hist; if (!h.length) return this.st;
      if (t <= h[0].t) return h[0]; if (t >= h[h.length - 1].t) return h[h.length - 1];
      let i = h.length - 1; while (i > 0 && h[i - 1].t > t) i--;
      const a = h[i - 1], b = h[i], f = (t - a.t) / Math.max(1e-6, b.t - a.t); return { cx: lerp(a.cx, b.cx, f), cy: lerp(a.cy, b.cy, f), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), f)) };
    }

    observe(det, t, view) {
      if (!det) return;
      if (!this.st && view) this._init(view); if (!this.st) return;
      const tf = t - this.options.latency, s = this._stateAt(tf) || this.st;
      const wx = s.cx + (det.cx - 0.5) / s.z, wy = s.cy + (det.cy - 0.5) / s.z, hw = det.h / s.z, rWorld = Math.pow(0.018 / s.z, 2) + 1e-6;
      const fresh = this.lastSeen === -Infinity || t - this.lastSeen > this.options.lostHold || this.kx.x === null;
      const jump = !fresh && Math.hypot(wx - this.kx.at(tf), wy - this.ky.at(tf)) > 0.3; // outro alvo: recomeça do ponto novo
      if (fresh || jump || det.kind !== this.kind) { this.kx.init(wx, tf, rWorld); this.ky.init(wy, tf, rWorld); this.hw = hw; this.mv = { x: false, y: false, z: this.mv.z }; }
      else { this.kx.predict(tf); this.ky.predict(tf); this.kx.update(wx, rWorld); this.ky.update(wy, rWorld); this.hw = Math.exp(lerp(Math.log(this.hw), Math.log(hw), 0.35)); }
      this.kt = tf; this.kind = det.kind; this.lastSeen = t;
    }

    tick(view, t) {
      const o = this.options, sp = SPEEDS[o.speed] || SPEEDS.normal, cz = COMFORT[o.comfort] || COMFORT.media, frame = FRAMES[o.frame] || FRAMES.seguir;
      const dt = this.lastT === null ? 0.04 : clamp(t - this.lastT, 0.005, 0.25); this.lastT = t;
      const out = { state: this.state, atEdge: false, ease: sp.ease };
      if (this.hold > 0) { this.hold = Math.max(0, this.hold - dt); this.st = null; this.sent = null; out.state = this.state = 'hold'; return out; }
      if (!this.st) this._init(view);
      const st = this.st, zmin = view.zoomMin ?? 1, zmax = Math.max(view.zoomMax ?? 8, zmin + 0.1);
      const since = t - this.lastSeen, known = this.kx.x !== null && since < o.lostHold;
      this.state = since < 0.45 ? 'track' : known ? 'lost' : 'search';
      // alvo previsto: a velocidade estimada projeta o caminho; sem ver o alvo ela vai sumindo (para não sair andando sem rumo)
      let px = null, py = null;
      if (known) {
        const vk = since < 0.45 ? 1 : Math.exp(-(since - 0.45) / 0.3), ahead = Math.min(0.5, o.latency * sp.lead), fx = this.kx.v * vk, fy = this.ky.v * vk, dtk = t - this.kt;
        px = this.kx.x + fx * (dtk + ahead); py = this.ky.x + fy * (dtk + ahead);
      }
      const aim = AIM[this.kind] || AIM.person, r = room(st.z);
      // ---- posição: zona de conforto com histerese; dentro dela a câmera fica quieta ----
      let tx = st.cx, ty = st.cy;
      if (px !== null) {
        const ex = (px - st.cx) * st.z - (aim.x - 0.5), ey = (py - st.cy) * st.z - (aim.y - 0.5), zy = { out: cz.out * 0.8, inn: cz.inn * 0.8 };
        if (!this.mv.x && Math.abs(ex) > cz.out) this.mv.x = true; else if (this.mv.x && Math.abs(ex) < cz.inn) this.mv.x = false;
        if (!this.mv.y && Math.abs(ey) > zy.out) this.mv.y = true; else if (this.mv.y && Math.abs(ey) < zy.inn) this.mv.y = false;
        if (this.mv.x) tx = px - (aim.x - 0.5) / st.z; if (this.mv.y) ty = py - (aim.y - 0.5) / st.z;
        out.atEdge = (this.mv.x && Math.abs(tx - 0.5) > r + 1e-6) || (this.mv.y && Math.abs(ty - 0.5) > r + 1e-6);
      } else if (this.state === 'search' && o.lostReturn) { tx = 0.5; ty = 0.5; }
      tx = clamp(tx, 0.5 - r, 0.5 + r); ty = clamp(ty, 0.5 - r, 0.5 + r);
      const lostEase = px === null && o.lostReturn ? 0.4 : 1;
      const X = { x: st.cx, v: st.vx }, Y = { x: st.cy, v: st.vy };
      spring(X, tx, dt, sp.omega * lostEase, sp.vmax, sp.amax); spring(Y, ty, dt, sp.omega * lostEase, sp.vmax, sp.amax);
      // ---- zoom: enquadramento escolhido (em ln, devagar, com histerese); o centro da imagem não se mexe com o zoom ----
      let lzT = Math.log(st.z);
      const matches = frame.h > 0 && frame.src === (this.kind === 'person' ? 'person' : 'face') && this.hw > 0.003 && known;
      if (matches) {
        const want = Math.log(clamp(frame.h / this.hw, zmin, zmax)), err = want - Math.log(st.z);
        if (!this.mv.z && Math.abs(err) > 0.12) this.mv.z = true; else if (this.mv.z && Math.abs(err) < 0.04) this.mv.z = false;
        if (this.mv.z) lzT = want;
      } else if (frame.h === 0 && st.z < 1.05) lzT = Math.log(Math.min(zmax, o.followZoom)); // sem folga não há como seguir
      const Z = { x: Math.log(st.z), v: st.vz }; spring(Z, lzT, dt, sp.zOmega, sp.zVmax, sp.zVmax * 3);
      const z2 = clamp(Math.exp(Z.x), zmin, zmax), r2 = room(z2);
      st.z = z2; st.vz = Z.x !== Math.log(z2) ? 0 : Z.v;
      st.cx = clamp(X.x, 0.5 - r2, 0.5 + r2); st.cy = clamp(Y.x, 0.5 - r2, 0.5 + r2); st.vx = st.cx === X.x ? X.v : 0; st.vy = st.cy === Y.x ? Y.v : 0;
      if (!this.mv.x && Math.abs(st.vx) < 5e-4 && Math.abs(st.cx - tx) < 5e-4) st.vx = 0;
      if (!this.mv.y && Math.abs(st.vy) < 5e-4 && Math.abs(st.cy - ty) < 5e-4) st.vy = 0;
      if (!this.mv.z && Math.abs(st.vz) < 5e-4) st.vz = 0;
      this.hist.push({ t, cx: st.cx, cy: st.cy, z: st.z }); while (this.hist.length > 2 && t - this.hist[0].t > 3) this.hist.shift();
      // ---- só manda o que mudou (e só quando a mudança vale a pena) ----
      const pan = { x: r2 > 1e-6 ? clamp((st.cx - 0.5) / r2, -1, 1) : 0, y: r2 > 1e-6 ? clamp((st.cy - 0.5) / r2, -1, 1) : 0 }, last = this.sent;
      if (!last || Math.abs(pan.x - last.pan.x) > 4e-4 || Math.abs(pan.y - last.pan.y) > 4e-4) out.pan = { x: Math.round(pan.x * 10000) / 10000, y: Math.round(pan.y * 10000) / 10000 };
      if (!last || Math.abs(st.z - last.z) > 1.5e-3) out.zoom = Math.round(st.z * 1000) / 1000;
      if (out.pan || out.zoom) this.sent = { pan: out.pan || last?.pan || pan, z: out.zoom || last?.z || st.z };
      if (out.zoom && !out.pan && r2 > 1e-6) out.pan = { x: Math.round(pan.x * 10000) / 10000, y: Math.round(pan.y * 10000) / 10000 }; // o zoom muda a folga: o pan acompanha
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

  return { Tracker, Kalman1D, MotionDetector, pickSubject, spring, room, travel, FRAMES, AIM, SPEEDS, COMFORT, LATENCY, clamp };
});
