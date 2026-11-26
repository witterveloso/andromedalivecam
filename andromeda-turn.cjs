'use strict';
/*
 * Rede Andrômeda — servidor STUN/TURN próprio (RFC 5389 / RFC 5766), sem serviços de terceiros.
 *
 * Por que existe: no 4G/5G a operadora põe o celular atrás de NAT compartilhado (CGNAT). O caminho direto até a mesa
 * não existe e a imagem não chega. Um TURN retransmite a mídia: o celular manda para o TURN, o TURN entrega à mesa.
 *
 * O mesmo código roda em dois lugares:
 *  - dentro da mesa (porta 3478 UDP/TCP aberta no roteador por UPnP): o celular no 5G manda direto para a mesa;
 *  - no servidor da empresa (kit em cloud/): para mesas atrás de CGNAT da operadora fixa.
 *
 * Credenciais temporárias (formato "TURN REST API"): usuário = "<expira-em-segundos>:<id>", senha = base64(HMAC-SHA1(segredo, usuário)).
 * A mesa gera e entrega ao celular junto com o convite; o segredo nunca sai do serviço.
 *
 * Suporta: Binding (STUN), Allocate, Refresh, CreatePermission, ChannelBind, Send/Data e ChannelData, sobre UDP e TCP.
 */
const dgram = require('node:dgram'), net = require('node:net'), crypto = require('node:crypto'), os = require('node:os');

const MAGIC = 0x2112A442;
const M = { BINDING: 0x001, ALLOCATE: 0x003, REFRESH: 0x004, SEND: 0x006, DATA: 0x007, CREATE_PERMISSION: 0x008, CHANNEL_BIND: 0x009 };
const C = { REQUEST: 0x000, INDICATION: 0x010, SUCCESS: 0x100, ERROR: 0x110 };
const A = { MAPPED_ADDRESS: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000C, LIFETIME: 0x000D,
  XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016, REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020, SOFTWARE: 0x8022, FINGERPRINT: 0x8028 };
const SOFTWARE = 'Andromeda TURN';
const DEFAULT_LIFETIME = 600, MAX_LIFETIME = 3600, PERMISSION_MS = 300000, CHANNEL_MS = 600000;

/* ---------- mensagens STUN ---------- */
const methodOf = type => (type & 0x000F) | ((type & 0x00E0) >> 1) | ((type & 0x3E00) >> 2);
const classOf = type => type & 0x0110;
const typeOf = (method, cls) => (method & 0x000F) | ((method & 0x0070) << 1) | ((method & 0x0F80) << 2) | cls;

function parse(buf) {
  if (buf.length < 20 || (buf[0] & 0xC0) !== 0 || buf.readUInt32BE(4) !== MAGIC) return null;
  const length = buf.readUInt16BE(2); if (length + 20 > buf.length || length % 4) return null;
  const type = buf.readUInt16BE(0), attrs = [];
  let off = 20, end = 20 + length;
  while (off + 4 <= end) {
    const t = buf.readUInt16BE(off), l = buf.readUInt16BE(off + 2);
    if (off + 4 + l > end) return null;
    attrs.push({ type: t, value: buf.subarray(off + 4, off + 4 + l), offset: off });
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { method: methodOf(type), cls: classOf(type), tid: buf.subarray(8, 20), attrs, raw: buf.subarray(0, end), get: t => attrs.find(a => a.type === t) };
}
function xorAddress(value, tid) {
  const family = value[1], port = value.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (family === 1) { const a = Buffer.alloc(4); for (let i = 0; i < 4; i++) a[i] = value[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xFF); return { family: 4, port, address: [...a].join('.') }; }
  if (family === 2 && value.length >= 20) {
    const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xA4, 0x42]), tid]), a = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) a[i] = value[4 + i] ^ key[i];
    const parts = []; for (let i = 0; i < 16; i += 2) parts.push(a.readUInt16BE(i).toString(16));
    return { family: 6, port, address: parts.join(':') };
  }
  return null;
}
function encodeXorAddress({ address, port }, tid) {
  const v6 = net.isIPv6(address);
  const out = Buffer.alloc(v6 ? 20 : 8); out[1] = v6 ? 2 : 1; out.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  if (!v6) { address.split('.').map(Number).forEach((b, i) => { out[4 + i] = b ^ ((MAGIC >>> (24 - 8 * i)) & 0xFF); }); return out; }
  const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xA4, 0x42]), tid]), raw = ipv6Bytes(address);
  for (let i = 0; i < 16; i++) out[4 + i] = raw[i] ^ key[i];
  return out;
}
function ipv6Bytes(address) {
  const [head, tail = ''] = address.split('::'), h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t], out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || '0', 16), i * 2)); return out;
}
function encodeAddress({ address, port }) { const out = Buffer.alloc(8); out[1] = 1; out.writeUInt16BE(port, 2); address.split('.').map(Number).forEach((b, i) => { out[4 + i] = b; }); return out; }
const pad = b => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

