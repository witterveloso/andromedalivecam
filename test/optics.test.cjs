const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createCameraHub } = require('../camera-hub.cjs');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('only the physical lenses become buttons, with short names, on iPhone (pt-BR and English) and Android', () => {
  const src = read('docs/cam.js'), start = src.indexOf('function lensInfo('), end = src.indexOf('function lensName(');
  const ctx = {}; vm.runInNewContext(src.slice(start, end) + ';this.lensInfo = lensInfo;', ctx);
  const name = (l, i = 0) => ctx.lensInfo(l, i).name, virtual = l => !!ctx.lensInfo(l, 0).virtual;
  assert.equal(name('Câmera Traseira'), '1×', 'the main back camera is no longer "Lente 4"');
  assert.equal(name('Câmera Ultra-angular Traseira'), '0,5×');
  assert.equal(name('Câmera Teleobjetiva Traseira'), 'Tele');
  assert.equal(name('Câmera Frontal'), 'Frontal');
  assert.equal(name('Back Ultra Wide Camera'), '0,5×'); assert.equal(name('Back Telephoto Camera'), 'Tele');
  assert.equal(name('camera2 0, facing back'), '1×'); assert.equal(name('camera2 1, facing front'), 'Frontal');
  assert.equal(name('', 3), 'Câm 4');
  for (const v of ['Câmera Tripla Traseira', 'Câmera Grande-Angular Dupla Traseira', 'Câmera Dupla Traseira', 'Back Triple Camera', 'Back Dual Wide Camera']) assert(virtual(v), v + ' is a virtual camera, not a lens');
  for (const p of ['Câmera Traseira', 'Câmera Ultra-angular Traseira', 'Câmera Teleobjetiva Traseira', 'Câmera Frontal']) assert(!virtual(p), p);
  const order = ['Câmera Frontal', 'Câmera Teleobjetiva Traseira', 'Câmera Traseira', 'Câmera Ultra-angular Traseira'].sort((a, b) => ctx.lensInfo(a, 0).rank - ctx.lensInfo(b, 0).rank).map(l => name(l));
  assert.deepEqual(order, ['0,5×', '1×', 'Tele', 'Frontal']);
  assert.match(src, /filter\(x => !x\.info\.virtual\)/, 'virtual cameras are left out of the lens buttons');
});

test('camera controls: parameter bar over the image, slider zoom with programmed moves, stabilization, background resume', () => {
  const optics = read('docs/optics.js'), cam = read('docs/cam.js'), html = read('docs/index.html'), hub = read('camera-hub.cjs');
  for (const p of ['lens', 'format', 'zoom', 'wb', 'exp', 'stab']) assert.match(optics, new RegExp("param\\('" + p + "'"), 'parameter ' + p);
  assert.match(html, /<nav id="params" class="params"/);
  assert.doesNotMatch(optics, /zoom-step|'−'\), zValue/, 'no more +/− zoom buttons');
  assert.match(optics, /zoomLive = slider\(r, st\.zoom/, 'zoom is a sliding bar');
  assert.match(optics, /points: Array\.isArray\(saved\.points\) && saved\.points\.length === 4/, 'four programmable points');
  assert.match(optics, /const ease = t =>/, 'smooth programmed zoom curve');
  assert.match(optics, /Math\.log\(from\)/, 'zoom moves at constant apparent speed');
  assert.match(optics, /nativeStabKey/, 'uses the device stabilization when the browser exposes it');
  assert.match(optics, /function makeStabilizer\(\)/, 'own stabilization otherwise');
  assert.match(cam, /send\(\{ type: 'presence', state: 'background' \}\)/); assert.match(cam, /async function resumeCamera\(\)/);
  assert.match(hub, /m\.type==='presence'/, 'the hub tells the desk');
});

test('the camera keeps motion fluid and applies settings live', () => {
  const cam = read('docs/cam.js'), optics = read('docs/optics.js'), html = read('docs/index.html');
  assert.match(cam, /degradationPreference = 'maintain-framerate'/, 'frame rate first when the network or CPU is tight');
  assert.match(cam, /e\.maxFramerate = fps/);
  assert.match(cam, /preferHardwareCodec\(pc\)/, 'hardware H.264 preferred on phones');
  assert.match(cam, /q\('#resolution'\)\.onchange = q\('#fps'\)\.onchange = \(\) => \{ if \(cam\.running\) applyFormat\(\)/, 'resolution and fps apply while live');
  assert.match(cam, /q\('#input'\)\.onchange = \(\) => \{ if \(cam\.running\) applyMic\(\)/, 'microphone applies while live');
  assert.doesNotMatch(cam, /Pare e reconecte para aplicar/, 'no more "stop and reconnect"');
  assert.match(optics, /captureStream\(\)/, 'processed video sends every drawn frame');
  assert.match(optics, /1920 \/ Math\.max/, 'digital processing capped at 1080p so 4K stays fluid');
  assert.match(html, /<script src="\.\/cam\.js"><\/script>\s*<script src="\.\/optics\.js"><\/script>/);
  assert.match(html, /id="bitrate"[^>]*max="25"/);
  assert.match(html, /id="homeSheet"/, 'iPhone full screen guide');
});

test('the desk can invite 1080p60 and 4K cameras, and nothing beyond', () => {
  const hub = createCameraHub({ sessionToken: 't' }); hub.configure('https://cam.example.test/');
  try {
    assert.equal(hub.invite(0, 'CAM 1', { width: 3840, height: 2160, fps: 30, bitrate: 16 }).profile?.width ?? 3840, 3840);
    hub.invite(1, 'CAM 2', { width: 1920, height: 1080, fps: 60, bitrate: 8 });
    assert.throws(() => hub.invite(2, 'CAM 3', { width: 7680, height: 4320, fps: 30, bitrate: 16 }), /Perfil/);
    assert.throws(() => hub.invite(2, 'CAM 3', { width: 3840, height: 2160, fps: 30, bitrate: 40 }), /Perfil/);
  } finally { hub.close(); }
  const desk = read('public/cam-desk.js');
  assert.match(desk, /value="3840x2160">4K · 30 fps · 16 Mbps/); assert.match(desk, /value="1920x1080@60">1080p · 60 fps · 8 Mbps/);
});
