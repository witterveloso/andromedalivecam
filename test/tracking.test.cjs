'use strict';
// Tracking: o núcleo mantém o alvo no quadro, num celular simulado com a mesma geometria do app da câmera (zoom + pan digitais).
const test = require('node:test'), assert = require('node:assert/strict');
const { Tracker, MotionDetector, pickSubject, travel, FRAMES } = require('../public/tracking-core.js');

// Mundo: o alvo anda em coordenadas do quadro inteiro (0–1). A janela do celular mostra 1/zoom do quadro, deslocada pelo pan.
function world({ zoom = 2, pan = { x: 0, y: 0 }, zoomMin = 1, zoomMax = 4 } = {}) {
  const w = { zoom, pan: { ...pan }, zoomMin, zoomMax, subject: { x: 0.5, y: 0.5, h: 0.2 } };
  w.view = () => { // onde o alvo aparece na imagem recortada (0–1) e quão alto
    const room = 0.5 - 0.5 / w.zoom, cx = 0.5 + w.pan.x * room, cy = 0.5 + w.pan.y * room, size = 1 / w.zoom;
    return { cx: (w.subject.x - (cx - size / 2)) / size, cy: (w.subject.y - (cy - size / 2)) / size, h: w.subject.h / size };
  };
  w.apply = c => { if (c.pan) w.pan = { ...c.pan }; if (c.zoom) w.zoom = c.zoom; };
  return w;
}
const det = (v, kind = 'face') => ({ cx: v.cx, cy: v.cy, w: v.h * 0.8, h: v.h, kind });
const inView = v => v.cx > 0 && v.cx < 1 && v.cy > 0 && v.cy < 1;

test('a geometria do pan: sem zoom não há folga, com zoom 3× uma unidade de pan move um quadro inteiro', () => {
  assert.equal(travel(1), 0); assert.equal(travel(3), 1); assert.equal(travel(2), 0.5);
  const w = world({ zoom: 3 }); w.subject = { x: 0.5 + (0.5 - 0.5 / 3), y: 0.5, h: 0.1 }; // alvo na borda direita do quadro inteiro
  assert.ok(w.view().cx > 0.99, 'sem pan o alvo está na borda'); w.pan.x = 1; assert.ok(Math.abs(w.view().cx - 0.5) < 1e-9, 'pan +1 centraliza');
});

test('segue uma pessoa que anda de um lado ao outro e a mantém dentro do quadro', () => {
  const w = world({ zoom: 2.5 }), t = new Tracker({ speed: 'normal' });
  let worst = 0, steps = 0;
  for (let i = 0; i < 600; i++) { // 60 s a 10 quadros por segundo
    w.subject.x = 0.5 + 0.28 * Math.sin(i / 10 * 0.35); w.subject.y = 0.5 + 0.06 * Math.sin(i / 10 * 0.5);
    const v = w.view(), out = t.update(det(v), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 4 }, 0.1); w.apply(out); steps++;
    if (i > 30) worst = Math.max(worst, Math.abs(w.view().cx - 0.5), Math.abs(w.view().cy - 0.42));
    assert.ok(inView(w.view()) || i < 5, 'o alvo não saiu do quadro (passo ' + i + ')');
  }
  assert.ok(worst < 0.3, 'erro máximo ' + worst.toFixed(2));
});

test('sem zoom o modo "só seguir" aplica um zoom mínimo para ter folga; com zoom já alto não mexe no zoom', () => {
  const t = new Tracker({ frame: 'seguir' }), w = world({ zoom: 1 }); w.subject = { x: 0.55, y: 0.5, h: 0.2 };
  let out; for (let i = 0; i < 30; i++) { out = t.update(det(w.view()), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 4 }, 0.1); w.apply(out); }
  assert.ok(w.zoom >= 1.39, 'zoom mínimo para seguir: ' + w.zoom);
  const t2 = new Tracker({ frame: 'seguir' }), w2 = world({ zoom: 2 }); for (let i = 0; i < 50; i++) { w2.subject.x = 0.5 + 0.1 * Math.sin(i / 8); w2.apply(t2.update(det(w2.view()), { zoom: w2.zoom, pan: w2.pan, zoomMin: 1, zoomMax: 4 }, 0.1)); }
  assert.equal(w2.zoom, 2, 'zoom intacto');
});

