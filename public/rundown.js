'use strict';
/*
 * Roteiro de exibição: regressiva, VT (playlist), vinheta, BLACK e barras de cor.
 *
 * - Regressiva: contagem desenhada sobre o PROGRAM (vai para a transmissão, a gravação e a saída 9:16). Entra direto
 *   no AR pelo botão de comando. Tela cheia (abertura) ou no canto; ao zerar mantém 00:00, sai do AR ou sai e corta.
 * - VT e vinheta são FONTES (12 e 13), como uma câmera: o comando coloca no PREVIEW; o vídeo começa quando vai ao AR
 *   (CUT ou AUTO) e, ao terminar, a mesa volta sozinha para a câmera que estava no AR (ou dispara o próximo VT, ou
 *   congela). O áudio do vídeo segue a transição como o de uma câmera.
 * - BLACK (fade to black) e BARRAS (barras de cor com tom de 1 kHz opcional) vão direto ao AR, por cima de tudo.
 */
const rundownEl = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const audit = (level, code, message, data) => { try { window.andromedaAudit?.(level, code, message, data); } catch { /* auditoria opcional */ } };
const VT_SOURCE = 12, VINHETA_SOURCE = 13;

/* ---------- tempo ---------- */
// "5" = 5 min · "4:30" = 4 min 30 s · "1:00:00" = 1 h. Até 23:59:59.
function parseClock(text) {
  const parts = String(text || '').trim().split(':').map(p => p.trim());
  if (!parts.length || parts.length > 3 || parts.some(p => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  const secs = n.length === 1 ? n[0] * 60 : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length > 1 && n.at(-1) > 59) return null;
  return secs >= 1 && secs <= 86399 ? secs : null;
}
function formatClock(secs) {
  const s = Math.max(0, Math.ceil(secs)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), two = n => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s % 60) : two(m) + ':' + two(s % 60);
}

/* ---------- regressiva ---------- */
const CD_KEY = 'andromeda.countdown.v1';
const countdown = { seconds: 300, title: 'Começamos em', style: 'full', corner: 'bottom-right', end: 'hold', color: '#ffffff', accent: '#00a3ff',
  on: false, endAt: 0, paused: null, finished: false };
try { const saved = JSON.parse(localStorage.getItem(CD_KEY) || 'null'); if (saved) for (const k of ['seconds', 'title', 'style', 'corner', 'end', 'color', 'accent']) if (saved[k] !== undefined) countdown[k] = saved[k]; } catch { /* sem armazenamento */ }
if (!(countdown.seconds >= 1 && countdown.seconds <= 86399)) countdown.seconds = 300;
const saveCountdown = () => { try { localStorage.setItem(CD_KEY, JSON.stringify(Object.fromEntries(['seconds', 'title', 'style', 'corner', 'end', 'color', 'accent'].map(k => [k, countdown[k]])))); } catch { /* sem armazenamento */ } };
const remaining = () => !countdown.on ? countdown.seconds : countdown.paused !== null ? countdown.paused : Math.max(0, (countdown.endAt - performance.now()) / 1000);

function drawCountdown(ctx, W, H, left, preview = false) {
  const c = countdown, text = formatClock(left), last = left <= 10 && (c.on || preview);
  const digits = last ? c.accent : c.color, fraction = c.seconds ? Math.min(1, Math.max(0, left / c.seconds)) : 0;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (c.style === 'full') {
    // Abertura: a imagem do PGM continua ao fundo, escurecida; título, números grandes e barra de progresso.
    ctx.fillStyle = 'rgba(4, 6, 18, .72)'; ctx.fillRect(0, 0, W, H);
    const big = Math.round(Math.min(H * .26, W * .2));
    if (c.title.trim()) { ctx.fillStyle = c.color; ctx.globalAlpha = .9; ctx.font = '700 ' + Math.round(big * .2) + "px 'Exo 2', 'Segoe UI', sans-serif"; ctx.fillText(c.title.trim().slice(0, 60), W / 2, H / 2 - big * .78); ctx.globalAlpha = 1; }
    ctx.fillStyle = digits; ctx.font = '700 ' + big + "px 'JetBrains Mono', Consolas, 'Courier New', monospace"; ctx.fillText(text, W / 2, H / 2 + big * .04);
    const bw = Math.min(W * .5, big * 3.6), bh = Math.max(4, Math.round(H * .008)), bx = (W - bw) / 2, by = H / 2 + big * .7;
    ctx.fillStyle = 'rgba(255, 255, 255, .18)'; ctx.fillRect(bx, by, bw, bh); ctx.fillStyle = c.accent; ctx.fillRect(bx, by, bw * fraction, bh);
  } else {
    // Canto: caixa compacta, como um relógio de programa.
    const size = Math.round(H * .075), pad = Math.round(size * .32), title = c.title.trim().slice(0, 40);
    ctx.font = '700 ' + size + "px 'JetBrains Mono', Consolas, 'Courier New', monospace"; const tw = ctx.measureText(text).width;
    ctx.font = '600 ' + Math.round(size * .34) + "px 'Exo 2', 'Segoe UI', sans-serif"; const lw = title ? ctx.measureText(title).width : 0;
    const bw = Math.max(tw, lw) + pad * 2, bh = size + pad * 2 + (title ? size * .46 : 0), m = Math.round(H * .035);
    const x = c.corner.endsWith('right') ? W - bw - m : m, y = c.corner.startsWith('bottom') ? H - bh - m : m;
    ctx.fillStyle = 'rgba(8, 11, 32, .86)'; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = c.accent; ctx.fillRect(x, y + bh - Math.max(3, size * .06), bw * fraction, Math.max(3, size * .06));
    if (title) { ctx.fillStyle = c.color; ctx.globalAlpha = .85; ctx.fillText(title, x + bw / 2, y + pad + size * .2); ctx.globalAlpha = 1; }
    ctx.fillStyle = digits; ctx.font = '700 ' + size + "px 'JetBrains Mono', Consolas, 'Courier New', monospace"; ctx.fillText(text, x + bw / 2, y + bh - pad - size / 2);
  }
  ctx.restore();
}

