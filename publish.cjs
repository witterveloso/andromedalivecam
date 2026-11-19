'use strict';
/*
 * Sessão de envio (/publish): o navegador manda o PROGRAM em WebM e o serviço codifica e distribui.
 *
 * Um FFmpeg por formato de tela: 16:9 (YouTube, Facebook, Twitch, Kick, LinkedIn…) e 9:16 (Instagram, TikTok…).
 * São processos independentes: se o vertical cair, o 16:9 continua no ar (e vice-versa); a sessão só termina
 * quando o operador para ou quando todos os formatos falham.
 *
 * Autorrecuperação: se o FFmpeg de um formato cair no meio da sessão, ele é reiniciado (até 3 vezes em 2 minutos) e o navegador
 * recebe {type:'restart'} para abrir um gravador novo (o cabeçalho do WebM só existe no começo de cada gravador); até o cabeçalho
 * novo chegar, os pedaços antigos são descartados. Cada reinício grava num arquivo novo (_p2, _p3…), sem sobrescrever o anterior.
 *
 * Protocolo (WebSocket):
 *  - texto: {type:'start', destinations:[{…, aspect}], record:{dir, formats}, vertical:{resolution, bitrate}, channels}
 *           e {type:'stop'}.
 *  - binário: pedaços de WebM (motor padrão) ou de Matroska com H.264 e Opus (start.engine = 'native'). Com channels=2, cada pedaço começa com 1 byte: 0 = 16:9, 1 = 9:16.
 *  - texto também: {type:'engine', reason} (o motor próprio falhou no navegador: o serviço passa ao codificador padrão).
 *  - respostas: ready {groups}, ack, recording, sending, destination, recorded, error, stopped, engine {engine}.
 */
const fs = require('node:fs'), path = require('node:path');
const { WebSocket } = require('ws');
const os = require('node:os');
const { analyze } = require('./avsync.cjs');
const { validateConfig, validateBroadcast, argsFor, argsForGroup, groupsFor, detectEncoders, destinationEvents, redact, safeError, safeBroadcastError } = require('./encoder.cjs');

const MAX_QUEUE = 8 * 1024 * 1024;
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // assinatura do início de um arquivo WebM/Matroska

