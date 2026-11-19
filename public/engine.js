/*
 * Motor Andrômeda — codificação própria no navegador.
 *
 * Caminho padrão (MediaRecorder): navegador codifica VP8 → serviço decodifica → x264 codifica de novo → plataforma. São duas
 * codificações de vídeo e uma decodificação por quadro, mais um gravador que entrega pedaços de 100 ms.
 *
 * Caminho do motor: a mesa codifica H.264 e Opus UMA vez, no próprio navegador (WebCodecs, com a placa de vídeo quando houver),
 * o empacotador próprio (mkvmux.js) leva cada pacote ao serviço assim que fica pronto, e o FFmpeg só copia o vídeo e converte o
 * som para AAC. Menos CPU, menos atraso e um único relógio: o instante de cada quadro e de cada bloco de som é o da mesa, e a
 * compensação de sincronismo é aplicada aqui, nesses instantes.
 *
 * Uso:
 *   const probe = await AndromedaEngine.probe({ width: 1280, height: 720, bitrate: 4e6 });   // { ok, hardware, codec, reason }
 *   const s = AndromedaEngine.create({ audioTrack, outputs: [{ id: 'h', canvas, width, height, bitrate, onChunk }], avSyncMs, onError });
 *   await s.start(); … s.restart('h'); … s.stop();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AndromedaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FPS = 30, KEY_MS = 2000, AUDIO_BITRATE = 160000;
  const hasApi = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof AudioData !== 'undefined' && typeof MediaStreamTrackProcessor !== 'undefined';

  // Perfis em ordem de preferência. O nível acompanha a resolução (3.1 até 720p, 4.0 em 1080p).
  const profiles = height => { const level = height > 720 ? '28' : '1f'; return ['64', '4d', '42'].map(p => 'avc1.' + p + '00' + level); };
  const videoConfig = (o, codec, hardwareAcceleration) => ({ codec, width: o.width, height: o.height, bitrate: Math.round(o.bitrate), framerate: FPS, bitrateMode: 'constant', latencyMode: 'realtime', hardwareAcceleration, avc: { format: 'avc' } });

  // Descobre, neste computador, o que dá para usar. Nunca lança: devolve { ok:false, reason } para o plano B.
  async function probe(o = {}) {
    const need = { width: o.width || 1280, height: o.height || 720, bitrate: o.bitrate || 4e6 };
    if (!hasApi()) return { ok: false, reason: 'Este navegador não oferece o codificador de vídeo e áudio necessário (WebCodecs).' };
    let found = null;
    for (const hw of ['prefer-hardware', 'prefer-software']) {
      for (const codec of profiles(need.height)) {
        try { const r = await VideoEncoder.isConfigSupported(videoConfig(need, codec, hw)); if (r.supported) { found = { codec, hardware: hw === 'prefer-hardware', config: r.config }; break; } } catch { /* tenta o próximo */ }
      }
      if (found) break;
    }
    if (!found) return { ok: false, reason: 'O codificador H.264 do navegador não está disponível neste computador.' };
    let audio = false; try { audio = (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_BITRATE })).supported; } catch { /* sem áudio */ }
    if (!audio) return { ok: false, reason: 'O codificador de áudio Opus não está disponível neste navegador.' };
    return { ok: true, hardware: found.hardware, codec: found.codec };
  }

  function create({ audioTrack, outputs, avSyncMs = 0, onError = () => {}, onStats = () => {}, now = () => performance.now() }) {
    if (!outputs?.length) throw Error('Nenhuma saída configurada.');
    const frameMs = 1000 / FPS, keySlots = Math.round(KEY_MS / frameMs);
    const audioShift = avSyncMs > 0 ? avSyncMs : 0, videoShift = avSyncMs < 0 ? -avSyncMs : 0; // só o lado adiantado recebe atraso
    let t0 = 0, running = false, worker = null, timer = null, failed = false, closed = false;
    const audio = { encoder: null, reader: null, cfg: null, anchor: 0, firstTs: 0, desc: null, backlog: [], samples: 0, dropped: 0 };
    const MKV = (typeof AndromedaMkv !== 'undefined' ? AndromedaMkv : (typeof require === 'function' ? require('./mkvmux.js') : null));
    const fail = (where, e) => { if (failed) return; failed = true; try { onError(Error(where + ': ' + (e?.message || e))); } catch { /* o chamador decide */ } };

    const outs = outputs.map(o => ({ ...o, lastOut: 0, encoder: null, mux: null, desc: null, lastSlot: -1, lastKeySlot: -1e9, forceKey: true, held: [], frames: 0, dropped: 0, keys: 0, bytes: 0, lat: [], sent: new Map() }));

    // O empacotador de cada saída só nasce quando o vídeo trouxe a descrição do H.264 e o áudio já disse seu formato.
    function ensureMux(o) {
      if (o.mux || !o.desc || !audio.cfg) return !!o.mux;
      o.mux = MKV.create({ video: { width: o.width, height: o.height, description: o.desc }, audio: { channels: audio.cfg.numberOfChannels, sampleRate: audio.cfg.sampleRate, description: audio.desc } });
      emit(o, o.mux.header());
      for (const h of o.held.splice(0)) pushVideo(o, h.data, h.ms, h.key);
      for (const a of audio.backlog) pushAudio(o, a.data, a.ms);
      return true;
    }
    const emit = (o, bytes) => { if (!closed && bytes && bytes.length) { o.bytes += bytes.length; try { o.onChunk(bytes); } catch (e) { fail('envio', e); } } };
    const pushVideo = (o, data, ms, key) => emit(o, o.mux.video(data, ms, key));
    const pushAudio = (o, data, ms) => emit(o, o.mux.audio(data, ms));

    function startVideo(o) {
      o.encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); const key = chunk.type === 'key', ms = chunk.timestamp / 1000 + videoShift;
          if (meta?.decoderConfig?.description) o.desc = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength));
          const t = o.sent.get(chunk.timestamp); if (t !== undefined) { o.sent.delete(chunk.timestamp); o.lat.push(now() - t); if (o.lat.length > 60) o.lat.shift(); }
          o.lastOut = now(); if (key) o.keys++;
          if (!ensureMux(o)) { o.held.push({ data, ms, key }); if (o.held.length > 120) fail('vídeo', 'o áudio não chegou a tempo'); return; }
          pushVideo(o, data, ms, key);
        },
        error: e => fail('codificador de vídeo (' + o.id + ')', e),
      });
      o.encoder.configure(o.config);
    }

    async function startAudio() {
      const reader = new MediaStreamTrackProcessor({ track: audioTrack }).readable.getReader(); audio.reader = reader;
      (async () => {
        try {
          for (;;) {
            const { value: data, done } = await reader.read(); if (done || !running) { data?.close(); break; }
            if (!audio.encoder) {
              // Formato real do mixer: 48 kHz estéreo (a mesa abre o mixer assim); outro formato é recusado aqui, e o plano B assume.
              const cfg = { codec: 'opus', sampleRate: data.sampleRate, numberOfChannels: data.numberOfChannels, bitrate: AUDIO_BITRATE, opus: { frameDuration: 20000, application: 'audio', signal: 'music' } };
              const sup = await AudioEncoder.isConfigSupported(cfg).catch(() => ({ supported: false })); if (!sup.supported) { data.close(); fail('áudio', 'formato ' + data.sampleRate + ' Hz × ' + data.numberOfChannels + ' não suportado pelo Opus'); return; }
              audio.cfg = cfg; audio.anchor = now() - t0 - data.duration / 1000; audio.firstTs = data.timestamp;
              audio.encoder = new AudioEncoder({
                output: (chunk, meta) => {
                  if (!audio.desc && meta?.decoderConfig?.description) { const d = meta.decoderConfig.description; audio.desc = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); }
                  const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); const ms = audio.anchor + (chunk.timestamp - audio.firstTs) / 1000 + audioShift;
                  audio.samples++; for (const o of outs) { if (o.mux) pushAudio(o, bytes, ms); else { audio.backlog.push({ data: bytes, ms }); if (audio.backlog.length > 200) audio.backlog.shift(); ensureMux(o); } }
                },
                error: e => fail('codificador de áudio', e),
              });
              audio.encoder.configure(cfg);
            }
            if (audio.encoder.encodeQueueSize > 50) { audio.dropped++; data.close(); continue; }
            audio.encoder.encode(data); data.close();
          }
        } catch (e) { if (running) fail('captura de áudio', e); }
      })();
    }

    function tick() {
      if (!running || failed) return;
      const elapsed = now() - t0, slot = Math.round(elapsed / frameMs);
      for (const o of outs) {
        if (!o.encoder || slot <= o.lastSlot) continue;
        o.lastSlot = slot;
        // Fila do codificador cheia = computador sem fôlego: descarta este quadro em vez de acumular atraso.
        if (o.encoder.encodeQueueSize > 3) { o.dropped++; continue; }
        const ts = Math.round(slot * frameMs * 1000);
        let frame; try { frame = new VideoFrame(o.canvas, { timestamp: ts }); } catch (e) { fail('captura de vídeo (' + o.id + ')', e); return; }
        const key = o.forceKey || slot - o.lastKeySlot >= keySlots;
        if (key) { o.lastKeySlot = slot; o.forceKey = false; }
        o.sent.set(ts, now()); if (o.sent.size > 120) o.sent.delete(o.sent.keys().next().value);
        try { o.encoder.encode(frame, { keyFrame: key }); o.frames++; } catch (e) { fail('codificador de vídeo (' + o.id + ')', e); } finally { frame.close(); }
      }
    }

    let statsTimer = null, last = { frames: 0, dropped: 0, at: 0 };
    function stats() {
      const t = now(), dt = Math.max(1, t - last.at) / 1000, frames = outs.reduce((a, o) => a + o.frames, 0), dropped = outs.reduce((a, o) => a + o.dropped, 0);
      const s = { fps: Math.round((frames - last.frames) / dt / outs.length), dropped: dropped - last.dropped, droppedTotal: dropped, audioPackets: audio.samples,
        latencyMs: Math.round(Math.max(0, ...outs.map(o => o.lat.length ? o.lat.reduce((a, b) => a + b, 0) / o.lat.length : 0))), outputs: outs.map(o => ({ id: o.id, frames: o.frames, keys: o.keys, bytes: o.bytes, dropped: o.dropped })) };
      last = { frames, dropped, at: t }; return s;
    }

    return {
      async start() {
        if (running) return; running = true; failed = false; t0 = now(); last.at = t0;
        for (const o of outs) { o.config = null; for (const hw of ['prefer-hardware', 'prefer-software']) { for (const codec of profiles(o.height)) { const c = videoConfig(o, codec, hw); try { if ((await VideoEncoder.isConfigSupported(c)).supported) { o.config = c; break; } } catch { /* próximo */ } } if (o.config) break; } if (!o.config) throw Error('H.264 indisponível para ' + o.width + '×' + o.height + '.'); startVideo(o); }
        await startAudio();
        try { worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),' + Math.round(frameMs / 2) + ')'], { type: 'text/javascript' }))); worker.onmessage = tick; } catch { timer = setInterval(tick, Math.round(frameMs / 2)); }
        // Vigia: um codificador que deixa de entregar quadros não derruba a live, mas entrega a sessão ao plano B.
        statsTimer = setInterval(() => {
          if (!running) return; const t = now();
          for (const o of outs) { const quiet = t - (o.lastOut || t0); if (quiet > (o.lastOut ? 4000 : 8000)) { fail('codificador de vídeo (' + o.id + ')', 'parou de entregar quadros há ' + Math.round(quiet / 1000) + ' s'); return; } }
          try { onStats(stats()); } catch { /* informativo */ }
        }, 1000);
      },
      // O FFmpeg do serviço foi reiniciado: cabeçalho novo e um quadro-chave logo, para a imagem voltar sem esperar 2 s.
      restart(id) { const o = outs.find(x => x.id === id); if (!o || !o.mux) return; emit(o, o.mux.restart()); o.forceKey = true; },
      requestKeyframe(id) { for (const o of outs) if (!id || o.id === id) o.forceKey = true; },
      stats,
      get failed() { return failed; },
      // Encerramento sem descarregar nada (falha ou troca de motor): nenhum pacote a mais sai daqui.
      abort() { closed = true; running = false; clearInterval(statsTimer); clearInterval(timer); worker?.terminate(); try { audio.reader?.cancel(); } catch { /* já encerrado */ } for (const o of outs) { try { o.encoder?.close(); } catch { /* já fechado */ } } try { audio.encoder?.close(); } catch { /* já fechado */ } },
      async stop() {
        if (!running) return; running = false; clearInterval(statsTimer); clearInterval(timer); worker?.terminate();
        try { await audio.reader?.cancel(); } catch { /* já encerrado */ }
        for (const o of outs) { try { await o.encoder?.flush(); } catch { /* descartado */ } try { o.encoder?.close(); } catch { /* já fechado */ } }
        try { audio.encoder?.close(); } catch { /* já fechado */ }
      },
    };
  }

  // Teste do computador ANTES de ir ao ar: codifica o próprio canvas do PGM, no tamanho pedido, durante alguns segundos, com a mesa desenhando ao mesmo tempo,
  // e mede quantos quadros por segundo saem de verdade. Assim a transmissão nunca começa num tamanho que o computador não sustenta.
  async function benchmark({ canvas, width, height, bitrate = 4e6, ms = 2600, warmup = 700, now = () => performance.now() } = {}) {
    if (!hasApi() || !canvas) return { ok: false, reason: 'sem WebCodecs' };
    const o = { width, height, bitrate }; let config = null, hardware = false;
    for (const hw of ['prefer-hardware', 'prefer-software']) {
      for (const codec of profiles(height)) { try { const r = await VideoEncoder.isConfigSupported(videoConfig(o, codec, hw)); if (r.supported) { config = r.config; hardware = hw === 'prefer-hardware'; break; } } catch { /* tenta o próximo */ } }
      if (config) break;
    }
    if (!config) return { ok: false, reason: 'sem codificador H.264' };
    const frameMs = 1000 / FPS, t0 = now(); let out = 0, outAfter = 0, skipped = 0, sent = 0, failed = false, slot = 0;
    const enc = new VideoEncoder({ output: () => { out++; if (now() - t0 > warmup) outAfter++; }, error: () => { failed = true; } });
    try { enc.configure(config); } catch { return { ok: false, reason: 'o codificador recusou a configuração' }; }
    await new Promise(resolve => {
      const timer = setInterval(() => {
        const el = now() - t0; if (el >= ms || failed) { clearInterval(timer); resolve(); return; }
        const s = Math.round(el / frameMs); if (s <= slot) return; skipped += Math.max(0, s - slot - 1); slot = s;
        if (enc.encodeQueueSize > 3) { skipped++; return; }
        let frame; try { frame = new VideoFrame(canvas, { timestamp: Math.round(s * frameMs * 1000) }); } catch { failed = true; return; }
        try { enc.encode(frame, { keyFrame: sent === 0 || sent % 60 === 0 }); sent++; } catch { failed = true; } finally { frame.close(); }
      }, Math.round(frameMs / 2));
    });
    try { await Promise.race([enc.flush(), new Promise(r => setTimeout(r, 1500))]); } catch { /* descartado */ }
    try { enc.close(); } catch { /* já fechado */ }
    const secs = Math.max(0.5, (ms - warmup) / 1000);
    return { ok: !failed, fps: Math.round(outAfter / secs * 10) / 10, skipped, hardware, width, height };
  }

  return { probe, create, benchmark, supported: hasApi };
});
