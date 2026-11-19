'use strict';
/*
 * TRACKING · reconhecimento em segundo plano (Web Worker).
 * O MediaPipe roda aqui, fora da tela principal: a interface, o vídeo do PROGRAM e a codificação da transmissão não esperam a análise,
 * e o reconhecimento pode rodar com muito mais quadros por segundo sem tirar qualidade de nada.
 * Recebe quadros reduzidos (ImageBitmap) e devolve as caixas já em coordenadas de 0 a 1.
 */
importScripts('/vendor/mediapipe/vision_bundle.js'); // define a variável global "Vision"
let fileset = null; const detectors = {};
async function detector(kind) {
  fileset = fileset || await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  if (!detectors[kind]) detectors[kind] = kind === 'face'
    ? await Vision.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/vendor/mediapipe/models/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 })
    : await Vision.ObjectDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/vendor/mediapipe/models/efficientdet_lite0.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', scoreThreshold: 0.4, maxResults: 6, categoryAllowlist: ['person'] });
  return detectors[kind];
}
let lastStamp = 0;
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'warm') { try { await detector(m.kind); self.postMessage({ type: 'ready', kind: m.kind }); } catch (err) { self.postMessage({ type: 'error', id: 0, message: String(err?.message || err) }); } return; }
  if (m.type !== 'detect') return;
  try {
    const d = await detector(m.kind), t0 = performance.now(), stamp = Math.max(performance.now(), lastStamp + 1); lastStamp = stamp;
    const W = m.bitmap.width, H = m.bitmap.height, r = d.detectForVideo(m.bitmap, stamp); m.bitmap.close?.();
    const dets = r.detections.map(x => { const b = x.boundingBox; return { cx: (b.originX + b.width / 2) / W, cy: (b.originY + (m.kind === 'person' ? b.height * m.personY : b.height / 2)) / H, w: b.width / W, h: b.height / H, kind: m.kind, score: x.categories?.[0]?.score || 0 }; });
    self.postMessage({ type: 'result', id: m.id, dets, took: performance.now() - t0 });
  } catch (err) { try { m.bitmap?.close?.(); } catch { /* já fechado */ } self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) }); }
};
