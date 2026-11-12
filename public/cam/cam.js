'use strict';
/*
 * Andromeda Cam — câmera de contribuição por convite (WebRTC).
 * O mesmo arquivo é publicado em docs/ (GitHub Pages) e em public/cam/ (gateway);
 * test/cam-sync.test.cjs falha se as duas cópias divergirem.
 */
const localTest = new URLSearchParams(location.search).get('teste') === '1';
const gateway = String(window.ANDROMEDA_GATEWAY || '').replace(/\/+$/, '');
const KEY = /^[a-f0-9]{48}$/;
// Convite pela internet: #r=CHAVE (ponto de encontro + WebRTC direto). Convite por gateway ou rede local: #CHAVE.
const parseHash = hash => { const h = String(hash || '').replace(/^#/, ''); if (h.startsWith('r=') && KEY.test(h.slice(2))) return { key: h.slice(2), relay: true }; return KEY.test(h) ? { key: h, relay: false } : null; };
const firstInvite = parseHash(location.hash);
const relayBrokers = Array.isArray(window.ANDROMEDA_RELAY) && window.ANDROMEDA_RELAY.length ? window.ANDROMEDA_RELAY : window.AndromedaRelay?.DEFAULT_BROKERS || [];
const q = s => document.querySelector(s);
const root = q('body');
const cam = {
  stream: null, ws: null, pcs: new Map(), ice: [],
  key: firstInvite?.key || '', relay: !!firstInvite?.relay, channel: null,
  running: false, muted: false, talking: false,
  lastTally: 0, shownTally: '', started: 0, generation: 0, retry: null,
  ac: null, meter: null, intercomTrack: null, wake: null, lastBytes: 0, lastStatsAt: 0,
};
const prefs = {
  get(name, fallback) { try { const v = localStorage.getItem('andromeda.cam.' + name); return v === null ? fallback : v; } catch { return fallback; } },
  set(name, value) { try { localStorage.setItem('andromeda.cam.' + name, value); } catch { /* armazenamento indisponível */ } },
};

/* ---------- tela cheia ---------- */

// iPhone: o Safari não deixa uma página ocupar a tela toda. Aberto pelo ícone na Tela de Início, o app ocupa a tela
// inteira, sem barras do navegador. Android e computador: tela cheia do próprio navegador.
const iOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches;
const canFullscreen = () => !/iP(hone|od)/.test(navigator.userAgent) && !!(document.documentElement?.requestFullscreen || document.documentElement?.webkitRequestFullscreen);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFullscreen() {
  const el = document.documentElement; if (!el) return;
  try { Promise.resolve(el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.()).catch(() => {}); } catch { /* negado */ }
}
function exitFullscreen() { try { Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen)?.call(document)).catch(() => {}); } catch { /* já saiu */ } }
function inviteHash() { return cam.key ? '#' + (cam.relay ? 'r=' : '') + cam.key : ''; }
function toggleFullscreen() {
  if (standalone()) { say('Já está em tela cheia: o app foi aberto pela Tela de Início.', 'ok'); return; }
  if (canFullscreen()) { if (isFullscreen()) exitFullscreen(); else enterFullscreen(); return; }
  if (iOS) {
    // O ícone guarda o endereço da página: o convite volta para a barra para ir junto. Sem o manifesto,
    // o iPhone usa este endereço em vez do inicial.
    if (cam.key) history.replaceState(null, '', location.pathname + inviteHash());
    document.querySelector('link[rel="manifest"]')?.remove();
    q('#homeSheet').showModal(); return;
  }
  say('Este navegador não oferece tela cheia. Use o Chrome ou o Safari atualizados.', 'warn');
}
function paintFullscreen() {
  const b = q('#fullToggle'); if (!b) return;
  b.hidden = standalone();
  b.setAttribute('aria-pressed', String(isFullscreen()));
  b.setAttribute('aria-label', isFullscreen() ? 'Sair da tela cheia' : 'Tela cheia');
}
document.addEventListener('fullscreenchange', paintFullscreen);
document.addEventListener('webkitfullscreenchange', paintFullscreen);

if (standalone() && !localTest) {
  if (firstInvite) prefs.set('invite', (firstInvite.relay ? 'r=' : '') + firstInvite.key);
  else { const last = parseHash(prefs.get('invite', '')); if (last) { cam.key = last.key; cam.relay = last.relay; } }
}
// A chave do convite sai da barra de endereço assim que é lida.
history.replaceState(null, '', location.pathname + (localTest ? '?teste=1' : ''));

/* ---------- estado visível ---------- */

// Com a câmera ativa, avisos informativos saem do visor depois de alguns segundos; alertas ficam.
let quiet = null;
function say(text, kind = 'info') {
  const el = q('#connection'); el.textContent = text; el.dataset.kind = kind; el.dataset.quiet = 'off';
  clearTimeout(quiet);
  if (kind === 'info' || kind === 'ok') quiet = setTimeout(() => { el.dataset.quiet = 'on'; }, 7000);
}
function setRun(state) { root.dataset.run = state; }
function setStartLabel(text) { q('#startLabel').textContent = text; }

