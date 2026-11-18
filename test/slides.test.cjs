'use strict';
// Slides: arquivos servidos, conversor (PowerPoint/LibreOffice → PDF) protegido por token e ligações da mesa.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createBridge } = require('../server.cjs'), { findLibreOffice } = require('../slides-convert.cjs');

// Porta livre de verdade (pedida ao sistema) e o endereço 127.0.0.1: sem colisão de porta nem demora do "localhost" (IPv6) em máquinas de CI.
const freePort = () => new Promise((resolve, reject) => { const s = require('node:net').createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function fetchSession(base) { let last; for (let i = 0; i < 8; i++) { try { return await (await fetch(base + '/api/session')).json(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 150)); } } throw last; }
const pub = path.join(__dirname, '..', 'public'), read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

async function withBridge(env, fn) {
  const saved = {}; for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-slides-test-')), port = await freePort();
  const bridge = createBridge({ dataDir: dir, port, camPort: null, lanPort: 0, relayBrokers: ['ws://127.0.0.1:1'] });
  await new Promise(resolve => bridge.server.listen(port, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + port, await fetchSession('http://127.0.0.1:' + port)); }
  finally { bridge.shutdown(); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a mesa carrega os slides depois do roteiro e antes da personalização do layout, com o leitor de PDF embutido', () => {
  const html = read('public/index.html');
  assert.ok(html.indexOf('/rundown.js') < html.indexOf('/slides-pptx.js') && html.indexOf('/slides-pptx.js') < html.indexOf('/slides.js'), 'rundown → slides-pptx → slides');
  assert.ok(html.indexOf('/slides.js') < html.indexOf('/workspace-custom.js'), 'o painel existe antes do layout montar os painéis');
  const server = read('server.cjs');
  assert.match(server, /'\/slides\.js':'slides\.js'/); assert.match(server, /'\/slides-pptx\.js':'slides-pptx\.js'/); assert.match(server, /vendor\/pdfjs/);
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'LICENSE-pdfjs.txt']) assert.ok(fs.existsSync(path.join(pub, 'vendor', 'pdfjs', f)), f);
  assert.ok(fs.readdirSync(path.join(pub, 'vendor', 'pdfjs', 'standard_fonts')).length > 5 && fs.readdirSync(path.join(pub, 'vendor', 'pdfjs', 'cmaps')).length > 50, 'fontes padrão e mapas de caracteres do PDF');
  const js = read('public/slides.js');
  for (const ext of ['pdf', 'pptx', 'ppt', 'odp', 'key', 'png', 'jpg', 'webp', 'svg', 'docx', 'xlsx']) assert.ok(new RegExp("'" + ext + "'").test(js), 'formato ' + ext);
});

test('o serviço entrega o leitor de PDF com os tipos certos e o painel de slides', async () => {
  await withBridge({}, async base => {
    for (const [url, type] of [['/slides.js', /javascript/], ['/slides-pptx.js', /javascript/], ['/vendor/pdfjs/pdf.min.mjs', /javascript/], ['/vendor/pdfjs/pdf.worker.min.mjs', /javascript/], ['/vendor/pdfjs/wasm/openjpeg.wasm', /application\/wasm/], ['/vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap', /octet-stream/]]) {
      const r = await fetch(base + url); assert.equal(r.status, 200, url); assert.match(r.headers.get('content-type'), type, url); await r.arrayBuffer();
    }
    assert.equal((await fetch(base + '/vendor/pdfjs/nao-existe.mjs')).status, 404);
  });
});

test('converter: exige o token, recusa arquivo vazio e avisa quando não há PowerPoint nem LibreOffice', async () => {
  await withBridge({ ANDROMEDA_SLIDES_ENGINE: 'none' }, async (base, session) => {
    const st = await (await fetch(base + '/api/slides/status')).json(); assert.deepEqual([st.powerpoint, st.libreoffice, st.ready], [false, false, false]);
    assert.equal((await fetch(base + '/api/slides/convert?ext=pptx', { method: 'POST', body: 'x' })).status, 403, 'sem token');
    assert.equal((await fetch(base + '/api/slides/convert?ext=pptx', { method: 'POST', headers: { 'X-Andromeda-Token': 'errado' }, body: 'x' })).status, 403, 'token errado');
    assert.equal((await fetch(base + '/api/slides/convert?ext=pptx', { method: 'POST', headers: { 'X-Andromeda-Token': session.token } })).status, 400, 'vazio');
    const r = await fetch(base + '/api/slides/convert?ext=..%2F..%2Fpptx', { method: 'POST', headers: { 'X-Andromeda-Token': session.token }, body: 'PK-fake' });
    const body = await r.json(); assert.equal(r.status, 501); assert.equal(body.code, 'no-engine'); assert.match(body.error, /PowerPoint|LibreOffice/);
    assert.equal((await fetch(base + '/api/slides/convert?ext=pptx', { method: 'GET' })).status, 404, 'só POST');
  });
});

test('converter com o LibreOffice: documento vira PDF e a pasta temporária é apagada', { skip: !findLibreOffice() && 'LibreOffice ausente' }, async () => {
  await withBridge({}, async (base, session) => {
    assert.equal((await (await fetch(base + '/api/slides/status')).json()).ready, true);
    const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('andromeda-slides-') && !n.includes('test')).length;
    const r = await fetch(base + '/api/slides/convert?ext=txt', { method: 'POST', headers: { 'X-Andromeda-Token': session.token }, body: 'Slide de teste\n\nSegunda linha' });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf');
    const pdf = Buffer.from(await r.arrayBuffer()); assert.equal(pdf.subarray(0, 4).toString(), '%PDF'); assert.ok(pdf.length > 500);
    await new Promise(r2 => setTimeout(r2, 300));
    assert.equal(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('andromeda-slides-') && !n.includes('test')).length, before, 'sem sobras em %TEMP%');
  });
});

test('os atalhos e o controle remoto conhecem os slides', () => {
  const commands = read('public/commands.js'), desk = read('public/remote-desk.js'), page = read('docs/remoto.js');
  for (const id of ['slides', 'slidenext', 'slideprev', 'slidefirst', 'slidelast']) assert.match(commands, new RegExp("id: '" + id + "'"), 'atalho ' + id);
  assert.match(commands, /key: 'PageDown'/); assert.match(commands, /key: 'PageUp'/);
  for (const c of ['slides', 'slidenext', 'slideprev', 'slidego']) assert.match(desk, new RegExp("case '" + c + "'"), 'comando remoto ' + c);
  assert.match(page, /cmd\('slidenext'\)/); assert.match(page, /cmd\('slideprev'\)/);
});
