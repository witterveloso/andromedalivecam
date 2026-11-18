'use strict';
// Tracking: o núcleo mantém o alvo no quadro com movimento suave, num celular simulado (zoom e pan digitais, atraso de rede, ruído,
// suavização do celular) com a mesma geometria do app da câmera.
const test = require('node:test'), assert = require('node:assert/strict');
const { Tracker, Kalman1D, MotionDetector, pickSubject, spring, travel, room, viewToWorld, worldToView, inAreas, estimateLatency, FRAMES, SPEEDS, COMFORT, LATENCY } = require('../public/tracking-core.js');
const { simulate, metrics } = require('./helpers/tracking-sim.cjs');

const walk = t => ({ x: 0.5 + 0.2 * Math.sin(t * 0.45) + 0.03 * Math.sin(t * 1.7), y: 0.45 + 0.03 * Math.sin(t * 0.6), h: 0.07 });
const NETS = { lan: { dCmd: 0.03, dVid: 0.08, tDet: 0.04, latency: 0.25 }, normal: { dCmd: 0.08, dVid: 0.14, tDet: 0.05, latency: 0.4 }, lenta: { dCmd: 0.2, dVid: 0.3, tDet: 0.06, latency: 0.7 } };
const driverOf = tracker => ({ onDetection(det, t, view) { tracker.observe(det, t, view); }, onTick(view, t) { return tracker.tick(view, t); } });
// Controlador "ingênuo" (o que o tracking fazia antes): um passo proporcional a cada detecção, aplicado na hora.
function naive() { let pending = null; return { onDetection(det, t, view) { if (!det) return; const k = travel(view.zoom) || 1, nx = Math.max(-1, Math.min(1, view.pan.x + 0.55 * (det.cx - 0.5) / k)), ny = Math.max(-1, Math.min(1, view.pan.y + 0.55 * (det.cy - 0.42) / k)); pending = { pan: { x: nx, y: ny } }; }, onTick() { const o = pending; pending = null; return o; } }; }

test('a geometria do recorte: sem zoom não há folga, com zoom 3× uma unidade de pan move um quadro inteiro', () => {
  assert.equal(travel(1), 0); assert.equal(travel(3), 1); assert.equal(travel(2), 0.5); assert.equal(room(1), 0); assert.ok(Math.abs(room(2) - 0.25) < 1e-12);
});

test('filtro de Kalman: acha a velocidade do alvo e tira o ruído da medida', () => {
  const k = new Kalman1D(0.2); let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5; let errRaw = 0, errKal = 0, vSum = 0, n = 0;
  k.init(0.2, 0, 1e-4); for (let i = 1; i <= 200; i++) { const t = i * 0.125, truth = 0.2 + 0.1 * t, z = truth + rnd() * 0.03; k.predict(t); k.update(z, 0.0003); if (i > 40) { errRaw += Math.abs(z - truth); errKal += Math.abs(k.x - truth); vSum += k.v; n++; } }
  const vMean = vSum / n; assert.ok(Math.abs(vMean - 0.1) < 0.02, 'velocidade estimada (média) ' + vMean.toFixed(3)); assert.ok(errKal / n < errRaw / n * 0.7, 'erro filtrado ' + (errKal / n).toFixed(4) + ' < medida ' + (errRaw / n).toFixed(4));
  assert.ok(Math.abs(k.at(25.6) - (0.2 + 0.1 * 25.6)) < 0.05, 'projeta o caminho adiante');
});

test('a mola: parte e para sem passar do ponto, respeitando o limite de velocidade e de aceleração', () => {
  const s = { x: 0, v: 0 }; let maxV = 0, maxA = 0, prev = 0, over = 0;
  for (let i = 0; i < 400; i++) { spring(s, 0.4, 0.025, 2.6, 0.4, 1.1); maxV = Math.max(maxV, Math.abs(s.v)); maxA = Math.max(maxA, Math.abs(s.v - prev) / 0.025); prev = s.v; over = Math.max(over, s.x - 0.4); }
  assert.ok(Math.abs(s.x - 0.4) < 1e-3 && Math.abs(s.v) < 1e-3, 'chegou e parou'); assert.ok(maxV <= 0.4 + 1e-9, 'velocidade ' + maxV); assert.ok(maxA <= 1.1 + 0.05, 'aceleração ' + maxA); assert.ok(over < 0.01, 'não passou do ponto: ' + over);
});

