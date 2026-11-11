'use strict';
/*
 * Andromeda Live — palco.
 * - Cada canal mostra só sinal real (Andromeda Cam, Blackmagic, webcam ou arquivo);
 *   canal vazio aparece como "SEM SINAL", nunca como foto de demonstração.
 * - Fontes 16:9 e 9:16 são enquadradas sem distorção.
 * - MOSAICO: fonte virtual que distribui as câmeras marcadas no quadro.
 * - O operador escolhe quantos monitores de câmera ficam na tela (sempre de 1 a N).
 */
(() => {
  const MOSAIC = 11, RATIO = 16 / 9;
  const store = {
    get(name, fallback) { try { const v = localStorage.getItem('andromeda.stage.' + name); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(name, value) { try { localStorage.setItem('andromeda.stage.' + name, JSON.stringify(value)); } catch { /* sem armazenamento */ } },
  };
  const clampMonitors = n => Math.max(1, Math.min(10, Math.round(Number(n)) || 10));
  const stage = window.andromedaStage = { monitors: clampMonitors(store.get('monitors', 10)), members: [], fit: store.get('fit', {}), names: store.get('names', true) };
  const hub = () => typeof camDesk === 'undefined' ? null : camDesk; // câmeras por convite (cam-desk.js)
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };

  /* ---------- sinal ---------- */

  const dims = el => el ? [el.videoWidth || el.naturalWidth || 0, el.videoHeight || el.naturalHeight || 0] : [0, 0];
  const live = i => i >= 0 && i < 10 && cams[i].conn && dims(media[i].element)[0] > 0;
  const kind = i => { const m = media[i]; return m.andromeda ? 'ANDROMEDA CAM' : m.remote ? 'BLACKMAGIC' : m.webcam ? 'WEBCAM' : m.demo ? 'IMAGEM DE TESTE' : 'ARQUIVO LOCAL'; };
  stage.live = live;

  function slate(ctx, x, y, w, h, title, text, clean) {
    const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#0b0f2a'); g.addColorStop(1, '#05060f');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (clean) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(230,232,242,.5)'; ctx.font = '700 ' + Math.max(10, Math.round(h * .085)) + 'px "Exo 2", sans-serif'; ctx.fillText(text, x + w / 2, y + h * .46);
    ctx.fillStyle = 'rgba(230,232,242,.28)'; ctx.font = '600 ' + Math.max(8, Math.round(h * .05)) + 'px Montserrat, sans-serif'; ctx.fillText(title, x + w / 2, y + h * .6);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // Fundo de fontes verticais: a própria imagem, reduzida a 64 px e ampliada (desfoque barato).
  const blur = document.createElement('canvas'); blur.width = 64; blur.height = 36; const blurCtx = blur.getContext('2d');
  function drawFit(ctx, el, x, y, w, h, mode) {
    const [ew, eh] = dims(el), sourceRatio = ew / eh, boxRatio = w / h;
    const fit = mode === 'cover' || mode === 'contain' ? mode : Math.abs(sourceRatio / boxRatio - 1) < .14 ? 'cover' : 'contain';
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (fit === 'contain') {
      const s = Math.max(blur.width / ew, blur.height / eh);
      blurCtx.drawImage(el, (blur.width - ew * s) / 2, (blur.height - eh * s) / 2, ew * s, eh * s);
      ctx.drawImage(blur, x, y, w, h); ctx.fillStyle = 'rgba(5,6,15,.58)'; ctx.fillRect(x, y, w, h);
    }
    const scale = fit === 'cover' ? Math.max(w / ew, h / eh) : Math.min(w / ew, h / eh), dw = ew * scale, dh = eh * scale;
    ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  /* ---------- mosaico ---------- */

  const aspect = i => { if (!live(i)) return RATIO; const [ew, eh] = dims(media[i].element); return Math.max(.4, Math.min(2.4, ew / eh)); };

  // Linhas justificadas: em cada linha as células têm a mesma altura e largura proporcional
  // ao formato da fonte, então 16:9 e 9:16 convivem sem corte. Entre todas as divisões
  // em linhas, vence a que deixa a menor célula maior; no empate, a de maior área total.
  function arrange(members, W, H) {
    const n = members.length; if (!n) return [];
    const pad = H * .035, gap = H * .018, innerW = W - pad * 2, innerH = H - pad * 2, ratios = members.map(aspect);
    let best = null;
    for (let mask = 0; mask < 1 << (n - 1); mask++) {
      const rows = [[]]; for (let i = 0; i < n; i++) { rows.at(-1).push(i); if (mask >> i & 1) rows.push([]); }
      let heights = rows.map(row => (innerW - gap * (row.length - 1)) / row.reduce((sum, i) => sum + ratios[i], 0));
      const total = heights.reduce((a, b) => a + b, 0), room = innerH - gap * (rows.length - 1);
      if (room <= 0) continue;
      if (total > room) heights = heights.map(h => h * room / total);
      let min = Infinity, area = 0; rows.forEach((row, r) => row.forEach(i => { const a = ratios[i] * heights[r] * heights[r]; min = Math.min(min, a); area += a; }));
      const better = !best || min > best.min * 1.01 || (min > best.min * .99 && (area > best.area * 1.01 || (area > best.area * .99 && rows.length < best.rows.length)));
      if (better) best = { min, area, rows, heights };
    }
    const blockH = best.heights.reduce((a, b) => a + b, 0) + gap * (best.rows.length - 1), rects = []; let y = pad + (innerH - blockH) / 2;
    best.rows.forEach((row, r) => {
      const h = best.heights[r], rowW = row.reduce((sum, i) => sum + ratios[i] * h, 0) + gap * (row.length - 1); let x = pad + (innerW - rowW) / 2;
      for (const i of row) { rects.push({ slot: members[i], x, y, w: ratios[i] * h, h }); x += ratios[i] * h + gap; }
      y += h + gap;
    });
    return rects;
  }
  stage.arrange = arrange;

  // Cada célula desliza até o lugar novo quando a formação muda (posições em fração do quadro).
  const shown = new Map(); let lastPaint = 0;
  function drawMosaic(ctx, W, H, t, clean) {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b0f2a'); g.addColorStop(.55, '#120a33'); g.addColorStop(1, '#05060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const members = stage.members.filter(i => i < stage.monitors);
    if (!members.length) { slate(ctx, 0, 0, W, H, 'Marque câmeras com o botão M', 'MOSAICO VAZIO', clean); return; }
    const ease = 1 - Math.exp(-Math.min(100, Math.max(0, t - lastPaint)) / 90);
    for (const key of [...shown.keys()]) if (!members.includes(key)) shown.delete(key);
    for (const target of arrange(members, 1, 1 / RATIO)) {
      let cell = shown.get(target.slot);
      if (!cell) { cell = { x: target.x + target.w * .2, y: target.y + target.h * .2, w: target.w * .6, h: target.h * .6, alpha: 0 }; shown.set(target.slot, cell); }
      for (const k of ['x', 'y', 'w', 'h']) cell[k] += (target[k] - cell[k]) * ease;
      cell.alpha += (1 - cell.alpha) * ease;
      const x = cell.x * W, y = cell.y * W, w = cell.w * W, h = cell.h * W, radius = H * .018, i = target.slot;
      ctx.save(); ctx.globalAlpha = cell.alpha;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.roundRect?.(x + H * .004, y + H * .008, w, h, radius); ctx.fill();
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h); ctx.clip();
      if (live(i)) drawFit(ctx, media[i].element, x, y, w, h, 'cover'); else slate(ctx, x, y, w, h, sources[i], 'SEM SINAL', clean);
      if (stage.names && live(i)) {
        const size = Math.max(11, Math.round(H * .026)), text = String(sources[i]).slice(0, 28);
        ctx.font = '600 ' + size + 'px Montserrat, sans-serif'; const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(5,6,15,.72)'; ctx.beginPath(); ctx.roundRect?.(x + size * .6, y + h - size * 2.2, tw + size * 1.2, size * 1.7, size * .45); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + size * 1.2, y + h - size * 1.33); ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
      ctx.save(); ctx.globalAlpha = cell.alpha; ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = Math.max(1, H * .0022);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h); ctx.stroke(); ctx.restore();
    }
    lastPaint = t;
  }

  /* ---------- fonte desenhada em cada monitor ---------- */

  source = function (ctx, i, t, clean = false) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (i === MOSAIC) { drawMosaic(ctx, w, h, t, clean); return; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (i === 10 || !cams[i]) return;
    if (!live(i)) { slate(ctx, 0, 0, w, h, sources[i], cams[i].conn ? 'SEM SINAL' : 'DESLIGADA', clean); return; }
    drawFit(ctx, media[i].element, 0, 0, w, h, stage.fit[i]);
  };

  /* ---------- seleção, áudio e tally ---------- */

  sources[MOSAIC] = 'MOSAICO';
  const baseSelect = select;
  select = function (bus, i) {
    if (i !== MOSAIC) { baseSelect(bus, i); return; }
    if (state.busy || state.progress > 0) return;
    if (!stage.members.length) { log('Mosaico vazio: marque câmeras com o botão M'); return; }
    state[bus] = MOSAIC; sync(); log('MOSAICO selecionado em ' + bus.toUpperCase());
  };
  const onAir = (bus, i) => bus === i || (bus === MOSAIC && stage.members.includes(i));
  // AFV: no mosaico, todas as câmeras que o compõem acompanham o AR.
  audioWeight = function (mode, i) {
    if (mode === 'off' || !cams[i]?.conn) return 0;
    if (mode === 'on') return 1;
    return Math.min(1, (onAir(state.pgm, i) ? 1 - state.progress : 0) + (onAir(state.prv, i) ? state.progress : 0));
  };
  window.andromedaProgramSlots = () => state.pgm === MOSAIC ? stage.members.filter(live) : [];

  function toggleMember(i) {
    const at = stage.members.indexOf(i);
    if (at >= 0) stage.members.splice(at, 1); else stage.members.push(i);
    if (!stage.members.length) for (const bus of ['pgm', 'prv']) if (state[bus] === MOSAIC && !state.busy) { state[bus] = 10; log('Mosaico vazio: ' + bus.toUpperCase() + ' foi para preto'); }
    sync();
  }

  /* ---------- controles no painel de câmeras ---------- */

  const header = $('.left-col .section-header'), grid = $('#mvGrid'), tools = make('div', 'stage-tools');
  const count = make('select'); count.id = 'monitorCount'; count.setAttribute('aria-label', 'Quantidade de monitores de câmera');
  for (let n = 1; n <= 10; n++) count.add(new Option(n + (n === 1 ? ' monitor' : ' monitores'), n));
  const all = make('button', '', 'Mosaico: todas com sinal'), none = make('button', '', 'Limpar mosaico');
  const names = make('label', 'stage-check'), namesBox = make('input'); namesBox.type = 'checkbox'; namesBox.checked = stage.names; names.append(namesBox, 'Nomes no mosaico');
  all.type = none.type = 'button'; all.id = 'mosaicAll'; none.id = 'mosaicNone';
  tools.append(count, all, none, names); header?.append(tools);
  all.onclick = () => { stage.members = [...Array(stage.monitors).keys()].filter(live); if (!stage.members.length) log('Nenhuma câmera com sinal para o mosaico'); sync(); };
  none.onclick = () => { for (const i of [...stage.members]) toggleMember(i); };
  namesBox.onchange = () => { stage.names = namesBox.checked; store.set('names', stage.names); };

  $$('.mv-cell').forEach((cell, i) => {
    const m = make('button', 'mos-toggle', 'M'); m.type = 'button';
    m.onclick = e => { e.stopPropagation(); toggleMember(i); }; m.onkeydown = e => e.stopPropagation();
    cell.append(m);
  });
  for (const [n, row] of $$('.bus-src').entries()) { const b = make('button', 'src-btn mos-key', 'MOSAICO'); b.onclick = () => select(n ? 'pgm' : 'prv', MOSAIC); row.append(b); }
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    select('prv', MOSAIC);
  });

  function setMonitors(n, announce = true) {
    n = clampMonitors(n);
    const busy = Math.max(...[state.pgm, state.prv].filter(i => i < 10), -1);
    if (n <= busy) { n = busy + 1; if (announce) log(sources[busy] + ' está em uso: troque o PGM/Preview antes de reduzir os monitores'); }
    stage.monitors = n; store.set('monitors', n); count.value = n;
    if (config) config.limit = n;
    stage.members = stage.members.filter(i => i < n);
    sync();
  }
  count.onchange = () => setMonitors(count.value);
  stage.setMonitors = setMonitors;

  // O perfil das configurações gerais também define a quantidade; vale a escolha mais recente.
  let profileLimit = null;
  const baseApply = window.simAPI.apply;
  window.simAPI.apply = (profile, initial = false) => {
    if (!initial && profileLimit !== null && profile.limit !== profileLimit) stage.monitors = clampMonitors(profile.limit);
    profileLimit = profile.limit; profile.limit = stage.monitors;
    const held = ['pgm', 'prv'].filter(bus => state[bus] === MOSAIC);
    baseApply(profile, initial);
    for (const bus of held) state[bus] = MOSAIC;
    count.value = stage.monitors; store.set('monitors', stage.monitors); sync();
  };

  /* ---------- sincronização visual ---------- */

  const info = make('div', 'preview-strip'), infoText = make('span'), infoState = make('b'); info.append(infoText, infoState);
  $('#monPreview')?.closest('.dock-panel')?.append(info);
  const baseSync = sync;
  sync = function () {
    baseSync();
    const n = stage.monitors;
    $$('.mv-cell').forEach((cell, i) => {
      cell.hidden = i >= n; cell.classList.toggle('no-signal', !live(i));
      const order = stage.members.indexOf(i), m = cell.querySelector('.mos-toggle');
      cell.classList.toggle('in-mosaic', order >= 0);
      m.textContent = order >= 0 ? 'M' + (order + 1) : 'M'; m.setAttribute('aria-pressed', String(order >= 0));
      m.setAttribute('aria-label', (order >= 0 ? 'Tirar ' : 'Incluir ') + sources[i] + (order >= 0 ? ' do mosaico' : ' no mosaico'));
      if (onAir(state.pgm, i) && state.pgm === MOSAIC) cell.classList.add('pgm');
    });
    $$('.bus-src').forEach((row, r) => [...row.children].forEach((b, i) => {
      if (i < 10) b.hidden = i >= n;
      if (i === MOSAIC) { b.hidden = false; b.textContent = 'MOSAICO' + (stage.members.length ? ' · ' + stage.members.length : ''); b.disabled = state.busy || state.progress > 0 || !stage.members.length; }
    }));
    $$('.source-strip').forEach((row, i) => { row.hidden = i >= n; });
    $$('.media-row').forEach((row, i) => { row.hidden = i >= n; });
    const cols = n <= 5 ? n : Math.ceil(n / 2);
    grid?.style.setProperty('--mv-cols', cols); grid?.style.setProperty('--mv-tile', (cols >= 5 ? 15 : cols === 4 ? 18 : cols === 3 ? 22 : 27) + 'vh');
    const online = [...Array(n).keys()].filter(live).length, stat = $$('.tb-stat')[2];
    if (stat) { stat.querySelector('.tb-val').textContent = online + ' / ' + n; stat.querySelector('.tb-dot').style.opacity = online ? 1 : .25; }
    const title = $('.left-col .sh-title'); if (title) title.textContent = online + ' de ' + n + ' com sinal';
    paintInfo();
  };
  function paintInfo() {
    const i = state.prv;
    const ok = i === MOSAIC || i === 10 || live(i);
    if (i === MOSAIC) infoText.textContent = 'MOSAICO · ' + stage.members.length + ' câmera(s)';
    else if (i === 10) infoText.textContent = 'PRETO';
    else if (!live(i)) infoText.textContent = 'Aguardando fonte neste canal';
    else { const [w, h] = dims(media[i].element); infoText.textContent = kind(i) + ' · ' + w + '×' + h + (h > w ? ' · VERTICAL' : ''); }
    infoState.textContent = ok ? 'VÍDEO OK' : 'SEM SINAL'; info.dataset.ok = String(ok);
  }

  /* ---------- fontes de câmera: sem demonstração por padrão ---------- */

  const dialogText = $('#mediaDialog .media-header p');
  if (dialogText) dialogText.textContent = 'Cada canal recebe uma fonte real: Andromeda Cam (convite), Blackmagic (RTMP), webcam ou arquivo de foto/vídeo.';
  const note = $('#mediaDialog .media-note');
  if (note) note.textContent = 'Vídeos locais tocam em loop. O áudio de cada fonte é controlado no mixer. O enquadramento automático preserva fontes verticais (9:16) sem cortar.';
  $$('.media-row').forEach((row, i) => {
    mediaStatus(i, 'Sem sinal');
    const remove = row.querySelector('.demo'); remove.textContent = 'Remover fonte';
    remove.addEventListener('click', () => mediaStatus(i, 'Sem sinal'));
    const test = make('button', 'test-image', 'Imagem de teste'); test.type = 'button';
    test.onclick = () => {
      if (hub()?.cameras.has(i)) { camAPI('revoke', { slot: i }).catch(() => {}); dropCamera(i); }
      if (typeof bmUnbind === 'function') bmUnbind(i);
      disposeMedia(i); media[i] = { element: demoImages[photoMap[i]], url: null, webcam: false, demo: true }; cams[i].conn = true;
      mediaStatus(i, 'Imagem de teste (não é câmera)'); sync(); log(sources[i] + ' com imagem de teste');
    };
    const fit = make('select', 'fit-mode'); fit.setAttribute('aria-label', 'Enquadramento de ' + cams[i].id);
    for (const [value, text] of [['auto', 'Enquadrar: automático'], ['cover', 'Preencher (corta bordas)'], ['contain', 'Imagem inteira']]) fit.add(new Option(text, value));
    fit.value = stage.fit[i] || 'auto';
    fit.onchange = () => { stage.fit[i] = fit.value; store.set('fit', stage.fit); };
    remove.after(test, fit);
  });
  $$('.sim-footer span').filter(el => /demonstração|Unsplash/.test(el.textContent)).forEach(el => el.remove());
  const shortcuts = $$('.sim-footer span').find(el => /Atalhos/.test(el.textContent));
  if (shortcuts) shortcuts.textContent = 'Atalhos: 1–9 preview · − câmera 10 · 0 preto · M mosaico · Espaço CUT · Enter AUTO';

  /* ---------- convites seguem a ordem dos canais ---------- */

  const slot = $('#camSlot'), name = $('#camName');
  function suggestSlot() {
    if (!slot || !hub()) return;
    const free = [...Array(stage.monitors).keys()].find(i => !hub().cameras.has(i) && !media[i].element);
    if (free === undefined) return;
    slot.value = free; if (/^CAM \d+/.test(name.value) || !name.value) name.value = 'CAM ' + (free + 1);
  }
  let watched = null;
  setInterval(() => {
    paintInfo();
    $$('.mv-cell').forEach((cell, i) => cell.classList.toggle('no-signal', !live(i)));
    if (!slot || !hub()) return;
    // Quando a câmera do canal selecionado conecta, o próximo convite já aponta para o canal livre seguinte.
    const current = Number(slot.value), connected = hub().cameras.has(current);
    if (connected && watched !== current) { watched = current; suggestSlot(); }
    if (!connected && watched === current) watched = null;
  }, 1000);

  setMonitors(stage.monitors, false); suggestSlot();
})();
