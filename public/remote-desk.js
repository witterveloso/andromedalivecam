'use strict';
/*
 * Andrômeda Live — mesa na nuvem.
 * Retorno: um link privado mostra o PGM (com som) em qualquer navegador, por Wi-Fi, 4G ou 5G.
 * Controle: um segundo link mostra Preview e PGM e opera a mesa (fontes, CUT, AUTO, transição, GC, logo, PiP).
 * Cada aparelho de controle precisa ser aprovado aqui na mesa; o operador pode desconectar a qualquer momento.
 *
 * A combinação passa cifrada pelo ponto de encontro do modo Internet (public/cam/relay.js); imagem, som e comandos
 * vão direto entre a mesa e o aparelho por WebRTC (DTLS). Os comandos remotos clicam nos mesmos botões da mesa,
 * então valem as mesmas travas (transição em andamento, mosaico vazio) e tudo fica na auditoria.
 */
(() => {
  const STORE = 'andromeda.remote.v1', LIMIT = { view: 6, control: 2 }, IDLE_MS = 15000;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const randomKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  const audit = (level, code, message, data) => { try { window.andromedaAudit?.(level, code, message, data); } catch { /* auditoria indisponível */ } };

  let cfg = { view: null, control: null, trusted: [], audio: true };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved && typeof saved === 'object') cfg = { ...cfg, ...saved, trusted: Array.isArray(saved.trusted) ? saved.trusted.slice(0, 20) : [] }; } catch { /* armazenamento indisponível */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch { /* armazenamento indisponível */ } };

  let net = null; // { page, relayBrokers, iceServers } vindo do serviço local
  const links = { view: null, control: null }; // kind -> { key, channel, sessions: Map(sid -> sessão) }

  /* ---------- painel em Configurações ---------- */
  const panel = make('section', 'transport-panel remote-panel');
  panel.innerHTML = '<div class="remote-intro"><p>Veja o PGM ou opere a mesa de outro lugar, pelo celular ou computador, em Wi-Fi, 4G ou 5G. Nada para instalar: envie o link. A imagem vai direto deste computador para o aparelho; cada pessoa assistindo usa cerca de 2,5 Mbps do upload daqui.</p></div>'
    + '<div class="remote-cards">'
    + '<article class="remote-card" data-kind="view"><h4>Retorno do PGM</h4><p>Quem abrir o link vê o PGM, com som, em menos de um segundo. Não opera nada. Até 6 aparelhos.</p><div class="remote-qr" aria-hidden="true"></div><label>Link de retorno<input readonly class="remote-url" aria-label="Link de retorno do PGM"></label><div class="remote-actions"><button class="remote-make">Gerar link</button><button class="remote-copy">Copiar</button><button class="remote-share">Compartilhar</button><button class="remote-new">Novo link</button><button class="remote-off">Desligar</button></div><label class="remote-check"><input type="checkbox" id="remoteAudio"> Enviar o som do PGM (com "Ativar áudio" ligado na mesa antes de conectar)</label><ul class="remote-list" aria-live="polite"></ul></article>'
    + '<article class="remote-card" data-kind="control"><h4>Controle remoto</h4><p>Mostra Preview e PGM e opera fontes, CUT, AUTO, transição, GC, logo e PiP. Cada aparelho novo precisa ser aprovado aqui na mesa. Até 2 ao mesmo tempo.</p><div class="remote-qr" aria-hidden="true"></div><label>Link de controle<input readonly class="remote-url" aria-label="Link de controle remoto"></label><div class="remote-actions"><button class="remote-make">Gerar link</button><button class="remote-copy">Copiar</button><button class="remote-share">Compartilhar</button><button class="remote-new">Novo link</button><button class="remote-off">Desligar</button></div><button class="remote-forget">Esquecer aparelhos aprovados</button><ul class="remote-list" aria-live="polite"></ul></article>'
    + '</div><p class="remote-note" role="status"></p>';
  // Entra no fim da página principal; a personalização (workspace-custom.js) leva o painel para Configurações.
  (document.querySelector('.main') || document.body).append(panel);
  const note = panel.querySelector('.remote-note');
  const card = kind => panel.querySelector('.remote-card[data-kind="' + kind + '"]');
  const urlFor = (kind, key) => net && key ? net.page.replace(/#.*$/, '').replace(/\/?$/, '/') + 'remoto.html#' + (kind === 'view' ? 'v=' : 'c=') + key : '';

  // Aviso de aprovação, visível em qualquer página da mesa.
  const ask = make('div', 'remote-ask'); ask.setAttribute('role', 'alertdialog'); ask.setAttribute('aria-label', 'Pedido de controle remoto'); ask.hidden = true; document.body.append(ask);
  const chip = make('span', 'remote-chip'); chip.hidden = true; chip.title = 'Aparelhos conectados pela nuvem';
  (document.querySelector('.tb-stat')?.parentElement || document.querySelector('header') || document.body).prepend(chip);

  /* ---------- estado da mesa e comandos ---------- */
  // Variáveis globais da mesa declaradas com let/const não aparecem em window: ler pelo nome, com proteção.
  const g = { sources: () => typeof sources !== 'undefined' ? sources : [], cams: () => typeof cams !== 'undefined' ? cams : [], fx: () => typeof fx !== 'undefined' ? fx : null, live: () => typeof busyTx === 'function' && !!busyTx() };
  const busRow = r => [...(document.querySelectorAll('.bus-src')[r]?.children || [])];
  function deskState() {
    const row = busRow(0);
    const list = row.map((b, i) => ({ i, name: i < 10 ? (g.sources()[i] || b.textContent.trim()) : b.textContent.trim(), conn: i < 10 ? !!g.cams()[i]?.conn : true, hidden: !!b.hidden, disabled: !!b.disabled })).filter(s => !s.hidden);
    const fxLive = g.fx()?.live;
    return {
      type: 'state', pgm: state.pgm, prv: state.prv, transition: state.type, busy: !!state.busy, progress: Math.round((state.progress || 0) * 100),
      live: g.live(), pgmName: busRow(1)[state.pgm]?.textContent.trim() || '', prvName: row[state.prv]?.textContent.trim() || '',
      sources: list, types: [...document.querySelectorAll('.ttype')].map(t => t.textContent.trim()),
      fx: fxLive ? { layers: fxLive.layers.map(l => ({ name: l.name, on: !!l.on, ready: gcReady(l) })), logo: !!fxLive.logo.on, logoReady: !!g.fx()?.logo, pip: !!fxLive.pip.on } : null,
    };
  }
  const gcReady = l => !!(String(l?.title || '').trim() || String(l?.subtitle || '').trim());
  let refusal = '';
  const click = el => { if (el && !el.disabled && !el.hidden) { el.click(); return true; } return false; };
  // Lista fechada de comandos: nada além disso chega à mesa.
  function apply(cmd, who = 'remoto') {
    refusal = '';
    if (!cmd || typeof cmd.cmd !== 'string') return false;
    const i = Number.isInteger(cmd.i) ? cmd.i : -1;
    let done = false, what = '';
    switch (cmd.cmd) {
      case 'prv': done = i >= 0 && click(busRow(0)[i]); what = 'Preview: ' + (busRow(0)[i]?.textContent.trim() || i); break;
      case 'pgm': done = i >= 0 && click(busRow(1)[i]); what = 'Corte direto no PGM: ' + (busRow(1)[i]?.textContent.trim() || i); break;
      case 'cut': done = click(document.querySelector('.btn-cut')); what = 'CUT'; break;
      case 'auto': done = click(document.querySelector('.btn-auto')); what = 'AUTO'; break;
      case 'type': { const t = [...document.querySelectorAll('.ttype')].find(x => x.textContent.trim() === cmd.value); done = click(t); what = 'Transição ' + cmd.value; break; }
      // Sem texto (ou sem imagem), a mesa abriria a página de efeitos na tela do operador: o comando remoto é recusado.
      case 'gc': { const l = g.fx()?.live.layers[i]; if (!gcReady(l)) { refusal = 'Este GC está sem texto. Preencha na mesa (GC e efeitos) antes.'; return false; } done = click(document.querySelector('#fxGC' + i)); what = 'GC ' + l.name; break; }
      case 'logo': if (!g.fx()?.logo) { refusal = 'Nenhum logotipo carregado na mesa.'; return false; } done = click(document.querySelector('#fxLogo')); what = 'Logotipo'; break;
      case 'pip': done = click(document.querySelector('#fxPip')); what = 'PiP'; break;
      case 'clear': done = click(document.querySelector('#fxClear')); what = 'Retirar camadas'; break;
      default: return false;
    }
    if (done) audit('info', 'remoto-comando', who + ' · ' + what, { pgm: state.pgm, prv: state.prv });
    return done;
  }

  /* ---------- mídia enviada ---------- */
  const media = { pgm: null, prv: null };
  function tracks(kind) {
    if (!media.pgm || media.pgm.getVideoTracks()[0]?.readyState === 'ended') media.pgm = document.querySelector('#programOutput')?.captureStream?.(30) || null;
    const out = { pgm: new MediaStream([...(media.pgm?.getVideoTracks() || [])]) };
    const audio = cfg.audio && window.audioMixer?.destination?.stream?.getAudioTracks()[0];
    if (audio) out.pgm.addTrack(audio);
    if (kind === 'control') {
      if (!media.prv || media.prv.getVideoTracks()[0]?.readyState === 'ended') media.prv = document.querySelector('#monPreview canvas')?.captureStream?.(20) || null;
      out.prv = new MediaStream([...(media.prv?.getVideoTracks() || [])]);
    }
    return out;
  }
  const iceDone = pc => new Promise(resolve => { if (pc.iceGatheringState === 'complete') return resolve(); const t = setTimeout(resolve, 3000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } }); });

  /* ---------- sessões ---------- */
  function sendRelay(link, sid, msg) { link.channel?.send({ sid, msg }).catch(() => {}); }
  function endSession(link, s, code, reason) {
    if (s.ended) return; s.ended = true; link.sessions.delete(s.sid);
    sendRelay(link, s.sid, { type: 'closed', code, reason });
    try { s.dc?.close(); s.pc?.close(); } catch { /* já fechado */ }
    if (s.kind === 'control' && s.state === 'live') audit('info', 'remoto-saiu', 'Controle remoto desconectado: ' + s.name, { motivo: reason });
    paint();
  }
  async function start(link, s) {
    s.state = 'connecting'; paint();
    const pc = new RTCPeerConnection({ iceServers: net?.iceServers || [] }); s.pc = pc;
    const out = tracks(s.kind), ids = {};
    for (const [name, stream] of Object.entries(out)) { ids[name] = stream.id; for (const track of stream.getTracks()) pc.addTrack(track, stream); }
    const dc = pc.createDataChannel('ctl', { ordered: true }); s.dc = dc;
    dc.onopen = () => { s.state = 'live'; s.seen = Date.now(); paint(); dc.send(JSON.stringify(deskState())); if (s.kind === 'control') audit('warn', 'remoto-conectado', 'Controle remoto conectado: ' + s.name); };
    dc.onmessage = e => {
      s.seen = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ping') return;
      if (m.type === 'cmd' && s.kind === 'control') {
        const now = Date.now(); s.window = (s.window || []).filter(t => now - t < 1000); if (s.window.length >= 20) return; s.window.push(now);
        if (!apply(m, s.name) && refusal) dc.send(JSON.stringify({ type: 'notice', text: refusal }));
        setTimeout(() => broadcastState(true), 60);
      }
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) endSession(link, s, 4005, 'Conexão perdida'); };
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    if (s.ended) return;
    // Retorno mais leve que o envio principal: o upload é dividido entre quem assiste.
    for (const sender of pc.getSenders()) { if (sender.track?.kind !== 'video') continue; const prv = out.prv?.getVideoTracks().includes(sender.track); const p = sender.getParameters(); p.encodings = p.encodings?.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = prv ? 900000 : s.kind === 'control' ? 1800000 : 2500000; p.degradationPreference = 'maintain-resolution'; sender.setParameters(p).catch(() => {}); }
    s.offer = { type: 'offer', sdp: pc.localDescription.sdp, streams: ids, ice: net?.iceServers || [] };
    sendRelay(link, s.sid, s.offer);
  }
  function handle(kind, link, env) {
    const { sid, msg } = env || {};
    if (typeof sid !== 'string' || sid.length > 64 || !msg || typeof msg.type !== 'string') return;
    let s = link.sessions.get(sid);
    if (s) s.seen = Date.now();
    if (msg.type === 'hello') {
      if (msg.kind !== kind) { sendRelay(link, sid, { type: 'denied', reason: 'Este link não serve para este modo.' }); return; }
      // Mensagens do ponto de encontro podem se perder: repetir a resposta enquanto o aparelho insiste.
      if (s) { if (s.state === 'pending') sendRelay(link, sid, { type: 'pending' }); else if (s.offer && !s.answered) sendRelay(link, sid, s.offer); return; }
      const device = String(msg.device || '').slice(0, 64);
      // Só uma sessão por aparelho: uma aba nova (ou reconexão) do mesmo aparelho substitui a antiga.
      for (const old of [...link.sessions.values()]) if (device && old.device === device) endSession(link, old, 4001, 'Outra aba assumiu');
      const active = [...link.sessions.values()].filter(x => x.state !== 'pending').length;
      if (active >= LIMIT[kind]) { sendRelay(link, sid, { type: 'denied', reason: 'Limite de ' + LIMIT[kind] + ' aparelhos conectados neste link.' }); return; }
      const name = String(msg.name || (kind === 'view' ? 'Retorno' : 'Operador remoto')).replace(/\s+/g, ' ').trim().slice(0, 40) || 'Aparelho';
      s = { sid, kind, device, name, state: 'pending', seen: Date.now() };
      link.sessions.set(sid, s);
      if (kind === 'control' && !cfg.trusted.includes(device)) { sendRelay(link, sid, { type: 'pending' }); audit('warn', 'remoto-pedido', 'Pedido de controle remoto: ' + name); paint(); return; }
      start(link, s).catch(e => { audit('error', 'remoto-falhou', 'Falha ao conectar aparelho remoto: ' + e.message); endSession(link, s, 4005, 'Falha ao conectar'); });
      return;
    }
    if (!s) return;
    if (msg.type === 'answer' && s.pc && !s.answered && typeof msg.sdp === 'string') { s.answered = true; s.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => endSession(link, s, 4005, 'Resposta inválida')); return; }
    if (msg.type === 'leave') endSession(link, s, 1000, 'Saiu');
  }
  function approve(s, ok) {
    const link = links.control; if (!link || s.state !== 'pending' || s.ended) return;
    if (!ok) { audit('info', 'remoto-recusado', 'Controle remoto recusado: ' + s.name); sendRelay(link, s.sid, { type: 'denied', reason: 'O operador da mesa recusou o acesso.' }); link.sessions.delete(s.sid); s.ended = true; paint(); return; }
    if (s.device && !cfg.trusted.includes(s.device)) { cfg.trusted.push(s.device); cfg.trusted = cfg.trusted.slice(-20); save(); }
    audit('warn', 'remoto-aprovado', 'Controle remoto aprovado: ' + s.name);
    start(link, s).catch(() => endSession(link, s, 4005, 'Falha ao conectar'));
  }

  /* ---------- links ---------- */
  function open(kind) {
    const key = cfg[kind]; if (!key || !net || !window.AndromedaRelay) return;
    if (links[kind]?.key === key) return;
    close(kind, 4002, 'Link substituído');
    const channel = new AndromedaRelay.Channel({ inviteKey: key, role: 'desk', brokers: net.relayBrokers?.length ? net.relayBrokers : AndromedaRelay.DEFAULT_BROKERS });
    const link = { key, channel, sessions: new Map() };
    channel.on(env => handle(kind, link, env));
    links[kind] = link; paint();
  }
  function close(kind, code = 4002, reason = 'Link desligado') {
    const link = links[kind]; if (!link) return;
    for (const s of [...link.sessions.values()]) endSession(link, s, code, reason);
    links[kind] = null; setTimeout(() => link.channel.close(), 1500);
  }
  function makeLink(kind, fresh) {
    if (!net) { note.textContent = 'Serviço local indisponível. Abra a mesa pelo programa Andrômeda Live.'; return; }
    if (fresh || !cfg[kind]) { if (kind === 'control') cfg.trusted = []; cfg[kind] = randomKey(); }
    save(); open(kind);
    audit('info', 'remoto-link', (kind === 'view' ? 'Link de retorno do PGM' : 'Link de controle remoto') + (fresh ? ' substituído' : ' ativo'));
    note.textContent = fresh ? 'Link novo gerado. Quem usava o anterior foi desconectado.' : 'Link ativo. Envie para quem vai ' + (kind === 'view' ? 'assistir.' : 'operar.');
    paint();
  }
  for (const kind of ['view', 'control']) {
    const c = card(kind);
    c.querySelector('.remote-make').onclick = () => makeLink(kind, false);
    c.querySelector('.remote-new').onclick = () => makeLink(kind, true);
    c.querySelector('.remote-off').onclick = () => { close(kind, 4002, 'Link desligado pela mesa'); cfg[kind] = null; if (kind === 'control') cfg.trusted = []; save(); note.textContent = 'Link desligado. Ninguém mais entra por ele.'; audit('info', 'remoto-link', (kind === 'view' ? 'Retorno' : 'Controle remoto') + ' desligado'); paint(); };
    c.querySelector('.remote-copy').onclick = async () => { const input = c.querySelector('.remote-url'); try { await navigator.clipboard.writeText(input.value); note.textContent = 'Link copiado.'; } catch { input.select(); note.textContent = 'Selecione e copie o link.'; } };
    c.querySelector('.remote-share').onclick = async () => { const url = c.querySelector('.remote-url').value; if (!url) return; try { if (navigator.share) await navigator.share({ title: 'Andrômeda Live', url }); else { await navigator.clipboard.writeText(url); note.textContent = 'Link copiado.'; } } catch { /* cancelado */ } };
  }
  card('control').querySelector('.remote-forget').onclick = () => { cfg.trusted = []; save(); note.textContent = 'Aparelhos esquecidos: na próxima conexão cada um precisa ser aprovado de novo.'; };
  const audioBox = panel.querySelector('#remoteAudio'); audioBox.checked = cfg.audio !== false;
  audioBox.onchange = () => { cfg.audio = audioBox.checked; save(); note.textContent = 'Vale para as próximas conexões.'; };

  /* ---------- pintura ---------- */
  let lastQR = {};
  function paint() {
    let viewers = 0, operators = 0;
    for (const kind of ['view', 'control']) {
      const c = card(kind), link = links[kind], url = urlFor(kind, cfg[kind]);
      c.querySelector('.remote-url').value = url;
      for (const b of c.querySelectorAll('.remote-copy,.remote-share,.remote-new,.remote-off')) b.disabled = !url;
      c.querySelector('.remote-make').hidden = !!url;
      if (lastQR[kind] !== url) { lastQR[kind] = url; const box = c.querySelector('.remote-qr'); box.replaceChildren(); if (url && window.qrcode) { try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); box.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); } catch { /* QR indisponível */ } } else box.textContent = url ? '' : 'O QR code aparece depois de gerar o link.'; }
      const list = c.querySelector('.remote-list'); list.replaceChildren();
      for (const s of link?.sessions.values() || []) {
        if (s.state === 'live') kind === 'view' ? viewers++ : operators++;
        const li = make('li', 'remote-item'), label = make('span', '', s.name + ' · ' + (s.state === 'live' ? 'conectado' : s.state === 'pending' ? 'aguardando aprovação' : 'conectando…'));
        li.dataset.state = s.state; li.append(label);
        if (s.state === 'pending') { const yes = make('button', 'remote-yes', 'Permitir'), no = make('button', 'remote-no', 'Recusar'); yes.onclick = () => approve(s, true); no.onclick = () => approve(s, false); li.append(yes, no); }
        else { const out = make('button', '', 'Desconectar'); out.onclick = () => endSession(link, s, 4003, 'Desconectado pela mesa'); li.append(out); }
        list.append(li);
      }
      if (!list.children.length) list.append(make('li', 'remote-empty', url ? 'Ninguém conectado.' : 'Link desligado.'));
    }
    chip.hidden = !(viewers || operators);
    chip.textContent = 'NUVEM · ' + [viewers ? viewers + ' vendo' : '', operators ? operators + ' operando' : ''].filter(Boolean).join(' · ');
    const pending = [...(links.control?.sessions.values() || [])].find(s => s.state === 'pending');
    ask.hidden = !pending;
    if (pending && ask.dataset.sid !== pending.sid) {
      ask.dataset.sid = pending.sid; ask.replaceChildren();
      const text = make('p'), yes = make('button', 'remote-yes', 'Permitir'), no = make('button', 'remote-no', 'Recusar');
      text.append(make('strong', '', 'Controle remoto'), document.createTextNode(' ' + pending.name + ' quer operar a mesa (fontes, CUT, AUTO, GC).'));
      yes.onclick = () => approve(pending, true); no.onclick = () => approve(pending, false);
      ask.append(text, yes, no);
    }
    if (!pending) delete ask.dataset.sid;
  }

  /* ---------- laços ---------- */
  let lastState = '';
  function broadcastState(force) {
    const json = JSON.stringify(deskState()); if (!force && json === lastState) return; lastState = json;
    for (const link of Object.values(links)) for (const s of link?.sessions.values() || []) if (s.dc?.readyState === 'open') { try { s.dc.send(json); } catch { /* fila cheia */ } }
  }
  setInterval(() => {
    broadcastState(false);
    const now = Date.now();
    for (const link of Object.values(links)) for (const s of [...(link?.sessions.values() || [])]) if (now - s.seen > (s.state === 'pending' ? 120000 : IDLE_MS)) endSession(link, s, 4004, 'Sem resposta');
  }, 400);
  async function refresh() {
    try { const r = await fetch('/api/cam/status', { cache: 'no-store' }); if (!r.ok) return; const s = await r.json(); if (!s.page) return; const first = !net; net = { page: s.page, relayBrokers: s.relayBrokers, iceServers: s.iceServers }; if (first) { open('view'); open('control'); } paint(); } catch { /* serviço fechado */ }
  }
  refresh(); setInterval(() => { if (!net) refresh(); }, 5000);
  window.addEventListener('pagehide', () => { close('view', 1001, 'Mesa fechada'); close('control', 1001, 'Mesa fechada'); });
  paint();
  window.andromedaRemote = { apply, state: deskState, panel, refusal: () => refusal };
})();