for (const [net, cfg] of Object.entries(NETS)) test('segue quem anda de um lado ao outro (' + net + '): alvo sempre no quadro, movimento de câmera sem solavancos', () => {
  const t = new Tracker({ speed: 'normal', latency: cfg.latency });
  const m = metrics(simulate({ subject: walk, seconds: 40, ...cfg, driver: driverOf(t) }, { skip: 4 }).trace);
  const base = metrics(simulate({ subject: walk, seconds: 40, ...cfg, driver: naive() }).trace);
  assert.equal(m.outFrames, 0, 'o alvo nunca saiu do quadro'); assert.ok(m.meanX < 0.11, 'erro médio ' + m.meanX.toFixed(3)); assert.ok(m.worstX < 0.3, 'pior erro ' + m.worstX.toFixed(2));
  assert.ok(m.maxA < 8, 'aceleração máxima da janela ' + m.maxA.toFixed(1)); assert.ok(m.rmsJerk < 250, 'solavanco (jerk) ' + m.rmsJerk.toFixed(0)); assert.ok(m.stallRatio < 0.05, 'sem trancos');
  assert.ok(m.rmsJerk * 8 < base.rmsJerk, 'muito mais suave que o passo por detecção: ' + m.rmsJerk.toFixed(0) + ' vs ' + base.rmsJerk.toFixed(0)); assert.ok(m.maxA * 8 < base.maxA);
});

test('estilos de movimento: o suave acelera menos que o normal e o rápido responde mais depressa', () => {
  const run = speed => { const t = new Tracker({ speed, latency: 0.4 }); return metrics(simulate({ subject: walk, seconds: 40, ...NETS.normal, driver: driverOf(t) }).trace, { skip: 4 }); };
  const a = run('suave'), b = run('normal'), c = run('rapido');
  assert.ok(a.maxA < b.maxA && b.maxA < c.maxA, 'aceleração ' + [a, b, c].map(x => x.maxA.toFixed(2)).join(' < ')); assert.ok(c.meanX <= b.meanX + 0.01 && b.meanX <= a.meanX + 0.01, 'erro médio ' + [a, b, c].map(x => x.meanX.toFixed(3)).join(', '));
  for (const x of [a, b, c]) assert.equal(x.outFrames, 0);
});

test('zona de conforto: com o alvo parado (só ruído) a câmera fica quieta e quase não manda comandos', () => {
  const t = new Tracker({ speed: 'normal', latency: 0.4 }); const subj = () => ({ x: 0.52, y: 0.45, h: 0.07 });
  const r = simulate({ subject: subj, seconds: 40, ...NETS.normal, noise: 0.012, zoom0: 2, driver: driverOf(t) });
  const late = r.sent.filter(c => c.t > 15).length; assert.ok(late <= 3, 'comandos depois de assentar: ' + late);
  const m = metrics(r.trace, { skip: 15 }); assert.ok(m.maxV < 0.01, 'janela parada: ' + m.maxV.toFixed(4));
});

