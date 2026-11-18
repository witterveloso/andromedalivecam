'use strict';
/*
 * TRACKING · a câmera segue a pessoa ou o movimento (painel Controle de câmera).
 *
 * A mesa olha a imagem que chega do celular (Andromeda Cam), acha o alvo (rosto, pessoa ou o que se mexe) e manda ao celular o
 * pan e o zoom que o mantêm no quadro, como um operador de câmera. O reconhecimento roda neste computador (MediaPipe, embutido,
 * sem internet e sem enviar a imagem a ninguém). Cálculo em tracking-core.js.
 * Nasce DESLIGADO em cada câmera; mexer à mão no pan, zoom ou lente pausa o tracking por alguns segundos.
 */
(() => {
  const Core = window.andromedaTrackingCore, CC = window.andromedaCamCtl, panel = typeof camCtlPanel !== 'undefined' ? camCtlPanel : null;
  const host = panel?.querySelector('#camCtlTrackHost'); if (!Core || !CC || !host) return;
  const KEY = 'andromeda.tracking.v1';
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const saved = store.get(KEY, {});
  const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };

  /* ---------- configuração por câmera (o liga/desliga nunca é salvo: a câmera nasce parada) ---------- */
  const slots = new Map();
  function slotOf(i) {
    if (!slots.has(i)) {
      const cfg = { target: 'face', frame: 'seguir', speed: 'normal', comfort: 'media', net: 'normal', lostReturn: false, ...(saved[i] || {}) };
      slots.set(i, { i, cfg, on: false, tracker: new Core.Tracker({ frame: cfg.frame, speed: cfg.speed, comfort: cfg.comfort, latency: (Core.LATENCY[cfg.net] || Core.LATENCY.normal).value, lostReturn: cfg.lostReturn }), view: null, ctl: { out: null, paintAt: 0 }, dets: [], subject: null, last: null, lastAt: 0, period: 110, busy: false, status: '', fps: 0, frames: [], motion: new Core.MotionDetector(96, 54), error: '', dims: null });
    }
    return slots.get(i);
  }
  const persist = () => store.set(KEY, Object.fromEntries([...slots].map(([i, s]) => [i, s.cfg])));
  const currentSlot = () => (typeof camCtl !== 'undefined' ? camCtl.slot : 0);
  const effectiveTarget = s => (Core.FRAMES[s.cfg.frame]?.src === 'person' ? 'person' : Core.FRAMES[s.cfg.frame]?.src === 'face' ? 'face' : s.cfg.target);

  /* ---------- reconhecimento (carrega só quando alguém liga o tracking) ---------- */
  let vision = null; const detectors = {};
  const loadVision = () => vision || (vision = (async () => { const m = await import('/vendor/mediapipe/vision_bundle.mjs'); return { m, fileset: await m.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm') }; })());
  async function detector(kind) {
    const v = await loadVision();
    if (!detectors[kind]) detectors[kind] = kind === 'face'
      ? v.m.FaceDetector.createFromOptions(v.fileset, { baseOptions: { modelAssetPath: '/vendor/mediapipe/models/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 })
      : v.m.ObjectDetector.createFromOptions(v.fileset, { baseOptions: { modelAssetPath: '/vendor/mediapipe/models/efficientdet_lite0.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', scoreThreshold: 0.4, maxResults: 6, categoryAllowlist: ['person'] });
    return detectors[kind];
  }
  const grabCanvas = document.createElement('canvas'); grabCanvas.width = 96; grabCanvas.height = 54; const grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true });
  const feed = document.createElement('canvas'), feedCtx = feed.getContext('2d');
  let lastStamp = 0;
  async function detect(s) {
    const el = typeof media !== 'undefined' ? media[s.i]?.element : null, W = el ? (el.videoWidth || el.naturalWidth || 0) : 0, H = el ? (el.videoHeight || el.naturalHeight || 0) : 0;
    if (!el || !W || !H || (typeof cams !== 'undefined' && cams[s.i]?.conn === false)) return null;
    const kind = effectiveTarget(s);
    if (kind === 'motion') {
      grabCtx.drawImage(el, 0, 0, 96, 54); const px = grabCtx.getImageData(0, 0, 96, 54).data, gray = new Uint8Array(96 * 54);
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
      const d = s.motion.update(gray); return d ? [d] : [];
    }
    const det = await detector(kind), stamp = Math.max(performance.now(), lastStamp + 1); lastStamp = stamp;
    // Fontes que não são <video> (imagem de entrada Blackmagic, por exemplo) passam por uma tela intermediária.
    let src = el; if (!(el instanceof HTMLVideoElement)) { feed.width = Math.min(960, W); feed.height = Math.round(feed.width * H / W); feedCtx.drawImage(el, 0, 0, feed.width, feed.height); src = feed; }
    if (kind === 'face') return det.detectForVideo(src, stamp).detections.map(d => { const b = d.boundingBox; return { cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height / 2) / H, w: b.width / W, h: b.height / H, kind: 'face', score: d.categories?.[0]?.score || 0 }; });
    return det.detectForVideo(src, stamp).detections.map(d => { const b = d.boundingBox; return { cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height * (s.cfg.frame === 'corpo' ? 0.5 : 0.4)) / H, w: b.width / W, h: b.height / H, kind: 'person', score: d.categories?.[0]?.score || 0 }; });
  }

  /* ---------- um passo do seguimento ---------- */
  const caps = i => (typeof camCtl !== 'undefined' ? camCtl.caps.get(i) : null);
  async function step(s, now) {
    const c = caps(s.i);
    if (!camCtl.enabled) { s.status = 'Controle de câmera desligado'; return; }
    if (!c) { s.status = 'Sem celular conectado nesta câmera'; return; }
    if (camCtl.glide && camCtl.slot === s.i) { s.status = 'Indo a uma posição salva…'; s.tracker.holdOff(1.5); return; }
    const dt = Math.min(0.5, s.lastAt ? (now - s.lastAt) / 1000 : 0.1); s.lastAt = now;
    let dets;
    try { s.status = s.status || 'Carregando o reconhecimento…'; dets = await detect(s); s.error = ''; } catch (e) { s.error = 'Não foi possível iniciar o reconhecimento: ' + (e?.message || e); s.status = s.error; s.on = false; paint(); log('Tracking: ' + s.error); return; }
    const took = performance.now() - now; s.period = Math.max(100, Math.min(450, took * 2.2)); s.frames.push(now); while (s.frames.length && now - s.frames[0] > 2000) s.frames.shift(); s.fps = s.frames.length / 2;
    if (dets === null) { s.dets = []; s.status = 'Sem sinal de vídeo desta câmera'; return; }
    s.dets = dets; const subject = Core.pickSubject(dets, s.last); if (subject) s.last = { cx: subject.cx, cy: subject.cy }; s.subject = subject;
    // A detecção só ALIMENTA o filtro (posição e velocidade do alvo); quem move a câmera é o laço de controle (controlTick), 25 vezes por segundo.
    s.tracker.observe(subject, performance.now() / 1000, viewOf(c));
    s.dets = dets;
  }
  const viewOf = c => ({ zoom: c.zoom.value, pan: { ...c.pan }, zoomMin: c.zoom.min, zoomMax: Math.max(c.zoom.max, c.zoom.min + 0.1) });
  // Laço de movimento: segue o caminho previsto do alvo com mola amortecida e manda o pan/zoom ao celular (que ainda suaviza entre um comando e outro).
  function controlTick() {
    const now = performance.now() / 1000;
    for (const s of slots.values()) {
      if (!s.on) continue; const c = caps(s.i);
      if (!camCtl.enabled || !c) continue;
      if (camCtl.glide && camCtl.slot === s.i) { s.tracker.holdOff(1.5); continue; }
      const out = s.tracker.tick(viewOf(c), now);
      if (out.pan || out.zoom) {
        const msg = { type: 'control', slot: s.i, ease: out.ease }; if (out.pan) { msg.pan = out.pan; c.pan = out.pan; } if (out.zoom) { msg.zoom = out.zoom; c.zoom.value = out.zoom; }
        try { camSend(msg); } catch { /* sem conexão com o celular */ }
        if (s.i === camCtl.slot && typeof camCtlPaint === 'function' && now - s.ctl.paintAt > 0.25) { s.ctl.paintAt = now; camCtlPaint(); }
      }
      const label = { face: 'o rosto', person: 'a pessoa', motion: 'o movimento' }[effectiveTarget(s)];
      s.status = out.state === 'track' ? 'Seguindo ' + label + (s.dets.length > 1 ? ' · ' + s.dets.length + ' detectados' : '') + ' · análise ' + s.fps.toFixed(0) + '/s' + (out.atEdge ? ' · no limite do enquadramento (menos zoom dá mais folga)' : '')
        : out.state === 'lost' ? 'Alvo perdido: mantendo a posição' : out.state === 'hold' ? 'Pausado: você está operando à mão' : 'Procurando ' + label + '…';
    }
  }
  setInterval(controlTick, 40);
  let turn = 0;
  setInterval(() => {
    const on = [...slots.values()].filter(s => s.on && !s.busy); if (!on.length) { paint(); return; }
    const now = performance.now(), due = on.filter(s => now - s.lastAt >= s.period); if (due.length) { const s = due[turn++ % due.length]; s.busy = true; step(s, now).catch(e => { s.status = 'Erro: ' + (e?.message || e); }).finally(() => { s.busy = false; }); }
    paint();
  }, 50);

  /* ---------- painel ---------- */
  host.innerHTML = '<span class="camctl-hint">Tracking · a câmera segue a pessoa</span>' +
    '<div class="trk-top"><button type="button" id="trkPower" class="trk-power" aria-pressed="false">⌖ Tracking DESLIGADO</button><span class="trk-status" id="trkStatus" role="status"></span></div>' +
    '<div class="trk-opts"><label>Seguir<select id="trkTarget" aria-label="O que seguir"><option value="face">Rosto</option><option value="person">Pessoa (corpo)</option><option value="motion">Movimento</option></select></label>' +
    '<label>Enquadramento<select id="trkFrame" aria-label="Enquadramento do tracking"></select></label>' +
    '<label>Movimento<select id="trkSpeed" aria-label="Estilo do movimento do tracking"></select></label>' +
    '<label>Zona de conforto<select id="trkComfort" aria-label="Zona de conforto: dentro dela a câmera não se mexe"></select></label>' +
    '<label>Rede da câmera<select id="trkNet" aria-label="Rede entre a câmera e a mesa"></select></label>' +
    '<label>Se perder o alvo<select id="trkLost" aria-label="Se perder o alvo"><option value="hold">Manter a posição</option><option value="center">Voltar ao centro</option></select></label>' +
    '<button type="button" id="trkReset" title="Esquece o alvo atual: passa a seguir o maior. Também dá para clicar numa pessoa na imagem do preview.">Escolher outro alvo</button></div>' +
    '<small class="trk-note" id="trkNote"></small>';
  const q = s => host.querySelector(s);
  for (const [id, f] of Object.entries(Core.FRAMES)) q('#trkFrame').add(new Option(f.label, id));
  for (const [id, v] of Object.entries(Core.SPEEDS)) q('#trkSpeed').add(new Option(v.label, id));
  for (const [id, v] of Object.entries(Core.COMFORT)) q('#trkComfort').add(new Option(v.label, id));
  for (const [id, v] of Object.entries(Core.LATENCY)) q('#trkNet').add(new Option(v.label, id));
  const here = () => slotOf(currentSlot());
  function paint() {
    const s = here(), c = caps(s.i), ok = camCtl.enabled && !!c;
    const power = q('#trkPower'); power.setAttribute('aria-pressed', String(s.on)); power.textContent = s.on ? '⌖ Tracking LIGADO' : '⌖ Tracking DESLIGADO'; power.disabled = !s.on && !ok;
    power.title = !ok ? 'Ative o controle de câmera e conecte o celular desta câmera.' : s.on ? 'Desliga: a câmera fica onde está.' : 'A câmera passa a seguir o alvo sozinha.';
    host.dataset.on = String(s.on);
    const st = !ok ? (camCtl.enabled ? 'Sem celular conectado nesta câmera' : '') : s.on ? s.status : '';
    if (q('#trkStatus').textContent !== st) q('#trkStatus').textContent = st; q('#trkStatus').dataset.s = s.on ? (/Seguindo/.test(st) ? 'track' : /perdido|Procurando|Carregando/.test(st) ? 'search' : 'info') : '';
    for (const [id, key] of [['#trkTarget', 'target'], ['#trkFrame', 'frame'], ['#trkSpeed', 'speed'], ['#trkComfort', 'comfort'], ['#trkNet', 'net']]) { const el = q(id); if (document.activeElement !== el && el.value !== s.cfg[key]) el.value = s.cfg[key]; }
    const lost = s.cfg.lostReturn ? 'center' : 'hold'; if (document.activeElement !== q('#trkLost') && q('#trkLost').value !== lost) q('#trkLost').value = lost;
    q('#trkTarget').disabled = !!Core.FRAMES[s.cfg.frame]?.src; // o enquadramento já define o que medir
    const note = !ok ? '' : c.zoom.value < 1.05 && s.cfg.frame === 'seguir' ? 'Sem zoom a imagem não tem folga para andar: ao ligar, o tracking aplica 1,4×.' : 'O reconhecimento roda neste computador. Mexer no zoom, no enquadramento ou na lente à mão pausa o tracking por 4 s.';
    if (q('#trkNote').textContent !== note) q('#trkNote').textContent = note;
  }
  function set(i, on) {
    const s = slotOf(i);
    if (on) { if (!camCtl.enabled || !caps(i)) { paint(); return false; } s.tracker.reset(); s.last = null; s.dets = []; s.subject = null; s.lastAt = 0; s.status = 'Carregando o reconhecimento…'; s.motion.reset(); s.on = true; log('Tracking ligado na ' + (sources[i] || 'CAM ' + (i + 1)) + '.'); audit('info', 'tracking-ligado', sources[i] || 'CAM ' + (i + 1)); }
    else if (s.on) { s.on = false; s.status = ''; log('Tracking desligado na ' + (sources[i] || 'CAM ' + (i + 1)) + '.'); audit('info', 'tracking-desligado', sources[i] || 'CAM ' + (i + 1)); }
    paint(); return s.on;
  }
  q('#trkPower').onclick = () => set(currentSlot(), !here().on);
  const cfgChange = (key, value) => { const s = here(); s.cfg[key] = value; if (key === 'frame') { const src = Core.FRAMES[value]?.src; if (src) s.cfg.target = src === 'person' ? 'person' : 'face'; } Object.assign(s.tracker.options, { frame: s.cfg.frame, speed: s.cfg.speed, comfort: s.cfg.comfort, latency: (Core.LATENCY[s.cfg.net] || Core.LATENCY.normal).value, lostReturn: s.cfg.lostReturn }); s.tracker.reset(); s.last = null; persist(); paint(); };
  q('#trkTarget').onchange = e => cfgChange('target', e.target.value); q('#trkFrame').onchange = e => cfgChange('frame', e.target.value); q('#trkSpeed').onchange = e => cfgChange('speed', e.target.value); q('#trkComfort').onchange = e => cfgChange('comfort', e.target.value); q('#trkNet').onchange = e => cfgChange('net', e.target.value);
  q('#trkLost').onchange = e => cfgChange('lostReturn', e.target.value === 'center');
  q('#trkReset').onclick = () => { const s = here(); s.last = null; s.tracker.reset(); s.motion.reset(); };
  // Mexer à mão (pan, zoom, lente, exposição, posições salvas) pausa o seguimento desta câmera por 4 s.
  for (const type of ['pointerdown', 'input', 'keydown']) panel.addEventListener(type, e => { if (host.contains(e.target) || !e.target.closest?.('.camctl-controls')) return; for (const s of slots.values()) if (s.on && s.i === currentSlot()) s.tracker.holdOff(4); }, true);

  /* ---------- sobre o preview: caixas, alvo e clique para escolher quem seguir ---------- */
  let pvBox = null;
  function draw(ctx, dx, dy, dw, dh, dpr = 1) {
    const s = slots.get(currentSlot()); pvBox = { dx, dy, dw, dh, dpr }; if (!s?.on) return;
    ctx.save(); ctx.lineWidth = Math.max(1.5, 2 * dpr); ctx.font = '700 ' + Math.round(11 * dpr) + 'px system-ui, sans-serif';
    const aim = Core.AIM[s.subject?.kind || (effectiveTarget(s) === 'motion' ? 'motion' : effectiveTarget(s) === 'person' ? 'person' : 'face')];
    ctx.strokeStyle = 'rgba(0,163,255,.9)'; ctx.beginPath(); const ax = dx + dw * aim.x, ay = dy + dh * aim.y, r = 9 * dpr; ctx.moveTo(ax - r, ay); ctx.lineTo(ax + r, ay); ctx.moveTo(ax, ay - r); ctx.lineTo(ax, ay + r); ctx.stroke();
    // zona de conforto: enquanto o alvo está aqui dentro a câmera não se mexe
    { const z = Core.COMFORT[s.cfg.comfort] || Core.COMFORT.media; ctx.save(); ctx.strokeStyle = 'rgba(0,163,255,.45)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = Math.max(1, dpr); ctx.strokeRect(dx + dw * (aim.x - z.out), dy + dh * (aim.y - z.out * 0.8), dw * 2 * z.out, dh * 2 * z.out * 0.8); ctx.restore(); }
    for (const d of s.dets) {
      const mine = d === s.subject, w = d.w * dw, h = d.h * dh, x = dx + d.cx * dw - w / 2, y = dy + d.cy * dh - h / 2;
      ctx.strokeStyle = mine ? '#ff3b6b' : 'rgba(255,255,255,.55)'; ctx.setLineDash(mine ? [] : [6 * dpr, 4 * dpr]); ctx.strokeRect(x, y, w, h);
      if (mine) { ctx.setLineDash([]); ctx.fillStyle = '#ff3b6b'; ctx.fillText('ALVO', x + 3 * dpr, Math.max(dy + 12 * dpr, y - 4 * dpr)); }
    }
    ctx.restore();
  }
  document.querySelector('#camCtlPreview')?.addEventListener('click', e => {
    const s = slots.get(currentSlot()); if (!s?.on || !pvBox || !s.dets.length) return; const r = e.currentTarget.getBoundingClientRect(), k = e.currentTarget.width / r.width;
    const nx = ((e.clientX - r.left) * k - pvBox.dx) / pvBox.dw, ny = ((e.clientY - r.top) * k - pvBox.dy) / pvBox.dh; s.last = { cx: nx, cy: ny };
  });

  const api = { set, config: i => ({ ...slotOf(i).cfg }), info: i => { const s = slotOf(i ?? currentSlot()); return { on: s.on, status: s.status, subject: s.subject, dets: s.dets, fps: s.fps, state: s.tracker.state }; }, toggle: () => set(currentSlot(), !here().on), draw, paint, setConfig: cfgChange };
  window.andromedaTracking = api; paint();
})();