// Monta a mensagem; com "key", acrescenta MESSAGE-INTEGRITY; sempre termina com FINGERPRINT.
function build(method, cls, tid, attrs, key) {
  const parts = [];
  for (const [t, v] of attrs) { const h = Buffer.alloc(4); h.writeUInt16BE(t, 0); h.writeUInt16BE(v.length, 2); parts.push(h, pad(v)); }
  let body = Buffer.concat(parts);
  const header = len => { const h = Buffer.alloc(20); h.writeUInt16BE(typeOf(method, cls), 0); h.writeUInt16BE(len, 2); h.writeUInt32BE(MAGIC, 4); tid.copy(h, 8); return h; };
  if (key) {
    const mi = crypto.createHmac('sha1', key).update(Buffer.concat([header(body.length + 24), body])).digest();
    const h = Buffer.alloc(4); h.writeUInt16BE(A.MESSAGE_INTEGRITY, 0); h.writeUInt16BE(20, 2); body = Buffer.concat([body, h, mi]);
  }
  const crc = (crc32(Buffer.concat([header(body.length + 8), body])) ^ 0x5354554e) >>> 0, fh = Buffer.alloc(8);
  fh.writeUInt16BE(A.FINGERPRINT, 0); fh.writeUInt16BE(4, 2); fh.writeUInt32BE(crc, 4);
  body = Buffer.concat([body, fh]);
  return Buffer.concat([header(body.length), body]);
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// Confere MESSAGE-INTEGRITY: HMAC sobre a mensagem até o atributo, com o comprimento do cabeçalho apontando para o fim dele.
function checkIntegrity(msg, key) {
  const mi = msg.get(A.MESSAGE_INTEGRITY); if (!mi || mi.value.length !== 20) return false;
  const head = Buffer.from(msg.raw.subarray(0, mi.offset)); head.writeUInt16BE(mi.offset + 24 - 20, 2);
  const want = crypto.createHmac('sha1', key).update(head).digest();
  return crypto.timingSafeEqual(want, mi.value);
}

/* ---------- credenciais temporárias ---------- */
function credentials(secret, { ttl = 24 * 3600, id = 'andromeda', now = Date.now() } = {}) {
  const username = Math.floor(now / 1000 + ttl) + ':' + id;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

/* ---------- endereços ---------- */
const isPrivate = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^(::1$|f[cd]|fe80)/i.test(ip);
// Placas virtuais (Hyper-V/WSL, VirtualBox, VMware, Docker, VPNs) não levam ao celular: ficam fora.
const VIRTUAL = /vethernet|hyper-?v|virtualbox|vmware|vmnet|docker|wsl|loopback|tailscale|zerotier|hamachi|vpn|tap-|tun|bluetooth/i;
// Todos os endereços IPv4 reais deste computador (cabo, Wi-Fi), inclusive públicos e de CGNAT quando o computador está
// ligado direto no modem da operadora.
function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const n of list || []) {
    if ((n.family !== 'IPv4' && n.family !== 4) || n.internal || n.address.startsWith('169.254.') || VIRTUAL.test(name)) continue;
    out.push(n.address);
  }
  return [...new Set(out)];
}
// Endereço pelo qual este computador sai para a internet (a placa da rota padrão: cabo ou Wi-Fi). "connect" num socket
// UDP só pergunta ao sistema qual placa usaria; nenhum pacote é enviado.
function routeAddress() {
  return new Promise(resolve => {
    let sock; try { sock = dgram.createSocket('udp4'); } catch { resolve(null); return; }
    const done = a => { try { sock.close(); } catch { /* fechado */ } resolve(a); };
    sock.on('error', () => done(null));
    try { sock.connect(9, '203.0.113.1', () => { let a = null; try { a = sock.address().address; } catch { /* sem rota */ } done(a && a !== '0.0.0.0' ? a : null); }); } catch { done(null); }
  });
}
const isCgnatIp = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
const isLanIp = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
function lanAddress() {
  const all = localAddresses();
  return all.find(isLanIp) || all[0] || '127.0.0.1';
}

