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
 * Saídas Andrômeda: o codificador de cada formato entrega a imagem pronta ao distribuidor (saidas.cjs), que mantém uma conexão
 * por destino. Cada destino entra e sai do ar sozinho, com a live rodando: {type:'output', id, action:'start'|'stop', destination?}.
 * Destinos com on:false começam em espera (o formato deles já fica pronto para entrarem quando o operador quiser).
 *
 * Protocolo (WebSocket):
 *  - texto: {type:'start', destinations:[{…, aspect, on}], record:{dir, formats}, vertical:{resolution, bitrate}, channels}
 *           {type:'output', id, action, destination?} e {type:'stop'}.
 *  - binário: pedaços de WebM (motor padrão) ou de Matroska com H.264 e Opus (start.engine = 'native'). Com channels=2, cada pedaço começa com 1 byte: 0 = 16:9, 1 = 9:16.
 *  - texto também: {type:'engine', reason} (o motor próprio falhou no navegador: o serviço passa ao codificador padrão).
 *  - respostas: ready {groups}, ack, recording, sending, destination, recorded, error, stopped, engine {engine}.
 */
const fs = require('node:fs'), path = require('node:path');
const { WebSocket } = require('ws');
const os = require('node:os');
const { analyze } = require('./avsync.cjs');
const { CFR30, validateConfig, validateBroadcast, validateDestination, MAX_DESTINATIONS, argsFor, argsForGroup, groupsFor, detectEncoders, redact, safeError, safeBroadcastError } = require('./encoder.cjs');
const { createOutputs } = require('./saidas.cjs');

const MAX_QUEUE = 8 * 1024 * 1024;
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // assinatura do início de um arquivo WebM/Matroska

