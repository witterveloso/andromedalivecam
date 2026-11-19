'use strict';
// PGM em alta definição: a saída nasce em 1920×1080 (antes ficava em 960×540 até transmitir) e o operador pode escolher a econômica.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('o PGM em HD só existe quando é usado (envio ou janela de saída), com opção econômica, e volta ao tamanho leve ao encerrar', () => {
  const js = read('public/pgm-quality.js'), html = read('public/index.html'), server = read('server.cjs');
  assert.match(js, /hd: \[1920, 1080\]/); assert.match(js, /eco: \[1280, 720\]/); assert.match(js, /let q = 'hd'/); assert.match(js, /LIGHT = \[960, 540\]/, 'fora do uso o PGM fica leve');
  assert.match(js, /busyTx\(\)/, 'durante o envio vale a resolução da transmissão'); assert.match(js, /window\.finishTransport = /, 'volta ao encerrar');
  assert.ok(html.indexOf('/broadcast.js') < html.indexOf('/pgm-quality.js'), 'depois do painel de transmissão'); assert.match(server, /'\/pgm-quality\.js':'pgm-quality\.js'/);
});

test('toda inserção direta no AR (GC, LOGO, JANELA e REGRESSIVA) entra e sai com fade de 2 s; a trilha segue a regra própria', () => {
  const fades = read('public/fades.js'), html = read('public/index.html'), rundown = read('public/rundown.js'), trilha = read('public/trilha.js'), server = read('server.cjs');
  assert.match(fades, /seconds: 2/); for (const k of ["'pip'", "'gc' + i", "'logo'"]) assert.ok(fades.includes(k), 'camada ' + k);
  assert.ok(html.indexOf('/composition.js') < html.indexOf('/fades.js') && html.indexOf('/fades.js') < html.indexOf('/effects.js') && html.indexOf('/fades.js') < html.indexOf('/rundown.js'), 'ordem de carga');
  assert.match(rundown, /andromedaFade\.apply\(ctx, 'countdown'/); assert.match(server, /'\/fades\.js':'fades\.js'/);
  assert.doesNotMatch(trilha, /andromedaFade/, 'a trilha não usa o fade das inserções');
  // o nível sobe e desce de 0 a 1 em 2 s (relógio simulado)
  global.window = {}; global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ setTransform() {}, clearRect() {}, save() {}, restore() {}, drawImage() {} }) }) };
  delete require.cache[require.resolve('../public/fades.js')]; require('../public/fades.js');
  const F = global.window.andromedaFade, ctx = { canvas: { width: 10, height: 10 }, save() {}, restore() {}, drawImage() {} }; let drawn = 0;
  F.apply(ctx, 'x', false, () => drawn++, 0); assert.equal(F.level('x'), 0);
  const lv = []; for (let t = 100; t <= 2300; t += 100) { F.apply(ctx, 'x', true, () => drawn++, t); lv.push(F.level('x')); }
  assert.ok(Math.abs(lv[9] - 0.5) < 0.06 && lv[4] > 0.2 && lv[4] < 0.3 && lv[18] < 1 && lv[19] === 1, 'sobe em ~2 s: ' + lv.map(v => v.toFixed(2)).join(' ')); assert.equal(lv.at(-1), 1);
  const dn = []; for (let t = 2400; t <= 4600; t += 100) { F.apply(ctx, 'x', false, () => drawn++, t); dn.push(F.level('x')); }
  assert.ok(Math.abs(dn[9] - 0.5) < 0.06 && dn[18] > 0 && dn[19] === 0 && dn.at(-1) === 0, 'desce em ~2 s: ' + dn.map(v => v.toFixed(2)).join(' ')); delete global.window; delete global.document;
});

test('o desenho da mesa é blindado: cada etapa isolada, o laço sempre se reagenda e as falhas vão para o diagnóstico', () => {
  const html = read('public/index.html'), render = html.slice(html.indexOf('function render(t)'), html.indexOf("$('#export').onclick"));
  for (const stage of ["'miniaturas'", "'preview'", "'PGM'", "'saída do AR'", "'medidores'"]) assert.ok(render.includes('guarded(' + stage), 'etapa ' + stage);
  assert.match(render, /finally\{scheduleRender\(\)\}/, 'o laço se reagenda mesmo com exceção'); assert.match(html, /andromedaAudit\?\.\(kind==='falha'\?'error':'warn','desenho-'\+kind/);
  assert.match(html, /gap>1000\)noteRender\('tela principal'/, 'relógio fora da tela principal acusa travas'); assert.match(read('public/pgm-quality.js'), /pgm-economico/, 'PGM se rebaixa sozinho em PC fraco');
});

test('o monitor da tela nunca cresce: só a superfície HD, o overlay e a saída mudam de tamanho', () => {
  const html = read('public/index.html'), broadcast = read('public/broadcast.js'), effects = read('public/effects.js'), live = read('public/live-client.js');
  assert.match(html, /const hdBase=document\.createElement\('canvas'\)/); assert.match(html, /function pgmBase\(\)\{return hdOn\?hdBase:\$\('#monProgram canvas'\)\}/);
  assert.match(broadcast, /for \(const canvas of \[hdBase, overlay, programOutput\]\)/); assert.match(live, /\[hdBase,overlay,programOutput\]/); assert.match(effects, /const base=pgmBase\(\)/);
  assert.doesNotMatch(broadcast + live, /\[\$\('#monProgram canvas'\), overlay, programOutput\]|\[\$\('#monProgram canvas'\),overlay,programOutput\]/, 'o monitor da tela não é redimensionado pelo envio');
});

test('regulador de carga: reduz a resolução sem encerrar o envio, o serviço reabre o codificador e a decisão fica lembrada', () => {
  const b = read('public/broadcast.js'), pub = read('publish.cjs');
  assert.match(b, /STEPS = \[\[1920, 1080, '1080p'\], \[1280, 720, '720p'\], \[960, 540, '540p'\]\]/); assert.match(b, /over >= 10/); assert.match(b, /deskSlow >= 8/); assert.match(b, /type: 'resync'/);
  assert.match(b, /Date\.now\(\) - shiftAt < 30000/, 'carência e intervalo mínimo'); assert.match(b, /14 \* 864e5/, 'lembra por 14 dias'); assert.match(b, /resolution\.onchange = \(\) => \{ model\.resolution = resolution\.value; clearCap\(\)/);
  assert.match(pub, /msg\.type === 'resync' && everStarted/); assert.match(pub, /function resyncAll\(reason\)/); assert.match(b, /type: 'start', resolution: outRes/);
});