test('alvo que anda, para e anda de novo: parte suave, para sem passar do ponto e não oscila', () => {
  const t = new Tracker({ speed: 'normal', latency: 0.4 }); const subj = tt => ({ x: tt < 8 ? 0.42 : tt < 20 ? 0.6 : 0.46, y: 0.45, h: 0.07 });
  const r = simulate({ subject: subj, seconds: 32, ...NETS.normal, driver: driverOf(t) }); const m = metrics(r.trace, { skip: 3 });
  assert.ok(m.maxA < 8 && m.maxV < 0.5, 'movimento ' + m.maxA.toFixed(2) + ' / ' + m.maxV.toFixed(2)); assert.equal(m.outFrames, 0);
  const seg = r.trace.filter(p => p.t > 14 && p.t < 20); const final = seg[seg.length - 1].cx; let reversals = 0, dir = 0; for (let i = 1; i < seg.length; i++) { const d = Math.sign(Math.round((seg[i].cx - seg[i - 1].cx) * 2000)); if (d && dir && d !== dir) reversals++; if (d) dir = d; }
  assert.ok(reversals <= 2, 'sem oscilar ao parar (inversões: ' + reversals + ')'); assert.ok(Math.abs(seg[seg.length - 1].vx - 0.5) < 0.15, 'alvo no centro');
});

test('enquadramento: o zoom vai até o rosto ficar do tamanho do busto, devagar, sem oscilar e sem puxar a imagem para o lado', () => {
  const t = new Tracker({ frame: 'busto', speed: 'normal', latency: 0.4 }); const subj = () => ({ x: 0.5, y: 0.45, h: 0.07 });
  const r = simulate({ subject: subj, seconds: 40, ...NETS.normal, zoom0: 1.4, zoomMax: 6, driver: driverOf(t) }); const tr = r.trace;
  const end = tr.slice(-60); assert.ok(Math.abs(end[end.length - 1].h - FRAMES.busto.h) < FRAMES.busto.h * 0.18, 'altura final ' + end[end.length - 1].h.toFixed(3));
  const swing = Math.max(...end.map(p => p.z)) - Math.min(...end.map(p => p.z)); assert.ok(swing < 0.06, 'zoom estável no fim (' + swing.toFixed(3) + ')');
  let worst = 0; for (const p of tr.filter(q => q.t > 3)) worst = Math.max(worst, Math.abs(p.vx - 0.5)); assert.ok(worst < 0.12, 'o zoom não desloca o alvo (' + worst.toFixed(3) + ')');
  for (const p of tr) assert.ok(p.z >= 1 - 1e-9 && p.z <= 6 + 1e-9, 'limites do aparelho');
});

test('perdeu o alvo: segura a posição (sem sair andando), depois procura; opcionalmente volta ao centro', () => {
  const mk = lostReturn => { const t = new Tracker({ speed: 'normal', latency: 0.4, lostHold: 1.5, lostReturn }); let hidden = false; const subj = () => ({ x: 0.66, y: 0.45, h: 0.07 });
    const d = driverOf(t), r = simulate({ subject: subj, seconds: 24, ...NETS.normal, zoom0: 2.4, driver: { onDetection(det, tt, v) { d.onDetection(tt > 8 ? null : det, tt, v); }, onTick: d.onTick } }); return r; };
  const hold = mk(false), ret = mk(true), at = (r, tt) => r.trace.find(p => p.t >= tt);
  assert.ok(Math.abs(at(hold, 12).cx - at(hold, 23).cx) < 0.01, 'sem alvo a janela fica onde está'); const c1 = at(ret, 23); assert.ok(Math.abs(c1.cx - 0.5) < 0.05 && Math.abs(c1.cy - 0.5) < 0.05, 'voltou ao centro: ' + c1.cx.toFixed(2));
  assert.ok(hold.sent.filter(c => c.t > 14).length === 0, 'não manda comandos sem alvo');
});

test('ao operar à mão a câmera para de seguir por um tempo (holdOff) e depois volta, a partir de onde o operador deixou', () => {
  const t = new Tracker({ latency: 0.3 }), view = { zoom: 2.5, pan: { x: 0, y: 0 }, zoomMin: 1, zoomMax: 5 }; t.tick(view, 0); t.holdOff(2);
  let out = t.tick(view, 0.5); assert.equal(out.state, 'hold'); assert.equal(out.pan, undefined); assert.equal(out.zoom, undefined);
  const moved = { ...view, pan: { x: 0.7, y: -0.2 } }; for (let i = 1; i <= 60; i++) out = t.tick(moved, 0.5 + i * 0.04);
  assert.notEqual(out.state, 'hold'); assert.ok(!out.pan || Math.abs(out.pan.x - 0.7) < 0.05, 'retoma de onde o operador deixou, sem pulo (' + JSON.stringify(out.pan) + ')');
});

