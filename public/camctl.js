'use strict';
/*
 * Controle de câmera à distância (Andromeda Cam).
 * A mesa opera o celular escolhido: lente, zoom, enquadramento (posição do recorte), exposição e balanço de branco, e guarda 6 posições
 * de enquadramento por câmera para o operador chamar com um clique (na hora ou com movimento suave).
 * O controle nasce DESLIGADO: nada é enviado ao celular até o operador ativá-lo no botão do painel. Ativo, abre um preview ao lado.
 * O celular informa o que oferece (mensagem 'caps'); a mesa manda 'control' pela mesma sinalização dos convites.
 */
const camCtlStore = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};
const camCtl = { slot: 0, follow: true, enabled: camCtlStore.get('andromeda.camctl.on.v1', false) === true, caps: new Map(), sendTimer: null, pending: null, glide: null, presetMode: 'call', glideSeconds: Number(camCtlStore.get('andromeda.camctl.glide.v1', 1)) || 0, grid: camCtlStore.get('andromeda.camctl.grid.v1', true) !== false, last: null };
const CAM_PRESETS_KEY = 'andromeda.camctl.presets.v1';
const camPresets = camCtlStore.get(CAM_PRESETS_KEY, {});
const camCtlPanel = document.createElement('section'); camCtlPanel.className = 'camctl'; camCtlPanel.setAttribute('aria-label', 'Controle de câmera');
camCtlPanel.innerHTML = '<div class="camctl-top"><button type="button" id="camCtlPower" class="camctl-power" aria-pressed="false"></button>' +
  '<label>Câmera <select id="camCtlSlot"></select></label><label class="camctl-follow"><input id="camCtlFollow" type="checkbox" checked> Seguir o PREVIEW</label><span id="camCtlModel" class="camctl-model"></span></div>' +
  '<p class="camctl-off" id="camCtlOff">Controle de câmera desligado: nenhum comando é enviado ao celular. Ative para operar a lente, o zoom, o enquadramento e a exposição à distância, com o preview da câmera ao lado.</p>' +
  '<div class="camctl-main" id="camCtlMain"><div class="camctl-controls">' +
  '<div class="camctl-body"><div class="camctl-lenses" id="camCtlLenses" role="radiogroup" aria-label="Lente"></div>' +
  '<label class="camctl-zoom">Zoom <input id="camCtlZoom" type="range" min="1" max="4" step="0.01" value="1"><output id="camCtlZoomOut">1,0×</output></label>' +
  '<div class="camctl-frame"><div class="camctl-pad" id="camCtlPad" role="slider" tabindex="0" aria-label="Enquadramento: arraste ou use as setas" aria-valuetext="centro"><i id="camCtlDot"></i></div><div class="camctl-frame-side"><span class="camctl-hint">Enquadramento</span><button type="button" id="camCtlCenter">Centralizar</button><small id="camCtlNote"></small></div></div>' +
  '<div class="camctl-sec" id="camCtlExp"><span class="camctl-hint">Exposição</span><div class="camctl-seg" id="camCtlExpMode" role="radiogroup" aria-label="Modo da exposição"><button type="button" data-mode="auto" role="radio">AUTO</button><button type="button" data-mode="manual" role="radio">MANUAL</button></div>' +
  '<label class="camctl-zoom">Brilho <input id="camCtlEv" type="range" min="-2" max="2" step="0.1" value="0"><output id="camCtlEvOut">0,0 EV</output></label>' +
  '<span class="camctl-hint">Balanço de branco</span><div class="camctl-seg" id="camCtlWbMode" role="radiogroup" aria-label="Modo do balanço de branco"><button type="button" data-mode="auto" role="radio">AUTO</button><button type="button" data-mode="manual" role="radio">MANUAL</button></div>' +
  '<label class="camctl-zoom">Cor <input id="camCtlKelvin" type="range" min="2500" max="9000" step="50" value="5600"><output id="camCtlKelvinOut">5600 K</output></label></div>' +
  '<div class="camctl-sec" id="camCtlBank"><span class="camctl-hint">6 posições de enquadramento</span>' +
  '<div class="camctl-bank-top"><div class="camctl-seg" id="camCtlPresetMode" role="radiogroup" aria-label="O que fazer ao tocar numa posição"><button type="button" data-pm="call" role="radio" title="Tocar numa posição leva a câmera até ela">CHAMAR</button><button type="button" data-pm="save" role="radio" title="Tocar numa posição grava nela o enquadramento atual">GRAVAR</button><button type="button" data-pm="clear" role="radio" title="Tocar numa posição apaga o que estava gravado">APAGAR</button></div>' +
  '<label class="camctl-glide">Chegar em <select id="camCtlGlide" aria-label="Tempo para chegar à posição"><option value="0">na hora</option><option value="1">1 s</option><option value="2">2 s</option><option value="3">3 s</option><option value="5">5 s</option></select></label></div>' +
  '<div class="camctl-presets" id="camCtlPresets" role="group" aria-label="Posições salvas"></div><small class="camctl-pnote" id="camCtlPNote"></small></div></div>' +
  '<p class="camctl-empty" id="camCtlEmpty">Esta fonte não é um celular com o Andromeda Cam conectado.</p></div>' +
  '<aside class="camctl-preview" id="camCtlPreviewBox" aria-label="Preview da câmera"><div class="camctl-pv-head"><b id="camCtlPvName">CAM 1</b><span id="camCtlPvState" class="camctl-pv-state"></span><label class="camctl-gridopt"><input id="camCtlGrid" type="checkbox"> Grade</label></div><canvas id="camCtlPreview" width="640" height="360"></canvas><div class="camctl-pv-foot" id="camCtlPvFoot"></div></aside></div>';
