'use strict';
/*
 * Saídas Andrômeda — distribuidor próprio de destinos.
 *
 * A imagem continua sendo codificada UMA vez por formato (16:9 e 9:16). O codificador entrega o resultado já pronto
 * (H.264 + AAC, em FLV interno) ao serviço, e o serviço repassa a mesma imagem a cada destino por uma conexão própria:
 *
 *   codificador 16:9 ──► distribuidor ──► YouTube   (RTMPS)   ← liga e desliga sozinho, com a live no ar
 *                                     ├──► Facebook  (RTMPS)
 *                                     └──► Servidor  (SRT)
 *
 * - Cada destino é um processo separado que só copia (não codifica de novo): custa quase nada de processador.
 * - Ligar um destino no meio da live: ele recebe primeiro o último quadro-chave guardado (cache do GOP, até 2 s) e entra
 *   no ar em seguida, sem esperar e sem imagem quebrada no começo.
 * - Desligar um destino: só aquela conexão termina, com o encerramento correto para a plataforma. Os outros nem percebem.
 * - Queda de um destino: ele reconecta sozinho (1, 2, 4, 8 e depois a cada 15 s), recomeçando de um quadro-chave.
 * - Destino lento: cada um tem a própria fila (~16 MB, cerca de 20 s em 6 Mbps). Se a fila encher, só ele descarta até o
 *   próximo quadro-chave; o codificador, a gravação e os outros destinos seguem sem esperar ninguém.
 */
const { FLASHVER, redact } = require('./encoder.cjs');

const BACKOFF = [1000, 2000, 4000, 8000, 15000];
const CONNECT_MS = 20000;     // sem enviar nada 20 s depois de receber imagem: tenta de novo
const STALL_MS = 15000;       // enviando e parou de avançar por 15 s: conexão presa, reconecta
const CACHE_MAX = 24 * 1024 * 1024;

/* ---------- leitura do FLV interno (como um servidor RTMP: cabeçalhos guardados + GOP desde o último quadro-chave) ----------
 * Formato interno entre o codificador e os destinos: FLV. Estrutura simples (cada etiqueta diz o próprio tamanho), com a
 * configuração do vídeo (SPS/PPS) e do som (AAC) em etiquetas próprias no começo: guardadas aqui e repetidas para quem entra
 * depois. (MPEG-TS seria o natural, mas o FFmpeg empacotado falha ao LER MPEG-TS em alguns processadores; gerar funciona.) */
const FLV_HEAD = 13; // assinatura FLV (9) + tamanho da etiqueta anterior (4)

function createFeed() {
  return { head: null, meta: null, avc: null, aac: null, rest: null, cache: [], cacheBytes: 0, cacheOk: false, keys: 0, bytes: 0 };
}

// Recebe um pedaço do codificador e devolve { data (etiquetas inteiras), firstKey } atualizando cabeçalhos e cache.
// Instante (ms) de uma etiqueta FLV: 24 bits + 8 bits de extensão.
const tsOf = (b, p) => ((b[p + 7] << 24) | (b[p + 4] << 16) | (b[p + 5] << 8) | b[p + 6]) >>> 0;