const TALLY = { program: 'NO AR', preview: 'PREVIEW', standby: 'EM ESPERA' };
function tally(state) {
  const el = q('#tally');
  if (localTest) { el.dataset.state = 'offline'; root.dataset.tally = 'offline'; el.textContent = 'TESTE LOCAL · FORA DO AR'; return; }
  el.dataset.state = state; root.dataset.tally = state;
  el.textContent = TALLY[state] || (cam.running ? 'SEM RETORNO DA MESA' : 'DESCONECTADO');
  if (state === 'program' && cam.shownTally !== 'program') { try { navigator.vibrate?.([70, 40, 70]); } catch { /* sem vibração */ } }
  cam.shownTally = state;
}

function describeHero() {
  const set = (title, text) => { q('#heroTitle').textContent = title; q('#heroText').textContent = text; };
  q('#heroInvite').hidden = localTest || !!cam.key;
  q('#heroTest').hidden = localTest;
  if (localTest) set('Teste local da câmera', 'Câmera e microfone ligam apenas neste aparelho. Nenhum sinal é enviado à mesa.');
  else if (cam.key) set('Convite recebido', 'Conecte os fones, toque em ATIVAR CÂMERA e permita câmera e microfone.');
  else set('Abra o convite da mesa', 'Use o link privado enviado pelo diretor de TV ou cole o convite aqui.');
}

/* ---------- sinalização ---------- */

function send(message) { if (cam.ws?.readyState === 1) cam.ws.send(JSON.stringify(message)); }
function cleanPeers() {
  for (const p of cam.pcs.values()) p.pc.close();
  cam.pcs.clear(); cam.intercomTrack?.stop(); cam.intercomTrack = null; ptt(false);
  const link = q('#link'); link.hidden = true; link.textContent = '';
}

/* ---------- áudio: mudo e intercom ---------- */

function ptt(on) {
  cam.talking = on && cam.running;
  cam.stream?.getAudioTracks().forEach(t => { t.enabled = !cam.muted && !cam.talking; });
  if (cam.intercomTrack) cam.intercomTrack.enabled = cam.talking;
  q('#ptt').classList.toggle('active', cam.talking);
  root.dataset.talking = cam.talking ? 'on' : 'off';
  send({ type: 'talk', active: cam.talking });
}
q('#mute').onclick = () => {
  cam.muted = !cam.muted; ptt(false);
  q('#muteLabel').textContent = cam.muted ? 'MUDO' : 'MIC';
  q('#mute').setAttribute('aria-pressed', String(cam.muted));
  root.dataset.muted = cam.muted ? 'on' : 'off';
};
const talk = q('#ptt');
talk.onpointerdown = e => { e.preventDefault(); talk.setPointerCapture(e.pointerId); ptt(true); };
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) talk.addEventListener(name, () => ptt(false));
talk.onkeydown = e => { if ([' ', 'Enter'].includes(e.key)) { e.preventDefault(); ptt(true); } };
talk.onkeyup = () => ptt(false);
window.addEventListener('blur', () => ptt(false));

q('#hear').onclick = () => q('#returnAudio').play()
  .then(() => say('Retorno do DTV liberado. Use fones.', 'ok'))
  .catch(() => say('O retorno estará disponível quando o intercom conectar.', 'info'));

/* ---------- lentes e dispositivos ---------- */