operation.append(camCtlPanel);

const ccq = s => camCtlPanel.querySelector(s);
const fmtX = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
const fmtEv = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' EV';
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
for (let i = 0; i < 10; i++) ccq('#camCtlSlot').add(new Option('CAM ' + (i + 1), String(i)));
const DEFAULT_EXP = { mode: 'auto', ev: 0, min: -2, max: 2, step: 0.1, native: false }, DEFAULT_WB = { mode: 'auto', kelvin: 5600, min: 2500, max: 9000, step: 50, native: false };

// Junta mudanças rápidas (arrastar) num envio a cada 60 ms. Desligado, nada sai.
function camCtlSend(change) {
  if (!camCtl.enabled) return;
  const p = camCtl.pending || {};
  camCtl.pending = { ...p, ...change, ...(change.exp ? { exp: { ...p.exp, ...change.exp } } : {}), ...(change.wb ? { wb: { ...p.wb, ...change.wb } } : {}) };
  if (camCtl.sendTimer) return;
  camCtl.sendTimer = setTimeout(() => { camCtl.sendTimer = null; const m = camCtl.pending; camCtl.pending = null; if (m) camSend({ type: 'control', slot: camCtl.slot, ...m }); }, 60);
}
const camCaps = () => camCtl.caps.get(camCtl.slot);

/* ---------- ligar / desligar e o preview ao lado ---------- */
function camCtlSetEnabled(on) {
  camCtl.enabled = !!on; camCtlStore.set('andromeda.camctl.on.v1', camCtl.enabled);
  if (!camCtl.enabled) { cancelGlide(); camCtl.pending = null; }
  camCtlPaint(); camCtlDraw();
  try { log(camCtl.enabled ? 'Controle de câmera ATIVO: comandos vão ao celular da ' + (sources[camCtl.slot] || 'CAM ' + (camCtl.slot + 1)) : 'Controle de câmera desligado'); } catch { /* antes da mesa pronta */ }
}
ccq('#camCtlPower').onclick = () => camCtlSetEnabled(!camCtl.enabled);
const pvCanvas = ccq('#camCtlPreview'), pvCtx = pvCanvas.getContext('2d');
function camCtlDraw() {
  if (!camCtl.enabled) return;
  const box = ccq('.camctl-preview'); if (!box || !box.offsetParent) return;
  const r = pvCanvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (pvCanvas.width !== w || pvCanvas.height !== h) { pvCanvas.width = w; pvCanvas.height = h; }
  pvCtx.fillStyle = '#000'; pvCtx.fillRect(0, 0, w, h);
  const el = (typeof media !== 'undefined' && media[camCtl.slot]?.element) || null, sw = el ? (el.videoWidth || el.naturalWidth || 0) : 0, sh = el ? (el.videoHeight || el.naturalHeight || 0) : 0;
  if (sw > 0 && sh > 0 && (typeof cams === 'undefined' || cams[camCtl.slot]?.conn !== false)) {
    const k = Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k, dx = (w - dw) / 2, dy = (h - dh) / 2;
    try { pvCtx.drawImage(el, dx, dy, dw, dh); } catch { /* quadro ainda não disponível */ }
    if (camCtl.grid) { pvCtx.strokeStyle = 'rgba(255,255,255,.35)'; pvCtx.lineWidth = Math.max(1, dpr); pvCtx.beginPath(); for (let i = 1; i < 3; i++) { pvCtx.moveTo(dx + dw * i / 3, dy); pvCtx.lineTo(dx + dw * i / 3, dy + dh); pvCtx.moveTo(dx, dy + dh * i / 3); pvCtx.lineTo(dx + dw, dy + dh * i / 3); } pvCtx.stroke(); }
  } else {
    pvCtx.fillStyle = '#5c668f'; pvCtx.font = '700 ' + Math.round(14 * dpr) + 'px system-ui, sans-serif'; pvCtx.textAlign = 'center'; pvCtx.fillText('SEM SINAL', w / 2, h / 2);
  }
}
setInterval(camCtlDraw, 66);