// Controles da regressiva: ficam na janela de ajustes do comando REGRESSIVA (duplo clique).
const cdRow = rundownEl('div', 'cd-row'); cdRow.setAttribute('role', 'group'); cdRow.setAttribute('aria-label', 'Regressiva');
cdRow.innerHTML = '<button type="button" id="cdMinus" aria-label="Diminuir 30 segundos">−30 s</button><input id="cdTime" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Tempo da regressiva em minutos e segundos (ex.: 5:00)"><button type="button" id="cdPlus" aria-label="Aumentar 30 segundos">+30 s</button><button type="button" id="cdAir" class="cd-air" aria-pressed="false">REGRESSIVA</button><button type="button" id="cdPause" class="cd-icon" aria-label="Pausar a regressiva" title="Pausar" disabled>❚❚</button><button type="button" id="cdRestart" class="cd-icon" aria-label="Reiniciar a regressiva" title="Reiniciar" disabled>↺</button>';
const cdQ = s => cdRow.querySelector(s);

function setTime(secs) {
  if (countdown.on) return;
  countdown.seconds = Math.min(86399, Math.max(1, Math.round(secs))); saveCountdown(); paintCountdown();
}
cdQ('#cdTime').value = formatClock(countdown.seconds);
cdQ('#cdTime').addEventListener('change', () => { const s = parseClock(cdQ('#cdTime').value); if (s) setTime(s); else { cdQ('#cdTime').value = formatClock(countdown.seconds); log('Regressiva: use minutos:segundos, por exemplo 5:00 ou 0:45.'); } });
cdQ('#cdTime').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
cdQ('#cdMinus').onclick = () => setTime(countdown.seconds - 30);
cdQ('#cdPlus').onclick = () => setTime(countdown.seconds + 30);

function countdownOn() {
  const typed = parseClock(cdQ('#cdTime').value); if (typed && typed !== countdown.seconds) setTime(typed);
  Object.assign(countdown, { on: true, endAt: performance.now() + countdown.seconds * 1000, paused: null, finished: false });
  log('Regressiva no AR: ' + formatClock(countdown.seconds)); audit('info', 'regressiva-no-ar', 'Regressiva de ' + formatClock(countdown.seconds) + ' no AR', { segundos: countdown.seconds, estilo: countdown.style });
  paintCountdown();
}
function countdownOff(reason) {
  if (!countdown.on) return;
  countdown.on = false; countdown.paused = null; log('Regressiva retirada do AR' + (reason ? ' (' + reason + ')' : '')); audit('info', 'regressiva-fora', 'Regressiva retirada do AR', { motivo: reason || 'operador' }); paintCountdown();
}
const toggleCountdown = () => countdown.on ? countdownOff() : countdownOn();
cdQ('#cdAir').onclick = toggleCountdown;
cdQ('#cdPause').onclick = () => {
  if (!countdown.on || countdown.finished) return;
  if (countdown.paused === null) countdown.paused = remaining(); else { countdown.endAt = performance.now() + countdown.paused * 1000; countdown.paused = null; }
  paintCountdown();
};
cdQ('#cdRestart').onclick = () => { if (countdown.on) { countdown.endAt = performance.now() + countdown.seconds * 1000; countdown.paused = null; countdown.finished = false; log('Regressiva reiniciada'); paintCountdown(); } };

function paintCountdown() {
  const left = remaining(), air = cdQ('#cdAir');
  air.setAttribute('aria-pressed', String(countdown.on));
  air.textContent = countdown.on ? (countdown.paused !== null ? 'PAUSADA · ' : 'NO AR · ') + formatClock(left) : 'AO AR · ' + formatClock(countdown.seconds);
  air.title = countdown.on ? 'Retirar a regressiva do AR' : 'Colocar a regressiva no AR e começar a contar';
  const pause = cdQ('#cdPause'); pause.disabled = !countdown.on || countdown.finished; pause.textContent = countdown.paused !== null ? '▶' : '❚❚';
  pause.setAttribute('aria-label', countdown.paused !== null ? 'Continuar a regressiva' : 'Pausar a regressiva'); pause.title = countdown.paused !== null ? 'Continuar' : 'Pausar';
  cdQ('#cdRestart').disabled = !countdown.on;
  for (const id of ['#cdTime', '#cdMinus', '#cdPlus']) cdQ(id).disabled = countdown.on;
  if (document.activeElement !== cdQ('#cdTime')) cdQ('#cdTime').value = formatClock(countdown.seconds);
  cdRow.dataset.state = !countdown.on ? 'off' : countdown.finished ? 'done' : left <= 10 ? 'last' : 'on';
}