// Nomes que o sistema dá às câmeras: iPhone ("Câmera Ultra-angular Traseira", "Back Telephoto Camera"…),
// Android ("camera2 0, facing back"). As câmeras "Dupla"/"Tripla" do iPhone trocam de lente sozinhas pelo zoom.
function lensInfo(label, index) {
  const l = String(label || '').toLowerCase();
  if (/front|frontal|user|selfie|truedepth/.test(l)) return { name: 'Frontal', rank: 9 };
  if (/ultra/.test(l)) return { name: '0,5× Ultra', rank: 1 };
  if (/tele/.test(l)) return { name: 'Tele', rank: 3 };
  if (/triple|tripla/.test(l)) return { name: 'Auto · 3 lentes', rank: 4 };
  if (/dual wide|grande-angular dupla|dupla grande|ultra.*dupla/.test(l)) return { name: 'Auto · 0,5–1×', rank: 5 };
  if (/dual|dupla/.test(l)) return { name: 'Auto · 1×–Tele', rank: 6 };
  if (/back|rear|traseira|environment|facing back|principal|main/.test(l)) return { name: '1× Principal', rank: 2 };
  return { name: 'Câmera ' + (index + 1), rank: 8 };
}
function lensName(label, index) { return lensInfo(label, index).name; }
function renderLenses() {
  const select = q('#lens'), box = q('#lensChips');
  // Ultra, principal, tele, automáticas e frontal por último; nomes repetidos ganham número.
  const options = [...select.options].map((o, i) => ({ o, i, info: lensInfo(o.text, i) })).sort((a, b) => a.info.rank - b.info.rank || a.i - b.i);
  const seen = {};
  box.replaceChildren(); box.hidden = options.length < 2;
  options.forEach(({ o: option, info }) => {
    seen[info.name] = (seen[info.name] || 0) + 1;
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'lens';
    chip.textContent = info.name + (seen[info.name] > 1 ? ' ' + seen[info.name] : '');
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(option.value === select.value));
    chip.setAttribute('title', option.text || info.name);
    chip.onclick = () => { if (select.value === option.value) return; select.value = option.value; select.onchange(); };
    box.append(chip);
  });
  if (cam.stream) window.AndromedaOptics?.lensBar(box);
}
async function enumerate() {
  const devices = await navigator.mediaDevices.enumerateDevices(), current = q('#lens').value;
  for (const [selector, kind] of [['#lens', 'videoinput'], ['#input', 'audioinput']]) {
    const select = q(selector), old = select.value;
    select.replaceChildren();
    if (kind === 'audioinput') select.add(new Option('Padrão do sistema', ''));
    devices.filter(d => d.kind === kind).forEach((d, i) => select.add(new Option(d.label || (kind === 'videoinput' ? 'Câmera ' : 'Microfone ') + (i + 1), d.deviceId)));
    if ([...select.options].some(o => o.value === old)) select.value = old;
  }
  const actual = cam.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  if (actual) q('#lens').value = actual || current;
  renderLenses();
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (cam.stream) enumerate().catch(() => {}); });

function videoConstraints(deviceId = q('#lens').value) {
  const [width, height] = q('#resolution').value.split('x').map(Number);
  return {
    width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: Number(q('#fps').value) },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
  };
}

function showCapabilities() {
  const track = cam.stream.getVideoTracks()[0], st = track.getSettings();
  q('#qualityActual').textContent = st.width + '×' + st.height + ' · ' + Math.round(st.frameRate || 0) + ' fps';
  try { track.contentHint = 'motion'; } catch { /* navegador sem dica de conteúdo */ }
  window.AndromedaOptics?.attach(track);
  renderLenses(); layoutGrid();
}

// Fluidez acima de tudo: se a rede ou o processador apertarem, o envio reduz a nitidez e mantém os quadros por
// segundo (maintain-framerate), em vez de travar o movimento. Vale para 720p, 1080p e 4K.
async function bitrate() {
  const p = cam.pcs.get('media'); if (!p) return;
  const sender = p.pc.getSenders().find(s => s.track?.kind === 'video'); if (!sender) return;
  const params = sender.getParameters(); if (!params.encodings?.length) return;
  const e = params.encodings[0], fps = Number(q('#fps').value) || 30;
  e.maxBitrate = Math.max(1, Math.min(MAX_MBPS, Number(q('#bitrate').value) || 3)) * 1000000;
  e.maxFramerate = fps; e.priority = 'high'; e.networkPriority = 'high';
  params.degradationPreference = 'maintain-framerate';
  await sender.setParameters(params).catch(() => { delete e.priority; delete e.networkPriority; delete params.degradationPreference; return sender.setParameters(params); });
}
const MAX_MBPS = 25;
// Codificador de hardware: os celulares codificam H.264 no chip (iPhone sempre, Android quase sempre).
// Em 1080p60 e 4K o codificador por software não acompanha e o vídeo engasga.
function preferHardwareCodec(pc) {
  const caps = window.RTCRtpSender?.getCapabilities?.('video'); if (!caps?.codecs?.length) return;
  const rank = c => /h264/i.test(c.mimeType) ? (/packetization-mode=1/.test(c.sdpFmtpLine || '') ? 0 : 1) : /vp8/i.test(c.mimeType) ? 2 : /vp9/i.test(c.mimeType) ? 3 : 4;
  const codecs = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  for (const t of pc.getTransceivers()) if (t.sender.track?.kind === 'video' && t.setCodecPreferences) { try { t.setCodecPreferences(codecs); } catch { /* o navegador escolhe */ } }
}
q('#bitrate').onchange = () => bitrate().catch(e => say(e.message, 'warn'));

