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
  assert.match(render, /finally\{directProgram=false;scheduleRender\(\)\}/, 'o laço se reagenda mesmo com exceção'); assert.match(html, /andromedaAudit\?\.\(kind==='falha'\?'error':'warn','desenho-'\+kind/);
  assert.match(html, /gap>1000\)noteRender\('tela principal'/, 'relógio fora da tela principal acusa travas'); assert.match(read('public/pgm-quality.js'), /pgm-economico/, 'PGM se rebaixa sozinho em PC fraco');
});

test('o monitor da tela nunca cresce: só a superfície HD, o overlay e a saída mudam de tamanho', () => {
  const html = read('public/index.html'), broadcast = read('public/broadcast.js'), effects = read('public/effects.js'), live = read('public/live-client.js');
  assert.match(html, /const hdBase=document\.createElement\('canvas'\)/); assert.match(html, /function pgmBase\(\)\{return directProgram\?programOutput:hdOn\?hdBase:\$\('#monProgram canvas'\)\}/);
  assert.match(broadcast, /for \(const canvas of \[hdBase, overlay, programOutput\]\)/); assert.match(live, /\[hdBase,overlay,programOutput\]/); assert.match(effects, /const base=pgmBase\(\)/);
  assert.doesNotMatch(broadcast + live, /\[\$\('#monProgram canvas'\), overlay, programOutput\]|\[\$\('#monProgram canvas'\),overlay,programOutput\]/, 'o monitor da tela não é redimensionado pelo envio');
});

test('regulador de carga: reduz a resolução sem encerrar o envio, o serviço reabre o codificador e a decisão fica lembrada', () => {
  const b = read('public/broadcast.js'), pub = read('publish.cjs');
  assert.match(b, /STEPS = \[\[1920, 1080, '1080p'\], \[1280, 720, '720p'\], \[960, 540, '540p'\]\]/); assert.match(b, /over >= 10/); assert.match(b, /deskSlow >= 8/); assert.match(b, /type: 'resync'/);
  assert.match(b, /Date\.now\(\) - shiftAt < wait\)/, 'carência e intervalo mínimo'); assert.match(b, /wait = 30000/); assert.match(b, /14 \* 864e5/, 'lembra por 14 dias'); assert.match(b, /resolution\.onchange = \(\) => \{ model\.resolution = resolution\.value;/); assert.match(b, /bitrate\.value=model\.bitrate; clearCap\(\); save\(\); summary\(\)/);
  assert.match(pub, /msg\.type === 'resync' && everStarted/); assert.match(pub, /function resyncAll\(reason\)/); assert.match(b, /type: 'start', resolution: outRes/);
});