/* ---------- página GC e efeitos: estilo da regressiva ---------- */
const cdCard = rundownEl('section', 'fx-card cd-card');
cdCard.innerHTML = '<h3>Regressiva</h3><p class="cd-help">O botão <b>REGRESSIVA</b> fica em <b>Comandos</b> e entra direto no AR; o tempo se ajusta com duplo clique nele. Estes ajustes valem na hora, inclusive com a regressiva no AR.</p>' +
  '<label>Texto acima dos números<input id="cdTitle" maxlength="60" placeholder="Ex.: Começamos em"></label>' +
  '<label>Estilo<select id="cdStyle"><option value="full">Tela cheia · abertura (imagem do PGM escurecida ao fundo)</option><option value="corner">No canto · relógio compacto</option></select></label>' +
  '<label>Canto<select id="cdCorner">' + corners + '</select></label>' +
  '<label>Ao zerar<select id="cdEnd"><option value="hold">Manter 00:00 no AR até retirar</option><option value="hide">Sair do AR sozinha</option><option value="cut">Sair do AR e cortar para o Preview (CUT)</option></select></label>' +
  '<div class="fx-colors"><label>Números e texto<input id="cdColor" type="color"></label><label>Destaque (barra e últimos 10 s)<input id="cdAccent" type="color"></label></div>' +
  '<small>Na saída 9:16 com recorte, prefira Tela cheia: o canto pode ficar fora do recorte vertical.</small>';
$('.effects-editor').append(cdCard);
function loadCdForm() { $('#cdTitle').value = countdown.title; $('#cdStyle').value = countdown.style; $('#cdCorner').value = countdown.corner; $('#cdEnd').value = countdown.end; $('#cdColor').value = countdown.color; $('#cdAccent').value = countdown.accent; $('#cdCorner').closest('label').hidden = countdown.style !== 'corner'; }
loadCdForm();
cdCard.addEventListener('input', () => {
  countdown.title = $('#cdTitle').value; countdown.style = $('#cdStyle').value === 'corner' ? 'corner' : 'full'; countdown.corner = $('#cdCorner').value;
  countdown.end = ['hold', 'hide', 'cut'].includes($('#cdEnd').value) ? $('#cdEnd').value : 'hold'; countdown.color = $('#cdColor').value; countdown.accent = $('#cdAccent').value;
  $('#cdCorner').closest('label').hidden = countdown.style !== 'corner'; saveCountdown();
});
const inspectCountdown = () => { inspecting = 'countdown'; $('#fxInspectLabel').textContent = 'Regressiva em edição'; };
for (const type of ['focusin', 'pointerdown', 'input']) cdCard.addEventListener(type, inspectCountdown);

/* ---------- reprodutores de vídeo (VT e vinheta) ---------- */
// Cada reprodutor alimenta uma fonte. Começa quando a fonte entra no AR, para quando sai, e segue a transição no áudio.
const players = new Map();
function makePlayer(source, label) {
  const p = { source, label, item: null, running: false, end: 'return', transition: 'mix', loop: false, audio: true, volume: .9, gain: null, analyser: null, onEnd: null };
  players.set(source, p);
  return p;
}
const vtPlayer = makePlayer(VT_SOURCE, 'VT'), vinhetaPlayer = makePlayer(VINHETA_SOURCE, 'VINHETA');

