'use strict';
// PONTO no serviço: convites próprios (separados das câmeras), sinalização só entre a mesa e o ponto certo, avisos, chamada,
// revogação, o mesmo link reconectando e convites que continuam valendo depois de reabrir o programa.
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), { EventEmitter, once } = require('node:events');
const { WebSocket } = require('ws');
const { createPontoHub } = require('../ponto-hub.cjs');

// Celular do ponto: mesma interface que o ponto de encontro (relay.cjs) entrega ao hub.
function phone() {
  const c = new EventEmitter();
  Object.assign(c, { readyState: 1, bufferedAmount: 0, got: [], closed: null, send(t) { c.got.push(JSON.parse(t)); }, close(code) { if (c.readyState !== 1) return; c.readyState = 3; c.closed = code; c.emit('close', code); } });
  c.msg = m => c.emit('message', JSON.stringify(m)); c.last = type => [...c.got].reverse().find(m => m.type === type);
  return c;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('ponto: convites próprios, sinalização e avisos só para o ponto certo, chamada, mesmo link e revogação', async () => {
  const saved = { list: [] }, store = { load: () => JSON.parse(JSON.stringify(saved.list)), save: l => { saved.list = l; } };
  let hub = createPontoHub({ sessionToken: 'tok', inviteURL: k => 'https://exemplo.test/ponto.html#r=' + k, store });
  const server = http.createServer(); server.on('upgrade', (req, socket, head) => hub.deskUpgrade(req, socket, head));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const deskGot = [];
  const desk = new WebSocket('ws://127.0.0.1:' + server.address().port + '/ponto-signal', 'andromeda.tok'); desk.on('message', raw => deskGot.push(JSON.parse(raw)));
  try {
    await once(desk, 'open');
    const a = hub.invite(0, 'Apresentador\u0007'), b = hub.invite(1, 'Repórter');
    assert.equal(a.name, 'Apresentador', 'nome sem caracteres de controle'); assert.match(a.url, /ponto\.html#r=[0-9a-f]{48}$/);
    assert.equal(saved.list.length, 2, 'convites guardados'); assert.throws(() => hub.invite(9, 'x'), /1 a 4/);
    const keyA = a.url.split('#r=')[1], keyB = b.url.split('#r=')[1];
    assert.equal(hub.lookup(keyA).kind, 'ponto');
    const pa = phone(), pb = phone(); hub.join(pa, keyA); hub.join(pb, keyB);
    assert.equal(pa.last('ready').name, 'Apresentador'); assert(pa.last('negotiate'), 'mesa presente: o ponto abre o áudio');
    const bad = phone(); hub.join(bad, 'f'.repeat(48)); assert.equal(bad.closed, 4001, 'convite desconhecido é recusado');
    await wait(100);
    assert.deepEqual(deskGot.filter(m => m.type === 'ponto').map(m => m.name).sort(), ['Apresentador', 'Repórter']);
    // Sinalização: oferta do apresentador chega à mesa com o número do ponto; a resposta da mesa vai só para ele.
    pa.msg({ type: 'signal', signal: { description: { type: 'offer', sdp: 'v=0\r\n' } } }); await wait(100);
    assert.equal(deskGot.find(m => m.type === 'signal').slot, 0);
    desk.send(JSON.stringify({ type: 'signal', slot: 0, signal: { description: { type: 'answer', sdp: 'v=0\r\n' } } }));
    // Fala da direção só com o apresentador; aviso escrito só para ele.
    desk.send(JSON.stringify({ type: 'cue', slots: [0], talking: true })); desk.send(JSON.stringify({ type: 'msg', slots: [0], text: '30 segundos\n' }));
    await wait(150);
    assert.equal(pa.last('signal').signal.description.type, 'answer'); assert(!pb.last('signal'), 'o repórter não recebe a sinalização do apresentador');
    assert.equal(pa.last('cue').talking, true); assert.equal(pb.last('cue').talking, false, 'o repórter vê a direção em silêncio');
    assert.equal(pa.last('msg').text, '30 segundos'); assert(!pb.last('msg'), 'aviso só para quem foi escolhido');
    // O apresentador chama a direção e liga o retorno do programa.
    pa.msg({ type: 'talkback', active: true }); pa.msg({ type: 'return', on: true }); await wait(100);
    assert.deepEqual(deskGot.filter(m => m.type === 'talkback').at(-1), { type: 'talkback', slot: 0, active: true });
    assert.equal(deskGot.filter(m => m.type === 'return').at(-1).on, true);
    // Mesmo link aberto de novo: o novo assume, o antigo é avisado (4006).
    const pa2 = phone(); hub.join(pa2, keyA); assert.equal(pa.closed, 4006); assert.equal(pa2.last('ready').slot, 0);
    // Programa fechado e aberto de novo: o mesmo link vale.
    hub.close(); hub = createPontoHub({ sessionToken: 'tok', inviteURL: k => 'https://exemplo.test/ponto.html#r=' + k, store });
    assert.equal(hub.restore(), 2); const pa3 = phone(); hub.join(pa3, keyA); assert.equal(pa3.last('ready').name, 'Apresentador');
    // Revogar: o ponto sai e o link deixa de valer.
    hub.revoke(0); assert.equal(pa3.closed, 4002); const pa4 = phone(); hub.join(pa4, keyA); assert.equal(pa4.closed, 4001);
    assert.equal(saved.list.length, 1, 'só o repórter continua guardado');
  } finally { desk.terminate(); hub.close(); server.close(); }
});
