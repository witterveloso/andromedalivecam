'use strict';
/*
 * Andrômeda PONTO — app de quem está no ar (apresentador, repórter).
 *
 * Link: ponto.html#r=CHAVE (&p=wss://… quando a empresa usa o próprio ponto de encontro da Rede Andrômeda).
 * Caminho próprio, separado das câmeras: canal cifrado próprio (derivado da chave deste convite) e conexão WebRTC só de áudio.
 *  - Ouve a direção (e, se ligar, o retorno do programa, que abaixa sozinho quando a direção fala).
 *  - Vê "DIREÇÃO FALANDO" e os avisos escritos (ex.: "30 s", "chama o VT"), com vibração.
 *  - "Segure para falar com a direção": o microfone só abre enquanto o botão está pressionado.
 */
(() => {
  const $ = s => document.querySelector(s);
  const hash = new URLSearchParams(location.hash.slice(1));
  const P = { key: hash.get('r') || '', point: hash.get('p') || '', channel: null, sock: null, pc: null, ice: [], mic: null, micTrack: null, sender: null, talking: false, running: false, generation: 0, retry: null, wake: null, queue: [], deskOnline: false };
  const brokers = () => { const p = P.point; return /^wss:\/\//.test(p) ? [p] : (Array.isArray(window.ANDROMEDA_RELAY) && window.ANDROMEDA_RELAY.length ? window.ANDROMEDA_RELAY : AndromedaRelay.DEFAULT_BROKERS); };
  const say = (text, state) => { $('#status').textContent = text; if (state) document.body.dataset.state = state; };
  const send = m => { if (P.sock?.readyState === 1) P.sock.send(JSON.stringify(m)); };
  const vibrate = p => { try { navigator.vibrate?.(p); } catch { /* sem vibração */ } };

  if (!/^[0-9a-f]{48}$/.test(P.key) || !window.AndromedaRelay) { say('Link do ponto incompleto. Peça outro à direção.', 'error'); return; }
  $('#enter').disabled = false;

  /* ---------- ponto de encontro (mesma interface de um WebSocket) ---------- */
  function channel() {
    if (!P.channel) P.channel = new AndromedaRelay.Channel({ inviteKey: P.key, role: 'cam', brokers: brokers() });
    return P.channel;
  }
  async function session() {
    const ch = channel();
    if (!(await ch.whenConnected(12000))) throw Error('Sem internet ou ponto de encontro indisponível. Confira o Wi-Fi ou os dados móveis.');
    const sid = AndromedaRelay.randomHex(8);
    return new Promise((resolve, reject) => {
      let tries = 0;
      const off = ch.on(env => { if (env.sid !== sid || env.msg?.type !== 'session') return; clearInterval(timer); off(); if (env.msg.ok && env.msg.kind === 'ponto') resolve(env.msg); else reject(Error(env.msg.error || 'Este link não é de um ponto. Peça outro à direção.')); });
      const ask = () => { if (++tries > 6) { clearInterval(timer); off(); reject(Error('A mesa não respondeu. Confira se o Andrômeda Live está aberto e conectado à internet.')); return; } ch.send({ sid, msg: { type: 'session' } }); };
      const timer = setInterval(ask, 2000); ask();
    });
  }
  function socket() {
    const ch = channel(), sid = AndromedaRelay.randomHex(8);
    const sock = { readyState: 0, send(text) { if (sock.readyState === 1) ch.send({ sid, msg: JSON.parse(text) }); }, close(code = 1000) { if (sock.readyState > 1) return; sock.readyState = 3; ch.send({ sid, msg: { type: 'leave' } }); finish(code); } };
    let off = null, ping = null, quiet = null;
    const finish = code => { off?.(); clearInterval(ping); clearTimeout(quiet); sock.readyState = 3; sock.onclose?.({ code }); };
    const alive = () => { clearTimeout(quiet); quiet = setTimeout(() => { if (sock.readyState === 1) { sock.readyState = 3; ch.send({ sid, msg: { type: 'leave' } }); finish(1006); } }, 9000); };
    off = ch.on(env => {
      if (env.sid !== sid || !env.msg) return; alive();
      if (env.msg.type === 'closed') { if (sock.readyState < 2) finish(env.msg.code || 1000); return; }
      sock.onmessage?.({ data: JSON.stringify(env.msg) });
    });
    ch.whenConnected(12000).then(ok => {
      if (sock.readyState !== 0) return;
      if (!ok) { finish(1006); return; }
      sock.readyState = 1; alive(); ping = setInterval(() => ch.send({ sid, msg: { type: 'ping' } }), 4000); sock.onopen?.();
    });
    return sock;
  }

  /* ---------- áudio: ouvir a direção e falar com ela ---------- */
  function closePeer() { const pc = P.pc; P.pc = null; P.sender = null; P.queue = []; if (pc) { pc.onconnectionstatechange = null; try { pc.close(); } catch { /* já fechada */ } } }
  async function negotiate() {
    closePeer();
    const pc = P.pc = new RTCPeerConnection({ iceServers: P.ice, bundlePolicy: 'max-bundle' });
    // Fala com a direção pelo mesmo caminho (sendrecv); sem microfone, só ouve.
    const tr = pc.addTransceiver(P.micTrack || 'audio', { direction: P.micTrack ? 'sendrecv' : 'recvonly' });
    P.sender = tr.sender;
    pc.ontrack = e => { const ear = $('#ear'); ear.srcObject = e.streams[0] || new MediaStream([e.track]); ear.play().catch(() => say('Toque na tela para liberar o som do ponto.', 'warn')); };
    pc.onicecandidate = e => { if (e.candidate) send({ type: 'signal', signal: { candidate: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      if (pc !== P.pc) return;
      if (pc.connectionState === 'connected') say('No ponto · ouvindo a direção', 'live');
      else if (pc.connectionState === 'failed') { say('Áudio caiu. Reconectando…', 'warn'); setTimeout(() => { if (pc === P.pc && P.deskOnline) negotiate().catch(() => {}); }, 1500); }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'signal', signal: { description: pc.localDescription.toJSON() } });
  }
  async function onSignal(signal) {
    const pc = P.pc; if (!pc) return;
    if (signal.description?.type === 'answer') { await pc.setRemoteDescription(signal.description); for (const c of P.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
    else if (signal.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {}); else P.queue.push(signal.candidate); }
  }

  /* ---------- mensagens da direção ---------- */
  let noteTimer = null;
  async function message(m) {
    if (m.type === 'ready') { P.ice = m.iceServers || []; $('#who').textContent = m.name || 'Ponto'; document.title = (m.name || 'Ponto') + ' · Andrômeda PONTO'; P.deskOnline = !!m.desk; say(m.desk ? 'Conectando o áudio…' : 'Aguardando a mesa da direção…', 'warn'); }
    else if (m.type === 'negotiate') { P.ice = m.iceServers || P.ice; P.deskOnline = true; await negotiate(); }
    else if (m.type === 'signal') await onSignal(m.signal);
    else if (m.type === 'cue') { const on = m.talking === true; document.body.dataset.cue = on ? 'on' : 'off'; $('#cueText').textContent = on ? 'DIREÇÃO FALANDO' : 'DIREÇÃO EM SILÊNCIO'; if (on) vibrate(80); }
    else if (m.type === 'msg') {
      $('#noteText').textContent = m.text; $('#noteTime').textContent = 'AVISO DA DIREÇÃO · ' + new Date(m.at || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('#note').hidden = false; vibrate([120, 80, 120]); clearTimeout(noteTimer); noteTimer = setTimeout(() => { $('#note').hidden = true; }, 60000);
    }
    else if (m.type === 'return') paintReturn(m.on === true);
    else if (m.type === 'desk-offline') { P.deskOnline = false; closePeer(); document.body.dataset.cue = 'off'; say('A mesa da direção saiu. Aguardando…', 'warn'); }
  }

  function connect() {
    if (!P.running) return;
    const generation = ++P.generation; closePeer();
    const ws = P.sock = socket();
    ws.onopen = () => send({ type: 'join', key: P.key });
    let chain = Promise.resolve();
    ws.onmessage = e => { if (generation !== P.generation) return; chain = chain.then(() => message(JSON.parse(e.data))).catch(err => say('Conexão: ' + err.message, 'warn')); };
    ws.onclose = e => {
      if (generation !== P.generation) return;
      closePeer(); document.body.dataset.cue = 'off';
      if ([4001, 4002, 4003].includes(e.code)) { P.running = false; say('Ponto revogado ou expirado. Peça outro link à direção.', 'error'); $('#live').hidden = true; return; }
      if (e.code === 4006) { P.running = false; say('Este ponto foi aberto em outro aparelho.', 'error'); return; }
      say(navigator.onLine ? 'Reconectando à direção…' : 'Sem internet. Reconectando quando o sinal voltar…', 'warn');
      clearTimeout(P.retry); P.retry = setTimeout(connect, 2500);
    };
  }

  /* ---------- controles ---------- */
  function paintReturn(on) { const b = $('#ret'); b.setAttribute('aria-pressed', String(on)); b.textContent = 'Retorno do programa: ' + (on ? 'LIGADO' : 'DESLIGADO'); }
  $('#ret').onclick = () => { const on = $('#ret').getAttribute('aria-pressed') !== 'true'; paintReturn(on); send({ type: 'return', on }); };
  const volume = $('#volume');
  const setVolume = () => { const v = Number(volume.value); $('#ear').volume = v / 100; $('#volumeOut').textContent = v; try { localStorage.setItem('andromeda.ponto.volume', String(v)); } catch { /* sem armazenamento */ } };
  try { const v = localStorage.getItem('andromeda.ponto.volume'); if (v) volume.value = v; } catch { /* sem armazenamento */ }
  volume.oninput = setVolume; setVolume();

  function setTalk(on) {
    on = !!on && !!P.micTrack; P.talking = on;
    if (P.micTrack) P.micTrack.enabled = on;
    const b = $('#talk'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '● FALANDO COM A DIREÇÃO' : P.micTrack ? 'SEGURE PARA FALAR COM A DIREÇÃO' : 'MICROFONE NÃO LIBERADO';
    send({ type: 'talkback', active: on });
  }
  const talk = $('#talk');
  talk.onpointerdown = e => { e.preventDefault(); talk.setPointerCapture?.(e.pointerId); setTalk(true); };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) talk.addEventListener(t, () => setTalk(false));
  talk.oncontextmenu = e => e.preventDefault();

  $('#enter').onclick = async () => {
    $('#enter').disabled = true; say('Preparando…', 'warn');
    // O toque libera o som do fone. O microfone é opcional: sem ele, o ponto só ouve.
    // (sem esperar: sem fonte ainda, o play() só termina quando o áudio da direção chegar)
    try { $('#ear').muted = false; $('#ear').play().catch(() => {}); } catch { /* liberado no próximo toque */ }
    try {
      P.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      P.micTrack = P.mic.getAudioTracks()[0]; P.micTrack.enabled = false;
    } catch { P.micTrack = null; }
    try {
      const info = await session();
      $('#who').textContent = info.name || 'Ponto';
      $('#gate').hidden = true; $('#live').hidden = false; setTalk(false);
      P.running = true; connect();
      try { P.wake = await navigator.wakeLock?.request('screen'); } catch { /* tela pode apagar */ }
    } catch (e) { say(e.message, 'error'); $('#enter').disabled = false; }
  };
  document.addEventListener('visibilitychange', async () => {
    send({ type: 'presence', state: document.hidden ? 'background' : 'foreground' });
    if (!document.hidden && P.running) { try { P.wake = await navigator.wakeLock?.request('screen'); } catch { /* sem trava de tela */ } $('#ear').play().catch(() => {}); }
    if (document.hidden) setTalk(false);
  });
  document.addEventListener('pointerdown', () => { if (P.running) $('#ear').play().catch(() => {}); });
  window.addEventListener('online', () => { if (P.running) { P.channel?.reconnect(); } });
  window.andromedaPonto = P; // diagnóstico e testes
})();