test('enquadramento: o zoom vai até o rosto ficar no tamanho do busto (devagar, sem oscilar) e respeita os limites do celular', () => {
  for (const [frame, face] of [['busto', 0.07], ['rosto', 0.07], ['meio', 0.07]]) {
    const w = world({ zoom: 1.5, zoomMax: 6 }); w.subject = { x: 0.5, y: 0.45, h: face }; const t = new Tracker({ frame }); const trail = [];
    for (let i = 0; i < 600; i++) { w.apply(t.update(det(w.view()), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 6 }, 0.1)); trail.push(w.zoom); }
    assert.ok(Math.abs(w.view().h - FRAMES[frame].h) < FRAMES[frame].h * 0.18, frame + ': altura final ' + w.view().h.toFixed(3) + ' alvo ' + FRAMES[frame].h);
    const tail = trail.slice(-100), swing = Math.max(...tail) - Math.min(...tail); assert.ok(swing < 0.05, frame + ': zoom estável no fim (' + swing.toFixed(3) + ')');
    for (const z of trail) assert.ok(z >= 1 && z <= 6);
  }
  const w = world({ zoom: 1.2, zoomMax: 2 }); w.subject.h = 0.04; const t = new Tracker({ frame: 'rosto' }); for (let i = 0; i < 400; i++) w.apply(t.update(det(w.view()), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 2 }, 0.1)); assert.ok(w.zoom <= 2 + 1e-9, 'não passa do zoom máximo do aparelho');
});

test('perdeu a pessoa: segura a posição, depois procura; opcionalmente volta ao centro; ruído não faz a câmera tremer', () => {
  const w = world({ zoom: 2.5, pan: { x: 0.6, y: 0.2 } }), t = new Tracker({ lostHold: 1, lostReturn: true }), v0 = { zoom: 2.5, zoomMin: 1, zoomMax: 4 };
  let out = t.update(null, { ...v0, pan: w.pan }, 0.1); assert.equal(out.pan, undefined, 'não mexe no primeiro instante'); for (let i = 0; i < 5; i++) out = t.update(null, { ...v0, pan: w.pan }, 0.1); assert.equal(out.state, 'lost'); assert.equal(out.pan, undefined, 'segura enquanto espera');
  for (let i = 0; i < 80; i++) { out = t.update(null, { ...v0, pan: w.pan }, 0.1); w.apply(out); } assert.equal(out.state, 'search'); assert.ok(Math.abs(w.pan.x) < 0.1 && Math.abs(w.pan.y) < 0.1, 'voltou ao centro: ' + JSON.stringify(w.pan));
  const still = world({ zoom: 2.5 }), t2 = new Tracker(); let moves = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let i = 0; i < 300; i++) { const v = still.view(); v.cx += rnd() * 0.03; v.cy += rnd() * 0.03; const o = t2.update(det(v), { zoom: still.zoom, pan: still.pan, zoomMin: 1, zoomMax: 4 }, 0.1); if (o.pan) moves++; still.apply(o); }
  assert.ok(moves < 60, 'zona morta: poucos comandos com o alvo parado (' + moves + ')');
});

test('ao operar à mão a câmera para de seguir por um tempo (holdOff) e depois volta', () => {
  const t = new Tracker(), w = world({ zoom: 2.5 }); w.subject.x = 0.7; t.holdOff(2);
  let out = t.update(det(w.view()), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 4 }, 0.5); assert.equal(out.state, 'hold'); assert.equal(out.pan, undefined);
  for (let i = 0; i < 4; i++) out = t.update(det(w.view()), { zoom: w.zoom, pan: w.pan, zoomMin: 1, zoomMax: 4 }, 0.5); assert.equal(out.state, 'track'); assert.ok(out.pan, 'voltou a seguir');
});