function handlePublish(ws, { ffmpeg, spawnProcess, audit, license, storage, shared }) {
  let stopping = false, everStarted = false, lastInput = Date.now(), startedAt = 0, broadcast = null, dual = false, calibrating = null, canRestart = false;
  const parts = new Map(), restarts = new Map(); // id do grupo -> arquivos de gravação (um por reinício) / instantes dos reinícios
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
    const records = [...parts.values()].flat();
    const next = () => {
      const record = records.shift();
      if (!record) { send({ type: 'stopped' }); ws.close(); return; }
      finalize(record, saved => { if (calibrating) { measureCalibration(saved, next); return; } if (saved) { audit.info('gravacao', 'arquivo', 'Gravação ' + record.aspect + ' salva', { arquivo: saved.file, formato: record.aspect, MB: Math.round(saved.size / 1e6) }); send({ type: 'recorded', format: record.aspect, ...saved }); } else { audit.error('gravacao', 'arquivo-vazio', 'A gravação ' + record.aspect + ' não gerou arquivo.'); send({ type: 'notice', message: 'Atenção: a gravação ' + record.aspect + ' não gerou arquivo.' }); } next(); });
    };
    next();
  }

  // Calibração do sincronismo: a gravação de teste (clarões + bipes) é medida aqui e apagada em seguida.
  function measureCalibration(saved, next) {
    const dir = calibrating.dir;
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* arquivo temporário preso: o sistema limpa depois */ } };
    if (!saved) { send({ type: 'avsync', error: 'A gravação de teste não gerou arquivo.' }); cleanup(); next(); return; }
    analyze(ffmpeg, saved.file).then(result => { audit.info('sincronismo', 'calibracao', 'Sincronismo medido: som ' + result.offsetMs + ' ms em relação à imagem', { dispersaoMs: result.spreadMs, pares: result.pairs }); send({ type: 'avsync', ...result }); })
      .catch(e => { audit.warn('sincronismo', 'calibracao-falhou', e.message); send({ type: 'avsync', error: e.message }); })
      .finally(() => { cleanup(); next(); });
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

  // Quadros repetidos pelo codificador = quadros que o navegador não entregou (computador sobrecarregado).
  // Se faltarem mais de 40% dos quadros por 5 s seguidos, a mesa avisa: a imagem gravada e transmitida fica travando.
  function starving(r, dups) {
    if (!Number.isFinite(dups) || !r.lastFrame) return;
    const fresh = dups - r.dups; r.dups = dups;
    r.starved = fresh > 12 ? r.starved + 1 : 0;
    if (r.starved < 5 || stopping || Date.now() - r.warnedAt < 60000) return;
    r.warnedAt = Date.now();
    const message = 'Atenção: o computador está entregando poucos quadros para a saída ' + r.group.aspect + ' (a imagem fica travando na gravação e na transmissão). Feche programas pesados ou use 720p.';
    audit.warn('transmissao', 'quadros-faltando', message, { formato: r.group.aspect, repetidosPorSegundo: fresh });
    send({ type: 'notice', overload: true, message });
  }

  // Velocidade real do codificador: quanto de imagem ele produz por segundo de relógio. Com entrada ao vivo, 1,0 é o normal;
  // abaixo disso ele está ficando para trás (computador sobrecarregado). Média das últimas 8 amostras (8 s).
  function load(r) {
    const now = Date.now();
    if (r.prevWall && Number.isFinite(r.curOut) && Number.isFinite(r.prevOut)) {
      r.samples.push({ wall: (now - r.prevWall) / 1000, out: (r.curOut - r.prevOut) / 1e6 }); if (r.samples.length > 8) r.samples.shift();
      const wall = r.samples.reduce((a, s) => a + s.wall, 0), out = r.samples.reduce((a, s) => a + s.out, 0);
      r.speed = wall > 0 ? out / wall : 1;
      if (r.samples.length >= 8 && r.lastFrame > 150 && !stopping) {
        const low = r.speed < .92;
        if (low && now - r.warnedLoad > 60000) {
          r.warnedLoad = now;
          const message = 'Atenção: o computador não está acompanhando a codificação ' + r.group.aspect + ' (' + r.speed.toFixed(2).replace('.', ',') + '× do tempo real). A imagem pode travar. Mesa em modo leve; feche programas pesados, ligue o cabo de força ou use 720p.';
          audit.warn('transmissao', 'sobrecarga', message, { formato: r.group.aspect, velocidade: Math.round(r.speed * 100) / 100 }); send({ type: 'notice', overload: true, message });
        }
      }
      if (now - r.sentHealth > 4000) { r.sentHealth = now; send({ type: 'health', group: r.group.aspect, speed: Math.round(r.speed * 100) / 100 }); }
    }
    r.prevWall = now; r.prevOut = r.curOut;
  }

  // Reinicia o codificador de um formato que caiu. Devolve false se não puder (cliente antigo, já reiniciou 3 vezes em 2 min…).
  function tryRestart(r) {
    if (!canRestart || !broadcast || stopping || r.failed) return false;
    const now = Date.now(), recent = (restarts.get(r.group.id) || []).filter(t => now - t < 120000);
    if (recent.length >= 3) { audit.error('transmissao', 'reinicio-esgotado', 'O codificador ' + r.group.aspect + ' caiu 3 vezes em 2 minutos: sem novas tentativas.'); return false; }
    recent.push(now); restarts.set(r.group.id, recent);
    audit.warn('transmissao', 'reinicio', 'Codificador ' + r.group.aspect + ' reiniciado (tentativa ' + recent.length + ' de 3)', { formato: r.group.aspect });
    const message = 'O codificador ' + r.group.aspect + ' foi reiniciado sozinho (tentativa ' + recent.length + ' de 3). A transmissão volta em instantes.';
    relaunch(r); send({ type: 'restart', group: r.group.id, attempt: recent.length, message }); send({ type: 'notice', message });
    return true;
  }

  // Sobe um FFmpeg novo para o formato, numa gravação nova (_p2, _p3…), e espera o cabeçalho novo do navegador.
  function relaunch(r) {
    const group = { ...r.group }, n = (parts.get(group.id) || []).length + 1;
    if (group.record) group.record = { ...group.record, file: group.record.file.replace(/(_p\d+)?\.mkv$/, '_p' + n + '.mkv') };
    launch(group, argsForGroup(broadcast, group), true);
    runners.get(group.id).awaitHeader = true; // descarta o que o gravador antigo ainda mandar até chegar o cabeçalho novo
    for (const d of group.destinations) send({ type: 'destination', id: d.id, state: 'retrying', reason: 'Codificador reiniciado' });
  }

  // O motor próprio falhou no navegador: o serviço passa todos os formatos para o codificador padrão (WebM) sem encerrar a sessão.
  function useStandardEngine(reason) {
    if (!broadcast || stopping || broadcast.engine !== 'native') return;
    broadcast.engine = 'webm'; audit.warn('transmissao', 'motor-padrao', 'Motor próprio desligado: ' + reason + '. Passando ao codificador padrão.', { motivo: reason });
    for (const r of [...runners.values()]) {
      if (r.failed || r.closed) continue;
      r.dying = true; try { r.child.stdin.end(); } catch { /* já fechado */ }
      r.killTimer = setTimeout(() => r.child?.kill('SIGKILL'), 3500); r.killTimer.unref?.();
      relaunch(r);
    }
    const message = 'Motor próprio indisponível (' + reason + '). A transmissão continua com o codificador padrão.';
    send({ type: 'engine', engine: 'webm', message }); send({ type: 'notice', message });
  }

  function resyncAll(reason) {
    if (!broadcast || stopping) return;
    audit.warn('transmissao', 'resincronizacao', 'Codificador reiniciado a pedido da mesa: ' + reason, { motivo: reason });
    for (const r of [...runners.values()]) {
      if (r.failed || r.closed) continue;
      r.dying = true; try { r.child.stdin.end(); } catch { /* já fechado */ }
      r.killTimer = setTimeout(() => r.child?.kill('SIGKILL'), 3500); r.killTimer.unref?.();
      relaunch(r);
    }
    send({ type: 'notice', message: 'Resolução reduzida: ' + reason + '. A transmissão volta em instantes.' });
  }

  // Erro de escrita no pipe, fechamento do processo e entrada interrompida chegam em ordem imprevisível: o primeiro decide.
  function died(r, message) {
    if (r.dying) return; r.dying = true;
    if (!stopping && tryRestart(r)) return;
    groupFailed(r, message);
  }

  function launch(group, args, restarted = false) {
    const r = { group, child: null, ready: false, lastFrame: 0, lastProgress: Date.now(), stderr: '', progress: '', closed: false, failed: false, killTimer: null, dying: false, awaitHeader: false, dups: 0, starved: 0, warnedAt: 0, samples: [], speed: 1, prevWall: 0, prevOut: 0, curOut: NaN, warnedLoad: 0, sentHealth: 0 };
    runners.set(group.id, r);
    if (group.record) { if (!parts.has(group.id)) parts.set(group.id, []); parts.get(group.id).push({ ...group.record, aspect: group.aspect }); }
    const child = r.child = spawnProcess(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
    // Prioridade acima do normal: em computador apertado, quem disputa a CPU (navegador, antivírus) não deve atrasar o codificador.
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch { /* sem permissão: segue com a prioridade normal */ }
    child.on('spawn', () => { r.ready = true; if (!restarted && [...runners.values()].every(x => x.ready || x.closed)) send({ type: 'ready', groups: [...runners.keys()], message: 'Codificador iniciado. Aguardando sinal PGM.' }); });
    child.on('error', () => groupFailed(r, 'Não foi possível iniciar o FFmpeg. Execute o diagnóstico do pacote.'));
    child.stdin.on('error', () => { if (!stopping) died(r, 'Entrada do codificador interrompida.'); });
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
        if (line.startsWith('dup_frames=')) { starving(r, Number(line.slice(11))); continue; }
        if (line.startsWith('out_time_us=')) { r.curOut = Number(line.slice(12)); continue; }
        if (line === 'progress=continue') { load(r); if (broadcast?.engine === 'native' && Number.isFinite(r.curOut)) progressed(Math.round(r.curOut / 1e6 * 30)); continue; }
        if (!line.startsWith('frame=') || broadcast?.engine === 'native') continue; // com o vídeo apenas copiado o FFmpeg não conta quadros: o tempo de saída (a 30 q/s) faz o papel
        progressed(Number(line.slice(6)));
      }
    });
    function progressed(frames) {
      if (!(frames > r.lastFrame)) return;
      if (!r.lastFrame) audit.info('transmissao', 'enviando', 'Codificador ' + group.aspect + ' produzindo quadros');
      r.lastProgress = Date.now(); r.lastFrame = frames;
      // O primeiro formato da sessão é a referência de quadros mostrada ao operador.
      if (!stopping && group.id === [...runners.keys()][0]) send({ type: 'sending', frames, groups: [...runners.keys()], message: broadcast ? 'Sinal sendo enviado. Confirme a recepção em cada plataforma.' : 'Sinal sendo enviado. Confirme a recepção no YouTube Studio.' });
      for (const [id, t] of troubled) if (Date.now() - t.at > 12000) { troubled.delete(id); audit.info('transmissao', 'destino-recuperado', t.name + ' voltou a receber'); if (!stopping) send({ type: 'destination', id, state: 'sending' }); }
    }
    child.on('close', code => {
      clearTimeout(r.killTimer); r.closed = true;
      if (!stopping && !r.failed) {
        const message = broadcast ? safeBroadcastError(r.stderr) : safeError(r.stderr);
        audit.error('transmissao', 'codificador-encerrou', message, { formato: group.aspect, codigo: code, log: r.stderr.slice(-1500) });
        died(r, message);
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
      if (r.awaitHeader) {
        // O Chrome costuma dividir o começo do WebM em pedaços pequenos (o 1º pode ter 1 byte): procura a assinatura do cabeçalho
        // (1A 45 DF A3) na sequência, inclusive entre dois pedaços, e só então começa a entregar dados ao codificador.
        const joined = r.headTail ? Buffer.concat([r.headTail, chunk]) : chunk, at = joined.indexOf(EBML);
        if (at < 0) { r.headTail = joined.subarray(Math.max(0, joined.length - 3)); send({ type: 'ack', bytes: data.length }); return; }
        r.awaitHeader = false; r.headTail = null; chunk = joined.subarray(at);
      }
      if (r.child.stdin.writableLength + chunk.length > MAX_QUEUE) { groupFailed(r, 'O codificador ' + r.group.aspect + ' não está acompanhando o sinal. Reduza a resolução e tente novamente.'); send({ type: 'ack', bytes: data.length }); return; }
      r.child.stdin.write(chunk, err => { if (err && !stopping) died(r, 'O codificador encerrou a entrada de vídeo.'); else if (!err) send({ type: 'ack', bytes: data.length }); });
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { fail('Comando inválido.'); return; }
    if (msg.type === 'stop') { stop(); return; }
    // O navegador baixou a resolução (regulador de carga): o codificador de cada formato reinicia, abrindo outro FFmpeg e uma gravação nova (_p2…).
    if (msg.type === 'resync' && everStarted) { resyncAll(String(msg.reason || 'mudança de resolução').slice(0, 160)); return; }
    if (msg.type === 'engine' && everStarted) { useStandardEngine(String(msg.reason || 'falha no navegador').slice(0, 160)); return; }
    if (msg.type !== 'start') { fail('Comando não suportado.'); return; }
    if (everStarted) { fail('Abra uma nova sessão para iniciar outra transmissão.'); return; }
    everStarted = true;
    if (shared.active) { fail('Já existe uma transmissão ativa neste serviço. Encerre-a na outra aba.'); return; }
    if (!ffmpeg) { fail('FFmpeg não encontrado. Execute INSTALAR.bat e depois INICIAR.bat.'); return; }
    if (msg.calibrate === true) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sync-'));
      calibrating = { dir };
      msg = { type: 'start', resolution: '720p', bitrate: 3, encoder: 'libx264', destinations: [], record: { dir, formats: '16:9' }, channels: 1, avSyncMs: 0, engine: msg.engine };
    }
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
    dual = multi && msg.channels === 2; canRestart = multi && msg.resync === true && !calibrating;
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
