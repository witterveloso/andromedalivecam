'use strict';
/*
 * Auditoria: cada sessão do serviço grava um arquivo JSONL (uma linha por evento)
 * com o que a mesa, o codificador, as câmeras e o operador fizeram. Serve para
 * reconstituir uma falha depois da live. Chaves e URLs de destino nunca entram.
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const LEVELS = ['info', 'warn', 'error'];
const SECRET = /(key|chave|token|secret|senha|password|authorization)/i;

function scrub(value, depth = 0) {
  if (value == null || depth > 4) return value ?? null;
  if (typeof value === 'string') return value.replace(/rtmps?:\/\/[^\s'"]+/g, m => m.replace(/\/[^/]*$/, '/•••')).replace(/\b[a-f0-9]{40,}\b/gi, '•••').slice(0, 2000);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [k, SECRET.test(k) ? '•••' : scrub(v, depth + 1)]));
}

function createAudit({ dir = process.env.ANDROMEDA_LOG_DIR || path.join(__dirname, 'logs'), keep = 30, memory = 800, clock = Date.now, write = true } = {}) {
  const started = new Date(clock()), session = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, 'andromeda-' + session + '.jsonl'), recent = [];
  let stream = null, seq = 0, counts = { info: 0, warn: 0, error: 0 };
  if (write) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const old = fs.readdirSync(dir).filter(n => /^andromeda-.*\.jsonl$/.test(n)).sort();
      for (const name of old.slice(0, Math.max(0, old.length - keep + 1))) fs.rmSync(path.join(dir, name), { force: true });
      stream = fs.createWriteStream(file, { flags: 'a' }); stream.on('error', () => { stream = null; });
    } catch { stream = null; }
  }
  function event(level, source, code, message, data) {
    if (!LEVELS.includes(level)) level = 'info';
    const entry = { seq: ++seq, time: new Date(clock()).toISOString(), level, source: String(source).slice(0, 24), code: String(code).slice(0, 48), message: scrub(String(message)), ...(data === undefined ? {} : { data: scrub(data) }) };
    counts[level]++; recent.push(entry); if (recent.length > memory) recent.shift();
    stream?.write(JSON.stringify(entry) + '\n');
    return entry;
  }
  const api = {
    file: stream ? file : null, session,
    info: (source, code, message, data) => event('info', source, code, message, data),
    warn: (source, code, message, data) => event('warn', source, code, message, data),
    error: (source, code, message, data) => event('error', source, code, message, data),
    event,
    since: (after = 0, limit = 300) => recent.filter(e => e.seq > after).slice(-limit),
    summary: () => ({ session, file: stream ? file : null, counts: { ...counts }, last: seq, lastError: [...recent].reverse().find(e => e.level === 'error') || null }),
    export: () => recent.map(e => JSON.stringify(e)).join('\n') + '\n',
    close: () => { stream?.end(); stream = null; },
  };
  api.info('servico', 'inicio', 'Serviço iniciado', { node: process.version, plataforma: process.platform + ' ' + os.release(), cpus: os.cpus().length, memoriaGB: Math.round(os.totalmem() / 1e9) });
  return api;
}

module.exports = { createAudit, scrub };