function loadClip(file, onReady) {
  if (!/^video\//.test(file.type) && !/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) return null;
  const el = document.createElement('video'); el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
  const item = { id: Math.random().toString(36).slice(2, 9), name: file.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(file), el, duration: 0, error: '', played: false, node: null };
  el.addEventListener('loadedmetadata', () => { item.duration = el.duration; onReady?.(); });
  el.addEventListener('error', () => { item.error = 'formato não suportado'; onReady?.(); });
  el.src = item.url;
  return item;
}
function freeClip(item) { if (!item) return; URL.revokeObjectURL(item.url); item.el.removeAttribute('src'); item.el.load(); }

async function connectAudio(p, item) {
  try {
    const ac = await audioMixer.enable();
    if (!p.gain) { p.gain = ac.createGain(); p.analyser = ac.createAnalyser(); p.analyser.fftSize = 512; p.gain.gain.value = 0; p.gain.connect(p.analyser).connect(audioMixer.master); }
    if (!item.node) { item.node = ac.createMediaElementSource(item.el); item.node.connect(p.gain); }
    item.el.muted = false; return true;
  } catch (e) { item.el.muted = true; log(p.label + ' sem áudio no programa: ' + e.message); return false; }
}
// Peso no programa, como o AFV de uma câmera: 1 no AR, cruza durante o AUTO, 0 fora.
const weight = source => state.pgm === source ? 1 - state.progress : state.prv === source ? state.progress : 0;
const entering = source => state.pgm === source || (state.prv === source && (state.progress > 0 || state.busy));

async function startPlayer(p) {
  const item = p.item; if (!item || item.error) return;
  p.running = true; p.paused = false; item.played = true;
  await connectAudio(p, item);
  item.el.currentTime = item.startAt > 0 && item.startAt < (item.duration || Infinity) ? item.startAt : 0; item.startAt = 0; item.el.loop = !!p.loop;
  try { await item.el.play(); } catch (e) { p.running = false; log(p.label + ' não iniciou: ' + e.message); return; }
  sources[p.source] = p.label + ' · ' + item.name;
  log(p.label + ' no AR: ' + item.name); audit('info', p.label.toLowerCase() + '-no-ar', p.label + ' no AR: ' + item.name, { duracao: Math.round(item.duration || 0) });
}
function stopPlayer(p) {
  if (!p.running) return;
  const el = p.item?.el, finished = !!el && (el.ended || (p.item.duration > 0 && el.currentTime >= p.item.duration - 0.3));
  p.running = false; p.paused = false; el?.pause();
  if (el) el.currentTime = 0;
  p.onStop?.(finished);
}
// Ao terminar no AR: volta para a câmera que está no PREVIEW (a que estava no AR antes do VT), dispara o próximo ou congela.
function playerEnded(p) {
  if (!p.running || state.pgm !== p.source || p.loop) return;
  if (p.end === 'hold') { log(p.label + ' terminou: último quadro congelado no AR'); return; }
  if (p.onEnd?.()) return;
  if (state.busy || state.progress > 0) return;
  log(p.label + ' terminou: voltando para ' + sources[state.prv]);
  if (p.transition === 'cut') cut(); else auto();
}
// Relógio dos reprodutores (não depende do desenho da tela, funciona com a janela minimizada).
setInterval(() => {
  for (const p of players.values()) {
    const live = entering(p.source);
    if (live && !p.running && p.item && !p.item.error) startPlayer(p);
    else if (!live && p.running) stopPlayer(p);
    // "Sem áudio" (opção da vinheta): o vídeo toca normalmente, mas o som dela não entra no programa.
    if (p.gain && audioMixer.context) p.gain.gain.setTargetAtTime(p.running && p.audio !== false ? p.volume * weight(p.source) : 0, audioMixer.context.currentTime, .015);
    if (p.running && p.item?.el.ended) playerEnded(p);
  }
  paintVTClock(); paintCountdown();
}, 50);
// Regressiva: aplica o que fazer ao zerar.
setInterval(() => {
  if (countdown.on && !countdown.finished && countdown.paused === null && remaining() <= 0) {
    countdown.finished = true; audit('info', 'regressiva-zerou', 'Regressiva zerou', { acao: countdown.end });
    if (countdown.end === 'hide') countdownOff('zerou');
    else if (countdown.end === 'cut') { countdownOff('zerou'); try { cut(); } catch { /* sem corte possível */ } log('Regressiva zerou: CUT para o Preview'); }
    else log('Regressiva zerou: 00:00 continua no AR até ser retirada');
  }
}, 200);

// Desenho da fonte VT/VINHETA nos monitores e no PROGRAM: vídeo inteiro sobre preto, ou um aviso.
function drawPlayer(ctx, w, h, source, clean) {
  const p = players.get(source), el = p?.item?.el;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  if (el && el.videoWidth) { const s = Math.min(w / el.videoWidth, h / el.videoHeight), vw = el.videoWidth * s, vh = el.videoHeight * s; ctx.drawImage(el, (w - vw) / 2, (h - vh) / 2, vw, vh); return; }
  if (clean) return;
  ctx.fillStyle = 'rgba(230, 232, 242, .55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(h * .07) + "px 'Exo 2', 'Segoe UI', sans-serif"; ctx.fillText(p?.label || 'VT', w / 2, h / 2 - h * .05);
  ctx.font = '500 ' + Math.round(h * .04) + "px 'Montserrat', 'Segoe UI', sans-serif"; ctx.fillText(p?.item?.error ? 'Formato não suportado' : 'Nenhum vídeo carregado', w / 2, h / 2 + h * .05);
}

/* ---------- VT · playlist ---------- */
// Sinais dos botões do VT (formas simples, no tamanho do texto).
const ICONS = {
  pause: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><rect x="2" y="1.5" width="2.8" height="9" rx=".6" fill="currentColor"/><rect x="7.2" y="1.5" width="2.8" height="9" rx=".6" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 1.4v9.2L10.4 6z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M1.5 1.6v8.8L7.4 6z" fill="currentColor"/><rect x="8.2" y="1.6" width="2.4" height="8.8" rx=".5" fill="currentColor"/></svg>',
};
// Rótulo com o sinal antes do nome. Só mexe no botão quando muda, para não refazer o desenho a cada tique.
function iconLabel(el, icon, text) {
  const sig = icon + '|' + text; if (el.dataset.label === sig) return; el.dataset.label = sig;
  const span = document.createElement('span'); span.className = 'cmd-ico'; span.innerHTML = ICONS[icon] || '';
  el.replaceChildren(span, document.createTextNode(text));
}
const vt = { items: [], cue: 0, player: vtPlayer };
vtPlayer.end = 'return';
const cueItem = () => vt.items[vt.cue] || null;
function cue(index) {
  vt.cue = Math.max(0, Math.min(vt.items.length - 1, index));
  // Só troca o vídeo do reprodutor quando o VT não está tocando no AR.
  if (!vtPlayer.running) { vtPlayer.item = cueItem(); if (vtPlayer.item) { vtPlayer.item.el.currentTime = 0; sources[VT_SOURCE] = 'VT · ' + vtPlayer.item.name; } else sources[VT_SOURCE] = 'VT'; }
  paintVTList(); try { sync(); } catch { /* antes da mesa pronta */ }
}
// "Disparar o próximo": troca o vídeo sem sair do AR.
vtPlayer.onEnd = () => {
  if (vt.end !== 'next') return false;
  const next = vt.items.indexOf(vtPlayer.item) + 1;
  if (next >= vt.items.length || vt.items[next].error) return false;
  vtPlayer.running = false; vtPlayer.item.el.pause(); vt.cue = next; vtPlayer.item = vt.items[next]; startPlayer(vtPlayer); paintVTList();
  return true;
};
// Saiu do AR: o próximo da lista fica preparado.
vtPlayer.onStop = finished => {
  const at = vt.items.indexOf(vtPlayer.item);
  // Fim normal: a playlist já arma o próximo da lista. VT interrompido (PARAR, CUT ou AUTO antes do fim): nada avança sozinho;
  // o mesmo VT continua armado e o operador arma o próximo à mão (clique na lista ou PRÓXIMO VT).
  if (finished && at >= 0 && at === vt.cue && at < vt.items.length - 1) vt.cue = at + 1;
  if (!finished) log('VT interrompido: ' + (vtPlayer.item?.name || '') + '. Arme o próximo VT manualmente.');
  cue(vt.cue);
};

const vtPanel = rundownEl('section', 'vt-panel'); vtPanel.setAttribute('aria-label', 'VT · playlist');
vtPanel.innerHTML = '<div class="vt-top"><div class="vt-now"><span class="vt-state" id="vtState">VT PARADO</span><strong id="vtTitle">Nenhum VT no AR</strong></div><output class="vt-clock" id="vtClock" aria-live="off">--:--</output></div>' +
  '<div class="vt-bar" id="vtBar" role="slider" tabindex="0" aria-label="Linha do tempo do VT: duplo clique para ir a um ponto" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="vt-track"><i id="vtProgress"></i><s id="vtStartMark" hidden></s></div><span class="vt-hover" id="vtHover" hidden></span></div>' +
  '<div class="vt-actions"><button type="button" id="vtFire" class="vt-fire">VT → PREVIEW</button><button type="button" id="vtPause" class="vt-pause" disabled><span class="cmd-ico">'+ICONS.pause+'</span>PAUSAR VT</button><button type="button" id="vtStop" class="vt-stop" disabled title="Para o VT, tira do ar e deixa o mesmo VT pronto para começar de novo"><span class="cmd-ico">'+ICONS.stop+'</span>PARAR VT</button><label class="vt-add">+ Adicionar VTs<input id="vtFiles" type="file" accept="video/*" multiple></label></div>' +
  '<ol class="vt-list" id="vtList" aria-label="Playlist de VTs"></ol>' +
  '<div class="vt-options"><label>Ao terminar<select id="vtEnd"><option value="return">Voltar para a câmera</option><option value="next">Disparar o próximo VT</option><option value="hold">Congelar no último quadro</option></select></label><label>Volta com<select id="vtTransition"><option value="mix">AUTO (transição escolhida)</option><option value="cut">CUT seco</option></select></label><label class="vt-vol">Volume do VT<input id="vtVolume" type="range" min="0" max="100" value="90"><meter id="vtMeter" min="0" max="1" value="0" aria-label="Nível do áudio do VT"></meter></label></div>' +
  '<p class="vt-note">Arraste vídeos para cá ou use Adicionar VTs (MP4 H.264 ou WebM). Clique num VT para deixá-lo como próximo e em <b>VT → PREVIEW</b> (ou no comando VT). Ele começa a tocar quando você leva ao AR com CUT ou AUTO e, no fim, a mesa volta sozinha para a câmera que estava no AR e já arma o próximo da lista. Se o VT for interrompido (PARAR, CUT ou AUTO antes do fim), nada avança sozinho: arme o próximo na lista ou com PRÓXIMO VT. Os arquivos ficam carregados enquanto a mesa estiver aberta.</p>';
operation.append(vtPanel);

function addFiles(files) {
  let added = 0;
  for (const file of files) {
    const item = loadClip(file, () => paintVTList());
    if (!item) { log('VT ignorado (não é vídeo): ' + file.name); continue; }
    vt.items.push(item); added++;
  }
  if (added) { log(added + ' VT(s) na playlist'); audit('info', 'vt-adicionado', added + ' VT(s) adicionados à playlist'); cue(vt.items.length === added ? 0 : vt.cue); }
  paintVTList();
}
$('#vtFiles').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
vtPanel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); vtPanel.classList.add('dropping'); } });
vtPanel.addEventListener('dragleave', () => vtPanel.classList.remove('dropping'));
vtPanel.addEventListener('drop', e => { e.preventDefault(); vtPanel.classList.remove('dropping'); addFiles([...(e.dataTransfer?.files || [])]); });

