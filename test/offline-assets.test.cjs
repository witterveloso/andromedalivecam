'use strict';
// A mesa tem que abrir igual sem internet: nenhuma fonte, estilo ou script vindo de fora, e tudo que a página pede está embutido.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const pub = path.join(__dirname, '..', 'public'), html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');

test('a página não depende de nada externo para abrir (fontes, estilos, scripts, imagens)', () => {
  const remote = [...html.matchAll(/<(?:link|script|img)\b[^>]*\b(?:href|src)=["'](https?:\/\/[^"']+)/g)].map(m => m[1]);
  assert.deepEqual(remote, [], 'nada externo no HTML: ' + remote.join(', '));
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'sem Google Fonts');
  assert.match(html, /href="\/fonts\/fonts\.css"/, 'usa as fontes embutidas');
});

test('as fontes embutidas existem e cobrem Exo 2, Montserrat e JetBrains Mono', () => {
  const css = fs.readFileSync(path.join(pub, 'fonts', 'fonts.css'), 'utf8'), urls = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 6);
  for (const u of urls) { const f = path.join(pub, u); assert.ok(fs.existsSync(f) && fs.statSync(f).size > 3000, u); }
  for (const fam of ['Exo 2', 'Montserrat', 'JetBrains Mono']) assert.ok(css.includes("font-family: '" + fam + "'"), fam);
});

test('a tela de abertura da marca está no HTML e some quando a mesa fica pronta', () => {
  assert.match(html, /<div id="boot"/); assert.match(html, /andromedaBootDone/);
  assert.ok(fs.existsSync(path.join(pub, 'brand', 'splash-logo.png')));
  assert.ok(html.indexOf('id="boot"') < html.indexOf('<script src="/live-client.js">'), 'aparece antes dos scripts da mesa');
});

test('o serviço entrega as fontes e os logos (pastas inteiras, com o tipo certo)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  assert.match(server, /for\(const dir of \['fonts','brand'\]\)/); assert.match(server, /endsWith\('\.woff2'\)\?'font\/woff2'/);
  for (const f of ['andromeda-icon-live.png', 'splash-logo.png']) assert.ok(fs.existsSync(path.join(pub, 'brand', f)), f);
});
