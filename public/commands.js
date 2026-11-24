'use strict';
/*
 * Operação reorganizada (0.19).
 *
 * - "Comandos" no lugar da seleção de fontes: o PREVIEW passa a ser escolhido no multiview (clique) e o painel
 *   ganha os comandos de produção: GC 1–3, LOGO, REGRESSIVA (direto no AR), PiP, VT, VT PRÓXIMO e VINHETA (vão ao PREVIEW),
 *   BLACK (F1) e BARRAS (F2). Clique executa; duplo clique abre os ajustes do comando.
 * - "Áudio master" no lugar de "Camadas no ar": modulação L/R, fader master e FADE OUT com tempo ajustável.
 *   O monitor do AR fica só com a imagem; o áudio liga sozinho na primeira interação.
 * - Atalhos de teclado configuráveis (Personalizar), ESC volta para a Operação, duplo clique numa câmera do
 *   multiview abre "Fontes de câmera" naquele canal, informações das câmeras e do mosaico na barra "Câmeras".
 */
(() => {
  const R = window.andromedaRundown; if (!R) return;
  const { VT_SOURCE, VINHETA_SOURCE, BARS_SOURCE, countdown, vtPlayer, vinhetaPlayer, black, bars } = R;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };

  /* ---------- VT e vinheta como fontes (12 e 13) ---------- */
  sources[VT_SOURCE] = sources[VT_SOURCE] || 'VT'; sources[VINHETA_SOURCE] = sources[VINHETA_SOURCE] || 'VINHETA'; sources[BARS_SOURCE] = 'BARRAS';
  const baseSource = source;
  source = function (ctx, i, t, clean = false) { if (i === VT_SOURCE || i === VINHETA_SOURCE) { R.drawPlayer(ctx, ctx.canvas.width, ctx.canvas.height, i, clean); return; } if (i === BARS_SOURCE) { R.drawBars(ctx, ctx.canvas.width, ctx.canvas.height); return; } baseSource(ctx, i, t, clean); };
  const baseSelect = select;
  select = function (bus, i) {
    if (i !== VT_SOURCE && i !== VINHETA_SOURCE && i !== BARS_SOURCE) { baseSelect(bus, i); return; }
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
  const grid = make('div', 'cmd-grid'); grid.setAttribute('role', 'toolbar'); grid.setAttribute('aria-label', 'Comandos');
  // Barra de ajuste dos botões: aparece no modo Personalizar, acima dos botões.
  const tools = make('div', 'cmd-tools'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Ajuste dos botões de comando');
  tools.innerHTML = '<label class="cmd-size">Tamanho dos botões <input type="range" min="50" max="200" step="5" aria-label="Tamanho dos botões de comando"><output></output></label>' +
    '<label class="cmd-cols">Por linha <select aria-label="Botões por linha"></select></label>' +
    '<label class="cmd-style">Estilo <select aria-label="Estilo dos botões"></select></label><button type="button" class="cmd-reset">Restaurar</button>' +
    '<span class="cmd-hint">Arraste um botão para trocar de lugar, ou use ‹ › · ⇔ deixa o botão largo</span>';
  for (let n = 2; n <= 8; n++) tools.querySelector('.cmd-cols select').add(new Option(String(n), String(n)));
  // Estilos modernos dos botões (Comandos e Master). "Clássico" é o visual de antes.
  const BUTTON_STYLES = [['vidro', 'Vidro'], ['neon', 'Neon'], ['console', 'Console (tecla com LED)'], ['solido', 'Sólido'], ['classico', 'Clássico']];
  for (const [v, t] of BUTTON_STYLES) tools.querySelector('.cmd-style select').add(new Option(t, v));
  bus.append(tools, grid);
  // O modo de mover os botões dos Comandos é o do Personalizar (arrastar, ‹ › e a barra de tamanho). Sem botão no painel.
  function setMove(on) { bus.dataset.move = String(!!on); }
  setMove(false);
  keyPanel.hidden = true; // a janela do monitor do KEY 1 (PiP) não aparece mais na mesa; o comando PiP continua

  const COMMANDS = [
    { id: 'gc0', name: () => 'GC', run: () => $('#fxGC0').click(), on: () => fx.live.layers[0]?.on, settings: () => openGC(0) },
    { id: 'logo', name: () => 'LOGO', run: () => $('#fxLogo').click(), on: () => fx.live.logo.on, settings: () => openFx('#logoFile') },
    { id: 'countdown', name: () => 'REGRESSIVA', sub: () => R.formatClock(countdown.on ? (countdown.paused ?? Math.max(0, (countdown.endAt - performance.now()) / 1000)) : countdown.seconds), run: () => R.toggleCountdown(), on: () => countdown.on, settings: b => popCountdown(b) },
    { id: 'pip', name: () => 'JANELA', run: () => $('#fxPip').click(), on: () => fx.live.pip.on, settings: () => openFx('#pipSource') },
    { id: 'vinheta', name: () => 'VINHETA', sub: () => (vinhetaPlayer.loop ? '↻ ' : '') + (vinhetaPlayer.running && vinhetaPlayer.item?.duration ? '−' + R.formatClock(vinhetaPlayer.item.duration - vinhetaPlayer.item.el.currentTime) : vinhetaPlayer.item?.name || 'sem vídeo') + (vinhetaPlayer.loop && !vinhetaPlayer.running ? ' · LOOP' : '') + (vinhetaPlayer.audio === false ? ' · SEM ÁUDIO' : ''), run: () => R.vinhetaToPreview(), on: () => state.pgm === VINHETA_SOURCE, prv: () => state.prv === VINHETA_SOURCE, settings: b => popVinheta(b) },
    { id: 'black', name: () => 'BLACK', sub: () => black.on ? 'direto no AR' : '', run: () => R.blackToPreview(), on: () => state.pgm === 10 || black.on, prv: () => state.prv === 10, settings: b => popBlack(b) },
    { id: 'vt', name: () => 'VT', sub: () => vtPlayer.running && vtPlayer.item?.duration ? '−' + R.formatClock(vtPlayer.item.duration - vtPlayer.item.el.currentTime) : R.vt.items[R.vt.cue]?.name || 'playlist vazia', run: () => R.vtToPreview(), on: () => state.pgm === VT_SOURCE, prv: () => state.prv === VT_SOURCE, settings: () => openVT() },
    { id: 'vtnext', name: () => 'PRÓXIMO VT', icon: () => 'next', sub: () => R.vtNextLabel(), run: () => R.vtNext(), on: () => false, prv: () => false, settings: () => openVT() },
    { id: 'vtpause', name: () => vtPlayer.paused ? 'CONTINUAR VT' : 'PAUSAR VT', icon: () => vtPlayer.paused ? 'play' : 'pause', sub: () => vtPlayer.running ? (vtPlayer.paused ? 'pausado' : 'tocando') : 'sem VT no ar', run: () => R.vtPause(), on: () => !!vtPlayer.paused, prv: () => false, settings: () => openVT() },
    { id: 'vtstop', name: () => 'PARAR VT', icon: () => 'stop', sub: () => state.pgm === VT_SOURCE ? 'tira do ar' : 'sem VT no ar', run: () => R.vtStop(), on: () => false, prv: () => false, settings: () => openVT() },
    // MOSAICO: as câmeras marcadas com o M (no multiview) numa grade só; entra pelo PREVIEW como as demais fontes.
    { id: 'mosaic', name: () => 'MOSAICO', sub: () => { const n = (window.andromedaStage?.members || []).length; return n ? n + (n === 1 ? ' câmera' : ' câmeras') : 'marque com M'; }, run: () => select('prv', 11), on: () => state.pgm === 11, prv: () => state.prv === 11, settings: () => openMosaic() },
    // TRILHA: música de fundo direto no AR (sem PREVIEW), com fade in ao ligar e fade out ao desligar.
    { id: 'trilha', name: () => 'TRILHA', icon: () => 'note', sub: () => { const t = R.trilha.info(); return t.state === 'out' ? 'saindo do AR…' : t.state === 'in' ? 'entrando…' : t.on ? '♪ ' + (t.name || 'no ar') : t.total ? t.name : 'playlist vazia'; }, run: () => R.trilha.toggle(), on: () => R.trilha.info().on, prv: () => R.trilha.info().out, settings: () => R.trilha.openPanel() },
    { id: 'trilhanext', name: () => 'PRÓXIMA FAIXA', icon: () => 'next', sub: () => { const t = R.trilha.info(); return t.total > 1 ? 'troca suave' : 'sem outra faixa'; }, run: () => R.trilha.next(), on: () => false, prv: () => false, settings: () => R.trilha.openPanel() },
    // TRACKING: liga e desliga o seguimento automático da câmera selecionada no Controle de câmera (a que segue o PREVIEW).
    { id: 'tracking', name: () => 'TRACKING', icon: () => 'target', sub: () => { const T = window.andromedaTracking; if (!T) return ''; const cam = String(sources[camCtl.slot] || 'CAM ' + (camCtl.slot + 1)).split('—')[0].trim(); return T.info().on ? cam + ' · seguindo' : camCtl.enabled && camCtl.caps.has(camCtl.slot) ? cam + ' · desligado' : 'ative o controle de câmera'; }, run: () => window.andromedaTracking?.toggle(), on: () => false, prv: () => !!window.andromedaTracking?.info().on, settings: () => openCamCtl() },
    // MARCAÇÕES: abre sobre o PREVIEW as 4 posições salvas da câmera que está nele (com miniatura); escolher leva a câmera à posição antes do AR.
    { id: 'marks', name: () => 'MARCAÇÕES', icon: () => 'marks', sub: () => window.andromedaMarks?.label() || '', run: () => window.andromedaMarks?.toggle(), on: () => false, prv: () => !!window.andromedaMarks?.isOpen(), settings: () => openCamCtl() },
    // INTERCOM: 1º toque ativa (pede o microfone); depois, cada toque abre ou fecha o microfone para as câmeras.
    { id: 'intercom', name: () => 'INTERCOM', icon: () => 'mic', sub: () => intercomState(), run: () => intercomToggle(), on: () => !!camDesk.talking, prv: () => !!camDesk.mic && !camDesk.talking, settings: () => openIntercom() },
    { id: 'bars', name: () => 'BARRAS', sub: () => bars.tone ? 'com tom 1 kHz' : '', run: () => R.barsToPreview(), on: () => state.pgm === BARS_SOURCE || bars.on, prv: () => state.prv === BARS_SOURCE, settings: b => popBars(b) },
  ];
  const byId = id => COMMANDS.find(c => c.id === id);
  const intercomState = () => !camDesk.mic ? 'toque para ativar' : camDesk.talking ? '● falando' : 'ativo · toque p/ falar';
  function intercomToggle() {
    if (!camDesk.mic) { $('#dtvEnable')?.click(); return true; } // pede o microfone; a página do intercom mostra o resultado
    if ($('#dtvTalk')?.disabled) return false; setDtvTalk(!camDesk.talking); return true;
  }
  // Duplo clique no MOSAICO: leva às câmeras do multiview, onde cada uma tem o botão M para entrar ou sair do mosaico.
  function openMosaic() { openWorkspace('operation'); const panel = $('[data-tool=cameras]'); panel?.scrollIntoView({ block: 'center', behavior: 'smooth' }); panel?.classList.add('flash'); setTimeout(() => panel?.classList.remove('flash'), 1600); }
  function openCamCtl() { openWorkspace('operation'); const panel = $('[data-tool=camctl]'); panel?.scrollIntoView({ block: 'center', behavior: 'smooth' }); panel?.classList.add('flash'); setTimeout(() => panel?.classList.remove('flash'), 1600); }
  function openIntercom() { openWorkspace('operation'); const panel = $('[data-tool=intercom]'); panel?.scrollIntoView({ block: 'center', behavior: 'smooth' }); panel?.classList.add('flash'); setTimeout(() => panel?.classList.remove('flash'), 1600); }
  const LAYOUT_KEY = 'andromeda.commands.v1';
  let cmdLayout = store.get(LAYOUT_KEY, null);
  if (!cmdLayout || !Array.isArray(cmdLayout.order)) cmdLayout = { order: COMMANDS.map(c => c.id), hidden: [] };
  // Comando novo entra ao lado do que o originou (VT PRÓXIMO fica depois do VT), não no fim da fila.
  for (const [add, after] of [['pip', 'countdown'], ['vtnext', 'vt'], ['vtpause', 'vtnext'], ['vtstop', 'vtpause'], ['trilha', 'mosaic'], ['trilhanext', 'trilha'], ['tracking', 'trilhanext'], ['marks', 'tracking']]) if (!cmdLayout.order.includes(add) && cmdLayout.order.includes(after)) cmdLayout.order.splice(cmdLayout.order.indexOf(after) + 1, 0, add);
  cmdLayout.order = [...cmdLayout.order.filter(byId), ...COMMANDS.map(c => c.id).filter(id => !cmdLayout.order.includes(id))];
  cmdLayout.hidden = (cmdLayout.hidden || []).filter(byId);
  // Personalização dos botões: tamanho (50–200%), botões por linha (2–8), botões largos (2 colunas) e ordem própria.
  const clampSize = v => Math.min(200, Math.max(50, Math.round(Number(v) / 5) * 5 || 100)), clampCols = v => Math.min(8, Math.max(2, Math.round(Number(v)) || 4));
  cmdLayout.size = clampSize(cmdLayout.size ?? 100); cmdLayout.cols = clampCols(cmdLayout.cols ?? 4);
  cmdLayout.wide = (cmdLayout.wide || []).filter(byId); cmdLayout.custom = !!cmdLayout.custom;
  const styleOk = v => BUTTON_STYLES.some(([k]) => k === v) ? v : 'vidro';
  cmdLayout.style = styleOk(cmdLayout.style);
  // Os botões podem ser reorganizados de dois jeitos: no Personalizar (mesa inteira) ou pelo botão "Mover botões" do próprio painel.
  const editingIn = el => !!el?.ownerDocument?.body?.classList.contains('layout-editing') || bus.dataset.move === 'true';
  let chipPainter = null;

  const buttons = new Map();
  // Move um comando para antes de outro (ou para o fim). Usado pelo arrastar e pelos testes.
  function moveCommand(id, beforeId) {
    if (!byId(id) || id === beforeId) return;
    const order = cmdLayout.order.filter(x => x !== id), at = beforeId ? order.indexOf(beforeId) : -1;
    order.splice(at < 0 ? order.length : at, 0, id); cmdLayout.order = order; cmdLayout.custom = true; saveCmdLayout();
  }
  // Uma posição para trás (-1) ou para frente (+1) na ordem visível; o toque e o teclado usam isto no lugar de arrastar.
  function nudge(id, dir) {
    const visible = cmdLayout.order.filter(x => !cmdLayout.hidden.includes(x)), at = visible.indexOf(id), to = at + dir;
    if (at < 0 || to < 0 || to >= visible.length) return;
    moveCommand(id, dir < 0 ? visible[to] : visible[to + 1] || null);
  }
  function setWide(id, on) { cmdLayout.wide = on ? [...new Set([...cmdLayout.wide, id])] : cmdLayout.wide.filter(x => x !== id); saveCmdLayout(); }
  function setSize(v) { cmdLayout.size = clampSize(v); saveCmdLayout(); }
  function setCols(v) { cmdLayout.cols = clampCols(v); saveCmdLayout(); }
  function setStyle(v) { cmdLayout.style = styleOk(v); saveCmdLayout(); }
  // O estilo vale nos painéis Comandos e Master, mesmo que estejam na segunda tela.
  function applyStyle() { for (const el of [grid, document.querySelector('.master-panel')]) if (el) el.dataset.btnStyle = cmdLayout.style; }
  function resetLook() { cmdLayout = { order: COMMANDS.map(c => c.id), hidden: [], size: 100, cols: 4, wide: [], custom: false, style: cmdLayout.style }; saveCmdLayout(); }
  // Todos os botões usam a MESMA fonte: o tamanho acompanha a largura da coluna (e a barra de tamanho), igual para todos.
  function fitFont() {
    const cs = getComputedStyle(grid), inner = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), gap = parseFloat(cs.columnGap) || 0, col = (inner - gap * (cmdLayout.cols - 1)) / cmdLayout.cols;
    if (!(col > 20)) return; grid.style.setProperty('--cmd-font', (Math.max(9, Math.min(12.5, col * 0.14)) * cmdLayout.size / 100).toFixed(2) + 'px');
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitFont()).observe(grid);
  let dragId = null;
  function buildGrid() {
    grid.replaceChildren(); buttons.clear();
    grid.style.setProperty('--cmd-scale', String(cmdLayout.size / 100)); grid.style.setProperty('--cmd-cols', String(cmdLayout.cols));
    grid.dataset.custom = String(cmdLayout.custom);
    grid.dataset.fit = String(cmdLayout.size === 100); // 100% = os botões ocupam o painel inteiro, sem rolar
    fitFont();
    const range = tools.querySelector('input'), sel = tools.querySelector('.cmd-cols select');
    range.value = String(cmdLayout.size); tools.querySelector('output').textContent = cmdLayout.size + '%'; sel.value = String(cmdLayout.cols);
    tools.querySelector('.cmd-style select').value = cmdLayout.style; applyStyle();
    for (const id of cmdLayout.order) {
      if (cmdLayout.hidden.includes(id)) continue;
      const c = byId(id), b = make('button', 'cmd-btn'); b.type = 'button'; b.dataset.cmd = id; b.dataset.wide = String(cmdLayout.wide.includes(id)); b.draggable = true;
      const wide = make('span', 'cmd-wide-toggle', '⇔'); wide.title = 'Botão largo (2 colunas) / normal'; wide.setAttribute('aria-hidden', 'true');
      wide.addEventListener('click', e => { e.stopPropagation(); setWide(id, !cmdLayout.wide.includes(id)); });
      const left = make('span', 'cmd-nudge cmd-nudge-l', '‹'), right = make('span', 'cmd-nudge cmd-nudge-r', '›');
      left.title = 'Move este botão uma posição para trás'; right.title = 'Move este botão uma posição para frente';
      left.addEventListener('click', e => { e.stopPropagation(); nudge(id, -1); }); right.addEventListener('click', e => { e.stopPropagation(); nudge(id, 1); });
      b.append(make('span', 'cmd-name'), make('small', 'cmd-sub'), make('kbd', 'cmd-key'), left, right, wide);
      // Clique executa (com uma folga curta para reconhecer o duplo clique); teclado (Enter/Espaço no botão) executa na hora.
      // No modo Personalizar o botão não dispara nada: ele só é arrastado.
      let timer = null;
      b.addEventListener('click', e => { if (editingIn(b)) return; if (e.detail === 0) { c.run(); paint(); return; } if (e.detail > 1) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; c.run(); paint(); }, 230); });
      b.addEventListener('dblclick', e => { e.preventDefault(); clearTimeout(timer); timer = null; if (editingIn(b)) return; c.settings(b); });
      b.addEventListener('dragstart', e => { if (!editingIn(b)) { e.preventDefault(); return; } dragId = id; b.classList.add('cmd-dragging'); try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch { /* sem dados */ } });
      b.addEventListener('dragend', () => { dragId = null; b.classList.remove('cmd-dragging'); for (const x of grid.children) x.classList.remove('cmd-drop-before', 'cmd-drop-after'); });
      b.addEventListener('dragover', e => { if (!dragId || dragId === id) return; e.preventDefault(); const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; b.classList.toggle('cmd-drop-after', after); b.classList.toggle('cmd-drop-before', !after); });
      b.addEventListener('dragleave', () => b.classList.remove('cmd-drop-before', 'cmd-drop-after'));
      b.addEventListener('drop', e => { if (!dragId || dragId === id) return; e.preventDefault(); const after = b.classList.contains('cmd-drop-after'), visible = cmdLayout.order.filter(x => !cmdLayout.hidden.includes(x)), next = visible[visible.indexOf(id) + 1] || null;
        const moving = dragId; dragId = null; moveCommand(moving, after ? (next === moving ? visible[visible.indexOf(id) + 2] || null : next) : id); });
      grid.append(b); buttons.set(id, b);
    }
    paint();
  }
  function setVisible(id,show){
    if(!byId(id))return;
    cmdLayout.hidden=cmdLayout.hidden.filter(value=>value!==id);
    if(!show)cmdLayout.hidden.push(id);
    cmdLayout.custom=true;saveCmdLayout();
  }
  function saveCmdLayout() { store.set(LAYOUT_KEY, cmdLayout); buildGrid(); window.andromedaCommands?.paintOrder?.(); }
  function paint() {
    chipPainter?.();
    for (const [id, b] of buttons) {
      const c = byId(id), on = !!c.on(), prv = !!c.prv?.(), sub = c.sub?.() || '';
      if (c.icon) R.iconLabel(b.querySelector('.cmd-name'), c.icon(), c.name()); else b.querySelector('.cmd-name').textContent = c.name(); b.querySelector('.cmd-sub').textContent = sub;
      const key = keyOf(id); b.querySelector('.cmd-key').textContent = key ? prettyKey(key) : '';
      b.setAttribute('aria-pressed', String(on)); b.dataset.prv = String(prv);
      b.title = (on ? 'No AR. ' : prv ? 'No PREVIEW. ' : '') + 'Clique: ' + ({ vt: 'leva ao PREVIEW', vtpause: 'pausa o VT no AR / continua', vtstop: 'para o VT e o tira do ar', vtnext: 'com VT no AR troca já para o seguinte; sem VT no AR arma o próximo da playlist', vinheta: 'leva ao PREVIEW', mosaic: 'leva o mosaico das câmeras marcadas com M ao PREVIEW', intercom: 'ativa o intercom; depois abre e fecha o microfone para as câmeras', countdown: 'entra/sai do AR', black: 'leva o PRETO ao PREVIEW (CUT ou AUTO levam ao AR)', bars: 'leva as BARRAS ao PREVIEW (CUT ou AUTO levam ao AR)' }[id] || 'coloca/retira do AR') + '. Duplo clique: ajustes.' + (key ? ' Atalho: ' + prettyKey(key) + '.' : '');
    }
  }
  setInterval(paint, 200);
  { const range = tools.querySelector('input');
    range.addEventListener('input', () => { cmdLayout.size = clampSize(range.value); tools.querySelector('output').textContent = cmdLayout.size + '%'; grid.style.setProperty('--cmd-scale', String(cmdLayout.size / 100)); });
    range.addEventListener('change', () => setSize(range.value));
    tools.querySelector('.cmd-cols select').onchange = e => setCols(e.target.value); tools.querySelector('.cmd-style select').onchange = e => setStyle(e.target.value); tools.querySelector('.cmd-reset').onclick = () => resetLook(); }

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
    const where = make('div', 'cmd-pop-field'); where.append(make('span', '', 'Onde fica o relógio'), R.cdPositionPicker());
    openPop(b, 'Regressiva', R.cdRow, where, note('Ajuste o tempo (ex.: 5:00) antes de colocar no AR. Escolha a posição do relógio (ou Tela cheia); vale na hora, inclusive com ela no AR. Com ela no AR: pausar ou reiniciar.'), more);
  }
  function popVinheta(b) {
    const label = make('label', 'cmd-pop-field', 'Vídeo da vinheta'), input = make('input'); input.type = 'file'; input.accept = 'video/*'; label.append(input);
    input.onchange = () => { if (input.files[0]) R.setVinheta(input.files[0]); paint(); closePop(); };
    const end = make('label', 'cmd-pop-field', 'Ao terminar'), sel = make('select');
    for (const [v, t] of [['return', 'Voltar para a câmera'], ['hold', 'Congelar no último quadro']]) sel.add(new Option(t, v));
    sel.value = vinhetaPlayer.end; sel.onchange = () => { vinhetaPlayer.end = sel.value; }; end.append(sel);
    // Áudio da vinheta: COM áudio (padrão) ou SEM áudio (o vídeo toca e o som não entra no programa).
    const aud = make('label', 'cmd-pop-field', 'Áudio da vinheta'), audSel = make('select'); audSel.id = 'vinhetaAudio';
    for (const [v, t] of [['on', 'Com áudio'], ['off', 'Sem áudio (só a imagem)']]) audSel.add(new Option(t, v));
    audSel.value = vinhetaPlayer.audio === false ? 'off' : 'on'; audSel.onchange = () => { R.setVinhetaAudio(audSel.value === 'on'); }; aud.append(audSel);
    const loop = make('label', 'cmd-pop-check'), chk = make('input'); chk.type = 'checkbox'; chk.id = 'vinhetaLoop'; chk.checked = vinhetaPlayer.loop;
    loop.append(chk, make('span', '', 'LOOP: repetir direto até tirar do AR'));
    const syncLoop = () => { sel.disabled = chk.checked; tr.disabled = chk.checked; };
    chk.onchange = () => { R.setVinhetaLoop(chk.checked); syncLoop(); };
    const how = make('label', 'cmd-pop-field', 'Volta com'), tr = make('select');
    for (const [v, t] of [['mix', 'AUTO (transição escolhida)'], ['cut', 'CUT seco']]) tr.add(new Option(t, v));
    tr.value = vinhetaPlayer.transition; tr.onchange = () => { vinhetaPlayer.transition = tr.value; }; how.append(tr);
    syncLoop();
    openPop(b, 'Vinheta', note(vinhetaPlayer.item ? 'Carregada: ' + vinhetaPlayer.item.name + (vinhetaPlayer.item.duration ? ' (' + R.formatClock(Math.round(vinhetaPlayer.item.duration)) + ')' : '') : 'Nenhum vídeo carregado.'), label, aud, loop, end, how,
      note('Clique em VINHETA para levá-la ao PREVIEW; ela toca quando vai ao AR (CUT/AUTO). Sem loop, a mesa volta sozinha para a câmera; com LOOP ela repete até você cortar para outra fonte.'));
  }
  function popBlack(b) {
    const label = make('label', 'cmd-pop-field', 'Tempo do fade (segundos)'), input = make('input'); input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '0.1'; input.value = String(black.seconds);
    input.onchange = () => { const v = Number(input.value); if (v >= 0 && v <= 10) { black.seconds = v; store.set('andromeda.black.v1', v); } }; label.append(input);
    openPop(b, 'BLACK', label, note('BLACK leva o PRETO ao PREVIEW; CUT ou AUTO levam ao AR (com AUTO a saída escurece pela transição escolhida). Para voltar, escolha uma câmera no PREVIEW e dê CUT/AUTO. O tempo acima vale só para o BLACK direto no AR (atalho Shift+F1, para emergência), que escurece tudo, inclusive GC, logotipo e regressiva.'));
  }
  black.seconds = Number(store.get('andromeda.black.v1', .5)) || 0;
  function popBars(b) {
    const label = make('label', 'cmd-pop-check'), input = make('input'); input.type = 'checkbox'; input.checked = bars.tone; label.append(input, ' Tom de referência 1 kHz (−18 dBFS)');
    input.onchange = () => { bars.tone = input.checked; R.syncTone(); paint(); };
    openPop(b, 'Barras de cor', label, note('BARRAS leva as barras de cor (75%) ao PREVIEW; CUT ou AUTO levam ao AR, para alinhar monitores e plataformas antes do programa. O tom liga junto com as barras no AR. Atalho Shift+F2 coloca as barras direto no AR (emergência).'));
  }

  /* ---------- Áudio master (no lugar de "Camadas no ar") ---------- */
  const layersShell = fxQuick.closest('.dock-panel');
  fxQuick.hidden = true;
  const master = make('section', 'master-panel'); master.setAttribute('aria-label', 'Áudio master');
  const SPK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const PHONES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="13.5" width="4.5" height="6.5" rx="1.6" fill="currentColor"/><rect x="16" y="13.5" width="4.5" height="6.5" rx="1.6" fill="currentColor"/></svg>';
  master.innerHTML = '<div class="master-top"><span class="master-label">SAÍDA PROGRAM</span><span id="masterAudioState" class="master-state">—</span></div>' +
    '<div class="master-switches">' +
    '<button type="button" id="masterAudioOn" class="master-switch" aria-pressed="false"><i class="ms-led"></i>' + SPK + '<span><b>HABILITAR ÁUDIO</b><small>medidores e saída de som</small></span></button>' +
    '<button type="button" id="masterPhones" class="master-switch" aria-pressed="false"><i class="ms-led"></i>' + PHONES + '<span><b>FONES</b><small>desligados</small></span></button></div>' +
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
  // Habilitar áudio e fones ficam no MASTER, como botões com LED; a caixa "Ouvir em fones" do mixer sai.
  const audioOn = master.querySelector('#masterAudioOn'), phones = master.querySelector('#masterPhones');
  audioOn.onclick = async () => { try { await audioMixer.enable(); $('#pgmAudioEnable')?.click(); log('Áudio da mesa habilitado'); } catch (e) { log('Áudio indisponível: ' + e.message); } paintSwitches(); };
  phones.onclick = async () => { const b = $('#pgmListen'); if (b) await b.onclick?.(); paintSwitches(); };
  function paintSwitches() {
    master.dataset.level = $('.pgm-audio-monitor')?.dataset.level || 'off'; // cor do indicador de estado (sinal, silêncio, pico)
    const running = audioMixer.context?.state === 'running', listening = running && !!$('#listenMixer')?.checked;
    audioOn.setAttribute('aria-pressed', String(running)); audioOn.querySelector('b').textContent = running ? 'ÁUDIO HABILITADO' : 'HABILITAR ÁUDIO';
    audioOn.querySelector('small').textContent = running ? 'medidores e saída ativos' : 'medidores e saída de som';
    audioOn.title = running ? 'O áudio da mesa está ativo.' : 'Liga o áudio da mesa: medidores, mixer e saída para a transmissão.';
    phones.setAttribute('aria-pressed', String(listening)); phones.querySelector('small').textContent = listening ? 'ouvindo o PGM' : 'desligados';
    phones.title = listening ? 'Desliga o retorno do PGM nos fones.' : 'Ouve o áudio do PGM nos fones deste computador.';
  }
  setInterval(paintSwitches, 250); paintSwitches(); applyStyle();

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
  const remoteAudio = make('button', 'master-remote', 'Remoto'); remoteAudio.type = 'button'; remoteAudio.title = 'Mesa de áudio em outro aparelho: gera o link (e o QR) para operar o áudio de um celular ou computador. Cada aparelho novo é aprovado aqui na mesa.'; remoteAudio.setAttribute('aria-label', 'Mesa de áudio em outro aparelho');
  master.querySelector('.master-top').append(remoteAudio);
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
    // Números 1–9 e 0: a câmera vai DIRETO ao AR (CUT). As ações "no PREVIEW" continuam disponíveis para quem quiser atribuir uma tecla.
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'cam' + i, label: 'Câmera ' + (i + 1) + ' direto no AR', key: i < 9 ? String(i + 1) : '0', run: () => camToAir(i) })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'prv' + i, label: 'Câmera ' + (i + 1) + ' no PREVIEW', key: '', run: () => select('prv', i) })),
    { id: 'prvBlack', label: 'Preto no PREVIEW', key: '', run: () => select('prv', 10) },
    { id: 'mosaic', label: 'Mosaico no PREVIEW', key: 'M', run: () => select('prv', 11) },
    { id: 'cut', label: 'CUT', key: 'Space', run: () => cut() },
    { id: 'auto', label: 'AUTO', key: 'Enter', run: () => auto() },
    { id: 'black', label: 'BLACK no PREVIEW', key: 'F1', run: () => R.blackToPreview() },
    { id: 'blackNow', label: 'BLACK direto no AR (fade, emergência)', key: 'Shift+F1', run: () => R.toggleBlack() },
    { id: 'intercom', label: 'INTERCOM (ativar / abrir e fechar o microfone)', key: '', run: () => intercomToggle() },
    { id: 'bars', label: 'BARRAS de cor no PREVIEW', key: 'F2', run: () => R.barsToPreview() },
    { id: 'barsNow', label: 'BARRAS direto no AR (emergência)', key: 'Shift+F2', run: () => R.toggleBars() },
    { id: 'gc0', label: 'GC', key: 'F3', run: () => byId('gc0').run() },
    { id: 'logo', label: 'LOGO', key: 'F6', run: () => byId('logo').run() },
    { id: 'countdown', label: 'REGRESSIVA (direto no AR)', key: 'F7', run: () => R.toggleCountdown() },
    { id: 'pip', label: 'JANELA (imagem dentro da imagem)', key: 'F8', run: () => byId('pip').run() },
    { id: 'vt', label: 'VT no PREVIEW', key: 'F9', run: () => R.vtToPreview() },
    { id: 'vtnext', label: 'VT PRÓXIMO (dispara o próximo da playlist)', key: 'Shift+F9', run: () => R.vtNext() },
    { id: 'vtpause', label: 'VT PAUSAR / CONTINUAR', key: 'Shift+F7', run: () => R.vtPause() },
    { id: 'vtstop', label: 'VT PARAR (tira do ar)', key: 'Shift+F8', run: () => R.vtStop() },
    { id: 'vinheta', label: 'VINHETA no PREVIEW', key: 'F10', run: () => R.vinhetaToPreview() },
    { id: 'tracking', label: 'TRACKING da câmera selecionada (liga/desliga)', key: '', run: () => window.andromedaTracking?.toggle() },
    { id: 'marks', label: 'MARCAÇÕES da câmera no PREVIEW (abre / fecha; com o painel aberto, 1 a 4 escolhem)', key: 'P', run: () => window.andromedaMarks?.toggle() },
    { id: 'trilha', label: 'TRILHA (liga com fade in / desliga com fade out)', key: 'T', run: () => R.trilha.toggle() },
    { id: 'trilhanext', label: 'TRILHA · próxima faixa', key: 'N', run: () => R.trilha.next() },
    { id: 'fade', label: 'FADE OUT / FADE IN do master', key: '', run: () => runFade() },
  ];
  const KEYS_KEY = 'andromeda.shortcuts.v1';
  const defaults = Object.fromEntries(ACTIONS.map(a => [a.id, a.key]));
  let keymap = { ...defaults, ...store.get(KEYS_KEY, {}) };
  delete keymap.gc1;
  delete keymap.gc2;
  // Quem já tinha os números no PREVIEW (padrão antigo) passa para "direto no AR"; teclas trocadas pelo operador são respeitadas.
  { const OLD = { prvBlack: '0', ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['prv' + i, i < 9 ? String(i + 1) : '-'])) }; let moved = false;
    for (const [id, old] of Object.entries(OLD)) if (keymap[id] === old) { keymap[id] = ''; moved = true; }
    if (moved) store.set(KEYS_KEY, keymap); }
  // Câmera direto no AR: entra no PREVIEW e dá CUT. Sem sinal (ou durante transição) não vai ao ar: ela fica só no PREVIEW e a mesa avisa.
  const hasSignal = i => { const el = media[i]?.element; return !!cams[i]?.conn && !!el && (el.videoWidth || el.naturalWidth || 0) > 0; };
  function camToAir(i) {
    if (state.busy || state.progress > 0) { log('Transição em andamento: ' + sources[i] + ' não foi ao ar'); return false; }
    if (state.pgm === i) return false;
    select('prv', i); if (state.prv !== i) return false;
    if (!hasSignal(i)) { log(sources[i] + ' sem sinal: ficou só no PREVIEW (não foi ao ar)'); return false; }
    cut(); log(sources[i] + ' direto no AR'); return true;
  }
  // Modo de áudio de cada câmera: três botões fixos no lugar do menu. OFF (branco) sem áudio · AR (vermelho) áudio só enquanto
  // a câmera está no AR (AFV) · ON (verde) áudio contínuo. Os botões comandam o menu original (que fica escondido).
  { const MODES = [['off', 'OFF', 'Sem áudio'], ['afv', 'AR', 'Áudio só enquanto a câmera está no AR (acompanha o vídeo)'], ['on', 'ON', 'Áudio contínuo, mesmo fora do AR']];
    const groups = [];
    $$('.mv-cell').forEach((cell, i) => {
      const sel = cell.querySelector('select.cell-audio'); if (!sel) return;
      const group = make('div', 'cell-mode'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', 'Áudio de ' + (sources[i] || 'CAM ' + (i + 1)));
      for (const [value, label, tip] of MODES) {
        const btn = make('button', 'cell-mode-btn', label); btn.type = 'button'; btn.dataset.mode = value; btn.setAttribute('role', 'radio'); btn.title = tip;
        for (const type of ['pointerdown', 'keydown', 'dblclick']) btn.addEventListener(type, e => e.stopPropagation());
        btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); sel.value = value; sel.dispatchEvent(new Event('change')); paintModes(); });
        group.append(btn);
      }
      sel.after(group); groups.push([group, sel]);
    });
    function paintModes() { for (const [group, sel] of groups) for (const btn of group.children) { const on = btn.dataset.mode === sel.value; if (btn.getAttribute('aria-checked') !== String(on)) btn.setAttribute('aria-checked', String(on)); } }
    paintModes(); setInterval(paintModes, 150); }
  // O número de atalho aparece em cada câmera do multiview; clicar nele faz o mesmo que a tecla: a câmera corta direto para o AR.
  // O resto do quadro continua como antes (um clique escolhe o PREVIEW, duplo clique abre as fontes).
  { const chips = [];
    $$('.mv-cell').forEach((cell, i) => {
      const chip = make('button', 'cell-key'); chip.type = 'button';
      for (const type of ['pointerdown', 'keydown', 'dblclick']) chip.addEventListener(type, e => e.stopPropagation());
      chip.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); if (editingIn(cell)) return; camToAir(i); paint(); });
      (cell.querySelector('.mv-cam-label') || cell).prepend(chip); chips.push(chip);
    });
    chipPainter = () => chips.forEach((chip, i) => {
      const k = keyOf('cam' + i), label = k ? prettyKey(k) : '';
      if (chip.textContent !== label) chip.textContent = label;
      chip.hidden = !k;
      chip.title = 'Câmera ' + (i + 1) + ' direto no AR' + (k ? ' (tecla ' + label + ')' : '') + '. Sem sinal: fica só no PREVIEW.';
      chip.setAttribute('aria-label', chip.title);
    });
  }
  const keyOf = id => keymap[id] || '';
  const comboOf = e => {
    const base = e.code === 'Space' ? 'Space' : e.key === 'Enter' ? 'Enter' : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && base.length > 1 && 'Shift', base].filter(Boolean).join('+');
  };
  const prettyKey = k => k.replace('Space', 'Espaço').replace('Enter', 'Enter').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('PageDown', 'PgDn').replace('PageUp', 'PgUp').replace('Shift+', '⇧');
  chipPainter?.();
  const LEGACY = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'M', 'Space', 'Enter']);
  const typing = t => t.isContentEditable || !!t.closest?.('input,select,textarea');
  let capturing = null;
  function toggleFullscreen(doc) { try { if (doc.fullscreenElement) doc.exitFullscreen(); else doc.documentElement.requestFullscreen(); } catch { /* sem tela cheia */ } }
  addEventListener('keydown', e => {
    if (capturing) return;
    if (e.key === 'Escape') {
      // ESC volta para a Operação (fora de janelas, edição de layout e campos de texto).
      if (document.querySelector('dialog[open]') || document.body.classList.contains('layout-editing') || typing(e.target) || !pop.hidden) return;
      openWorkspace('operation'); return;
    }
    // F1–F12 são da mesa enquanto ela está em operação: nunca acionam o navegador (ajuda, busca, recarregar, ferramentas…),
    // mesmo com um campo de texto selecionado, uma janela aberta ou a tecla segurada.
    const isF = /^F([1-9]|1[0-2])$/.test(e.key);
    if (isF) e.preventDefault();
    if (e.metaKey || (e.repeat && !isF)) return;
    if (e.repeat) { e.stopImmediatePropagation(); return; }
    if (!isF && (document.querySelector('dialog[open]') || typing(e.target))) return;
    const combo = comboOf(e);
    const onButton = !isF && e.target.closest?.('button,[role="button"]') && !e.target.closest('.mv-cell,.src-btn,.cmd-btn');
    if (onButton && (combo === 'Space' || combo === 'Enter')) return; // Espaço/Enter acionam o botão em foco
    const action = ACTIONS.find(a => keymap[a.id] && keymap[a.id] === combo);
    if (action) { if (isF && document.querySelector('dialog[open]')) { e.stopImmediatePropagation(); return; } e.preventDefault(); e.stopImmediatePropagation(); action.run(); paint(); return; }
    // F11 sem função na mesa continua alternando a tela cheia (da janela onde a tecla foi apertada).
    if (e.key === 'F11' && combo === 'F11') { e.stopImmediatePropagation(); toggleFullscreen(e.andromedaSource?.document || e.target.ownerDocument || document); return; }
    // Teclas antigas que foram trocadas de função não disparam mais o comando antigo; F1–F12 sem função não fazem nada.
    if (LEGACY.has(combo) || isF) e.stopImmediatePropagation();
  }, true);

  /* ---------- Personalizar: atalhos e botões de comando ---------- */
  let orderPainter = null;
  const settings = $('.layout-settings');
  if (settings) {
    const box = make('section', 'shortcut-settings');
    box.innerHTML = '<h3>Atalhos do teclado</h3><p>Clique no atalho e pressione a tecla (ou combinação com Ctrl/Alt). <b>Backspace</b> limpa; <b>Esc</b> cancela. Funcionam em qualquer página; as teclas <b>F1 a F12</b> valem sempre (até com um campo de texto selecionado), e as demais não funcionam enquanto você digita num campo. <b>F11</b> só alterna a tela cheia se não tiver função na mesa. <b>Esc</b> sempre volta para a Operação.</p><div class="shortcut-list" role="table" aria-label="Atalhos do teclado"></div><button type="button" id="shortcutsReset">Restaurar atalhos padrão</button>';
    settings.append(box);
    const list = box.querySelector('.shortcut-list');
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
    paintShortcuts();
  }

  /* ---------- sincronização visual ---------- */
  const baseSync = sync;
  sync = function () {
    baseSync();
    if (camTitle?.shown && camTitle.shadow.textContent) camTitle.shown.textContent = camTitle.shadow.textContent;
    for (const bus of ['prv', 'pgm']) { const strip = $('.preview-strip[data-bus="' + bus + '"]'); if (strip) playerInfo(bus, strip); }
    paint();
  };
  // Faixas do PREVIEW e do PGM: VT/vinheta mostram o vídeo (preparado ou no ar) em vez de "aguardando fonte".
  // A faixa é desenhada por um só lugar: o relógio das faixas (stage.js) pergunta aqui antes de escrever,
  // senão as duas pinturas brigavam e a faixa piscava "Aguardando fonte · SEM SINAL" com VT/vinheta.
  function playerInfo(bus, strip) {
    const p = state[bus] === VT_SOURCE ? vtPlayer : state[bus] === VINHETA_SOURCE ? vinhetaPlayer : null;
    if (!p) return false;
    const ok = !!p.item && !p.item.error, text = p.label + ' · ' + (p.item ? p.item.name + (p.item.duration ? ' · ' + R.formatClock(Math.round(p.item.duration)) : '') : 'nenhum vídeo'),
      badge = !ok ? 'SEM VÍDEO' : bus === 'pgm' ? (p.paused ? 'PAUSADO' : p.loop ? 'NO AR · LOOP' : 'NO AR') : 'PRONTO';
    const span = strip.querySelector('span'), b = strip.querySelector('b');
    if (span.textContent !== text) span.textContent = text; if (b.textContent !== badge) b.textContent = badge; strip.dataset.ok = String(ok);
    return true;
  }
  window.andromedaPlayerInfo = playerInfo;

  function paintFooter() {
    const span = $$('.sim-footer span').find(el => /Atalhos/.test(el.textContent)); if (!span) return;
    const k = id => keymap[id] ? prettyKey(keymap[id]) : null;
    span.textContent = 'Atalhos: ' + [[k('cam0') && k('cam8') ? k('cam0') + '–' + k('cam8') : null, 'câmera no AR'], [k('cut'), 'CUT'], [k('auto'), 'AUTO'], [k('black'), 'BLACK'], [k('bars'), 'BARRAS'], ['Esc', 'Operação']].filter(([key]) => key).map(([key, what]) => key + ' ' + what).join(' · ') + ' · troque em Personalizar';
  }
  const basePaint = paint; paint = function () { basePaint(); paintFooter(); };
  buildGrid(); sync();
  window.andromedaCommands = { COMMANDS, ACTIONS, paint, keyOf, openSources, runFade, fade, layout: () => cmdLayout, setVisible, moveCommand, nudge, setMove, setWide, setSize, setCols, setStyle, resetLook, paintOrder: () => orderPainter?.() };
})();