/* ---------- painel ---------- */
function camCtlPaint() {
  const c = camCaps(), select = ccq('#camCtlSlot'), on = camCtl.enabled;
  camCtlPanel.dataset.on = String(on);
  const power = ccq('#camCtlPower'); power.setAttribute('aria-pressed', String(on)); power.textContent = on ? '● Controle ATIVO' : '⏻ Ativar controle de câmera';
  power.title = on ? 'Clique para desligar: os comandos deixam de ir ao celular.' : 'Liga o controle remoto da câmera e abre o preview ao lado.';
  for (const o of select.options) o.textContent = (sources[+o.value] || 'CAM ' + (+o.value + 1)).split('—')[0].trim() + (camCtl.caps.has(+o.value) ? ' · celular' : '');
  if (document.activeElement !== select) select.value = String(camCtl.slot);
  ccq('#camCtlOff').hidden = on; ccq('#camCtlMain').hidden = !on;
  // preview: nome, se está no AR/PREVIEW e a leitura dos ajustes
  const name = (sources[camCtl.slot] || 'CAM ' + (camCtl.slot + 1)), air = typeof state !== 'undefined' && state.pgm === camCtl.slot, prv = typeof state !== 'undefined' && state.prv === camCtl.slot;
  ccq('#camCtlPvName').textContent = name; const st = ccq('#camCtlPvState'); st.textContent = air ? 'NO AR' : prv ? 'PREVIEW' : ''; st.dataset.s = air ? 'air' : prv ? 'prv' : '';
  ccq('#camCtlGrid').checked = camCtl.grid; ccq('#camCtlGlide').value = String(camCtl.glideSeconds);
  ccq('.camctl-body').hidden = !c; ccq('#camCtlEmpty').hidden = !!c;
  if (!c) { ccq('#camCtlModel').textContent = ''; ccq('#camCtlPvFoot').textContent = ''; paintBank(); return; }
  ccq('#camCtlModel').textContent = c.model ? 'Aparelho: ' + c.model : '';
  const lenses = ccq('#camCtlLenses');
  if (lenses.dataset.sig !== JSON.stringify(c.lenses)) {
    lenses.dataset.sig = JSON.stringify(c.lenses); lenses.replaceChildren();
    for (const l of c.lenses) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'camctl-lens'; b.dataset.arr = 'lens:' + l.id; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(l.active));
      b.innerHTML = '<b></b><small></small>'; b.querySelector('b').textContent = l.name; b.querySelector('small').textContent = l.kind;
      b.onclick = () => { cancelGlide(); camCtlSend({ lens: l.id }); }; lenses.append(b);
    }
  }
  const zoom = ccq('#camCtlZoom');
  zoom.min = String(c.zoom.min); zoom.max = String(Math.max(c.zoom.max, c.zoom.min + .1));
  if (document.activeElement !== zoom) zoom.value = String(c.zoom.value);
  ccq('#camCtlZoomOut').textContent = fmtX(Number(zoom.value)) + (c.zoom.native ? '' : ' dig.');
  const canFrame = c.zoom.value > 1.001;
  ccq('.camctl-frame').dataset.off = String(!canFrame);
  if (!camCtl.dragging) { ccq('#camCtlDot').style.left = (50 + c.pan.x * 50) + '%'; ccq('#camCtlDot').style.top = (50 + c.pan.y * 50) + '%'; }
  ccq('#camCtlPad').setAttribute('aria-valuetext', Math.abs(c.pan.x) < .02 && Math.abs(c.pan.y) < .02 ? 'centro' : (c.pan.x < 0 ? 'esquerda ' : 'direita ') + Math.round(Math.abs(c.pan.x) * 100) + '%, ' + (c.pan.y < 0 ? 'acima ' : 'abaixo ') + Math.round(Math.abs(c.pan.y) * 100) + '%');
  ccq('#camCtlNote').textContent = canFrame ? 'Arraste o ponto para mover o recorte.' : 'Dê zoom para poder mover o enquadramento.';
  // exposição e balanço de branco
  const e = c.exp, w = c.wb;
  for (const btn of ccq('#camCtlExpMode').children) btn.setAttribute('aria-checked', String(btn.dataset.mode === e.mode));
  for (const btn of ccq('#camCtlWbMode').children) btn.setAttribute('aria-checked', String(btn.dataset.mode === w.mode));
  const ev = ccq('#camCtlEv'); ev.min = String(e.min); ev.max = String(e.max); ev.step = String(e.step || 0.1); if (document.activeElement !== ev) ev.value = String(e.ev); ccq('#camCtlEvOut').textContent = e.mode === 'manual' ? fmtEv(Number(ev.value)) : 'auto';
  ev.dataset.auto = String(e.mode !== 'manual');
  const kv = ccq('#camCtlKelvin'); kv.min = String(w.min); kv.max = String(w.max); kv.step = String(w.step || 50); if (document.activeElement !== kv) kv.value = String(w.kelvin); ccq('#camCtlKelvinOut').textContent = w.mode === 'manual' ? Math.round(Number(kv.value)) + ' K' : 'auto';
  kv.dataset.auto = String(w.mode !== 'manual');
  ccq('#camCtlPvFoot').textContent = fmtX(c.zoom.value) + (c.zoom.native ? '' : ' dig.') + ' · ' + (e.mode === 'manual' ? fmtEv(e.ev) : 'exposição auto') + ' · ' + (w.mode === 'manual' ? Math.round(w.kelvin) + ' K' : 'branco auto');
  paintBank();
}
window.andromedaCamCtl = {
  caps(m) {
    camCtl.caps.set(m.slot, { lenses: m.lenses || [], zoom: m.zoom || { min: 1, max: 1, value: 1 }, pan: m.pan || { x: 0, y: 0 }, model: m.model || '', exp: { ...DEFAULT_EXP, ...(m.exp || {}) }, wb: { ...DEFAULT_WB, ...(m.wb || {}) } });
    if (m.slot === camCtl.slot) camCtlPaint();
  },
  drop(slot) { camCtl.caps.delete(slot); camCtlPaint(); },
  state: () => camCtl, presets: () => camPresets, recall: (n, seconds) => recallPreset(n, seconds), save: n => savePreset(n), clear: n => clearPreset(n), setEnabled: camCtlSetEnabled,
};
const camCtlGoTo = slot => { if (slot === camCtl.slot) return; cancelGlide(); camCtl.slot = slot; camCtlPaint(); };
ccq('#camCtlSlot').onchange = e => { camCtlGoTo(+e.target.value); camCtl.follow = false; ccq('#camCtlFollow').checked = false; };
ccq('#camCtlFollow').onchange = e => { camCtl.follow = e.target.checked; if (camCtl.follow && state.prv < 10) camCtlGoTo(state.prv); camCtlPaint(); };
ccq('#camCtlGrid').onchange = e => { camCtl.grid = e.target.checked; camCtlStore.set('andromeda.camctl.grid.v1', camCtl.grid); };
ccq('#camCtlZoom').oninput = e => { cancelGlide(); const v = Number(e.target.value); ccq('#camCtlZoomOut').textContent = fmtX(v); const c = camCaps(); if (c) c.zoom.value = v; camCtlSend({ zoom: v }); };
ccq('#camCtlCenter').onclick = () => { cancelGlide(); const c = camCaps(); if (c) c.pan = { x: 0, y: 0 }; camCtlSend({ center: true }); camCtlPaint(); };
// Exposição e balanço de branco: o modo e o valor seguem pelo mesmo canal.
for (const btn of ccq('#camCtlExpMode').children) btn.onclick = () => { cancelGlide(); const c = camCaps(); if (c) c.exp.mode = btn.dataset.mode; camCtlSend({ exp: { mode: btn.dataset.mode } }); camCtlPaint(); };
for (const btn of ccq('#camCtlWbMode').children) btn.onclick = () => { cancelGlide(); const c = camCaps(); if (c) c.wb.mode = btn.dataset.mode; camCtlSend({ wb: { mode: btn.dataset.mode } }); camCtlPaint(); };
ccq('#camCtlEv').oninput = e => { cancelGlide(); const v = Number(e.target.value), c = camCaps(); if (c) { c.exp.ev = v; c.exp.mode = 'manual'; } ccq('#camCtlEvOut').textContent = fmtEv(v); camCtlSend({ exp: { mode: 'manual', ev: v } }); for (const btn of ccq('#camCtlExpMode').children) btn.setAttribute('aria-checked', String(btn.dataset.mode === 'manual')); };
ccq('#camCtlKelvin').oninput = e => { cancelGlide(); const v = Number(e.target.value), c = camCaps(); if (c) { c.wb.kelvin = v; c.wb.mode = 'manual'; } ccq('#camCtlKelvinOut').textContent = Math.round(v) + ' K'; camCtlSend({ wb: { mode: 'manual', kelvin: v } }); for (const btn of ccq('#camCtlWbMode').children) btn.setAttribute('aria-checked', String(btn.dataset.mode === 'manual')); };

