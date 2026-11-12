'use strict';
/*
 * Andrômeda Live — saída vertical 9:16 para Instagram, TikTok e outras plataformas verticais.
 *
 * O PROGRAM continua 16:9 (YouTube, Facebook…). Esta saída monta, quadro a quadro, uma versão 9:16 a partir do
 * mesmo PROGRAM, com GC, logotipo e PiP, e o operador escolhe o enquadramento:
 *  - Recortar: a imagem ocupa a tela toda; o operador escolhe que parte do 16:9 aparece (arrastando na prévia).
 *  - Inteira com fundo desfocado: o quadro 16:9 completo no centro, sobre um fundo desfocado da própria imagem.
 *  - Inteira com barras: o quadro 16:9 completo, com barras pretas em cima e embaixo.
 * O serviço codifica esta saída num FFmpeg separado (publish.cjs): se ela cair, o 16:9 continua no ar.
 */
(() => {
  const STORE = 'andromeda.vertical.v1';
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const s = { mode: 'crop', pos: 0.5, resolution: '720p', bitrate: 4 };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || '{}'); if (['crop', 'blur', 'bars'].includes(saved.mode)) s.mode = saved.mode; if (Number.isFinite(saved.pos)) s.pos = Math.min(1, Math.max(0, saved.pos)); if (['720p', '1080p'].includes(saved.resolution)) s.resolution = saved.resolution; if (Number.isFinite(saved.bitrate)) s.bitrate = Math.min(12, Math.max(2, saved.bitrate)); } catch { /* primeiro uso */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* sem armazenamento */ } };

  const canvas = make('canvas'); canvas.id = 'programVertical'; canvas.setAttribute('aria-label', 'Prévia da saída vertical 9:16');
  const small = make('canvas'); small.width = 36; small.height = 64;
  const size = () => s.resolution === '1080p' ? [1080, 1920] : [720, 1280];
  const fit = () => { const [w, h] = size(); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } };
  fit();
  let live = false;

  function draw() {
    const src = typeof programOutput !== 'undefined' ? programOutput : null; if (!src?.width) return;
    fit();
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, sw = src.width, sh = src.height;
    const cw = Math.min(sw, sh * W / H); // largura do recorte 9:16 dentro do 16:9
    if (s.mode === 'crop') { ctx.drawImage(src, (sw - cw) * s.pos, 0, cw, sh, 0, 0, W, H); return; }
    if (s.mode === 'blur') {
      // Fundo desfocado barato: o recorte central em 36×64 e ampliado de volta.
      const sc = small.getContext('2d'); sc.drawImage(src, (sw - cw) / 2, 0, cw, sh, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low'; ctx.drawImage(small, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0, 0, 0, .35)'; ctx.fillRect(0, 0, W, H);
    } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    const h = W * sh / sw; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, (H - h) / 2, W, h);
  }
  // Desenha junto com o PROGRAM: só quando a saída vertical está no ar ou a prévia está à vista.
  let preview = null;
  const visible = () => !!preview && preview.offsetParent !== null && !document.hidden;
  if (typeof routeProgramOutput === 'function') {
    const base = routeProgramOutput;
    routeProgramOutput = function () { base.apply(this, arguments); if (live || visible()) draw(); };
  }

  /* ---------- cartão na página Transmissão ---------- */
  function mount(container, { onChange } = {}) {
    const card = make('section', 'vertical-panel');
    const head = make('header'); head.append(make('strong', '', 'Saída vertical 9:16'));
    const uses = make('span', 'vertical-uses'); head.append(uses);
    preview = make('div', 'vertical-preview'); preview.append(canvas);
    const hint = make('span', 'vertical-hint', 'Arraste para escolher o que aparece'); preview.append(hint);
    const controls = make('div', 'vertical-controls');
    const modes = make('div', 'vertical-modes'); modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Enquadramento vertical');
    const MODES = [['crop', 'Recortar', 'Ocupa a tela toda; você escolhe a parte do 16:9.'], ['blur', 'Inteira · fundo desfocado', 'Mostra o quadro todo, sem cortar GC nem laterais.'], ['bars', 'Inteira · barras pretas', 'Quadro todo com barras em cima e embaixo.']];
    const modeButtons = MODES.map(([id, label, tip]) => { const b = make('button', '', label); b.type = 'button'; b.title = tip; b.setAttribute('role', 'radio'); b.onclick = () => { s.mode = id; save(); paint(); draw(); }; modes.append(b); return b; });
    const posLabel = make('label', 'vertical-pos'), posHead = make('span', 'vertical-pos-head'), posOut = make('output'), pos = make('input');
    posHead.append(make('span', '', 'Posição do recorte'), posOut);
    Object.assign(pos, { type: 'range', min: 0, max: 100, step: 1 });
    const quick = make('div', 'vertical-quick');
    for (const [text, v] of [['Esquerda', 0], ['Centro', .5], ['Direita', 1]]) { const b = make('button', '', text); b.type = 'button'; b.onclick = () => setPos(v); quick.append(b); }
    posLabel.append(posHead, pos, quick);
    const res = make('select'); res.add(new Option('720 × 1280 · padrão do Instagram', '720p')); res.add(new Option('1080 × 1920', '1080p'));
    const bit = make('input'); Object.assign(bit, { type: 'number', min: 2, max: 12, step: .5 });
    const resLabel = make('label', '', 'Resolução vertical'); resLabel.append(res);
    const bitLabel = make('label', '', 'Bitrate vertical (Mbps)'); bitLabel.append(bit);
    const note = make('p', 'quality-note', 'Montada a partir do PGM, com GC e logotipo. No recorte, o que estiver nas laterais do 16:9 fica fora do quadro: para garantir o GC inteiro, use "Inteira". A saída vertical tem codificação própria; se ela falhar, a 16:9 continua no ar.');
    controls.append(modes, posLabel, resLabel, bitLabel, note);
    const body = make('div', 'vertical-body'); body.append(preview, controls);
    card.append(head, body);
    container.append(card);

    function setPos(v) { s.pos = Math.min(1, Math.max(0, v)); save(); paint(); draw(); }
    pos.oninput = () => setPos(Number(pos.value) / 100);
    res.onchange = () => { s.resolution = res.value; s.bitrate = s.resolution === '1080p' ? Math.max(s.bitrate, 6) : s.bitrate; save(); paint(); draw(); onChange?.(); };
    bit.onchange = () => { s.bitrate = Math.min(12, Math.max(2, Number(bit.value) || 4)); save(); paint(); onChange?.(); };
    // Arrastar na prévia move o recorte (também durante a live).
    let drag = null;
    preview.addEventListener('pointerdown', e => { if (s.mode !== 'crop') return; drag = { x: e.clientX, pos: s.pos }; preview.setPointerCapture(e.pointerId); });
    preview.addEventListener('pointermove', e => { if (!drag) return; const r = canvas.getBoundingClientRect(), src = typeof programOutput !== 'undefined' ? programOutput : canvas, cw = src.height * 9 / 16, travel = Math.max(1, src.width - cw); setPos(drag.pos - (e.clientX - drag.x) / r.width * cw / travel); });
    for (const ev of ['pointerup', 'pointercancel']) preview.addEventListener(ev, () => { drag = null; });

    function paint() {
      for (const b of modeButtons) b.setAttribute('aria-checked', String(MODES[modeButtons.indexOf(b)][0] === s.mode));
      posLabel.hidden = s.mode !== 'crop'; hint.hidden = s.mode !== 'crop';
      pos.value = Math.round(s.pos * 100); posOut.textContent = s.pos < .02 ? 'esquerda' : s.pos > .98 ? 'direita' : Math.abs(s.pos - .5) < .02 ? 'centro' : Math.round(s.pos * 100) + '%';
      res.value = s.resolution; bit.value = s.bitrate;
      res.disabled = bit.disabled = live; // formato e bitrate valem a partir da próxima transmissão; o enquadramento muda ao vivo
    }
    paint();
    api.paint = paint;
    api.setUses = names => { uses.textContent = names.length ? 'Usada por: ' + names.join(', ') : 'Nenhum destino vertical ativo'; card.dataset.used = String(names.length > 0); };
    return card;
  }

  const api = window.andromedaVertical = {
    canvas, settings: s, size, draw, mount, paint() {}, setUses() {},
    setLive(on) { live = !!on; api.paint(); if (live) draw(); },
  };
})();