// Reabre a câmera (troca de lente ou formato que o aparelho não muda ao vivo). A atual é liberada antes.
async function reopenVideo(deviceId) {
  const old = cam.stream.getVideoTracks()[0], previous = old.getSettings().deviceId;
  const open = async id => (await navigator.mediaDevices.getUserMedia({ video: videoConstraints(id), audio: false })).getVideoTracks()[0];
  old.stop();
  let track;
  try { track = await open(deviceId); }
  catch (e) {
    say('A câmera não abriu com este ajuste: ' + captureMessage(e), 'error');
    try { track = await open(previous); q('#lens').value = previous; } catch { /* a anterior também não abriu */ }
  }
  if (!track) return null;
  cam.stream.removeTrack(old); cam.stream.addTrack(track); q('#view').srcObject = cam.stream; q('#view').play().catch(() => {});
  showCapabilities();
  const sender = cam.pcs.get('media')?.pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
  const out = window.AndromedaOptics?.output() || track;
  if (sender && sender.track !== out) await sender.replaceTrack(out).catch(e => say('Troca de câmera falhou: ' + e.message, 'error'));
  await bitrate().catch(() => {});
  return track;
}
q('#lens').onchange = async () => {
  if (!cam.stream) { renderLenses(); return; }
  await reopenVideo(q('#lens').value);
  renderLenses();
};

// Resolução e quadros/s valem na hora: primeiro sem fechar a câmera; se o aparelho não muda ao vivo, reabre.
async function applyFormat() {
  if (!cam.stream) return;
  const [width, height] = q('#resolution').value.split('x').map(Number), fps = Number(q('#fps').value);
  const track = cam.stream.getVideoTracks()[0];
  const fits = () => { const st = track.getSettings(), long = Math.max(st.width || 0, st.height || 0), short = Math.min(st.width || 0, st.height || 0); return long >= width * 0.95 && short >= height * 0.95 && (st.frameRate || 0) >= fps * 0.9; };
  let ok = await track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } }).then(() => true, () => false);
  if (!ok || !fits()) ok = !!(await reopenVideo(q('#lens').value));
  else { showCapabilities(); await bitrate().catch(() => {}); }
  const now = cam.stream?.getVideoTracks()[0]?.getSettings() || {};
  const got = (now.width || 0) + '×' + (now.height || 0) + ' · ' + Math.round(now.frameRate || 0) + ' fps';
  say(Math.max(now.width || 0, now.height || 0) >= width * 0.95 && (now.frameRate || 0) >= fps * 0.9 ? 'Formato aplicado: ' + got + '.' : 'Este aparelho entregou ' + got + ' nesta lente (pedido: ' + q('#resolution').selectedOptions[0].text + ' · ' + fps + ' fps).', 'info');
}
// Microfone novo: troca no envio e no intercom sem derrubar o vídeo.
async function applyMic() {
  if (!cam.stream) return;
  const old = cam.stream.getAudioTracks()[0];
  let fresh;
  try { fresh = (await navigator.mediaDevices.getUserMedia({ video: false, audio: { deviceId: q('#input').value ? { exact: q('#input').value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: false } })).getAudioTracks()[0]; }
  catch (e) { say('Microfone não abriu: ' + captureMessage(e), 'error'); return; }
  fresh.enabled = old ? old.enabled : true;
  if (old) { cam.stream.removeTrack(old); old.stop(); }
  cam.stream.addTrack(fresh);
  const media = cam.pcs.get('media')?.pc.getSenders().find(s => s.track?.kind === 'audio');
  if (media) await media.replaceTrack(fresh).catch(() => {});
  const ic = fresh.clone(); ic.enabled = cam.intercomTrack ? cam.intercomTrack.enabled : false;
  const intercom = cam.pcs.get('intercom')?.pc.getSenders().find(s => s.track?.kind === 'audio');
  if (intercom) await intercom.replaceTrack(ic).catch(() => {});
  cam.intercomTrack?.stop(); cam.intercomTrack = ic;
  if (cam.ac && cam.meter) cam.ac.createMediaStreamSource(new MediaStream([fresh])).connect(cam.meter);
  say('Microfone trocado: ' + (q('#input').selectedOptions[0]?.text || 'padrão') + '.', 'ok');
}
q('#resolution').onchange = q('#fps').onchange = () => { if (cam.running) applyFormat().catch(e => say(e.message, 'warn')); };
q('#input').onchange = () => { if (cam.running) applyMic().catch(e => say(e.message, 'warn')); };

/* ---------- WebRTC ---------- */

async function makePeer(lane) {
  const pc = new RTCPeerConnection({ iceServers: cam.ice }), p = { pc, queue: [] };
  cam.pcs.set(lane, p);
  pc.onicecandidate = e => { if (e.candidate) send({ type: 'signal', lane, signal: { candidate: e.candidate.toJSON() } }); };
  if (lane === 'media') {
    const video = cam.stream.getVideoTracks()[0], out = window.AndromedaOptics?.output() || video;
    for (const t of cam.stream.getTracks()) pc.addTrack(t === video ? out : t, cam.stream);
    preferHardwareCodec(pc);
  }
  else {
    cam.intercomTrack = cam.stream.getAudioTracks()[0].clone(); cam.intercomTrack.enabled = false;
    pc.addTrack(cam.intercomTrack, new MediaStream([cam.intercomTrack]));
    pc.ontrack = e => {
      q('#returnAudio').srcObject = e.streams[0] || new MediaStream([e.track]);
      q('#returnAudio').play().catch(() => say('Toque em “Liberar retorno do DTV” para ouvir nos fones.', 'warn'));
    };
  }
  pc.onconnectionstatechange = () => {
    if (lane !== 'media') return;
    if (pc.connectionState === 'connected') { bitrate().catch(() => {}); say('Vídeo conectado à mesa. O tally indica o barramento PGM, não a confirmação do YouTube.', 'ok'); q('#ptt').disabled = false; }
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      tally('offline'); say('Conexão interrompida. Reconectando…', 'warn'); ptt(false);
      clearTimeout(cam.retry); cam.retry = setTimeout(() => { if (cam.running) cam.ws?.close(); }, 2000);
    }
  };
  await pc.setLocalDescription(await pc.createOffer());
  send({ type: 'signal', lane, signal: { description: pc.localDescription.toJSON() } });
}

