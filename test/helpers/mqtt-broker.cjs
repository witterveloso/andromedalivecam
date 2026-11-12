'use strict';
// Mensageiro MQTT mínimo (QoS 0, sobre WebSocket) só para testes: faz o papel dos mensageiros públicos.
const http = require('node:http'), { once } = require('node:events'), { WebSocketServer } = require('ws');
const { mqtt } = require('../../public/cam/relay.js');

async function startBroker() {
  const server = http.createServer(), wss = new WebSocketServer({ server, handleProtocols: protocols => protocols.has('mqtt') ? 'mqtt' : false });
  const subs = new Map(); let published = 0;
  wss.on('connection', ws => {
    const parser = new mqtt.Parser(), topics = new Set();
    ws.on('message', data => {
      for (const p of parser.push(new Uint8Array(data))) {
        if (p.type === 1) ws.send(Uint8Array.from([0x20, 2, 0, 0]));
        else if (p.type === 8) {
          const id = [p.body[0], p.body[1]], n = (p.body[2] << 8) | p.body[3], topic = Buffer.from(p.body.subarray(4, 4 + n)).toString();
          topics.add(topic); if (!subs.has(topic)) subs.set(topic, new Set()); subs.get(topic).add(ws);
          ws.send(Uint8Array.from([0x90, 3, ...id, 0]));
        } else if (p.type === 3) {
          const { topic, payload } = mqtt.readPublish(p); published++;
          for (const peer of subs.get(topic) || []) if (peer.readyState === 1) peer.send(mqtt.publish(topic, payload));
        } else if (p.type === 12) ws.send(Uint8Array.from([0xd0, 0]));
      }
    });
    ws.on('close', () => { for (const t of topics) subs.get(t)?.delete(ws); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: 'ws://127.0.0.1:' + server.address().port, published: () => published, close: () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); } };
}

module.exports = { startBroker };
