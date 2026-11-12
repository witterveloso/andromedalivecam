'use strict';
/*
 * Andromeda Cam — zoom, balanço de branco e exposição.
 *
 * Cada controle usa o recurso do próprio aparelho quando o navegador o oferece (zoom óptico/da lente,
 * temperatura de cor, compensação de exposição: Chrome no Android na maioria dos aparelhos). Quando não oferece
 * (Safari no iPhone, por exemplo), o mesmo controle é aplicado na imagem, neste celular, antes de ir para a mesa:
 * recorte para o zoom digital e ganhos de cor/brilho em WebGL. Sem nenhum ajuste digital ativo, o vídeo da câmera
 * vai direto, sem processamento.
 *
 * Mesmo arquivo em docs/ (GitHub Pages) e public/cam/ (gateway); test/cam-sync.test.cjs compara as cópias.
 */
(() => {
  const $ = s => document.querySelector(s);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const DIGITAL_ZOOM = { min: 1, max: 4, step: 0.05 };
  const KELVIN = { min: 2500, max: 9000, step: 50 };
  const EV = { min: -2, max: 2, step: 0.1 };
  const WB_PRESETS = [['Tungstênio', 3200], ['Fluorescente', 4000], ['Dia', 5600], ['Nublado', 6500], ['Sombra', 7500]];

  let saved = {};
  try { saved = JSON.parse(prefs.get('optics', '{}')) || {}; } catch { saved = {}; }
  const st = {
    zoom: Number.isFinite(saved.zoom) ? saved.zoom : 1,
    wb: saved.wb === 'manual' ? 'manual' : 'auto', kelvin: Number.isFinite(saved.kelvin) ? saved.kelvin : 5600, tint: Number.isFinite(saved.tint) ? saved.tint : 0,
    exp: saved.exp === 'manual' ? 'manual' : 'auto', ev: Number.isFinite(saved.ev) ? saved.ev : 0,
  };
  let raw = null, caps = {}, proc = null, saveTimer = null;
  const store = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => prefs.set('optics', JSON.stringify(st)), 300); };

  /* ---------- o que o aparelho oferece ---------- */
  const range = c => c && Number.isFinite(c.min) && Number.isFinite(c.max) && c.max > c.min;
  const native = () => ({
    zoom: range(caps.zoom),
    wb: !!caps.whiteBalanceMode?.includes?.('manual') && range(caps.colorTemperature),
    exp: range(caps.exposureCompensation),
  });
  const zoomRange = () => native().zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : DIGITAL_ZOOM;
  const needsDigital = () => { const n = native(); return (!n.zoom && st.zoom > 1.001) || (!n.wb && st.wb === 'manual') || (!n.exp && st.exp === 'manual' && Math.abs(st.ev) > 0.01); };

  /* ---------- controles nativos ---------- */
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
      // Um grupo por vez: um aparelho que recusa um ajuste não derruba os outros.
      for (const g of groups) await raw.applyConstraints({ advanced: [g] }).catch(() => {});
    } finally {
      nativeBusy = false;
      if (nativeAgain) { nativeAgain = false; applyNative(); }
    }
  }

  /* ---------- processamento digital (WebGL) ---------- */
  function kelvinRGB(k) {
    const t = k / 100; let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
    return [r, g, b].map(v => clamp(v, 1, 255) / 255);
  }
  // Temperatura da luz da cena: escolher 3200 K (luz de tungstênio) esfria a imagem; 7500 K (sombra) esquenta.
  function wbGains(kelvin, tint) {
    const ref = kelvinRGB(5600), scene = kelvinRGB(kelvin);
    const gains = ref.map((v, i) => v / scene[i]);
    gains[1] *= 1 - clamp(tint, -100, 100) / 100 * 0.25;
    const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
    return gains.map(v => v / luma);
  }
  function params() {
    const n = native();
    return {
      zoom: n.zoom ? 1 : clamp(st.zoom, 1, DIGITAL_ZOOM.max),
      gain: !n.wb && st.wb === 'manual' ? wbGains(st.kelvin, st.tint) : [1, 1, 1],
      expo: !n.exp && st.exp === 'manual' ? Math.pow(2, clamp(st.ev, EV.min, EV.max)) : 1,
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
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;uniform float z;varying vec2 v;void main(){v=vec2(.5)+p*.5/z;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;uniform vec3 g;uniform float e;void main(){vec3 c=texture2D(t,v).rgb*g*e;gl_FragColor=vec4(min(c,vec3(1.)),1.);}'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const u = { z: gl.getUniformLocation(program, 'z'), g: gl.getUniformLocation(program, 'g'), e: gl.getUniformLocation(program, 'e') };
    let p = params(), stopped = false, frames = 0;
    const draw = () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        // Processamento digital limitado a 1080p (lado maior 1920): em 4K o celular não processaria 30 quadros por
        // segundo e o vídeo engasgaria. Com o zoom digital, a imagem recortada já não teria detalhe de 4K.
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.round(video.videoWidth * scale / 2) * 2, h = Math.round(video.videoHeight * scale / 2) * 2;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        gl.uniform1f(u.z, p.zoom); gl.uniform3fv(u.g, p.gain); gl.uniform1f(u.e, p.expo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); frames++;
      }
      schedule();
    };
    const schedule = () => { if (stopped) return; if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw); else requestAnimationFrame(draw); };
    // Sem taxa fixa: cada quadro desenhado vira um quadro enviado (taxa fixa descartava quadros fora do compasso).
    const track = canvas.captureStream().getVideoTracks()[0];
    canvas.hidden = false; document.body.dataset.optics = 'digital'; schedule();
    return {
      track, frames: () => frames,
      update(next) { p = next; },
      stop() { stopped = true; track.stop(); canvas.hidden = true; delete document.body.dataset.optics; },
    };
  }

  /* ---------- rota do vídeo: câmera direto ou processado ---------- */
  const mediaSender = () => cam.pcs.get('media')?.pc.getSenders().find(s => s.track?.kind === 'video' || (s.track === null && s !== undefined));
  const output = () => proc?.track || raw;
  function route() {
    const want = !!raw && needsDigital();
    if (want && !proc) { proc = makeProcessor(); if (!proc) say('Este navegador não processa vídeo: zoom, cor e brilho digitais indisponíveis. Os controles do aparelho continuam valendo.', 'warn'); }
    if (!want && proc) { proc.stop(); proc = null; }
    proc?.update(params());
    const sender = mediaSender(), out = output();
    if (sender && out && sender.track !== out) sender.replaceTrack(out).catch(e => say('Ajuste de imagem: ' + e.message, 'warn'));
    paintBadge();
  }
  function changed() { store(); applyNative(); route(); paintPanel(); paintZoom(); }

  /* ---------- zoom ---------- */
  function setZoom(value) {
    const r = zoomRange();
    st.zoom = Math.round(clamp(value, r.min, r.max) * 100) / 100;
    changed();
  }
  // Pinça com dois dedos sobre a imagem.
  const touches = new Map(); let pinch = null;
  function pinchStart(e) {
    if (!raw || e.pointerType === 'mouse') return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: st.zoom }; }
  }
  function pinchMove(e) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch.d > 10) setZoom(pinch.zoom * d / pinch.d); }
  }
  function pinchEnd(e) { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; }
  for (const el of [document.body]) {
    el.addEventListener('pointerdown', e => { if (!e.target.closest('button,input,select,dialog,a')) pinchStart(e); });
    el.addEventListener('pointermove', pinchMove); el.addEventListener('pointerup', pinchEnd); el.addEventListener('pointercancel', pinchEnd);
  }

  // Botões de zoom junto das lentes: − valor +. Tocar no valor volta para 1×.
  const zoomBox = make('div', 'zoom'); zoomBox.setAttribute('role', 'group'); zoomBox.setAttribute('aria-label', 'Zoom');
  const zMinus = make('button', 'zoom-step', '−'), zValue = make('button', 'zoom-value', '1×'), zPlus = make('button', 'zoom-step', '+');
  for (const b of [zMinus, zValue, zPlus]) b.type = 'button';
  zMinus.setAttribute('aria-label', 'Menos zoom'); zPlus.setAttribute('aria-label', 'Mais zoom'); zValue.setAttribute('aria-label', 'Zoom atual; toque para voltar a 1×');
  zMinus.onclick = () => setZoom(st.zoom / 1.25); zPlus.onclick = () => setZoom(st.zoom * 1.25); zValue.onclick = () => setZoom(Math.max(1, zoomRange().min));
  zoomBox.append(zPlus, zValue, zMinus);
  const fmt = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: v < 10 ? 1 : 0, maximumFractionDigits: 1 }) + '×';
  function paintZoom() {
    zValue.textContent = fmt(st.zoom);
    const r = zoomRange();
    zMinus.disabled = !raw || st.zoom <= r.min + 0.001; zPlus.disabled = !raw || st.zoom >= r.max - 0.001;
    zoomBox.dataset.kind = native().zoom ? 'lente' : 'digital';
    zoomBox.title = native().zoom ? 'Zoom do aparelho' : 'Zoom digital (recorte da imagem)';
  }

  /* ---------- painel nos Ajustes ---------- */
  const panel = make('div', 'optics');
  function slider(label, r, value, onInput, format) {
    const row = make('label', 'slider'), head = make('span', 'slider-head'), name = make('span', '', label), out = make('output', '', format(value));
    const input = make('input'); Object.assign(input, { type: 'range', min: r.min, max: r.max, step: r.step, value });
    input.oninput = () => { out.textContent = format(Number(input.value)); onInput(Number(input.value)); };
    head.append(name, out); row.append(head, input); return row;
  }
  function segmented(label, options, value, onPick) {
    const box = make('div', 'segmented'); box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', label);
    for (const [id, text] of options) { const b = make('button', '', text); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === value)); b.onclick = () => onPick(id); box.append(b); }
    return box;
  }
  const source = isNative => make('small', 'source', isNative ? 'no aparelho' : 'digital, neste celular');
  function paintPanel() {
    panel.replaceChildren();
    if (!raw) { panel.append(make('p', 'hint', 'Ative a câmera para ver zoom, balanço de branco e exposição deste aparelho.')); return; }
    const n = native(), r = zoomRange();

    const zoom = make('section', 'optic'); const zh = make('h4', '', 'Zoom '); zh.append(source(n.zoom)); zoom.append(zh);
    zoom.append(slider('Zoom', r, st.zoom, v => { st.zoom = v; store(); applyNative(); route(); paintZoom(); }, fmt));
    if (!n.zoom) zoom.append(make('p', 'hint', 'Zoom digital: recorta e amplia a imagem, então perde nitidez. Para aproximar sem perda, prefira a lente Tele, se o aparelho tiver.'));

    const wb = make('section', 'optic'); const wh = make('h4', '', 'Balanço de branco '); wh.append(source(n.wb)); wb.append(wh);
    wb.append(segmented('Balanço de branco', [['auto', 'Automático'], ['manual', 'Manual']], st.wb, v => { st.wb = v; changed(); }));
    if (st.wb === 'manual') {
      const kr = n.wb ? { min: caps.colorTemperature.min, max: caps.colorTemperature.max, step: caps.colorTemperature.step || 50 } : KELVIN;
      wb.append(slider('Temperatura da luz', kr, clamp(st.kelvin, kr.min, kr.max), v => { st.kelvin = v; store(); applyNative(); route(); paintBadge(); }, v => Math.round(v) + ' K'));
      const presets = make('div', 'presets');
      for (const [name, k] of WB_PRESETS) { const b = make('button', '', name + ' · ' + k); b.type = 'button'; b.setAttribute('aria-pressed', String(Math.abs(st.kelvin - k) < 1)); b.onclick = () => { st.kelvin = clamp(k, kr.min, kr.max); changed(); }; presets.append(b); }
      wb.append(presets);
      if (!n.wb) wb.append(slider('Matiz (verde ↔ magenta)', { min: -100, max: 100, step: 1 }, st.tint, v => { st.tint = v; store(); route(); }, v => (v > 0 ? '+' : '') + Math.round(v)));
      wb.append(make('p', 'hint', 'Escolha a temperatura da luz do lugar: tungstênio deixa a imagem mais fria, sombra mais quente. Confira o branco no PREVIEW da mesa.'));
    }

    const ex = make('section', 'optic'); const eh = make('h4', '', 'Exposição '); eh.append(source(n.exp)); ex.append(eh);
    ex.append(segmented('Exposição', [['auto', 'Automática'], ['manual', 'Manual']], st.exp, v => { st.exp = v; changed(); }));
    if (st.exp === 'manual') {
      const er = n.exp ? { min: caps.exposureCompensation.min, max: caps.exposureCompensation.max, step: caps.exposureCompensation.step || 0.1 } : EV;
      ex.append(slider('Compensação', er, clamp(st.ev, er.min, er.max), v => { st.ev = v; store(); applyNative(); route(); paintBadge(); }, v => (v > 0 ? '+' : '') + v.toFixed(1) + ' EV'));
      if (!n.exp) ex.append(make('p', 'hint', 'Exposição digital: clareia ou escurece a imagem já capturada. Não recupera céu estourado nem sombra sem detalhe; na luz difícil, ilumine a cena.'));
      // Recursos avançados do aparelho, quando existirem.
      if (caps.exposureMode?.includes?.('manual') && range(caps.iso)) ex.append(slider('ISO (aparelho)', { min: caps.iso.min, max: caps.iso.max, step: caps.iso.step || 1 }, clamp(raw.getSettings().iso || caps.iso.min, caps.iso.min, caps.iso.max), v => raw.applyConstraints({ advanced: [{ exposureMode: 'manual', iso: v }] }).catch(() => {}), v => String(Math.round(v))));
      if (caps.exposureMode?.includes?.('manual') && range(caps.exposureTime)) ex.append(slider('Obturador (aparelho)', { min: caps.exposureTime.min, max: caps.exposureTime.max, step: caps.exposureTime.step || 1 }, clamp(raw.getSettings().exposureTime || caps.exposureTime.min, caps.exposureTime.min, caps.exposureTime.max), v => raw.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: v }] }).catch(() => {}), v => (v / 10).toFixed(1) + ' ms'));
    }

    const extra = make('section', 'optic');
    if (caps.focusMode?.length > 1) {
      const row = make('label', '', 'Foco'), select = make('select');
      const names = { continuous: 'Automático contínuo', 'single-shot': 'Automático único', manual: 'Manual', none: 'Fixo' };
      for (const v of caps.focusMode) select.add(new Option(names[v] || v, v));
      select.value = raw.getSettings().focusMode || select.value;
      select.onchange = () => raw.applyConstraints({ advanced: [{ focusMode: select.value }] }).catch(e => say(e.message, 'warn'));
      row.append(select); extra.append(row);
    }
    if (range(caps.focusDistance)) extra.append(slider('Distância de foco', { min: caps.focusDistance.min, max: caps.focusDistance.max, step: caps.focusDistance.step || 0.01 }, raw.getSettings().focusDistance || caps.focusDistance.min, v => raw.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: v }] }).catch(() => {}), v => v.toFixed(2)));
    if (caps.torch) { const row = make('label', 'check'), input = make('input'); input.type = 'checkbox'; input.checked = !!raw.getSettings().torch; input.onchange = () => raw.applyConstraints({ advanced: [{ torch: input.checked }] }).catch(e => say(e.message, 'warn')); row.append(input, 'Lanterna'); extra.append(row); }
    const reset = make('button', 'btn ghost', 'Voltar tudo ao automático'); reset.type = 'button';
    reset.onclick = () => { Object.assign(st, { zoom: Math.max(1, zoomRange().min), wb: 'auto', exp: 'auto', ev: 0, tint: 0 }); changed(); };
    extra.append(reset);
    panel.append(zoom, wb, ex, extra);
    if (proc) panel.append(make('p', 'hint', 'Ajuste digital ativo: a imagem é processada neste celular antes de ir para a mesa (gasta um pouco mais de bateria).'));
  }

  // Resumo no visor quando algo sai do automático.
  const badge = make('span', 'optics-badge'); badge.hidden = true;
  function paintBadge() {
    const parts = [];
    if (Math.abs(st.zoom - 1) > 0.01) parts.push(fmt(st.zoom) + (native().zoom ? '' : ' dig.'));
    if (st.wb === 'manual') parts.push('WB ' + Math.round(st.kelvin) + 'K');
    if (st.exp === 'manual') parts.push((st.ev > 0 ? '+' : '') + st.ev.toFixed(1) + ' EV');
    badge.textContent = parts.join(' · '); badge.hidden = !raw || !parts.length;
  }

  /* ---------- ligação com o app ---------- */
  window.AndromedaOptics = {
    // Câmera nova (início ou troca de lente): lê o que o aparelho oferece e reaplica os ajustes.
    attach(track) {
      raw = track; caps = track.getCapabilities?.() || {};
      const r = zoomRange(); st.zoom = clamp(st.zoom, r.min, r.max);
      if (proc) { proc.stop(); proc = null; }
      applyNative(); route(); paintPanel(); paintZoom();
      const manual = $('#manual'); if (manual && !manual.contains(panel)) manual.replaceChildren(panel);
      const tele = $('.telemetry'); if (tele && !tele.contains(badge)) tele.append(badge);
    },
    output: () => output(),
    reset() { if (proc) { proc.stop(); proc = null; } raw = null; caps = {}; paintPanel(); paintZoom(); paintBadge(); },
    lensBar(box) { box.append(zoomBox); box.hidden = false; paintZoom(); },
    state: () => ({ ...st, native: native(), digital: !!proc, frames: proc?.frames() || 0 }),
    set(next) { Object.assign(st, next); changed(); },
  };
  paintPanel(); paintZoom();
})();