async function message(m) {
  if (m.type === 'ready') { q('#cameraName').textContent = m.name; cam.ice = m.iceServers; return; }
  if (m.type === 'negotiate') { cleanPeers(); cam.ice = m.iceServers; await makePeer('media'); await makePeer('intercom'); return; }
  if (m.type === 'desk-offline') { cleanPeers(); tally('offline'); say('Mesa desconectada. Aguardando o operador abrir a mesa.', 'warn'); return; }
  if (m.type === 'tally') { cam.lastTally = Date.now(); tally(m.state); return; }
  if (m.type === 'signal') {
    const p = cam.pcs.get(m.lane); if (!p) return;
    if (m.signal.description) {
      await p.pc.setRemoteDescription(m.signal.description);
      for (const ice of p.queue) await p.pc.addIceCandidate(ice);
      p.queue = [];
      if (m.lane === 'media') await bitrate();
    } else if (m.signal.candidate) {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.signal.candidate); else p.queue.push(m.signal.candidate);
    }
  }
}

/* ---------- ponto de encontro pela internet ---------- */

function relayChannel() {
  if (!window.AndromedaRelay) throw Object.assign(Error('Página incompleta: recarregue o link do convite.'), { name: 'InviteError' });
  if (!cam.channel || cam.channel.inviteKey !== cam.key) {
    cam.channel?.close();
    cam.channel = new AndromedaRelay.Channel({ inviteKey: cam.key, role: 'cam', brokers: relayBrokers });
    cam.channel.inviteKey = cam.key;
  }
  return cam.channel;
}
// Pergunta à mesa, pelo ponto de encontro, o nome e o perfil deste convite.
async function relaySession() {
  const channel = relayChannel(), invite = message => Object.assign(Error(message), { name: 'InviteError' });
  if (!(await channel.whenConnected(12000))) throw invite('Sem internet ou ponto de encontro indisponível. Confira o Wi-Fi ou os dados móveis e tente de novo.');
  const sid = AndromedaRelay.randomHex(8);
  return new Promise((resolve, reject) => {
    let tries = 0;
    const off = channel.on(env => { if (env.sid !== sid || env.msg?.type !== 'session') return; clearInterval(timer); off(); if (env.msg.ok) resolve(env.msg); else reject(invite(env.msg.error || 'Convite recusado pela mesa.')); });
    const ask = () => { if (++tries > 6) { clearInterval(timer); off(); reject(invite('A mesa não respondeu. Confira se o Andrômeda Live está aberto no computador e conectado à internet.')); return; } channel.send({ sid, msg: { type: 'session' } }); };
    const timer = setInterval(ask, 2000); ask();
  });
}
// Mesma interface de um WebSocket (send, close, onopen, onmessage, onclose) sobre o ponto de encontro.
function relaySocket() {
  const channel = relayChannel(), sid = AndromedaRelay.randomHex(8);
  const sock = { readyState: 0, send(text) { if (sock.readyState === 1) channel.send({ sid, msg: JSON.parse(text) }); }, close(code = 1000) { if (sock.readyState > 1) return; sock.readyState = 3; channel.send({ sid, msg: { type: 'leave' } }); finish(code); } };
  let off = null, ping = null, quiet = null;
  const finish = code => { off?.(); clearInterval(ping); clearTimeout(quiet); sock.readyState = 3; sock.onclose?.({ code }); };
  const alive = () => { clearTimeout(quiet); quiet = setTimeout(() => { if (sock.readyState === 1) { sock.readyState = 3; channel.send({ sid, msg: { type: 'leave' } }); finish(1006); } }, 9000); };
  off = channel.on(env => {
    if (env.sid !== sid || !env.msg) return; alive();
    if (env.msg.type === 'closed') { if (sock.readyState < 2) finish(env.msg.code || 1000); return; }
    sock.onmessage?.({ data: JSON.stringify(env.msg) });
  });
  channel.whenConnected(12000).then(ok => {
    if (sock.readyState !== 0) return;
    if (!ok) { finish(1006); return; }
    sock.readyState = 1; alive(); ping = setInterval(() => channel.send({ sid, msg: { type: 'ping' } }), 4000); sock.onopen?.();
  });
  return sock;
}