function handlePublish(ws, { ffmpeg, spawnProcess, audit, license, storage, shared }) {
  let stopping = false, everStarted = false, lastInput = Date.now(), startedAt = 0, broadcast = null, dual = false, calibrating = null, canRestart = false;
  const parts = new Map(), restarts = new Map(); // id do grupo -> arquivos de gravação (um por reinício) / instantes dos reinícios
  const runners = new Map(); // id do grupo -> { group, child, ready, lastFrame, lastProgress, stderr, progress, closed, killTimer }
  const send = data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const outputs = createOutputs({ ffmpeg, spawnProcess, send, audit });
  // Resumo das saídas a cada 2 s (estado e taxa real de cada destino), para a mesa mostrar no cartão de cada um.
  const outputsTimer = setInterval(() => { if (broadcast && !stopping) send({ type: 'outputs', list: outputs.status() }); }, 2000); outputsTimer.unref?.();
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
    // 30 fps cravados no arquivo final: o MKV de segurança guarda o tempo em ms (33/34 ms); o MP4 volta cada quadro para a grade
    // exata de 1/30 s (relógio de 90 kHz). Programas de edição leem o arquivo como 30 fps constantes, sem aviso de taxa variável.
    const mux = spawnProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', record.file, '-map', '0', '-c', 'copy', '-bsf:v', CFR30, '-video_track_timescale', '90000', '-movflags', '+faststart', mp4], { shell: false, windowsHide: true, stdio: 'ignore' });
    mux.on('error', () => done({ file: record.file, size }));
    mux.on('close', code => {
      let out = 0; try { out = fs.statSync(mp4).size; } catch { /* sem saída */ }
      const drop = file => { try { fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { audit.warn('gravacao', 'arquivo-preso', 'Não foi possível apagar ' + path.basename(file) + ': ' + e.code); } };
      if (code === 0 && out > size * 0.9) { drop(record.file); done({ file: mp4, size: out }); } else { drop(mp4); done({ file: record.file, size }); }
    });
  };

  let finished = false, receivedMedia = false;
  function finish() {
    if (finished) return; finished = true;
    clearInterval(watchdog); clearInterval(outputsTimer); outputs.close();
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
    if (Date.now() - lastInput > (receivedMedia ? 10000 : 25000)) { fail(receivedMedia ? 'A captura parou de entregar pacotes ao codificador por 10 segundos.' : 'A captura do PGM não entregou o primeiro pacote ao codificador em 25 segundos.'); return; }
    for (const r of alive()) if (Date.now() - r.lastProgress > 30000) groupFailed(r, 'Sem progresso do codificador por 30 segundos. Confira a conexão e reinicie.');
  }, 1000);
  watchdog.unref?.();

  // Um formato falhou: os destinos dele ficam em erro; os outros formatos continuam no ar.
  function groupFailed(r, message) {
    if (r.failed) return; r.failed = true;
    const others = alive().filter(x => x !== r);
    if (!others.length || stopping) { fail(message); return; }
    audit.error('transmissao', 'formato-falhou', 'Saída ' + r.group.aspect + ' interrompida: ' + message, { destinos: r.group.destinations.map(d => d.name) });
    outputs.endGroup(r.group.id);
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
    outputs.resetGroup(group.id); // tempos novos: os destinos ligados reabrem a conexão a partir do primeiro quadro-chave novo
    launch(group, argsForGroup(broadcast, group), true);
    runners.get(group.id).awaitHeader = true; // descarta o que o gravador antigo ainda mandar até chegar o cabeçalho novo
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
    const feeds = !!broadcast && group.destinations.length > 0;
    if (feeds) outputs.group(group.id, { size: group.size });
    const child = r.child = spawnProcess(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['pipe', feeds ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    // A imagem codificada vai ao distribuidor, que repassa a cada destino ligado. Se este processo for o antigo de um reinício, descarta.
    if (feeds) child.stdout.on('data', d => { if (runners.get(group.id) === r) outputs.feed(group.id, d); });
    child.on('spawn', () => { r.ready = true; if (!restarted && [...runners.values()].every(x => x.ready || x.closed)) send({ type: 'ready', groups: [...runners.keys()], message: 'Codificador iniciado. Aguardando sinal PGM.' }); });
    child.on('error', () => groupFailed(r, 'Não foi possível iniciar o FFmpeg. Execute o diagnóstico do pacote.'));
    child.stdin.on('error', () => { if (!stopping) died(r, 'Entrada do codificador interrompida.'); });
    child.stderr.on('data', d => {
      const text = d.toString();
      r.stderr = (r.stderr + (broadcast ? redact(text, { destinations: group.destinations }) : text)).slice(-8192);
    });
    child.stdio[3].on('data', d => {
      r.progress += d.toString(); let idx;
      while ((idx = r.progress.indexOf('\n')) >= 0) {
        const line = r.progress.slice(0, idx).trim(); r.progress = r.progress.slice(idx + 1);
        if (line.startsWith('dup_frames=')) { starving(r, Number(line.slice(11))); continue; }
        if (line.startsWith('out_time_us=')) { r.curOut = Number(line.slice(12)); continue; }
        if (line === 'progress=continue') {
          if (broadcast?.engine !== 'native') {
            const now = Date.now(), prev = r.cadenceSample;
            if (!prev || now - prev.at >= 15000) {
              if (prev) {
                const dt = (now - prev.at) / 1000;
                audit.info('transmissao', 'cadencia-saida', 'Cadência medida na saída ' + group.aspect, {
                  formato: group.aspect, fpsSaida: +((r.lastFrame - prev.frames) / dt).toFixed(1),
                  repetidos: r.dups - prev.dups, segundos: +dt.toFixed(1)
                });
              }
              r.cadenceSample = { at: now, frames: r.lastFrame, dups: r.dups };
            }
          }
          load(r); if (broadcast?.engine === 'native' && Number.isFinite(r.curOut)) progressed(Math.round(r.curOut / 1e6 * 30)); continue; }
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
    }
    child.on('close', code => {
      clearTimeout(r.killTimer); r.closed = true;
      // Fim de verdade deste formato (não um reinício): os destinos dele encerram junto com o sinal.
      if (runners.get(group.id) === r && (stopping || r.failed)) outputs.endGroup(group.id);
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
      if (!r.receivedMedia && chunk.length) {
        r.receivedMedia = receivedMedia = true;
        audit.info('transmissao', 'primeiro-pacote', 'Primeiro pacote recebido da mesa', { formato: r.group.aspect, bytes: chunk.length, esperaMs: Date.now() - startedAt });
      }
      if (r.awaitHeader) {
        // O Chrome costuma dividir o começo do WebM em pedaços pequenos (o 1º pode ter 1 byte): procura a assinatura do cabeçalho
        // (1A 45 DF A3) na sequência, inclusive entre dois pedaços, e só então começa a entregar dados ao codificador.
        const joined = r.headTail ? Buffer.concat([r.headTail, chunk]) : chunk, at = joined.indexOf(EBML);
        if (at < 0) { r.headTail = joined.subarray(Math.max(0, joined.length - 3)); send({ type: 'ack', bytes: data.length }); return; }
        r.awaitHeader = false; r.headTail = null; chunk = joined.subarray(at);
      }
      const maxQueue = r.group.size === '3840:2160' ? 32 * 1024 * 1024 : MAX_QUEUE;
      if (r.child.stdin.writableLength + chunk.length > maxQueue) { groupFailed(r, 'O codificador ' + r.group.aspect + ' não está acompanhando o sinal. Reduza a resolução e tente novamente.'); send({ type: 'ack', bytes: data.length }); return; }
      r.child.stdin.write(chunk, err => { if (err && !stopping) died(r, 'O codificador encerrou a entrada de vídeo.'); else if (!err) send({ type: 'ack', bytes: data.length }); });
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { fail('Comando inválido.'); return; }
    if (msg.type === 'stop') { stop(); return; }
    // O navegador baixou a resolução (regulador de carga): o codificador de cada formato reinicia, abrindo outro FFmpeg e uma gravação nova (_p2…).
    if (msg.type === 'resync' && everStarted) { resyncAll(String(msg.reason || 'mudança de resolução').slice(0, 160)); return; }
    if (msg.type === 'engine' && everStarted) { useStandardEngine(String(msg.reason || 'falha no navegador').slice(0, 160)); return; }
    if (msg.type === 'output') { output(msg); return; }
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
      for (const g of groups) for (const d of g.destinations) outputs.add(d, g.id);
      for (const d of cfg.destinations) if (!d.on) send({ type: 'destination', id: d.id, state: 'standby', reason: '' });
      for (const d of cfg.destinations) if (d.warning) { send({ type: 'destination', id: d.id, state: 'warning', reason: d.warning }); audit.warn('transmissao', 'destino-suspeito', d.warning); }
      for (const g of groups) if (g.record) send({ type: 'recording', file: g.record.file, format: g.aspect, free: cfg.record.space.free });
      for (const g of groups) launch(g, argsForGroup(cfg, g));
      for (const d of cfg.destinations) if (d.on) outputs.start(d.id);
    } else {
      launch({ id: 'h', aspect: '16:9', destinations: [], record: null }, argsFor(cfg));
      cfg.target = ''; msg.key = '';
    }
  });
  // Liga ou desliga um destino com a live no ar. Um destino novo (adicionado durante a live) entra se o formato dele já estiver rodando.
  function output(msg) {
    if (!broadcast || stopping) return;
    const id = String(msg.id || '').slice(0, 40), reject = reason => send({ type: 'destination', id, state: 'error', reason });
    if (msg.action === 'stop') { outputs.stop(id); return; }
    if (msg.action !== 'start') return;
    // Destino já conhecido, fora do ar, com configuração nova (chave, servidor, senha): vale a configuração que o operador vê agora.
    if (outputs.has(id) && msg.destination) {
      let d; try { d = validateDestination({ ...msg.destination, id }, id); } catch (e) { reject(e.message); return; }
      const i = broadcast.destinations.findIndex(x => x.id === id), old = broadcast.destinations[i];
      if (old && d.target !== old.target) {
        const g = [...runners.values()].find(r => r.group.id === outputs.groupOf(id));
        if (d.aspect !== old.aspect || !g) { reject('Para trocar o formato de um destino, tire-o da live e adicione de novo.'); return; }
        if (broadcast.destinations.some(x => x.id !== id && x.target === d.target)) { reject('Já existe um destino com o mesmo servidor e a mesma chave.'); return; }
        if (outputs.update(id, d)) { broadcast.destinations[i] = d; const j = g.group.destinations.findIndex(x => x.id === id); if (j >= 0) g.group.destinations[j] = d; audit.info('saidas', 'destino-atualizado', d.name + ': configuração nova antes de entrar no ar'); }
      }
    }
    if (!outputs.has(id)) {
      let d; try { d = validateDestination({ ...(msg.destination || {}), id }, id); } catch (e) { reject(e.message); return; }
      if (broadcast.destinations.length >= MAX_DESTINATIONS) { reject('Use no máximo ' + MAX_DESTINATIONS + ' destinos simultâneos.'); return; }
      if (broadcast.destinations.some(x => x.target === d.target)) { reject('Já existe um destino com o mesmo servidor e a mesma chave.'); return; }
      const g = [...runners.values()].find(r => r.group.aspect === d.aspect && !r.failed && r.group.destinations.length);
      if (!g) { reject('A saída ' + d.aspect + ' não foi preparada nesta live. Para entrar no meio da live, deixe o destino em espera antes de começar.'); return; }
      broadcast.destinations.push(d); g.group.destinations.push(d); outputs.add(d, g.group.id);
      if (d.warning) send({ type: 'destination', id, state: 'warning', reason: d.warning });
    }
    outputs.start(id);
  }

  ws.on('error', () => stop());
  ws.on('close', () => { stop(); if (!alive().length && shared.active === ws) shared.active = null; });
}

module.exports = { handlePublish };