test('o atraso informado importa: com ele certo o erro é menor que ignorando o atraso da rede', () => {
  const run = latency => { const t = new Tracker({ speed: 'rapido', latency }); return metrics(simulate({ subject: walk, seconds: 40, ...NETS.lenta, driver: driverOf(t) }).trace, { skip: 4 }).meanX; };
  const good = run(NETS.lenta.latency), none = run(0.02); assert.ok(good <= none + 0.005, 'erro com atraso certo ' + good.toFixed(3) + ' vs sem atraso ' + none.toFixed(3));
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

test('as opções de movimento, zona de conforto e rede existem e fazem sentido', () => {
  assert.deepEqual(Object.keys(SPEEDS), ['suave', 'normal', 'rapido']); assert.ok(SPEEDS.suave.amax < SPEEDS.normal.amax && SPEEDS.normal.amax < SPEEDS.rapido.amax); assert.ok(SPEEDS.suave.ease > SPEEDS.rapido.ease, 'o celular suaviza mais no estilo suave');
  assert.ok(COMFORT.pequena.out < COMFORT.media.out && COMFORT.media.out < COMFORT.grande.out); for (const z of Object.values(COMFORT)) assert.ok(z.inn < z.out, 'histerese');
});

test('atraso medido: soma ida e volta, suavização, captura, buffer, decodificação e análise, dentro de limites', () => {
  assert.ok(Math.abs(estimateLatency({ rtt: 0.16, jitterBuffer: 0, decode: 0, detect: 0.05, ease: 0.1 }) - 0.37) < 1e-9);
  assert.ok(estimateLatency({ rtt: 0.4, jitterBuffer: 0.1, decode: 0.02, detect: 0.08, ease: 0.1 }) > estimateLatency({ rtt: 0.05, jitterBuffer: 0.03, decode: 0.01, detect: 0.05, ease: 0.1 }));
  assert.equal(estimateLatency({ rtt: 0, jitterBuffer: 0, decode: 0, detect: 0, ease: 0, capture: 0 }), 0.12, 'mínimo'); assert.equal(estimateLatency({ rtt: 9 }), 1.5, 'máximo'); assert.ok(estimateLatency({ rtt: NaN, jitterBuffer: undefined }) > 0.12, 'números ruins viram padrão');
  assert.ok(LATENCY.auto && LATENCY.auto.value > 0, 'opção automático');
});

test('com o atraso calculado dos números da conexão o tracking fica tão bom quanto com o atraso certo da rede', () => {
  const net = NETS.normal, est = estimateLatency({ rtt: (net.dCmd + 0.08) * 1, jitterBuffer: 0, decode: 0, detect: net.tDet, ease: 0.1 });
  const run = latency => { const t = new Tracker({ speed: 'normal', latency }); return metrics(simulate({ subject: walk, seconds: 40, ...net, easeMs: 100, driver: driverOf(t) }).trace, { skip: 4 }); };
  const auto = run(est), hand = run(net.latency), wrong = run(0.05);
  assert.ok(auto.meanX <= hand.meanX + 0.01, 'medido ' + auto.meanX.toFixed(3) + ' vs escolhido ' + hand.meanX.toFixed(3)); assert.ok(auto.meanX <= wrong.meanX + 0.005); assert.equal(auto.outFrames, 0);
});

test('áreas de pausa: ficam paradas na cena (coordenadas do quadro inteiro), mesmo com a câmera andando ou mudando o zoom', () => {
  const win1 = { cx: 0.5, cy: 0.5, z: 2 }, win2 = { cx: 0.62, cy: 0.5, z: 3 };
  const a = viewToWorld(win1, 0.1, 0.4), b = viewToWorld(win1, 0.3, 0.7), area = [{ x0: a.x, y0: a.y, x1: b.x, y1: b.y }];
  for (const w of [win1, win2]) { const v = worldToView(w, 0.45, 0.55), back = viewToWorld(w, v.x, v.y); assert.ok(Math.abs(back.x - 0.45) < 1e-9 && Math.abs(back.y - 0.55) < 1e-9, 'ida e volta'); }
  assert.ok(inAreas(area, 0.3, 0.5) && !inAreas(area, 0.7, 0.5), 'dentro e fora'); assert.ok(!inAreas([], 0.3, 0.5) && !inAreas(null, 0.3, 0.5));
  const v = worldToView(win2, 0.3, 0.5); assert.ok(inAreas(area, viewToWorld(win2, v.x, v.y).x, viewToWorld(win2, v.x, v.y).y), 'o mesmo ponto da cena continua dentro da área com outra janela');
});

test('movimento com área ignorada: o que mexe dentro da máscara não conta, o resto sim', () => {
  const W = 96, H = 54, mask = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < 40; x++) mask[y * W + x] = 1; // metade esquerda ignorada
  const frame = (bx, by) => { const g = new Uint8Array(W * H).fill(60); for (let y = by; y < by + 14; y++) for (let x = bx; x < bx + 10; x++) g[y * W + x] = 200; return g; };
  const left = new MotionDetector(W, H); left.update(frame(5, 10), mask); let r = null; for (let i = 0; i < 6; i++) r = left.update(frame(5 + i * 4, 10 + (i % 2)), mask); assert.equal(r, null, 'quem mexe só na área ignorada não é detectado');
  const right = new MotionDetector(W, H); right.update(frame(55, 10), mask); for (let i = 0; i < 6; i++) r = right.update(frame(55 + i * 4, 10 + (i % 2)), mask); assert.ok(r && r.cx > 0.6, 'fora da área é detectado');
});

test('a mesa carrega o tracking depois do controle de câmera, com o reconhecimento embutido (offline) e servido com o tipo certo', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('public/index.html'), server = read('server.cjs'), commands = read('public/commands.js'), camctl = read('public/camctl.js');
  assert.ok(html.indexOf('/camctl.js') < html.indexOf('/tracking-core.js') && html.indexOf('/tracking-core.js') < html.indexOf('/tracking.js'));
  assert.match(server, /'\/tracking-core\.js':'tracking-core\.js'/); assert.match(server, /'\/tracking\.js':'tracking\.js'/); assert.match(server, /vendor\/mediapipe/);
  for (const f of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'models/blaze_face_short_range.tflite', 'models/efficientdet_lite0.tflite', 'LICENSE-mediapipe.txt']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'vendor', 'mediapipe', f)), f);
  assert.match(camctl, /id="camCtlTrackHost"/); assert.match(camctl, /andromedaTracking\?\.draw/); assert.match(commands, /id: 'tracking'/);
  const { createBridge } = require('../server.cjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-trk-')), port = await new Promise(r => { const n = require('node:net').createServer(); n.listen(0, '127.0.0.1', () => { const x = n.address().port; n.close(() => r(x)); }); });
  const bridge = createBridge({ dataDir: dir, port, camPort: null, lanPort: 0, relayBrokers: ['ws://127.0.0.1:1'] }); await new Promise(r => bridge.server.listen(port, '127.0.0.1', r));
  try {
    for (const [url, type] of [['/tracking.js', /javascript/], ['/tracking-core.js', /javascript/], ['/vendor/mediapipe/vision_bundle.mjs', /javascript/], ['/vendor/mediapipe/wasm/vision_wasm_internal.wasm', /wasm/], ['/vendor/mediapipe/models/blaze_face_short_range.tflite', /octet-stream/]]) { const r = await fetch('http://127.0.0.1:' + port + url); assert.equal(r.status, 200, url); assert.match(r.headers.get('content-type'), type, url); await r.arrayBuffer(); }
  } finally { bridge.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
