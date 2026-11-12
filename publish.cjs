'use strict';
/*
 * Sessão de envio (/publish): o navegador manda o PROGRAM em WebM e o serviço codifica e distribui.
 *
 * Um FFmpeg por formato de tela: 16:9 (YouTube, Facebook, Twitch, Kick, LinkedIn…) e 9:16 (Instagram, TikTok…).
 * São processos independentes: se o vertical cair, o 16:9 continua no ar (e vice-versa); a sessão só termina
 * quando o operador para ou quando todos os formatos falham.
 *
 * Protocolo (WebSocket):
 *  - texto: {type:'start', destinations:[{…, aspect}], record:{dir, formats}, vertical:{resolution, bitrate}, channels}
 *           e {type:'stop'}.
 *  - binário: pedaços de WebM. Com channels=2, cada pedaço começa com 1 byte: 0 = 16:9, 1 = 9:16.
 *  - respostas: ready {groups}, ack, recording, sending, destination, recorded, error, stopped.
 */
const fs = require('node:fs'), path = require('node:path');
const { WebSocket } = require('ws');
const { validateConfig, validateBroadcast, argsFor, argsForGroup, groupsFor, detectEncoders, destinationEvents, redact, safeError, safeBroadcastError } = require('./encoder.cjs');

const MAX_QUEUE = 8 * 1024 * 1024;