function scan(feed, chunk) {
  let buf = feed.rest ? Buffer.concat([feed.rest, chunk]) : chunk, pos = 0;
  if (!feed.head || feed.splice) {
    if (buf.length < FLV_HEAD) { feed.rest = Buffer.from(buf); return { data: buf.subarray(0, 0), firstKey: -1 }; }
    if (buf[0] !== 0x46 || buf[1] !== 0x4c || buf[2] !== 0x56) throw Error('saída interna do codificador não é FLV');
    if (!feed.head) feed.head = Buffer.from(buf.subarray(0, FLV_HEAD));
    // Emenda: um processo novo continuou a mesma linha do tempo (ex.: 9:16 com enquadramento novo). A assinatura dele é
    // pulada; a configuração nova (SPS/PPS) é guardada e vai aos destinos antes do primeiro quadro-chave do processo novo.
    if (feed.splice) { feed.splice = false; feed.spliced = true; feed.after = feed.lastTs ?? -1; feed.avc = null; feed.aac = null; feed.cache = []; feed.cacheBytes = 0; feed.cacheOk = false; }
    pos = FLV_HEAD;
  }
  const from = pos; let firstKey = -1, lastKey = -1, media = false;
  while (pos + 11 <= buf.length) {
    const type = buf[pos] & 0x1f, size = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3], total = 11 + size + 4;
    if (pos + total > buf.length) break;
    const d = pos + 11, tag = () => Buffer.from(buf.subarray(pos, pos + total));
    if (type === 18 && !media && !feed.avc) feed.meta = tag();
    else if (type === 9 && size >= 2) {
      const frame = buf[d] >> 4, codec = buf[d] & 0x0f, packet = buf[d + 1];
      if (codec === 7 && packet === 0) feed.avc = tag();
      else if (codec === 7 && packet === 1 && frame === 1 && !(feed.after >= 0 && tsOf(buf, pos) <= feed.after)) { if (firstKey < 0) firstKey = pos - from; lastKey = pos - from; media = true; feed.after = -1; }
      else media = true;
    } else if (type === 8 && size >= 2) {
      if (buf[d] >> 4 === 10 && buf[d + 1] === 0) feed.aac = tag(); else media = true;
    }
    if (type === 9 && !(feed.after >= 0)) feed.lastTs = tsOf(buf, pos);
    pos += total;
  }
  const data = buf.subarray(from, pos);
  feed.rest = pos < buf.length ? Buffer.from(buf.subarray(pos)) : null;
  feed.bytes += data.length;
  if (lastKey >= 0) { const g = data.subarray(lastKey); feed.cache = [g]; feed.cacheBytes = g.length; feed.cacheOk = true; feed.keys++; }
  else if (feed.cacheOk && data.length) { feed.cache.push(data); feed.cacheBytes += data.length; if (feed.cacheBytes > CACHE_MAX) { feed.cache = []; feed.cacheBytes = 0; feed.cacheOk = false; } }
  return { data, firstKey };
}
// O que um destino recebe antes da primeira imagem: assinatura, metadados e configuração do vídeo e do som.
const header = feed => feed.head && feed.avc ? [feed.head, ...(feed.meta ? [feed.meta] : []), feed.avc, ...(feed.aac ? [feed.aac] : [])] : null;

/* ---------- argumentos do processo de cada destino (só copia, não codifica) ---------- */

// 30 fps cravados: o FLV interno (como todo RTMP) guarda o tempo em milissegundos, então os quadros chegam a 33/34 ms.
// No SRT (MPEG-TS, relógio de 90 kHz) cada quadro volta para a grade exata de 1/30 s (33,333 ms), sem recodificar.
const CFR30 = require('./encoder.cjs').CFR30;

const INPUT = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-nostats', '-probesize', '2000000', '-analyzeduration', '1000000', '-f', 'flv', '-i', 'pipe:0',
  '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-progress', 'pipe:3', '-stats_period', '1'];
function outputArgs(dest) {
  // Saída interna (ex.: o 9:16 criado a partir da imagem 16:9): os argumentos vêm prontos de quem a criou.
  if (dest.protocol === 'derive') return dest.args;
  if (dest.protocol === 'srt') return [...INPUT, '-bsf:v', CFR30, '-f', 'mpegts', dest.target];
  return [...INPUT, '-f', 'flv', '-flvflags', 'no_duration_filesize', '-rtmp_flashver', FLASHVER, '-rw_timeout', '15000000', dest.target];
}

