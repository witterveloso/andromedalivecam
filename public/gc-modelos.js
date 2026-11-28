'use strict';
/*
 * Pacote de GCs Andrômeda — modelos de tarja prontos (composition.js desenha cada um).
 * Na página "GC e efeitos": uma galeria com miniaturas feitas com o texto do próprio GC. Um clique aplica o modelo e as cores
 * sugeridas dele; cores, tamanho, largura, posição, opacidade e selo continuam editáveis. "Salvar como meu modelo" guarda a
 * personalização para usar de novo. O visual de cada camada de GC é lembrado ao reabrir o programa.
 */
(() => {
  const C = window.AndromedaComposition; if (!C?.TEMPLATES || typeof fx === 'undefined') return;
  const STORE = 'andromeda.gc.v1', MINE = 'andromeda.gc.meus.v1', VISUAL = ['style', 'tag', 'corner', 'width', 'size', 'opacity', 'background', 'color', 'accent'];
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
  const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

  // Camadas com modelo (as salvas antes desta versão ficam no Clássico) e o visual lembrado do último uso.
  const saved = read(STORE);
  for (const [i, l] of fx.live.layers.entries()) {
    l.style = l.style || 'classico'; l.tag = l.tag || '';
    const s = saved?.layers?.[i]; if (s) for (const k of [...VISUAL, 'title', 'subtitle']) if (s[k] != null) l[k] = s[k];
  }
  fx.draft = structuredClone(fx.live);
  const remember = () => write(STORE, { layers: fx.live.layers.map(l => Object.fromEntries([...VISUAL, 'title', 'subtitle'].map(k => [k, l[k]]))) });

  /* ---------- campos novos no cartão do GC: selo ---------- */
  const card = document.querySelector('#gcTitle')?.closest('.fx-card'); if (!card) return;
  const tagLabel = make('label', '', 'Selo (opcional: AO VIVO, URGENTE…)'), tag = make('input'); tag.id = 'gcTag'; tag.maxLength = 24; tag.placeholder = 'Aparece nos modelos Telejornal, Esportivo e Plantão';
  tagLabel.append(tag); document.querySelector('#gcSubtitle').closest('label').after(tagLabel);

  /* ---------- galeria ---------- */
  const box = make('div', 'gc-models'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Modelos de GC');
  const head = make('div', 'gc-models-head'); head.append(make('strong', '', 'Modelos de GC'), make('span', '', 'Um clique escolhe o modelo para personalizar; dois cliques já aplicam o modelo no programa.'));
  const grid = make('div', 'gc-models-grid'), mineHead = make('strong', 'gc-models-mine', 'Meus modelos'), mineGrid = make('div', 'gc-models-grid');
  const saveRow = make('div', 'gc-models-save'), saveName = make('input'), saveBtn = make('button', '', 'Salvar como meu modelo');
  saveName.maxLength = 30; saveName.placeholder = 'Nome do modelo (ex.: Programa da manhã)'; saveName.setAttribute('aria-label', 'Nome do meu modelo'); saveBtn.type = 'button'; saveRow.append(saveName, saveBtn);
  box.append(head, grid, mineHead, mineGrid, saveRow);
  document.querySelector('#fxLayer').closest('label').after(box);

  const layer = () => fx.draft.layers[layerIndex()];
  const thumbs = [];
  function tile(name, settings, onPick, onDelete) {
    const b = make('button', 'gc-model'); b.type = 'button'; b.title = settings.hint || name;
    const c = make('canvas'); c.width = 384; c.height = 216; c.setAttribute('aria-hidden', 'true');
    b.append(c, make('span', '', name)); b.onclick = onPick;
    // Dois cliques: escolhe e já aplica no programa (o mesmo que clicar em "Aplicar ajustes ao programa").
    b.ondblclick = () => { onPick(); commit(name); };
    const wrap = make('div', 'gc-model-wrap'); wrap.append(b);
    if (onDelete) { const x = make('button', 'gc-model-del', '×'); x.type = 'button'; x.title = 'Apagar ' + name; x.setAttribute('aria-label', 'Apagar o modelo ' + name); x.onclick = onDelete; wrap.append(x); }
    thumbs.push({ canvas: c, button: b, settings }); return wrap;
  }
  function paintThumb(t) {
    const ctx = t.canvas.getContext('2d'), W = 1920, H = 1080, l = layer();
    // Mostra de perto a parte de baixo, à esquerda, onde a tarja aparece (o quadro inteiro deixava o GC pequeno demais).
    const k = t.canvas.width / (W * .58); ctx.save(); ctx.setTransform(k, 0, 0, k, 0, -(H - t.canvas.height / k) * k);
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#4b6475'); g.addColorStop(1, '#253323'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const s = t.settings, demo = { on: true, title: l.title.trim() || (s.style === 'redes' ? '@seuperfil' : 'Nome da Pessoa'), subtitle: l.subtitle.trim() || (s.style === 'redes' ? 'Siga e ative as notificações' : 'Cargo ou função'),
      corner: 'bottom-left', width: 70, size: 60, tag: '', ...s.defaults, ...(s.custom || {}), style: s.style };
    C.compose(ctx, W, H, { pip: { on: false }, layers: [demo], logo: { on: false } });
    ctx.restore();
    t.button.setAttribute('aria-pressed', String(!s.custom && l.style === s.style));
  }
  let pending = 0;
  const repaint = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { if (!effectsPage.hidden) thumbs.forEach(paintThumb); }); };

  function commit(name) {
    document.querySelector('#fxApply')?.click();
    const st = document.querySelector('#fxStatus'); if (st) st.textContent = 'Modelo "' + name + '" aplicado ao programa.';
    try { log('GC: modelo ' + name + ' aplicado ao programa'); } catch { /* sem registro */ }
  }
  function apply(settings) {
    const l = layer(); readForm();
    Object.assign(l, settings.defaults, settings.custom || {}, { style: settings.style });
    if (!settings.custom && !settings.defaults.tag) l.tag = l.tag || '';
    loadForm(); $('#fxStatus').textContent = 'Modelo "' + (settings.name) + '" aplicado ao rascunho. Personalize se quiser e clique em Aplicar.'; repaint();
  }
  function build() {
    thumbs.length = 0;
    grid.replaceChildren(...C.TEMPLATES.map(t => tile(t.name, { style: t.id, name: t.name, hint: t.hint, defaults: t.defaults }, () => apply({ style: t.id, name: t.name, defaults: t.defaults }))));
    const mine = read(MINE) || [];
    mineHead.hidden = !mine.length;
    mineGrid.replaceChildren(...mine.map((m, i) => tile(m.name, { style: m.style, name: m.name, defaults: {}, custom: m.values }, () => apply({ style: m.style, name: m.name, defaults: {}, custom: m.values }), () => { const list = read(MINE) || []; list.splice(i, 1); write(MINE, list); build(); repaint(); })));
    repaint();
  }
  saveBtn.onclick = () => {
    readForm(); const l = layer(), name = saveName.value.trim() || 'Meu modelo ' + ((read(MINE) || []).length + 1);
    const values = Object.fromEntries(VISUAL.filter(k => k !== 'style').map(k => [k, l[k]]));
    const list = (read(MINE) || []).filter(m => m.name !== name); list.push({ name, style: l.style, values }); write(MINE, list.slice(-24));
    saveName.value = ''; build(); $('#fxStatus').textContent = 'Modelo "' + name + '" salvo em Meus modelos.';
  };

  /* ---------- selo e modelo entram no rascunho junto com os outros campos ---------- */
  const baseLoad = loadForm, baseRead = readForm;
  loadForm = function () { baseLoad(); tag.value = layer().tag || ''; repaint(); };
  readForm = function () { baseRead(); layer().tag = tag.value.trim(); };
  tag.addEventListener('input', () => { readForm(); repaint(); });
  for (const id of ['gcTitle', 'gcSubtitle']) document.querySelector('#' + id).addEventListener('input', repaint);
  document.querySelector('#fxLayer').addEventListener('change', repaint);
  // Aplicar ao programa: o visual das camadas fica lembrado para a próxima vez.
  document.querySelector('#fxApply').addEventListener('click', () => remember());
  new MutationObserver(repaint).observe(effectsPage, { attributes: true, attributeFilter: ['hidden'] });
  window.andromedaGcModels = { templates: C.TEMPLATES, apply: id => { const t = C.TEMPLATES.find(x => x.id === id); if (t) apply({ style: t.id, name: t.name, defaults: t.defaults }); }, remember };
  build(); loadForm();
})();
