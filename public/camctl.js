'use strict';
/*
 * Controle de câmera à distância (Andromeda Cam).
 * A mesa opera o celular escolhido: troca de lente física, zoom e enquadramento (posição do recorte quando há zoom).
 * Por padrão segue a câmera que está no PREVIEW: o diretor enquadra antes de levar ao AR.
 * O celular informa o que oferece (mensagem 'caps'); a mesa manda 'control' pela mesma sinalização dos convites.
 */
const camCtl = { slot: 0, follow: true, caps: new Map(), sendTimer: null, pending: null };
const camCtlPanel = document.createElement('section'); camCtlPanel.className = 'camctl'; camCtlPanel.setAttribute('aria-label', 'Controle de câmera');
camCtlPanel.innerHTML = '<div class="camctl-top"><label>Câmera <select id="camCtlSlot"></select></label><label class="camctl-follow"><input id="camCtlFollow" type="checkbox" checked> Seguir o PREVIEW</label><span id="camCtlModel" class="camctl-model"></span></div>' +
  '<div class="camctl-body"><div class="camctl-lenses" id="camCtlLenses" role="radiogroup" aria-label="Lente"></div>' +
  '<label class="camctl-zoom">Zoom <input id="camCtlZoom" type="range" min="1" max="4" step="0.01" value="1"><output id="camCtlZoomOut">1,0×</output></label>' +
  '<div class="camctl-frame"><div class="camctl-pad" id="camCtlPad" role="slider" tabindex="0" aria-label="Enquadramento: arraste ou use as setas" aria-valuetext="centro"><i id="camCtlDot"></i></div><div class="camctl-frame-side"><span class="camctl-hint">Enquadramento</span><button type="button" id="camCtlCenter">Centralizar</button><small id="camCtlNote"></small></div></div></div>' +
  '<p class="camctl-empty" id="camCtlEmpty">Esta fonte não é um celular com o Andromeda Cam conectado.</p>';
operation.append(camCtlPanel);

const ccq = s => camCtlPanel.querySelector(s);
const fmtX = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
for (let i = 0; i < 10; i++) ccq('#camCtlSlot').add(new Option('CAM ' + (i + 1), String(i)));

function camCtlSend(change) {
  // Junta mudanças rápidas (arrastar) num envio a cada 60 ms.
  camCtl.pending = { ...(camCtl.pending || {}), ...change };
  if (camCtl.sendTimer) return;
  camCtl.sendTimer = setTimeout(() => { camCtl.sendTimer = null; const m = camCtl.pending; camCtl.pending = null; if (m) camSend({ type: 'control', slot: camCtl.slot, ...m }); }, 60);
}
function camCtlPaint() {
  const c = camCtl.caps.get(camCtl.slot), select = ccq('#camCtlSlot');
  for (const o of select.options) o.textContent = (sources[+o.value] || 'CAM ' + (+o.value + 1)).split('—')[0].trim() + (camCtl.caps.has(+o.value) ? ' · celular' : '');
  if (document.activeElement !== select) select.value = String(camCtl.slot);
  ccq('.camctl-body').hidden = !c; ccq('#camCtlEmpty').hidden = !!c;
  if (!c) { ccq('#camCtlModel').textContent = ''; return; }
  ccq('#camCtlModel').textContent = c.model ? 'Aparelho: ' + c.model : '';
  const lenses = ccq('#camCtlLenses');
  if (lenses.dataset.sig !== JSON.stringify(c.lenses)) {
    lenses.dataset.sig = JSON.stringify(c.lenses); lenses.replaceChildren();
    for (const l of c.lenses) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'camctl-lens'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(l.active));
      b.innerHTML = '<b></b><small></small>'; b.querySelector('b').textContent = l.name; b.querySelector('small').textContent = l.kind;
      b.onclick = () => camCtlSend({ lens: l.id }); lenses.append(b);
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
}
window.andromedaCamCtl = {
  caps(m) { camCtl.caps.set(m.slot, { lenses: m.lenses || [], zoom: m.zoom || { min: 1, max: 1, value: 1 }, pan: m.pan || { x: 0, y: 0 }, model: m.model || '' }); if (m.slot === camCtl.slot) camCtlPaint(); },
  drop(slot) { camCtl.caps.delete(slot); camCtlPaint(); },
  state: () => camCtl,
};
ccq('#camCtlSlot').onchange = e => { camCtl.slot = +e.target.value; camCtl.follow = false; ccq('#camCtlFollow').checked = false; camCtlPaint(); };
ccq('#camCtlFollow').onchange = e => { camCtl.follow = e.target.checked; if (camCtl.follow && state.prv < 10) camCtl.slot = state.prv; camCtlPaint(); };
ccq('#camCtlZoom').oninput = e => { const v = Number(e.target.value); ccq('#camCtlZoomOut').textContent = fmtX(v); const c = camCtl.caps.get(camCtl.slot); if (c) c.zoom.value = v; camCtlSend({ zoom: v }); };
ccq('#camCtlCenter').onclick = () => { const c = camCtl.caps.get(camCtl.slot); if (c) c.pan = { x: 0, y: 0 }; camCtlSend({ center: true }); camCtlPaint(); };
// Enquadramento: arrastar o ponto (ou setas no teclado) move o recorte da câmera.
const pad = ccq('#camCtlPad');
function padTo(e) {
  const r = pad.getBoundingClientRect(), x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  const c = camCtl.caps.get(camCtl.slot); if (!c || c.zoom.value <= 1.001) return;
  c.pan = { x, y }; ccq('#camCtlDot').style.left = (50 + x * 50) + '%'; ccq('#camCtlDot').style.top = (50 + y * 50) + '%'; camCtlSend({ pan: { x, y } });
}
pad.addEventListener('pointerdown', e => { e.stopPropagation(); camCtl.dragging = true; pad.setPointerCapture(e.pointerId); padTo(e); });
pad.addEventListener('pointermove', e => { if (camCtl.dragging) padTo(e); });
for (const t of ['pointerup', 'pointercancel']) pad.addEventListener(t, () => { camCtl.dragging = false; });
pad.addEventListener('keydown', e => {
  const d = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, -.1], ArrowDown: [0, .1] }[e.key]; if (!d) return;
  e.preventDefault(); e.stopPropagation();
  const c = camCtl.caps.get(camCtl.slot); if (!c || c.zoom.value <= 1.001) return;
  c.pan = { x: Math.max(-1, Math.min(1, c.pan.x + d[0])), y: Math.max(-1, Math.min(1, c.pan.y + d[1])) }; camCtlSend({ pan: c.pan }); camCtlPaint();
});
// Segue o PREVIEW: o diretor enquadra a próxima câmera antes de levar ao AR.
setInterval(() => { if (camCtl.follow && state.prv < 10 && state.prv !== camCtl.slot) { camCtl.slot = state.prv; camCtlPaint(); } }, 300);
camCtlPaint();