test('vários alvos: continua no mesmo (o mais perto do último) e, sem referência, escolhe o maior', () => {
  const a = { cx: 0.3, cy: 0.5, w: 0.1, h: 0.3 }, b = { cx: 0.7, cy: 0.5, w: 0.2, h: 0.5 };
  assert.equal(pickSubject([a, b], null), b); assert.equal(pickSubject([a, b], { cx: 0.32, cy: 0.5 }), a); assert.equal(pickSubject([a, b], { cx: 0.69, cy: 0.5 }), b); assert.equal(pickSubject([], null), null);
});

test('movimento: acha o centro de quem mexe e ignora ruído', () => {
  const W = 96, H = 54, m = new MotionDetector(W, H), frame = (bx, by, bw = 10, bh = 20) => { const g = new Uint8Array(W * H).fill(60); for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) g[y * W + x] = 200; return g; };
  assert.equal(m.update(frame(10, 10)), null, 'primeiro quadro só guarda');
  let r; for (let i = 0; i < 6; i++) r = m.update(frame(10 + i * 6, 12));
  assert.ok(r && r.kind === 'motion', 'achou movimento'); assert.ok(r.cx > 0.2 && r.cx < 0.6, 'cx ' + r.cx.toFixed(2)); assert.ok(r.cy > 0.15 && r.cy < 0.6, 'cy ' + r.cy.toFixed(2));
  const quiet = new MotionDetector(W, H); quiet.update(new Uint8Array(W * H).fill(80)); let seed = 3; const noisy = () => { const g = new Uint8Array(W * H); for (let i = 0; i < g.length; i++) { seed = (seed * 16807) % 2147483647; g[i] = 80 + (seed % 5); } return g; };
  for (let i = 0; i < 20; i++) assert.equal(quiet.update(noisy()), null, 'ruído do sensor não é movimento');
});

test('a mesa carrega o tracking depois do controle de câmera, com o reconhecimento embutido (offline) e servido com o tipo certo', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('public/index.html'), server = read('server.cjs'), commands = read('public/commands.js'), camctl = read('public/camctl.js');
  assert.ok(html.indexOf('/camctl.js') < html.indexOf('/tracking-core.js') && html.indexOf('/tracking-core.js') < html.indexOf('/tracking.js'));
  assert.match(server, /'\/tracking-core\.js':'tracking-core\.js'/); assert.match(server, /'\/tracking\.js':'tracking\.js'/); assert.match(server, /vendor\/mediapipe/);
  for (const f of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'models/blaze_face_short_range.tflite', 'models/efficientdet_lite0.tflite', 'LICENSE-mediapipe.txt']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'vendor', 'mediapipe', f)), f);
  assert.match(camctl, /id="camCtlTrackHost"/); assert.match(camctl, /andromedaTracking\?\.draw/); assert.match(commands, /id: 'tracking'/);
  const { createBridge } = require('../server.cjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-trk-')), port = 31900 + Math.floor(Math.random() * 90);
  const bridge = createBridge({ dataDir: dir, port, camPort: null, lanPort: 0, relayBrokers: ['ws://127.0.0.1:1'] }); await new Promise(r => bridge.server.listen(port, '127.0.0.1', r));
  try {
    for (const [url, type] of [['/tracking.js', /javascript/], ['/tracking-core.js', /javascript/], ['/vendor/mediapipe/vision_bundle.mjs', /javascript/], ['/vendor/mediapipe/wasm/vision_wasm_internal.wasm', /wasm/], ['/vendor/mediapipe/models/blaze_face_short_range.tflite', /octet-stream/]]) { const r = await fetch('http://localhost:' + port + url); assert.equal(r.status, 200, url); assert.match(r.headers.get('content-type'), type, url); await r.arrayBuffer(); }
  } finally { bridge.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