// Motivo legível da queda de um destino, a partir do que o processo escreveu.
function reasonOf(stderr) {
  const s = String(stderr);
  // No Windows o FFmpeg descreve a recusa pelo número do erro (WSAECONNREFUSED = 10061; ECONNREFUSED do runtime = 107 ou 138).
  if (/Connection refused|ECONNREFUSED|actively refused|10061|Error number -(107|111|138) occurred/i.test(s)) return 'conexão recusada';
  if (/Failed to resolve|Name or service not known|getaddrinfo|No such host/i.test(s)) return 'endereço não encontrado';
  if (/timed out|timeout|Operation timed out/i.test(s)) return 'tempo esgotado';
  if (/Server error|NetStream|40[13]|Unauthorized|Forbidden|not authorized|Authentication|rejected|REJ_/i.test(s)) return 'recusado pelo servidor (confira a chave, o stream ID ou a senha)';
  if (/Protocol not found|Unknown protocol/i.test(s)) return 'protocolo indisponível neste computador';
  if (/Connection to tcp:\/\/\S+ failed|Cannot open connection/i.test(s)) return 'sem conexão com o servidor';
  if (/Broken pipe|reset by peer|End of file|I\/O error/i.test(s)) return 'conexão interrompida';
  return 'conexão interrompida';
}

/* ---------- distribuidor ---------- */