function signal() {
  if (!cam.running) return;
  const generation = ++cam.generation; cleanPeers();
  const ws = cam.relay ? relaySocket() : new WebSocket(gateway.replace(/^http/, 'ws') + '/signal'); cam.ws = ws;
  ws.onopen = () => send({ type: 'join', key: cam.key });
  let chain = Promise.resolve();
  ws.onmessage = e => { if (generation !== cam.generation) return; chain = chain.then(() => message(JSON.parse(e.data))).catch(err => say('Conexão: ' + err.message, 'error')); };
  ws.onerror = () => {};
  ws.onclose = e => {
    if (generation !== cam.generation) return;
    cleanPeers(); tally('offline'); q('#ptt').disabled = true;
    if ([4001, 4002, 4003].includes(e.code)) { stop(); say('Convite inválido, ocupado, revogado ou expirado. Peça outro à mesa.', 'error'); return; }
    if (cam.relay && e.code === 1006 && !navigator.onLine) say('Sem internet. Reconectando quando o sinal voltar…', 'warn'); else
    say('Reconectando à mesa…', 'warn');
    if (cam.running) { clearTimeout(cam.retry); cam.retry = setTimeout(signal, 2500); }
  };
}

/* ---------- convite ---------- */

function readInvite(text) {
  text = String(text || '').trim();
  if (KEY.test(text)) return { key: text, relay: !gateway };
  let url; try { url = new URL(text); } catch { return { error: 'Convite inválido. Cole o link completo recebido da mesa.' }; }
  const parsed = parseHash(url.hash);
  if (!parsed) return { error: 'Convite inválido. Cole o link completo recebido da mesa.' };
  if (url.origin !== location.origin) { location.href = url.href; return { error: 'Abrindo o convite no endereço da mesa…' }; }
  return parsed;
}
function useInvite() {
  const result = readInvite(q('#invite').value);
  if (result.error) { say(result.error, 'error'); return false; }
  cam.key = result.key; cam.relay = result.relay; q('#invite').value = '';
  return true;
}
q('#inviteApply').onclick = () => {
  if (!q('#invite').value) { say('Cole o link de convite gerado na mesa.', 'warn'); return; }
  if (!useInvite()) return;
  q('#setup').close(); describeHero(); setStartLabel('ATIVAR CÂMERA');
  say('Convite carregado. Conecte os fones e toque em ATIVAR CÂMERA.', 'ok');
};

/* ---------- iniciar e parar ---------- */

