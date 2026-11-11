'use strict';
/*
 * Andromeda Cam — câmera de contribuição por convite (WebRTC).
 * O mesmo arquivo é publicado em docs/ (GitHub Pages) e em public/cam/ (gateway);
 * test/cam-sync.test.cjs falha se as duas cópias divergirem.
 */
const localTest = new URLSearchParams(location.search).get('teste') === '1';
const gateway = String(window.ANDROMEDA_GATEWAY || '').replace(/\/+$/, '');
const KEY = /^[a-f0-9]{48}$/;
const q = s => document.querySelector(s);
const root = q('body');
const cam = {
  stream: null, ws: null, pcs: new Map(), ice: [],
  key: KEY.test(location.hash.slice(1)) ? location.hash.slice(1) : '',
  running: false, muted: false, talking: false,
  lastTally: 0, shownTally: '', started: 0, generation: 0, retry: null,
  ac: null, meter: null, intercomTrack: null, wake: null, lastBytes: 0, lastStatsAt: 0,
};
const prefs = {
  get(name, fallback) { try { const v = localStorage.getItem('andromeda.cam.' + name); return v === null ? fallback : v; } catch { return fallback; } },
  set(name, value) { try { localStorage.setItem('andromeda.cam.' + name, value); } catch { /* armazenamento indisponível */ } },
};

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
  q('#heroInvite').hidden = localTest || !gateway || !!cam.key;
  q('#heroTest').hidden = localTest;
  if (localTest) set('Teste local da câmera', 'Câmera e microfone ligam apenas neste aparelho. Nenhum sinal é enviado à mesa.');
  else if (!gateway) set('Página ainda sem mesa', 'O endereço do gateway não foi configurado pelo administrador. O teste local funciona normalmente.');
  else if (cam.key) set('Convite recebido', 'Conecte os fones, toque em ATIVAR CÂMERA e permita câmera e microfone.');
  else set('Abra o convite da mesa', 'Use o link privado enviado pelo diretor de TV ou cole o convite aqui.');
}

/* ---------- sinalização ---------- */

function send(message) { if (cam.ws?.readyState === WebSocket.OPEN) cam.ws.send(JSON.stringify(message)); }
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

function lensName(label, index) {
  const l = String(label || '').toLowerCase();
  if (/front|frontal|user|selfie/.test(l)) return 'Frontal';
  if (/ultra/.test(l)) return 'Ultra-wide';
  if (/tele/.test(l)) return 'Tele';
  if (/dual|triple|dupla|tripla/.test(l)) return 'Auto';
  return index ? 'Lente ' + (index + 1) : 'Principal';
}
function renderLenses() {
  const select = q('#lens'), box = q('#lensChips'), options = [...select.options];
  box.replaceChildren(); box.hidden = options.length < 2;
  options.forEach((option, index) => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'lens';
    chip.textContent = lensName(option.text, index);
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(option.value === select.value));
    chip.setAttribute('title', option.text || 'Câmera ' + (index + 1));
    chip.onclick = () => { if (select.value === option.value) return; select.value = option.value; select.onchange(); };
    box.append(chip);
  });
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
  const track = cam.stream.getVideoTracks()[0], c = track.getCapabilities?.() || {}, s = track.getSettings();
  q('#qualityActual').textContent = s.width + '×' + s.height + ' · ' + Math.round(s.frameRate || 0) + ' fps';
  const box = q('#manual'); box.replaceChildren();
  const apply = (name, value) => track.applyConstraints({ advanced: [{ [name]: value }] }).catch(e => say(e.message, 'warn'));
  for (const [name, label] of [['focusMode', 'Foco'], ['exposureMode', 'Exposição'], ['whiteBalanceMode', 'Balanço de branco']]) {
    const row = document.createElement('label'), select = document.createElement('select');
    row.textContent = label;
    for (const v of c[name] || []) select.add(new Option(v, v));
    select.disabled = !c[name]?.length;
    if (select.disabled) select.add(new Option('Não exposto neste aparelho', ''));
    select.value = s[name] || select.value;
    select.onchange = () => apply(name, select.value);
    row.append(select); box.append(row);
  }
  for (const [name, label] of [['exposureCompensation', 'Compensação de exposição'], ['focusDistance', 'Distância de foco'], ['iso', 'ISO']]) {
    if (!c[name]) continue;
    const row = document.createElement('label'), input = document.createElement('input');
    row.textContent = label;
    Object.assign(input, { type: 'range', min: c[name].min, max: c[name].max, step: c[name].step || .1, value: s[name] || c[name].min });
    input.onchange = () => apply(name, Number(input.value));
    row.append(input); box.append(row);
  }
  if (c.torch) {
    const row = document.createElement('label'), input = document.createElement('input');
    row.className = 'check'; input.type = 'checkbox';
    input.onchange = () => apply('torch', input.checked);
    row.append(input, 'Lanterna'); box.append(row);
  }
  layoutGrid();
}

async function bitrate() {
  const p = cam.pcs.get('media'); if (!p) return;
  const sender = p.pc.getSenders().find(s => s.track?.kind === 'video'); if (!sender) return;
  const params = sender.getParameters(); if (!params.encodings?.length) return;
  params.encodings[0].maxBitrate = Math.max(1, Math.min(12, Number(q('#bitrate').value) || 3)) * 1000000;
  await sender.setParameters(params);
}
q('#bitrate').onchange = () => bitrate().catch(e => say(e.message, 'warn'));