/**
 * createTurnServer({ secret, realm, port, relayAddress, allowPeer, maxAllocations, onEvent })
 *  - relayAddress: endereço anunciado como "relayed" (onde os pares mandam a mídia). Na mesa, o IP da rede local
 *    (o par é o próprio navegador da mesa); no servidor da empresa, o IP público.
 *  - allowPeer(ip): quem pode receber mídia retransmitida. Na mesa, só endereços locais (o TURN não vira
 *    retransmissor aberto para a internet); no servidor, qualquer um com credencial válida.
 */
function createTurnServer({ secret, realm = 'andromeda', port = 3478, bind = '0.0.0.0', relayAddress = null, relayBind = '0.0.0.0', allowPeer = () => true, maxAllocations = 64, onEvent = () => {}, clock = Date.now } = {}) {
  if (!secret || secret.length < 16) throw Error('TURN: segredo com pelo menos 16 caracteres.');
  const allocations = new Map(); // "proto|ip|port" -> allocation
  const nonces = new Map(); // nonce -> expira
  const stats = { allocations: 0, bytesRelayed: 0, bindings: 0, refused: 0 };
  let udp = null, tcp = null;
  const relayIp = () => (typeof relayAddress === 'function' ? relayAddress() : relayAddress) || lanAddress();

  function newNonce() { const n = crypto.randomBytes(12).toString('hex'); nonces.set(n, clock() + 3600000); if (nonces.size > 5000) for (const [k, v] of nonces) if (v < clock()) nonces.delete(k); return n; }
  function userKey(username) {
    const exp = Number(String(username).split(':')[0]);
    if (!Number.isFinite(exp) || exp * 1000 < clock()) return null;
    const password = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return crypto.createHash('md5').update(username + ':' + realm + ':' + password).digest();
  }
  const errorAttr = (code, reason) => { const v = Buffer.alloc(4 + Buffer.byteLength(reason)); v[2] = Math.floor(code / 100); v[3] = code % 100; v.write(reason, 4); return [A.ERROR_CODE, v]; };
  const soft = [A.SOFTWARE, Buffer.from(SOFTWARE)];

  // Autenticação de longo prazo: sem credencial → 401 com REALM e NONCE; credencial errada/vencida → 401 de novo.
  function authenticate(msg, reply) {
    const user = msg.get(A.USERNAME), nonce = msg.get(A.NONCE), mi = msg.get(A.MESSAGE_INTEGRITY);
    const challenge = (code, reason) => { stats.refused++; reply(build(msg.method, C.ERROR, msg.tid, [errorAttr(code, reason), [A.REALM, Buffer.from(realm)], [A.NONCE, Buffer.from(newNonce())], soft])); return null; };
    if (!user || !nonce || !mi) return challenge(401, 'Unauthorized');
    const n = nonce.value.toString(); if (!nonces.has(n) || nonces.get(n) < clock()) return challenge(438, 'Stale Nonce');
    const key = userKey(user.value.toString()); if (!key || !checkIntegrity(msg, key)) return challenge(401, 'Unauthorized');
    return key;
  }

  function sendTo(client, data) {
    if (client.proto === 'udp') udp?.send(data, client.port, client.address);
    else if (!client.socket.destroyed) client.socket.write(data);
  }
  function relayToClient(alloc, data, peer) {
    const ch = [...alloc.channels.values()].find(c => c.peer.address === peer.address && c.peer.port === peer.port && c.expires > clock());
    if (ch) {
      const h = Buffer.alloc(4); h.writeUInt16BE(ch.number, 0); h.writeUInt16BE(data.length, 2);
      sendTo(alloc.client, alloc.client.proto === 'tcp' ? pad(Buffer.concat([h, data])) : Buffer.concat([h, data]));
    } else {
      const tid = crypto.randomBytes(12); sendTo(alloc.client, build(M.DATA, C.INDICATION, tid, [[A.XOR_PEER_ADDRESS, encodeXorAddress(peer, tid)], [A.DATA, data]]));
    }
  }
  function permitted(alloc, ip) { const p = alloc.permissions.get(ip); return !!p && p > clock(); }
  function freeAllocation(id) {
    const a = allocations.get(id); if (!a) return;
    allocations.delete(id); clearTimeout(a.timer); try { a.relay.close(); } catch { /* já fechado */ }
  }
  function touch(a, seconds) { clearTimeout(a.timer); a.expires = clock() + seconds * 1000; a.timer = setTimeout(() => freeAllocation(a.id), seconds * 1000); a.timer.unref?.(); }

  async function handleStun(msg, client, reply) {
    const id = client.proto + '|' + client.address + '|' + client.port;
    if (msg.cls === C.REQUEST && msg.method === M.BINDING) {
      stats.bindings++;
      return reply(build(M.BINDING, C.SUCCESS, msg.tid, [[A.XOR_MAPPED_ADDRESS, encodeXorAddress(client, msg.tid)], ...(net.isIPv4(client.address) ? [[A.MAPPED_ADDRESS, encodeAddress(client)]] : []), soft]));
    }
    if (msg.cls === C.INDICATION && msg.method === M.SEND) {
      const a = allocations.get(id); const peer = msg.get(A.XOR_PEER_ADDRESS), data = msg.get(A.DATA); if (!a || !peer || !data) return;
      const p = xorAddress(peer.value, msg.tid); if (p && permitted(a, p.address)) { a.relay.send(data.value, p.port, p.address); stats.bytesRelayed += data.value.length; }
      return;
    }
    if (msg.cls !== C.REQUEST) return;
    const key = authenticate(msg, reply); if (!key) return;
    const ok = attrs => reply(build(msg.method, C.SUCCESS, msg.tid, [...attrs, soft], key));
    const fail = (code, reason) => reply(build(msg.method, C.ERROR, msg.tid, [errorAttr(code, reason), soft], key));

    if (msg.method === M.ALLOCATE) {
      if (allocations.has(id)) return fail(437, 'Allocation Mismatch');
      const rt = msg.get(A.REQUESTED_TRANSPORT); if (!rt || rt.value[0] !== 17) return fail(442, 'Unsupported Transport Protocol');
      if (allocations.size >= maxAllocations) return fail(486, 'Allocation Quota Reached');
      const relay = dgram.createSocket(net.isIPv6(relayBind) ? 'udp6' : 'udp4');
      await new Promise((resolve, reject) => { relay.once('error', reject); relay.bind(0, relayBind, resolve); }).catch(() => null);
      if (!relay.address?.()) return fail(508, 'Insufficient Capacity');
      const a = { id, client, relay, permissions: new Map(), channels: new Map(), expires: 0, timer: null };
      relay.on('message', (data, rinfo) => { if (!permitted(a, rinfo.address)) return; stats.bytesRelayed += data.length; relayToClient(a, data, { address: rinfo.address, port: rinfo.port }); });
      relay.on('error', () => freeAllocation(id));
      allocations.set(id, a); stats.allocations++;
      const lt = msg.get(A.LIFETIME), life = Math.min(MAX_LIFETIME, Math.max(60, lt ? lt.value.readUInt32BE(0) : DEFAULT_LIFETIME)); touch(a, life);
      const lifetime = Buffer.alloc(4); lifetime.writeUInt32BE(life, 0);
      onEvent('info', 'turn-alocacao', 'Câmera usando a retransmissão Andrômeda', { cliente: client.address, via: client.proto });
      return ok([[A.XOR_RELAYED_ADDRESS, encodeXorAddress({ address: relayIp(), port: relay.address().port }, msg.tid)], [A.XOR_MAPPED_ADDRESS, encodeXorAddress(client, msg.tid)], [A.LIFETIME, lifetime]]);
    }
    const a = allocations.get(id); if (!a) return fail(437, 'Allocation Mismatch');
    if (msg.method === M.REFRESH) {
      const lt = msg.get(A.LIFETIME), want = lt ? lt.value.readUInt32BE(0) : DEFAULT_LIFETIME, lifetime = Buffer.alloc(4);
      if (want === 0) { freeAllocation(id); return ok([[A.LIFETIME, lifetime]]); }
      const life = Math.min(MAX_LIFETIME, Math.max(60, want)); touch(a, life); lifetime.writeUInt32BE(life, 0); return ok([[A.LIFETIME, lifetime]]);
    }
    if (msg.method === M.CREATE_PERMISSION) {
      const peers = msg.attrs.filter(x => x.type === A.XOR_PEER_ADDRESS).map(x => xorAddress(x.value, msg.tid)).filter(Boolean);
      if (!peers.length) return fail(400, 'Bad Request');
      if (peers.some(p => !allowPeer(p.address))) return fail(403, 'Forbidden');
      for (const p of peers) a.permissions.set(p.address, clock() + PERMISSION_MS);
      return ok([]);
    }
    if (msg.method === M.CHANNEL_BIND) {
      const ch = msg.get(A.CHANNEL_NUMBER), peerAttr = msg.get(A.XOR_PEER_ADDRESS); if (!ch || !peerAttr) return fail(400, 'Bad Request');
      const number = ch.value.readUInt16BE(0), peer = xorAddress(peerAttr.value, msg.tid);
      if (number < 0x4000 || number > 0x7FFF || !peer) return fail(400, 'Bad Request');
      if (!allowPeer(peer.address)) return fail(403, 'Forbidden');
      const other = [...a.channels.values()].find(c => (c.number === number) !== (c.peer.address === peer.address && c.peer.port === peer.port));
      if (other) return fail(400, 'Bad Request');
      a.channels.set(number, { number, peer, expires: clock() + CHANNEL_MS }); a.permissions.set(peer.address, clock() + PERMISSION_MS);
      return ok([]);
    }
    return fail(400, 'Bad Request');
  }
  function handleChannelData(buf, client) {
    const a = allocations.get(client.proto + '|' + client.address + '|' + client.port); if (!a) return;
    const ch = a.channels.get(buf.readUInt16BE(0)), len = buf.readUInt16BE(2); if (!ch || ch.expires < clock() || buf.length < 4 + len) return;
    a.relay.send(buf.subarray(4, 4 + len), ch.peer.port, ch.peer.address); stats.bytesRelayed += len;
  }
  function onPacket(buf, client, reply) {
    if (buf.length >= 4 && (buf[0] & 0xC0) === 0x40) return handleChannelData(buf, client);
    const msg = parse(buf); if (msg) handleStun(msg, client, reply).catch(e => onEvent('warn', 'turn-erro', 'Retransmissão: ' + e.message));
  }

  return {
    async listen() {
      udp = dgram.createSocket(net.isIPv6(bind) ? 'udp6' : 'udp4');
      udp.on('message', (buf, rinfo) => { const client = { proto: 'udp', address: rinfo.address, port: rinfo.port }; onPacket(buf, client, data => udp.send(data, rinfo.port, rinfo.address)); });
      await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(port, bind, resolve); });
      udp.on('error', e => onEvent('warn', 'turn-erro', 'Retransmissão (UDP): ' + e.message));
      // TCP: redes que bloqueiam UDP. Mensagens STUN e ChannelData chegam enfileiradas no mesmo fluxo.
      tcp = net.createServer(socket => {
        const client = { proto: 'tcp', address: socket.remoteAddress.replace(/^::ffff:/, ''), port: socket.remotePort, socket };
        let pending = Buffer.alloc(0);
        socket.setNoDelay(true);
        socket.on('data', chunk => {
          pending = Buffer.concat([pending, chunk]);
          for (;;) {
            if (pending.length < 4) break;
            const channel = (pending[0] & 0xC0) === 0x40, len = channel ? pending.readUInt16BE(2) + 4 : pending.readUInt16BE(2) + 20, total = channel ? len + ((4 - (len % 4)) % 4) : len;
            if (pending.length < total) break;
            const frame = pending.subarray(0, len); pending = pending.subarray(total);
            onPacket(frame, client, data => { if (!socket.destroyed) socket.write(data); });
          }
          if (pending.length > 65536) socket.destroy();
        });
        const drop = () => freeAllocation('tcp|' + client.address + '|' + client.port);
        socket.on('close', drop); socket.on('error', drop);
      });
      await new Promise((resolve, reject) => { tcp.once('error', reject); tcp.listen(port, bind, resolve); });
      return this;
    },
    address: () => ({ port: udp?.address().port, tcpPort: tcp?.address().port, relayAddress: relayIp() }),
    stats: () => ({ ...stats, active: allocations.size }),
    close() { for (const id of [...allocations.keys()]) freeAllocation(id); try { udp?.close(); } catch { /* fechado */ } tcp?.close(); },
  };
}

module.exports = { createTurnServer, credentials, isPrivate, lanAddress, localAddresses, routeAddress, isCgnatIp, isLanIp, _internal: { parse, build, typeOf, methodOf, crc32, encodeXorAddress, xorAddress, checkIntegrity } };
