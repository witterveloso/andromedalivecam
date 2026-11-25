'use strict';
/*
 * Servidor da Rede Andrômeda — a infraestrutura própria das câmeras pela internet (Wi-Fi, 4G, 5G), sem serviços de terceiros.
 *
 * Um único programa, rodando no servidor da empresa:
 *  1. Ponto de encontro (/mqtt): onde celular e mesa trocam a conversa inicial da conexão. Fala o subconjunto do MQTT 3.1.1
 *     sobre WebSocket que o app usa (public/cam/relay.js). As mensagens já chegam cifradas de ponta a ponta com a chave do
 *     convite (AES-GCM): o servidor só repassa bytes, não consegue ler nada.
 *  2. Retransmissão de mídia (STUN/TURN, andromeda-turn.cjs) na porta 3478 UDP/TCP, com credenciais temporárias assinadas
 *     pelo mesmo segredo que a mesa conhece.
 *
 * Variáveis: REDE_PORT (HTTP interno do ponto de encontro, padrão 8090; o HTTPS fica no Caddy), TURN_SECRET (obrigatório,
 * ≥ 32 caracteres), TURN_PORT (3478), PUBLIC_IP (IP público do servidor, anunciado na retransmissão).
 */
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { createTurnServer } = require('./andromeda-turn.cjs');

const LIMITS = { packet: 64 * 1024, topics: 16, connections: 2000, perIpPerMinute: 120 };

function remaining(b, i) { let len = 0, mul = 1, byte; do { if (i >= b.length) return null; byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128 && mul <= 128 ** 3); return { len, i }; }
const enc = n => { const out = []; do { let byte = n % 128; n = Math.floor(n / 128); if (n > 0) byte |= 128; out.push(byte); } while (n > 0); return out; };
const pkt = (first, body) => Buffer.concat([Buffer.from([first, ...enc(body.length)]), body]);
const str = (b, o) => { const n = b.readUInt16BE(o); return { s: b.subarray(o + 2, o + 2 + n).toString(), next: o + 2 + n }; };