test('teste do computador antes de ir ao ar: mede os quadros por segundo no tamanho pedido, escolhe o primeiro que sustenta e lembra por 7 dias', () => {
  const b = read('public/broadcast.js'), e = read('public/engine.js');
  assert.match(e, /async function benchmark\(/); assert.match(e, /return \{ probe, create, createDedicated, benchmark, qualify, supported: hasApi \}/); assert.match(e, /new VideoFrame\(canvas/);
  assert.match(b, /AndromedaEngine\.benchmark\(\{ canvas: programOutput/); assert.match(b, /r\.fps >= 29 && desk >= 29/); assert.match(b, /7 \* 864e5/); assert.match(b, /\[1920, 1080, '1080p'\], \[1280, 720, '720p'\], \[960, 540, '540p'\]/);
  assert.match(b, /severe >= 3\) downshift\([^)]*\)?, false, 8000|severe >= 3\) downshift\('mais de um terço/, 'reação rápida a descartes fortes'); assert.match(b, /liveTx\.notice = sizeNote/, 'o aviso do tamanho não é apagado ao conectar');
  assert.match(read('public/index.html'), /master:q\('\.audio-master select'\)\?\.selectedIndex\?\?0/, 'salvamento de configurações à prova de painel ausente');
});

test('sem a opção 720p na transmissão, no convite da câmera e no app da câmera (a segurança automática continua)', () => {
  const b = read('public/broadcast.js'), d = read('public/cam-desk.js'), page = read('docs/index.html'), cam = read('docs/cam.js');
  assert.match(b, /for \(const r of \['1080p', '2160p'\]\) resolution\.add/); assert.match(b, /if \(!\['1080p','2160p'\]\.includes\(model\.resolution\)\) model\.resolution = '1080p'/);
  assert.doesNotMatch(d, /<option value="1280x720">/); assert.doesNotMatch(d, /'1280x720':\{/);
  assert.doesNotMatch(page, /<option value="1280x720">/); assert.match(page, /value="1920x1080"/); assert.match(page, /value="3840x2160"/);
  assert.match(cam, /function setResolution\(w, h\)/); assert.match(cam, /: '1920x1080'/, 'convite antigo com 720p abre em 1080p');
  assert.equal(read('public/cam/index.html'), page); assert.equal(read('public/cam/cam.js'), cam);
});

test('posições 1 a 4 no rodapé de cada câmera: clique chama a posição daquela câmera, dois cliques abrem o Controle de câmera em GRAVAR', () => {
  const c = read('public/commands.js'), k = read('public/camctl.js'), css = read('public/andromeda-ui.css'), t = read('public/tracking.js');
  assert.match(c, /make\('div', 'cell-presets'\)/); assert.match(c, /for \(let n = 0; n < 4; n\+\+\)/); assert.match(c, /P\.recallFor\(slot, n\)/); assert.match(c, /P\.editFor\(slot, n\); openCamCtl\(\)/);
  assert.match(c, /setTimeout\(\(\) => \{ timer = null; callPreset\(slot, n\); \}, 260\)/, 'clique simples espera o duplo clique');
  assert.match(k, /recallFor: \(slot, n\) => recallPreset\(n, camCtl\.glideSeconds, slot\)/); assert.match(k, /function camCtlSend\(change, slot = camCtl\.slot\)/, 'cada câmera recebe os seus comandos');
  assert.match(k, /function cancelGlide\(slot = camCtl\.slot\)/, 'um movimento suave por câmera'); assert.match(t, /camCtl\.glides\?\.has\(s\.i\)/);
  assert.match(css, /\.cell-presets \{ position: absolute; right: 42px; bottom: 6px/); assert.match(css, /@container \(max-width: 300px\) \{ \.cell-presets \{ right: auto; left: 6px; bottom: 34px; \} \}/);
});

test('captura do PGM no Worker: todo quadro lido é fechado, mesmo sem sessão ou com erro na entrega', () => {
  const e = read('public/engine.js');
  assert.match(e, /if \(!session\) \{ value\.close\(\); continue; \}/); assert.match(e, /else if \(m\.type === 'abort'\) \{ session\?\.abort\(\); await settle\(\);/, 'encerramento lê a fila até o fim em vez de descartar quadros'); assert.doesNotMatch(e, /else if \(m\.type === 'stop'\) \{ await Promise\.all\(readers\.map\(r=>r\.cancel/); assert.match(e, /try \{ session\.setFrame\(id, value\); \} catch \(e\) \{ try \{ value\.close\(\); \} catch \{\} throw e; \}/);
});

test('prioridade do AR: enquanto transmite, PREVIEW e miniaturas só usam a folga do quadro e rodam mais devagar', () => {
  const h = read('public/index.html');
  assert.match(h, /const monitorBudget = \(\) => onAirNow\(\) \? 13 : 22;/); assert.match(h, /if \(performance\.now\(\) - renderAt >= monitorBudget\(\)\) break;/);
  assert.match(h, /cams\[i\]\?\.conn \? \(onAirNow\(\) \? 200 : 95\) : 995/, 'miniaturas a 5 q/s no ar'); assert.match(h, /nextPreview = t \+ \(onAirNow\(\) \? 100 : 64\)/, 'PREVIEW a 10 q/s no ar');
  assert.match(h, /\[w, h\] = onAirNow\(\) \? \[640, 360\] : \[960, 540\]/);
});