// Enquadramento: arrastar o ponto (ou setas no teclado) move o recorte da câmera.
const pad = ccq('#camCtlPad');
function padTo(e) {
  const r = pad.getBoundingClientRect(), x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  const c = camCaps(); if (!c || c.zoom.value <= 1.001) return;
  cancelGlide(); c.pan = { x, y }; ccq('#camCtlDot').style.left = (50 + x * 50) + '%'; ccq('#camCtlDot').style.top = (50 + y * 50) + '%'; camCtlSend({ pan: { x, y } });
}
pad.addEventListener('pointerdown', e => { e.stopPropagation(); camCtl.dragging = true; pad.setPointerCapture(e.pointerId); padTo(e); });
pad.addEventListener('pointermove', e => { if (camCtl.dragging) padTo(e); });
for (const t of ['pointerup', 'pointercancel']) pad.addEventListener(t, () => { camCtl.dragging = false; });
pad.addEventListener('keydown', e => {
  const d = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, -.1], ArrowDown: [0, .1] }[e.key]; if (!d) return;
  e.preventDefault(); e.stopPropagation();
  const c = camCaps(); if (!c || c.zoom.value <= 1.001) return;
  cancelGlide(); c.pan = { x: Math.max(-1, Math.min(1, c.pan.x + d[0])), y: Math.max(-1, Math.min(1, c.pan.y + d[1])) }; camCtlSend({ pan: c.pan }); camCtlPaint();
});