// Ponto de encontro: MQTT 3.1.1 com QoS 0 (CONNECT, SUBSCRIBE, UNSUBSCRIBE, PUBLISH, PINGREQ, DISCONNECT).
function createBroker({ onEvent = () => {} } = {}) {
  const topics = new Map(); // tópico -> Set(cliente)
  const perIp = new Map();
  const stats = { connections: 0, messages: 0, refused: 0 };
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.packet, handleProtocols: p => (p.has('mqtt') ? 'mqtt' : false) });
  function attach(ws, ip) {
    stats.connections++;
    const me = { ws, subs: new Set(), connected: false, buf: Buffer.alloc(0), last: Date.now() };
    const drop = () => { for (const t of me.subs) { const set = topics.get(t); set?.delete(me); if (set && !set.size) topics.delete(t); } me.subs.clear(); };
    const idle = setInterval(() => { if (Date.now() - me.last > 90000) ws.terminate(); }, 30000); idle.unref?.();
    ws.on('close', () => { clearInterval(idle); drop(); stats.connections--; });
    ws.on('error', () => ws.terminate());
    ws.on('message', data => {
      me.last = Date.now(); me.buf = Buffer.concat([me.buf, Buffer.from(data)]);
      if (me.buf.length > LIMITS.packet * 2) { ws.terminate(); return; }
      for (;;) {
        if (me.buf.length < 2) return;
        const r = remaining(me.buf, 1); if (!r || me.buf.length < r.i + r.len) return;
        const type = me.buf[0] >> 4, flags = me.buf[0] & 15, body = me.buf.subarray(r.i, r.i + r.len); me.buf = me.buf.subarray(r.i + r.len);
        if (!me.connected && type !== 1) { ws.terminate(); return; }
        if (type === 1) { me.connected = true; ws.send(Buffer.from([0x20, 2, 0, 0])); }
        else if (type === 8) { // SUBSCRIBE
          const id = body.readUInt16BE(0); let o = 2; const codes = [];
          while (o < body.length) { const t = str(body, o); o = t.next + 1; const ok = /^andromeda-live\/v1\/[0-9a-f]{16,64}$/.test(t.s) && me.subs.size < LIMITS.topics; codes.push(ok ? 0 : 0x80); if (ok) { me.subs.add(t.s); if (!topics.has(t.s)) topics.set(t.s, new Set()); topics.get(t.s).add(me); } }
          ws.send(pkt(0x90, Buffer.concat([Buffer.from([id >> 8, id & 255]), Buffer.from(codes)])));
        } else if (type === 10) { // UNSUBSCRIBE
          const id = body.readUInt16BE(0); let o = 2; while (o < body.length) { const t = str(body, o); o = t.next; me.subs.delete(t.s); topics.get(t.s)?.delete(me); }
          ws.send(Buffer.from([0xb0, 2, id >> 8, id & 255]));
        } else if (type === 3) { // PUBLISH (QoS 0): repassa a quem está no tópico, menos para quem mandou
          const t = str(body, 0); let o = t.next; if ((flags >> 1) & 3) o += 2;
          const set = topics.get(t.s); if (!set) continue;
          const out = pkt(0x30, Buffer.concat([body.subarray(0, t.next), body.subarray(o)])); stats.messages++;
          for (const c of set) if (c !== me && c.ws.readyState === 1 && c.ws.bufferedAmount < 1 << 20) c.ws.send(out);
        } else if (type === 12) ws.send(Buffer.from([0xd0, 0]));
        else if (type === 14) { ws.close(); return; }
      }
    });
  }
  return {
    upgrade(req, socket, head) {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), now = Date.now();
      const rec = perIp.get(ip) || { n: 0, at: now }; if (now - rec.at > 60000) { rec.n = 0; rec.at = now; } rec.n++; perIp.set(ip, rec);
      if (rec.n > LIMITS.perIpPerMinute || stats.connections >= LIMITS.connections) { stats.refused++; socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => attach(ws, ip));
    },
    stats: () => ({ ...stats, topics: topics.size }),
    close() { for (const c of wss.clients) c.terminate(); wss.close(); },
  };
}

async function startRede({ port = 8090, bind = '0.0.0.0', turnSecret, turnPort = 3478, publicIp, onEvent = (l, c, m) => console.log(new Date().toISOString(), l, c, m) } = {}) {
  const broker = createBroker({ onEvent });
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, broker: broker.stats(), turn: turn?.stats() || null })); return; }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket, head) => { if (req.url === '/mqtt') broker.upgrade(req, socket, head); else socket.destroy(); });
  await new Promise(r => server.listen(port, bind, r));
  let turn = null;
  if (turnSecret) {
    // No servidor da empresa a mídia vai para mesas em qualquer lugar da internet, nunca para a rede interna do próprio servidor.
    turn = await createTurnServer({ secret: turnSecret, port: turnPort, relayAddress: publicIp, allowPeer: ip => !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80)/i.test(ip), maxAllocations: 500, onEvent }).listen();
  }
  onEvent('info', 'rede-andromeda', 'Rede Andrômeda: ponto de encontro em :' + port + '/mqtt' + (turn ? ' · retransmissão em :' + turnPort + ' (UDP/TCP) · IP ' + (publicIp || 'automático') : ''));
  return { server, broker, turn, close() { broker.close(); server.close(); turn?.close(); } };
}

if (require.main === module) {
  const secret = process.env.TURN_SECRET || '';
  if (secret.length < 32) { console.error('Defina TURN_SECRET com pelo menos 32 caracteres (o mesmo configurado nas mesas).'); process.exit(1); }
  startRede({ port: Number(process.env.REDE_PORT || 8090), turnSecret: secret, turnPort: Number(process.env.TURN_PORT || 3478), publicIp: process.env.PUBLIC_IP || null })
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { createBroker, startRede };
