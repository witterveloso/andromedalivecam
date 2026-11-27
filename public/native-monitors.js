'use strict';
/*
 * Monitores nativos (PREVIEW e miniaturas das câmeras).
 *
 * Desenhar um quadro de câmera num canvas obriga a tela principal a converter o vídeo inteiro (YUV → RGB) a cada desenho.
 * Num computador sem aceleração de vídeo isso custa ~10 ms por vídeo 1080p — o mesmo tempo de que o PGM (o que vai ao ar)
 * precisa para sair a 30 quadros por segundo. Medido no ensaio real de transmissão: PREVIEW ~11 ms e cada miniatura ~3,4 ms
 * por desenho, dentro de um quadro de 33 ms.
 *
 * Aqui, quando uma câmera tem vídeo ao vivo, o monitor passa a ser um <video> do próprio navegador ligado ao mesmo fluxo
 * (sem decodificar de novo): quem mostra é o compositor, fora da tela principal, que fica livre para o PGM.
 * Imagens, slides, VT, vinheta, barras, mosaico e câmeras sem sinal continuam no canvas, como antes.
 */
(() => {
  const PREVIEW_ID = 'monPreview';
  const streams = new WeakMap(); // elemento de vídeo de origem -> MediaStream mostrado nos monitores
  const slots = []; // { canvas, video, index() }

  // Fluxo de uma câmera ao vivo, sem nova decodificação: o próprio MediaStream (WebRTC, webcam) ou a captura do vídeo (arquivo local).
  function streamOf(i) {
    if (!(i >= 0 && i < 10) || !cams[i]?.conn) return null;
    const el = media[i]?.element;
    if (!(el instanceof HTMLVideoElement) || !(el.videoWidth > 0)) return null;
    if (el.srcObject instanceof MediaStream) return el.srcObject.getVideoTracks().some(t => t.readyState === 'live') ? el.srcObject : null;
    if (!streams.has(el)) { try { const s = el.captureStream ? el.captureStream() : null; if (!s) return null; streams.set(el, s); } catch { return null; } }
    const s = streams.get(el); return s.getVideoTracks().some(t => t.readyState === 'live') ? s : null;
  }
  function fitOf(i) {
    const mode = window.andromedaStage?.fit?.[i]; if (mode === 'cover' || mode === 'contain') return mode;
    const el = media[i]?.element, r = el ? el.videoWidth / el.videoHeight : 16 / 9; return Math.abs(r / (16 / 9) - 1) < .14 ? 'cover' : 'contain';
  }
  function makeVideo(canvas) {
    const v = document.createElement('video'); v.className = 'native-mon'; v.muted = true; v.playsInline = true; v.autoplay = true; v.hidden = true;
    v.setAttribute('aria-hidden', 'true'); v.disablePictureInPicture = true;
    canvas.after(v); return v;
  }
  function attach() {
    slots.length = 0;
    document.querySelectorAll('.mv-cell').forEach((cell, i) => { const c = cell.querySelector('canvas'); if (c) slots.push({ canvas: c, video: makeVideo(c), index: () => i, shown: null }); });
    const pv = document.querySelector('#' + PREVIEW_ID + ' canvas'); if (pv) slots.push({ canvas: pv, video: makeVideo(pv), index: () => state.prv, shown: null, preview: true });
  }
  function update() {
    for (const s of slots) {
      const i = s.index(), visible = s.canvas.getClientRects().length > 0, stream = visible && window.andromedaNativeMonitors?.enabled !== false && !(s.preview && window.andromedaFormat?.vertical) ? streamOf(i) : null;
      if (stream) {
        if (s.video.srcObject !== stream) { s.video.srcObject = stream; s.video.play().catch(() => {}); }
        const fit = fitOf(i); if (s.video.style.objectFit !== fit) s.video.style.objectFit = fit;
        if (s.video.hidden) s.video.hidden = false; s.shown = i;
      } else if (s.shown !== null || !s.video.hidden) {
        s.video.hidden = true; s.shown = null; if (s.video.srcObject) { s.video.pause(); s.video.srcObject = null; }
      }
    }
  }
  attach(); update(); setInterval(update, 250);
  // O desenho da mesa pergunta antes de pintar um canvas de monitor: se o vídeo nativo está à vista naquele lugar, não desenha.
  window.andromedaNativeMonitors = {
    enabled: true,
    covers(canvas) { for (const s of slots) if (s.canvas === canvas) return s.shown !== null && s.shown === s.index() && !s.video.hidden && s.video.readyState >= 2; return false; },
    refresh: update,
    // Fluxo ao vivo da câmera i (sem nova decodificação), para outros monitores da mesa (Controle de câmera).
    streamOf: i => (window.andromedaNativeMonitors?.enabled !== false ? streamOf(i) : null),
    state: () => slots.map(s => ({ preview: !!s.preview, index: s.index(), shown: s.shown })),
  };
})();
