'use strict';
/*
 * Modo Internet: a mesa atende os convites pelo ponto de encontro (public/cam/relay.js).
 * Cada celular vira, para o camera-hub, uma "conexão" igual à de um WebSocket local,
 * então convites, tally, intercom e revogação funcionam do mesmo jeito.
 */
const { EventEmitter } = require('node:events');
const { Channel, DEFAULT_BROKERS } = require('./public/cam/relay.js');

const IDLE_MS = 15000;

function createRelay({ hub, brokers = DEFAULT_BROKERS, onEvent = () => {}, WebSocketImpl, clock = Date.now }) {
  const channels = new Map(); // chave do convite -> { channel, sessions: Map(sid -> adaptador) }

  function adapter(entry, sid) {
    const conn = new EventEmitter();
    Object.assign(conn, {
      readyState: 1, bufferedAmount: 0, lastSeen: clock(),
      send(text) { if (conn.readyState === 1) entry.channel.send({ sid, msg: JSON.parse(text) }).catch(() => {}); },
      close(code = 1000, reason = '') {
        if (conn.readyState !== 1) return;
        conn.readyState = 3; entry.channel.send({ sid, msg: { type: 'closed', code, reason } }).catch(() => {});
        entry.sessions.delete(sid); conn.emit('close', code, reason);
      },
      terminate() { conn.close(1001); },
    });
    return conn;
  }

  function handle(key, entry, env) {
    const { sid, msg } = env;
    if (typeof sid !== 'string' || !msg || typeof msg.type !== 'string') return;
    const session = entry.sessions.get(sid);
    if (session) session.lastSeen = clock();
    if (msg.type === 'session') {
      const info = hub.lookup(key);
      entry.channel.send({ sid, msg: info ? { type: 'session', ok: true, ...info } : { type: 'session', ok: false, error: 'Convite expirado ou inválido. Peça outro ao DTV.' } }).catch(() => {});
      return;
    }
    if (msg.type === 'join') {
      for (const old of entry.sessions.values()) old.close(4001, 'Outra conexão assumiu este convite');
      const conn = adapter(entry, sid); entry.sessions.set(sid, conn);
      hub.join(conn, key);
      return;
    }
    if (!session) return;
    if (msg.type === 'leave') { session.close(1000, 'Câmera saiu'); return; }
    if (msg.type === 'ping') return;
    session.emit('message', JSON.stringify(msg));
  }

  function watch(key) {
    if (channels.has(key)) return;
    const entry = { channel: new Channel({ inviteKey: key, role: 'desk', brokers, WebSocketImpl }), sessions: new Map() };
    entry.channel.on(env => handle(key, entry, env));
    let last = -1;
    entry.channel.onstate = connected => { if (connected === last) return; if (!connected && last > 0) onEvent('warn', 'internet-sem-ponto', 'Ponto de encontro das câmeras indisponível; tentando de novo'); last = connected; };
    channels.set(key, entry);
  }
  function unwatch(key, now = false) {
    const entry = channels.get(key); if (!entry) return;
    for (const s of [...entry.sessions.values()]) s.close(4002, 'Pareamento revogado');
    // Espera o aviso de revogação sair antes de desligar o canal (exceto ao fechar a mesa).
    if (now) entry.channel.close(); else setTimeout(() => entry.channel.close(), 1500).unref?.();
    channels.delete(key);
  }

  // Celular que sumiu (sem bateria, sem sinal, aba fechada) libera o canal depois de 15 s sem mensagens.
  const sweep = setInterval(() => {
    for (const entry of channels.values()) for (const s of [...entry.sessions.values()]) if (clock() - s.lastSeen > IDLE_MS) { onEvent('warn', 'camera-sem-resposta', 'Câmera parou de responder pela internet'); s.close(4004, 'Sem resposta'); }
  }, 2000);
  sweep.unref?.();

  return {
    watch, unwatch,
    status() { let up = 0, total = 0; for (const e of channels.values()) { up = Math.max(up, e.channel.connected()); total = e.channel.brokers.length || total; } return { invites: channels.size, brokersUp: up, brokers: total || brokers.length }; },
    close() { clearInterval(sweep); for (const key of [...channels.keys()]) unwatch(key, true); },
  };
}

module.exports = { createRelay };