function paintVTList() {
  const list = $('#vtList'); list.replaceChildren();
  vt.cue = Math.min(vt.cue, Math.max(0, vt.items.length - 1));
  vt.items.forEach((item, i) => {
    const li = rundownEl('li', 'vt-item'), onAir = vtPlayer.running && vtPlayer.item === item;
    li.dataset.state = onAir ? 'air' : i === vt.cue ? 'cue' : item.error ? 'error' : item.played ? 'played' : 'ready';
    const pick = rundownEl('button', 'vt-pick'); pick.type = 'button';
    pick.append(rundownEl('b', '', String(i + 1)), rundownEl('span', 'vt-name', item.name), rundownEl('span', 'vt-tag', onAir ? 'NO AR' : item.error ? item.error : i === vt.cue ? 'PRÓXIMO' : item.played ? 'exibido' : ''), rundownEl('time', '', item.duration ? formatClock(Math.round(item.duration)) : '--:--'));
    pick.setAttribute('aria-label', 'VT ' + (i + 1) + ': ' + item.name + (i === vt.cue ? ', próximo' : '') + (onAir ? ', no ar' : ''));
    pick.onclick = () => cue(i);
    pick.ondblclick = () => { cue(i); vtToPreview(); };
    const up = rundownEl('button', 'vt-move', '↑'), down = rundownEl('button', 'vt-move', '↓'), del = rundownEl('button', 'vt-del', '✕');
    for (const b of [up, down, del]) b.type = 'button';
    up.setAttribute('aria-label', 'Subir ' + item.name); down.setAttribute('aria-label', 'Descer ' + item.name); del.setAttribute('aria-label', 'Remover ' + item.name);
    up.disabled = i === 0; down.disabled = i === vt.items.length - 1; del.disabled = onAir;
    up.onclick = () => moveVT(i, -1); down.onclick = () => moveVT(i, 1);
    del.onclick = () => { if (onAir) return; freeClip(item); vt.items.splice(i, 1); if (vtPlayer.item === item) vtPlayer.item = null; cue(vt.cue > i ? vt.cue - 1 : vt.cue); };
    li.append(pick, up, down, del); list.append(li);
  });
  if (!vt.items.length) list.append(rundownEl('li', 'vt-empty', 'Playlist vazia. Adicione os VTs do programa.'));
  $('#vtFire').disabled = !vt.items.length || !!cueItem()?.error;
}
function moveVT(i, dir) { const j = i + dir; if (j < 0 || j >= vt.items.length) return; const cued = cueItem(); [vt.items[i], vt.items[j]] = [vt.items[j], vt.items[i]]; vt.cue = vt.items.indexOf(cued); paintVTList(); }