/* ---------- banco de 6 posições de enquadramento ---------- */
const slotList = () => (camPresets[camCtl.slot] ||= Array(6).fill(null));
const PM_HINT = { call: 'Toque numa posição para levar a câmera até ela.', save: 'GRAVAR: toque na posição onde guardar o enquadramento atual (zoom, recorte, exposição e cor).', clear: 'APAGAR: toque na posição que deve ficar vazia.' };
const presetBox = ccq('#camCtlPresets');
for (let i = 0; i < 6; i++) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'camctl-preset'; b.dataset.arr = 'p' + (i + 1); b.dataset.n = String(i + 1);
  b.innerHTML = '<i>' + (i + 1) + '</i><b>Posição ' + (i + 1) + '</b><small>vazio</small>'; b.onclick = () => presetClick(i); presetBox.append(b);
}
function paintBank() {
  const list = slotList(), c = camCaps();
  for (const btn of ccq('#camCtlPresetMode').children) btn.setAttribute('aria-checked', String(btn.dataset.pm === camCtl.presetMode));
  ccq('#camCtlBank').dataset.mode = camCtl.presetMode; ccq('#camCtlPNote').textContent = PM_HINT[camCtl.presetMode];
  presetBox.querySelectorAll('.camctl-preset').forEach((btn, i) => {
    const p = list[i]; btn.dataset.filled = String(!!p); btn.setAttribute('aria-pressed', String(camCtl.last === i && !!p));
    btn.querySelector('small').textContent = p ? fmtX(p.zoom) + (p.exp?.mode === 'manual' ? ' · ' + fmtEv(p.exp.ev) : '') : 'vazio';
    btn.disabled = !c && camCtl.presetMode !== 'clear';
    btn.title = p ? 'Posição ' + (i + 1) + ': zoom ' + fmtX(p.zoom) + ' · recorte ' + Math.round(p.pan.x * 100) + '% / ' + Math.round(p.pan.y * 100) + '%' : 'Posição ' + (i + 1) + ' vazia';
  });
}
function savePreset(i) {
  const c = camCaps(); if (!c) return false;
  slotList()[i] = { zoom: Math.round(c.zoom.value * 100) / 100, pan: { x: Math.round(c.pan.x * 1000) / 1000, y: Math.round(c.pan.y * 1000) / 1000 }, exp: { mode: c.exp.mode, ev: c.exp.ev }, wb: { mode: c.wb.mode, kelvin: c.wb.kelvin } };
  camCtlStore.set(CAM_PRESETS_KEY, camPresets); camCtl.last = i;
  try { log('Posição ' + (i + 1) + ' gravada para ' + (sources[camCtl.slot] || 'CAM ' + (camCtl.slot + 1)) + ': zoom ' + fmtX(c.zoom.value)); } catch { /* antes da mesa pronta */ }
  return true;
}
function clearPreset(i) { slotList()[i] = null; camCtlStore.set(CAM_PRESETS_KEY, camPresets); if (camCtl.last === i) camCtl.last = null; try { log('Posição ' + (i + 1) + ' apagada'); } catch { /* antes da mesa pronta */ } }
function cancelGlide() { if (camCtl.glide) { clearInterval(camCtl.glide); camCtl.glide = null; } }
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
// Leva a câmera até a posição: na hora ou com um movimento suave (zoom, recorte, brilho e cor andam juntos).
function recallPreset(i, seconds = camCtl.glideSeconds) {
  const p = slotList()[i], c = camCaps(); if (!p || !c || !camCtl.enabled) return false;
  cancelGlide(); camCtl.last = i;
  const modes = {}; if (p.exp?.mode) modes.exp = { mode: p.exp.mode }; if (p.wb?.mode) modes.wb = { mode: p.wb.mode };
  const from = { zoom: c.zoom.value, px: c.pan.x, py: c.pan.y, ev: c.exp.ev, k: c.wb.kelvin };
  const at = k => {
    const z = from.zoom + (p.zoom - from.zoom) * k, out = { zoom: z, pan: { x: from.px + (p.pan.x - from.px) * k, y: from.py + (p.pan.y - from.py) * k } };
    if (p.exp?.mode === 'manual') out.exp = { ev: from.ev + (p.exp.ev - from.ev) * k };
    if (p.wb?.mode === 'manual') out.wb = { kelvin: from.k + (p.wb.kelvin - from.k) * k };
    c.zoom.value = z; c.pan = out.pan; if (out.exp) c.exp.ev = out.exp.ev; if (out.wb) c.wb.kelvin = out.wb.kelvin;
    return out;
  };
  if (modes.exp) c.exp.mode = modes.exp.mode; if (modes.wb) c.wb.mode = modes.wb.mode;
  camCtlSend(modes);
  if (!(seconds > 0)) { camCtlSend(at(1)); camCtlPaint(); return true; }
  const start = performance.now();
  camCtl.glide = setInterval(() => {
    const k = Math.min(1, (performance.now() - start) / (seconds * 1000)); camCtlSend(at(ease(k))); camCtlPaint();
    if (k >= 1) cancelGlide();
  }, 70);
  camCtlPaint(); return true;
}
function presetClick(i) {
  if (camCtl.presetMode === 'save') { if (savePreset(i)) camCtl.presetMode = 'call'; }
  else if (camCtl.presetMode === 'clear') { clearPreset(i); camCtl.presetMode = 'call'; }
  else { if (!slotList()[i]) { ccq('#camCtlPNote').textContent = 'Posição ' + (i + 1) + ' vazia: use GRAVAR para guardar o enquadramento atual.'; return; } recallPreset(i); }
  paintBank();
}
for (const btn of ccq('#camCtlPresetMode').children) btn.onclick = () => { camCtl.presetMode = btn.dataset.pm; paintBank(); };
ccq('#camCtlGlide').onchange = e => { camCtl.glideSeconds = Number(e.target.value) || 0; camCtlStore.set('andromeda.camctl.glide.v1', camCtl.glideSeconds); };

// Segue o PREVIEW: o diretor enquadra a próxima câmera antes de levar ao AR.
setInterval(() => { if (camCtl.follow && state.prv < 10 && state.prv !== camCtl.slot) { camCtlGoTo(state.prv); } }, 300);
setInterval(() => { if (camCtl.enabled) camCtlPaint(); }, 500);
camCtlPaint();