// Troca de lente física: a câmera atual precisa ser liberada antes de abrir a próxima.
q('#lens').onchange = async () => {
  if (!cam.stream) { renderLenses(); return; }
  const old = cam.stream.getVideoTracks()[0], previous = old.getSettings().deviceId;
  const open = async deviceId => (await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId), audio: false })).getVideoTracks()[0];
  old.stop();
  let track;
  try { track = await open(q('#lens').value); }
  catch (e) {
    say('Troca de lente falhou: ' + e.message, 'error');
    try { track = await open(previous); q('#lens').value = previous; } catch { /* a lente anterior também não abriu */ }
  }
  if (track) {
    cam.stream.removeTrack(old); cam.stream.addTrack(track); q('#view').srcObject = cam.stream;
    const sender = cam.pcs.get('media')?.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track).catch(e => say('Troca de lente falhou: ' + e.message, 'error'));
    showCapabilities();
  }
  renderLenses();
};
for (const id of ['#resolution', '#fps', '#input']) q(id).onchange = () => { if (cam.running) say('Pare e reconecte para aplicar resolução, fps ou microfone. A prévia mostra o formato real atual.', 'warn'); };

/* ---------- WebRTC ---------- */

async function makePeer(lane) {
  const pc = new RTCPeerConnection({ iceServers: cam.ice }), p = { pc, queue: [] };
  cam.pcs.set(lane, p);
  pc.onicecandidate = e => { if (e.candidate) send({ type: 'signal', lane, signal: { candidate: e.candidate.toJSON() } }); };
  if (lane === 'media') for (const t of cam.stream.getTracks()) pc.addTrack(t, cam.stream);
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
    if (pc.connectionState === 'connected') { say('Vídeo conectado à mesa. O tally indica o barramento PGM, não a confirmação do YouTube.', 'ok'); q('#ptt').disabled = false; }
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

function signal() {
  if (!cam.running) return;
  const generation = ++cam.generation; cleanPeers();
  const ws = new WebSocket(gateway.replace(/^http/, 'ws') + '/signal'); cam.ws = ws;
  ws.onopen = () => send({ type: 'join', key: cam.key });
  let chain = Promise.resolve();
  ws.onmessage = e => { if (generation !== cam.generation) return; chain = chain.then(() => message(JSON.parse(e.data))).catch(err => say('Conexão: ' + err.message, 'error')); };
  ws.onerror = () => {};
  ws.onclose = e => {
    if (generation !== cam.generation) return;
    cleanPeers(); tally('offline'); q('#ptt').disabled = true;
    if ([4001, 4002, 4003].includes(e.code)) { stop(); say('Convite inválido, ocupado, revogado ou expirado. Peça outro à mesa.', 'error'); return; }
    say('Reconectando à mesa…', 'warn');
    if (cam.running) { clearTimeout(cam.retry); cam.retry = setTimeout(signal, 2500); }
  };
}

/* ---------- convite ---------- */

function readInvite(text) {
  text = String(text || '').trim();
  if (KEY.test(text)) return { key: text };
  let url; try { url = new URL(text); } catch { return { error: 'Convite inválido. Cole o link completo recebido da mesa.' }; }
  if (url.origin !== location.origin) return { error: 'Abra o convite no endereço indicado pela mesa.' };
  return KEY.test(url.hash.slice(1)) ? { key: url.hash.slice(1) } : { error: 'Convite inválido. Cole o link completo recebido da mesa.' };
}
function useInvite() {
  const result = readInvite(q('#invite').value);
  if (result.error) { say(result.error, 'error'); return false; }
  cam.key = result.key; q('#invite').value = '';
  return true;
}
q('#inviteApply').onclick = () => {
  if (!q('#invite').value) { say('Cole o link de convite gerado na mesa.', 'warn'); return; }
  if (!useInvite()) return;
  q('#setup').close(); describeHero(); setStartLabel('ATIVAR CÂMERA');
  say('Convite carregado. Conecte os fones e toque em ATIVAR CÂMERA.', 'ok');
};

/* ---------- iniciar e parar ---------- */

function captureError(e) {
  if (e.name === 'InviteError') return e.message;
  if (e.name === 'NotAllowedError') return 'Permissão negada. Libere câmera e microfone nas permissões do site e toque de novo.';
  if (e.name === 'NotFoundError') return 'Nenhuma câmera ou microfone foi encontrado neste aparelho.';
  if (e.name === 'NotReadableError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
  if (e.name === 'OverconstrainedError') return 'Este aparelho não oferece a lente ou a resolução escolhida. Mude nos ajustes.';
  return 'Não foi possível capturar câmera/microfone: ' + e.message;
}

async function start() {
  if (!localTest && !gateway) { say('Página publicada. O serviço da mesa ainda precisa ser configurado pelo administrador.', 'warn'); return; }
  if (!isSecureContext) { say('Abra o endereço HTTPS do gateway. A câmera não funciona por HTTP de IP local.', 'error'); return; }
  if (!localTest && q('#invite').value && !useInvite()) return;
  if (!localTest && !KEY.test(cam.key)) { q('#setup').showModal(); say('Cole um convite válido gerado na mesa.', 'warn'); return; }
  q('#start').disabled = true; setRun('starting');
  if (prefs.get('fullscreen', '1') === '1') document.documentElement?.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  try {
    if (!localTest) {
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
} else if (!gateway) {
  q('#start').disabled = true; setStartLabel('SEM MESA');
  say('Gateway não configurado. Esta página ainda não está conectada à mesa.', 'warn');
} else if (cam.key) {
  setStartLabel('ATIVAR CÂMERA');
  say('Convite recebido. Toque em ATIVAR CÂMERA e permita câmera e microfone.', 'ok');
} else {
  setStartLabel('CONECTAR');
  say('Abra o link de convite enviado pela mesa.', 'info');
}