// Comando VT: coloca o VT (o próximo da lista) no PREVIEW. Quem leva ao AR é o CUT/AUTO.
function vtToPreview() {
  if (!vt.items.length) { log('VT: adicione vídeos na playlist (painel VT · Playlist).'); return false; }
  if (!vtPlayer.running) cue(vt.cue);
  audioMixer.enable().catch(() => {});
  select('prv', VT_SOURCE); return true;
}
// Comando VT PRÓXIMO: dispara o próximo VT da playlist sem abrir o painel.
// Com um VT tocando no AR, troca já para o seguinte (sem sair do AR); sem VT no AR, leva o próximo ao PREVIEW, como o botão VT.
function vtNext() {
  if (!vt.items.length) { log('VT: adicione vídeos na playlist (painel VT · Playlist).'); return false; }
  if (!(state.pgm === VT_SOURCE && vtPlayer.running)) {
    // Sem VT no AR: arma o VT seguinte ao armado agora. Quem leva ao PREVIEW é o botão VT.
    if (vt.cue >= vt.items.length - 1) { log('VT: o armado já é o último da playlist.'); return false; }
    cue(vt.cue + 1); log('VT armado: ' + (cueItem()?.name || '')); return true;
  }
  const next = vt.items.indexOf(vtPlayer.item) + 1, item = vt.items[next];
  if (!item) { log('VT: este é o último da playlist.'); return false; }
  if (item.error) { log('VT: o próximo ("' + item.name + '") não pode ser exibido: ' + item.error); return false; }
  vtPlayer.running = false; vtPlayer.item.el.pause(); vt.cue = next; vtPlayer.item = item; startPlayer(vtPlayer); paintVTList();
  audit('info', 'vt-proximo', 'VT PRÓXIMO disparado: ' + item.name); return true;
}
// Texto do botão: qual VT será disparado (e a posição na playlist).
function vtNextLabel() {
  if (!vt.items.length) return 'playlist vazia';
  const onAir = state.pgm === VT_SOURCE && vtPlayer.running, at = (onAir ? vt.items.indexOf(vtPlayer.item) : vt.cue) + 1, item = vt.items[at];
  if (!item) return 'último VT';
  return (onAir ? '' : 'armar ') + (at + 1) + '/' + vt.items.length + ' · ' + item.name;
}
function vtOff() { if (state.pgm === VT_SOURCE && !state.busy && state.progress === 0) { if (vtPlayer.transition === 'cut') cut(); else auto(); return true; } return false; }
// PAUSAR / CONTINUAR: congela o VT no AR (imagem parada e sem som) e retoma do mesmo ponto.
function vtPause() {
  if (!(vtPlayer.running && vtPlayer.item)) { log('VT: nenhum VT tocando para pausar.'); return false; }
  const el = vtPlayer.item.el;
  if (vtPlayer.paused) { vtPlayer.paused = false; Promise.resolve(el.play()).catch(e => { vtPlayer.paused = true; log('VT não continuou: ' + e.message); }); audit('info', 'vt-continuar', 'VT continuado: ' + vtPlayer.item.name); }
  else { vtPlayer.paused = true; el.pause(); audit('info', 'vt-pausa', 'VT pausado: ' + vtPlayer.item.name); }
  return true;
}
// PARAR: tira o VT do ar (com a transição de volta configurada). Como todo VT interrompido, ele continua armado.
function vtStop() {
  if (state.pgm !== VT_SOURCE || !vtPlayer.item) { log('VT: nenhum VT no AR para parar.'); return false; }
  const item = vtPlayer.item; if (!vtOff()) { log('VT: espere a transição terminar para parar o VT.'); return false; }
  audit('info', 'vt-parar', 'VT parado: ' + item.name); return true;
}
$('#vtFire').onclick = () => vtToPreview();
$('#vtPause').onclick = () => vtPause();
$('#vtStop').onclick = () => vtStop();
$('#vtEnd').onchange = e => { vt.end = e.target.value; vtPlayer.end = e.target.value === 'hold' ? 'hold' : 'return'; };
$('#vtTransition').onchange = e => { vtPlayer.transition = e.target.value === 'cut' ? 'cut' : 'mix'; };
$('#vtVolume').oninput = e => { vtPlayer.volume = Number(e.target.value) / 100; };
vt.end = 'return';

