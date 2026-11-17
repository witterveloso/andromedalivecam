'use strict';
// O instalador e o ícone usam a arte da marca. O NSIS exige BMP de 24 bits sem compressão nos tamanhos exatos;
// um arquivo errado só apareceria na hora de gerar o instalador no Windows, então confere aqui.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), build = path.join(root, 'desktop', 'build'), pkg = require('../package.json');

function bmp(file) {
  const b = fs.readFileSync(path.join(build, file));
  assert.equal(b.toString('latin1', 0, 2), 'BM', file + ' é um BMP');
  return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)), bits: b.readUInt16LE(28), compression: b.readUInt32LE(30) };
}

test('painel lateral e cabeçalho do instalador: tamanhos exatos do NSIS, 24 bits, sem compressão', () => {
  for (const [file, w, h] of [['installerSidebar.bmp', 164, 314], ['uninstallerSidebar.bmp', 164, 314], ['installerHeader.bmp', 150, 57]]) {
    assert.deepEqual(bmp(file), { width: w, height: h, bits: 24, compression: 0 }, file);
  }
});

test('o pacote aponta para essas imagens e todas existem', () => {
  const nsis = pkg.build.nsis;
  for (const key of ['installerSidebar', 'uninstallerSidebar', 'installerHeader', 'installerIcon', 'uninstallerIcon']) {
    assert.ok(nsis[key], key + ' configurado'); assert.ok(fs.existsSync(path.join(root, nsis[key])), nsis[key] + ' existe');
  }
  assert.ok(fs.existsSync(path.join(root, pkg.build.win.icon)));
});

test('ícone do programa: .ico com 16 a 256 px (inclui o tamanho do atalho) e PNG de 512 px', () => {
  const ico = fs.readFileSync(path.join(build, 'icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1, 'tipo ícone');
  const n = ico.readUInt16LE(4), sizes = [];
  for (let i = 0; i < n; i++) sizes.push(ico[6 + i * 16] || 256);
  for (const need of [16, 24, 32, 48, 64, 128, 256]) assert.ok(sizes.includes(need), 'tem ' + need + ' px');
  const png = fs.readFileSync(path.join(build, 'icon.png'));
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512);
});

test('o instalador empacota o programa com esses arquivos de apoio', () => {
  assert.ok(pkg.build.files.includes('desktop/closeguard.cjs'));
  assert.ok(fs.existsSync(path.join(root, 'public', 'brand', 'andromeda-icon-live.png')));
});