function captureMessage(e) { return captureError(e); }
function captureError(e) {
  if (e.name === 'InviteError') return e.message;
  if (e.name === 'NotAllowedError') return 'Permissão negada. Libere câmera e microfone nas permissões do site e toque de novo.';
  if (e.name === 'NotFoundError') return 'Nenhuma câmera ou microfone foi encontrado neste aparelho.';
  if (e.name === 'NotReadableError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
  if (e.name === 'OverconstrainedError') return 'Este aparelho não oferece a lente ou a resolução escolhida. Mude nos ajustes.';
  return 'Não foi possível capturar câmera/microfone: ' + e.message;
}

async function start() {
  if (!localTest && q('#invite').value && !useInvite()) return;
  if (!localTest && !KEY.test(cam.key)) { q('#setup').showModal(); say('Cole um convite válido gerado na mesa.', 'warn'); return; }
  if (!localTest && !cam.relay && !gateway) { say('Este convite precisa do endereço da mesa. Abra o link recebido no celular.', 'warn'); return; }
  if (!isSecureContext) { say('Abra o link com https://. O celular não libera a câmera em endereço sem segurança.', 'error'); return; }
  q('#start').disabled = true; setRun('starting');
  if (prefs.get('fullscreen', '1') === '1' && canFullscreen()) enterFullscreen();
  try {
    if (!localTest && cam.relay) {
      const info = await relaySession();
      q('#cameraName').textContent = info.name;
      if (info.profile) { q('#resolution').value = info.profile.width + 'x' + info.profile.height; q('#fps').value = info.profile.fps; q('#bitrate').value = info.profile.bitrate; }
    } else if (!localTest) {
      const invite = message => Object.assign(Error(message), { name: 'InviteError' });
      const response = await fetch(gateway + '/cam/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: cam.key }) })
        .catch(() => { throw invite('Sem resposta da mesa. Confira a internet e tente de novo.'); });
      const info = await response.json().catch(() => ({}));
      if (!response.ok) throw invite(info.error || 'Convite recusado pela mesa.');
      q('#cameraName').textContent = info.name;
      if (info.profile) { q('#resolution').value = info.profile.width + 'x' + info.profile.height; q('#fps').value = info.profile.fps; q('#bitrate').value = info.profile.bitrate; }
    }
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(Error('Abra este link no Safari ou Chrome atualizado. O navegador interno do mensageiro pode não permitir a câmera.'), { name: 'InviteError' });
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(),
      audio: { deviceId: q('#input').value ? { exact: q('#input').value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    q('#view').srcObject = cam.stream; await q('#view').play();
    await enumerate(); showCapabilities();
    cam.ac = new AudioContext(); await cam.ac.resume();
    cam.meter = cam.ac.createAnalyser(); cam.ac.createMediaStreamSource(cam.stream).connect(cam.meter);
    cam.running = true; cam.started = Date.now(); cam.lastTally = 0; cam.lastBytes = 0; cam.lastStatsAt = 0;
    ptt(false); setStartLabel('PARAR'); setRun(localTest ? 'test' : 'live');
    if (localTest) { tally('offline'); say('Câmera e microfone reais ativos somente neste aparelho. Nenhum sinal enviado à mesa.', 'ok'); }
    else { tally('offline'); say('Câmera ativa. Conectando à mesa…', 'info'); signal(); }
    await keepAwake();
  } catch (e) { stop(); say(captureError(e), 'error'); }
  finally { q('#start').disabled = false; }
}

async function keepAwake() { try { cam.wake = await navigator.wakeLock?.request('screen'); } catch { /* o sistema pode negar */ } }

function stop() {
  cam.running = false; cam.generation++; clearTimeout(cam.retry);
  cam.ws?.close(); cleanPeers();
  window.AndromedaOptics?.reset();
  cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null; q('#view').srcObject = null;
  cam.ac?.close().catch(() => {}); cam.ac = null; cam.meter = null;
  cam.wake?.release().catch(() => {}); cam.wake = null;
  if (document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {});
  setStartLabel(localTest ? 'ATIVAR TESTE' : cam.key ? 'ATIVAR CÂMERA' : 'CONECTAR');
  setRun('idle'); q('#ptt').disabled = true; showMicLevel(0); q('#elapsed').textContent = '00:00';
  tally('offline'); q('#stats').textContent = localTest ? 'SEM TRANSMISSÃO' : '0 Mbps';
  if (localTest) {
    q('#returnAudio').pause(); q('#returnAudio').srcObject = null;
    q('#hear').textContent = 'Ouvir microfone nos fones';
    say('Teste parado. Câmera e microfone desligados.', 'info');
  }
}

q('#start').onclick = () => cam.running ? stop() : start();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ptt(false); tally('offline'); say('Mantenha o app visível e a tela ligada. O sistema pode suspender a câmera em segundo plano.', 'warn'); }
  else if (cam.running && !cam.wake) keepAwake();
});
window.addEventListener('pagehide', stop);
window.addEventListener('offline', () => { tally('offline'); ptt(false); say('Sem rede. Aguardando reconexão.', 'warn'); cam.ws?.close(); });

/* ---------- telemetria ---------- */

// Barra em escala de dB (−60 a 0 dBFS); o <meter> guarda o valor RMS para leitores de tela.
function showMicLevel(rms) {
  q('#micLevel').value = rms;
  const bar = q('#micBar'); if (!bar.style) return;
  const db = 20 * Math.log10(rms || 1e-6);
  bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3) + ')';
  bar.dataset.level = db > -3 ? 'poor' : db > -12 ? 'fair' : 'good';
}

setInterval(async () => {
  if (Date.now() - cam.lastTally > 3500) tally('offline');
  if (cam.running) {
    const sec = Math.floor((Date.now() - cam.started) / 1000);
    q('#elapsed').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  if (cam.meter) {
    const a = new Float32Array(cam.meter.fftSize); cam.meter.getFloatTimeDomainData(a);
    showMicLevel(Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length));
  }
  const p = cam.pcs.get('media'); if (!p) return;
  try {
    const reports = await p.pc.getStats(); let bytes = 0, rtt = null, lost = null;
    reports.forEach(r => {
      if (r.type === 'outbound-rtp' && r.kind === 'video') bytes += r.bytesSent || 0;
      if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
        if (typeof r.roundTripTime === 'number') rtt = r.roundTripTime;
        if (typeof r.fractionLost === 'number') lost = r.fractionLost;
      }
    });
    const now = Date.now();
    if (cam.lastStatsAt) q('#stats').textContent = (Math.max(0, bytes - cam.lastBytes) * 8 / (now - cam.lastStatsAt) / 1000).toFixed(2) + ' Mbps';
    cam.lastBytes = bytes; cam.lastStatsAt = now;
    if (rtt !== null) {
      const link = q('#link'), ms = Math.round(rtt * 1000), loss = lost || 0;
      const level = ms < 150 && loss < .02 ? 'good' : ms < 400 && loss < .08 ? 'fair' : 'poor';
      link.hidden = false; link.dataset.level = level;
      link.textContent = ({ good: 'Enlace bom', fair: 'Enlace instável', poor: 'Enlace fraco' })[level] + ' · ' + ms + ' ms';
    }
  } catch { /* estatísticas indisponíveis neste navegador */ }
}, 1000);

