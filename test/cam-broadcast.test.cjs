'use strict';
// Andrômeda Cam como câmera de transmissão: áudio de programa limpo e em qualidade de transmissão, nos dois lados.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n'); // checkout do Windows vem com CRLF
const cam = read('../docs/cam.js'), desk = read('../public/cam-desk.js');
const fn = src => new Function(src.match(/function opusBroadcast\(sdp\) ?\{[\s\S]*?\n\}\n|function opusBroadcast\(sdp\)\{.*\}\n/)[0] + ';return opusBroadcast')();
const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 63\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\n';

test('Opus de transmissão: 128 kb/s, estéreo e correção de perdas, igual no celular e na mesa (medido: 24 → 128 kb/s)', () => {
  const a = fn(cam), b = fn(desk), out = a(SDP);
  assert.equal(out, b(SDP), 'celular e mesa declaram o mesmo');
  const fmtp = /a=fmtp:111 (.*)/.exec(out)[1].split(';');
  for (const p of ['maxaveragebitrate=128000', 'stereo=1', 'sprop-stereo=1', 'useinbandfec=1', 'minptime=10']) assert(fmtp.includes(p), p);
  assert.match(out, /m=video 9 UDP\/TLS\/RTP\/SAVPF 96\r\na=rtpmap:96 H264\/90000/, 'vídeo intacto');
  assert.equal(a(a(SDP)), a(SDP), 'aplicar duas vezes não duplica');
  const noFmtp = a(SDP.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', ''));
  assert.match(noFmtp, /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 maxaveragebitrate=128000;stereo=1/, 'cria a linha quando não existe');
  assert.equal(a('v=0\r\nm=video 9 X 96\r\n'), 'v=0\r\nm=video 9 X 96\r\n', 'sem Opus, não mexe');
});

test('áudio de programa limpo: sem cancelamento de eco, supressão de ruído nem ganho automático (exceto "sem fones")', () => {
  const body = cam.match(/function audioConstraints\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(body, /noiseSuppression: false/); assert.match(body, /autoGainControl: false/); assert.match(body, /echoCancellation: noHeadphones/);
  assert(!/echoCancellation: true|noiseSuppression: true/.test(cam), 'nenhum getUserMedia com filtros ligados');
});

test('queda momentânea da rede: espera o WebRTC se recuperar antes de refazer a conexão', () => {
  assert.match(cam, /pc\.connectionState === 'failed' \? 1000 : 6000/);
  assert.match(cam, /pc\.connectionState !== 'connected'\) cam\.ws\?\.close\(\)/, 'só refaz se continuar sem caminho');
});
