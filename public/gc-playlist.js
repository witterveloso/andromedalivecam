'use strict';
/*
 * GC · Créditos programados (playlist).
 *
 * Os créditos do programa ficam prontos antes de entrar no ar (nome e função de cada pessoa). Um deles fica "NO PONTO":
 * é o que entra quando o operador toca o botão GC. Tocar de novo tira do ar e, com "Avançar sozinho" ligado, o próximo
 * da lista já fica no ponto. Dois cliques no botão GC abrem a lista para editar e escolher qual fica no ponto.
 * O visual (cor, posição, tamanho) continua sendo o do GC · Créditos (camada 1) da página GC e efeitos.
 */
(() => {
  const STORE = 'andromeda.gc.playlist.v1';
  const uid = () => Math.random().toString(36).slice(2, 9);
  const L = { items: [], cue: 0, auto: true, onAirId: null };
  try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && Array.isArray(s.items)) Object.assign(L, { items: s.items.filter(i => i && typeof i.title === 'string').slice(0, 200).map(i => ({ id: i.id || uid(), title: String(i.title).slice(0, 120), subtitle: String(i.subtitle || '').slice(0, 160) })), cue: Number(s.cue) || 0, auto: s.auto !== false }); } catch { /* primeiro uso */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ items: L.items, cue: L.cue, auto: L.auto })); } catch { /* sem armazenamento */ } };
  const clampCue = () => { L.cue = L.items.length ? Math.min(L.items.length - 1, Math.max(0, L.cue)) : 0; };
  clampCue();
  const layer = () => fx.live.layers[0];
  const cued = () => L.items[L.cue] || null;
  let panelEl = null;

  // Coloca o crédito no GC · Créditos (texto do AR e da página de ajustes ficam iguais).
  function load(item) {
    for (const l of [fx.live.layers[0], fx.draft?.layers?.[0]]) if (l) { l.title = item.title; l.subtitle = item.subtitle; }
    if (typeof loadForm === 'function' && Number($('#fxLayer')?.value || 0) === 0) { try { loadForm(); } catch { /* página não aberta */ } }
  }
  // Botão GC: entra o crédito que está no ponto; tocar de novo tira e (com Avançar sozinho) deixa o próximo no ponto.
  function run() {
    if (!L.items.length) { $('#fxGC0').click(); return; }   // sem lista: o GC funciona como antes
    const l = layer();
    if (l.on) {
      l.on = false; quickSync(); log('GC retirado do AR: ' + (L.items.find(i => i.id === L.onAirId)?.title || l.title));
      const i = L.items.findIndex(x => x.id === L.onAirId); L.onAirId = null;
      if (L.auto && i >= 0 && i < L.items.length - 1) L.cue = i + 1;
      save(); paint(); return;
    }
    const item = cued(); if (!item || !(item.title.trim() || item.subtitle.trim())) { log('GC: o crédito no ponto está vazio. Dois cliques no GC para editar.'); return; }
    load(item); l.on = true; L.onAirId = item.id; quickSync();
    log('GC no AR: ' + item.title + (item.subtitle ? ' · ' + item.subtitle : '') + ' (' + (L.cue + 1) + '/' + L.items.length + ')');
    window.andromedaAudit?.('info', 'gc-credito', 'Crédito no AR: ' + item.title, { posicao: L.cue + 1, total: L.items.length });
    save(); paint();
  }
  function label() {
    if (!L.items.length) return '';
    const onAir = L.items.find(i => i.id === L.onAirId && layer().on), item = onAir || cued();
    return (onAir ? '● ' : 'ponto ' + (L.cue + 1) + '/' + L.items.length + ' · ') + (item?.title || '');
  }
  function next(step = 1) { if (!L.items.length) return; L.cue = (L.cue + step + L.items.length) % L.items.length; save(); paint(); log('GC no ponto: ' + (cued()?.title || '')); }

  /* ---------- lista (dois cliques no botão GC) ---------- */
  function panel(openVisual) {
    const el = document.createElement('div'); el.className = 'gcl-panel'; panelEl = el;
    el.innerHTML = '<p class="gcl-help">Programe os créditos do programa. O marcado como <b>NO PONTO</b> entra quando você toca o GC.</p>' +
      '<ol class="gcl-list"></ol>' +
      '<div class="gcl-add"><input class="gcl-new-title" maxlength="120" placeholder="Nome (ex.: Maria Silva)" aria-label="Nome do novo crédito"><input class="gcl-new-sub" maxlength="160" placeholder="Função (ex.: Repórter)" aria-label="Função do novo crédito"><button type="button" class="gcl-add-btn">+ Adicionar crédito</button></div>' +
      '<label class="gcl-auto"><input type="checkbox"> Avançar sozinho: ao tirar do ar, o próximo fica no ponto</label>' +
      '<div class="gcl-foot"><button type="button" class="gcl-prev">‹ Anterior no ponto</button><button type="button" class="gcl-next">Próximo no ponto ›</button><button type="button" class="gcl-visual">Visual do GC (cor, posição)</button></div>';
    const auto = el.querySelector('.gcl-auto input'); auto.checked = L.auto; auto.onchange = () => { L.auto = auto.checked; save(); };
    const t = el.querySelector('.gcl-new-title'), s = el.querySelector('.gcl-new-sub');
    const add = () => { if (!t.value.trim() && !s.value.trim()) { t.focus(); return; } L.items.push({ id: uid(), title: t.value.trim(), subtitle: s.value.trim() }); if (L.items.length === 1) L.cue = 0; t.value = ''; s.value = ''; save(); paint(); t.focus(); };
    el.querySelector('.gcl-add-btn').onclick = add;
    for (const input of [t, s]) input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (input === t && !s.value) s.focus(); else add(); } };
    el.querySelector('.gcl-prev').onclick = () => next(-1); el.querySelector('.gcl-next').onclick = () => next(1);
    el.querySelector('.gcl-visual').onclick = () => openVisual?.();
    paint(); return el;
  }
  function paint() {
    window.andromedaCommandsPaint?.();
    const el = panelEl; if (!el || (!el.isConnected && el.dataset.drawn)) return; el.dataset.drawn = '1';
    const list = el.querySelector('.gcl-list');
    if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { markCue(list); return; }
    list.replaceChildren(...L.items.map((item, i) => {
      const li = document.createElement('li'); li.className = 'gcl-item'; li.dataset.id = item.id;
      li.innerHTML = '<button type="button" class="gcl-cue"></button><span class="gcl-fields"><input class="gcl-title" maxlength="120" aria-label="Nome"><input class="gcl-sub" maxlength="160" aria-label="Função"></span><span class="gcl-move"><button type="button" class="gcl-up" aria-label="Subir">▲</button><button type="button" class="gcl-down" aria-label="Descer">▼</button><button type="button" class="gcl-del" aria-label="Remover">✕</button></span>';
      const [title, sub] = li.querySelectorAll('input'); title.value = item.title; sub.value = item.subtitle;
      const sync = () => { item.title = title.value; item.subtitle = sub.value; save(); if (L.onAirId === item.id && layer().on) load(item); window.andromedaCommandsPaint?.(); };
      title.oninput = sync; sub.oninput = sync;
      li.querySelector('.gcl-cue').onclick = () => { L.cue = i; save(); paint(); };
      li.querySelector('.gcl-up').onclick = () => move(i, -1); li.querySelector('.gcl-down').onclick = () => move(i, 1);
      li.querySelector('.gcl-del').onclick = () => { if (L.onAirId === item.id && layer().on) { log('Tire o crédito do AR antes de removê-lo.'); return; } L.items.splice(i, 1); if (L.cue > i) L.cue--; clampCue(); save(); paint(); };
      return li;
    }));
    if (!L.items.length) { const li = document.createElement('li'); li.className = 'gcl-empty'; li.textContent = 'Nenhum crédito ainda: adicione abaixo. Sem lista, o GC usa o texto da página GC e efeitos.'; list.append(li); }
    markCue(list);
  }
  function markCue(list) {
    list.querySelectorAll('.gcl-item').forEach((li, i) => {
      const onAir = L.onAirId === li.dataset.id && layer().on, isCue = i === L.cue && !onAir;
      li.dataset.state = onAir ? 'air' : isCue ? 'cue' : '';
      const b = li.querySelector('.gcl-cue'); b.textContent = onAir ? 'NO AR' : isCue ? 'NO PONTO' : String(i + 1); b.setAttribute('aria-pressed', String(isCue || onAir)); b.title = 'Deixar este crédito no ponto';
    });
  }
  function move(i, d) {
    const j = i + d; if (j < 0 || j >= L.items.length) return;
    [L.items[i], L.items[j]] = [L.items[j], L.items[i]];
    if (L.cue === i) L.cue = j; else if (L.cue === j) L.cue = i;
    save(); paint();
  }
  // Atalho: o crédito no ponto pode avançar e voltar sem abrir a lista.
  window.andromedaGcList = { run, label, panel, next, has: () => L.items.length > 0, state: L };
})();