function createOutputs({ ffmpeg, spawnProcess, send = () => {}, audit = { info() {}, warn() {}, error() {} }, now = () => Date.now(), tickMs = 1000 }) {
  const feeds = new Map(), outputs = new Map();
  let closing = false;
  const emit = (o, state, reason = '') => {
    if (o.state === state && o.reason === reason) return;
    o.state = state; o.reason = reason;
    if (o.dest.internal) { o.dest.onState?.(state, reason); return; } // saída interna: quem a criou decide o que mostrar
    send({ type: 'destination', id: o.dest.id, state, reason, protocol: o.dest.protocol });
  };

  function group(id, { size } = {}) {
    if (!feeds.has(id)) feeds.set(id, { ...createFeed(), limit: size === '3840:2160' ? 64 * 1024 * 1024 : 16 * 1024 * 1024, ended: false });
    return feeds.get(id);
  }

  function write(o, parts) {
    const stdin = o.child?.stdin; if (!stdin || stdin.destroyed || o.ending) return;
    for (const p of parts) stdin.write(p);
    if (!o.fedAt) o.fedAt = now();
  }

  // O codificador do formato mandou mais um pedaço: guarda o necessário e repassa a cada destino ligado.
  function feed(groupId, chunk) {
    const f = feeds.get(groupId); if (!f || f.ended) return;
    const wasSplice = f.spliced; const { data, firstKey } = scan(f, chunk); if (!data.length) return;
    if (f.spliced && !wasSplice) for (const o of outputs.values()) if (o.groupId === groupId && o.child && !o.ending) { o.mode = 'key'; o.splice = true; }
    if (f.spliced && firstKey >= 0) f.spliced = false;
    for (const o of outputs.values()) {
      if (o.groupId !== groupId || !o.child || o.ending) continue;
      const queued = o.child.stdin.writableLength;
      if (o.mode === 'live') {
        if (queued > f.limit) {
          o.mode = 'key'; o.dropped++;
          if (now() - o.slowAt > 30000) { o.slowAt = now(); const m = o.dest.name + ': a conexão não está acompanhando. Este destino pula alguns segundos; os outros seguem normais.'; audit.warn('saidas', 'destino-lento', m, { destino: o.dest.name }); send({ type: 'notice', message: m }); }
          continue;
        }
        write(o, [data]);
      } else if (o.mode === 'key' && firstKey >= 0 && queued < f.limit / 2 && header(f)) {
        // Depois de uma emenda, a conexão continua: vão só a configuração nova e a imagem a partir do quadro-chave.
        if (o.splice) { o.splice = false; write(o, [f.avc, ...(f.aac ? [f.aac] : []), data.subarray(firstKey)]); }
        else write(o, [...header(f), data.subarray(firstKey)]);
        o.mode = 'live';
      }
    }
  }

  function launch(o) {
    if (o.child || !o.want || closing) return;
    const f = feeds.get(o.groupId); if (!f || f.ended) return;
    const child = spawnProcess(ffmpeg, outputArgs(o.dest), { shell: false, windowsHide: true, stdio: ['pipe', o.dest.onStdout ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    // Saída interna que produz outra imagem (o 9:16): o que ela gera vira a entrada de outro grupo do distribuidor.
    if (o.dest.onStdout) child.stdout.on('data', d => { if (o.child === child) o.dest.onStdout(d); });
    o.dest.onStart?.();
    Object.assign(o, { child, ending: false, fedAt: 0, sentBytes: 0, advancedAt: 0, progress: '', stderr: '', launchedAt: now() });
    emit(o, o.everSent ? 'retrying' : 'connecting', o.everSent ? o.reason || 'reconectando' : '');
    child.stdin.on('error', () => { /* o processo saiu: o fechamento decide o que fazer */ });
    child.on('error', () => { o.stderr += 'spawn failed'; });
    child.stderr.on('data', d => { o.stderr = (o.stderr + redact(d.toString(), { destinations: [o.dest] })).slice(-4096); });
    child.stdio[3].on('data', d => {
      o.progress += d.toString(); let i;
      while ((i = o.progress.indexOf('\n')) >= 0) {
        const line = o.progress.slice(0, i).trim(); o.progress = o.progress.slice(i + 1);
        if (!line.startsWith('total_size=')) continue;
        if (o.ending || !o.want || o.child !== child) continue; // saindo do ar: o último relatório do processo não conta como "no ar"

        const total = Number(line.slice(11)); if (!(total > o.sentBytes)) continue;
        const t = now();
        if (o.advancedAt) o.kbps = Math.round((total - o.sentBytes) * 8 / Math.max(1, t - o.advancedAt));
        o.sentBytes = total; o.advancedAt = t;
        if (o.state !== 'sending') {
          if (o.everSent) audit.info('saidas', 'destino-recuperado', o.dest.name + ' voltou a receber');
          else audit.info('saidas', 'destino-no-ar', o.dest.name + ' no ar', { protocolo: o.dest.protocol, formato: o.dest.aspect });
          o.everSent = true; o.since = o.since || t; emit(o, 'sending');
        }
        if (t - o.launchedAt > 30000) o.retries = 0; // ficou no ar: a próxima queda recomeça a espera do início
      }
    });
    // Começa do último quadro-chave guardado, se houver; senão espera o próximo.
    if (f.cacheOk && header(f)) { o.mode = 'live'; write(o, [...header(f), ...f.cache]); } else o.mode = 'key';
    child.on('close', code => {
      const wasWanted = o.want && !closing && !o.restartNow;
      clearTimeout(o.killTimer); o.child = null; o.ending = false;
      if (o.restartNow) { o.restartNow = false; if (o.want && !closing) launch(o); return; }
      if (!wasWanted) { o.since = 0; emit(o, 'off'); o.dest.onEnd?.(); return; }
      const reason = reasonOf(o.stderr), wait = BACKOFF[Math.min(o.retries, BACKOFF.length - 1)]; o.retries++;
      audit.warn('saidas', 'destino-reconectando', o.dest.name + ': ' + reason + '. Nova tentativa em ' + Math.round(wait / 1000) + ' s.', { codigo: code, log: o.stderr.slice(-800) });
      emit(o, 'retrying', reason);
      o.retryTimer = setTimeout(() => launch(o), wait); o.retryTimer.unref?.();
    });
  }

  function end(o, killAfter = 5000) {
    if (!o.child || o.ending) return;
    o.ending = true;
    try { o.child.stdin.end(); } catch { /* já fechado */ }
    o.killTimer = setTimeout(() => { try { o.child?.kill('SIGKILL'); } catch { /* já saiu */ } }, killAfter); o.killTimer.unref?.();
  }

  // Vigia: destino que não começa a enviar ou que parou de avançar é reiniciado (a conexão ficou presa).
  const watch = setInterval(() => {
    const t = now();
    for (const o of outputs.values()) {
      if (!o.child || o.ending || !o.want) continue;
      const stuck = o.state === 'sending' ? o.advancedAt && t - o.advancedAt > STALL_MS : o.fedAt && t - o.fedAt > CONNECT_MS;
      if (stuck) { o.stderr += o.state === 'sending' ? ' timed out (parou de enviar)' : ' timed out (sem resposta)'; try { o.child.kill('SIGKILL'); } catch { /* já saiu */ } }
    }
  }, tickMs);
  watch.unref?.();

  const api = {
    group,
    feed,
    add(dest, groupId) {
      if (outputs.has(dest.id)) return outputs.get(dest.id);
      const o = { dest, groupId, want: false, state: 'standby', reason: '', child: null, mode: 'key', retries: 0, dropped: 0, slowAt: 0, kbps: 0, since: 0, everSent: false };
      outputs.set(dest.id, o); return o;
    },
    has: id => outputs.has(id),
    // Configuração nova de um destino fora do ar (o operador trocou a chave ou o servidor antes de pô-lo no ar).
    update(id, dest) {
      const o = outputs.get(id); if (!o || o.child || o.want) return false;
      o.dest = dest; o.reason = ''; return true;
    },
    groupOf: id => outputs.get(id)?.groupId,
    // Troca a configuração de uma saída que está no ar e reabre o processo (ex.: novo enquadramento do 9:16).
    restart(id, dest) {
      const o = outputs.get(id); if (!o) return false;
      if (dest) o.dest = dest;
      if (o.child && o.want) { o.restartNow = true; end(o, 2000); } else if (o.want) launch(o);
      return true;
    },
    // Liga um destino: no ar em segundos, sem tocar nos outros.
    start(id) {
      const o = outputs.get(id); if (!o || closing) return false;
      if (o.want && o.child) return true;
      o.want = true; o.retries = 0; o.everSent = false; o.since = 0; clearTimeout(o.retryTimer);
      audit.info('saidas', 'destino-ligado', o.dest.name + ': entrando no ar', { protocolo: o.dest.protocol, formato: o.dest.aspect });
      launch(o); return true;
    },
    // Desliga um destino: só aquela conexão termina, com encerramento correto para a plataforma.
    stop(id) {
      const o = outputs.get(id); if (!o) return false;
      o.want = false; clearTimeout(o.retryTimer);
      audit.info('saidas', 'destino-desligado', o.dest.name + ': saiu do ar');
      if (o.child) { emit(o, 'stopping'); end(o, 4000); } else { o.since = 0; emit(o, 'off'); }
      return true;
    },
    // O codificador do formato foi reiniciado: começa do zero (tabelas novas, tempos novos) e os destinos ligados reabrem a conexão.
    resetGroup(groupId, { splice = false } = {}) {
      const f = feeds.get(groupId); if (!f) return;
      // Emenda (mesma linha do tempo, processo novo): os destinos continuam conectados e só pulam para o quadro-chave novo.
      if (splice && f.head) { Object.assign(f, { rest: null, splice: true, ended: false }); return; }
      Object.assign(f, createFeed(), { ended: false });
      for (const o of outputs.values()) if (o.groupId === groupId && o.child && o.want) { o.restartNow = true; end(o, 2000); }
    },
    // O codificador do formato terminou: os destinos dele encerram com o fim do sinal.
    endGroup(groupId) {
      const f = feeds.get(groupId); if (f) f.ended = true;
      for (const o of outputs.values()) if (o.groupId === groupId) { o.want = false; clearTimeout(o.retryTimer); if (o.child) end(o, 6000); else if (o.state !== 'standby') emit(o, 'off'); }
    },
    close() {
      closing = true; clearInterval(watch);
      for (const o of outputs.values()) { o.want = false; clearTimeout(o.retryTimer); if (o.child) end(o, 6000); }
    },
    status: () => [...outputs.values()].map(o => ({ id: o.dest.id, name: o.dest.name, protocol: o.dest.protocol, aspect: o.dest.aspect, state: o.state, reason: o.reason, kbps: o.state === 'sending' ? o.kbps : 0, since: o.since, dropped: o.dropped })),
    running: () => [...outputs.values()].filter(o => o.child).length,
    isRunning: id => !!outputs.get(id)?.child,
  };
  return api;
}

module.exports = { createOutputs, outputArgs, reasonOf, _internal: { scan, createFeed, header, BACKOFF } };