if (navigator.getBattery) navigator.getBattery().then(b => {
  const update = () => { const el = q('#battery'); el.hidden = false; el.dataset.level = b.level < .2 && !b.charging ? 'poor' : ''; el.textContent = 'Bateria ' + Math.round(b.level * 100) + '%' + (b.charging ? ' · carregando' : ''); };
  update(); b.addEventListener('levelchange', update); b.addEventListener('chargingchange', update);
}).catch(() => {});

const connection = navigator.connection;
function showNetwork() {
  const name = ({ wifi: 'Wi-Fi', cellular: 'Dados móveis', ethernet: 'Cabo' })[connection?.type];
  const el = q('#network'); el.hidden = !name; el.textContent = name || '';
}
if (connection) { showNetwork(); connection.addEventListener?.('change', showNetwork); }

/* ---------- grade de enquadramento ---------- */

// A grade acompanha a área real da imagem (object-fit: contain), não a tela inteira.
function layoutGrid() {
  const view = q('#view'), grid = q('#grid');
  if (!view.videoWidth || !grid.style) return;
  const scale = Math.min(view.clientWidth / view.videoWidth, view.clientHeight / view.videoHeight);
  const width = view.videoWidth * scale, height = view.videoHeight * scale;
  Object.assign(grid.style, { width: width + 'px', height: height + 'px', left: (view.clientWidth - width) / 2 + 'px', top: (view.clientHeight - height) / 2 + 'px' });
}
function setGrid(on) { root.dataset.grid = on ? 'on' : 'off'; q('#gridToggle').setAttribute('aria-pressed', String(on)); prefs.set('grid', on ? '1' : '0'); }
q('#gridToggle').onclick = () => setGrid(root.dataset.grid !== 'on');
setGrid(prefs.get('grid', '0') === '1');
window.addEventListener('resize', layoutGrid);
for (const name of ['loadedmetadata', 'resize']) q('#view').addEventListener(name, layoutGrid);

/* ---------- ajustes ---------- */

const sheet = q('#setup');
q('#settings').onclick = () => sheet.showModal();
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
q('#heroInvite').onclick = () => { sheet.showModal(); q('#invite').focus?.(); };
q('#heroTest').onclick = () => { location.href = location.pathname + '?teste=1'; };
q('#localTest').onclick = () => { location.href = location.pathname + (localTest ? '' : '?teste=1'); };
q('#fullscreenPref').checked = prefs.get('fullscreen', '1') === '1';
q('#fullscreenPref').onchange = () => prefs.set('fullscreen', q('#fullscreenPref').checked ? '1' : '0');
q('#fullToggle').onclick = toggleFullscreen;
q('#fullHelp').onclick = () => { q('#setup').close(); toggleFullscreen(); };
paintFullscreen();

/* ---------- estado inicial ---------- */

setRun('idle'); tally('offline'); describeHero();
root.dataset.mode = localTest ? 'test' : 'desk';
if (localTest) {
  setStartLabel('ATIVAR TESTE');
  q('#cameraName').textContent = 'Teste neste celular'; q('#stats').textContent = 'SEM TRANSMISSÃO';
  q('#invite').disabled = true; q('#inviteApply').disabled = true; q('#bitrate').disabled = true; q('#ptt').disabled = true;
  q('#notice').textContent = 'Teste local: câmera, microfone e lentes funcionam. Tally e intercom dependem da mesa.';
  q('#localTest').textContent = 'Sair do teste local';
  q('#hear').textContent = 'Ouvir microfone nos fones';
  q('#hear').onclick = async () => {
    if (!cam.running) { say('Ative o teste primeiro.', 'warn'); return; }
    const a = q('#returnAudio');
    if (a.srcObject) { a.pause(); a.srcObject = null; q('#hear').textContent = 'Ouvir microfone nos fones'; return; }
    try {
      a.srcObject = new MediaStream(cam.stream.getAudioTracks()); await a.play();
      q('#hear').textContent = 'Desligar escuta do microfone';
      say('Escuta local ligada. Use fones para evitar microfonia.', 'ok');
    } catch (e) { a.srcObject = null; say('Escuta indisponível: ' + e.message, 'error'); }
  };
  say('Toque em ATIVAR TESTE e permita câmera e microfone. Não é necessário convite.', 'info');
} else if (cam.key && (cam.relay || gateway)) {
  setStartLabel('ATIVAR CÂMERA');
  say('Convite recebido. Toque em ATIVAR CÂMERA e permita câmera e microfone.', 'ok');
} else {
  setStartLabel('CONECTAR');
  say('Abra o link de convite enviado pela mesa.', 'info');
}
