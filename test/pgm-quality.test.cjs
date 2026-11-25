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

test('regra 1080p30: a transmissão nunca desce de 1080p a 30 fps (sem perfil adaptativo, sem 720p/540p no pré-voo, no teste dedicado ou no regulador)', () => {
  const b = read('public/broadcast.js'), enc = read('encoder.cjs'), pub = read('publish.cjs');
  assert.doesNotMatch(b, /new Option\('Adaptativo'/); assert.match(b, /if \(!\['fixed','fixed4k'\]\.includes\(model\.policy\)\) model\.policy = 'fixed';/);
  assert.doesNotMatch(b, /\[1280, 720, '720p'\]|\[960, 540, '540p'\]|\[1280,720,'720p'\]|\[960,540,'540p'\]/, 'nenhuma escada abaixo de 1080p');
  assert.match(b, /const STEPS = \[\[3840, 2160, '2160p'\], \[1920, 1080, '1080p'\]\];/); assert.match(b, /if \(width <= 1920\) \{ if \(!window\.andromedaLight\)/, 'no piso: modo leve, não reduz');
  assert.match(b, /let \[width, height\] = outRes === '2160p' \? \[3840,2160\] : \[1920, 1080\];/); assert.match(b, /\(check\.fps \|\| 0\) >= 28\.5\) \{\s*window\.andromedaLight = true;/, 'codificador a 30: segue em 1080p30 com quadros repetidos');
  assert.match(b, /Math\.min\(20, Math\.max\(6, model\.bitrate\)\)/, '1080p com no mínimo 6 Mbps');
  assert.match(enc, /if \(live && resolution !== '2160p'\) resolution = '1080p';/); assert.match(enc, /vres = live \? '1080p'/, 'vertical ao vivo em 1080×1920');
  assert.match(pub, /msg\.type === 'resync' && everStarted/); assert.match(b, /type: 'start', resolution: outRes/);
});

test('sem a opção 720p na transmissão, no convite da câmera e no app da câmera (a segurança automática continua)', () => {
  const b = read('public/broadcast.js'), d = read('public/cam-desk.js'), page = read('docs/index.html'), cam = read('docs/cam.js');
  assert.match(b, /for \(const r of \['1080p', '2160p'\]\) resolution\.add/); assert.match(b, /if \(!\['1080p','2160p'\]\.includes\(model\.resolution\)\) model\.resolution = '1080p'/);
  assert.doesNotMatch(d, /<option value="1280x720">/); assert.doesNotMatch(d, /'1280x720':\{/);
  assert.doesNotMatch(page, /<option value="1280x720">/); assert.match(page, /value="1920x1080"/); assert.match(page, /value="3840x2160"/);
  assert.match(cam, /function setResolution\(w, h\)/); assert.match(cam, /: '1920x1080'/, 'convite antigo com 720p abre em 1080p');
  assert.equal(read('public/cam/index.html'), page); assert.equal(read('public/cam/cam.js'), cam);
});

test('0.27.5: sem botões de posição no rodapé das câmeras (poluíam o quadro); as 6 posições continuam no Controle de câmera', () => {
  const c = read('public/commands.js'), css = read('public/andromeda-ui.css'), html = read('public/index.html'), k = read('public/camctl.js');
  assert.doesNotMatch(c, /cell-preset/); assert.doesNotMatch(css, /\.cell-preset/);
  assert.match(html + k, /camCtlPresets/, 'o banco de posições do painel continua');
});

test('0.27.5: MARCAÇÕES — 4 posições da câmera no PREVIEW com miniatura, tecla P, 1 a 4 só com a faixa aberta', () => {
  const m = read('public/marks.js'), c = read('public/commands.js'), k = read('public/camctl.js'), h = read('public/index.html'), server = read('server.cjs'), css = read('public/andromeda-ui.css');
  assert.match(m, /const MARKS = 4/); assert.match(m, /document\.getElementById\('monPreview'\)/); assert.match(m, /P\.recallFor\(slot, n\)/); assert.match(m, /P\.saveFor\(slot, n\)/);
  assert.match(m, /if \(box\.hidden \|\| e\.repeat/, 'as teclas 1 a 4 só são das marcações com a faixa aberta'); assert.match(m, /\}, true\);/, 'antes dos atalhos da mesa');
  assert.match(m, /addEventListener\('andromeda:preset'/); assert.match(k, /dispatchEvent\(new CustomEvent\('andromeda:preset'/); assert.match(k, /saveFor: \(slot, n\) => savePreset\(n, slot\)/);
  assert.match(c, /\{ id: 'marks', name: \(\) => 'MARCAÇÕES'/); assert.match(c, /\{ id: 'marks', label: [^}]*key: 'P'/); assert.match(c, /\['marks', 'tracking'\]/);
  assert.match(h, /<script src="\/native-monitors\.js"><\/script><script src="\/marks\.js"><\/script>/); assert.match(server, /'\/marks\.js':'marks\.js'/);
  assert.match(css, /\.marks \{ position: absolute; left: 6px; right: 6px; bottom: 6px/);
});

test('0.27.6: cadência registra a carga de cada etapa do desenho, tarefas longas, página e visibilidade', () => {
  const h = read('public/index.html'), d = read('public/diagnostics.js'), r = read('public/rundown.js');
  assert.match(h, /const stageMs=window\.andromedaStageMs=new Map\(\);function guarded\(name,fn\)/); assert.match(h, /key=\/\^câmera \/\.test\(name\)\?'câmeras':name/);
  assert.match(d, /observe\(\{ type: 'longtask'/); assert.match(d, /carga: loadSnapshot\(\(now - sampleAt\) \/ 1000\)/); assert.match(d, /visivel: !document\.hidden/);
  assert.match(r, /largura: item\.el\?\.videoWidth \|\| 0, altura: item\.el\?\.videoHeight \|\| 0/);
});

test('0.27.7: ARTE no AR com fade de 2 s, guardada no computador; Comandos sem VT pausar/próximo/parar e próxima faixa', () => {
  const a = read('public/arte.js'), c = read('public/commands.js'), h = read('public/index.html'), server = read('server.cjs');
  assert.match(a, /indexedDB\.open\(DB, 1\)/); assert.match(a, /F\.apply\(ctx, 'arte', want/); assert.match(a, /window\.andromedaFade\?\.apply\(null, 'arte', false/, 'primeira entrada já com fade');
  assert.match(a, /if \(st\.pending && \(F\?\.level\('arte'\) \?\? 0\) <= 0\)/, 'troca com fade'); assert.match(a, /MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(c, /\{ id: 'arte', name: \(\) => 'ARTE'/); assert.match(c, /\{ id: 'arte', label: [^}]*key: 'A'/);
  for (const gone of ['vtnext', 'vtpause', 'vtstop', 'trilhanext']) assert.doesNotMatch(c, new RegExp("\\{ id: '" + gone + "', name:"));
  assert.match(h, /<script src="\/effects\.js"><\/script><script src="\/arte\.js"><\/script>/, 'antes da regressiva/BLACK'); assert.match(server, /'\/arte\.js':'arte\.js'/);
});

test('0.27.7: captura por quadro como segundo método, Controle de câmera pelo vídeo nativo, Diagnóstico só monta a tabela à vista', () => {
  const e = read('public/engine.js'), b = read('public/broadcast.js'), k = read('public/camctl.js'), n = read('public/native-monitors.js'), d = read('public/diagnostics.js'), r = read('public/rundown.js');
  assert.match(e, /const capture = options\.capture === 'frame' \? 'frame' : 'stream'/); assert.match(e, /\(inflight\.get\(o\.id\) \|\| 0\) >= 2\) return;/, 'no máximo 2 quadros em trânsito');
  assert.match(e, /if \(!session\) m\.frame\.close\(\); else \{ try \{ session\.setFrame\(m\.id, m\.frame\); \} catch \(e\) \{ try \{ m\.frame\.close\(\); \} catch \{\} \} \}/, 'todo quadro recebido é entregue ou fechado');
  assert.match(b, /\(check\.composedFps \|\| 0\) >= 25 && \(check\.receivedFps \|\| 0\) < 28\.5/); assert.match(b, /capture: liveTx\.capture \|\| 'stream'/); assert.match(b, /localStorage\.setItem\('andromeda\.tx\.capture\.v1', other\)/);
  assert.match(n, /streamOf: i =>/); assert.match(k, /if \(!native\) try \{ pvCtx\.drawImage\(el, dx, dy, dw, dh\); \}/); assert.match(k, /function pvDetach\(\)/);
  assert.match(d, /if \(data\.events\.length && !page\.hidden\) paint\(\);/); assert.match(r, /el\.videoWidth \* el\.videoHeight > 1920 \* 1080 \* 1\.2/);
});

test('0.28.0: conformidade técnica — limites por plataforma, RTMPS, High@4.1, flashVer da Andrômeda, painel ao vivo e quadro de conformidade', () => {
  const b = read('public/broadcast.js'), e = read('public/engine.js'), enc = read('encoder.cjs'), tx = read('test/transmission-electron.cjs');
  assert.match(b, /PLATFORM_CAP_MBPS = \{ facebook: 6, twitch: 6, linkedin: 6, instagram: 6, tiktok: 6, kick: 8, youtube: 14 \}/);
  assert.match(b, /if \(outRes === '1080p' && capH < outBitrate\)/); assert.match(b, /liveTx\.vCap = capOf\(vTargets\)/);
  assert.match(b, /server: 'rtmps:\/\/live\.twitch\.tv:443\/app'/); assert.match(b, /function paintCompliance\(\)/); assert.match(b, /STUDIO_URL = \{ youtube: 'https:\/\/studio\.youtube\.com/);
  assert.match(e, /blocks > 3600 \? \['29', '28'\]/, '1080p30 em High@4.1, 4.0 de reserva');
  assert.match(enc, /const FLASHVER = 'AndromedaLive\/' \+ String\(require\('\.\/package\.json'\)\.version\)/); assert.match(enc, /format_opts='flush_packets=1\\\\:rtmp_flashver=" \+ FLASHVER \+ "'/);
  assert.match(tx, /keyframeGapMaxS<=2\.1/); assert.match(tx, /assert\.equal\(c\.audio\?\.hz,48000/); assert.match(tx, /mesa sem erros de JavaScript/);
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

test('monitores nativos: PREVIEW e miniaturas de câmeras ao vivo vão por <video> (compositor), o canvas não converte o vídeo na tela principal', () => {
  const n = read('public/native-monitors.js'), h = read('public/index.html'), r = read('public/remote-desk.js'), server = read('server.cjs');
  assert.match(n, /el\.srcObject instanceof MediaStream/); assert.match(n, /el\.captureStream\(\)/, 'arquivo local sem decodificar de novo'); assert.match(n, /covers\(canvas\)/);
  assert.match(h, /<script src="\/stage\.js"><\/script><script src="\/native-monitors\.js"><\/script>/); assert.match(server, /'\/native-monitors\.js':'native-monitors\.js'/);
  assert.match(h, /if \(window\.andromedaNativeMonitors\?\.covers\(c\)\) \{ monitorDue\.set\(c, t \+ 500\); continue; \}/);
  assert.match(h, /const prvNative = window\.andromedaNativeMonitors\?\.covers\(\$\('#monPreview canvas'\)\) && !window\.andromedaRemotePreview\?\.\(\);/, 'a mesa remota que assiste o PREVIEW continua recebendo o canvas');
  assert.match(r, /window\.andromedaRemotePreview = \(\) =>/);
});