function paintVTClock() {
  const item = vtPlayer.item, el = item?.el, cued = cueItem(), air = vtPlayer.running;
  const left = air && item?.duration ? Math.max(0, item.duration - el.currentTime) : 0;
  $('#vtState').textContent = air ? (vtPlayer.paused ? 'VT PAUSADO' : el.ended ? 'VT NO AR · ÚLTIMO QUADRO' : 'VT NO AR') : state.prv === VT_SOURCE ? 'VT NO PREVIEW' : 'VT PARADO';
  $('#vtTitle').textContent = air ? item.name : cued ? 'Próximo: ' + cued.name : 'Nenhum VT na playlist';
  $('#vtClock').textContent = air ? '−' + formatClock(left) : cued?.duration ? formatClock(Math.round(cued.duration)) : '--:--';
  const pos = air && item.duration ? Math.min(100, el.currentTime / item.duration * 100) : 0;
  $('#vtProgress').style.width = pos + '%'; $('#vtBar').setAttribute('aria-valuenow', String(Math.round(pos)));
  // VT armado com ponto de início escolhido na linha do tempo: marca e relógio mostram de onde ele vai começar.
  const mark = $('#vtStartMark'), start = !air && cued?.startAt > 0 && cued.duration ? cued.startAt : 0;
  mark.hidden = !start; if (start) { mark.style.left = (start / cued.duration * 100) + '%'; $('#vtClock').textContent = '▸' + formatClock(Math.round(start)); }
  vtPanel.dataset.state = air ? (left <= 10 ? 'last' : 'air') : state.prv === VT_SOURCE ? 'prv' : 'idle';
  $('#vtStop').disabled = !(state.pgm === VT_SOURCE);
  $('#vtPause').disabled = !air; iconLabel($('#vtPause'), vtPlayer.paused ? 'play' : 'pause', vtPlayer.paused ? 'CONTINUAR VT' : 'PAUSAR VT');
  if (vtPlayer.analyser && audioMixer.context) $('#vtMeter').value = meterValue(vtPlayer.analyser);
}
paintVTList(); paintCountdown();

// Linha do tempo do VT: um clique não faz nada (evita mexer no AR sem querer); DOIS CLIQUES no ponto desejado levam o VT até ali.
// Com o VT no AR ele salta na hora; com o VT armado (fora do AR) ele passa a começar daquele ponto.
const vtBar = $('#vtBar'), vtHover = $('#vtHover');
const barTarget = () => vtPlayer.running ? vtPlayer.item : cueItem();
const barTime = e => { const r = vtBar.querySelector('.vt-track').getBoundingClientRect(), it = barTarget(); if (!it?.duration || !r.width) return null; return Math.min(it.duration - 0.25, Math.max(0, (e.clientX - r.left) / r.width * it.duration)); };
function vtSeek(t) {
  const it = barTarget(); if (!it?.duration || !(t >= 0)) return false;
  t = Math.min(it.duration - 0.25, Math.max(0, t));
  if (vtPlayer.running) {
    const el = it.el, wasEnded = el.ended; el.currentTime = t;
    if (wasEnded && !vtPlayer.paused) Promise.resolve(el.play()).catch(() => {});
    log('VT no AR: foi para ' + formatClock(Math.round(t)) + ' (' + it.name + ')'); audit('info', 'vt-posicao', 'VT levado a ' + formatClock(Math.round(t)), { vt: it.name, segundos: Math.round(t) });
  } else { it.startAt = t; log('VT armado começa em ' + formatClock(Math.round(t)) + ' (' + it.name + ')'); }
  paintVTClock(); return true;
}
vtBar.addEventListener('mousemove', e => { const t = barTime(e); if (t === null) { vtHover.hidden = true; return; } const r = vtBar.getBoundingClientRect(); vtHover.hidden = false; vtHover.textContent = formatClock(Math.round(t)) + ' · duplo clique'; vtHover.style.left = Math.min(r.width - 40, Math.max(40, e.clientX - r.left)) + 'px'; });
vtBar.addEventListener('mouseleave', () => { vtHover.hidden = true; });
vtBar.addEventListener('click', e => { if (e.detail === 1) { vtBar.classList.remove('vt-hint'); void vtBar.offsetWidth; vtBar.classList.add('vt-hint'); } });
vtBar.addEventListener('dblclick', e => { e.preventDefault(); const t = barTime(e); if (t !== null && vtSeek(t)) { vtBar.classList.remove('vt-hint', 'vt-jump'); void vtBar.offsetWidth; vtBar.classList.add('vt-jump'); } });
vtBar.addEventListener('keydown', e => { const it = barTarget(); if (!it?.duration || !['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const now = vtPlayer.running ? it.el.currentTime : it.startAt || 0; vtSeek(e.key === 'Home' ? 0 : now + (e.key === 'ArrowLeft' ? -5 : 5)); });

/* ---------- vinheta ---------- */
const vinheta = { player: vinhetaPlayer };
function setVinheta(file) {
  const item = loadClip(file, () => window.andromedaCommands?.paint());
  if (!item) { log('Vinheta: escolha um arquivo de vídeo.'); return false; }
  if (vinhetaPlayer.running) { log('Vinheta no AR: troque o arquivo depois que ela sair.'); freeClip(item); return false; }
  freeClip(vinhetaPlayer.item); vinhetaPlayer.item = item; sources[VINHETA_SOURCE] = 'VINHETA · ' + item.name;
  log('Vinheta carregada: ' + item.name); try { sync(); } catch { /* antes da mesa pronta */ }
  return true;
}
// Loop: a vinheta repete direto, sem fim, até o operador tirá-la do AR. Vale na hora, mesmo com ela no ar.
function setVinhetaLoop(on) {
  vinhetaPlayer.loop = !!on; if (vinhetaPlayer.item) vinhetaPlayer.item.el.loop = vinhetaPlayer.loop;
  try { localStorage.setItem('andromeda.vinheta.loop.v1', JSON.stringify(vinhetaPlayer.loop)); } catch { /* sem armazenamento */ }
  log(vinhetaPlayer.loop ? 'Vinheta em LOOP: repete até sair do AR' : 'Vinheta sem loop: toca uma vez');
  window.andromedaCommands?.paint();
}
try { vinhetaPlayer.loop = JSON.parse(localStorage.getItem('andromeda.vinheta.loop.v1')) === true; } catch { /* sem armazenamento */ }
// Com áudio (padrão) ou sem áudio: vale na hora, mesmo com a vinheta no ar, e fica salvo.
function setVinhetaAudio(on) {
  vinhetaPlayer.audio = on !== false;
  try { localStorage.setItem('andromeda.vinheta.audio.v1', JSON.stringify(vinhetaPlayer.audio)); } catch { /* sem armazenamento */ }
  log(vinhetaPlayer.audio ? 'Vinheta COM áudio' : 'Vinheta SEM áudio: o vídeo toca e o som não entra no programa');
  window.andromedaCommands?.paint();
}
try { vinhetaPlayer.audio = JSON.parse(localStorage.getItem('andromeda.vinheta.audio.v1')) !== false; } catch { /* sem armazenamento */ }
function vinhetaToPreview() {
  if (!vinhetaPlayer.item) { log('Vinheta: carregue o vídeo com duplo clique em VINHETA.'); return false; }
  audioMixer.enable().catch(() => {}); vinhetaPlayer.item.el.currentTime = 0;
  select('prv', VINHETA_SOURCE); return true;
}

/* ---------- BLACK (fade to black) e BARRAS ---------- */
const black = { on: false, alpha: 0, seconds: .5, from: 0, to: 0, start: 0 };
function toggleBlack(force) {
  const on = typeof force === 'boolean' ? force : !black.on;
  Object.assign(black, { on, from: black.alpha, to: on ? 1 : 0, start: performance.now() });
  log(on ? 'BLACK: saída indo para o preto' : 'BLACK: saída voltando'); audit('info', on ? 'black-no-ar' : 'black-fora', on ? 'Fade to black' : 'Saída do preto');
}
const bars = { on: false, tone: false, osc: null, gain: null };
function toggleBars(force) {
  bars.on = typeof force === 'boolean' ? force : !bars.on;
  syncTone();
  log(bars.on ? 'BARRAS no AR' + (bars.tone ? ' com tom de 1 kHz' : '') : 'BARRAS fora do AR'); audit('info', bars.on ? 'barras-no-ar' : 'barras-fora', bars.on ? 'Barras de cor no AR' : 'Barras de cor fora do AR');
}
async function syncTone() {
  const want = bars.on && bars.tone;
  if (want && !bars.osc) {
    try {
      const ac = await audioMixer.enable();
      // Tom de referência: 1 kHz a −18 dBFS (alinhamento usual de broadcast).
      bars.osc = ac.createOscillator(); bars.osc.frequency.value = 1000; bars.gain = ac.createGain(); bars.gain.gain.value = Math.pow(10, -18 / 20);
      bars.osc.connect(bars.gain).connect(audioMixer.master); bars.osc.start();
    } catch (e) { log('Tom de 1 kHz indisponível: ' + e.message); }
  } else if (!want && bars.osc) { try { bars.osc.stop(); bars.osc.disconnect(); bars.gain.disconnect(); } catch { /* já parado */ } bars.osc = null; bars.gain = null; }
}
function drawBars(ctx, W, H) {
  // Barras SMPTE simplificadas, 75%: as sete cores, a faixa de retorno e a base com preto, branco e PLUGE.
  const top = ['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf'], mid = ['#0000bf', '#131313', '#bf00bf', '#131313', '#00bfbf', '#131313', '#bfbfbf'];
  const bw = W / 7, h1 = H * .67, h2 = H * .08;
  top.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw), h1); });
  mid.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), h1, Math.ceil(bw), h2); });
  const y = h1 + h2, h3 = H - y, cell = W / 6;
  [['#00214c', 1], ['#ffffff', 1], ['#32006a', 1], ['#131313', 1.5], ['#090909', .5], ['#1d1d1d', .5], ['#131313', .5]].reduce((x, [c, wdt]) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(x), y, Math.ceil(cell * wdt), h3); return x + cell * wdt; }, 0);
}

