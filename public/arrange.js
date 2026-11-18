'use strict';
/*
 * Trocar os botões de lugar em todas as funções.
 * Com o PERSONALIZAR aberto, os botões dos painéis deixam de disparar e podem ser arrastados, ou escolhidos com um clique e movidos
 * com ‹ › (ou as setas do teclado), com Restaurar no título do painel. Fora do Personalizar não há nenhum botão de mover. A ordem fica salva por grupo.
 * O painel Comandos tem o seu próprio modo (commands.js); aqui ficam os outros: corte e transições, áudio master, VT, intercom e
 * o controle de câmera (lentes, posições salvas e exposição).
 */
(() => {
  const KEY = 'andromeda.order.v1';
  const store = { get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }, set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  let orders = store.get();

  // Grupos de botões que podem mudar de lugar. "container" é um seletor ou uma função que acha o elemento; "items" filtra os botões.
  const GROUPS = [
    { key: 'cut-auto', panel: 'cut', container: '.cut-auto-row' },
    { key: 'transitions', panel: 'cut', container: () => document.querySelector('.ttype')?.parentElement },
    { key: 'master-switches', panel: 'layers', container: '.master-switches' },
    { key: 'vt-actions', panel: 'vt', container: '.vt-actions' },
    { key: 'intercom', panel: 'intercom', container: '.intercom-panel', items: ':scope > button' },
    { key: 'camctl-lenses', panel: 'camctl', container: '#camCtlLenses' },
    { key: 'camctl-exposure', panel: 'camctl', container: '#camCtlExpMode' },
    { key: 'camctl-wb', panel: 'camctl', container: '#camCtlWbMode' },
    { key: 'camctl-bankmode', panel: 'camctl', container: '#camCtlPresetMode' },
    { key: 'camctl-presets', panel: 'camctl', container: '#camCtlPresets' },
  ];

  const idOf = el => el.dataset.arr || el.id || el.dataset.mode || el.dataset.cmd || (el.className + '|' + el.textContent.trim().slice(0, 24));
  const panels = new Map(); // painel -> { groups: [], box, buttons }

  function groupItems(g) { return [...g.el.querySelectorAll(g.items || ':scope > *')].filter(el => !el.hidden && el.tagName !== 'INPUT'); }
  function tag(g) { for (const el of groupItems(g)) { el.dataset.arrItem = '1'; } }
  function remember(g) { for (const el of groupItems(g)) if (!g.orig.includes(idOf(el))) g.orig.push(idOf(el)); }

  // Põe os botões na ordem salva (ou, sem ordem salva, na ordem original). Só mexe no DOM se a ordem realmente mudou.
  function apply(g) {
    const items = groupItems(g); if (!items.length) return;
    remember(g); tag(g);
    const wanted = orders[g.key] || g.orig, rank = id => { const i = wanted.indexOf(id); return i < 0 ? 1e6 + g.orig.indexOf(id) : i; };
    const sorted = [...items].sort((a, b) => rank(idOf(a)) - rank(idOf(b)));
    if (sorted.every((el, i) => el === items[i])) return;
    g.observer.disconnect();
    const anchor = items[items.length - 1].nextSibling; // mantém o que vem depois do último botão (ex.: texto de apoio) no lugar
    for (const el of sorted) g.el.insertBefore(el, anchor);
    g.observer.observe(g.el, { childList: true });
  }
  function save(g) { orders[g.key] = groupItems(g).map(idOf); store.set(orders); }

  function setMoving(panel, on) {
    const p = panels.get(panel); if (!p) return;
    p.moving = on; panel.dataset.arrange = String(on);
    p.tools.hidden = !on; if (!on) select(p, null);
    for (const g of p.groups) for (const el of groupItems(g)) { el.draggable = on; }
  }
  function select(p, el) { p.selected?.classList.remove('arr-selected'); p.selected = el; el?.classList.add('arr-selected'); }
  function nudge(p, dir) {
    const el = p.selected; if (!el) return;
    const g = p.groups.find(x => x.el.contains(el)); if (!g) return;
    const items = groupItems(g), at = items.indexOf(el), to = at + dir; if (at < 0 || to < 0 || to >= items.length) return;
    g.observer.disconnect(); g.el.insertBefore(el, dir < 0 ? items[to] : items[to].nextSibling); g.observer.observe(g.el, { childList: true }); save(g);
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function wire(g, p) {
    const stop = e => { if (!p.moving) return; if (!e.target.closest('[data-arr-item]')) return; e.stopImmediatePropagation(); };
    // Em modo mover os botões não disparam nada: os eventos param aqui, antes de chegar ao botão.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'contextmenu']) g.el.addEventListener(type, stop, true);
    g.el.addEventListener('click', e => { if (!p.moving) return; const el = e.target.closest('[data-arr-item]'); if (!el || !g.el.contains(el)) return; e.stopImmediatePropagation(); e.preventDefault(); select(p, el === p.selected ? null : el); }, true);
    g.el.addEventListener('keydown', e => { if (!p.moving) return; const el = e.target.closest('[data-arr-item]'); if (!el) return; if (e.key === 'Enter' || e.key === ' ') { e.stopImmediatePropagation(); e.preventDefault(); select(p, el); } else if (['ArrowLeft', 'ArrowRight'].includes(e.key) && el === p.selected) { e.stopImmediatePropagation(); e.preventDefault(); nudge(p, e.key === 'ArrowLeft' ? -1 : 1); } }, true);
    // Arrastar e soltar dentro do grupo.
    let dragging = null;
    g.el.addEventListener('dragstart', e => { const el = e.target.closest?.('[data-arr-item]'); if (!p.moving || !el || !g.el.contains(el)) { e.preventDefault(); return; } dragging = el; el.classList.add('arr-dragging'); select(p, el); try { e.dataTransfer.setData('text/plain', idOf(el)); e.dataTransfer.effectAllowed = 'move'; } catch { /* sem dados */ } });
    g.el.addEventListener('dragover', e => { if (!dragging) return; const over = e.target.closest?.('[data-arr-item]'); if (!over || over === dragging || !g.el.contains(over)) return; e.preventDefault(); const r = over.getBoundingClientRect(), after = (e.clientX - r.left) > r.width / 2 || (e.clientY - r.top) > r.height * .75 && r.width < 4; for (const x of groupItems(g)) x.classList.remove('arr-drop-before', 'arr-drop-after'); over.classList.add(after ? 'arr-drop-after' : 'arr-drop-before'); });
    g.el.addEventListener('drop', e => {
      if (!dragging) return; const over = e.target.closest?.('[data-arr-item]'); if (!over || over === dragging) return; e.preventDefault();
      const after = over.classList.contains('arr-drop-after'); g.observer.disconnect(); g.el.insertBefore(dragging, after ? over.nextSibling : over); g.observer.observe(g.el, { childList: true }); save(g);
    });
    g.el.addEventListener('dragend', () => { dragging?.classList.remove('arr-dragging'); dragging = null; for (const x of groupItems(g)) x.classList.remove('arr-drop-before', 'arr-drop-after'); });
  }

  function attach(def) {
    const el = typeof def.container === 'function' ? def.container() : document.querySelector(def.container); if (!el || el.dataset.arrGroup) return false;
    const panel = el.closest('.dock-panel') || document.querySelector('.dock-panel[data-tool="' + def.panel + '"]'); if (!panel) return false;
    const g = { ...def, el, orig: [], observer: null }; el.dataset.arrGroup = def.key;
    g.observer = new MutationObserver(() => apply(g));
    let p = panels.get(panel);
    if (!p) {
      p = { groups: [], moving: false, selected: null };
      p.tools = make('span', 'arr-tools'); p.tools.hidden = true;
      const left = make('button', 'arr-step', '‹'), right = make('button', 'arr-step', '›'), reset = make('button', 'arr-reset', 'Restaurar');
      for (const b of [left, right, reset]) b.type = 'button';
      left.title = 'Move o botão escolhido para trás'; right.title = 'Move o botão escolhido para frente'; reset.title = 'Volta os botões deste painel à ordem original';
      left.onclick = () => nudge(p, -1); right.onclick = () => nudge(p, 1);
      reset.onclick = () => { for (const x of p.groups) { delete orders[x.key]; apply(x); } store.set(orders); };
      p.tools.append(left, right, reset);
      const box = make('span', 'dock-tools arr-box'); box.append(p.tools); for (const type of ['pointerdown', 'keydown']) box.addEventListener(type, e => e.stopPropagation());
      const handle = panel.querySelector(':scope > .dock-handle');
      if (handle) handle.insertBefore(box, handle.querySelector('.free-size')); else panel.prepend(box);
      panels.set(panel, p);
    }
    p.groups.push(g); wire(g, p); apply(g); g.observer.observe(el, { childList: true }); follow();
    if (p.moving) for (const x of groupItems(g)) x.draggable = true;
    return true;
  }
  // Os painéis nascem em momentos diferentes (alguns só quando o celular conecta); tenta de novo até achar todos.
  function scan() { for (const def of GROUPS) attach(def); }
  const follow = () => { for (const [panel, p] of panels) { const want = !!panel.ownerDocument?.body?.classList.contains('layout-editing'); if (want !== p.moving) setMoving(panel, want); } };
  scan(); setTimeout(scan, 400); setTimeout(scan, 1500); setInterval(scan, 3000); setInterval(follow, 250);
  window.andromedaArrange = { scan, orders: () => orders, groups: () => GROUPS.map(g => g.key), setMoving: (tool, on) => { const panel = document.querySelector('.dock-panel[data-tool="' + tool + '"]'); if (panel) setMoving(panel, on); }, nudgeSelected: (tool, dir) => { const panel = document.querySelector('.dock-panel[data-tool="' + tool + '"]'); const p = panels.get(panel); if (p) nudge(p, dir); }, select: (tool, el) => { const p = panels.get(document.querySelector('.dock-panel[data-tool="' + tool + '"]')); if (p) select(p, el); } };
})();
