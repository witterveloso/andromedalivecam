'use strict';
/*
 * Andrômeda Live — mesa remota (página aberta pelo link que a mesa gera).
 * #v=<chave>: retorno do PGM, só assistir.  #c=<chave>: controle remoto, com Preview, PGM e botões da mesa.
 * A combinação passa cifrada pelo ponto de encontro (relay.js); imagem, som e comandos vão direto pela conexão WebRTC.
 */
(() => {
  const $ = s => document.querySelector(s);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const hash = /^#([vc])=([a-f0-9]{48})$/.exec(location.hash || '');
  const kind = hash ? (hash[1] === 'v' ? 'view' : 'control') : null, key = hash?.[2];
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* privado */ } } };
  const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  let device = store.get('andromeda.remote.device'); if (!/^[a-f0-9]{24}$/.test(device || '')) { device = randomHex(12); store.set('andromeda.remote.device', device); }

  const ui = { status: $('#status'), gate: $('#gate'), gateTitle: $('#gateTitle'), gateText: $('#gateText'), form: $('#nameForm'), name: $('#name'), retry: $('#retry'), screens: $('#screens'), controls: $('#controls'), pgm: $('#pgm'), prv: $('#prv') };
  const setStatus = (text, tone = '') => { ui.status.textContent = text; document.body.dataset.status = tone; };
  const gate = (title, text, { form = false, retry = false } = {}) => { ui.gate.hidden = false; ui.screens.hidden = true; ui.gateTitle.textContent = title; ui.gateText.textContent = text; ui.form.hidden = !form; ui.retry.hidden = !retry; };

  document.body.dataset.mode = kind || 'none';
  if (!kind) { gate('Link incompleto', 'Abra o link inteiro que o operador da mesa enviou (ele termina com uma chave longa).'); setStatus('Sem link', 'bad'); return; }
  if (!window.AndromedaRelay || !window.RTCPeerConnection) { gate('Navegador sem suporte', 'Use o Chrome, Edge, Firefox ou Safari atualizados.'); setStatus('Sem suporte', 'bad'); return; }
  $('#title').textContent = kind === 'view' ? 'Retorno do PGM' : 'Controle remoto';
  document.title = 'Andrômeda Live · ' + (kind === 'view' ? 'Retorno do PGM' : 'Controle remoto');
  $('#prvBox').hidden = kind === 'view';

  const brokers = Array.isArray(window.ANDROMEDA_RELAY) && window.ANDROMEDA_RELAY.length ? window.ANDROMEDA_RELAY : AndromedaRelay.DEFAULT_BROKERS;
  let channel = null, sid = null, pc = null, dc = null, helloTimer = null, pingTimer = null, watchdog = null, stopped = false, tries = 0, name = '';

  function cleanupPeer() {
    clearInterval(pingTimer); pingTimer = null; clearTimeout(watchdog); watchdog = null;
    try { dc?.close(); pc?.close(); } catch { /* já fechado */ }
    dc = null; pc = null;
  }
  function stop(title, text, retry = true) {
    stopped = true; clearInterval(helloTimer); cleanupPeer();
    if (sid && channel) channel.send({ sid, msg: { type: 'leave' } }).catch(() => {});
    gate(title, text, { retry }); setStatus(title, 'bad');
  }
  function reconnect(reason) {
    if (stopped) return;
    cleanupPeer(); setStatus(reason + ' Reconectando…', 'warn');
    clearInterval(helloTimer); setTimeout(hello, 1500);
  }
  function send(msg) { return channel.send({ sid, msg }).catch(() => {}); }

  function hello() {
    if (stopped) return;
    sid = randomHex(8); tries = 0;
    const once = () => {
      tries++;
      send({ type: 'hello', kind, device, name });
      if (tries === 5) setStatus('A mesa não respondeu. Confira se o Andrômeda Live está aberto e com este link ligado.', 'warn');
    };
    clearInterval(helloTimer); once(); helloTimer = setInterval(once, 2500);
  }

  async function onOffer(msg) {
    clearInterval(helloTimer); cleanupPeer();
    setStatus('Conectando a imagem…', 'warn');
    pc = new RTCPeerConnection({ iceServers: Array.isArray(msg.ice) ? msg.ice : [] });
    const byStream = { [msg.streams?.pgm]: ui.pgm, [msg.streams?.prv]: ui.prv };
    pc.ontrack = e => { const video = byStream[e.streams[0]?.id] || ui.pgm; if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0]; video.play().catch(() => {}); };
    pc.ondatachannel = e => {
      dc = e.channel;
      dc.onopen = () => { ui.gate.hidden = true; ui.screens.hidden = false; ui.controls.hidden = kind !== 'control'; setStatus(kind === 'view' ? 'Conectado · assistindo o PGM' : 'Conectado · operando a mesa', 'ok'); clearInterval(pingTimer); pingTimer = setInterval(() => { if (dc?.readyState === 'open') dc.send('{"type":"ping"}'); }, 3000); };
      dc.onmessage = e2 => { let m; try { m = JSON.parse(e2.data); } catch { return; } if (m.type === 'state') render(m); else if (m.type === 'notice') notice(m.text); };
      dc.onclose = () => reconnect('Conexão com a mesa interrompida.');
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === 'failed') reconnect('A conexão direta com a mesa falhou (rede bloqueando o caminho?).');
      else if (pc.connectionState === 'disconnected') { clearTimeout(watchdog); watchdog = setTimeout(() => { if (pc?.connectionState === 'disconnected') reconnect('Sinal perdido.'); }, 6000); }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await new Promise(resolve => { if (pc.iceGatheringState === 'complete') return resolve(); const t = setTimeout(resolve, 3000); pc.addEventListener('icegatheringstatechange', () => { if (pc?.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } }); });
    if (!pc) return;
    send({ type: 'answer', sdp: pc.localDescription.sdp });
    // Sem imagem em 20 s: rede com NAT restrito. Tenta de novo e explica.
    watchdog = setTimeout(() => { if (pc && pc.connectionState !== 'connected') reconnect('A imagem não chegou: esta rede pode bloquear conexão direta. Tente Wi-Fi ou outra operadora.'); }, 20000);
  }

  function onMessage(env) {
    if (!env || env.sid !== sid || !env.msg) return;
    const m = env.msg;
    if (m.type === 'pending') { clearInterval(helloTimer); helloTimer = setInterval(() => send({ type: 'hello', kind, device, name }), 5000); gate('Aguardando aprovação', 'O operador da mesa precisa tocar em "Permitir". Mantenha esta página aberta.'); setStatus('Aguardando aprovação na mesa', 'warn'); }
    else if (m.type === 'denied') stop('Acesso recusado', m.reason || 'A mesa recusou este aparelho.');
    else if (m.type === 'offer' && typeof m.sdp === 'string') onOffer(m).catch(e => reconnect('Falha ao conectar: ' + e.message));
    else if (m.type === 'closed') {
      if (m.code === 4002) stop('Link desligado', 'Este link foi substituído ou desligado pela mesa. Peça o link novo ao operador.', false);
      else if (m.code === 4003) stop('Desconectado', 'O operador da mesa desconectou este aparelho.');
      else if (m.code === 4001) stop('Aberto em outra aba', 'Este link foi aberto em outra aba ou janela deste aparelho.');
      else reconnect(m.code === 1001 ? 'A mesa foi fechada.' : 'Conexão encerrada pela mesa.');
    }
  }

  /* ---------- controles ---------- */
  let noticeTimer = null;
  function notice(text) { const el = $('#notice'); el.textContent = String(text || '').slice(0, 200); el.hidden = !el.textContent; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { el.hidden = true; }, 5000); }
  const cmd = (c, extra = {}) => { if (dc?.readyState === 'open' && kind === 'control') dc.send(JSON.stringify({ type: 'cmd', cmd: c, ...extra })); };
  let last = null;
  function button(label, className, onclick, pressed) { const b = make('button', className, label); b.type = 'button'; b.onclick = onclick; if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed)); return b; }
  function render(s) {
    last = s;
    $('#pgmName').textContent = s.pgmName || ''; $('#prvName').textContent = s.prvName || '';
    $('#pgmTag').textContent = s.live ? 'PGM · NO AR' : 'PGM';
    document.body.classList.toggle('on-air', !!s.live);
    if (kind !== 'control') return;
    const prv = $('#busPrv'), hot = $('#busPgm');
    prv.replaceChildren(...s.sources.map(src => { const b = button(src.name, 'src' + (src.conn ? '' : ' off') + (src.i === s.prv ? ' is-prv' : '') + (src.i === s.pgm ? ' is-pgm' : ''), () => cmd('prv', { i: src.i }), src.i === s.prv); b.disabled = src.disabled; return b; }));
    hot.replaceChildren(...s.sources.map(src => { const b = button(src.name, 'src hot-src' + (src.i === s.pgm ? ' is-pgm' : ''), () => cmd('pgm', { i: src.i }), src.i === s.pgm); b.disabled = src.disabled; return b; }));
    $('#cut').disabled = s.busy; $('#auto').disabled = s.busy;
    $('#auto').textContent = s.busy ? 'AUTO · ' + s.progress + '%' : 'AUTO';
    $('#types').replaceChildren(...s.types.map(t => { const b = button(t, 'type', () => cmd('type', { value: t }), t === s.transition); b.disabled = s.busy; return b; }));
    const layers = $('#layers'); layers.replaceChildren();
    if (s.fx) {
      s.fx.layers.forEach((l, i) => { const b = button('GC · ' + l.name, 'layer' + (l.ready ? '' : ' empty'), () => l.ready ? cmd('gc', { i }) : notice('Este GC está sem texto. Preencha na mesa (GC e efeitos) antes.'), l.on); if (!l.ready) b.title = 'Sem texto na mesa'; layers.append(b); });
      const logo = button('Logotipo', 'layer' + (s.fx.logoReady ? '' : ' empty'), () => s.fx.logoReady ? cmd('logo') : notice('Nenhum logotipo carregado na mesa.'), s.fx.logo);
      layers.append(logo, button('PiP', 'layer', () => cmd('pip'), s.fx.pip), button('Retirar todas', 'layer clear', () => cmd('clear')));
    }
  }
  $('#cut').onclick = () => cmd('cut');
  $('#auto').onclick = () => cmd('auto');
  // Teclado no computador: Espaço = CUT, Enter = AUTO, 1–9 = Preview.
  document.addEventListener('keydown', e => {
    if (kind !== 'control' || ui.screens.hidden || e.target.closest?.('input,textarea,select,summary')) return;
    if (e.key === ' ') { e.preventDefault(); cmd('cut'); }
    else if (e.key === 'Enter' && e.target === document.body) { e.preventDefault(); cmd('auto'); }
    else if (/^[1-9]$/.test(e.key) && last) { const src = last.sources.find(x => x.i === Number(e.key) - 1); if (src) cmd('prv', { i: src.i }); }
  });
  $('#sound').onclick = () => { const on = ui.pgm.muted; ui.pgm.muted = !on; ui.pgm.play().catch(() => {}); $('#sound').setAttribute('aria-pressed', String(on)); $('#sound').textContent = on ? 'Som ligado' : 'Ativar som'; };
  $('#full').onclick = () => { const el = kind === 'view' ? $('#pgmBox') : document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.() || ui.pgm.webkitEnterFullscreen?.())?.catch?.(() => {}); };

  /* ---------- início ---------- */
  async function begin() {
    stopped = false; ui.form.hidden = true; ui.retry.hidden = true;
    gate(kind === 'view' ? 'Retorno do PGM' : 'Controle remoto', 'Procurando a mesa…');
    setStatus('Conectando ao ponto de encontro…', 'warn');
    if (!channel) { channel = new AndromedaRelay.Channel({ inviteKey: key, role: 'cam', brokers }); channel.on(onMessage); }
    if (!(await channel.whenConnected(10000))) { setStatus('Sem internet ou ponto de encontro indisponível. Tentando de novo…', 'bad'); setTimeout(begin, 4000); return; }
    hello();
  }
  ui.retry.onclick = () => begin();
  window.addEventListener('pagehide', () => { if (sid && channel) channel.send({ sid, msg: { type: 'leave' } }).catch(() => {}); });
  if (kind === 'control') {
    name = store.get('andromeda.remote.name') || '';
    ui.name.value = name;
    gate('Controle remoto', 'Este link opera a mesa ao vivo. Diga quem você é: o operador da mesa vai aprovar o acesso.', { form: true });
    setStatus('Aguardando seu nome', '');
    ui.form.onsubmit = e => { e.preventDefault(); name = ui.name.value.replace(/\s+/g, ' ').trim().slice(0, 40); if (!name) return; store.set('andromeda.remote.name', name); begin(); };
  } else begin();
})();
