'use strict';
// Câmera chegando com a LIVE NO AR: a mesa gera o convite durante a live, o Andrômeda Cam conecta e a imagem chega; o operador
// reabre o MESMO link e a câmera volta. Precisa de Playwright (Chromium); sem ele, o teste é pulado.
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: Playwright ausente'); process.exit(0); }
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(200); } throw Error('tempo esgotado: ' + what); };
(async () => {
  const { startRede } = require('../andromeda-rede.cjs');
  const rede = await startRede({ port: 34860, bind: '127.0.0.1', onEvent: () => {} }), broker = 'ws://127.0.0.1:34860/mqtt';
  // "GitHub Pages" local: serve docs/ com o ponto de encontro de teste.
  const pages = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/+/, '') || 'index.html';
    if (name === 'config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.ANDROMEDA_GATEWAY = ""; window.ANDROMEDA_RELAY = ' + JSON.stringify([broker]) + ';'); return; }
    const file = path.join(root, 'docs', path.normalize(name)); if (!file.startsWith(path.join(root, 'docs')) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  }).listen(34870, '127.0.0.1');
  const env = { ...process.env, ANDROMEDA_RELAY_URLS: broker, ANDROMEDA_CAM_PAGE: 'http://127.0.0.1:34870/', ANDROMEDA_DATA_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'camlive-')) };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k];
  const server = spawn(process.execPath, [path.join(root, 'server.cjs')], { env, stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    await until(async () => { try { return (await fetch('http://localhost:3180/api/session')).ok; } catch { return false; } }, 15000, 'serviço');
    const desk = await (await browser.newContext({ permissions: ['microphone'] })).newPage(); desk.on('pageerror', e => errors.push('mesa: ' + e.message));
    await desk.goto('http://localhost:3180/'); await desk.waitForTimeout(1500);
    // Live no ar (só gravando, para não depender de plataforma): a partir daqui tudo acontece com a transmissão rodando.
    const rec = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'camlive-rec-'));
    await desk.evaluate(dir => { const m = andromedaBroadcast.model; Object.assign(m, { mode: 'record', record: true, dir, recordFormats: '16:9', policy: 'fixed' }); andromedaBroadcast.save(); }, rec);
    await desk.evaluate(() => startBroadcast());
    await until(() => desk.evaluate(() => liveTx.phase === 'sending'), 60000, 'live no ar');
    const inv = await desk.evaluate(async () => { const s = await (await fetch('/api/session')).json(); return (await fetch('/api/cam/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': s.token }, body: JSON.stringify({ slot: 0, name: 'CAM 1 — Palco', profile: { width: 1280, height: 720, fps: 30, bitrate: 3 } }) })).json(); });
    assert.match(inv.url || '', /#r=[0-9a-f]{48}/, 'convite gerado com a live no ar: ' + JSON.stringify(inv));
    const camCtx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 430, height: 900 } });
    const join = async () => { const cam = await camCtx.newPage(); cam.on('pageerror', e => errors.push('câmera: ' + e.message)); await cam.goto(inv.url.replace(/^https?:\/\/[^/]+\/[^#]*/, 'http://127.0.0.1:34870/index.html')); await cam.waitForTimeout(800); await cam.click('#start'); return cam; };
    const frames = () => desk.evaluate(() => { const el = media[0]?.element; return el && el.videoWidth ? el.videoWidth + 'x' + el.videoHeight : ''; });
    let cam = await join();
    await until(async () => (await desk.evaluate(() => !!cams[0].conn)) && !!(await frames()), 40000, 'imagem da câmera na mesa com a live no ar');
    const first = await frames(); assert(await desk.evaluate(() => liveTx.phase === 'sending'), 'a live continua no ar');
    // O operador fecha e reabre o mesmo link (ou o celular troca de rede).
    await cam.close(); cam = await join();
    await until(async () => (await desk.evaluate(() => !!cams[0].conn)) && !!(await frames()), 40000, 'câmera de volta pelo mesmo link');
    assert(await desk.evaluate(() => liveTx.phase === 'sending'), 'a live seguiu no ar durante a reconexão');
    // Troca de rede sem cair (Wi-Fi ↔ 5G): o caminho da imagem cai; o celular refaz só ele, na MESMA conexão com a mesa.
    await desk.evaluate(() => { camDesk.peers.get('0:media').pc._antiga = true; });
    const repathed = await cam.evaluate(async () => { cam.ws._mesma = true; cam.pcs.get('media').pc.close(); return await repath('network'); });
    assert.equal(repathed, true, 'o celular refez o caminho da imagem');
    await until(() => desk.evaluate(() => { const p = camDesk.peers.get('0:media'); return !!p && !p.pc._antiga && p.pc.connectionState === 'connected'; }), 30000, 'imagem de volta pelo caminho novo');
    assert(await cam.evaluate(() => cam.ws._mesma === true), 'sem reconectar à mesa (mesma conexão)');
    assert(await desk.evaluate(() => liveTx.phase === 'sending'), 'a live seguiu no ar durante a troca de rede');
    await desk.evaluate(() => stopTransport()); await until(() => desk.evaluate(() => liveTx.phase === 'idle'), 20000, 'live encerrada');
    assert.deepEqual(errors.filter(e => !/play\(\)|AbortError/.test(e)), []);
    console.log('PASS: com a live no ar: convite gerado, câmera conectou (' + first + '), voltou pelo mesmo link, trocou de rede sem cair, live seguiu no ar');
  } finally { await browser.close(); server.kill(); pages.close(); rede.close(); }
})().catch(e => { console.error(e); process.exit(1); });
