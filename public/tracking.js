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
      const cfg = { target: 'face', frame: 'seguir', speed: 'normal', comfort: 'media', net: 'auto', areas: [], lostReturn: false, ...(saved[i] || {}) };
      slots.set(i, { i, cfg, on: false, tracker: new Core.Tracker({ frame: cfg.frame, speed: cfg.speed, comfort: cfg.comfort, latency: (Core.LATENCY[cfg.net] || Core.LATENCY.normal).value, lostReturn: cfg.lostReturn }), view: null, ctl: { out: null, paintAt: 0 }, took: 60, latency: null, meas: null, measAt: 0, prevStats: null, dets: [], subject: null, last: null, lastAt: 0, period: 110, busy: false, status: '', fps: 0, frames: [], motion: new Core.MotionDetector(96, 54), error: '', dims: null });
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
  // Reconhecimento em Worker: o quadro vai reduzido (ImageBitmap, sem cópia) e as caixas voltam prontas. Se o Worker não subir ou travar, volta ao caminho antigo (tela principal).
  let worker = null, workerBroken = false, wid = 0; const wpending = new Map();
  function startWorker() {
    if (worker || workerBroken || typeof Worker !== 'function' || typeof createImageBitmap !== 'function') return worker;
    try {
      worker = new Worker('/tracking-worker.js');
      worker.onmessage = e => { const m = e.data, p = wpending.get(m.id); if (m.type === 'error' && !p) { workerBroken = true; return; } if (!p) return; wpending.delete(m.id); clearTimeout(p.timer); if (m.type === 'result') p.resolve(m); else p.reject(new Error(m.message)); };
      worker.onerror = () => { workerBroken = true; for (const [, p] of wpending) { clearTimeout(p.timer); p.reject(new Error('worker')); } wpending.clear(); };
    } catch { workerBroken = true; worker = null; }
    return worker;
  }
  async function detectInWorker(s, el, kind, W, H) {
    const w = startWorker(); if (!w) throw new Error('sem worker');
    const rw = Math.min(kind === 'face' ? 384 : 448, W), bitmap = await createImageBitmap(el, { resizeWidth: rw, resizeHeight: Math.max(2, Math.round(rw * H / W)), resizeQuality: 'low' });
    const id = ++wid, res = await new Promise((resolve, reject) => { const timer = setTimeout(() => { wpending.delete(id); workerBroken = true; reject(new Error('o reconhecimento em segundo plano não respondeu')); }, kind === 'face' ? 15000 : 25000); wpending.set(id, { resolve, reject, timer }); w.postMessage({ type: 'detect', id, kind, bitmap, personY: s.cfg.frame === 'corpo' ? 0.5 : 0.4 }, [bitmap]); });
    s.engine = 'worker'; s.workerMs = res.took; return res.dets;
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
      const d = s.motion.update(gray, areaMask(s)); return d ? [d] : [];
    }
    if (!workerBroken) { try { return await detectInWorker(s, el, kind, W, H); } catch { workerBroken = true; } }
    s.engine = 'main';
    const det = await detector(kind), stamp = Math.max(performance.now(), lastStamp + 1); lastStamp = stamp;
    // Fontes que não são <video> (imagem de entrada Blackmagic, por exemplo) passam por uma tela intermediária.
    let src = el; if (!(el instanceof HTMLVideoElement)) { feed.width = Math.min(960, W); feed.height = Math.round(feed.width * H / W); feedCtx.drawImage(el, 0, 0, feed.width, feed.height); src = feed; }
    if (kind === 'face') return det.detectForVideo(src, stamp).detections.map(d => { const b = d.boundingBox; return { cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height / 2) / H, w: b.width / W, h: b.height / H, kind: 'face', score: d.categories?.[0]?.score || 0 }; });
    return det.detectForVideo(src, stamp).detections.map(d => { const b = d.boundingBox; return { cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height * (s.cfg.frame === 'corpo' ? 0.5 : 0.4)) / H, w: b.width / W, h: b.height / H, kind: 'person', score: d.categories?.[0]?.score || 0 }; });
  }

  /* ---------- áreas de pausa: o que acontece nelas é ignorado (TV, espelho, quadro, gente ao fundo) ---------- */
  // As áreas ficam no quadro inteiro do sensor: continuam no mesmo lugar da cena mesmo quando a câmera anda ou muda o zoom.
  const windowOf = s => { const w = s.tracker.window(); if (w) return w; const c = caps(s.i); if (!c) return null; const r = Core.room(c.zoom.value); return { cx: 0.5 + c.pan.x * r, cy: 0.5 + c.pan.y * r, z: c.zoom.value }; };
  function isIgnored(s, d) {
    if (!s.cfg.areas?.length) return false;
    const w = s.tracker.worldOf(d, performance.now() / 1000) || (windowOf(s) && Core.viewToWorld(windowOf(s), d.cx, d.cy)); return !!w && Core.inAreas(s.cfg.areas, w.x, w.y);
  }
  function areaMask(s) {
    const win = windowOf(s); if (!s.cfg.areas?.length || !win) return null; const mask = new Uint8Array(96 * 54);
    for (const a of s.cfg.areas) { const p = Core.worldToView(win, Math.min(a.x0, a.x1), Math.min(a.y0, a.y1)), q = Core.worldToView(win, Math.max(a.x0, a.x1), Math.max(a.y0, a.y1));
      for (let y = Math.max(0, Math.floor(p.y * 54)); y < Math.min(54, Math.ceil(q.y * 54)); y++) for (let x = Math.max(0, Math.floor(p.x * 96)); x < Math.min(96, Math.ceil(q.x * 96)); x++) mask[y * 96 + x] = 1; }
    return mask;
  }
  /* ---------- atraso da rede, medido: o próprio WebRTC informa o tempo de ida e volta, o buffer e a decodificação ---------- */
  async function measure(s, now) {
    if (s.cfg.net !== 'auto' || now - s.measAt < 2000) return; s.measAt = now;
    const pc = typeof camDesk !== 'undefined' ? camDesk.peers?.get(s.i + ':media')?.pc : null; if (!pc?.getStats) { s.meas = null; return; }
    let rtt = null, cur = null; const stats = await pc.getStats();
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected) && Number.isFinite(r.currentRoundTripTime)) rtt = r.currentRoundTripTime;
      if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) cur = { jb: r.jitterBufferDelay, n: r.jitterBufferEmittedCount, dec: r.totalDecodeTime, fr: r.framesDecoded };
    });
    const prev = s.prevStats; let jb = s.meas?.jb ?? null, dec = s.meas?.dec ?? null;
    if (cur && prev && cur.n > prev.n) jb = (cur.jb - prev.jb) / (cur.n - prev.n); if (cur && prev && cur.fr > prev.fr) dec = (cur.dec - prev.dec) / (cur.fr - prev.fr); if (cur) s.prevStats = cur;
    s.meas = { rtt: rtt ?? s.meas?.rtt ?? null, jb, dec };
    const est = Core.estimateLatency({ rtt: s.meas.rtt ?? 0.12, jitterBuffer: jb ?? 0.05, decode: dec ?? 0.01, detect: s.took / 1000, ease: (Core.SPEEDS[s.cfg.speed]?.ease ?? 100) / 1000 });
    s.latency = s.latency ? s.latency * 0.6 + est * 0.4 : est; s.tracker.options.latency = s.latency;
  }

  /* ---------- um passo do seguimento ---------- */
  const caps = i => (typeof camCtl !== 'undefined' ? camCtl.caps.get(i) : null);
  async function step(s, now) {
    const c = caps(s.i);
    if (!camCtl.enabled) { s.status = 'Controle de câmera desligado'; return; }
    if (!c) { s.status = 'Sem celular conectado nesta câmera'; return; }
    if (camCtl.glides?.has(s.i)) { s.status = 'Indo a uma posição salva…'; s.tracker.holdOff(1.5); return; }
    const dt = Math.min(0.5, s.lastAt ? (now - s.lastAt) / 1000 : 0.1); s.lastAt = now;
    let dets;
    try { s.status = s.status || 'Carregando o reconhecimento…'; dets = await detect(s); s.error = ''; } catch (e) { s.error = 'Não foi possível iniciar o reconhecimento: ' + (e?.message || e); s.status = s.error; s.on = false; paint(); log('Tracking: ' + s.error); return; }
    const took = performance.now() - now; s.period = s.engine === 'worker' ? Math.max(effectiveTarget(s) === 'person' ? 90 : 45, Math.min(450, took * 1.15)) : Math.max(100, Math.min(450, took * 2.2)); s.frames.push(now); while (s.frames.length && now - s.frames[0] > 2000) s.frames.shift(); s.fps = s.frames.length / 2;
    if (dets === null) { s.dets = []; s.status = 'Sem sinal de vídeo desta câmera'; return; }
    s.took = s.took * 0.7 + took * 0.3; measure(s, now).catch(() => {});
    dets = dets.filter(d => !isIgnored(s, d));
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
      if (camCtl.glides?.has(s.i)) { s.tracker.holdOff(1.5); continue; }
      const out = s.tracker.tick(viewOf(c), now);
      if (out.pan || out.zoom) {
        const msg = { type: 'control', slot: s.i, ease: out.ease }; if (out.pan) { msg.pan = out.pan; if (out.pv) msg.pv = out.pv; c.pan = out.pan; } if (out.zoom) { msg.zoom = out.zoom; c.zoom.value = out.zoom; }
        try { camSend(msg); } catch { /* sem conexão com o celular */ }
        if (s.i === camCtl.slot && typeof camCtlPaint === 'function' && now - s.ctl.paintAt > 0.25) { s.ctl.paintAt = now; camCtlPaint(); }
      }
      const label = { face: 'o rosto', person: 'a pessoa', motion: 'o movimento' }[effectiveTarget(s)];
      s.status = out.state === 'track' ? 'Seguindo ' + label + (s.dets.length > 1 ? ' · ' + s.dets.length + ' detectados' : '') + ' · análise ' + s.fps.toFixed(0) + '/s' + (s.cfg.net === 'auto' && s.latency ? ' · atraso ' + s.latency.toFixed(2).replace('.', ',') + ' s' : '') + (out.atEdge ? ' · no limite do enquadramento (menos zoom dá mais folga)' : '')
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
    '<button type="button" id="trkArea" aria-pressed="false" title="Desenhe na imagem do preview um retângulo onde o tracking deve ignorar tudo (TV, espelho, quadro, gente ao fundo). A área fica parada na cena, mesmo com a câmera andando.">Ignorar área…</button><button type="button" id="trkAreaUndo">Desfazer área</button><button type="button" id="trkAreaClear">Limpar áreas</button><span class="trk-areas" id="trkAreaCount"></span>' +
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
    { const n = s.cfg.areas.length, txt = n ? n + (n === 1 ? ' área ignorada' : ' áreas ignoradas') : ''; if (q('#trkAreaCount').textContent !== txt) q('#trkAreaCount').textContent = txt; q('#trkAreaUndo').disabled = q('#trkAreaClear').disabled = !n; q('#trkArea').setAttribute('aria-pressed', String(drawMode)); q('#trkArea').textContent = drawMode ? 'Desenhe na imagem… (Esc cancela)' : 'Ignorar área…'; q('#trkArea').disabled = !ok; }
    const note = !ok ? '' : c.zoom.value < 1.05 && s.cfg.frame === 'seguir' ? 'Sem zoom a imagem não tem folga para andar: ao ligar, o tracking aplica 1,4×.' : 'O reconhecimento roda neste computador. Mexer no zoom, no enquadramento ou na lente à mão pausa o tracking por 4 s.';
    if (q('#trkNote').textContent !== note) q('#trkNote').textContent = note;
  }
  function set(i, on) {
    const s = slotOf(i);
    if (on) { if (!camCtl.enabled || !caps(i)) { log('Tracking: ' + (!camCtl.enabled ? 'ative o Controle de câmera' : 'conecte o celular desta câmera') + ' para ligar o tracking.'); try { openWorkspace('operation'); const pn = document.querySelector('[data-tool=camctl]'); pn?.scrollIntoView({ block: 'center', behavior: 'smooth' }); pn?.classList.add('flash'); setTimeout(() => pn?.classList.remove('flash'), 1600); } catch { /* painel ainda não montado */ } paint(); return false; } s.tracker.reset(); s.last = null; s.dets = []; s.subject = null; s.lastAt = 0; s.status = 'Carregando o reconhecimento…'; s.motion.reset(); s.on = true; log('Tracking ligado na ' + (sources[i] || 'CAM ' + (i + 1)) + '.'); audit('info', 'tracking-ligado', sources[i] || 'CAM ' + (i + 1)); }
    else if (s.on) { s.on = false; s.status = ''; log('Tracking desligado na ' + (sources[i] || 'CAM ' + (i + 1)) + '.'); audit('info', 'tracking-desligado', sources[i] || 'CAM ' + (i + 1)); }
    paint(); return s.on;
  }
  q('#trkPower').onclick = () => set(currentSlot(), !here().on);
  const cfgChange = (key, value) => { const s = here(); s.cfg[key] = value; if (key === 'frame') { const src = Core.FRAMES[value]?.src; if (src) s.cfg.target = src === 'person' ? 'person' : 'face'; } Object.assign(s.tracker.options, { frame: s.cfg.frame, speed: s.cfg.speed, comfort: s.cfg.comfort, latency: s.cfg.net === 'auto' && s.latency ? s.latency : (Core.LATENCY[s.cfg.net] || Core.LATENCY.normal).value, lostReturn: s.cfg.lostReturn }); s.tracker.reset(); s.last = null; persist(); paint(); };
  q('#trkTarget').onchange = e => cfgChange('target', e.target.value); q('#trkFrame').onchange = e => cfgChange('frame', e.target.value); q('#trkSpeed').onchange = e => cfgChange('speed', e.target.value); q('#trkComfort').onchange = e => cfgChange('comfort', e.target.value); q('#trkNet').onchange = e => { const s = here(); s.latency = null; s.prevStats = null; cfgChange('net', e.target.value); };
  q('#trkLost').onchange = e => cfgChange('lostReturn', e.target.value === 'center');
  q('#trkReset').onclick = () => { const s = here(); s.last = null; s.tracker.reset(); s.motion.reset(); };
  // Mexer à mão (pan, zoom, lente, exposição, posições salvas) pausa o seguimento desta câmera por 4 s.
  for (const type of ['pointerdown', 'input', 'keydown']) panel.addEventListener(type, e => { if (host.contains(e.target) || !e.target.closest?.('.camctl-controls')) return; for (const s of slots.values()) if (s.on && s.i === currentSlot()) s.tracker.holdOff(4); }, true);

  /* ---------- sobre o preview: caixas, alvo e clique para escolher quem seguir ---------- */
  let pvBox = null, drawMode = false, drag = null;
  function drawAreas(ctx, s, dx, dy, dw, dh, dpr) {
    const win = windowOf(s); if (!win && !drag) return;
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip(); ctx.font = '700 ' + Math.round(10 * dpr) + 'px system-ui, sans-serif'; ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    for (const a of s.cfg.areas) {
      const p = Core.worldToView(win, Math.min(a.x0, a.x1), Math.min(a.y0, a.y1)), q = Core.worldToView(win, Math.max(a.x0, a.x1), Math.max(a.y0, a.y1)), x = dx + dw * p.x, y = dy + dh * p.y, w = dw * (q.x - p.x), h = dh * (q.y - p.y);
      ctx.fillStyle = 'rgba(255,59,107,.18)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(255,59,107,.85)'; ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); ctx.fillStyle = '#ff6b88'; ctx.fillText('IGNORAR', x + 4 * dpr, y + 12 * dpr);
    }
    if (drag) { ctx.strokeStyle = '#7fd0ff'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeRect(dx + dw * Math.min(drag.x0, drag.x1), dy + dh * Math.min(drag.y0, drag.y1), dw * Math.abs(drag.x1 - drag.x0), dh * Math.abs(drag.y1 - drag.y0)); }
    ctx.restore();
  }
  function draw(ctx, dx, dy, dw, dh, dpr = 1) {
    const s = slotOf(currentSlot()); pvBox = { dx, dy, dw, dh, dpr }; drawAreas(ctx, s, dx, dy, dw, dh, dpr); if (!s.on) return;
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
  const pv = document.querySelector('#camCtlPreview');
  const viewPoint = e => { if (!pvBox) return null; const r = pv.getBoundingClientRect(), k = pv.width / r.width; return { x: Math.min(1, Math.max(0, ((e.clientX - r.left) * k - pvBox.dx) / pvBox.dw)), y: Math.min(1, Math.max(0, ((e.clientY - r.top) * k - pvBox.dy) / pvBox.dh)) }; };
  pv?.addEventListener('pointerdown', e => { if (!drawMode) return; const p = viewPoint(e); if (!p) return; e.preventDefault(); pv.setPointerCapture?.(e.pointerId); drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; });
  pv?.addEventListener('pointermove', e => { if (!drag) return; const p = viewPoint(e); if (p) { drag.x1 = p.x; drag.y1 = p.y; } });
  const endDrag = () => { if (!drag) return; const d = drag; drag = null; const s = here(), win = windowOf(s); drawMode = false; pv.classList.remove('trk-drawing');
    if (win && Math.abs(d.x1 - d.x0) > 0.03 && Math.abs(d.y1 - d.y0) > 0.03 && s.cfg.areas.length < 6) { const a = Core.viewToWorld(win, Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), b = Core.viewToWorld(win, Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)); s.cfg.areas.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }); persist(); log('Tracking: área ignorada adicionada (' + s.cfg.areas.length + ').'); }
    paint(); };
  pv?.addEventListener('pointerup', endDrag); pv?.addEventListener('pointercancel', () => { drag = null; });
  q('#trkArea').onclick = () => { drawMode = !drawMode; drag = null; pv?.classList.toggle('trk-drawing', drawMode); paint(); };
  q('#trkAreaUndo').onclick = () => { const s = here(); s.cfg.areas.pop(); persist(); paint(); };
  q('#trkAreaClear').onclick = () => { const s = here(); s.cfg.areas.length = 0; persist(); paint(); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && drawMode) { drawMode = false; drag = null; pv?.classList.remove('trk-drawing'); paint(); e.stopImmediatePropagation(); } }, true);
  pv?.addEventListener('click', e => {
    if (drawMode) return;
    const s = slots.get(currentSlot()); if (!s?.on || !pvBox || !s.dets.length) return; const r = e.currentTarget.getBoundingClientRect(), k = e.currentTarget.width / r.width;
    const nx = ((e.clientX - r.left) * k - pvBox.dx) / pvBox.dw, ny = ((e.clientY - r.top) * k - pvBox.dy) / pvBox.dh; s.last = { cx: nx, cy: ny };
  });

  const api = { addArea: (i, a) => { const s = slotOf(i); s.cfg.areas.push(a); persist(); paint(); }, areas: i => slotOf(i ?? currentSlot()).cfg.areas, clearAreas: i => { slotOf(i ?? currentSlot()).cfg.areas.length = 0; persist(); paint(); }, set, config: i => ({ ...slotOf(i).cfg }), info: i => { const s = slotOf(i ?? currentSlot()); return { on: s.on, status: s.status, subject: s.subject, dets: s.dets, fps: s.fps, state: s.tracker.state, latency: s.latency, measured: s.meas, areas: s.cfg.areas.length, engine: s.engine || null, workerMs: s.workerMs || null }; }, toggle: () => set(currentSlot(), !here().on), draw, paint, setConfig: cfgChange };
  window.andromedaTracking = api; paint();
})();
