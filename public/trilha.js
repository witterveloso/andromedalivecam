'use strict';
/*
 * TRILHA · música de fundo direto no AR.
 *
 * Uma playlist de músicas (arquivos), links (rádios na internet e arquivos de áudio, pelo serviço local) e entradas de áudio
 * (placa de som, cabo virtual: é por aqui que entra o que toca em Spotify, Apple Music, YouTube Music etc. neste computador).
 * Não passa pelo PREVIEW nem depende da imagem: ligou, entra no AR com FADE IN; desligou, sai com FADE OUT. Entre as faixas
 * há uma troca suave (crossfade). O som entra no mesmo master do AR (vai para a transmissão e a gravação).
 *
 * Plataformas de streaming (Spotify, Apple Music, Deezer, YouTube Music…) não podem ser tocadas direto na mesa: o áudio delas é
 * protegido (DRM) e os termos de uso proíbem transmitir a música ao vivo; além disso a YouTube/Facebook silenciam a live com música
 * sem licença. Por isso a integração é por entrada de áudio (a música toca no aplicativo da plataforma, sob a licença do operador)
 * e por links de rádios e bibliotecas livres de direitos.
 */
(() => {
  const R = window.andromedaRundown; if (!R) return;
  const KEY = 'andromeda.trilha.v1';
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const saved = store.get(KEY, {});
  const settings = { volume: 60, fadeIn: 2, fadeOut: 3, cross: 2, order: 'loop', resume: true, ...(saved.settings || {}) };
  const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba', 'webm', 'mp4', 'aif', 'aiff']);
  const extOf = name => (String(name).match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
  const natural = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
  const baseName = name => String(name).replace(/\.[A-Za-z0-9]+$/, '');
  const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  const tr = { items: [], state: 'off', cur: 0, ac: null, bus: null, analyser: null, decks: [], active: 0, timer: null, crossing: false, uid: 0 };
  const clock = s => (typeof R.formatClock === 'function' ? R.formatClock(Math.max(0, Math.round(s))) : String(Math.round(s)));
  const sessionToken = async () => (typeof liveTx !== 'undefined' && liveTx.session?.token) || (await (await fetch('/api/session', { cache: 'no-store' })).json()).token;

  /* ---------- áudio ---------- */
  function hold(param, t) { if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); } }
  function ramp(param, to, secs) {
    const ac = tr.ac, t = ac.currentTime; hold(param, t);
    if (secs > 0.01) { param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(to, t + secs); } else param.setValueAtTime(to, t);
  }
  async function ensureGraph() {
    if (tr.bus && tr.ac.state !== 'closed') { if (tr.ac.state === 'suspended') await audioMixer.enable(); return; }
    const ac = await audioMixer.enable(); tr.ac = ac;
    tr.bus = ac.createGain(); tr.bus.gain.value = 0; tr.analyser = ac.createAnalyser(); tr.analyser.fftSize = 512; tr.bus.connect(tr.analyser).connect(audioMixer.master);
    tr.decks = [0, 1].map(() => {
      const el = new Audio(); el.preload = 'auto'; const gain = ac.createGain(); gain.gain.value = 0; gain.connect(tr.bus);
      const deck = { el, gain, node: ac.createMediaElementSource(el), item: null, stream: null, streamNode: null };
      deck.node.connect(gain); el.addEventListener('ended', () => { if (tr.decks[tr.active] === deck && tr.state !== 'off') advance(); });
      el.addEventListener('error', () => { if (deck.item && tr.decks[tr.active] === deck) trackFailed(deck); });
      return deck;
    });
  }
  const target = () => settings.volume / 100;

  /* ---------- faixas ---------- */
  function nameOf(item) { return item.name || (item.kind === 'url' ? item.url : 'Faixa'); }
  async function loadInto(deck, item) {
    releaseDeck(deck); deck.item = item;
    if (item.kind === 'device') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: item.deviceId ? { exact: item.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      deck.stream = stream; deck.streamNode = tr.ac.createMediaStreamSource(stream); deck.streamNode.connect(deck.gain); deck.el.removeAttribute('src'); return;
    }
    if (item.kind === 'url') deck.el.src = '/api/trilha/stream?url=' + encodeURIComponent(item.url) + '&t=' + encodeURIComponent(await sessionToken());
    else deck.el.src = item.objectUrl || (item.objectUrl = URL.createObjectURL(item.file));
    deck.el.currentTime = 0; await deck.el.play();
  }
  function releaseDeck(deck) {
    try { deck.el.pause(); } catch { /* sem áudio */ }
    if (deck.streamNode) { try { deck.streamNode.disconnect(); } catch { /* já solto */ } deck.streamNode = null; }
    if (deck.stream) { deck.stream.getTracks().forEach(t => t.stop()); deck.stream = null; }
    deck.item = null;
  }
  // Toca a faixa `index` no deck livre. mode: 'in' (liga a trilha: fade in do bus), 'cross' (troca suave entre faixas) ou 'cue'.
  async function playIndex(index, mode) {
    const item = tr.items[index]; if (!item) return false;
    await ensureGraph();
    const old = tr.decks[tr.active], deck = mode === 'in' ? tr.decks[tr.active] : tr.decks[1 - tr.active];
    tr.crossing = true;
    try {
      await loadInto(deck, item);
    } catch (e) { item.error = e?.name === 'NotAllowedError' && item.kind === 'device' ? 'O navegador não liberou a entrada de áudio.' : e?.name === 'NotFoundError' ? 'Entrada de áudio não encontrada.' : item.kind === 'url' ? 'Não foi possível tocar este link.' : e?.name === 'NotSupportedError' ? 'Formato de áudio não suportado.' : 'Não foi possível tocar esta faixa.'; if (item.kind === 'url') explain(item); tr.crossing = false; log('Trilha: ' + nameOf(item) + ' — ' + item.error); paint(); return false; }
    item.error = ''; tr.cur = index; tr.active = tr.decks.indexOf(deck);
    const secs = mode === 'cross' ? Math.max(0, settings.cross) : 0;
    ramp(deck.gain.gain, 1, secs);
    if (old !== deck && old.item) { ramp(old.gain.gain, 0, secs); const gone = old; setTimeout(() => { if (tr.decks[tr.active] !== gone) releaseDeck(gone); }, secs * 1000 + 120); }
    setTimeout(() => { tr.crossing = false; }, secs * 1000 + 50);
    audit('info', 'trilha-faixa', nameOf(item)); paint(); return true;
  }
  function nextIndex(from = tr.cur) {
    const n = tr.items.length; if (!n) return -1;
    if (settings.order === 'shuffle') { if (n === 1) return 0; let i; do { i = Math.floor(Math.random() * n); } while (i === from); return i; }
    if (from + 1 < n) return from + 1;
    return settings.order === 'once' ? -1 : 0;
  }
  function advance() {
    if (tr.state === 'off' || tr.state === 'out' || tr.crossing) return;
    const i = nextIndex(); if (i < 0) { finishNow(); return; }
    playIndex(i, 'cross');
  }
  function trackFailed(deck) {
    const item = deck.item; if (!item || item.error) return;
    item.error = 'Não foi possível tocar esta faixa.'; explain(item); log('Trilha: ' + nameOf(item) + ' — não foi possível tocar; passando para a próxima.');
    const i = nextIndex(); const alive = tr.items.some(x => !x.error);
    if (i >= 0 && alive && tr.state !== 'off') playIndex(i, tr.state === 'in' || tr.state === 'on' ? 'cross' : 'cue'); else if (!alive) finishNow(); paint();
  }
  async function explain(item) { // o serviço diz por que o link falhou (não é áudio, rádio fora do ar, endereço bloqueado…)
    if (item.kind !== 'url') return;
    try { const r = await fetch('/api/trilha/stream?url=' + encodeURIComponent(item.url) + '&t=' + encodeURIComponent(await sessionToken()), { headers: { Range: 'bytes=0-0' } }); if (!r.ok && /json/.test(r.headers.get('content-type') || '')) item.error = (await r.json()).error || item.error; else await r.body?.cancel(); } catch { /* sem detalhe */ }
    paint();
  }

  /* ---------- ligar e desligar ---------- */
  function openPanel() { openWorkspace('operation'); const p = $('[data-tool=trilha]'); p?.scrollIntoView({ block: 'center', behavior: 'smooth' }); p?.classList.add('flash'); setTimeout(() => p?.classList.remove('flash'), 1600); }
  async function start() {
    if (tr.state === 'in' || tr.state === 'on') return true;
    if (!tr.items.some(x => !x.error)) { log('Trilha: adicione músicas ou um link primeiro.'); openPanel(); return false; }
    await ensureGraph(); clearTimeout(tr.timer);
    const was = tr.state; tr.state = 'in';
    const deck = tr.decks[tr.active], resumable = settings.resume && deck.item && deck.el.paused === false || (settings.resume && deck.item && deck.el.src);
    if (was === 'out' && deck.item) { /* voltando de um fade out: a música não parou */ }
    else if (resumable && deck.item && deck.item.kind !== 'device') { try { await deck.el.play(); } catch { await playIndex(tr.cur, 'in'); } }
    else { let i = tr.items[tr.cur] && !tr.items[tr.cur].error ? tr.cur : tr.items.findIndex(x => !x.error); if (i < 0) { tr.state = 'off'; return false; } if (!await playIndex(i, 'in')) { const j = nextIndex(); if (j < 0 || !await playIndex(j, 'in')) { tr.state = 'off'; paint(); return false; } } }
    ramp(tr.bus.gain, target(), settings.fadeIn);
    tr.timer = setTimeout(() => { if (tr.state === 'in') tr.state = 'on'; paint(); }, settings.fadeIn * 1000 + 50);
    log('Trilha no AR (fade in ' + settings.fadeIn + ' s).'); audit('info', 'trilha-ligada', 'Trilha ligada'); paint(); return true;
  }
  function finishNow() {
    clearTimeout(tr.timer); tr.state = 'off';
    for (const d of tr.decks) { if (!settings.resume || d.item?.kind === 'device') releaseDeck(d); else try { d.el.pause(); } catch { /* sem áudio */ } }
    if (tr.bus) ramp(tr.bus.gain, 0, 0); paint();
  }
  function stop() {
    if (tr.state === 'off' || tr.state === 'out') return false;
    clearTimeout(tr.timer); tr.state = 'out'; ramp(tr.bus.gain, 0, settings.fadeOut);
    tr.timer = setTimeout(() => { if (tr.state === 'out') finishNow(); }, settings.fadeOut * 1000 + 60);
    log('Trilha saindo do AR (fade out ' + settings.fadeOut + ' s).'); audit('info', 'trilha-desligada', 'Trilha desligada'); paint(); return true;
  }
  const toggle = () => (tr.state === 'in' || tr.state === 'on' ? stop() : start());
  function go(i) { // ligada: troca suave para a faixa; desligada: só deixa a faixa pronta para começar
    if (i < 0 || i >= tr.items.length) return false;
    if (tr.state === 'in' || tr.state === 'on') return playIndex(i, 'cross');
    tr.cur = i; for (const d of tr.decks) releaseDeck(d); paint(); return true;
  }
  const next = () => { const i = nextIndex(); return i < 0 ? (log('Trilha: fim da lista.'), false) : go(i); };
  const prev = () => { const n = tr.items.length; if (!n) return false; const d = tr.decks[tr.active]; if (d?.item && d.el.currentTime > 4 && tr.state !== 'off') { d.el.currentTime = 0; return true; } return go((tr.cur - 1 + n) % n); };

  /* ---------- playlist ---------- */
  const persist = () => store.set(KEY, { settings, saved: tr.items.filter(i => i.kind !== 'file').map(i => ({ kind: i.kind, name: i.name, url: i.url, deviceId: i.deviceId })) });
  function addItem(item) { item.id = ++tr.uid; tr.items.push(item); if (tr.items.length === 1) tr.cur = 0; persist(); paint(); return item; }
  function probeDuration(item) {
    if (item.kind !== 'file') return; const a = new Audio(); a.preload = 'metadata'; a.src = item.objectUrl = URL.createObjectURL(item.file);
    a.addEventListener('loadedmetadata', () => { item.duration = Number.isFinite(a.duration) ? a.duration : 0; paint(); }); a.addEventListener('error', () => { item.error = 'Formato de áudio não suportado.'; paint(); });
  }
  function addFiles(list) {
    const files = [...list || []].filter(f => AUDIO_EXT.has(extOf(f.name)) || /^audio\//.test(f.type)).sort(natural); const skipped = [...list || []].length - files.length;
    for (const f of files) probeDuration(addItem({ kind: 'file', name: baseName(f.name), file: f }));
    if (files.length) { log('Trilha: ' + files.length + (files.length === 1 ? ' música adicionada.' : ' músicas adicionadas.')); audit('info', 'trilha-adicionada', files.length + ' música(s)'); }
    if (skipped > 0) msg(skipped + (skipped === 1 ? ' arquivo ignorado (não é áudio).' : ' arquivos ignorados (não são áudio).')); else msg('');
    return files.length;
  }
  function addLink(url, name) {
    let u; try { u = new URL(String(url).trim()); } catch { msg('Link inválido. Cole um endereço http:// ou https:// de rádio ou de arquivo de áudio.'); return null; }
    if (!['http:', 'https:'].includes(u.protocol)) { msg('Use um link http:// ou https://.'); return null; }
    msg(''); return addItem({ kind: 'url', url: u.href, name: (name || '').trim() || u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 28) : '') });
  }
  function addDevice(deviceId, label) { return addItem({ kind: 'device', deviceId, name: label || 'Entrada de áudio' }); }
  function move(i, d) { const j = i + d; if (j < 0 || j >= tr.items.length) return; const cur = tr.items[tr.cur]; [tr.items[i], tr.items[j]] = [tr.items[j], tr.items[i]]; tr.cur = tr.items.indexOf(cur); persist(); paint(); }
  function remove(i) {
    const item = tr.items[i]; if (!item) return; const playing = tr.state !== 'off' && i === tr.cur;
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); tr.items.splice(i, 1);
    if (playing) { for (const d of tr.decks) if (d.item === item) releaseDeck(d); if (tr.items.length) { tr.cur = Math.min(i, tr.items.length - 1); playIndex(tr.cur, 'in'); } else finishNow(); }
    else if (i < tr.cur) tr.cur--; else if (i === tr.cur) tr.cur = Math.min(tr.cur, Math.max(0, tr.items.length - 1));
    persist(); paint();
  }

  /* ---------- painel ---------- */
  const panel = rundownEl('section', 'trilha-panel'); panel.setAttribute('aria-label', 'Trilha · música de fundo');
  panel.innerHTML =
    '<div class="tr-top"><div class="tr-now"><span class="tr-state" id="trState">TRILHA DESLIGADA</span><strong id="trTitle">Playlist vazia</strong></div><output class="tr-clock" id="trClock" aria-live="off">--:--</output></div>' +
    '<div class="tr-bar" aria-hidden="true"><i id="trProgress"></i></div>' +
    '<div class="tr-actions"><button type="button" id="trToggle" class="tr-toggle">▶ LIGAR TRILHA</button><button type="button" id="trPrev" class="tr-small" title="Faixa anterior">⏮</button><button type="button" id="trNext" class="tr-small" title="Próxima faixa">⏭</button>' +
    '<label class="tr-vol">Volume <input id="trVolume" type="range" min="0" max="100" aria-label="Volume da trilha"><output id="trVolOut"></output><meter id="trMeter" min="0" max="1" value="0" aria-label="Nível da trilha"></meter></label></div>' +
    '<ol class="tr-list" id="trList" aria-label="Playlist da trilha"></ol>' +
    '<p class="tr-msg" id="trMsg" role="status"></p>' +
    '<div class="tr-add"><label class="tr-addfile">+ Adicionar músicas<input id="trFiles" type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.opus,.m4a,.aac,.flac,.weba"></label>' +
    '<span class="tr-link"><input id="trUrl" type="url" placeholder="Link de rádio ou de áudio (http://…)" aria-label="Link de rádio ou de áudio"><button type="button" id="trUrlAdd">+ Link</button></span>' +
    '<span class="tr-dev"><select id="trDevices" aria-label="Entrada de áudio"><option value="">Entrada de áudio…</option></select><button type="button" id="trDevAdd">+ Entrada</button></span></div>' +
    '<div class="tr-options"><label>Fade in (s)<input id="trIn" type="number" min="0" max="30" step="0.5"></label><label>Fade out (s)<input id="trOut" type="number" min="0" max="30" step="0.5"></label><label>Troca entre faixas (s)<input id="trCross" type="number" min="0" max="12" step="0.5"></label>' +
    '<label>Ordem<select id="trOrder"><option value="loop">Em sequência, repetindo</option><option value="shuffle">Aleatória</option><option value="once">Uma vez só</option></select></label><label class="tr-resume"><input id="trResume" type="checkbox"> Continuar de onde parou ao ligar</label></div>' +
    '<p class="tr-note">A trilha entra direto no AR (sem PREVIEW) por cima de qualquer fonte, com <b>fade in</b> ao ligar e <b>fade out</b> ao desligar. Use o botão <b>TRILHA</b> nos Comandos (atalho <b>T</b>) ou o celular. <b>Spotify, Apple Music, Deezer e YouTube Music</b> não podem ser tocados direto na mesa (áudio protegido e termos de uso que proíbem transmitir); toque no aplicativo deles neste computador, envie o som por um <b>cabo virtual</b> (ex.: VB-Cable) ou pela placa de som e adicione a <b>Entrada de áudio</b> aqui, lembrando que a música precisa ter licença para ao vivo. Rádios na internet entram pelo <b>Link</b> (MP3/AAC); bibliotecas livres de direitos (YouTube Audio Library, Pixabay, Free Music Archive) funcionam como arquivos. As músicas adicionadas ficam carregadas enquanto a mesa estiver aberta; links e entradas ficam salvos.</p>';
  operation.append(panel); window.trilhaPanel = panel;
  const $p = s => panel.querySelector(s); const msgEl = $p('#trMsg'); const msg = t => { msgEl.textContent = t; };
  const STATES = { off: 'TRILHA DESLIGADA', in: 'ENTRANDO NO AR…', on: 'TRILHA NO AR', out: 'SAINDO DO AR…' };

  function paint() {
    const air = tr.state === 'in' || tr.state === 'on', item = tr.items[tr.cur];
    panel.dataset.state = tr.state; $p('#trState').textContent = STATES[tr.state];
    $p('#trTitle').textContent = item ? (nameOf(item) + (item.error ? ' — ' + item.error : '')) : 'Playlist vazia';
    const b = $p('#trToggle'); b.textContent = air ? '■ DESLIGAR TRILHA' : tr.state === 'out' ? '▶ VOLTAR COM A TRILHA' : '▶ LIGAR TRILHA'; b.dataset.on = String(air); b.disabled = !tr.items.length;
    $p('#trPrev').disabled = $p('#trNext').disabled = !tr.items.length;
    const list = $p('#trList'); list.replaceChildren();
    if (!tr.items.length) { const li = rundownEl('li', 'tr-empty', 'Adicione músicas, um link de rádio ou uma entrada de áudio. Arraste arquivos para este painel.'); list.append(li); }
    tr.items.forEach((it, i) => {
      const li = rundownEl('li', 'tr-item'); li.dataset.state = i === tr.cur ? (tr.state === 'off' ? 'cue' : 'air') : it.error ? 'error' : 'idle'; li.dataset.kind = it.kind;
      const pick = rundownEl('button', 'tr-pick'); pick.type = 'button'; pick.title = (tr.state === 'off' ? 'Deixar como primeira faixa' : 'Tocar agora, com troca suave') + (it.error ? ' · ' + it.error : '');
      const tag = it.error ? 'ERRO' : i === tr.cur ? (tr.state === 'off' ? 'PRÓXIMA' : 'TOCANDO') : it.kind === 'url' ? 'LINK' : it.kind === 'device' ? 'ENTRADA' : '';
      pick.append(rundownEl('b', '', String(i + 1)), rundownEl('span', 'tr-name', nameOf(it)), rundownEl('span', 'tr-tag', tag), rundownEl('time', '', it.kind === 'file' && it.duration ? clock(it.duration) : it.kind === 'file' ? '' : 'AO VIVO'));
      pick.onclick = () => go(i);
      const up = rundownEl('button', '', '↑'), down = rundownEl('button', '', '↓'), del = rundownEl('button', '', '×'); for (const x of [up, down, del]) x.type = 'button';
      up.setAttribute('aria-label', 'Subir ' + nameOf(it)); down.setAttribute('aria-label', 'Descer ' + nameOf(it)); del.setAttribute('aria-label', 'Remover ' + nameOf(it));
      up.onclick = () => move(i, -1); down.onclick = () => move(i, 1); del.onclick = () => remove(i);
      li.append(pick, up, down, del); list.append(li);
    });
    $p('#trVolOut').textContent = settings.volume + '%';
  }

  const fileInput = $p('#trFiles'); fileInput.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  panel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); panel.classList.add('dropping'); } });
  panel.addEventListener('dragleave', () => panel.classList.remove('dropping'));
  panel.addEventListener('drop', e => { e.preventDefault(); panel.classList.remove('dropping'); addFiles(e.dataTransfer?.files); });
  $p('#trToggle').onclick = () => toggle(); $p('#trNext').onclick = () => next(); $p('#trPrev').onclick = () => prev();
  const addUrl = () => { const it = addLink($p('#trUrl').value); if (it) $p('#trUrl').value = ''; };
  $p('#trUrlAdd').onclick = addUrl; $p('#trUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); addUrl(); } });
  const sel = $p('#trDevices');
  async function loadDevices() {
    try { if (!navigator.mediaDevices?.enumerateDevices) throw Error('sem dispositivos'); let list = await navigator.mediaDevices.enumerateDevices(); if (!list.some(d => d.kind === 'audioinput' && d.label)) { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } catch { /* permissão negada */ } list = await navigator.mediaDevices.enumerateDevices(); }
      sel.replaceChildren(new Option('Entrada de áudio…', '')); for (const d of list.filter(x => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')) sel.add(new Option(d.label || 'Entrada ' + (sel.length), d.deviceId));
    } catch { msg('Não foi possível listar as entradas de áudio.'); }
  }
  sel.addEventListener('focus', () => { if (sel.length <= 1) loadDevices(); }); sel.addEventListener('mousedown', () => { if (sel.length <= 1) loadDevices(); });
  $p('#trDevAdd').onclick = async () => { if (sel.length <= 1) await loadDevices(); if (!sel.value) { msg('Escolha uma entrada de áudio na lista.'); return; } msg(''); addDevice(sel.value, sel.selectedOptions[0].textContent); };
  const bind = (id, key, lo, hi) => { const el = $p(id); el.value = String(settings[key]); el.onchange = () => { settings[key] = clampNum(el.value, lo, hi, settings[key]); el.value = String(settings[key]); persist(); }; };
  bind('#trIn', 'fadeIn', 0, 30); bind('#trOut', 'fadeOut', 0, 30); bind('#trCross', 'cross', 0, 12);
  $p('#trOrder').value = settings.order; $p('#trOrder').onchange = e => { settings.order = e.target.value; persist(); };
  $p('#trResume').checked = !!settings.resume; $p('#trResume').onchange = e => { settings.resume = e.target.checked; persist(); };
  const vol = $p('#trVolume'); vol.value = String(settings.volume);
  vol.oninput = () => { settings.volume = Number(vol.value); $p('#trVolOut').textContent = settings.volume + '%'; if (tr.bus && tr.state === 'on') { hold(tr.bus.gain, tr.ac.currentTime); tr.bus.gain.setTargetAtTime(target(), tr.ac.currentTime, .03); } }; vol.onchange = persist;

  // Relógio, progresso e nível; também decide a hora de começar a troca suave para a próxima faixa.
  setInterval(() => {
    const deck = tr.decks[tr.active], item = deck?.item, d = deck?.el;
    if (tr.analyser) $p('#trMeter').value = meterValue(tr.analyser);
    let clockText = '--:--', pct = 0;
    if (item && d && tr.state !== 'off') {
      if (item.kind !== 'file' && !Number.isFinite(d.duration)) clockText = 'AO VIVO';
      else if (Number.isFinite(d.duration) && d.duration > 0) { clockText = '−' + clock(d.duration - d.currentTime); pct = d.currentTime / d.duration * 100; if (!tr.crossing && (tr.state === 'in' || tr.state === 'on') && d.duration - d.currentTime <= Math.max(settings.cross, 0.05) + 0.05 && tr.items.length) advance(); }
    }
    if ($p('#trClock').textContent !== clockText) $p('#trClock').textContent = clockText; $p('#trProgress').style.width = pct.toFixed(1) + '%';
  }, 250);

  // Restaura links e entradas salvos
  for (const s of saved.saved || []) if (s?.kind === 'url' && s.url) addLink(s.url, s.name); else if (s?.kind === 'device') addDevice(s.deviceId, s.name);
  const info = () => ({ state: tr.state, on: tr.state === 'in' || tr.state === 'on', out: tr.state === 'out', index: tr.cur, total: tr.items.length, name: tr.items[tr.cur] ? nameOf(tr.items[tr.cur]) : '', gain: tr.bus ? tr.bus.gain.value : 0, level: tr.analyser ? meterValue(tr.analyser) : 0 });
  const api = { start, stop, toggle, next, prev, go, addFiles, addLink, addDevice, info, settings, items: tr.items, openPanel, paint };
  Object.assign(R, { trilha: api }); window.andromedaTrilha = api;
  paint();
})();
