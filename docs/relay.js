/*
 * Andrômeda Live — ponto de encontro das câmeras pela internet.
 *
 * A mesa e o celular trocam só a "apresentação" da conexão WebRTC (oferta, resposta,
 * candidatos, tally) por mensageiros MQTT públicos sobre WSS. O vídeo vai direto
 * do celular para a mesa. Cada convite gera um tópico e uma chave AES-GCM próprios:
 * o mensageiro só vê bytes cifrados num tópico impossível de adivinhar.
 *
 * O mesmo arquivo roda no navegador (window.AndromedaRelay) e no Node 22+ (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AndromedaRelay = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const subtle = () => globalThis.crypto.subtle;
  const randomHex = bytes => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

  /* ---------- MQTT 3.1.1 (só o necessário: QoS 0) ---------- */

  function utf8Field(text) { const b = encoder.encode(text); const out = new Uint8Array(2 + b.length); out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2); return out; }
  function remainingLength(n) { const out = []; do { let byte = n % 128; n = Math.floor(n / 128); if (n > 0) byte |= 128; out.push(byte); } while (n > 0); return out; }
  function concat(parts) { const size = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  function packet(first, ...body) { const payload = concat(body.map(b => b instanceof Uint8Array ? b : Uint8Array.from(b))); return concat([Uint8Array.from([first, ...remainingLength(payload.length)]), payload]); }

  const mqtt = {
    connect: (clientId, keepalive = 30) => packet(0x10, utf8Field('MQTT'), [4, 0x02, keepalive >> 8, keepalive & 255], utf8Field(clientId)),
    subscribe: (id, topic) => packet(0x82, [id >> 8, id & 255], utf8Field(topic), [0]),
    publish: (topic, payload) => packet(0x30, utf8Field(topic), payload),
    pingreq: () => Uint8Array.from([0xc0, 0]),
    disconnect: () => Uint8Array.from([0xe0, 0]),
    // Junta pedaços recebidos e devolve pacotes completos: {type, flags, body}.
    Parser: class {
      constructor() { this.buffer = new Uint8Array(0); }
      push(chunk) {
        this.buffer = concat([this.buffer, chunk]); const out = [];
        for (;;) {
          const b = this.buffer; if (b.length < 2) break;
          let length = 0, multiplier = 1, i = 1, byte;
          do { if (i >= b.length) return out; byte = b[i++]; length += (byte & 127) * multiplier; multiplier *= 128; } while (byte & 128 && i < 5);
          if (b.length < i + length) break;
          out.push({ type: b[0] >> 4, flags: b[0] & 15, body: b.subarray(i, i + length) });
          this.buffer = b.slice(i + length);
        }
        return out;
      }
    },
    readPublish(p) { const n = (p.body[0] << 8) | p.body[1], topic = decoder.decode(p.body.subarray(2, 2 + n)); let o = 2 + n; if ((p.flags >> 1) & 3) o += 2; return { topic, payload: p.body.subarray(o) }; },
  };

  /* ---------- chaves do convite ---------- */

  async function deriveChannel(inviteKey) {
    const raw = encoder.encode(String(inviteKey));
    const topic = 'andromeda-live/v1/' + hex(await subtle().digest('SHA-256', concat([encoder.encode('andromeda-live topic\0'), raw]))).slice(0, 48);
    const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const key = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('andromeda-live'), info: encoder.encode('signal v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { topic, key };
  }
  async function seal(key, object) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(object))));
    return concat([iv, data]);
  }
  async function open(key, bytes) {
    if (bytes.length < 29) return null;
    try { return JSON.parse(decoder.decode(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)))); } catch { return null; }
  }

  /* ---------- conexão com um mensageiro ---------- */

  class Broker {
    constructor(url, { onMessage, onState, WebSocketImpl }) {
      this.url = url; this.onMessage = onMessage; this.onState = onState; this.WebSocketImpl = WebSocketImpl || globalThis.WebSocket;
      this.topics = new Set(); this.linked = false; this.ready = false; this.closed = false; this.retry = 1000; this.packetId = 1; this.open();
    }
    open() {
      if (this.closed) return;
      let ws; try { ws = new this.WebSocketImpl(this.url, 'mqtt'); } catch { this.schedule(); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer'; const parser = new mqtt.Parser();
      ws.onopen = () => ws.send(mqtt.connect('alv-' + randomHex(8)));
      ws.onmessage = event => {
        for (const p of parser.push(new Uint8Array(event.data))) {
          // CONNACK: conectado; SUBACK: inscrito no tópico, pronto para conversar.
          if (p.type === 2) { if (p.body[1] !== 0) { ws.close(); return; } this.linked = true; this.retry = 1000; for (const t of this.topics) ws.send(mqtt.subscribe(this.packetId++ & 0xffff || 1, t)); this.ping = setInterval(() => this.send(mqtt.pingreq()), 20000); this.ping.unref?.(); }
          else if (p.type === 9) { this.ready = true; this.onState?.(); }
          else if (p.type === 3) { const m = mqtt.readPublish(p); this.onMessage(m.topic, m.payload); }
        }
      };
      ws.onclose = () => { clearInterval(this.ping); const was = this.ready; this.linked = false; this.ready = false; if (was) this.onState?.(); this.schedule(); };
      ws.onerror = () => {};
    }
    schedule() { if (this.closed) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), this.retry); this.timer.unref?.(); this.retry = Math.min(15000, this.retry * 2); }
    send(bytes) { if (this.linked && this.ws?.readyState === 1) { this.ws.send(bytes); return true; } return false; }
    subscribe(topic) { this.topics.add(topic); if (this.linked) this.send(mqtt.subscribe(this.packetId++ & 0xffff || 1, topic)); }
    close() { this.closed = true; clearTimeout(this.timer); clearInterval(this.ping); try { this.send(mqtt.disconnect()); this.ws?.close(); } catch { /* já fechado */ } }
  }

  /*
   * Canal de um convite. role: 'desk' (mesa) ou 'cam' (celular).
   * send(obj) cifra e publica em todos os mensageiros conectados; mensagens repetidas
   * (chegam por mais de um mensageiro) e as do próprio lado são descartadas.
   */
  class Channel {
    constructor({ inviteKey, role, brokers = DEFAULT_BROKERS, WebSocketImpl }) {
      this.role = role; this.seen = new Map(); this.listeners = new Set(); this.brokers = []; this.closed = false;
      this.ready = deriveChannel(inviteKey).then(({ topic, key }) => {
        this.topic = topic; this.key = key;
      if (this.closed) return; // fechado antes de terminar de preparar o canal
        this.brokers = brokers.map(url => new Broker(url, { WebSocketImpl, onMessage: (t, payload) => this.receive(t, payload), onState: () => this.stateChanged() }));
        for (const b of this.brokers) b.subscribe(topic);
      });
    }
    connected() { return this.brokers.filter(b => b.ready).length; }
    stateChanged() { this.onstate?.(this.connected(), this.brokers.length); for (const w of this.waiters || []) if (this.connected()) w(); if (this.connected()) this.waiters = []; }
    // Resolve quando pelo menos um mensageiro está conectado e inscrito no tópico.
    async whenConnected(timeout = 10000) {
      await this.ready; if (this.connected()) return true;
      return new Promise(resolve => { const t = setTimeout(() => resolve(false), timeout); (this.waiters ||= []).push(() => { clearTimeout(t); resolve(true); }); });
    }
    async receive(topic, payload) {
      if (topic !== this.topic || this.closed) return;
      const env = await open(this.key, payload); if (!env || env.from === this.role || typeof env.id !== 'string') return;
      if (this.seen.has(env.id)) return; this.seen.set(env.id, Date.now());
      if (this.seen.size > 500) for (const [id, t] of this.seen) { if (Date.now() - t > 60000) this.seen.delete(id); else break; }
      for (const fn of this.listeners) fn(env);
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    async send(body) {
      await this.ready; if (this.closed) return 0;
      const bytes = mqtt.publish(this.topic, await seal(this.key, { ...body, id: randomHex(8), from: this.role, t: Date.now() }));
      return this.brokers.reduce((n, b) => n + (b.ready && b.send(bytes) ? 1 : 0), 0);
    }
    close() { this.closed = true; this.listeners.clear(); for (const b of this.brokers) b.close(); }
  }

  return { DEFAULT_BROKERS, Channel, mqtt, deriveChannel, seal, open, randomHex };
}));
