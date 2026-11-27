'use strict';
/*
 * PONTO na mesa — a direção (DTV / coordenação) fala com apresentador e repórter por um caminho próprio,
 * separado do intercom dos operadores de câmera (convites, canal e conexão de áudio próprios: ponto-hub.cjs).
 *
 * O que vai no fone de cada ponto (uma mistura por ponto, feita aqui na mesa):
 *   voz da direção (só quando a direção fala com aquele ponto)
 * + retorno do programa (se o apresentador ligar), que abaixa sozinho enquanto a direção fala.
 *   Retorno sem a própria voz (mix-minus / N-1): a direção escolhe por qual canal a voz daquela pessoa entra no programa
 *   (a câmera dela, o microfone…) e o retorno desse ponto é o programa MENOS esse canal, subtraído na própria mistura
 *   (exato, amostra a amostra). Quem está no ar ouve a programação, mas não ouve a si mesmo com atraso.
 * Avisos escritos aparecem grandes na tela do ponto ("30 s", "chama o VT"…). O apresentador pode chamar a direção.
 *
 * Na mesa: botão PONTO no quadro Comandos (toque liga/desliga a fala; a engrenagem abre convites, avisos e destino).
 */
(() => {
  const SLOTS = [0, 1, 2, 3], DEFAULT_NAMES = ['Apresentador', 'Repórter', 'Ponto 3', 'Ponto 4'];
  const PRESETS = ['30 segundos', '1 minuto', 'Encerra', 'Chama o VT', 'Olha a câmera', 'Estica', 'Intervalo'];
  const STORE = 'andromeda.ponto.v1';
  const P = { socket: null, ice: [], peers: new Map(), online: new Map(), links: new Map(), mic: null, micSource: null, talking: false, target: 'all', ready: false, retry: null, panelEl: null };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || '{}'); Object.assign(P, { names: saved.names || {}, minus: saved.minus || {} }); } catch { P.names = {}; P.minus = {}; }
  const nameOf = slot => P.online.get(slot)?.name || P.names[slot] || DEFAULT_NAMES[slot];
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ names: P.names, minus: P.minus })); } catch { /* sem armazenamento */ } };
  const send = m => { if (P.socket?.readyState === WebSocket.OPEN) P.socket.send(JSON.stringify(m)); };
  const audit = (level, code, message, data) => window.andromedaAudit?.(level, code, message, data);
  const say = text => { const el = P.panelEl?.querySelector('.ponto-status'); if (el) el.textContent = text; };
  const token = async () => (liveTx.session || await (await fetch('/api/session')).json()).token;
  async function api(path, body) {
    const r = await fetch('/api/ponto/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': await token() }, body: body ? JSON.stringify(body) : undefined });
    const out = await r.json(); if (!r.ok || out.error) throw Error(out.error || 'Falha no PONTO'); return out;
  }
  const targets = () => P.target === 'all' ? [...P.online.keys()] : P.online.has(Number(P.target)) ? [Number(P.target)] : [];

  /* ---------- áudio: uma mistura por ponto ---------- */
  async function audio() {
    const ac = window.audioMixer.context || await window.audioMixer.enable();
    return ac;
  }
  async function mixFor(slot) {
    const ac = await audio(); let p = P.peers.get(slot);
    if (p?.dest) return p;
    const dest = ac.createMediaStreamDestination(), voice = ac.createGain(), pgm = ac.createGain();
    voice.gain.value = 0; pgm.gain.value = 0; voice.connect(dest); pgm.connect(dest);
    window.audioMixer.master?.connect(pgm);
    if (P.micSource) P.micSource.connect(voice);
    p = Object.assign(p || {}, { dest, voice, pgm, returnOn: !!p?.returnOn }); P.peers.set(slot, p);
    level(slot); return p;
  }
  // Direção falando com este ponto: voz cheia e retorno do programa baixo (−14 dB); calada: só o retorno, se ligado.
  function level(slot) {
    const p = P.peers.get(slot); if (!p?.voice) return;
    const ac = window.audioMixer.context, now = ac.currentTime, talkingHere = P.talking && targets().includes(slot);
    p.voice.gain.setTargetAtTime(talkingHere && P.mic ? 1 : 0, now, 0.02);
    p.pgm.gain.setTargetAtTime(p.returnOn ? (talkingHere ? 0.2 : 0.8) : 0, now, 0.08);
  }
  /* ---------- retorno sem a própria voz (mix-minus) ----------
   * O sinal de um canal entra no master multiplicado pelo volume do master. O mesmo sinal, multiplicado por −(volume do
   * master), entra no retorno do ponto: os dois se anulam e sobra o programa sem aquele canal. */
  const MIC = 'mic';
  function nodeOf(key) {
    if (key === MIC) return typeof liveTx !== 'undefined' ? liveTx.analyser || null : null; // microfone da transmissão (mesa)
    const i = Number(key); if (!(i >= 0 && i < 10)) return null;
    const m = window.audioMixer, remote = typeof bm !== 'undefined' && bm.inputs?.[i]?.bound;
    return (remote ? m.remotes?.get(i) : m.nodes?.get(i))?.analyser || null;
  }
  function syncMinus() {
    const m = window.audioMixer, ac = m?.context; if (!ac || !m.master) return;
    const g = m.master.gain.value;
    for (const [slot, p] of P.peers) {
      if (!p.pgm) continue;
      p.minusNodes = p.minusNodes || new Map();
      const want = new Map(); for (const key of [].concat(P.minus[slot] || [])) { const n = nodeOf(key); if (n) want.set(String(key), n); }
      for (const [key, e] of p.minusNodes) if (want.get(key) !== e.src) { try { e.src.disconnect(e.inv); } catch { /* já solto */ } e.inv.disconnect(); p.minusNodes.delete(key); }
      for (const [key, src] of want) if (!p.minusNodes.has(key)) { const inv = ac.createGain(); inv.gain.value = -g; src.connect(inv); inv.connect(p.pgm); p.minusNodes.set(key, { src, inv }); }
      for (const e of p.minusNodes.values()) if (e.inv.gain.value !== -g) e.inv.gain.setValueAtTime(-g, ac.currentTime);
    }
  }
  setInterval(syncMinus, 100);
  const minusLabel = key => key === MIC ? 'Microfone da transmissão' : typeof sources !== 'undefined' ? String(sources[Number(key)] || 'CAM ' + (Number(key) + 1)) : 'CAM ' + (Number(key) + 1);

  async function enable() {
    const ac = await audio(); await ac.resume();
    if (!P.mic) {
      P.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      P.micSource = ac.createMediaStreamSource(P.mic);
      for (const p of P.peers.values()) if (p.voice) P.micSource.connect(p.voice);
      audit('info', 'ponto-microfone', 'Microfone da direção liberado para o PONTO');
    }
    P.ready = true; paint(); return true;
  }
  function setTalk(on) {
    on = !!on && !!P.mic && targets().length > 0;
    if (on === P.talking) { paint(); return; }
    P.talking = on;
    for (const slot of P.peers.keys()) level(slot);
    send({ type: 'cue', slots: on ? targets() : [], talking: on });
    if (on) audit('info', 'ponto-falando', 'Direção falando no PONTO com ' + targets().map(nameOf).join(', '));
    paint(); window.andromedaCommandsPaint?.();
  }

  /* ---------- conexão com cada ponto ---------- */
  async function onSignal(m) {
    const slot = m.slot;
    if (m.signal.description?.type === 'offer') {
      const old = P.peers.get(slot); try { old?.pc?.close(); } catch { /* fechada */ }
      const mix = await mixFor(slot);
      const pc = new RTCPeerConnection({ iceServers: P.ice });
      mix.pc = pc; mix.queue = [];
      pc.onicecandidate = e => { if (e.candidate) send({ type: 'signal', slot, signal: { candidate: e.candidate.toJSON() } }); };
      // Fala do apresentador ("chamar a direção") toca aqui na mesa, nos fones da direção.
      pc.ontrack = e => { if (!mix.out) { mix.out = document.createElement('audio'); mix.out.autoplay = true; mix.out.hidden = true; document.body.append(mix.out); } mix.out.srcObject = e.streams[0] || new MediaStream([e.track]); mix.out.play().catch(() => {}); };
      pc.onconnectionstatechange = () => { if (pc === mix.pc) { mix.state = pc.connectionState; paint(); } };
      await pc.setRemoteDescription(m.signal.description);
      const tr = pc.getTransceivers().find(t => t.receiver.track?.kind === 'audio');
      if (tr) { await tr.sender.replaceTrack(mix.dest.stream.getAudioTracks()[0]); tr.direction = 'sendrecv'; }
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      send({ type: 'signal', slot, signal: { description: pc.localDescription.toJSON() } });
      for (const c of mix.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      level(slot);
    } else if (m.signal.candidate) {
      const mix = P.peers.get(slot); if (!mix?.pc) return;
      if (mix.pc.remoteDescription) await mix.pc.addIceCandidate(m.signal.candidate).catch(() => {}); else mix.queue.push(m.signal.candidate);
    }
  }
  function drop(slot) {
    const p = P.peers.get(slot); if (p) { try { p.pc?.close(); } catch { /* fechada */ } p.pc = null; p.state = ''; if (p.out) { p.out.srcObject = null; } p.talkback = false; }
    P.online.delete(slot); if (P.talking && !targets().length) setTalk(false); paint();
  }
  async function connect() {
    try {
      const ws = new WebSocket('ws://' + location.host + '/ponto-signal', 'andromeda.' + await token()); P.socket = ws;
      let chain = Promise.resolve();
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } chain = chain.then(() => handle(m)).catch(err => log('PONTO: ' + err.message)); };
      ws.onclose = () => { P.socket = null; for (const slot of [...P.online.keys()]) drop(slot); clearTimeout(P.retry); P.retry = setTimeout(connect, 3000); };
    } catch { clearTimeout(P.retry); P.retry = setTimeout(connect, 3000); }
  }
  async function handle(m) {
    if (m.type === 'ready' || m.type === 'ice') P.ice = m.iceServers || P.ice;
    else if (m.type === 'ponto') { P.online.set(m.slot, { name: m.name }); log(m.name + ' entrou no PONTO'); paint(); }
    else if (m.type === 'ponto-left') { log(nameOf(m.slot) + ' saiu do PONTO'); drop(m.slot); }
    else if (m.type === 'signal') await onSignal(m);
    else if (m.type === 'talkback') {
      const p = P.peers.get(m.slot) || {}; p.talkback = m.active; P.peers.set(m.slot, p);
      if (m.active) { log(nameOf(m.slot) + ' está chamando a direção no PONTO'); try { p.out && (p.out.volume = 1); } catch { /* sem áudio */ } }
      paint(); window.andromedaCommandsPaint?.();
    }
    else if (m.type === 'return') { const p = P.peers.get(m.slot); if (p) { p.returnOn = m.on; level(m.slot); paint(); } }
    else if (m.type === 'presence') { const o = P.online.get(m.slot); if (o) { o.background = m.state === 'background'; paint(); } }
  }

  /* ---------- painel (engrenagem do botão PONTO) ---------- */
  function panel() {
    const el = document.createElement('div'); el.className = 'ponto-panel'; P.panelEl = el;
    el.innerHTML = '<p class="ponto-status" role="status"></p>' +
      '<button type="button" class="ponto-enable">Liberar microfone da direção</button>' +
      '<label class="ponto-target">Falar com <select></select></label>' +
      '<button type="button" class="ponto-hold">SEGURE PARA FALAR NO PONTO</button>' +
      '<div class="ponto-list"></div>' +
      '<div class="ponto-notes"><strong>Aviso escrito</strong><div class="ponto-presets"></div><span class="ponto-free"><input maxlength="140" placeholder="Aviso livre (aparece grande na tela do ponto)" aria-label="Aviso livre"><button type="button">Enviar</button></span></div>';
    el.querySelector('.ponto-enable').onclick = () => enable().catch(e => say('Microfone indisponível: ' + e.message));
    const sel = el.querySelector('.ponto-target select'); sel.onchange = () => { P.target = sel.value; setTalk(false); };
    const hold = el.querySelector('.ponto-hold');
    hold.onpointerdown = e => { e.preventDefault(); hold.setPointerCapture?.(e.pointerId); setTalk(true); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(t, () => setTalk(false));
    for (const text of PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = () => note(text); el.querySelector('.ponto-presets').append(b); }
    const free = el.querySelector('.ponto-free input'); el.querySelector('.ponto-free button').onclick = () => { if (note(free.value)) free.value = ''; };
    free.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (note(free.value)) free.value = ''; } };
    paint(); return el;
  }
  function note(text) {
    text = String(text || '').trim(); const to = targets();
    if (!text) return false;
    if (!to.length) { say('Nenhum ponto conectado para receber o aviso.'); return false; }
    send({ type: 'msg', slots: to, text }); log('Aviso no PONTO (' + to.map(nameOf).join(', ') + '): ' + text); say('Aviso enviado: ' + text); return true;
  }
  function row(slot) {
    const r = document.createElement('div'); r.className = 'ponto-row'; r.dataset.slot = slot;
    const online = P.online.get(slot), p = P.peers.get(slot) || {}, link = P.links.get(slot);
    const st = online ? (p.talkback ? 'CHAMANDO' : p.state === 'connected' ? 'NO PONTO' : 'CONECTANDO') + (online.background ? ' · app fora da tela' : '') : link ? 'AGUARDANDO' : 'SEM LINK';
    r.innerHTML = '<span class="ponto-pill"></span><input class="ponto-name" maxlength="40"><span class="ponto-actions"><button type="button" class="ponto-invite">Gerar link</button><button type="button" class="ponto-copy" hidden>Copiar</button><a class="ponto-wa" target="_blank" rel="noopener noreferrer" hidden>WhatsApp</a><button type="button" class="ponto-revoke">Revogar</button></span><label class="ponto-minus">Retorno sem a voz de <select></select></label><small class="ponto-ret"></small>';
    r.querySelector('.ponto-pill').textContent = st; r.querySelector('.ponto-pill').dataset.tone = p.talkback ? 'call' : online ? (p.state === 'connected' ? 'on' : 'wait') : 'off';
    const name = r.querySelector('.ponto-name'); name.value = nameOf(slot); name.setAttribute('aria-label', 'Nome do ponto ' + (slot + 1)); name.onchange = () => { P.names[slot] = name.value.trim() || DEFAULT_NAMES[slot]; save(); };
    // Mix-minus: o canal por onde a voz desta pessoa entra no programa sai do retorno dela.
    const minus = r.querySelector('.ponto-minus select'), limit = typeof config !== 'undefined' && config?.limit || 10;
    minus.setAttribute('aria-label', 'Canal com a voz de ' + nameOf(slot) + ', que sai do retorno dela');
    minus.title = 'Escolha por onde a voz desta pessoa entra no programa (a câmera dela ou o microfone). O retorno dela fica sem esse canal: ela ouve a programação, mas não se ouve com atraso.';
    minus.add(new Option('— ninguém (retorno completo)', ''));
    for (let i = 0; i < limit; i++) minus.add(new Option(minusLabel(i), String(i)));
    minus.add(new Option(minusLabel(MIC), MIC));
    minus.value = String([].concat(P.minus[slot] || [])[0] ?? '');
    minus.onchange = () => { if (minus.value === '') delete P.minus[slot]; else P.minus[slot] = [minus.value]; save(); syncMinus(); log('PONTO ' + nameOf(slot) + ': retorno ' + (minus.value === '' ? 'completo' : 'sem ' + minusLabel(minus.value) + ' (não ouve a própria voz)')); };
    r.querySelector('.ponto-ret').textContent = online ? 'Retorno do programa ' + (p.returnOn ? 'ligado pelo apresentador' : 'desligado') : '';
    const copy = r.querySelector('.ponto-copy'), wa = r.querySelector('.ponto-wa');
    if (link) { copy.hidden = false; wa.hidden = false; wa.href = 'https://wa.me/?text=' + encodeURIComponent('PONTO da direção (Andrômeda Live): coloque o fone, abra o link e toque em Entrar no ponto: ' + link); }
    copy.onclick = async () => { try { await navigator.clipboard.writeText(link); say('Link do ' + nameOf(slot) + ' copiado.'); } catch { say(link); } };
    r.querySelector('.ponto-invite').onclick = async () => { try { const inv = await api('invite', { slot, name: name.value.trim() || nameOf(slot) }); P.links.set(slot, inv.url); P.names[slot] = inv.name; save(); say('Link do ' + inv.name + ' pronto. Envie pelo WhatsApp ou copie.'); paint(); } catch (e) { say(e.message); } };
    r.querySelector('.ponto-revoke').onclick = async () => { try { await api('revoke', { slot }); P.links.delete(slot); drop(slot); say('Ponto ' + nameOf(slot) + ' revogado.'); } catch (e) { say(e.message); } };
    return r;
  }
  function paint() {
    const el = P.panelEl; if (!el || (!el.isConnected && el.dataset.drawn)) return; el.dataset.drawn = '1';
    const sel = el.querySelector('.ponto-target select'), keep = P.target;
    sel.replaceChildren(new Option('Todos os pontos conectados', 'all'), ...[...P.online.keys()].map(s => new Option(nameOf(s), String(s))));
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : 'all'; P.target = sel.value;
    el.querySelector('.ponto-enable').hidden = !!P.mic;
    const hold = el.querySelector('.ponto-hold'); hold.disabled = !P.mic || !targets().length; hold.dataset.on = String(P.talking); hold.textContent = P.talking ? '● FALANDO NO PONTO' : 'SEGURE PARA FALAR NO PONTO';
    const list = el.querySelector('.ponto-list'), focused = list.contains(document.activeElement);
    if (!focused) list.replaceChildren(...SLOTS.map(row));
    if (!el.querySelector('.ponto-status').textContent) say(!P.mic ? 'Libere o microfone da direção. Gere um link para cada pessoa no ar e envie pelo WhatsApp.' : P.online.size ? P.online.size + ' ponto(s) conectado(s).' : 'Nenhum ponto conectado ainda.');
  }

  // Botão PONTO do quadro Comandos: toque liga/desliga a fala (com o microfone liberado); sem microfone, pede o microfone.
  function toggle() {
    if (!P.mic) { enable().then(() => log('PONTO pronto: toque de novo para falar.')).catch(e => log('PONTO: microfone indisponível (' + e.message + ')')); return true; }
    if (!targets().length) { log('PONTO: nenhum apresentador conectado. Abra a engrenagem do PONTO e gere o link.'); return false; }
    setTalk(!P.talking); return true;
  }
  function label() {
    const calling = [...P.peers.entries()].filter(([s, p]) => p.talkback && P.online.has(s)).map(([s]) => nameOf(s));
    if (calling.length) return '☎ ' + calling.join(', ') + ' chamando';
    if (!P.mic) return 'toque para ativar';
    if (P.talking) return '● falando · ' + (P.target === 'all' ? 'todos' : nameOf(Number(P.target)));
    return P.online.size ? P.online.size + ' no ponto' : 'nenhum conectado';
  }
  window.addEventListener('blur', () => { /* fala fixa pelo botão de comando continua; a de segurar é liberada pelo próprio botão */ });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && P.talking) setTalk(false); });
  window.addEventListener('pagehide', () => { try { P.socket?.close(); } catch { /* fechado */ } P.mic?.getTracks().forEach(t => t.stop()); });
  window.andromedaPonto = { toggle, label, panel, setTalk, enable, note, syncMinus, mixFor, isTalking: () => P.talking, isReady: () => !!P.mic, calling: () => [...P.peers.values()].some(p => p.talkback), state: P };
  connect();
})();
