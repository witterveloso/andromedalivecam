'use strict';
/*
 * Operação reorganizada (0.19).
 *
 * - "Comandos" no lugar da seleção de fontes: o PREVIEW passa a ser escolhido no multiview (clique) e o painel
 *   ganha os comandos de produção: GC 1–3, LOGO, REGRESSIVA (direto no AR), PiP, VT e VINHETA (vão ao PREVIEW),
 *   BLACK (F1) e BARRAS (F2). Clique executa; duplo clique abre os ajustes do comando.
 * - "Áudio master" no lugar de "Camadas no ar": modulação L/R, fader master e FADE OUT com tempo ajustável.
 *   O monitor do AR fica só com a imagem; o áudio liga sozinho na primeira interação.
 * - Atalhos de teclado configuráveis (Personalizar), ESC volta para a Operação, duplo clique numa câmera do
 *   multiview abre "Fontes de câmera" naquele canal, informações das câmeras e do mosaico na barra "Câmeras".
 */
(() => {
  const R = window.andromedaRundown; if (!R) return;
  const { VT_SOURCE, VINHETA_SOURCE, countdown, vtPlayer, vinhetaPlayer, black, bars } = R;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };

  /* ---------- VT e vinheta como fontes (12 e 13) ---------- */
  sources[VT_SOURCE] = sources[VT_SOURCE] || 'VT'; sources[VINHETA_SOURCE] = sources[VINHETA_SOURCE] || 'VINHETA';
  const baseSource = source;
  source = function (ctx, i, t, clean = false) { if (i === VT_SOURCE || i === VINHETA_SOURCE) { R.drawPlayer(ctx, ctx.canvas.width, ctx.canvas.height, i, clean); return; } baseSource(ctx, i, t, clean); };
  const baseSelect = select;
  select = function (bus, i) {
    if (i !== VT_SOURCE && i !== VINHETA_SOURCE) { baseSelect(bus, i); return; }
    if (state.busy || state.progress > 0) return;
    state[bus] = i; sync(); log(sources[i] + ' no ' + (bus === 'prv' ? 'PREVIEW' : 'AR'));
  };

  // AUTO não pode depender do requestAnimationFrame (janela minimizada = transição parada no meio).
  const baseAuto = auto;
  auto = function () {
    if (state.busy || state.progress > 0) return;
    const real = window.requestAnimationFrame;
    window.requestAnimationFrame = f => { let done = false; const go = () => { if (!done) { done = true; f(performance.now()); } }; real.call(window, go); setTimeout(go, 34); return 0; };
    try { baseAuto(); } finally { window.requestAnimationFrame = real; }
  };

  /* ---------- painel Comandos (no lugar da seleção de fontes) ---------- */
  const busShell = bus.closest('.dock-panel') || bus.parentElement;
  bus.querySelectorAll('.bus-row').forEach(row => { row.hidden = true; });
  const grid = make('div', 'cmd-grid'); grid.setAttribute('role', 'toolbar'); grid.setAttribute('aria-label', 'Comandos de produção');
  bus.append(grid);
  bus.append(keyPanel); // monitor do KEY 1 (PiP) acompanha o comando PiP

  const gcName = n => (fx.live.layers[n]?.name || 'GC ' + (n + 1));
  const COMMANDS = [
    { id: 'gc0', name: () => 'GC · ' + gcName(0), run: () => $('#fxGC0').click(), on: () => fx.live.layers[0]?.on, settings: () => openGC(0) },
    { id: 'gc1', name: () => 'GC · ' + gcName(1), run: () => $('#fxGC1').click(), on: () => fx.live.layers[1]?.on, settings: () => openGC(1) },
    { id: 'gc2', name: () => 'GC · ' + gcName(2), run: () => $('#fxGC2').click(), on: () => fx.live.layers[2]?.on, settings: () => openGC(2) },
    { id: 'logo', name: () => 'LOGO', run: () => $('#fxLogo').click(), on: () => fx.live.logo.on, settings: () => openFx('#logoFile') },
    { id: 'countdown', name: () => 'REGRESSIVA', sub: () => R.formatClock(countdown.on ? (countdown.paused ?? Math.max(0, (countdown.endAt - performance.now()) / 1000)) : countdown.seconds), run: () => R.toggleCountdown(), on: () => countdown.on, settings: b => popCountdown(b) },
    { id: 'pip', name: () => 'PiP', run: () => $('#fxPip').click(), on: () => fx.live.pip.on, settings: () => openFx('#pipSource') },
    { id: 'vt', name: () => 'VT', sub: () => vtPlayer.running && vtPlayer.item?.duration ? '−' + R.formatClock(vtPlayer.item.duration - vtPlayer.item.el.currentTime) : R.vt.items[R.vt.cue]?.name || 'playlist vazia', run: () => R.vtToPreview(), on: () => state.pgm === VT_SOURCE, prv: () => state.prv === VT_SOURCE, settings: () => openVT() },
    { id: 'vinheta', name: () => 'VINHETA', sub: () => vinhetaPlayer.running && vinhetaPlayer.item?.duration ? '−' + R.formatClock(vinhetaPlayer.item.duration - vinhetaPlayer.item.el.currentTime) : vinhetaPlayer.item?.name || 'sem vídeo', run: () => R.vinhetaToPreview(), on: () => state.pgm === VINHETA_SOURCE, prv: () => state.prv === VINHETA_SOURCE, settings: b => popVinheta(b) },
    { id: 'black', name: () => 'BLACK', run: () => R.toggleBlack(), on: () => black.on, settings: b => popBlack(b) },
    { id: 'bars', name: () => 'BARRAS', sub: () => bars.tone ? 'com tom 1 kHz' : '', run: () => R.toggleBars(), on: () => bars.on, settings: b => popBars(b) },
  ];
  const byId = id => COMMANDS.find(c => c.id === id);
  const LAYOUT_KEY = 'andromeda.commands.v1';
  let cmdLayout = store.get(LAYOUT_KEY, null);
  if (!cmdLayout || !Array.isArray(cmdLayout.order)) cmdLayout = { order: COMMANDS.map(c => c.id), hidden: [] };
  cmdLayout.order = [...cmdLayout.order.filter(byId), ...COMMANDS.map(c => c.id).filter(id => !cmdLayout.order.includes(id))];
  cmdLayout.hidden = (cmdLayout.hidden || []).filter(byId);

  const buttons = new Map();
  function buildGrid() {
    grid.replaceChildren();
    for (const id of cmdLayout.order) {
      if (cmdLayout.hidden.includes(id)) continue;
      const c = byId(id), b = make('button', 'cmd-btn'); b.type = 'button'; b.dataset.cmd = id;
      b.append(make('span', 'cmd-name'), make('small', 'cmd-sub'), make('kbd', 'cmd-key'));
      // Clique executa (com uma folga curta para reconhecer o duplo clique); teclado (Enter/Espaço no botão) executa na hora.
      let timer = null;
      b.addEventListener('click', e => { if (e.detail === 0) { c.run(); paint(); return; } if (e.detail > 1) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; c.run(); paint(); }, 230); });
      b.addEventListener('dblclick', e => { e.preventDefault(); clearTimeout(timer); timer = null; c.settings(b); });
      grid.append(b); buttons.set(id, b);
    }
    paint();
  }
  function paint() {
    for (const [id, b] of buttons) {
      const c = byId(id), on = !!c.on(), prv = !!c.prv?.(), sub = c.sub?.() || '';
      b.querySelector('.cmd-name').textContent = c.name(); b.querySelector('.cmd-sub').textContent = sub;
      const key = keyOf(id); b.querySelector('.cmd-key').textContent = key ? prettyKey(key) : '';
      b.setAttribute('aria-pressed', String(on)); b.dataset.prv = String(prv);
      b.title = (on ? 'No AR. ' : prv ? 'No PREVIEW. ' : '') + 'Clique: ' + ({ vt: 'leva ao PREVIEW', vinheta: 'leva ao PREVIEW', countdown: 'entra/sai do AR', black: 'fade para o preto / volta', bars: 'barras no AR / retira' }[id] || 'coloca/retira do AR') + '. Duplo clique: ajustes.' + (key ? ' Atalho: ' + prettyKey(key) + '.' : '');
    }
  }
  setInterval(paint, 200);

  /* ---------- ajustes de cada comando ---------- */
  function openFx(selector) {
    populatePipSources(); openWorkspace('effects');
    const el = $(selector); if (el) { el.closest('.fx-card')?.scrollIntoView({ block: 'center' }); setTimeout(() => el.focus(), 50); }
  }
  function openGC(n) { openWorkspace('effects'); $('#fxLayer').value = String(n); loadForm(); $('#fxLayer').closest('.fx-card')?.scrollIntoView({ block: 'center' }); setTimeout(() => $('#gcTitle').focus(), 50); }
  function openVT() {
    openWorkspace('operation');
    const panel = $('.vt-panel')?.closest('.dock-panel') || $('.vt-panel');
    panel?.scrollIntoView({ block: 'center', behavior: 'smooth' }); panel?.classList.add('flash'); setTimeout(() => panel?.classList.remove('flash'), 1600);
  }
  // Janela pequena perto do botão (não modal: a mesa continua operável).
  const pop = make('div', 'cmd-pop'); pop.setAttribute('role', 'dialog'); pop.hidden = true; document.body.append(pop);
  let popFor = null;
  function openPop(button, title, ...content) {
    pop.replaceChildren(make('strong', 'cmd-pop-title', title), ...content);
    const close = make('button', 'cmd-pop-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Fechar'); close.onclick = closePop; pop.prepend(close);
    pop.setAttribute('aria-label', title); pop.hidden = false; popFor = button;
    const r = button.getBoundingClientRect(), w = Math.min(360, innerWidth - 24);
    pop.style.width = w + 'px'; pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    const below = r.bottom + 8, h = pop.offsetHeight; pop.style.top = (below + h > innerHeight - 12 ? Math.max(12, r.top - h - 8) : below) + 'px';
    pop.querySelector('input,select,button:not(.cmd-pop-close)')?.focus();
  }
  function closePop() { if (pop.hidden) return; pop.hidden = true; if (pop.contains(R.cdRow)) document.body.append(Object.assign(R.cdRow, { hidden: true })); popFor?.focus(); popFor = null; }
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== popFor) closePop(); }, true);
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } });
  document.body.append(Object.assign(R.cdRow, { hidden: true }));

  function note(text) { return make('p', 'cmd-pop-note', text); }
  function popCountdown(b) {
    R.cdRow.hidden = false;
    const more = make('button', 'cmd-pop-link', 'Texto, estilo e cores…'); more.type = 'button'; more.onclick = () => { closePop(); openFx('#cdTitle'); };
    openPop(b, 'Regressiva', R.cdRow, note('Ajuste o tempo (ex.: 5:00) antes de colocar no AR. Com ela no AR: pausar ou reiniciar.'), more);
  }
  function popVinheta(b) {
    const label = make('label', 'cmd-pop-field', 'Vídeo da vinheta'), input = make('input'); input.type = 'file'; input.accept = 'video/*'; label.append(input);
    input.onchange = () => { if (input.files[0]) R.setVinheta(input.files[0]); paint(); closePop(); };
    const end = make('label', 'cmd-pop-field', 'Ao terminar'), sel = make('select');
    for (const [v, t] of [['return', 'Voltar para a câmera'], ['hold', 'Congelar no último quadro']]) sel.add(new Option(t, v));
    sel.value = vinhetaPlayer.end; sel.onchange = () => { vinhetaPlayer.end = sel.value; }; end.append(sel);
    const how = make('label', 'cmd-pop-field', 'Volta com'), tr = make('select');
    for (const [v, t] of [['mix', 'AUTO (transição escolhida)'], ['cut', 'CUT seco']]) tr.add(new Option(t, v));
    tr.value = vinhetaPlayer.transition; tr.onchange = () => { vinhetaPlayer.transition = tr.value; }; how.append(tr);
    openPop(b, 'Vinheta', note(vinhetaPlayer.item ? 'Carregada: ' + vinhetaPlayer.item.name + (vinhetaPlayer.item.duration ? ' (' + R.formatClock(Math.round(vinhetaPlayer.item.duration)) + ')' : '') : 'Nenhum vídeo carregado.'), label, end, how,
      note('Clique em VINHETA para levá-la ao PREVIEW; ela toca quando vai ao AR (CUT/AUTO) e a mesa volta sozinha para a câmera.'));
  }
  function popBlack(b) {
    const label = make('label', 'cmd-pop-field', 'Tempo do fade (segundos)'), input = make('input'); input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '0.1'; input.value = String(black.seconds);
    input.onchange = () => { const v = Number(input.value); if (v >= 0 && v <= 10) { black.seconds = v; store.set('andromeda.black.v1', v); } }; label.append(input);
    openPop(b, 'BLACK', label, note('BLACK escurece toda a saída do AR (inclusive GC, logotipo e regressiva). Clique de novo para voltar.'));
  }
  black.seconds = Number(store.get('andromeda.black.v1', .5)) || 0;
  function popBars(b) {
    const label = make('label', 'cmd-pop-check'), input = make('input'); input.type = 'checkbox'; input.checked = bars.tone; label.append(input, ' Tom de referência 1 kHz (−18 dBFS)');
    input.onchange = () => { bars.tone = input.checked; R.syncTone(); paint(); };
    openPop(b, 'Barras de cor', label, note('BARRAS cobre a saída do AR com barras de cor (75%), para alinhar monitores e plataformas antes do programa.'));
  }

  /* ---------- Áudio master (no lugar de "Camadas no ar") ---------- */
  const layersShell = fxQuick.closest('.dock-panel');
  fxQuick.hidden = true;
  const master = make('section', 'master-panel'); master.setAttribute('aria-label', 'Áudio master');
  master.innerHTML = '<div class="master-top"><span class="master-label">MASTER</span><span id="masterAudioState" class="master-state">—</span></div>' +
    '<div class="master-meters"></div>' +
    '<label class="master-fader"><span>Volume</span><input id="masterFader" type="range" min="0" max="100" aria-label="Volume master"><output id="masterFaderOut"></output></label>' +
    '<div class="master-fade-row"><button type="button" id="masterFade" class="master-fade">FADE OUT</button><label>Tempo <input id="masterFadeTime" type="number" min="0.5" max="30" step="0.5" aria-label="Tempo do fade em segundos"> s</label></div>' +
    '<div class="master-links"></div>';
  (layersShell || fxQuick.parentElement).insertBefore(master, fxQuick);
  // A modulação L/R e o estado do áudio saem do monitor do AR e vêm para cá; o monitor fica só com a imagem.
  const channels = $('.pgm-audio-channels'); if (channels) master.querySelector('.master-meters').append(channels);
  const audioState = $('#pgmAudioState'); if (audioState) master.querySelector('#masterAudioState').replaceWith(audioState);
  const pgmMonitor = $('.pgm-audio-monitor'); if (pgmMonitor) pgmMonitor.hidden = true;
  const enableButton = $('#enableMixer'); if (enableButton) enableButton.hidden = true;

  const level = $('#masterLevel'), fader = $('#masterFader'), faderOut = $('#masterFaderOut');
  const dbOf = v => v <= 0 ? '−∞ dB' : (20 * Math.log10(v / 100)).toFixed(1).replace('-', '−').replace(/^0\.0$/, '0') + ' dB';
  const showFader = v => { fader.value = String(Math.round(v)); faderOut.textContent = dbOf(v); };
  showFader(Number(level?.value ?? 100));
  fader.addEventListener('input', () => { if (fade.running) return; if (level) { level.value = fader.value; level.dispatchEvent(new Event('input')); } faderOut.textContent = dbOf(Number(fader.value)); });
  level?.addEventListener('input', () => { if (!fade.running) showFader(Number(level.value)); });

  const fade = { out: false, before: 100, running: false, timer: null };
  const fadeTime = $('#masterFadeTime'); fadeTime.value = String(store.get('andromeda.fade.v1', 3));
  fadeTime.addEventListener('change', () => { const v = Math.min(30, Math.max(.5, Number(fadeTime.value) || 3)); fadeTime.value = String(v); store.set('andromeda.fade.v1', v); });
  async function runFade() {
    if (fade.running) return;
    const seconds = Math.min(30, Math.max(.5, Number(fadeTime.value) || 3));
    try { await audioMixer.enable(); } catch { /* sem áudio: só a barra */ }
    const from = Number(level?.value ?? 100), to = fade.out ? fade.before : 0;
    if (!fade.out) fade.before = from || 100;
    fade.running = true; const start = performance.now(), ac = audioMixer.context;
    if (ac && audioMixer.master) { const g = audioMixer.master.gain, t = ac.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to / 100, t + seconds); }
    log((fade.out ? 'FADE IN do master' : 'FADE OUT do master') + ' em ' + String(seconds).replace('.', ',') + ' s');
    fade.out = !fade.out; paintFade();
    clearInterval(fade.timer);
    fade.timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / (seconds * 1000)), v = from + (to - from) * k;
      showFader(v);
      if (k >= 1) { clearInterval(fade.timer); fade.running = false; if (level) level.value = String(Math.round(to)); paintFade(); }
    }, 50);
  }
  function paintFade() { const b = $('#masterFade'); b.textContent = fade.running ? (fade.out ? 'FADE OUT…' : 'FADE IN…') : fade.out ? 'FADE IN' : 'FADE OUT'; b.setAttribute('aria-pressed', String(fade.out)); b.dataset.state = fade.out ? 'out' : 'in'; }
  $('#masterFade').onclick = runFade; paintFade();

  // Atalho: mesa de áudio em outro aparelho (link + QR). Cada aparelho novo é aprovado aqui na mesa.
  const remoteAudio = make('button', 'master-remote', 'Mesa de áudio em outro aparelho'); remoteAudio.type = 'button';
  master.querySelector('.master-links').append(remoteAudio);
  remoteAudio.onclick = () => {
    const url = window.andromedaRemote?.mixerLink?.() || '';
    if (!url) { openPop(remoteAudio, 'Mesa de áudio remota', note('Disponível no programa Andrômeda Live instalado, com internet: ele gera o link e conecta o aparelho.')); return; }
    const qr = make('div', 'cmd-pop-qr'); qr.setAttribute('aria-hidden', 'true');
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); } catch { qr.remove(); }
    const field = make('input', 'cmd-pop-url'); field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Link da mesa de áudio');
    const copy = make('button', '', 'Copiar link'); copy.type = 'button';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Copiado'; } catch { field.select(); copy.textContent = 'Selecione e copie'; } };
    const who = (window.andromedaRemote.pendingMixer?.() || []).map(s => s.name + (s.state === 'pending' ? ' (aguardando aprovação)' : ' · conectado')).join(', ');
    openPop(remoteAudio, 'Mesa de áudio remota', qr, field, copy, note('Abra o link ou leia o QR no celular ou tablet: ele mostra volume e modo (OFF/AFV/ON) de cada fonte, master e FADE OUT, e toca o som do PGM. Na primeira vez, aprove o aparelho aqui na mesa.' + (who ? ' Agora: ' + who + '.' : '')));
  };

  // Áudio liga sozinho: na hora (programa instalado) ou na primeira interação (navegador).
  const wake = () => audioMixer.enable().then(() => { try { enableProgramMeters(); } catch { /* medidores depois */ } }).catch(() => {});
  wake();
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, wake, { once: true, capture: true });

  /* ---------- Câmeras: informações e mosaico na barra do painel ---------- */
  let camTitle = null;
  const camShell = multiview.closest('.dock-panel'), camHandle = camShell?.querySelector(':scope > .dock-handle'), camHeader = multiview.querySelector('.section-header');
  if (camHandle && camHeader) {
    // O título fica também no lugar antigo (oculto): o resto da mesa escreve nele e a barra espelha o texto.
    const tools = make('span', 'dock-tools'); tools.append(...camHeader.childNodes);
    const shadow = make('span', 'sh-title'); camHeader.append(shadow); camTitle = { shadow, shown: tools.querySelector('.sh-title') };
    for (const type of ['pointerdown', 'keydown']) tools.addEventListener(type, e => e.stopPropagation());
    camHandle.insertBefore(tools, camHandle.querySelector('.free-size')); camHeader.hidden = true;
  }

  /* ---------- multiview: duplo clique abre "Fontes de câmera" no canal ---------- */
  function openSources(i) {
    const dialog = $('#mediaDialog'); if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const row = $('#mediaRow' + i); if (!row) return;
    row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600);
    row.querySelector('select,button,input')?.focus();
  }
  $$('.mv-cell').forEach((cell, i) => cell.addEventListener('dblclick', e => { if (e.target.closest('button,select,input')) return; e.preventDefault(); openSources(i); }));

  /* ---------- atalhos de teclado (configuráveis) ---------- */
  const ACTIONS = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'prv' + i, label: 'Câmera ' + (i + 1) + ' no PREVIEW', key: i < 9 ? String(i + 1) : '-', run: () => select('prv', i) })),
    { id: 'prvBlack', label: 'Preto no PREVIEW', key: '0', run: () => select('prv', 10) },
    { id: 'mosaic', label: 'Mosaico no PREVIEW', key: 'M', run: () => select('prv', 11) },
    { id: 'cut', label: 'CUT', key: 'Space', run: () => cut() },
    { id: 'auto', label: 'AUTO', key: 'Enter', run: () => auto() },
    { id: 'black', label: 'BLACK (fade para o preto)', key: 'F1', run: () => R.toggleBlack() },
    { id: 'bars', label: 'BARRAS de cor', key: 'F2', run: () => R.toggleBars() },
    { id: 'gc0', label: 'GC 1', key: 'F3', run: () => byId('gc0').run() },
    { id: 'gc1', label: 'GC 2', key: 'F4', run: () => byId('gc1').run() },
    { id: 'gc2', label: 'GC 3', key: 'F5', run: () => byId('gc2').run() },
    { id: 'logo', label: 'LOGO', key: 'F6', run: () => byId('logo').run() },
    { id: 'countdown', label: 'REGRESSIVA (direto no AR)', key: 'F7', run: () => R.toggleCountdown() },
    { id: 'pip', label: 'PiP', key: 'F8', run: () => byId('pip').run() },
    { id: 'vt', label: 'VT no PREVIEW', key: 'F9', run: () => R.vtToPreview() },
    { id: 'vinheta', label: 'VINHETA no PREVIEW', key: 'F10', run: () => R.vinhetaToPreview() },
    { id: 'fade', label: 'FADE OUT / FADE IN do master', key: '', run: () => runFade() },
  ];
  const KEYS_KEY = 'andromeda.shortcuts.v1';
  const defaults = Object.fromEntries(ACTIONS.map(a => [a.id, a.key]));
  let keymap = { ...defaults, ...store.get(KEYS_KEY, {}) };
  const keyOf = id => keymap[id] || '';
  const comboOf = e => {
    const base = e.code === 'Space' ? 'Space' : e.key === 'Enter' ? 'Enter' : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && base.length > 1 && 'Shift', base].filter(Boolean).join('+');
  };
  const prettyKey = k => k.replace('Space', 'Espaço').replace('Enter', 'Enter').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
  const LEGACY = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'M', 'Space', 'Enter']);
  const typing = t => t.isContentEditable || !!t.closest?.('input,select,textarea');
  let capturing = null;
  addEventListener('keydown', e => {
    if (capturing) return;
    if (e.key === 'Escape') {
      // ESC volta para a Operação (fora de janelas, edição de layout e campos de texto).
      if (document.querySelector('dialog[open]') || document.body.classList.contains('layout-editing') || typing(e.target) || !pop.hidden) return;
      openWorkspace('operation'); return;
    }
    if (e.repeat || e.metaKey || document.querySelector('dialog[open]') || typing(e.target)) return;
    const combo = comboOf(e);
    const onButton = e.target.closest?.('button,[role="button"]') && !e.target.closest('.mv-cell,.src-btn,.cmd-btn');
    if (onButton && (combo === 'Space' || combo === 'Enter')) return; // Espaço/Enter acionam o botão em foco
    const action = ACTIONS.find(a => keymap[a.id] && keymap[a.id] === combo);
    if (action) { e.preventDefault(); e.stopImmediatePropagation(); action.run(); paint(); return; }
    // Teclas antigas que foram trocadas de função não disparam mais o comando antigo.
    // F11 (tela cheia) e F12 (ferramentas) continuam do sistema.
    if (LEGACY.has(combo) || /^F([1-9]|10)$/.test(combo)) { e.stopImmediatePropagation(); if (/^F([1-9]|10)$/.test(combo)) e.preventDefault(); }
  }, true);

  /* ---------- Personalizar: atalhos e botões de comando ---------- */
  const settings = $('.layout-settings');
  if (settings) {
    const box = make('section', 'shortcut-settings');
    box.innerHTML = '<h3>Atalhos do teclado</h3><p>Clique no atalho e pressione a tecla (ou combinação com Ctrl/Alt). <b>Backspace</b> limpa; <b>Esc</b> cancela. Funcionam em qualquer página, menos quando você digita num campo. <b>Esc</b> sempre volta para a Operação.</p><div class="shortcut-list" role="table" aria-label="Atalhos do teclado"></div><button type="button" id="shortcutsReset">Restaurar atalhos padrão</button>' +
      '<h3>Botões de comando</h3><p>Ordem e visibilidade dos botões do painel Comandos.</p><ol class="cmd-order" aria-label="Ordem dos botões de comando"></ol>';
    settings.append(box);
    const list = box.querySelector('.shortcut-list'), order = box.querySelector('.cmd-order');
    function paintShortcuts() {
      list.replaceChildren(...ACTIONS.map(a => {
        const row = make('div', 'shortcut-row'); row.setAttribute('role', 'row');
        const name = make('span', '', a.label); name.setAttribute('role', 'cell');
        const btn = make('button', 'shortcut-key', keymap[a.id] ? prettyKey(keymap[a.id]) : '—'); btn.type = 'button'; btn.setAttribute('role', 'cell');
        btn.setAttribute('aria-label', 'Atalho de ' + a.label + ': ' + (keymap[a.id] ? prettyKey(keymap[a.id]) : 'nenhum') + '. Clique para trocar.');
        btn.onclick = () => {
          if (capturing) return; capturing = a.id; btn.textContent = 'Pressione…'; btn.classList.add('capturing');
          const onKey = e => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            removeEventListener('keydown', onKey, true); capturing = null;
            if (e.key === 'Escape') { paintShortcuts(); return; }
            if (e.key === 'Backspace' || e.key === 'Delete') keymap[a.id] = '';
            else { const combo = comboOf(e); for (const other of ACTIONS) if (other.id !== a.id && keymap[other.id] === combo) keymap[other.id] = ''; keymap[a.id] = combo; }
            store.set(KEYS_KEY, keymap); paintShortcuts(); paint();
          };
          addEventListener('keydown', onKey, true);
        };
        row.append(name, btn); return row;
      }));
    }
    $('#shortcutsReset').onclick = () => { keymap = { ...defaults }; store.set(KEYS_KEY, keymap); paintShortcuts(); paint(); };
    function paintOrder() {
      order.replaceChildren(...cmdLayout.order.map((id, i) => {
        const li = make('li', 'cmd-order-row'), show = make('input'), name = make('span', '', byId(id).name()), up = make('button', '', '↑'), down = make('button', '', '↓');
        show.type = 'checkbox'; show.checked = !cmdLayout.hidden.includes(id); show.setAttribute('aria-label', 'Mostrar ' + byId(id).name());
        up.type = down.type = 'button'; up.disabled = i === 0; down.disabled = i === cmdLayout.order.length - 1;
        up.setAttribute('aria-label', 'Subir ' + byId(id).name()); down.setAttribute('aria-label', 'Descer ' + byId(id).name());
        const move = d => { const j = i + d; [cmdLayout.order[i], cmdLayout.order[j]] = [cmdLayout.order[j], cmdLayout.order[i]]; saveLayout(); };
        up.onclick = () => move(-1); down.onclick = () => move(1);
        show.onchange = () => { cmdLayout.hidden = show.checked ? cmdLayout.hidden.filter(x => x !== id) : [...cmdLayout.hidden, id]; saveLayout(); };
        li.append(show, name, up, down); return li;
      }));
    }
    function saveLayout() { store.set(LAYOUT_KEY, cmdLayout); buildGrid(); paintOrder(); }
    paintShortcuts(); paintOrder();
  }

  /* ---------- sincronização visual ---------- */
  const baseSync = sync;
  sync = function () {
    baseSync();
    if (camTitle?.shown && camTitle.shadow.textContent) camTitle.shown.textContent = camTitle.shadow.textContent;
    // Faixa do PREVIEW: VT/vinheta mostram o vídeo preparado em vez de "aguardando fonte".
    const strip = $('.preview-strip'), p = state.prv === VT_SOURCE ? vtPlayer : state.prv === VINHETA_SOURCE ? vinhetaPlayer : null;
    if (strip && p) {
      const ok = !!p.item && !p.item.error;
      strip.querySelector('span').textContent = p.label + ' · ' + (p.item ? p.item.name + (p.item.duration ? ' · ' + R.formatClock(Math.round(p.item.duration)) : '') : 'nenhum vídeo');
      strip.querySelector('b').textContent = ok ? 'PRONTO' : 'SEM VÍDEO'; strip.dataset.ok = String(ok);
    }
    paint();
  };

  function paintFooter() {
    const span = $$('.sim-footer span').find(el => /Atalhos/.test(el.textContent)); if (!span) return;
    const k = id => keymap[id] ? prettyKey(keymap[id]) : null;
    span.textContent = 'Atalhos: ' + [[k('prv0') && k('prv8') ? k('prv0') + '–' + k('prv8') : null, 'preview'], [k('cut'), 'CUT'], [k('auto'), 'AUTO'], [k('black'), 'BLACK'], [k('bars'), 'BARRAS'], ['Esc', 'Operação']].filter(([key]) => key).map(([key, what]) => key + ' ' + what).join(' · ') + ' · troque em Personalizar';
  }
  const basePaint = paint; paint = function () { basePaint(); paintFooter(); };
  buildGrid(); sync();
  window.andromedaCommands = { COMMANDS, ACTIONS, paint, keyOf, openSources, runFade, fade, layout: () => cmdLayout };
})();
