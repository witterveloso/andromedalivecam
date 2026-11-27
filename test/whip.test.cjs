'use strict';
// WHIP: o serviço só faz a apresentação HTTP (oferta → resposta + Location, e DELETE no fim). Servidor WHIP local de verdade.
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const whip = require('../whip.cjs');
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

test('oferta vai com token Bearer e application/sdp; resposta e Location voltam para a mesa', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], auth: req.headers.authorization, body });
      if (req.method === 'POST') { if (req.headers.authorization !== 'Bearer tok-123') { res.writeHead(401).end(); return; } res.writeHead(201, { 'Content-Type': 'application/sdp', Location: '/whip/sessao/42' }).end(SDP.replace('o=- 1', 'o=- 9')); }
      else res.writeHead(200).end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = await whip.offer({ url: base + '/whip/endpoint', token: 'tok-123', sdp: SDP });
    assert.match(r.sdp, /^v=0/); assert.equal(r.location, base + '/whip/sessao/42', 'Location relativo vira endereço completo');
    assert.deepEqual([seen[0].method, seen[0].type, seen[0].auth, seen[0].body], ['POST', 'application/sdp', 'Bearer tok-123', SDP]);
    await assert.rejects(whip.offer({ url: base + '/whip/endpoint', token: 'errado', sdp: SDP }), /recusou o token \(401\)/);
    assert.deepEqual(await whip.stop({ location: r.location, token: 'tok-123' }), { ok: true, status: 200 });
    assert.equal(seen.at(-1).method, 'DELETE'); assert.equal(seen.at(-1).auth, 'Bearer tok-123');
  } finally { server.close(); }
});

test('só HTTPS na internet; HTTP apenas nesta máquina ou na rede local; nada de usuário e senha no endereço', async () => {
  assert.equal(whip.checkUrl('https://whip.example.com/live').hostname, 'whip.example.com');
  for (const ok of ['http://127.0.0.1:8889/whip', 'http://192.168.0.10:8889/x/whip', 'http://estudio.local/whip', 'http://[::1]:8889/whip']) assert(whip.checkUrl(ok));
  assert.throws(() => whip.checkUrl('http://whip.example.com/live'), /https/);
  assert.throws(() => whip.checkUrl('https://user:pass@whip.example.com/live'), /usuário e senha/);
  assert.throws(() => whip.checkUrl('ftp://x/y'), /https/);
  await assert.rejects(whip.offer({ url: 'https://whip.example.com/x', token: 'com espaço', sdp: SDP }, { fetchImpl: async () => { throw Error('não deveria chamar'); } }), /Token WHIP inválido/);
  await assert.rejects(whip.offer({ url: 'https://whip.example.com/x', sdp: 'não é sdp' }, { fetchImpl: async () => { throw Error('não deveria chamar'); } }), /Oferta WebRTC inválida/);
  await assert.rejects(whip.offer({ url: 'https://whip.example.com/x', sdp: SDP }, { fetchImpl: async () => new Response('x', { status: 404 }) }), /não encontrado \(404\)/);
  await assert.rejects(whip.offer({ url: 'https://whip.example.com/x', sdp: SDP }, { fetchImpl: async () => new Response('<html>', { status: 201 }) }), /resposta WebRTC válida/);
});
