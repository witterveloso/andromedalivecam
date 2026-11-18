'use strict';
/*
 * SLIDES · apresentações no ar.
 *
 * O operador carrega a apresentação na mesa (arrastando ou em "Abrir apresentação") e passa os slides por atalho, botão ou
 * celular (controle remoto). Os slides são uma FONTE (15), como o VT: o comando leva ao PREVIEW; CUT ou AUTO levam ao AR.
 * Avançar e voltar mexem no slide mostrado, esteja ele no PREVIEW ou no AR.
 *
 * Formatos:
 *  - Imagens (PNG, JPG, WEBP, GIF, BMP, SVG, AVIF…): cada imagem é um slide; vários arquivos viram uma apresentação só.
 *  - PDF: aberto aqui mesmo (leitor pdf.js embutido, sem internet).
 *  - PowerPoint (PPTX, PPT, PPS, PPSX…), OpenDocument (ODP), Keynote (KEY), Word, Excel, TIFF e outros: o serviço local converte em PDF
 *    pelo Microsoft PowerPoint (se instalado) ou pelo LibreOffice. Sem nenhum dos dois, o PPTX abre pelo leitor simplificado
 *    embutido (slides-pptx.js); os demais pedem para exportar em PDF.
 */
(() => {
  const R = window.andromedaRundown; if (!R) return;
  const SLIDES_SOURCE = 15, BOX = [1920, 1080], THUMB = [256, 144], CACHE_MAX = 9;
  const KEY = 'andromeda.slides.v1';
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const settings = { transition: 'fade', fit: 'contain', bg: 'black', auto: 0, loop: false, ...store.get(KEY, {}) };
  const saveSettings = () => store.set(KEY, settings);

  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'webp', 'gif', 'apng', 'bmp', 'svg', 'avif', 'ico']);
  const PPTX_EXT = new Set(['pptx', 'ppsx', 'pptm', 'ppsm', 'potx', 'potm']);
  const OFFICE_EXT = new Set(['ppt', 'pps', 'pot', 'odp', 'otp', 'fodp', 'sxi', 'sti', 'key', 'dps', ...PPTX_EXT, 'doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'txt', 'wpd', 'wps', 'xls', 'xlsx', 'xlsm', 'ods', 'csv', 'et', 'tif', 'tiff', 'emf', 'wmf', 'vsd', 'vsdx', 'pub']);
  const ACCEPT = ['image/*', 'application/pdf', ...[...IMAGE_EXT, ...OFFICE_EXT, 'pdf'].map(e => '.' + e)].join(',');
  const extOf = name => (String(name).match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
  const natural = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });

  const slides = { decks: [], active: null };

  /* ---------- reconhecer o formato (pelo conteúdo, não só pelo nome) ---------- */
  async function sniff(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer()), ext = extOf(file.name), str = (a, b) => String.fromCharCode(...head.slice(a, b));
    if (str(0, 4) === '%PDF') return 'pdf';
    if (head[0] === 0x89 && str(1, 4) === 'PNG' || head[0] === 0xFF && head[1] === 0xD8 || str(0, 3) === 'GIF' || str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP' || str(4, 11) === 'ftypavi') return 'image';
    if (str(0, 2) === 'BM' && ext === 'bmp') return 'image';
    if (head[0] === 0x50 && head[1] === 0x4B) return PPTX_EXT.has(ext) ? 'pptx' : 'office'; // ZIP: OOXML, ODF…
    if (head[0] === 0xD0 && head[1] === 0xCF) return 'office'; // OLE: .ppt, .doc, .xls antigos
    if (ext === 'pdf') return 'pdf';
    if (IMAGE_EXT.has(ext) || /^image\/(png|jpe?g|webp|gif|bmp|svg\+xml|avif)$/.test(file.type)) return 'image';
    return OFFICE_EXT.has(ext) ? (PPTX_EXT.has(ext) ? 'pptx' : 'office') : 'office'; // o conversor tenta e avisa se não souber
  }

  /* ---------- leitores ---------- */
  let pdfLib = null;
  const pdfjs = () => pdfLib || (pdfLib = import('/vendor/pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m; }));
  async function openPdf(data) {
    const lib = await pdfjs();
    const pdf = await lib.getDocument({ data, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', iccUrl: '/vendor/pdfjs/iccs/', isEvalSupported: false }).promise;
    return {
      count: pdf.numPages,
      async render(i, bw, bh) {
        const page = await pdf.getPage(i + 1), v1 = page.getViewport({ scale: 1 }), s = Math.min(bw / v1.width, bh / v1.height), vp = page.getViewport({ scale: s });
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#ffffff' }).promise; page.cleanup(); return c;
      },
      destroy() { try { pdf.destroy(); } catch { /* já liberado */ } },
    };
  }
  function imageReader(files) {
    return {
      count: files.length,
      async render(i, bw, bh) {
        const file = files[i];
        const img = new Image(), url = URL.createObjectURL(file);
        try {
          img.src = url; await img.decode(); // decodifica tudo o que o navegador entende, inclusive SVG
          const s = Math.min(1, bw / (img.naturalWidth || bw), bh / (img.naturalHeight || bh)) || 1, w = Math.max(1, Math.round((img.naturalWidth || bw) * s)), h = Math.max(1, Math.round((img.naturalHeight || bh) * s));
          const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return c;
        } finally { URL.revokeObjectURL(url); }
      },
      destroy() { /* nada a liberar */ },
    };
  }
  async function pptxReader(buffer) {
    const model = await window.andromedaPptx.parse(buffer);
    return {
      count: model.slides.length,
      async render(i, bw, bh) {
        const s = Math.min(bw / model.size.w, bh / model.size.h), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(model.size.w * s)); c.height = Math.max(1, Math.round(model.size.h * s));
        await model.slides[i].render(c.getContext('2d'), c.width, c.height); return c;
      },
      destroy() { /* nada a liberar */ },
    };
  }

  /* ---------- conversão pelo serviço local (PowerPoint ou LibreOffice) ---------- */
  async function convertToPdf(file) {
    const session = (typeof liveTx !== 'undefined' && liveTx.session) || await (await fetch('/api/session', { cache: 'no-store' })).json();
    const r = await fetch('/api/slides/convert?ext=' + encodeURIComponent(extOf(file.name) || 'bin'), { method: 'POST', headers: { 'X-Andromeda-Token': session.token, 'Content-Type': 'application/octet-stream' }, body: file });
    if (!r.ok) { let m = {}; try { m = await r.json(); } catch { /* sem corpo */ } throw Object.assign(new Error(m.error || 'A conversão falhou (' + r.status + ').'), { code: m.code || 'failed' }); }
    return new Uint8Array(await r.arrayBuffer());
  }
  let engines = null;
  async function engineStatus() { if (!engines) { try { engines = await (await fetch('/api/slides/status', { cache: 'no-store' })).json(); } catch { engines = { ready: false }; } } return engines; }

  /* ---------- apresentações (decks) ---------- */
  let uid = 0;
  function newDeck(name, kind) { return { id: ++uid, name, kind, status: 'loading', error: '', note: '', count: 0, index: 0, want: 0, reader: null, cache: new Map(), pending: new Map(), thumbs: [], shown: null, prev: null, fadeAt: 0, token: 0, changedAt: performance.now() }; }
  function remember(d, i, dr) {
    d.cache.set(i, dr);
    const keep = new Set([d.index, d.want, d.index + 1, d.index - 1, d.want + 1]);
    for (const k of [...d.cache.keys()]) { if (d.cache.size <= CACHE_MAX) break; if (keep.has(k)) continue; const old = d.cache.get(k); d.cache.delete(k); if (old !== d.shown && old !== d.prev) old.close?.(); }
  }
  function pageCanvas(d, i) {
    if (d.cache.has(i)) return Promise.resolve(d.cache.get(i));
    if (!d.pending.has(i)) d.pending.set(i, d.reader.render(i, BOX[0], BOX[1]).then(dr => { remember(d, i, dr); return dr; }).finally(() => d.pending.delete(i)));
    return d.pending.get(i);
  }
  const prefetch = (d, i) => { for (const j of [i + 1, i - 1, i + 2]) if (j >= 0 && j < d.count && slides.decks.includes(d)) pageCanvas(d, j).catch(() => {}); };

  // Muda o slide mostrado. Com o slide já pronto a troca é imediata (sem esperar nada), senão espera a imagem ficar pronta.
  function go(i, d = slides.active) {
    if (!d || d.status !== 'ready' || !d.count) return false;
    i = Math.max(0, Math.min(d.count - 1, Math.trunc(i))); const mine = ++d.token; d.want = i;
    const apply = dr => { if (mine !== d.token || !slides.decks.includes(d)) return; d.prev = d.shown; d.shown = dr; d.index = i; d.fadeAt = performance.now(); d.changedAt = d.fadeAt; prefetch(d, i); paintPanel(); };
    const ready = d.cache.get(i); if (ready) apply(ready); else pageCanvas(d, i).then(apply, () => log('Slides: não foi possível desenhar o slide ' + (i + 1) + '.'));
    paintPanel(); return true;
  }
  function next() {
    const d = slides.active; if (!d || d.status !== 'ready') return false;
    if (d.want >= d.count - 1) { if (settings.loop) return go(0, d); log('Slides: último slide.'); return false; }
    return go(d.want + 1, d);
  }
  function prev() { const d = slides.active; if (!d || d.status !== 'ready') return false; if (d.want <= 0) { log('Slides: primeiro slide.'); return false; } return go(d.want - 1, d); }
  const first = () => go(0), last = () => { const d = slides.active; return d ? go(d.count - 1) : false; };
  const goto1 = n => { const d = slides.active; return d && Number.isFinite(n) ? go(n - 1) : false; };

  function toPreview() {
    const d = slides.active;
    if (!d || d.status !== 'ready') { log('Slides: abra uma apresentação primeiro.'); document.querySelector('.slides-panel')?.closest('.dock-panel')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return false; }
    select('prv', SLIDES_SOURCE); return true;
  }

  /* ---------- desenho no monitor e na saída ---------- */
  function fitDraw(ctx, img, w, h, alpha) {
    const s = settings.fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
    ctx.globalAlpha = alpha; ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); ctx.globalAlpha = 1;
  }
  function drawSlides(ctx, w, h, clean) {
    ctx.fillStyle = settings.bg === 'white' ? '#fff' : '#000'; ctx.fillRect(0, 0, w, h);
    const d = slides.active;
    if (!d || !d.shown) {
      if (clean) return;
      ctx.fillStyle = 'rgba(230, 232, 242, .55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(h * .07) + "px 'Exo 2', 'Segoe UI', sans-serif"; ctx.fillText('SLIDES', w / 2, h / 2 - h * .05);
      ctx.font = '500 ' + Math.round(h * .04) + "px 'Montserrat', 'Segoe UI', sans-serif"; ctx.fillText(d?.status === 'loading' ? 'Abrindo a apresentação…' : d?.status === 'error' ? 'Não foi possível abrir' : 'Nenhuma apresentação carregada', w / 2, h / 2 + h * .05);
      return;
    }
    const t = settings.transition === 'fade' && d.prev ? Math.min(1, (performance.now() - d.fadeAt) / 380) : 1;
    if (t < 1) { fitDraw(ctx, d.prev, w, h, 1); fitDraw(ctx, d.shown, w, h, t); } else { d.prev = null; fitDraw(ctx, d.shown, w, h, 1); }
  }

  /* ---------- abrir arquivos ---------- */
  function finish(d, reader, note = '') {
    d.reader = reader; d.count = reader.count; d.note = note; d.status = d.count ? 'ready' : 'error'; if (!d.count) d.error = 'A apresentação não tem páginas.';
    if (!d.count) { paintPanel(); return; }
    d.thumbs = new Array(d.count).fill(null); paintPanel(); go(0, d); buildThumbs(d);
  }
  function fail(d, err) {
    d.status = 'error'; d.error = err?.message || String(err); if (err?.name === 'PasswordException') d.error = 'Este PDF tem senha. Remova a senha e abra de novo.';
    log('Slides: ' + d.name + ' — ' + d.error); audit('warn', 'slides-erro', d.name + ': ' + d.error); paintPanel();
  }
  async function openOne(file, kind) {
    const d = newDeck(file.name, kind); slides.decks.push(d); if (!slides.active || slides.active.status !== 'ready') slides.active = d; msg('Abrindo ' + file.name + '…'); paintPanel();
    try {
      if (kind === 'pdf') finish(d, await openPdf(new Uint8Array(await file.arrayBuffer())));
      else if (kind === 'pptx' || kind === 'office') {
        const st = await engineStatus();
        if (st.ready) {
          msg('Convertendo ' + file.name + ' (' + (st.powerpoint && kind === 'pptx' ? 'PowerPoint' : 'LibreOffice') + ')…');
          try { finish(d, await openPdf(await convertToPdf(file))); }
          catch (e) {
            if (kind !== 'pptx') throw e;
            finish(d, await pptxReader(await file.arrayBuffer()), 'A conversão falhou (' + e.message + '); aberto no leitor simplificado.');
          }
        } else if (kind === 'pptx') finish(d, await pptxReader(await file.arrayBuffer()), 'Leitor simplificado: sem PowerPoint ou LibreOffice neste computador, efeitos, fontes e animações podem sair diferentes. Para fidelidade total instale o LibreOffice (gratuito) ou exporte em PDF.');
        else throw new Error('Para abrir este formato instale o Microsoft PowerPoint ou o LibreOffice (gratuito), ou exporte a apresentação em PDF.');
      } else finish(d, imageReader([file]));
      log('Slides: ' + d.name + ' aberto (' + d.count + (d.count === 1 ? ' slide' : ' slides') + ').'); audit('info', 'slides-aberto', d.name + ' · ' + d.count + ' slide(s)');
      msg('');
    } catch (e) { fail(d, e); msg('Não foi possível abrir ' + file.name + ': ' + d.error); }
    if (slides.active?.status === 'error' && d.status === 'ready') slides.active = d;
    paintPanel();
  }
  async function openImages(files) {
    files = [...files].sort(natural); const d = newDeck(files.length === 1 ? files[0].name : files.length + ' imagens', 'image'); slides.decks.push(d);
    if (!slides.active || slides.active.status !== 'ready') slides.active = d;
    try { finish(d, imageReader(files)); log('Slides: ' + d.name + ' aberto.'); audit('info', 'slides-aberto', d.name); } catch (e) { fail(d, e); }
    paintPanel();
  }
  async function openFiles(list) {
    const files = [...list || []]; if (!files.length) return;
    const images = [], docs = [];
    for (const f of files) { const kind = await sniff(f); (kind === 'image' ? images : docs).push([f, kind]); }
    if (images.length) await openImages(images.map(x => x[0]));
    for (const [f, kind] of docs) await openOne(f, kind);
    const ready = slides.decks.filter(d => d.status === 'ready'); if (ready.length && slides.active?.status !== 'ready') slides.active = ready[ready.length - 1];
    paintPanel();
  }
  function closeDeck(d) {
    const at = slides.decks.indexOf(d); if (at < 0) return; slides.decks.splice(at, 1); d.token++;
    for (const v of d.cache.values()) v.close?.(); d.cache.clear(); d.reader?.destroy();
    if (slides.active === d) slides.active = slides.decks.find(x => x.status === 'ready') || slides.decks[0] || null;
    log('Slides: ' + d.name + ' fechado.'); paintPanel();
  }
  function setActive(d) { if (!slides.decks.includes(d) || slides.active === d) return; slides.active = d; d.changedAt = performance.now(); paintPanel(); }

  /* ---------- painel ---------- */
  const panel = rundownEl('section', 'slides-panel'); panel.setAttribute('aria-label', 'Slides · apresentações');
  panel.innerHTML =
    '<div class="sl-top"><div class="sl-now"><span class="sl-state" id="slState">SLIDES PARADO</span><strong id="slTitle">Nenhuma apresentação</strong></div><output class="sl-count" id="slCount" aria-live="off">– / –</output></div>' +
    '<div class="sl-stage"><figure class="sl-fig sl-cur"><canvas id="slCur" width="320" height="180" aria-label="Slide atual"></canvas><figcaption>AGORA</figcaption></figure>' +
    '<figure class="sl-fig sl-nxt"><canvas id="slNext" width="320" height="180" aria-label="Próximo slide"></canvas><figcaption>PRÓXIMO</figcaption></figure>' +
    '<div class="sl-controls"><div class="sl-pager"><button type="button" id="slPrev" class="sl-prev" title="Slide anterior (PageUp)">◀ ANTERIOR</button><button type="button" id="slAdv" class="sl-adv" title="Próximo slide (PageDown)">PRÓXIMO ▶</button></div>' +
    '<button type="button" id="slFire" class="sl-fire">SLIDES → PREVIEW</button>' +
    '<label class="sl-goto">Ir para o slide <input id="slGo" type="number" min="1" step="1" inputmode="numeric" aria-label="Número do slide"><button type="button" id="slGoBtn">Ir</button></label></div></div>' +
    '<div class="sl-decks"><div class="sl-chips" id="slDecks" role="list" aria-label="Apresentações abertas"></div><label class="sl-add">+ Abrir apresentação<input id="slFiles" type="file" multiple accept="' + ACCEPT + '"></label></div>' +
    '<p class="sl-msg" id="slMsg" role="status"></p>' +
    '<ol class="sl-thumbs" id="slThumbs" aria-label="Slides da apresentação"></ol>' +
    '<div class="sl-options"><label>Troca de slide<select id="slTransition"><option value="cut">Corte seco</option><option value="fade">Fusão suave</option></select></label>' +
    '<label>Ajuste na tela<select id="slFit"><option value="contain">Inteiro (sem cortar)</option><option value="cover">Preencher (corta as bordas)</option></select></label>' +
    '<label>Fundo<select id="slBg"><option value="black">Preto</option><option value="white">Branco</option></select></label>' +
    '<label>Avançar sozinho<select id="slAuto"><option value="0">Desligado</option><option value="5">a cada 5 s</option><option value="10">a cada 10 s</option><option value="15">a cada 15 s</option><option value="30">a cada 30 s</option><option value="60">a cada 60 s</option></select></label>' +
    '<label class="sl-loop"><input id="slLoop" type="checkbox"> Repetir ao chegar no fim</label></div>' +
    '<p class="sl-note">Arraste a apresentação para cá ou use <b>Abrir apresentação</b>. Aceita <b>PDF</b>, <b>PowerPoint</b> (PPTX, PPT, PPS), <b>OpenDocument</b> (ODP), <b>Keynote</b> (KEY), imagens (PNG, JPG, WEBP, GIF, SVG…), Word e Excel. Clique em <b>SLIDES → PREVIEW</b> (ou no comando SLIDES) e leve ao AR com CUT ou AUTO. Depois passe os slides com <b>PageDown / PageUp</b> (os controles de apresentação e canetas passam por aqui), pelos botões, pelos comandos ou pelo celular. As animações do PowerPoint não são reproduzidas: cada slide aparece pronto.</p>';
  operation.append(panel); window.slidesPanel = panel;
  const $p = s => panel.querySelector(s), msgEl = $p('#slMsg');
  function msg(text) { msgEl.textContent = text; }

  const curCanvas = $p('#slCur'), nextCanvas = $p('#slNext');
  function paintThumbCanvas(canvas, img, bg = '#000') {
    const ctx = canvas.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return; const s = Math.min(canvas.width / img.width, canvas.height / img.height); ctx.drawImage(img, (canvas.width - img.width * s) / 2, (canvas.height - img.height * s) / 2, img.width * s, img.height * s);
  }
  async function buildThumbs(d) {
    for (let i = 0; i < d.count; i++) {
      if (!slides.decks.includes(d) || d.reader == null) return;
      try { const dr = await d.reader.render(i, THUMB[0] * 2, THUMB[1] * 2); d.thumbs[i] = dr; } catch { d.thumbs[i] = null; }
      if (slides.active === d) paintThumb(i);
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
  }
  function paintThumb(i) {
    const d = slides.active, li = $p('#slThumbs').children[i]; if (!d || !li) return;
    const c = li.querySelector('canvas'); if (c && d.thumbs[i]) { paintThumbCanvas(c, d.thumbs[i], '#101528'); li.dataset.ready = 'true'; }
  }
  let builtFor = null;
  function paintThumbs() {
    const d = slides.active, list = $p('#slThumbs');
    if (builtFor !== d || (d && list.children.length !== (d.status === 'ready' ? d.count : 0))) {
      builtFor = d; list.replaceChildren();
      if (d?.status === 'ready') for (let i = 0; i < d.count; i++) {
        const li = rundownEl('li', 'sl-thumb'), b = rundownEl('button'); b.type = 'button'; b.setAttribute('aria-label', 'Slide ' + (i + 1)); b.title = 'Slide ' + (i + 1) + ' — clique para mostrar';
        const c = rundownEl('canvas'); c.width = THUMB[0]; c.height = THUMB[1]; const n = rundownEl('span', 'sl-n', String(i + 1)); b.append(c, n); li.append(b); list.append(li); b.onclick = () => go(i, d);
        if (d.thumbs[i]) paintThumb(i);
      }
    }
    for (const [i, li] of [...list.children].entries()) { const on = !!d && i === d.want; if (li.classList.contains('on') !== on) { li.classList.toggle('on', on); if (on) li.scrollIntoView({ block: 'nearest', inline: 'center' }); } }
  }
  function paintDecks() {
    const box = $p('#slDecks'); box.replaceChildren();
    for (const d of slides.decks) {
      const chip = rundownEl('span', 'sl-chip'); chip.setAttribute('role', 'listitem'); chip.dataset.on = String(d === slides.active); chip.dataset.status = d.status;
      const b = rundownEl('button', '', d.name + (d.status === 'ready' ? ' · ' + d.count : d.status === 'loading' ? ' · abrindo…' : ' · erro')); b.type = 'button'; b.title = d.error || d.note || d.name; b.onclick = () => setActive(d);
      const x = rundownEl('button', 'sl-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar ' + d.name); x.onclick = () => closeDeck(d); chip.append(b, x); box.append(chip);
    }
  }
  function paintPanel() {
    const d = slides.active, ok = d?.status === 'ready', air = state.pgm === SLIDES_SOURCE, prv = state.prv === SLIDES_SOURCE;
    panel.dataset.state = !ok ? 'idle' : air ? 'air' : prv ? 'prv' : 'ready';
    $p('#slState').textContent = !d ? 'SLIDES PARADO' : d.status === 'loading' ? 'ABRINDO…' : d.status === 'error' ? 'ERRO' : air ? 'SLIDES NO AR' : prv ? 'SLIDES NO PREVIEW' : 'SLIDES PRONTO';
    $p('#slTitle').textContent = !d ? 'Nenhuma apresentação' : d.status === 'error' ? d.name + ' — ' + d.error : d.name;
    $p('#slCount').textContent = ok ? (d.want + 1) + ' / ' + d.count : '– / –';
    for (const id of ['#slPrev', '#slAdv', '#slGoBtn', '#slGo']) $p(id).disabled = !ok;
    $p('#slPrev').disabled = !ok || (d.want <= 0); $p('#slAdv').disabled = !ok || (d.want >= d.count - 1 && !settings.loop); $p('#slFire').disabled = !ok;
    $p('#slGo').max = ok ? String(d.count) : '';
    if (d?.note && !msgEl.textContent) msgEl.textContent = d.note;
    paintDecks(); paintThumbs();
    paintThumbCanvas(curCanvas, ok ? d.cache.get(d.want) || d.shown : null); paintThumbCanvas(nextCanvas, ok && d.want < d.count - 1 ? d.cache.get(d.want + 1) || null : null, '#0a0d1a');
    if (ok && d.want < d.count - 1 && !d.cache.has(d.want + 1)) pageCanvas(d, d.want + 1).then(() => paintPanel(), () => {});
    $p('.sl-nxt').dataset.end = String(!!ok && d.want >= d.count - 1);
  }

  /* ---------- ligações do painel ---------- */
  $p('#slFiles').onchange = e => { openFiles(e.target.files); e.target.value = ''; };
  $p('#slPrev').onclick = () => prev(); $p('#slAdv').onclick = () => next(); $p('#slFire').onclick = () => toPreview();
  const doGo = () => { const n = Number($p('#slGo').value); if (goto1(n)) $p('#slGo').value = ''; };
  $p('#slGoBtn').onclick = doGo; $p('#slGo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); doGo(); } });
  panel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); panel.classList.add('dropping'); } });
  panel.addEventListener('dragleave', () => panel.classList.remove('dropping'));
  panel.addEventListener('drop', e => { e.preventDefault(); panel.classList.remove('dropping'); openFiles(e.dataTransfer?.files); });
  for (const [id, key] of [['#slTransition', 'transition'], ['#slFit', 'fit'], ['#slBg', 'bg']]) { $p(id).value = settings[key]; $p(id).onchange = e => { settings[key] = e.target.value; saveSettings(); }; }
  $p('#slAuto').value = String(settings.auto); $p('#slAuto').onchange = e => { settings.auto = Number(e.target.value) || 0; saveSettings(); const d = slides.active; if (d) d.changedAt = performance.now(); };
  $p('#slLoop').checked = !!settings.loop; $p('#slLoop').onchange = e => { settings.loop = e.target.checked; saveSettings(); paintPanel(); };

  // Avanço automático (só com os slides no AR) e o estado do painel acompanhando PREVIEW/AR.
  setInterval(() => {
    const d = slides.active;
    if (settings.auto > 0 && d?.status === 'ready' && state.pgm === SLIDES_SOURCE && performance.now() - d.changedAt >= settings.auto * 1000) { if (d.want >= d.count - 1 && !settings.loop) d.changedAt = performance.now(); else next(); }
    const air = state.pgm === SLIDES_SOURCE, prv = state.prv === SLIDES_SOURCE, key = (air ? 'a' : '') + (prv ? 'p' : ''); if (panel.dataset.last !== key) { panel.dataset.last = key; paintPanel(); }
  }, 500);

  const info = () => { const d = slides.active, ok = d?.status === 'ready'; return { loaded: !!ok, name: d?.name || '', index: ok ? d.want : 0, total: ok ? d.count : 0, air: state.pgm === SLIDES_SOURCE, prv: state.prv === SLIDES_SOURCE, status: d?.status || 'idle' }; };
  sources[SLIDES_SOURCE] = 'SLIDES';
  const api = { openFiles, next, prev, first, last, go: goto1, goto: goto1, toPreview, info, drawSlides, settings, decks: slides.decks, state: slides, sniff, closeDeck, paint: paintPanel };
  Object.assign(R, { SLIDES_SOURCE, slides: api, drawSlides });
  window.andromedaSlides = api;
  paintPanel();
})();
