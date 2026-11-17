const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const docs = path.join(__dirname, '../docs'), read = f => fs.readFileSync(path.join(docs, f), 'utf8');

test('the remote desk page is self-contained, strict CSP, and only takes full-length keys', () => {
  const html = read('remoto.html');
  for (const src of [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1])) assert(fs.existsSync(path.join(docs, src)), 'missing ' + src);
  assert.match(html, /<script src="\.\/config\.js"><\/script>\s*<script src="\.\/relay\.js"><\/script>\s*<script src="\.\/remoto\.js"><\/script>/, 'config, relay and page script in order');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.doesNotMatch(csp, /unsafe-(inline|eval)/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script');
  const js = read('remoto.js');
  assert.match(js, /\^#\(\[vca\]\)=\(\[a-f0-9\]\{48\}\)\$/, 'view (#v=), control (#c=) and audio desk (#a=) links with a 48-hex key only');
  assert.match(html, /id="mixer"/); assert.match(js, /cmd\('amode'/); assert.match(js, /cmd\('fade'\)/);
  assert.doesNotMatch(js, /innerHTML/, 'remote page never injects HTML from the desk');
});

test('the desk serves the cloud module and the relay library, and loads them before the layout', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8'), index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(server, /'\/remote-desk\.js':'remote-desk\.js'/); assert.match(server, /'\/cam\/relay\.js':'cam\/relay\.js'/);
  assert(index.indexOf('/remote-desk.js') < index.indexOf('/workspace-custom.js'), 'panel exists before the layout picks it up');
  const desk = fs.readFileSync(path.join(__dirname, '../public/remote-desk.js'), 'utf8');
  for (const c of ['prv', 'pgm', 'cut', 'auto', 'type', 'gc', 'logo', 'pip', 'clear', 'amode', 'avol', 'mvol', 'fade', 'fadetime']) assert.match(desk, new RegExp("case '" + c + "'"), 'command ' + c);
  assert.match(desk, /default: return false;/, 'anything else is refused');
  assert.match(desk, /kind !== 'view' && !trusted\(kind\)\.includes\(device\)/, 'unknown control and audio-desk devices wait for approval');
  assert.match(desk, /s\.kind === 'mixer' && AUDIO_CMDS\.has\(m\.cmd\)/, 'the audio desk link only reaches audio commands');
  assert.match(desk, /if \(kind === 'mixer'\) \{ const a = window\.audioMixer/, 'the audio desk receives the PGM sound, no picture');
});
