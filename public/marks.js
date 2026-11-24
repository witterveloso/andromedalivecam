'use strict';
/*
 * MARCAÇÕES — atalho de câmera sobre o monitor PREVIEW.
 *
 * O operador põe uma câmera no PREVIEW, abre as MARCAÇÕES (botão nos Comandos ou tecla P) e vê as 4 posições salvas
 * daquela câmera, cada uma com a miniatura do enquadramento gravado. Um toque leva a câmera à posição; o resultado aparece
 * no PREVIEW antes de ir ao ar. Com o painel aberto, as teclas 1 a 4 escolhem a posição (em vez de cortar câmera) e
 * Esc fecha. "Gravar" guarda o enquadramento atual da câmera naquela marcação.
 *
 * As marcações são as Posições 1 a 4 do Controle de câmera (mesmo banco): o que é gravado num lugar aparece no outro.
 */
(() => {
  const P = window.andromedaCamCtl, host = document.getElementById('monPreview');
  if (!P || !host) return;
  const MARKS = 4, THUMBS_KEY = 'andromeda.marks.thumbs.v1';
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const thumbs = store.get(THUMBS_KEY, {});
  const camName = i => sources[i] || 'CAM ' + (i + 1);
  const fmtX = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') + '×';

  // Miniatura do enquadramento: o quadro atual da câmera, reduzido (cabe muitas no armazenamento local).
  function snap(slot) {
    const el = media[slot]?.element, w = el?.videoWidth || el?.naturalWidth || el?.width || 0, h = el?.videoHeight || el?.naturalHeight || el?.height || 0;
    if (!(w > 0 && h > 0)) return null;
    try {
      const c = document.createElement('canvas'); c.width = 224; c.height = 126; const g = c.getContext('2d');
      const s = Math.max(c.width / w, c.height / h), dw = w * s, dh = h * s; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(el, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh); return c.toDataURL('image/jpeg', 0.72);
    } catch { return null; }
  }
  function setThumb(slot, n, url) { (thumbs[slot] ||= {}); if (url) thumbs[slot][n] = url; else delete thumbs[slot][n]; store.set(THUMBS_KEY, thumbs); }
  addEventListener('andromeda:preset', e => { const { slot, n, saved } = e.detail || {}; if (!(n < MARKS)) return; setThumb(slot, n, saved ? snap(slot) : null); paint(); });

  /* ---------- painel sobre o PREVIEW ---------- */
  const box = document.createElement('div'); box.className = 'marks'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Marcações da câmera no PREVIEW');
  // Faixa compacta no pé do monitor: o operador continua vendo o PREVIEW enquanto escolhe.
  box.innerHTML = '<div class="marks-head"><b>MARCAÇÕES</b><span class="marks-cam"></span><span class="marks-note" aria-live="polite"></span><button type="button" class="marks-close" aria-label="Fechar marcações" title="Fechar (Esc)">×</button></div>' +
    '<div class="marks-grid"></div>';
  host.append(box);
  for (const type of ['pointerdown', 'dblclick', 'click']) box.addEventListener(type, e => e.stopPropagation());
  const grid = box.querySelector('.marks-grid'), note = box.querySelector('.marks-note'), cards = [];
  for (let n = 0; n < MARKS; n++) {
    const card = document.createElement('div'); card.className = 'mark';
    card.innerHTML = '<button type="button" class="mark-go"><span class="mark-img"></span><i>' + (n + 1) + '</i><small></small></button><button type="button" class="mark-save" title="Gravar o enquadramento atual nesta marcação">● GRAVAR</button>';
    card.querySelector('.mark-go').onclick = () => call(n);
    card.querySelector('.mark-save').onclick = () => save(n);
    grid.append(card); cards.push(card);
  }
  box.querySelector('.marks-close').onclick = () => close();
  let flash = '', flashUntil = 0;
  const say = (text, ms = 3500) => { flash = text; flashUntil = performance.now() + ms; paint(); };
  const camInPreview = () => (state.prv >= 0 && state.prv < 10 ? state.prv : null);

  function why(slot) {
    if (slot === null) return 'Ponha uma câmera no PREVIEW para escolher a marcação.';
    if (!P.connected(slot)) return camName(slot) + ': sem controle remoto (só câmeras pelo app Andrômeda no celular).';
    if (!P.state().enabled) return 'Controle de câmera desligado: ative para mover a câmera.';
    return '';
  }
  function call(n) {
    const slot = camInPreview(), block = why(slot); if (block) { say(block); return false; }
    if (!P.presetOf(slot, n)) { say('Marcação ' + (n + 1) + ' vazia: enquadre a câmera e toque em Gravar.'); return false; }
    if (!P.recallFor(slot, n)) { say('Não foi possível mover ' + camName(slot) + '.'); return false; }
    log(camName(slot) + ' → marcação ' + (n + 1) + (state.pgm === slot ? ' (no AR)' : ' no PREVIEW'));
    say(state.pgm === slot ? 'Atenção: ' + camName(slot) + ' está no AR, o movimento aparece ao vivo.' : 'Marcação ' + (n + 1) + ' no PREVIEW. CUT ou AUTO leva ao ar.'); return true;
  }
  function save(n) {
    const slot = camInPreview();
    if (slot === null || !P.connected(slot)) { say(why(slot)); return false; }
    if (!P.saveFor(slot, n)) { say('Não foi possível gravar a marcação.'); return false; }
    say('Marcação ' + (n + 1) + ' gravada para ' + camName(slot) + '.'); return true;
  }
  function paint() {
    if (box.hidden) return;
    const slot = camInPreview(), on = P.state().enabled, live = slot !== null && P.connected(slot), last = slot === null ? null : P.lastOf(slot);
    box.querySelector('.marks-cam').textContent = slot === null ? 'sem câmera no PREVIEW' : camName(slot) + (state.pgm === slot ? ' · NO AR' : '');
    box.dataset.air = String(slot !== null && state.pgm === slot);
    cards.forEach((card, n) => {
      const p = slot === null ? null : P.presetOf(slot, n), url = slot === null ? null : thumbs[slot]?.[n], img = card.querySelector('.mark-img');
      const bg = p && url ? 'url("' + url + '")' : ''; if (img.style.backgroundImage !== bg) img.style.backgroundImage = bg;
      card.dataset.filled = String(!!p); card.querySelector('.mark-go').setAttribute('aria-pressed', String(!!p && last === n));
      card.querySelector('small').textContent = p ? fmtX(p.zoom) : 'vazia';
      card.querySelector('.mark-go').disabled = !p || !live || !on; card.querySelector('.mark-save').disabled = !live;
      card.querySelector('.mark-go').title = p ? 'Levar ' + (slot === null ? '' : camName(slot)) + ' à marcação ' + (n + 1) + ' (tecla ' + (n + 1) + ')' : 'Marcação ' + (n + 1) + ' vazia';
    });
    const text = performance.now() < flashUntil ? flash : why(slot) || 'teclas 1 a 4 · Esc fecha';
    if (note.textContent !== text) note.textContent = text;
  }
  function open() { box.hidden = false; flashUntil = 0; paint(); return true; }
  function close() { box.hidden = true; return true; }
  const toggle = () => (box.hidden ? open() : close());
  setInterval(paint, 250);

  // Com o painel aberto, 1 a 4 escolhem a marcação (antes dos atalhos da mesa) e Esc fecha.
  addEventListener('keydown', e => {
    if (box.hidden || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest?.('input,select,textarea,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    const n = /^Digit([1-4])$/.test(e.code) ? +e.code.slice(5) - 1 : /^Numpad([1-4])$/.test(e.code) ? +e.code.slice(6) - 1 : -1;
    if (n >= 0) { e.preventDefault(); e.stopImmediatePropagation(); call(n); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  window.andromedaMarks = {
    open, close, toggle, call, save, isOpen: () => !box.hidden,
    // Texto curto para o botão dos Comandos.
    label() { const slot = camInPreview(); if (slot === null) return 'câmera no PREVIEW'; const cam = String(camName(slot)).split('—')[0].trim(), last = P.lastOf(slot); return cam + (last != null && last < MARKS && P.presetOf(slot, last) ? ' · marcação ' + (last + 1) : ''); },
  };
})();
