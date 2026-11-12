'use strict';
/*
 * Andromeda Cam — controles de imagem no estilo de câmera profissional.
 *
 * Barra de parâmetros sobre a imagem (LENTE, FORMATO, ZOOM, WB, EXP, ESTAB, ISO/FOCO quando o aparelho oferece).
 * Tocar num parâmetro abre a gaveta de ajuste sobre o visor: o operador mexe e vê o efeito na própria imagem.
 *
 * Cada ajuste usa o recurso do próprio aparelho quando o navegador o oferece; quando não oferece (Safari no
 * iPhone, por exemplo), é aplicado na imagem neste celular, antes do envio, em WebGL:
 *  - zoom digital (recorte), com movimento programado entre pontos 1–4 e velocidade escolhida;
 *  - balanço de branco e exposição (ganhos de cor e brilho);
 *  - estabilização: mede o movimento da imagem quadro a quadro (correlação de blocos em baixa resolução),
 *    separa o tremor da intenção (caminho suavizado) e desloca uma janela de recorte para cancelar só o tremor.
 * Sem nenhum ajuste digital ativo, o vídeo da câmera vai direto, sem processamento.
 *
 * Mesmo arquivo em docs/ (GitHub Pages) e public/cam/ (gateway); test/cam-sync.test.cjs compara as cópias.
 */