function handlePublish(ws, { ffmpeg, spawnProcess, audit, license, storage, shared }) {
  let stopping = false, everStarted = false, lastInput = Date.now(), startedAt = 0, broadcast = null, dual = false;
  const runners = new Map(); // id do grupo -> { group, child, ready, lastFrame, lastProgress, stderr, progress, closed, killTimer }
  const troubled = new Map();
  const send = data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const alive = () => [...runners.values()].filter(r => !r.closed);

  const stop = () => {
    if (stopping) return; stopping = true;
    const open = alive();
    if (!open.length) { finish(); return; }
    for (const r of open) { try { r.child.stdin.end(); } catch { /* já fechado */ } r.killTimer = setTimeout(() => r.child?.kill('SIGKILL'), broadcast ? 8000 : 3500); r.killTimer.unref?.(); }
  };
  const fail = message => { audit.error('transmissao', 'falha', message); send({ type: 'error', message }); stop(); };

  // Depois de parar, o MKV (à prova de queda) vira MP4 sem recodificar.
  const finalize = (record, done) => {
    let size = 0; try { size = fs.statSync(record.file).size; } catch { /* sem arquivo */ }
    if (size < 1024) { done(null); return; }
    const mp4 = record.file.replace(/\.mkv$/, '.mp4');
    const mux = spawnProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', record.file, '-c', 'copy', '-movflags', '+faststart', mp4], { shell: false, windowsHide: true, stdio: 'ignore' });
    mux.on('error', () => done({ file: record.file, size }));
    mux.on('close', code => {
      let out = 0; try { out = fs.statSync(mp4).size; } catch { /* sem saída */ }
      const drop = file => { try { fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { audit.warn('gravacao', 'arquivo-preso', 'Não foi possível apagar ' + path.basename(file) + ': ' + e.code); } };
      if (code === 0 && out > size * 0.9) { drop(record.file); done({ file: mp4, size: out }); } else { drop(mp4); done({ file: record.file, size }); }
    });
  };

  let finished = false;
  function finish() {
    if (finished) return; finished = true;
    clearInterval(watchdog);
    if (shared.active === ws) shared.active = null;
    if (startedAt) audit.info('transmissao', 'fim', 'Envio encerrado', { segundos: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0, quadros: Math.max(0, ...[...runners.values()].map(r => r.lastFrame)), formatos: [...runners.keys()] });
    const records = [...runners.values()].map(r => r.group?.record).filter(Boolean);
    const next = () => {
      const record = records.shift();
      if (!record) { send({ type: 'stopped' }); ws.close(); return; }
      finalize(record, saved => { if (saved) { audit.info('gravacao', 'arquivo', 'Gravação salva', { arquivo: saved.file, MB: Math.round(saved.size / 1e6) }); send({ type: 'recorded', ...saved }); } next(); });
    };
    next();
  }

  const watchdog = setInterval(() => {
    if (stopping || !alive().length) return;
    if (Date.now() - lastInput > 10000) { fail('O navegador parou de enviar o sinal. Transmissão encerrada.'); return; }
    for (const r of alive()) if (Date.now() - r.lastProgress > 30000) groupFailed(r, 'Sem progresso do codificador por 30 segundos. Confira a conexão e reinicie.');
  }, 1000);
  watchdog.unref?.();

  // Um formato falhou: os destinos dele ficam em erro; os outros formatos continuam no ar.
  function groupFailed(r, message) {
    if (r.failed) return; r.failed = true;
    const others = alive().filter(x => x !== r);
    if (!others.length || stopping) { fail(message); return; }
    audit.error('transmissao', 'formato-falhou', 'Saída ' + r.group.aspect + ' interrompida: ' + message, { destinos: r.group.destinations.map(d => d.name) });
    for (const d of r.group.destinations) send({ type: 'destination', id: d.id, state: 'error', reason: 'Saída ' + r.group.aspect + ' interrompida: ' + message });
    if (r.group.record) send({ type: 'notice', message: 'A gravação ' + r.group.aspect + ' parou. A outra saída continua.' });
    try { r.child.stdin.end(); } catch { /* já fechado */ }
    r.killTimer = setTimeout(() => r.child?.kill('SIGKILL'), 3000); r.killTimer.unref?.();
  }

  function launch(group, args) {
    const r = { group, child: null, ready: false, lastFrame: 0, lastProgress: Date.now(), stderr: '', progress: '', closed: false, failed: false, killTimer: null };
    runners.set(group.id, r);
    const child = r.child = spawnProcess(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
    child.on('spawn', () => { r.ready = true; if ([...runners.values()].every(x => x.ready || x.closed)) send({ type: 'ready', groups: [...runners.keys()], message: 'Codificador iniciado. Aguardando sinal PGM.' }); });
    child.on('error', () => groupFailed(r, 'Não foi possível iniciar o FFmpeg. Execute o diagnóstico do pacote.'));
    child.stdin.on('error', () => { if (!stopping) groupFailed(r, 'Entrada do codificador interrompida.'); });
    child.stderr.on('data', d => {
      const text = d.toString();
      r.stderr = (r.stderr + (broadcast ? redact(text, { destinations: group.destinations }) : text)).slice(-8192);
      if (!broadcast || stopping) return;
      for (const ev of destinationEvents(text, { destinations: group.destinations })) {
        const seen = troubled.get(ev.id);
        if (!seen) audit.warn('transmissao', 'destino-reconectando', ev.name + ': ' + ev.reason + '. Tentando reconectar.');
        if (!seen || Date.now() - seen.sent > 4000) send({ type: 'destination', ...ev });
        troubled.set(ev.id, { at: Date.now(), sent: !seen || Date.now() - seen.sent > 4000 ? Date.now() : seen.sent, name: ev.name });
      }
    });
    child.stdio[3].on('data', d => {
      r.progress += d.toString(); let idx;
      while ((idx = r.progress.indexOf('\n')) >= 0) {
        const line = r.progress.slice(0, idx).trim(); r.progress = r.progress.slice(idx + 1);
        if (!line.startsWith('frame=')) continue;
        const frames = Number(line.slice(6)); if (!(frames > r.lastFrame)) continue;
        if (!r.lastFrame) audit.info('transmissao', 'enviando', 'Codificador ' + group.aspect + ' produzindo quadros');
        r.lastProgress = Date.now(); r.lastFrame = frames;
        // O primeiro formato da sessão é a referência de quadros mostrada ao operador.
        if (!stopping && group.id === [...runners.keys()][0]) send({ type: 'sending', frames, groups: [...runners.keys()], message: broadcast ? 'Sinal sendo enviado. Confirme a recepção em cada plataforma.' : 'Sinal sendo enviado. Confirme a recepção no YouTube Studio.' });
        for (const [id, t] of troubled) if (Date.now() - t.at > 12000) { troubled.delete(id); audit.info('transmissao', 'destino-recuperado', t.name + ' voltou a receber'); if (!stopping) send({ type: 'destination', id, state: 'sending' }); }
      }
    });
    child.on('close', code => {
      clearTimeout(r.killTimer); r.closed = true;
      if (!stopping && !r.failed) {
        const message = broadcast ? safeBroadcastError(r.stderr) : safeError(r.stderr);
        audit.error('transmissao', 'codificador-encerrou', message, { formato: group.aspect, codigo: code, log: r.stderr.slice(-1500) });
        groupFailed(r, message);
      }
      r.child = null;
      if (!alive().length) finish();
    });
  }

  ws.on('message', (data, binary) => {
    if (binary) {
      if (stopping || !runners.size) return;
      lastInput = Date.now();
      let id = [...runners.keys()][0], chunk = data;
      if (dual) { id = data[0] === 1 ? 'v' : 'h'; chunk = data.subarray(1); }
      const r = runners.get(id);
      if (!r || !r.ready || r.closed || r.failed) { send({ type: 'ack', bytes: data.length }); return; }
      if (r.child.stdin.writableLength + chunk.length > MAX_QUEUE) { groupFailed(r, 'O codificador ' + r.group.aspect + ' não está acompanhando o sinal. Reduza a resolução e tente novamente.'); send({ type: 'ack', bytes: data.length }); return; }
      r.child.stdin.write(chunk, err => { if (err && !stopping) groupFailed(r, 'O codificador encerrou a entrada de vídeo.'); else if (!err) send({ type: 'ack', bytes: data.length }); });
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { fail('Comando inválido.'); return; }
    if (msg.type === 'stop') { stop(); return; }
    if (msg.type !== 'start') { fail('Comando não suportado.'); return; }
    if (everStarted) { fail('Abra uma nova sessão para iniciar outra transmissão.'); return; }
    everStarted = true;
    if (shared.active) { fail('Já existe uma transmissão ativa neste serviço. Encerre-a na outra aba.'); return; }
    if (!ffmpeg) { fail('FFmpeg não encontrado. Execute INSTALAR.bat e depois INICIAR.bat.'); return; }
    const multi = Array.isArray(msg.destinations) || !!msg.record;
    let cfg, groups;
    try {
      if (multi) {
        const lic = license.status(); if (!lic.valid) throw Error(lic.message);
        cfg = validateBroadcast(msg);
        if (cfg.record) cfg.record.space = storage.checkDir(cfg.record.dir);
        if (!detectEncoders(ffmpeg).includes(cfg.encoder)) cfg.encoder = 'libx264';
        groups = groupsFor(cfg);
        if (groups.length > 1 && msg.channels !== 2) throw Error('Atualize a mesa: esta transmissão precisa das saídas 16:9 e 9:16.');
      } else cfg = validateConfig(msg);
    } catch (e) { fail(e.message); return; }
    dual = multi && msg.channels === 2;
    shared.active = ws; broadcast = multi ? cfg : null; startedAt = Date.now(); lastInput = Date.now();
    audit.info('transmissao', 'inicio', multi ? 'Envio iniciado: ' + (cfg.destinations.map(d => d.name + ' (' + d.aspect + ')').join(', ') || 'somente gravação') + (cfg.record ? ' + gravação ' + (cfg.record.formats === 'both' ? '16:9 e 9:16' : cfg.record.formats) : '') : 'Envio iniciado: YouTube',
      { resolucao: cfg.resolution, bitrateMbps: cfg.bitrate, codificador: cfg.encoder || 'libx264', destinos: multi ? cfg.destinations.map(d => d.name) : ['YouTube'], gravacao: cfg.record?.dir || null, formatos: multi ? groups.map(g => g.aspect + ' ' + g.size.replace(':', '×')) : ['16:9'] });
    if (multi) {
      for (const d of cfg.destinations) if (d.warning) { send({ type: 'destination', id: d.id, state: 'warning', reason: d.warning }); audit.warn('transmissao', 'destino-suspeito', d.warning); }
      for (const g of groups) if (g.record) send({ type: 'recording', file: g.record.file, format: g.aspect, free: cfg.record.space.free });
      for (const g of groups) launch(g, argsForGroup(cfg, g));
    } else {
      launch({ id: 'h', aspect: '16:9', destinations: [], record: null }, argsFor(cfg));
      cfg.target = ''; msg.key = '';
    }
  });
  ws.on('error', () => stop());
  ws.on('close', () => { stop(); if (!alive().length && shared.active === ws) shared.active = null; });
}

module.exports = { handlePublish };
