'use strict';
/*
 * Proteção do código no instalador (roda só na geração do instalador, na CI; o repositório não muda).
 *
 * - Compacta todo o código próprio (serviço, programa e mesa): sem comentários, sem espaços, nomes internos trocados
 *   por letras. As regras e explicações do código saem do pacote; o que fica funciona igual, mas é difícil de ler.
 * - Scripts embutidos na página da mesa (index.html) também são compactados.
 * - Bibliotecas de terceiros (public/vendor) ficam como estão.
 * - Cada arquivo ganha o aviso de direitos autorais.
 *
 * Nomes globais NÃO são trocados: os scripts da mesa conversam por eles. Só nomes internos de cada função.
 */
const fs = require('node:fs'), path = require('node:path');
const { minify } = require('terser');

const root = path.resolve(__dirname, '..');
const NOTICE = '/*! Andrômeda Live © ' + new Date().getFullYear() + ' — todos os direitos reservados. Proibidos cópia, engenharia reversa, modificação e redistribuição sem autorização por escrito. */';
const OPTIONS = { ecma: 2022, compress: { passes: 2, keep_fargs: true }, mangle: { toplevel: false }, format: { comments: false, preamble: NOTICE } };

function files() {
  const out = [];
  for (const f of fs.readdirSync(root)) if (/\.cjs$/.test(f) && !['check.cjs', 'cloud-server.cjs'].includes(f)) out.push(path.join(root, f));
  for (const f of ['desktop/main.cjs', 'desktop/closeguard.cjs']) out.push(path.join(root, f));
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (/\.(c?js|mjs)$/.test(e.name)) out.push(p); } };
  walk(path.join(root, 'public'));
  return out;
}

async function protectFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const module = /\.mjs$/.test(file) || /^\s*(import|export)\s/m.test(source);
  const result = await minify(source, { ...OPTIONS, module });
  if (!result.code) throw Error('vazio: ' + file);
  fs.writeFileSync(file, result.code);
  return [source.length, result.code.length];
}

// Scripts embutidos (<script> sem src) da página da mesa.
async function protectHtml(file) {
  let html = fs.readFileSync(file, 'utf8'); const before = html.length;
  const parts = []; const re = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) parts.push(m);
  for (const m of parts.reverse()) {
    const r = await minify(m[1], { ...OPTIONS, format: { comments: false } });
    html = html.slice(0, m.index) + '<script>' + r.code + '</script>' + html.slice(m.index + m[0].length);
  }
  html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  fs.writeFileSync(file, '<!-- Andrômeda Live © todos os direitos reservados -->\n' + html);
  return [before, html.length];
}

(async () => {
  let a = 0, b = 0, n = 0;
  for (const f of files()) { const [x, y] = await protectFile(f); a += x; b += y; n++; }
  for (const f of [path.join(root, 'public', 'index.html')]) { const [x, y] = await protectHtml(f); a += x; b += y; n++; }
  console.log('Código protegido: ' + n + ' arquivos, ' + Math.round(a / 1024) + ' KB → ' + Math.round(b / 1024) + ' KB (sem comentários e com nomes internos trocados).');
})().catch(e => { console.error('Falha ao proteger o código: ' + e.message); process.exit(1); });