(() => {
  const $ = s => document.querySelector(s);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const DIGITAL_ZOOM = { min: 1, max: 4, step: 0.01 };
  const KELVIN = { min: 2500, max: 9000, step: 50 };
  const EV = { min: -2, max: 2, step: 0.1 };
  const WB_PRESETS = [['Tungstênio', 3200], ['Fluor.', 4000], ['Dia', 5600], ['Nublado', 6500], ['Sombra', 7500]];
  const SPEEDS = [['Rápido', 1], ['Médio', 3], ['Lento', 6], ['Muito lento', 10]];
  const STAB = { off: 'Desligada', standard: 'Padrão', strong: 'Forte' };
  const STAB_TUNE = { standard: { margin: 0.07, smooth: 0.94 }, strong: { margin: 0.11, smooth: 0.972 } };

  let saved = {};
  try { saved = JSON.parse(prefs.get('optics', '{}')) || {}; } catch { saved = {}; }
  const num = (v, d) => Number.isFinite(v) ? v : d;
  const st = {
    zoom: num(saved.zoom, 1),
    wb: saved.wb === 'manual' ? 'manual' : 'auto', kelvin: num(saved.kelvin, 5600), tint: num(saved.tint, 0),
    exp: saved.exp === 'manual' ? 'manual' : 'auto', ev: num(saved.ev, 0),
    stab: STAB[saved.stab] ? saved.stab : 'standard',
    points: Array.isArray(saved.points) && saved.points.length === 4 ? saved.points.map(p => Number.isFinite(p) ? p : null) : [1, null, null, null],
    speed: num(saved.speed, 3),
  };
  let raw = null, caps = {}, proc = null, saveTimer = null, open = null, move = null;
  const store = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => prefs.set('optics', JSON.stringify(st)), 300); };

  /* ---------- o que o aparelho oferece ---------- */
  const range = c => c && Number.isFinite(c.min) && Number.isFinite(c.max) && c.max > c.min;
  // Estabilização do aparelho: nenhum navegador padroniza isso ainda; se algum expuser (nome com "stabiliz"), usamos.
  const nativeStabKey = () => Object.keys(caps).find(k => /stabiliz/i.test(k)) || null;
  const native = () => ({
    zoom: range(caps.zoom),
    wb: !!caps.whiteBalanceMode?.includes?.('manual') && range(caps.colorTemperature),
    exp: range(caps.exposureCompensation),
    stab: !!nativeStabKey(),
  });
  const zoomRange = () => native().zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.01 } : DIGITAL_ZOOM;
  const digitalStab = () => st.stab !== 'off' && !native().stab;
  const needsDigital = () => { const n = native(); return (!n.zoom && st.zoom > 1.001) || (!n.wb && st.wb === 'manual') || (!n.exp && st.exp === 'manual' && Math.abs(st.ev) > 0.01) || digitalStab(); };

  /* ---------- controles do aparelho ---------- */
  let nativeBusy = false, nativeAgain = false;
  async function applyNative() {
    if (!raw || raw.readyState !== 'live') return;
    if (nativeBusy) { nativeAgain = true; return; }
    nativeBusy = true;
    try {
      const n = native(), groups = [];
      if (n.zoom) groups.push({ zoom: clamp(st.zoom, caps.zoom.min, caps.zoom.max) });
      if (caps.whiteBalanceMode?.length) {
        if (st.wb === 'manual' && n.wb) groups.push({ whiteBalanceMode: 'manual', colorTemperature: clamp(st.kelvin, caps.colorTemperature.min, caps.colorTemperature.max) });
        else if (caps.whiteBalanceMode.includes('continuous')) groups.push({ whiteBalanceMode: 'continuous' });
      }
      if (n.exp) groups.push({ exposureCompensation: clamp(st.exp === 'manual' ? st.ev : 0, caps.exposureCompensation.min, caps.exposureCompensation.max) });
      const sk = nativeStabKey();
      if (sk) { const opts = Array.isArray(caps[sk]) ? caps[sk] : null; const want = st.stab === 'off' ? (opts?.find(o => /off|none/i.test(o)) ?? false) : (opts?.find(o => /cinematic|standard|auto|on/i.test(o)) ?? true); groups.push({ [sk]: want }); }
      // Um grupo por vez: um aparelho que recusa um ajuste não derruba os outros.
      for (const g of groups) await raw.applyConstraints({ advanced: [g] }).catch(() => {});
    } finally { nativeBusy = false; if (nativeAgain) { nativeAgain = false; applyNative(); } }
  }

  /* ---------- cor e brilho digitais ---------- */
  function kelvinRGB(k) {
    const t = k / 100; let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
    return [r, g, b].map(v => clamp(v, 1, 255) / 255);
  }
  // Temperatura da luz da cena: 3200 K (tungstênio) esfria a imagem; 7500 K (sombra) esquenta.
  function wbGains(kelvin, tint) {
    const ref = kelvinRGB(5600), scene = kelvinRGB(kelvin), gains = ref.map((v, i) => v / scene[i]);
    gains[1] *= 1 - clamp(tint, -100, 100) / 100 * 0.25;
    const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
    return gains.map(v => v / luma);
  }

  /* ---------- estabilização digital ---------- */
  // Mede o deslocamento global entre quadros em baixa resolução (busca grossa ±6 px em 64 de largura e refino ±2 em
  // 128), acumula o caminho da imagem, suaviza (o que é intenção: panorâmica, inclinação) e corrige só a diferença
  // (o tremor), dentro de uma margem de recorte. Panorâmicas continuam acontecendo, só que sem tremer.
  function makeStabilizer() {
    // Análise em 256×144 (ou 144×256 na vertical): busca grossa ±6 px na metade da resolução, refino ±2 px e
    // posição subpixel por interpolação parabólica do erro. Precisão de cerca de 1 px num quadro de 1280.
    const A = make('canvas'); A.width = 256; A.height = 144;
    const actx = A.getContext('2d', { willReadFrequently: true });
    let prev = null, prevSmall = null, w = 256, h = 144;
    let qx = 0, qy = 0, sx = 0, sy = 0, cx = 0, cy = 0, lowConf = 0;
    const gray = data => { const out = new Uint8Array(data.length / 4); for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8; return out; };
    const half = (src, W, H) => { const ow = W >> 1, oh = H >> 1, out = new Uint8Array(ow * oh); for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) { const i = y * 2 * W + x * 2; out[y * ow + x] = (src[i] + src[i + 1] + src[i + W] + src[i + W + 1]) >> 2; } return out; };
    function sad(a, b, W, H, dx, dy, margin, step) {
      let s = 0, n = 0;
      for (let y = margin; y < H - margin; y += step) { const ya = y * W, yb = (y + dy) * W + dx; for (let x = margin; x < W - margin; x += step) { s += Math.abs(a[ya + x] - b[yb + x]); n++; } }
      return n ? s / n : Infinity;
    }
    function search(a, b, W, H, ox, oy, r, margin, step) {
      const grid = new Map(); let best = Infinity, bx = ox, by = oy;
      for (let dy = oy - r; dy <= oy + r; dy++) for (let dx = ox - r; dx <= ox + r; dx++) { const v = sad(a, b, W, H, dx, dy, margin, step); grid.set(dx + ',' + dy, v); if (v < best) { best = v; bx = dx; by = dy; } }
      let second = Infinity; for (const [k, v] of grid) { const [x, y] = k.split(',').map(Number); if (Math.abs(x - bx) > 1 || Math.abs(y - by) > 1) second = Math.min(second, v); }
      // Subpixel: parábola pelos vizinhos do mínimo.
      const at = (x, y) => grid.get(x + ',' + y) ?? sad(a, b, W, H, x, y, margin, step);
      const sub = (m, c, p) => { const d = m - 2 * c + p; return d > 1e-6 ? clamp((m - p) / (2 * d), -0.5, 0.5) : 0; };
      return { dx: bx + sub(at(bx - 1, by), best, at(bx + 1, by)), dy: by + sub(at(bx, by - 1), best, at(bx, by + 1)), best, second };
    }
    return {
      // Devolve o deslocamento da janela (fração do quadro) e a escala de recorte.
      update(video, mode) {
        const tune = STAB_TUNE[mode] || STAB_TUNE.standard;
        const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return { ox: 0, oy: 0, scale: 1 };
        const nw = vw >= vh ? 256 : 144, nh = vw >= vh ? 144 : 256;
        if (nw !== w || nh !== h) { w = A.width = nw; h = A.height = nh; prev = prevSmall = null; }
        actx.drawImage(video, 0, 0, w, h);
        const cur = gray(actx.getImageData(0, 0, w, h).data), curSmall = half(cur, w, h);
        let dx = 0, dy = 0;
        if (prev) {
          const coarse = search(prevSmall, curSmall, w >> 1, h >> 1, 0, 0, 6, 12, 1);
          const fine = search(prev, cur, w, h, Math.round(coarse.dx) * 2, Math.round(coarse.dy) * 2, 2, 28, 2);
          // Imagem lisa (céu, parede) ou mudança brusca de cena: sem confiança, este quadro não corrige.
          const confident = fine.best < 45 && fine.second - fine.best > 0.5 && Math.abs(fine.dx) < 24 && Math.abs(fine.dy) < 24;
          if (confident) { dx = fine.dx / w; dy = fine.dy / h; lowConf = 0; } else lowConf++;
        }
        prev = cur; prevSmall = curSmall;
        // Caminho do conteúdo (q), caminho suavizado (s) e correção: a janela acompanha o tremor, não a intenção.
        qx += dx; qy += dy;
        const k = tune.smooth; sx = k * sx + (1 - k) * qx; sy = k * sy + (1 - k) * qy;
        const m = tune.margin;
        // Perto do limite da margem, o caminho suavizado se aproxima para a janela não bater na borda.
        if (Math.abs(qx - sx) > m * 0.85) sx = qx - Math.sign(qx - sx) * m * 0.85;
        if (Math.abs(qy - sy) > m * 0.85) sy = qy - Math.sign(qy - sy) * m * 0.85;
        if (lowConf > 15) { sx = qx; sy = qy; }
        cx = clamp(qx - sx, -m, m); cy = clamp(qy - sy, -m, m);
        return { ox: cx, oy: cy, scale: 1 / (1 - 2 * m) };
      },
      reset() { prev = prevSmall = null; qx = qy = sx = sy = cx = cy = 0; },
    };
  }

  /* ---------- processamento digital (WebGL) ---------- */
  function params() {
    const n = native();
    return {
      zoom: n.zoom ? 1 : clamp(st.zoom, 1, DIGITAL_ZOOM.max),
      gain: !n.wb && st.wb === 'manual' ? wbGains(st.kelvin, st.tint) : [1, 1, 1],
      expo: !n.exp && st.exp === 'manual' ? Math.pow(2, clamp(st.ev, EV.min, EV.max)) : 1,
      stab: digitalStab() ? st.stab : 'off',
    };
  }
  function makeProcessor() {
    const video = $('#view'), settings = raw.getSettings();
    let canvas = $('#viewProc');
    if (!canvas) { canvas = make('canvas'); canvas.id = 'viewProc'; canvas.setAttribute('aria-hidden', 'true'); video.after(canvas); }
    { const sw = settings.width || video.videoWidth || 1280, sh = settings.height || video.videoHeight || 720, k = Math.min(1, 1920 / Math.max(sw, sh)); canvas.width = Math.round(sw * k / 2) * 2; canvas.height = Math.round(sh * k / 2) * 2; }
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl || !canvas.captureStream) return null;
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;uniform float z;uniform vec2 o;varying vec2 v;void main(){v=vec2(.5)+o+p*.5/z;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;uniform vec3 g;uniform float e;void main(){vec3 c=texture2D(t,clamp(v,0.,1.)).rgb*g*e;gl_FragColor=vec4(min(c,vec3(1.)),1.);}'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const u = { z: gl.getUniformLocation(program, 'z'), o: gl.getUniformLocation(program, 'o'), g: gl.getUniformLocation(program, 'g'), e: gl.getUniformLocation(program, 'e') };
    const stabilizer = makeStabilizer();
    let p = params(), stopped = false, frames = 0, shake = 0;
    const draw = () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        // Processamento limitado a 1080p (lado maior 1920): em 4K o celular não manteria 30 quadros por segundo.
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.round(video.videoWidth * scale / 2) * 2, h = Math.round(video.videoHeight * scale / 2) * 2;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const s = p.stab !== 'off' ? stabilizer.update(video, p.stab) : { ox: 0, oy: 0, scale: 1 };
        shake = Math.hypot(s.ox, s.oy);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        // Linhas da imagem descem; com a textura invertida, o deslocamento vertical troca de sinal.
        gl.uniform1f(u.z, p.zoom * s.scale); gl.uniform2f(u.o, s.ox, -s.oy); gl.uniform3fv(u.g, p.gain); gl.uniform1f(u.e, p.expo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); frames++;
      }
      schedule();
    };
    const schedule = () => { if (stopped) return; if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw); else requestAnimationFrame(draw); };
    // Sem taxa fixa: cada quadro desenhado vira um quadro enviado.
    const track = canvas.captureStream().getVideoTracks()[0];
    canvas.hidden = false; document.body.dataset.optics = 'digital'; schedule();
    return {
      track, frames: () => frames, shake: () => shake,
      update(next) { if (next.stab !== p.stab) stabilizer.reset(); p = next; },
      stop() { stopped = true; track.stop(); canvas.hidden = true; delete document.body.dataset.optics; },
    };
  }

  /* ---------- rota do vídeo: câmera direto ou processado ---------- */
  const mediaSender = () => cam.pcs.get('media')?.pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
  const output = () => proc?.track || raw;
  function route() {
    const want = !!raw && needsDigital();
    if (want && !proc) { proc = makeProcessor(); if (!proc) say('Este navegador não processa vídeo: ajustes digitais indisponíveis. Os controles do aparelho continuam valendo.', 'warn'); }
    if (!want && proc) { proc.stop(); proc = null; }
    proc?.update(params());
    const sender = mediaSender(), out = output();
    if (sender && out && sender.track !== out) sender.replaceTrack(out).catch(e => say('Ajuste de imagem: ' + e.message, 'warn'));
    paintBar();
  }
  function changed() { store(); applyNative(); route(); paintBar(); if (open) paintDrawer(); }

  /* ---------- zoom: barra, pinça e movimento programado ---------- */
  function setZoom(value, quiet) {
    const r = zoomRange();
    st.zoom = Math.round(clamp(value, r.min, r.max) * 1000) / 1000;
    store(); applyNative(); route(); paintBar(); if (!quiet && open === 'zoom') paintZoomLive();
  }
  // Curva suave (começa e termina devagar), como um zoom servo de câmera de estúdio.
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function zoomTo(target, seconds) {
    stopMove();
    const from = st.zoom, to = clamp(target, zoomRange().min, zoomRange().max), dur = Math.max(.2, seconds) * 1000, t0 = performance.now();
    if (Math.abs(to - from) < 0.001) return;
    // Interpolação em escala logarítmica: a velocidade aparente do zoom fica constante, como numa objetiva.
    const lf = Math.log(from), lt = Math.log(to);
    move = { to, raf: 0 };
    const step = now => {
      if (!move) return;
      const k = clamp((now - t0) / dur, 0, 1);
      setZoom(Math.exp(lf + (lt - lf) * ease(k)), false);
      if (k < 1) move.raf = requestAnimationFrame(step); else { move = null; paintBar(); if (open === 'zoom') paintDrawer(); }
    };
    move.raf = requestAnimationFrame(step); paintBar(); if (open === 'zoom') paintDrawer();
  }
  function stopMove() { if (move) { cancelAnimationFrame(move.raf); move = null; } }
  // Pinça com dois dedos sobre a imagem.
  const touches = new Map(); let pinch = null;
  document.body.addEventListener('pointerdown', e => {
    if (!raw || e.pointerType === 'mouse' || e.target.closest('button,input,select,dialog,a,.drawer,.params')) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { stopMove(); const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: st.zoom }; }
  });
  document.body.addEventListener('pointermove', e => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, [e.clientX, e.clientY]); if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch.d > 10) setZoom(pinch.zoom * d / pinch.d); } });
  for (const ev of ['pointerup', 'pointercancel']) document.body.addEventListener(ev, e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; });

  /* ---------- barra de parâmetros ---------- */
  const fmtZoom = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
  const fmtEV = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const bar = make('div', 'params-row'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Ajustes da câmera');
  const items = {};
  function param(id, label) {
    const b = make('button', 'param'); b.type = 'button'; b.dataset.param = id;
    const l = make('span', 'param-label', label), a = make('b', 'param-auto', 'A'), v = make('span', 'param-value', '—');
    l.append(a); b.append(l, v); b.onclick = () => toggle(id); bar.append(b);
    items[id] = { b, v, a }; return b;
  }
  param('lens', 'LENTE'); param('format', 'FORMATO'); param('zoom', 'ZOOM'); param('wb', 'WB'); param('exp', 'EXP'); param('stab', 'ESTAB'); param('iso', 'ISO'); param('focus', 'FOCO');
  function paintBar() {
    const n = native(), s = raw?.getSettings?.() || {};
    const lensChip = $('#lensChips .lens[aria-checked="true"]'), lensOpt = $('#lens')?.selectedOptions?.[0];
    set('lens', lensChip?.textContent || (lensOpt && typeof lensInfo === 'function' ? lensInfo(lensOpt.text, 0).name : '—'), false);
    set('format', s.height ? Math.min(s.width, s.height) + 'p · ' + Math.round(s.frameRate || 0) : '—', false);
    set('zoom', (move ? '▸ ' : '') + fmtZoom(st.zoom) + (n.zoom || st.zoom <= 1.001 ? '' : ' dig'), false);
    set('wb', st.wb === 'manual' ? Math.round(st.kelvin) + 'K' : (s.colorTemperature ? Math.round(s.colorTemperature) + 'K' : 'Auto'), st.wb !== 'manual');
    set('exp', st.exp === 'manual' ? fmtEV(st.ev) : (Number.isFinite(s.exposureCompensation) ? fmtEV(s.exposureCompensation) : '0.0'), st.exp !== 'manual');
    set('stab', st.stab === 'off' ? 'OFF' : STAB[st.stab] + (n.stab ? '' : ''), false);
    items.iso.b.hidden = !range(caps.iso); if (range(caps.iso)) set('iso', String(Math.round(s.iso || caps.iso.min)), caps.exposureMode?.includes?.('manual') ? s.exposureMode !== 'manual' : true);
    items.focus.b.hidden = !(caps.focusMode?.length > 1); if (!items.focus.b.hidden) set('focus', s.focusMode === 'manual' ? 'MF' : 'AF', s.focusMode !== 'manual');
    for (const [id, it] of Object.entries(items)) it.b.setAttribute('aria-expanded', String(open === id));
    paintBadge();
    function set(id, value, auto) { items[id].v.textContent = value; items[id].a.hidden = !auto; }
  }

  /* ---------- gaveta de ajuste sobre o visor ---------- */
  const drawer = make('section', 'drawer'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'false'); drawer.hidden = true;
  const dHead = make('header', 'drawer-head'), dTitle = make('strong'), dSource = make('small', 'drawer-source'), dClose = make('button', 'drawer-close', '✕');
  dClose.type = 'button'; dClose.setAttribute('aria-label', 'Fechar ajuste'); dClose.onclick = () => toggle(null);
  dHead.append(dTitle, dSource, dClose);
  const dBody = make('div', 'drawer-body'); drawer.append(dHead, dBody);
  function toggle(id) { open = open === id ? null : id; drawer.hidden = !open; document.body.dataset.drawer = open || ''; paintBar(); if (open) paintDrawer(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(null); });

  function slider(r, value, onInput, format, label) {
    const row = make('div', 'slider'), out = make('output', 'slider-value', format(value)), input = make('input');
    Object.assign(input, { type: 'range', min: r.min, max: r.max, step: r.step, value }); input.setAttribute('aria-label', label);
    input.oninput = () => { out.textContent = format(Number(input.value)); onInput(Number(input.value)); };
    row.append(input, out); return { row, input, out };
  }
  function segmented(label, options, value, onPick) {
    const box = make('div', 'segmented'); box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', label);
    for (const [id, text] of options) { const b = make('button', '', text); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === value)); b.onclick = () => onPick(id); box.append(b); }
    return box;
  }
  const source = isNative => isNative ? 'no aparelho' : 'digital · neste celular';
  let zoomLive = null;
  function paintZoomLive() { if (!zoomLive) return; zoomLive.input.value = st.zoom; zoomLive.out.textContent = fmtZoom(st.zoom); }
  function paintDrawer() {
    dBody.replaceChildren(); zoomLive = null;
    const n = native();
    if (!raw) { dTitle.textContent = 'Ajustes'; dSource.textContent = ''; dBody.append(make('p', 'drawer-hint', 'Ative a câmera para ajustar.')); return; }
    if (open === 'lens') {
      dTitle.textContent = 'Lente'; dSource.textContent = 'lentes físicas deste aparelho';
      const box = make('div', 'chips');
      for (const chip of document.querySelectorAll('#lensChips .lens')) { const b = make('button', '', chip.textContent); b.type = 'button'; b.setAttribute('aria-pressed', chip.getAttribute('aria-checked')); b.onclick = () => { chip.click(); setTimeout(paintDrawer, 600); }; box.append(b); }
      dBody.append(box, make('p', 'drawer-hint', 'Trocar de lente reabre a câmera por um instante. Zoom, cor e estabilização continuam como estão.'));
    } else if (open === 'format') {
      dTitle.textContent = 'Formato'; dSource.textContent = 'vale na hora';
      const res = $('#resolution'), fps = $('#fps');
      dBody.append(segmented('Resolução', [...res.options].map(o => [o.value, o.text.replace(' · se disponível', '')]), res.value, v => { res.value = v; res.onchange?.(); setTimeout(paintDrawer, 1500); }),
        segmented('Quadros por segundo', [...fps.options].map(o => [o.value, o.text + ' fps']), fps.value, v => { fps.value = v; fps.onchange?.(); setTimeout(paintDrawer, 1500); }),
        make('p', 'drawer-hint', 'Formato real: ' + ($('#qualityActual')?.textContent || '—') + '. Se o aparelho não entregar o pedido, ele avisa.'));
    } else if (open === 'zoom') {
      const r = zoomRange();
      dTitle.textContent = 'Zoom'; dSource.textContent = n.zoom ? 'óptico/da lente' : 'digital · recorte';
      zoomLive = slider(r, st.zoom, v => { stopMove(); setZoom(v, true); }, fmtZoom, 'Zoom');
      zoomLive.row.classList.add('zoom-slider');
      dBody.append(zoomLive.row);
      // Movimento programado: pontos 1–4 e velocidade.
      const prog = make('div', 'zoom-prog'), pts = make('div', 'zoom-points'), saving = make('button', 'zoom-save', 'Gravar ponto');
      saving.type = 'button'; saving.setAttribute('aria-pressed', 'false');
      saving.onclick = () => saving.setAttribute('aria-pressed', String(saving.getAttribute('aria-pressed') !== 'true'));
      st.points.forEach((v, i) => {
        const b = make('button', 'zoom-point'); b.type = 'button';
        b.append(make('b', '', String(i + 1)), make('span', '', v ? fmtZoom(v) : '—'));
        b.setAttribute('aria-label', 'Ponto ' + (i + 1) + (v ? ' · ' + fmtZoom(v) : ' vazio'));
        b.onclick = () => {
          if (saving.getAttribute('aria-pressed') === 'true' || st.points[i] === null) { st.points[i] = st.zoom; store(); saving.setAttribute('aria-pressed', 'false'); paintDrawer(); say('Ponto ' + (i + 1) + ' gravado em ' + fmtZoom(st.zoom) + '.', 'ok'); return; }
          zoomTo(st.points[i], st.speed);
        };
        pts.append(b);
      });
      const speeds = segmented('Velocidade do movimento', SPEEDS.map(([t, s]) => [String(s), t + ' · ' + s + ' s']), String(st.speed), v => { st.speed = Number(v); store(); paintDrawer(); });
      const custom = slider({ min: 0.5, max: 20, step: 0.5 }, st.speed, v => { st.speed = v; store(); }, v => v.toFixed(1) + ' s', 'Duração do movimento');
      const stopB = make('button', 'zoom-stop', move ? 'Parar movimento' : 'Movimento parado'); stopB.type = 'button'; stopB.disabled = !move; stopB.onclick = () => { stopMove(); paintBar(); paintDrawer(); };
      const actions = make('div', 'zoom-actions'); actions.append(saving, stopB);
      prog.append(make('span', 'drawer-label', 'Movimento programado · toque num ponto'), pts, actions, speeds, custom.row);
      dBody.append(prog, make('p', 'drawer-hint', 'Toque num ponto para ir até ele com a velocidade escolhida, em curva suave. Para mudar um ponto: "Gravar ponto" e toque nele. Pinça com dois dedos também dá zoom.' + (n.zoom ? '' : ' Zoom digital perde nitidez; para aproximar sem perda, prefira a lente Tele.')));
    } else if (open === 'wb') {
      dTitle.textContent = 'Balanço de branco'; dSource.textContent = source(n.wb);
      dBody.append(segmented('Modo', [['auto', 'Automático'], ['manual', 'Manual']], st.wb, v => { st.wb = v; changed(); }));
      if (st.wb === 'manual') {
        const kr = n.wb ? { min: caps.colorTemperature.min, max: caps.colorTemperature.max, step: caps.colorTemperature.step || 50 } : KELVIN;
        dBody.append(slider(kr, clamp(st.kelvin, kr.min, kr.max), v => { st.kelvin = v; store(); applyNative(); route(); }, v => Math.round(v) + ' K', 'Temperatura').row);
        const presets = make('div', 'chips');
        for (const [name, k] of WB_PRESETS) { const b = make('button', '', name + ' ' + k); b.type = 'button'; b.setAttribute('aria-pressed', String(Math.abs(st.kelvin - k) < 1)); b.onclick = () => { st.kelvin = clamp(k, kr.min, kr.max); changed(); }; presets.append(b); }
        dBody.append(presets);
        if (!n.wb) dBody.append(make('span', 'drawer-label', 'Matiz (verde ↔ magenta)'), slider({ min: -100, max: 100, step: 1 }, st.tint, v => { st.tint = v; store(); route(); }, v => (v > 0 ? '+' : '') + Math.round(v), 'Matiz').row);
      }
    } else if (open === 'exp') {
      dTitle.textContent = 'Exposição'; dSource.textContent = source(n.exp);
      dBody.append(segmented('Modo', [['auto', 'Automática'], ['manual', 'Manual']], st.exp, v => { st.exp = v; changed(); }));
      if (st.exp === 'manual') {
        const er = n.exp ? { min: caps.exposureCompensation.min, max: caps.exposureCompensation.max, step: caps.exposureCompensation.step || 0.1 } : EV;
        dBody.append(slider(er, clamp(st.ev, er.min, er.max), v => { st.ev = v; store(); applyNative(); route(); paintBar(); }, v => fmtEV(v) + ' EV', 'Compensação').row);
        if (!n.exp) dBody.append(make('p', 'drawer-hint', 'Digital: clareia ou escurece a imagem capturada; não recupera céu estourado nem sombra sem detalhe.'));
        if (caps.exposureMode?.includes?.('manual') && range(caps.exposureTime)) { const r = caps.exposureTime; dBody.append(make('span', 'drawer-label', 'Obturador (aparelho)'), slider({ min: r.min, max: r.max, step: r.step || 1 }, clamp(raw.getSettings().exposureTime || r.min, r.min, r.max), v => raw.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: v }] }).catch(() => {}), v => (v / 10).toFixed(1) + ' ms', 'Obturador').row); }
      }
    } else if (open === 'iso') {
      const r = caps.iso; dTitle.textContent = 'ISO'; dSource.textContent = 'no aparelho';
      dBody.append(slider({ min: r.min, max: r.max, step: r.step || 1 }, clamp(raw.getSettings().iso || r.min, r.min, r.max), v => raw.applyConstraints({ advanced: [{ exposureMode: 'manual', iso: v }] }).then(paintBar, () => {}), v => String(Math.round(v)), 'ISO').row);
      const autoB = make('button', 'chip-auto', 'Voltar ao automático'); autoB.type = 'button'; autoB.onclick = () => raw.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] }).then(() => { paintBar(); paintDrawer(); }, () => {});
      dBody.append(autoB);
    } else if (open === 'focus') {
      dTitle.textContent = 'Foco'; dSource.textContent = 'no aparelho';
      const names = { continuous: 'AF contínuo', 'single-shot': 'AF único', manual: 'Manual', none: 'Fixo' };
      dBody.append(segmented('Foco', caps.focusMode.map(v => [v, names[v] || v]), raw.getSettings().focusMode || '', v => raw.applyConstraints({ advanced: [{ focusMode: v }] }).then(() => { paintBar(); paintDrawer(); }, e => say(e.message, 'warn'))));
      if (range(caps.focusDistance)) { const r = caps.focusDistance; dBody.append(make('span', 'drawer-label', 'Distância'), slider({ min: r.min, max: r.max, step: r.step || 0.01 }, raw.getSettings().focusDistance || r.min, v => raw.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: v }] }).catch(() => {}), v => v.toFixed(2), 'Distância de foco').row); }
      if (caps.torch) { const t = make('button', 'chip-auto', raw.getSettings().torch ? 'Desligar lanterna' : 'Ligar lanterna'); t.type = 'button'; t.onclick = () => raw.applyConstraints({ advanced: [{ torch: !raw.getSettings().torch }] }).then(paintDrawer, () => {}); dBody.append(t); }
    } else if (open === 'stab') {
      dTitle.textContent = 'Estabilização'; dSource.textContent = n.stab ? 'do aparelho' : 'Andrômeda · análise de imagem';
      dBody.append(segmented('Estabilização', Object.entries(STAB), st.stab, v => { st.stab = v; changed(); }));
      dBody.append(make('p', 'drawer-hint', n.stab
        ? 'Usando a estabilização do próprio aparelho.'
        : 'O navegador não dá acesso à estabilização do aparelho; esta é a do Andrômeda Cam: mede o movimento da imagem a cada quadro, mantém panorâmicas e inclinações intencionais e cancela só o tremor. Ela recorta ' + Math.round(STAB_TUNE.standard.margin * 200) + '% (Padrão) ou ' + Math.round(STAB_TUNE.strong.margin * 200) + '% (Forte) da borda para ter folga. Funciona melhor com a câmera na mão ou em bastão; em tripé, desligue.'));
    }
  }

  // Resumo no visor quando algo sai do automático.
  const badge = make('span', 'optics-badge'); badge.hidden = true;
  function paintBadge() {
    const parts = [];
    if (Math.abs(st.zoom - 1) > 0.01) parts.push(fmtZoom(st.zoom) + (native().zoom ? '' : ' dig.'));
    if (st.wb === 'manual') parts.push('WB ' + Math.round(st.kelvin) + 'K');
    if (st.exp === 'manual') parts.push(fmtEV(st.ev) + ' EV');
    if (st.stab !== 'off') parts.push('EST ' + (st.stab === 'strong' ? 'forte' : 'on'));
    badge.textContent = parts.join(' · '); badge.hidden = !raw || !parts.length;
  }

  /* ---------- ligação com o app ---------- */
  function mount() {
    const host = $('#params'); if (host && !host.contains(bar)) host.append(bar);
    if (!document.body.contains(drawer)) document.body.append(drawer);
    const tele = $('.telemetry'); if (tele && !tele.contains(badge)) tele.append(badge);
  }
  mount(); paintBar();
  window.AndromedaOptics = {
    // Câmera nova (início ou troca de lente): lê o que o aparelho oferece e reaplica os ajustes.
    attach(track) {
      raw = track; caps = track.getCapabilities?.() || {};
      const r = zoomRange(); st.zoom = clamp(st.zoom, r.min, r.max);
      if (proc) { proc.stop(); proc = null; }
      mount(); applyNative(); route(); paintBar(); if (open) paintDrawer();
    },
    output: () => output(),
    reset() { stopMove(); if (proc) { proc.stop(); proc = null; } raw = null; caps = {}; if (open) toggle(null); paintBar(); },
    lensBar() { paintBar(); },
    zoomTo, open: id => { if (open !== id) toggle(id); }, close: () => { if (open) toggle(null); },
    state: () => ({ ...st, native: native(), digital: !!proc, frames: proc?.frames() || 0, shake: proc?.shake() || 0, moving: !!move, drawer: open }),
    set(next) { Object.assign(st, next); changed(); },
  };
})();
