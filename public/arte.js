'use strict';
/*
 * ARTE — artes inseridas no AR durante a live (cartaz, aviso, patrocinador, QR code, tela de intervalo).
 *
 * O operador carrega as artes antes do evento (PNG, JPEG ou WebP). Elas ficam guardadas no computador e voltam quando a
 * mesa é reaberta. O botão ARTE (Comandos) coloca a arte escolhida no AR e a retira, sempre com o fade de 2 s das demais
 * inserções. Um PNG com fundo transparente fica por cima da imagem (sobreposição); uma arte opaca cobre a tela.
 * Trocar a arte com ela no AR faz a troca com fade (sai a atual, entra a nova).
 *
 * A arte é desenhada no PROGRAM por cima do GC, do logotipo e da janela; a REGRESSIVA, as BARRAS e o BLACK continuam por cima dela.
 */
(() => {
  if (typeof programOutput === 'undefined' || typeof drawFx !== 'function') return;
  const DB = 'andromeda-arte', STORE = 'artes', MAX_BYTES = 25 * 1024 * 1024, MAX_ARTS = 40;
  const arts = []; // { id, name, bitmap, thumb, w, h, fit }
  const st = { on: false, current: null, shown: null, pending: null };
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const say = m => { try { log(m); } catch { /* antes da mesa pronta */ } };
  const audit = (code, msg, data) => { try { window.andromedaAudit?.('info', code, msg, data); } catch { /* informativo */ } };

  /* ---------- guarda no computador (IndexedDB) ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); } catch (e) { reject(e); } });
    return dbp;
  }
  async function tx(mode, fn) { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s); t.oncomplete = () => resolve(out?.result ?? out); t.onerror = () => reject(t.error); }); }
  const saveRec = rec => tx('readwrite', s => s.put(rec)).catch(() => {});
  const dropRec = id => tx('readwrite', s => s.delete(id)).catch(() => {});

  async function decode(blob) {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas'), k = Math.min(1, 160 / bitmap.width, 90 / bitmap.height); c.width = Math.max(1, Math.round(bitmap.width * k)); c.height = Math.max(1, Math.round(bitmap.height * k));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    return { bitmap, thumb: c.toDataURL('image/png'), w: bitmap.width, h: bitmap.height };
  }
  async function addFiles(files) {
    let added = 0, refused = 0;
    for (const file of files) {
      if (arts.length >= MAX_ARTS) { refused++; continue; }
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_BYTES) { refused++; continue; }
      try {
        const d = await decode(file), rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60), blob: file, fit: 'contain', at: Date.now() };
        arts.push({ ...rec, ...d, blob: undefined }); await saveRec(rec); added++;
        if (!st.current) st.current = rec.id;
      } catch { refused++; }
    }
    if (added) { say('ARTE: ' + added + (added === 1 ? ' arte carregada.' : ' artes carregadas.')); audit('arte-adicionada', added + ' arte(s)', { total: arts.length }); }
    if (refused) say('ARTE: ' + refused + ' arquivo(s) recusado(s). Use PNG, JPEG ou WebP de até 25 MB (máximo ' + MAX_ARTS + ' artes).');
    paint();
  }
  async function load() {
    try {
      const recs = await tx('readonly', s => s.getAll()); recs.sort((a, b) => a.at - b.at);
      for (const rec of recs) { try { arts.push({ ...rec, ...(await decode(rec.blob)), blob: undefined }); } catch { /* arquivo corrompido: ignora */ } }
      st.current = arts[0]?.id || null; paint();
    } catch { /* sem armazenamento: as artes valem só nesta sessão */ }
  }
  const byId = id => arts.find(a => a.id === id) || null;

  /* ---------- no AR ---------- */
  function toggle() {
    if (!st.on) {
      const a = byId(st.current); if (!a) { say('ARTE: carregue uma arte primeiro (dois cliques no botão ARTE).'); return false; }
      st.on = true; st.shown = a.id; say('ARTE no AR: ' + a.name + ' (fade 2 s)'); audit('arte-no-ar', 'ARTE no AR: ' + a.name, { largura: a.w, altura: a.h });
    } else { st.on = false; st.pending = null; say('ARTE saindo do AR (fade 2 s)'); audit('arte-fora', 'ARTE retirada do AR'); }
    paint(); return true;
  }
  function choose(id) {
    if (!byId(id)) return; st.current = id;
    if (st.on && st.shown !== id) { st.pending = id; say('ARTE: trocando para ' + byId(id).name + ' (fade)'); }
    paint();
  }
  function remove(id) {
    const i = arts.findIndex(a => a.id === id); if (i < 0) return;
    if (st.on && st.shown === id) { say('ARTE: retire a arte do AR antes de apagá-la.'); return; }
    arts[i].bitmap?.close?.(); arts.splice(i, 1); dropRec(id);
    if (st.current === id) st.current = arts[0]?.id || null; paint();
  }
  function setFit(id, fit) { const a = byId(id); if (!a) return; a.fit = fit; tx('readwrite', s => { const r = s.get(id); r.onsuccess = () => { if (r.result) s.put({ ...r.result, fit }); }; return r; }).catch(() => {}); paint(); }

  function drawArt(ctx, a, W, H) {
    const s = a.fit === 'cover' ? Math.max(W / a.w, H / a.h) : Math.min(W / a.w, H / a.h), w = a.w * s, h = a.h * s;
    ctx.drawImage(a.bitmap, (W - w) / 2, (H - h) / 2, w, h);
  }
  const baseDraw = drawFx;
  drawFx = function (ctx, canvas, settings, logo, t) {
    baseDraw.apply(this, arguments);
    if (canvas !== programOutput) return;
    const F = window.andromedaFade;
    // Troca com a arte no AR: a atual sai com fade; quando sumir, a nova entra.
    if (st.pending && (F?.level('arte') ?? 0) <= 0) { st.shown = st.pending; st.pending = null; }
    const a = byId(st.shown); if (!a) return;
    const want = st.on && !st.pending;
    if (F) F.apply(ctx, 'arte', want, c => drawArt(c, a, canvas.width, canvas.height));
    else if (want) drawArt(ctx, a, canvas.width, canvas.height);
  };

  /* ---------- painel (dois cliques no botão ARTE) ---------- */
  const panel = make('div', 'arte-panel');
  panel.innerHTML = '<div class="arte-grid" role="listbox" aria-label="Artes carregadas"></div>' +
    '<div class="arte-actions"><label class="arte-add">+ Carregar artes<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label>' +
    '<button type="button" class="arte-air"></button></div><p class="arte-note"></p>';
  const grid = panel.querySelector('.arte-grid'), note = panel.querySelector('.arte-note'), air = panel.querySelector('.arte-air');
  panel.querySelector('input').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  air.onclick = () => toggle();
  panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drop'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
  panel.addEventListener('drop', e => { e.preventDefault(); panel.classList.remove('drop'); addFiles([...e.dataTransfer.files]); });
  function paint() {
    const cards = arts.map(a => {
      const card = make('div', 'arte-card'); card.setAttribute('role', 'option'); card.setAttribute('aria-selected', String(a.id === st.current));
      if (st.on && st.shown === a.id) card.dataset.air = 'true';
      const pick = make('button', 'arte-pick'); pick.type = 'button'; pick.title = a.name + ' · ' + a.w + '×' + a.h; pick.style.backgroundImage = 'url("' + a.thumb + '")'; pick.onclick = () => choose(a.id);
      const name = make('span', 'arte-name', a.name);
      const fit = make('button', 'arte-fit', a.fit === 'cover' ? 'Preencher' : 'Inteira'); fit.type = 'button'; fit.title = 'Inteira: mostra a arte toda (PNG transparente fica por cima da imagem). Preencher: cobre a tela, cortando as bordas.'; fit.onclick = () => setFit(a.id, a.fit === 'cover' ? 'contain' : 'cover');
      const del = make('button', 'arte-del', '✕'); del.type = 'button'; del.title = 'Apagar esta arte'; del.setAttribute('aria-label', 'Apagar ' + a.name); del.onclick = () => remove(a.id);
      card.append(pick, name, fit, del); return card;
    });
    grid.replaceChildren(...cards);
    air.textContent = st.on ? 'Retirar do AR' : 'Colocar no AR'; air.dataset.on = String(st.on); air.disabled = !st.on && !byId(st.current);
    note.textContent = arts.length ? 'Toque numa arte para escolher. Com a arte no AR, escolher outra troca com fade. Ficam guardadas neste computador.' : 'Nenhuma arte. Carregue PNG, JPEG ou WebP (ou arraste os arquivos para cá). Use 1920×1080; PNG com fundo transparente fica por cima da imagem.';
  }

  // Começa fora do AR com nível 0: a primeira entrada já faz o fade de 2 s (sem isto, o fade trataria a arte como "já no ar").
  window.andromedaFade?.apply(null, 'arte', false, () => {});

  window.andromedaArte = {
    toggle, choose, addFiles, remove, panel: () => { paint(); return panel; },
    isOn: () => st.on, count: () => arts.length,
    label: () => { const a = byId(st.on ? st.shown : st.current); return st.on ? '● ' + (a?.name || 'no AR') : a ? a.name : 'carregue artes'; },
    state: () => ({ on: st.on, current: st.current, shown: st.shown, pending: st.pending, arts: arts.map(a => ({ id: a.id, name: a.name, w: a.w, h: a.h, fit: a.fit })) }),
  };
  load();
})();
