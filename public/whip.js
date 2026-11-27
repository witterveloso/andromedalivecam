'use strict';
/*
 * Andrômeda Live — destino WHIP (WebRTC), atraso abaixo de 1 s.
 *
 * A imagem do PROGRAM (16:9 ou 9:16) e o som da mesa vão direto por WebRTC ao servidor WHIP. O serviço local faz só a
 * apresentação HTTP (/api/whip/offer e /api/whip/stop). Cada destino WHIP é independente: entra e sai do ar sozinho e
 * reconecta sozinho (1, 2, 4, 8 e depois a cada 15 s) se a conexão cair.
 *
 * Diferente dos destinos RTMP/SRT (que copiam a codificação única do serviço), o WebRTC codifica no próprio navegador da
 * mesa: cada destino WHIP é mais uma codificação. Por isso a mesa preferencialmente usa H.264 (placa de vídeo quando houver).
 */
(() => {
  const BACKOFF = [1000, 2000, 4000, 8000, 15000];

  // Som de transmissão no Opus: estéreo, 128 kbps, sem transmissão contínua de silêncio cortado (cbr=0), com correção de perdas.
  const opusBroadcast = sdp => {
    const pt = (/a=rtpmap:(\d+) opus\/48000/i.exec(sdp) || [])[1]; if (!pt) return sdp;
    const params = 'minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=0';
    const fmtp = new RegExp('a=fmtp:' + pt + ' [^\\r\\n]*');
    return fmtp.test(sdp) ? sdp.replace(fmtp, 'a=fmtp:' + pt + ' ' + params) : sdp.replace(new RegExp('(a=rtpmap:' + pt + ' opus/48000[^\\r\\n]*\\r?\\n)', 'i'), '$1a=fmtp:' + pt + ' ' + params + '\r\n');
  };
  // H.264 primeiro (aceito por todos os servidores WHIP e com placa de vídeo na maioria dos computadores), depois VP8.
  function preferH264(transceiver) {
    const caps = window.RTCRtpSender?.getCapabilities?.('video'); if (!caps || !transceiver.setCodecPreferences) return;
    const rank = c => /h264/i.test(c.mimeType) ? (/packetization-mode=1/.test(c.sdpFmtpLine || '') ? (/profile-level-id=42e0/.test(c.sdpFmtpLine || '') ? 0 : 1) : 2) : /vp8/i.test(c.mimeType) ? 3 : /rtx|red|ulpfec/i.test(c.mimeType) ? 5 : 4;
    try { transceiver.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b))); } catch { /* navegador decide */ }
  }
  // Espera juntar os candidatos de rede (até 2,5 s): a oferta vai completa, como pede o WHIP sem trickle.
  const gathered = (pc, ms = 2500) => new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, ms); pc.addEventListener('icegatheringstatechange', check);
  });

  /**
   * @param {{url:string, token?:string, video:MediaStreamTrack, audio?:MediaStreamTrack, bitrate:number, apiToken:string,
   *          onState:(state:string, reason?:string)=>void, onStats?:(s:{kbps:number, fps:number})=>void, fetchImpl?:Function}} o
   */
  function create(o) {
    const fetcher = o.fetchImpl || ((...a) => fetch(...a));
    let pc = null, location = null, want = false, retries = 0, retryTimer = null, statsTimer = null, prev = null, everSent = false, state = 'standby';
    const set = (s, reason = '') => { if (s === state && !reason) return; state = s; o.onState?.(s, reason); };
    const api = (path, body) => fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': o.apiToken }, body: JSON.stringify(body) }).then(r => r.json());

    function teardown() {
      clearInterval(statsTimer); statsTimer = null; prev = null;
      const old = pc; pc = null; if (old) { old.onconnectionstatechange = null; try { old.close(); } catch { /* já fechada */ } }
      const loc = location; location = null;
      if (loc) api('/api/whip/stop', { location: loc, token: o.token }).catch(() => {});
    }
    function retry(reason) {
      teardown(); if (!want) return;
      const wait = BACKOFF[Math.min(retries, BACKOFF.length - 1)]; retries++;
      set('retrying', reason + ' · nova tentativa em ' + Math.round(wait / 1000) + ' s');
      clearTimeout(retryTimer); retryTimer = setTimeout(connect, wait);
    }
    async function connect() {
      if (!want) return;
      set(everSent ? 'retrying' : 'connecting');
      const peer = pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      // O estado é vigiado desde a criação: a conexão pode completar a qualquer momento depois da resposta do servidor.
      const watchState = () => {
        if (peer !== pc) return;
        const s = peer.connectionState;
        if (s === 'connected') { retries = 0; everSent = true; set('sending'); }
        else if (s === 'failed') retry('conexão WebRTC perdida');
        else if (s === 'disconnected') { setTimeout(() => { if (peer === pc && peer.connectionState === 'disconnected') retry('conexão WebRTC interrompida'); }, 5000); }
      };
      peer.onconnectionstatechange = watchState;
      try {
        const vt = peer.addTransceiver(o.video, { direction: 'sendonly', sendEncodings: [{ maxBitrate: Math.round(o.bitrate), maxFramerate: 30 }] });
        if (o.audio) peer.addTransceiver(o.audio, { direction: 'sendonly' });
        preferH264(vt);
        const offer = await peer.createOffer();
        await peer.setLocalDescription({ type: 'offer', sdp: opusBroadcast(offer.sdp) });
        await gathered(peer); if (peer !== pc) return;
        const r = await api('/api/whip/offer', { url: o.url, token: o.token, sdp: peer.localDescription.sdp }); if (peer !== pc) { if (r.location) api('/api/whip/stop', { location: r.location, token: o.token }).catch(() => {}); return; }
        if (r.error || !r.sdp) throw Error(r.error || 'sem resposta do servidor WHIP');
        location = r.location || null;
        await peer.setRemoteDescription({ type: 'answer', sdp: r.sdp });
        // Mantém a resolução (1080p) e baixa quadros só se a rede apertar; o bitrate fica no limite escolhido.
        try { const p = vt.sender.getParameters(); p.degradationPreference = 'maintain-resolution'; if (p.encodings?.[0]) { p.encodings[0].maxBitrate = Math.round(o.bitrate); p.encodings[0].maxFramerate = 30; } await vt.sender.setParameters(p); } catch { /* opcional */ }
        watchState();
        statsTimer = setInterval(async () => {
          if (peer !== pc || !o.onStats) return;
          try {
            const stats = await peer.getStats(); let bytes = 0, fps = 0;
            stats.forEach(r => { if (r.type === 'outbound-rtp' && !r.isRemote) { bytes += r.bytesSent || 0; if (r.kind === 'video') fps = r.framesPerSecond || fps; } });
            const t = performance.now(); if (prev) o.onStats({ kbps: Math.round((bytes - prev.bytes) * 8 / (t - prev.t)), fps: Math.round(fps) }); prev = { bytes, t };
          } catch { /* próxima leitura */ }
        }, 2000);
        setTimeout(() => { if (peer === pc && want && peer.connectionState !== 'connected') retry('sem conexão WebRTC em 20 s'); }, 20000);
      } catch (e) { if (peer === pc) retry(e.message || 'falha ao conectar'); }
    }
    return {
      start() { if (want) return; want = true; retries = 0; everSent = false; clearTimeout(retryTimer); connect(); },
      stop() { want = false; clearTimeout(retryTimer); teardown(); set('off'); },
      get state() { return state; },
    };
  }

  window.AndromedaWhip = { create, _internal: { opusBroadcast } };
})();
