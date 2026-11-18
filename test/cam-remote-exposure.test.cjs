'use strict';
// App da câmera (optics.js): a mesa muda exposição e balanço de branco; o celular aplica no aparelho e avisa de volta.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');

function phone() {
  const dom = new JSDOM('<!doctype html><body><div id="params"></div><select id="lens"></select><div class="telemetry"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, sent = [], applied = [];
  w.prefs = { get: (k, d) => k === 'optics' ? JSON.stringify({ stab: 'off' }) : d, set() {} }; /* estab. desligada: sem processador de vídeo */ w.send = m => sent.push(m); w.say = () => {}; w.mediaSender = () => null; w.cam = { pcs: new Map() };
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'cam', 'optics.js'), 'utf8'));
  const track = { readyState: 'live', getCapabilities: () => ({ zoom: { min: 1, max: 5, step: 0.1 }, exposureCompensation: { min: -3, max: 3, step: 0.5 }, whiteBalanceMode: ['continuous', 'manual'], colorTemperature: { min: 3000, max: 8000, step: 100 } }), getSettings: () => ({ zoom: 1, exposureCompensation: 0 }), applyConstraints: async c => { applied.push(c); }, stop() {} };
  w.AndromedaOptics.attach(track);
  const tick = () => new Promise(r => setTimeout(r, 330));
  return { w, sent, applied, tick, O: w.AndromedaOptics };
}

test('o celular informa exposição e balanço de branco à mesa', async () => {
  const { sent, tick } = phone(); await tick();
  const caps = sent.filter(m => m.type === 'caps').pop(); assert.ok(caps, 'mandou o relatório');
  assert.deepEqual(JSON.parse(JSON.stringify(caps.exp)), { mode: 'auto', ev: 0, min: -3, max: 3, step: 0.5, native: true });
  assert.deepEqual(JSON.parse(JSON.stringify(caps.wb)), { mode: 'auto', kelvin: 5600, min: 3000, max: 8000, step: 100, native: true });
});

test('comando da mesa: exposição manual com compensação em EV (limitada ao que o aparelho aceita) e volta ao automático', async () => {
  const { O, applied, sent, tick } = phone(); await tick();
  O.remote({ exp: { mode: 'manual', ev: 1.5 } }); await tick();
  assert.equal(O.state().exp, 'manual'); assert.equal(O.state().ev, 1.5);
  assert.ok(applied.some(c => c.advanced?.some(g => g.exposureCompensation === 1.5)), 'aplicou a compensação no aparelho');
  assert.equal(sent.filter(m => m.type === 'caps').pop().exp.ev, 1.5, 'avisou a mesa do valor');
  O.remote({ exp: { ev: 99 } }); await tick(); assert.equal(O.state().ev, 3, 'limitado ao máximo do aparelho');
  O.remote({ exp: { ev: -99 } }); await tick(); assert.equal(O.state().ev, -3);
  O.remote({ exp: { mode: 'auto' } }); await tick(); assert.equal(O.state().exp, 'auto');
  assert.ok(applied.at(-1).advanced.some(g => g.exposureCompensation === 0), 'automático zera a compensação aplicada');
});

test('comando da mesa: só o valor já liga o modo manual; balanço de branco em Kelvin', async () => {
  const { O, applied, tick } = phone(); await tick();
  O.remote({ exp: { ev: -1 } }); await tick(); assert.equal(O.state().exp, 'manual');
  O.remote({ wb: { kelvin: 3200 } }); await tick(); assert.equal(O.state().wb, 'manual'); assert.equal(O.state().kelvin, 3200);
  assert.ok(applied.some(c => c.advanced?.some(g => g.whiteBalanceMode === 'manual' && g.colorTemperature === 3200)), 'aplicou o balanço de branco manual');
  O.remote({ wb: { kelvin: 99999 } }); await tick(); assert.equal(O.state().kelvin, 8000);
  O.remote({ wb: { mode: 'auto' } }); await tick(); assert.equal(O.state().wb, 'auto');
});

test('lixo vindo da rede não muda nada', async () => {
  const { O, tick } = phone(); await tick();
  O.remote({ exp: { mode: 'rm -rf', ev: 'a' }, wb: 5 }); O.remote({ exp: null, wb: { mode: 7, kelvin: NaN } }); await tick();
  assert.equal(O.state().exp, 'auto'); assert.equal(O.state().wb, 'auto'); assert.equal(O.state().ev, 0);
});
