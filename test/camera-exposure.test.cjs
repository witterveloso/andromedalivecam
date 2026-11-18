'use strict';
// Exposição e balanço de branco pelo mesmo canal do zoom/enquadramento: a mesa comanda o celular e o celular informa o que oferece.
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), { once } = require('node:events'), { WebSocket } = require('ws');
const { createCameraHub } = require('../camera-hub.cjs');
const next = (ws, type) => new Promise((resolve, reject) => { const timer = setTimeout(() => { ws.off('message', listen); reject(Error('Timed out: ' + type)); }, 3000); function listen(raw) { const m = JSON.parse(raw); if (m.type === type) { clearTimeout(timer); ws.off('message', listen); resolve(m); } } ws.on('message', listen); });
const open = async (url, protocol) => { const ws = new WebSocket(url, protocol); await once(ws, 'open'); return ws; };

test('a mesa controla a exposição e o balanço de branco do celular; os valores são limitados e só campos conhecidos passam', async () => {
  const hub = createCameraHub({ sessionToken: 'tok' }); const deskServer = http.createServer(); deskServer.on('upgrade', (r, s, h) => hub.deskUpgrade(r, s, h));
  deskServer.listen(0, '127.0.0.1'); hub.gateway.listen(0, '127.0.0.1'); await Promise.all([once(deskServer, 'listening'), once(hub.gateway, 'listening')]);
  let desk, camera;
  try {
    hub.configure('https://mesa.example.test'); const inv = hub.invite(1, 'CAM 2');
    desk = await open('ws://127.0.0.1:' + deskServer.address().port, 'andromeda.tok'); camera = await open('ws://127.0.0.1:' + hub.gateway.address().port + '/signal');
    const ready = next(camera, 'ready'); camera.send(JSON.stringify({ type: 'join', key: inv.key })); await ready;
    // celular -> mesa: informa exposição e WB (valores absurdos são limitados, texto estranho vira o padrão)
    const caps = next(desk, 'caps');
    camera.send(JSON.stringify({ type: 'caps', lenses: [], zoom: { min: 1, max: 4, value: 1 }, pan: { x: 0, y: 0 }, model: 'X', exp: { mode: 'manual', ev: 99, min: -3, max: 3, step: 0.33, native: true, evil: 'x' }, wb: { mode: 'weird', kelvin: 5200, min: 2500, max: 9000, step: 50, native: false } }));
    const c = await caps; assert.deepEqual(c.exp, { mode: 'manual', ev: 12, min: -3, max: 3, step: 0.33, native: true }); assert.deepEqual(c.wb, { mode: 'auto', kelvin: 5200, min: 2500, max: 9000, step: 50, native: false });
    // celular antigo, sem exposição no relatório: a mesa recebe valores padrão
    const caps2 = next(desk, 'caps'); camera.send(JSON.stringify({ type: 'caps', lenses: [], zoom: { min: 1, max: 4, value: 2 }, pan: { x: 0, y: 0 } }));
    const c2 = await caps2; assert.equal(c2.exp.mode, 'auto'); assert.equal(c2.exp.ev, 0); assert.equal(c2.wb.mode, 'auto');
    // mesa -> celular
    const k = next(camera, 'control'); desk.send(JSON.stringify({ type: 'control', slot: 1, exp: { mode: 'manual', ev: 1.5, evil: 1 }, wb: { mode: 'manual', kelvin: 3200 }, evil: 'x' }));
    assert.deepEqual(await k, { type: 'control', exp: { mode: 'manual', ev: 1.5 }, wb: { mode: 'manual', kelvin: 3200 } });
    const lim = next(camera, 'control'); desk.send(JSON.stringify({ type: 'control', slot: 1, exp: { ev: -99 }, wb: { kelvin: 99999 } }));
    assert.deepEqual(await lim, { type: 'control', exp: { ev: -12 }, wb: { kelvin: 12000 } });
    // lixo não vira comando
    desk.send(JSON.stringify({ type: 'control', slot: 1, exp: { mode: 'rm -rf', ev: 'a' }, wb: 5 })); await assert.rejects(next(camera, 'control'), /Timed out/);
    // um celular não comanda outro
    camera.send(JSON.stringify({ type: 'control', slot: 1, exp: { mode: 'manual' } })); await assert.rejects(next(camera, 'control'), /Timed out/);
  } finally { desk?.terminate(); camera?.terminate(); deskServer.close(); hub.close(); }
});
