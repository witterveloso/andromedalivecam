'use strict';
/*
 * Andromeda Live — transmissão multiplataforma e gravação.
 * O PROGRAM sai uma única vez do navegador; o serviço local codifica uma vez e
 * distribui para todos os destinos ativos e para o arquivo de gravação.
 * As chaves ficam só na memória, a menos que o operador peça para lembrá-las.
 */
(() => {
  const PRESETS = {
    youtube:   { name: 'YouTube',      server: 'rtmps://a.rtmps.youtube.com:443/live2',      help: 'YouTube Studio → Criar → Transmitir ao vivo → Transmissão → Chave de transmissão.' },
    facebook:  { name: 'Facebook',     server: 'rtmps://live-api-s.facebook.com:443/rtmp/',   help: 'Facebook → Vídeo ao vivo → Software de streaming → Chave de stream.' },
    instagram: { name: 'Instagram',    server: 'rtmps://live-upload.instagram.com:443/rtmp/', help: 'Instagram no computador → Criar → Vídeo ao vivo. Copie a URL e a chave (conta profissional). A exibição é vertical: o quadro 16:9 aparece com faixas.' },
    twitch:    { name: 'Twitch',       server: 'rtmp://live.twitch.tv/app',                   help: 'Painel do criador → Configurações → Stream → Chave de transmissão principal.' },
    kick:      { name: 'Kick',         server: '',                                            help: 'Dashboard → Settings → Stream URL & Key. Copie a URL e a chave.' },
    tiktok:    { name: 'TikTok',       server: '',                                            help: 'Disponível para contas com transmissão por software liberada. Copie a URL do servidor e a chave. A exibição é vertical.' },
    linkedin:  { name: 'LinkedIn',     server: '',                                            help: 'Evento ao vivo → transmitir com software (RTMP personalizado). Copie a URL e a chave.' },
    custom:    { name: 'RTMP próprio', server: '',                                            help: 'Qualquer servidor RTMP/RTMPS: informe a URL do servidor e a chave (nome do stream).' },
  };
  const STORE = 'andromeda.broadcast.v1';
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const gb = bytes => bytes == null ? '—' : bytes >= 1e12 ? (bytes / 1e12).toFixed(2) + ' TB' : bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(bytes / 1e6)) + ' MB';

  const model = { destinations: [{ id: uid(), platform: 'youtube', name: 'YouTube', server: PRESETS.youtube.server, key: '', enabled: true }], resolution: '1080p', bitrate: 6, encoder: 'libx264', record: false, dir: '', remember: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && Array.isArray(saved.destinations)) Object.assign(model, saved, { destinations: saved.destinations.filter(d => PRESETS[d.platform]).slice(0, 6).map(d => ({ id: d.id || uid(), platform: d.platform, name: String(d.name || PRESETS[d.platform].name), server: String(d.server || ''), key: saved.remember ? String(d.key || '') : '', enabled: d.enabled !== false })) });
  } catch { /* primeiro uso */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...model, destinations: model.destinations.map(d => ({ ...d, key: model.remember ? d.key : '' })) })); } catch { /* sem armazenamento */ } };
  const live = { states: new Map(), recording: null, recorded: null, storage: null, checked: null };
  window.andromedaBroadcast = { model, live };

  const active = () => model.destinations.filter(d => d.enabled && d.server.trim() && d.key.trim());
  const pending = () => model.destinations.filter(d => d.enabled && !(d.server.trim() && d.key.trim()));

  /* ---------- painel de destinos ---------- */

  const panel = $('.stream-panel'), row = $('.stream-row');
  row.className = 'stream-row broadcast'; row.replaceChildren();
  const list = make('div', 'dest-list'), adder = make('div', 'dest-add'), quality = make('div', 'quality');
  row.append(list, adder, quality);
  const choose = make('select'); choose.id = 'destPlatform'; choose.setAttribute('aria-label', 'Plataforma do novo destino');
  for (const [id, p] of Object.entries(PRESETS)) choose.add(new Option(p.name, id));
  const add = make('button', '', 'Adicionar destino'); add.type = 'button'; add.id = 'destAdd';
  const remember = make('label', 'stage-check'), rememberBox = make('input'); rememberBox.type = 'checkbox'; rememberBox.id = 'destRemember'; rememberBox.checked = model.remember;
  remember.append(rememberBox, 'Lembrar chaves neste computador');
  adder.append(choose, add, remember);
  add.onclick = () => {
    if (model.destinations.length >= 6) { log('Limite de 6 destinos simultâneos'); return; }
    const p = PRESETS[choose.value]; model.destinations.push({ id: uid(), platform: choose.value, name: p.name, server: p.server, key: '', enabled: true });
    save(); render();
  };
  rememberBox.onchange = () => { model.remember = rememberBox.checked; save(); };

  function statusOf(d) {
    const state = live.states.get(d.id);
    if (busyTx() && d.enabled && state) return state.state === 'retrying' ? ['RECONECTANDO', 'bad', state.reason] : state.state === 'sending' ? ['ENVIANDO', 'on', ''] : ['CONECTANDO', 'wait', ''];
    if (!d.enabled) return ['DESLIGADO', 'off', ''];
    if (!d.server.trim() || !d.key.trim()) return ['FALTA ' + (!d.server.trim() ? 'SERVIDOR' : 'CHAVE'), 'wait', ''];
    return ['PRONTO', 'ready', state?.state === 'warning' ? state.reason : ''];
  }
  function paintStatus() {
    for (const card of list.children) {
      const d = model.destinations.find(x => x.id === card.dataset.id); if (!d) continue;
      const [text, tone, detail] = statusOf(d), pill = card.querySelector('.dest-state');
      pill.textContent = text; pill.dataset.tone = tone; card.querySelector('.dest-detail').textContent = detail;
      card.querySelectorAll('input, button, select').forEach(el => { el.disabled = busyTx(); });
    }
    add.disabled = choose.disabled = busyTx() || model.destinations.length >= 6;
    quality.querySelectorAll('select, input').forEach(el => { el.disabled = busyTx(); });
  }
  function render() {
    list.replaceChildren(...model.destinations.map(d => {
      const p = PRESETS[d.platform], card = make('article', 'dest'); card.dataset.id = d.id; card.dataset.platform = d.platform;
      const head = make('header'), badge = make('span', 'dest-badge', p.name.slice(0, 2).toUpperCase()), title = make('input', 'dest-name');
      title.value = d.name; title.maxLength = 40; title.setAttribute('aria-label', 'Nome do destino');
      const toggle = make('label', 'dest-toggle'), box = make('input'); box.type = 'checkbox'; box.checked = d.enabled; toggle.append(box, 'Ativo');
      const pill = make('span', 'dest-state'), remove = make('button', 'dest-remove', 'Remover'); remove.type = 'button';
      head.append(badge, title, pill, toggle, remove);
      const server = make('label', '', 'Servidor (URL RTMP)'), serverInput = make('input'); serverInput.type = 'url'; serverInput.value = d.server; serverInput.placeholder = 'rtmp:// ou rtmps://'; serverInput.spellcheck = false; serverInput.autocomplete = 'off'; server.append(serverInput);
      const key = make('label', '', 'Chave de transmissão'), keyRow = make('span', 'dest-key'), keyInput = make('input'), show = make('button', '', 'Mostrar');
      keyInput.type = 'password'; keyInput.value = d.key; keyInput.autocomplete = 'off'; keyInput.spellcheck = false; keyInput.placeholder = 'Cole a chave da plataforma'; show.type = 'button';
      show.onclick = () => { const reveal = keyInput.type === 'password'; keyInput.type = reveal ? 'text' : 'password'; show.textContent = reveal ? 'Ocultar' : 'Mostrar'; };
      keyRow.append(keyInput, show); key.append(keyRow);
      const fields = make('div', 'dest-fields'); fields.append(server, key);
      card.append(head, fields, make('p', 'dest-help', p.help), make('p', 'dest-detail'));
      title.oninput = () => { d.name = title.value; save(); };
      serverInput.oninput = () => { d.server = serverInput.value; live.states.delete(d.id); save(); paintStatus(); summary(); };
      keyInput.oninput = () => { d.key = keyInput.value.trim(); save(); paintStatus(); summary(); };
      box.onchange = () => { d.enabled = box.checked; save(); paintStatus(); summary(); };
      remove.onclick = () => { model.destinations.splice(model.destinations.indexOf(d), 1); save(); render(); };
      return card;
    }));
    paintStatus(); summary();
  }

  /* ---------- qualidade ---------- */

  const field = (text, control) => { const label = make('label', '', text); label.append(control); return label; };
  const resolution = make('select'); resolution.id = 'txResolution'; for (const r of ['720p', '1080p']) resolution.add(new Option(r + ' · 30 fps', r));
  const bitrate = make('input'); bitrate.id = 'txBitrate'; bitrate.type = 'number'; bitrate.min = 3; bitrate.max = 20; bitrate.step = .5;
  const encoder = make('select'); encoder.id = 'txEncoder'; encoder.add(new Option('Processador (x264)', 'libx264'));
  const upload = make('p', 'quality-note');
  quality.append(field('Resolução', resolution), field('Bitrate de vídeo (Mbps)', bitrate), field('Codificador', encoder), upload);
  resolution.value = model.resolution; bitrate.value = model.bitrate;
  resolution.onchange = () => { model.resolution = resolution.value; save(); summary(); };
  bitrate.onchange = () => { model.bitrate = Math.max(3, Math.min(20, Number(bitrate.value) || 6)); bitrate.value = model.bitrate; save(); summary(); };
  encoder.onchange = () => { model.encoder = encoder.value; save(); };
  const ENCODER_NAMES = { h264_nvenc: 'Placa NVIDIA (NVENC)', h264_qsv: 'Intel Quick Sync', h264_amf: 'Placa AMD (AMF)', h264_videotoolbox: 'Apple VideoToolbox' };
  function offerEncoders(session) {
    for (const id of session?.encoders || []) if (id !== 'libx264' && ![...encoder.options].some(o => o.value === id)) encoder.add(new Option(ENCODER_NAMES[id] || id, id));
    encoder.value = [...encoder.options].some(o => o.value === model.encoder) ? model.encoder : 'libx264';
  }

  /* ---------- gravação ---------- */

  const rec = make('section', 'record-panel');
  rec.innerHTML = '<header><strong>Gravação</strong><label class="stage-check"><input id="recEnable" type="checkbox">Gravar junto com a transmissão</label></header><div class="rec-body"><label>Pasta de gravação<span class="dest-key"><input id="recDir" type="text" spellcheck="false" autocomplete="off" placeholder="Escolha uma unidade abaixo ou digite o caminho completo"><button id="recCheck" type="button">Verificar pasta</button></span></label><div id="recVolumes" class="volumes" aria-label="Unidades detectadas"></div><p id="recStatus" class="quality-note" role="status"></p></div>';
  panel.append(rec);
  const recEnable = $('#recEnable'), recDir = $('#recDir'), recStatus = $('#recStatus');
  recEnable.checked = model.record; recDir.value = model.dir;
  recEnable.onchange = () => { model.record = recEnable.checked; save(); summary(); if (model.record && !model.dir && live.storage) { recDir.value = model.dir = live.storage.defaultDir; save(); checkDir(); } };
  recDir.onchange = () => { model.dir = recDir.value.trim(); live.checked = null; save(); summary(); };
  async function api(path, body) {
    const session = liveTx.session || await checkBridge(); if (!session) throw Error('Serviço local indisponível.');
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': session.token }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await r.json().catch(() => ({})); if (!r.ok) throw Error(data.error || 'Falha no serviço local.'); return data;
  }
  async function checkDir() {
    if (!model.dir) { recStatus.textContent = 'Escolha a pasta de gravação.'; return null; }
    try { live.checked = await api('/api/storage/check', { dir: model.dir }); summary(); return live.checked; }
    catch (e) { live.checked = null; recStatus.textContent = e.message; recStatus.dataset.tone = 'bad'; return null; }
  }
  $('#recCheck').onclick = checkDir;
  const KIND = { removable: 'Removível', disk: 'Disco adicional', system: 'Sistema' };
  async function refreshVolumes() {
    if (document.hidden || busyTx()) return;
    try {
      live.storage = await api('/api/storage');
      $('#recVolumes').replaceChildren(...live.storage.volumes.map(v => {
        const b = make('button', 'volume'); b.type = 'button'; b.dataset.kind = v.kind;
        b.append(make('strong', '', v.label), make('span', '', v.path), make('em', '', KIND[v.kind] + ' · ' + gb(v.free) + ' livres de ' + gb(v.total)));
        const target = v.kind === 'system' ? live.storage.defaultDir : v.path.replace(/[\\/]$/, '') + (v.path.includes('\\') ? '\\' : '/') + 'Andromeda Live';
        b.setAttribute('aria-pressed', String(model.dir === target));
        b.onclick = () => { recDir.value = model.dir = target; save(); refreshVolumes(); checkDir(); };
        return b;
      }));
    } catch { /* serviço fechado: o estado do codificador já avisa */ }
  }

  /* ---------- resumo e botões ---------- */

  const startButton = $('#transmitYouTube'), armButton = $$('.page-toolbar .btn-rec')[0] || $('.btn-rec');
  $$('button').filter(b => b.textContent === 'Configurar YouTube').forEach(b => b.remove());
  armButton.disabled = false; armButton.id = 'recArm';
  armButton.onclick = () => { if (busyTx()) return; recEnable.checked = !recEnable.checked; recEnable.onchange(); };

  function summary() {
    const on = active().length, total = model.bitrate * on;
    upload.textContent = on ? 'Envio simultâneo para ' + on + ' destino(s): reserve pelo menos ' + (total * 1.3).toFixed(0) + ' Mbps de upload estável.' : 'Nenhum destino pronto: informe servidor e chave.';
    if (model.record) {
      const perHour = (model.bitrate * 1000 + 128) * 3600 / 8 / 1e6, free = live.checked?.free;
      recStatus.dataset.tone = '';
      recStatus.textContent = live.recorded ? 'Última gravação: ' + live.recorded.file + ' (' + gb(live.recorded.size) + ')' : !model.dir ? 'Escolha a pasta de gravação.' : 'Cerca de ' + perHour.toFixed(1) + ' GB por hora' + (free != null ? ' · ' + gb(free) + ' livres (' + Math.floor(free / 1e9 / perHour) + ' h de gravação)' : ' · clique em Verificar pasta') + '. Arquivo MP4 (H.264 + AAC).';
    } else recStatus.textContent = live.recorded ? 'Última gravação: ' + live.recorded.file + ' (' + gb(live.recorded.size) + ')' : 'Gravação desligada.';
    paintButtons();
  }
  function paintButtons() {
    const on = active().length, busy = busyTx();
    startButton.textContent = liveTx.phase === 'stopping' ? 'ENCERRANDO…' : busy ? '■ PARAR' : on ? '▶ TRANSMITIR · ' + on + (on === 1 ? ' DESTINO' : ' DESTINOS') + (model.record ? ' + GRAVAR' : '') : model.record ? '● GRAVAR (SEM TRANSMITIR)' : '▶ TRANSMITIR';
    startButton.dataset.live = String(busy);
    armButton.textContent = busy && live.recording ? '● GRAVANDO' : model.record ? '● Gravação armada' : '○ Gravação desligada';
    armButton.setAttribute('aria-pressed', String(model.record)); armButton.disabled = busy; armButton.dataset.live = String(busy && !!live.recording);
    recEnable.disabled = recDir.disabled = $('#recCheck').disabled = busy;
    $$('.volume').forEach(b => { b.disabled = busy; });
    const stats = $$('.tb-stat');
    if (stats[1]) { stats[1].querySelector('.tb-label').textContent = busy && live.recording ? 'REC' : 'REC OFF'; stats[1].querySelector('.tb-dot').style.opacity = busy && live.recording ? 1 : .2; stats[1].querySelector('.tb-val').textContent = busy && live.recording ? format(state.liveSecs) : '00:00:00'; }
    const footer = $('.sim-footer > strong'); if (footer) footer.textContent = liveTx.phase === 'sending' ? 'NO AR · ' + (on || 'REC') : 'PGM';
  }
  const baseSync = sync;
  sync = function () { baseSync(); paintStatus(); paintButtons(); };

  /* ---------- iniciar e parar ---------- */

  async function startBroadcast() {
    if (busyTx()) return;
    const targets = active(), missing = pending();
    if (!targets.length && !model.record) { openWorkspace('transmission'); txStatus('Informe servidor e chave de pelo menos um destino, ou ligue a gravação.'); return; }
    if (missing.length) { openWorkspace('transmission'); txStatus(missing.map(d => d.name).join(', ') + ': falta servidor ou chave. Complete ou desligue o destino.'); return; }
    if (!window.MediaRecorder || !programOutput.captureStream) { txStatus('Use Chrome ou Edge atualizado para transmitir.'); return; }
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { txStatus('Este navegador não oferece o formato de captura necessário. Use Chrome ou Edge.'); return; }
    const epoch = ++liveTx.epoch; liveTx.phase = 'preparing'; live.states.clear(); live.recording = null; live.recorded = null; sync(); txStatus('Preparando saída PROGRAM…');
    try {
      const session = await checkBridge(); if (epoch !== liveTx.epoch) return;
      if (!session?.ffmpegReady) throw Error('Codificador indisponível. Execute INSTALAR.bat e INICIAR.bat.');
      if (session.busy) throw Error('Outra aba já está transmitindo. Encerre-a antes de continuar.');
      if (session.license && !session.license.valid) throw Error(session.license.message);
      if (model.record && !(await checkDir())) throw Error('Pasta de gravação indisponível: ' + (recStatus.textContent || 'confira a unidade.'));
      const ac = await window.audioMixer.enable(); liveTx.audioContext = ac; if (epoch !== liveTx.epoch) return;
      const destination = window.audioMixer.destination;
      if ($('#txAudio').value === 'mic') {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        if (epoch !== liveTx.epoch) { mic.getTracks().forEach(t => t.stop()); return; }
        liveTx.micStream = mic; const gain = ac.createGain(), analyser = ac.createAnalyser(); analyser.fftSize = 256;
        liveTx.micNode = ac.createMediaStreamSource(mic); liveTx.micNode.connect(gain).connect(analyser).connect(window.audioMixer.master); liveTx.gain = gain; liveTx.analyser = analyser; setGain();
        mic.getAudioTracks()[0].onended = () => { if (busyTx()) finishTransport('Microfone desconectado. O envio foi interrompido.'); };
      }
      const [width, height] = model.resolution === '1080p' ? [1920, 1080] : [1280, 720];
      for (const canvas of [$('#monProgram canvas'), overlay, programOutput]) { canvas.width = width; canvas.height = height; }
      routeProgramOutput();
      const video = programOutput.captureStream(30); liveTx.videoStream = video;
      const stream = new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      // Trecho navegador → serviço com folga de bitrate, para a codificação final não herdar perdas.
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(24, model.bitrate * 1.6) * 1e6, audioBitsPerSecond: 160000 }); liveTx.recorder = recorder;
      const socket = new WebSocket('ws://' + location.host + '/publish', 'andromeda.' + session.token); liveTx.socket = socket; liveTx.pending = 0; liveTx.phase = 'connecting';
      for (const d of targets) live.states.set(d.id, { state: 'connecting' });
      sync(); txStatus('Conectando o codificador…');
      liveTx.stopTimer = setTimeout(() => { if (epoch === liveTx.epoch && liveTx.phase !== 'sending') finishTransport('O codificador não iniciou o envio. Confira a conexão e tente de novo.'); }, 35000);
      recorder.ondataavailable = e => {
        if (epoch !== liveTx.epoch || !e.data.size) return;
        if (socket.readyState !== WebSocket.OPEN) { finishTransport('A conexão com o serviço local foi perdida.'); return; }
        if (liveTx.pending + e.data.size > 8 * 1024 * 1024 || socket.bufferedAmount > 6 * 1024 * 1024) { finishTransport('Acúmulo de vídeo: o computador não está acompanhando. Reduza para 720p ou o bitrate e feche aplicações pesadas.'); return; }
        liveTx.pending += e.data.size; socket.send(e.data);
      };
      recorder.onerror = () => finishTransport('O navegador interrompeu a captura de vídeo. Reinicie o envio.');
      socket.onopen = () => { if (epoch !== liveTx.epoch) return; socket.send(JSON.stringify({ type: 'start', resolution: model.resolution, bitrate: model.bitrate, encoder: model.encoder, destinations: targets.map(d => ({ id: d.id, platform: d.platform, name: d.name, server: d.server.trim(), key: d.key.trim() })), record: model.record ? { dir: model.dir } : null })); };
      socket.onmessage = event => {
        if (epoch !== liveTx.epoch) return; let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'ready') { recorder.start(250); navigator.wakeLock?.request('screen').then(lock => { if (epoch === liveTx.epoch) liveTx.wakeLock = lock; else lock.release(); }).catch(() => {}); txStatus('Enviando PROGRAM ao codificador…'); }
        else if (msg.type === 'ack') liveTx.pending = Math.max(0, liveTx.pending - msg.bytes);
        else if (msg.type === 'recording') { live.recording = msg; paintButtons(); }
        else if (msg.type === 'recorded') { live.recorded = msg; log('Gravação salva: ' + msg.file); summary(); }
        else if (msg.type === 'destination') {
          live.states.set(msg.id, { state: msg.state, reason: msg.reason || '' }); paintStatus();
          const d = model.destinations.find(x => x.id === msg.id);
          if (msg.state === 'retrying') log((d?.name || 'Destino') + ': ' + msg.reason + ' — reconectando'); else if (msg.state === 'sending') log((d?.name || 'Destino') + ' voltou a receber');
        }
        else if (msg.type === 'sending' && liveTx.phase !== 'stopping') {
          if (liveTx.phase !== 'sending') {
            clearTimeout(liveTx.stopTimer); liveTx.startedAt = Date.now(); state.liveSecs = 0;
            for (const [id, s] of live.states) if (s.state === 'connecting') live.states.set(id, { state: 'sending' });
            log(targets.length ? 'No ar: ' + targets.map(d => d.name).join(', ') + (model.record ? ' + gravação' : '') : 'Gravação iniciada');
          }
          liveTx.phase = 'sending'; state.live = true; liveTx.frames = msg.frames; sync();
          const trouble = [...live.states.values()].filter(s => s.state === 'retrying').length;
          txStatus((targets.length ? 'Enviando para ' + targets.length + ' destino(s)' : 'Gravando') + ' · ' + msg.frames + ' quadros' + (trouble ? ' · ' + trouble + ' reconectando' : '') + '. Confirme a prévia em cada plataforma.');
        }
        else if (msg.type === 'error') finishTransport(msg.message);
        else if (msg.type === 'stopped') finishTransport();
      };
      socket.onerror = () => { if (epoch === liveTx.epoch) finishTransport('Não foi possível abrir a conexão com o serviço local.'); };
      socket.onclose = () => { if (epoch === liveTx.epoch) finishTransport(liveTx.phase === 'stopping' ? null : 'Serviço local desconectado. O envio foi interrompido.'); };
    } catch (e) { if (epoch === liveTx.epoch) finishTransport(e.name === 'NotAllowedError' ? 'Permissão de microfone negada. Autorize o navegador ou use somente o mixer das fontes.' : e.message); }
  }
  window.startBroadcast = startBroadcast;
  startButton.onclick = () => busyTx() ? stopTransport() : startBroadcast();

  // Saída e taxa no cabeçalho; espaço em disco durante a gravação.
  setInterval(() => {
    const sending = liveTx.phase === 'sending', on = active().length, rate = sending ? (model.bitrate * Math.max(1, on)).toFixed(0) + ' Mbps' + (on > 1 ? ' (' + on + '×' + model.bitrate + ')' : '') : '0 Mbps';
    const out = $$('.tb-stat')[3]; if (out) out.querySelector('.tb-val').textContent = rate;
    const total = $('.bd-val'); if (total) total.textContent = rate;
    if (!busyTx() && live.states.size) { live.states.clear(); paintStatus(); }
    paintButtons();
  }, 500);
  setInterval(async () => {
    if (!busyTx()) { refreshVolumes(); return; }
    if (!live.recording) return;
    try { const s = await api('/api/storage/check', { dir: model.dir }); if (s.free != null && s.free < 2e9) { txStatus('Atenção: restam ' + gb(s.free) + ' na unidade de gravação.'); window.andromedaAudit?.('warn', 'disco-baixo', 'Pouco espaço na unidade de gravação', { livreGB: +(s.free / 1e9).toFixed(1) }); } } catch { /* conferido de novo no próximo ciclo */ }
  }, 20000);

  // As abas antigas de stream e gravação das configurações gerais saem de cena: a página Transmissão é a fonte única.
  const frame = $('#settingsDialog iframe');
  const tidy = () => { const doc = frame?.contentDocument; if (!doc) return; for (const tab of ['stream', 'gravacao']) { const t = doc.querySelector('[data-tab="' + tab + '"]'); if (t) t.hidden = true; } const note = doc.querySelector('#configFeedback'); if (note) note.textContent = 'Nomes, quantidade de câmeras e automações. Destinos, qualidade e gravação ficam na página Transmissão.'; };
  frame?.addEventListener('load', tidy); tidy();

  checkBridge().then(session => { offerEncoders(session); refreshVolumes(); });
  render();
})();