/* ---------- desenho no PROGRAM (e na prévia dos efeitos) ---------- */
const rundownBaseDrawFx = drawFx;
drawFx = function (ctx, canvas, settings, logo, t) {
  const program = canvas === programOutput, draft = canvas.id === 'fxDraftCanvas';
  rundownBaseDrawFx(ctx, canvas, settings, logo, t);
  if (program && countdown.on) drawCountdown(ctx, canvas.width, canvas.height, remaining());
  else if (draft && (countdown.on || (inspecting === 'countdown' && $('#fxInspect')?.checked))) drawCountdown(ctx, canvas.width, canvas.height, remaining(), true);
  if (!program) return;
  if (bars.on) drawBars(ctx, canvas.width, canvas.height);
  if (black.on || black.alpha > 0) {
    const k = Math.min(1, (performance.now() - black.start) / (black.seconds * 1000)); black.alpha = black.from + (black.to - black.from) * k;
    if (black.alpha > 0) { ctx.save(); ctx.globalAlpha = black.alpha; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  }
};
const rundownBaseInspection = inspectionSettings;
inspectionSettings = function () { return inspecting === 'countdown' ? structuredClone(fx.draft) : rundownBaseInspection(); };

window.andromedaVtOnAir = () => state.pgm === VT_SOURCE || state.pgm === VINHETA_SOURCE;
window.andromedaRundown = { vtSeek, setVinhetaLoop, setVinhetaAudio, countdown, vt, vtPlayer, vinhetaPlayer, players, black, bars, cdRow, parseClock, formatClock, countdownOn, countdownOff, toggleCountdown,
  addFiles, cue, iconLabel, vtToPreview, vtNext, vtNextLabel, vtPause, vtStop, vtOff, setVinheta, vinhetaToPreview, toggleBlack, toggleBars, syncTone, drawPlayer, VT_SOURCE, VINHETA_SOURCE };
