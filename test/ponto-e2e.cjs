'use strict';
// PONTO de ponta a ponta: mesa real + app do apresentador (docs/ponto.html) + ponto de encontro próprio da Rede Andrômeda.
// Mede o áudio de verdade nas duas direções. Precisa de Playwright (Chromium); sem ele, o teste é pulado.
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: Playwright ausente'); process.exit(0); }
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(200); } throw Error('tempo esgotado: ' + what); };
(async () => {
  const { startRede } = require('../andromeda-rede.cjs');
  const rede = await startRede({ port: 34840, bind: '127.0.0.1', onEvent: () => {} }), broker = 'ws://127.0.0.1:34840/mqtt';
  // "GitHub Pages" local: serve docs/ com o ponto de encontro de teste.
  const pages = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/+/, '') || 'index.html';
    if (name === 'config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.ANDROMEDA_GATEWAY = ""; window.ANDROMEDA_RELAY = ' + JSON.stringify([broker]) + ';'); return; }
    const file = path.join(root, 'docs', path.normalize(name)); if (!file.startsWith(path.join(root, 'docs')) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  }).listen(34850, '127.0.0.1');
  const env = { ...process.env, ANDROMEDA_RELAY_URLS: broker, ANDROMEDA_CAM_PAGE: 'http://127.0.0.1:34850/', ANDROMEDA_DATA_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ponto-')) };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k];
  const server = spawn(process.execPath, [path.join(root, 'server.cjs')], { env, stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    await until(async () => { try { return (await fetch('http://localhost:3180/api/session')).ok; } catch { return false; } }, 15000, 'serviço');
    const desk = await (await browser.newContext({ permissions: ['microphone'] })).newPage(); desk.on('pageerror', e => errors.push('mesa: ' + e.message));
    await desk.goto('http://localhost:3180/'); await desk.waitForTimeout(1500);
    // O botão PONTO está no quadro Comandos.
    assert(await desk.evaluate(() => [...document.querySelectorAll('.cmd-grid button, .cmd-grid [role=button]')].some(b => /PONTO/.test(b.textContent))), 'botão PONTO nos Comandos');
    const inv = await desk.evaluate(async () => { const s = await (await fetch('/api/session')).json(); return (await fetch('/api/ponto/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': s.token }, body: JSON.stringify({ slot: 0, name: 'Apresentador' }) })).json(); });
    assert.match(inv.url, /^http:\/\/127\.0\.0\.1:34850\/ponto\.html#r=[0-9a-f]{48}$/);
    const ponto = await (await browser.newContext({ permissions: ['microphone'] })).newPage(); ponto.on('pageerror', e => errors.push('ponto: ' + e.message));
    await ponto.goto(inv.url); await ponto.click('#enter');
    await until(() => ponto.evaluate(() => document.body.dataset.state === 'live'), 30000, 'ponto conectado').catch(async e => { console.log('STATUS PONTO:', await ponto.textContent('#status'), '| state', await ponto.evaluate(() => document.body.dataset.state), '| pc', await ponto.evaluate(() => window.andromedaPonto?.pc?.connectionState)); throw e; });
    assert.equal(await ponto.textContent('#who'), 'Apresentador');
    // Medidor de áudio dos dois lados (o microfone falso do Chromium é um bipe contínuo).
    const meter = sel => `(() => { const el = ${sel}; if (!el?.srcObject) return 0; window.__m = window.__m || new Map(); let m = window.__m.get(el); if (!m) { const ac = new AudioContext(); const a = ac.createAnalyser(); a.fftSize = 2048; ac.createMediaStreamSource(el.srcObject).connect(a); m = { a, ac }; window.__m.set(el, m); } m.ac.resume(); const d = new Float32Array(2048); m.a.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length); })()`;
    const pontoLevel = async () => { let max = 0; for (let i = 0; i < 6; i++) { max = Math.max(max, await ponto.evaluate(meter('document.querySelector("#ear")'))); await wait(150); } return max; };
    await desk.evaluate(() => window.andromedaPonto.enable());
    await wait(1500); const quiet = await pontoLevel();
    await desk.evaluate(() => window.andromedaPonto.toggle());   // botão PONTO: abre a fala
    await until(() => ponto.evaluate(() => document.body.dataset.cue === 'on'), 5000, 'DIREÇÃO FALANDO na tela do ponto');
    await wait(1200); const speaking = await pontoLevel();
    assert(speaking > 0.01 && speaking > quiet * 5, 'a voz da direção chega no fone do apresentador (silêncio ' + quiet.toFixed(4) + ' → falando ' + speaking.toFixed(4) + ')');
    await desk.evaluate(() => window.andromedaPonto.toggle());   // fecha a fala
    await until(() => ponto.evaluate(() => document.body.dataset.cue === 'off'), 5000, 'fala encerrada');
    await wait(800); const after = await pontoLevel(); assert(after < speaking / 5, 'fechou a fala, o fone fica em silêncio (' + after.toFixed(4) + ')');
    // Aviso escrito
    await desk.evaluate(() => window.andromedaPonto.note('30 segundos'));
    await until(() => ponto.evaluate(() => !document.querySelector('#note').hidden && document.querySelector('#noteText').textContent === '30 segundos'), 5000, 'aviso na tela do ponto');
    // Apresentador chama a direção: a mesa vê e ouve.
    const box = await ponto.locator('#talk').boundingBox(); await ponto.mouse.move(box.x + 20, box.y + 20); await ponto.mouse.down();
    await until(() => desk.evaluate(() => window.andromedaPonto.calling()), 5000, 'mesa vê o apresentador chamando');
    assert.match(await desk.evaluate(() => window.andromedaPonto.label()), /Apresentador chamando/);
    await wait(1200); let back = 0; for (let i = 0; i < 6; i++) { back = Math.max(back, await desk.evaluate(meter('[...window.andromedaPonto.state.peers.values()][0]?.out'))); await wait(150); }
    assert(back > 0.01, 'a voz do apresentador chega na mesa (' + back.toFixed(4) + ')');
    await ponto.mouse.up(); await until(() => desk.evaluate(() => !window.andromedaPonto.calling()), 5000, 'chamada encerrada');
    // Retorno do programa: o apresentador liga e a mesa passa a mandar o programa (abaixado quando a direção fala).
    await ponto.click('#ret'); await until(() => desk.evaluate(() => [...window.andromedaPonto.state.peers.values()][0]?.returnOn === true), 5000, 'retorno ligado');
    // Revogar: o ponto é avisado.
    await desk.evaluate(async () => { const s = await (await fetch('/api/session')).json(); await fetch('/api/ponto/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': s.token }, body: JSON.stringify({ slot: 0 }) }); });
    await until(() => ponto.evaluate(() => /revogado|expirado/.test(document.querySelector('#status').textContent)), 8000, 'ponto avisado da revogação');
    assert.deepEqual(errors, []);
    console.log('PASS: PONTO de ponta a ponta: voz da direção ' + speaking.toFixed(3) + ' (silêncio ' + quiet.toFixed(3) + '), aviso escrito, chamada do apresentador ' + back.toFixed(3) + ', retorno, revogação');
  } finally { await browser.close(); server.kill(); pages.close(); rede.close(); }
})().catch(e => { console.error(e); process.exit(1); });
