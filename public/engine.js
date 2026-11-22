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
  const profiles = (width, height) => { const blocks = Math.ceil(width / 16) * Math.ceil(height / 16); const level = blocks > 8192 ? '33' : blocks > 3600 ? '28' : '1f'; return ['64', '4d', '42'].map(p => 'avc1.' + p + '00' + level); };
  const videoConfig = (o, codec, hardwareAcceleration) => ({ codec, width: o.width, height: o.height, bitrate: Math.round(o.bitrate), framerate: FPS, bitrateMode: 'constant', latencyMode: 'realtime', hardwareAcceleration, avc: { format: 'avc' } });

  // Descobre, neste computador, o que dá para usar. Nunca lança: devolve { ok:false, reason } para o plano B.
  async function probe(o = {}) {
    const need = { width: o.width || 1280, height: o.height || 720, bitrate: o.bitrate || 4e6 };
    if (!hasApi()) return { ok: false, reason: 'Este navegador não oferece o codificador de vídeo e áudio necessário (WebCodecs).' };
    let found = null;
    for (const hw of ['prefer-hardware', 'prefer-software']) {
      for (const codec of profiles(need.width, need.height)) {
        try { const r = await VideoEncoder.isConfigSupported(videoConfig(need, codec, hw)); if (r.supported) { found = { codec, hardware: hw === 'prefer-hardware', config: r.config }; break; } } catch { /* tenta o próximo */ }
      }
      if (found) break;
    }
    if (!found) return { ok: false, reason: 'O codificador H.264 do navegador não está disponível neste computador.' };
    let audio = false; try { audio = (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_BITRATE })).supported; } catch { /* sem áudio */ }
    if (!audio) return { ok: false, reason: 'O codificador de áudio Opus não está disponível neste navegador.' };
    return { ok: true, hardware: found.hardware, codec: found.codec };
  }

  function create({ audioTrack, audioReadable, dedicated = false, outputs, avSyncMs = 0, onError = () => {}, onStats = () => {}, now = () => performance.now() }) {
    if (!outputs?.length) throw Error('Nenhuma saída configurada.');
    const frameMs = 1000 / FPS, keySlots = Math.round(KEY_MS / frameMs);
    const audioShift = avSyncMs > 0 ? avSyncMs : 0, videoShift = avSyncMs < 0 ? -avSyncMs : 0; // só o lado adiantado recebe atraso
    let t0 = 0, running = false, worker = null, timer = null, failed = false, closed = false;
    const audio = { encoder: null, reader: null, cfg: null, anchor: 0, firstTs: 0, desc: null, backlog: [], samples: 0, dropped: 0 };
    const MKV = (typeof AndromedaMkv !== 'undefined' ? AndromedaMkv : (typeof require === 'function' ? require('./mkvmux.js') : null));
    const fail = (where, e) => { if (failed) return; failed = true; try { onError(Error(where + ': ' + (e?.message || e))); } catch { /* o chamador decide */ } };

    const outs = outputs.map(o => ({ ...o, generation: 0, nextGeneration: 0, queue: [], queueDropped: 0, encodedGeneration: -1, repeated: 0, lastOut: 0, encoder: null, mux: null, desc: null, lastSlot: -1, lastKeySlot: -1e9, forceKey: true, held: [], frames: 0, emitted: 0, missed: 0, dropped: 0, keys: 0, bytes: 0, lat: [], sent: new Map() }));

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
          o.emitted++; o.lastOut = now(); if (key) o.keys++;
          if (!ensureMux(o)) { o.held.push({ data, ms, key }); if (o.held.length > 120) fail('vídeo', 'o áudio não chegou a tempo'); return; }
          pushVideo(o, data, ms, key);
        },
        error: e => fail('codificador de vídeo (' + o.id + ')', e),
      });
      o.encoder.configure(o.config);
    }

    async function startAudio() {
      const reader = (audioReadable || new MediaStreamTrackProcessor({ track: audioTrack }).readable).getReader(); audio.reader = reader;
      (async () => {
        try {
          for (;;) {
            const { value: data, done } = await reader.read(); if (done || !running) { data?.close(); break; }
            if (!audio.encoder) {
              // Formato real do mixer: 48 kHz estéreo (a mesa abre o mixer assim); outro formato é recusado aqui, e o plano B assume.
              const cfg = { codec: 'opus', sampleRate: data.sampleRate, numberOfChannels: data.numberOfChannels, bitrate: AUDIO_BITRATE, opus: { frameDuration: 20000, application: 'audio', signal: 'music' } };
              const sup = await AudioEncoder.isConfigSupported(cfg).catch(() => ({ supported: false })); if (closed || !running) { data.close(); return; } if (!sup.supported) { data.close(); fail('áudio', 'formato ' + data.sampleRate + ' Hz × ' + data.numberOfChannels + ' não suportado pelo Opus'); return; }
              audio.cfg = cfg; audio.anchor = now() - t0 - data.duration / 1000; audio.firstTs = data.timestamp;
              audio.encoder = new AudioEncoder({
                output: (chunk, meta) => {
                  if (!audio.desc && meta?.decoderConfig?.description) { const d = meta.decoderConfig.description; audio.desc = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); }
                  const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); const ms = audio.anchor + (chunk.timestamp - audio.firstTs) / 1000 + audioShift;
                  audio.samples++; audio.backlog.push({data:bytes,ms}); if(audio.backlog.length>200)audio.backlog.shift(); for(const o of outs){if(o.mux)pushAudio(o,bytes,ms);else ensureMux(o);}
                },
                error: e => fail('codificador de áudio', e),
              });
              audio.encoder.configure(cfg);
            }
            if (audio.encoder.encodeQueueSize > 50) { audio.dropped++; data.close(); continue; }
            try { audio.encoder.encode(data); } finally { data.close(); }
          }
        } catch (e) { if (running) fail('captura de áudio', e); }
      })();
    }

    function tick() {
      if (!running || failed) return;
      const elapsed = now() - t0, target = Math.floor(elapsed / frameMs);
      for (const o of outs) {
        if (!o.encoder) continue;
        // The first capture may arrive after audio/probing: do not replay a stale startup backlog.
        const slot = dedicated && o.lastSlot >= 0 ? o.lastSlot + 1 : target;
        if (slot > target || (!dedicated && slot <= o.lastSlot)) continue;
        if (dedicated && target - slot > 6) { fail('cadência', 'o codificador acumulou mais de 200 ms de atraso'); return; }
        if (dedicated && o.queue.length && o.encoder.encodeQueueSize <= 3) {
          const item = o.queue.shift(); o.canvas?.close?.(); o.canvas = item.frame; o.generation = item.generation;
        }
        if (!o.canvas) continue;
        if (o.lastSlot >= 0) o.missed += Math.max(0, slot-o.lastSlot-1);
        o.lastSlot = slot;
        // Fila do codificador cheia = computador sem fôlego: descarta este quadro em vez de acumular atraso.
        if (o.encoder.encodeQueueSize > 3) { if(dedicated)o.lastSlot--; else o.dropped++; continue; }
        const ts = Math.round(slot * frameMs * 1000);
        let frame; try { frame = new VideoFrame(o.canvas, { timestamp: ts, duration: Math.round(1000000 / FPS) }); } catch (e) { fail('captura de vídeo (' + o.id + ')', e); return; }
        const key = o.forceKey || slot - o.lastKeySlot >= keySlots;
        if (key) { o.lastKeySlot = slot; o.forceKey = false; }
        o.sent.set(ts, now()); if (o.sent.size > 120) o.sent.delete(o.sent.keys().next().value);
        try { o.encoder.encode(frame, { keyFrame: key }); o.frames++; if(dedicated && o.encodedGeneration === o.generation)o.repeated++; o.encodedGeneration=o.generation; } catch (e) { fail('codificador de vídeo (' + o.id + ')', e); } finally { frame.close(); }
      }
    }

    let statsTimer = null, last = { received: 0, frames: 0, emitted: 0, repeated: 0, dropped: 0, at: 0 };
    function stats() {
      const t = now(), dt = Math.max(1, t - last.at) / 1000;
      const sum = name => outs.reduce((n, o) => n + o[name], 0);
      const received = sum('nextGeneration'), frames = sum('frames'), emitted = sum('emitted'), repeated = sum('repeated'), dropped = sum('dropped');
      const s = {
        receivedFps: dedicated ? Math.round((received - last.received) / dt / outs.length) : null,
        fps: Math.round((emitted - last.emitted) / dt / outs.length),
        submittedFps: Math.round((frames - last.frames) / dt / outs.length),
        freshFps: dedicated ? Math.round((frames - last.frames - repeated + last.repeated) / dt / outs.length) : null,
        repeated: repeated - last.repeated, repeatedTotal: repeated,
        dropped: dropped - last.dropped, droppedTotal: dropped, audioPackets: audio.samples,
        latencyMs: Math.round(Math.max(0, ...outs.map(o => o.lat.length ? o.lat.reduce((a, b) => a + b, 0) / o.lat.length : 0))),
        outputs: outs.map(o => ({ id: o.id, received: o.nextGeneration, frames: o.frames, emitted: o.emitted, missed: o.missed, keys: o.keys, bytes: o.bytes, dropped: o.dropped, repeated: o.repeated, queueDropped: o.queueDropped, encoderQueue: o.encoder?.encodeQueueSize || 0 }))
      };
      last = { received, frames, emitted, repeated, dropped, at: t }; return s;
    }

    return {
      async start() {
        if (closed) throw Error('Saída encerrada'); if (running) return; running = true; failed = false; t0 = now(); last.at = t0;
        for (const o of outs) { o.config = null; for (const hw of ['prefer-hardware', 'prefer-software']) { for (const codec of profiles(o.width, o.height)) { const c = videoConfig(o, codec, hw); try { if ((await VideoEncoder.isConfigSupported(c)).supported) { o.config = c; break; } if (closed || !running) return; } catch { /* próximo */ } } if (o.config) break; } if (closed || !running) return; if (!o.config) throw Error('H.264 indisponível para ' + o.width + '×' + o.height + '.'); startVideo(o); }
        if (closed || !running) return;
        t0 = now(); last.at = t0;
        await startAudio();
        if (closed) return;
        timer = setInterval(tick, dedicated ? 4 : Math.round(frameMs / 2));
        // Vigia: um codificador que deixa de entregar quadros não derruba a live, mas entrega a sessão ao plano B.
        statsTimer = setInterval(() => {
          if (!running) return; const t = now();
          for (const o of outs) { const quiet = t - (o.lastOut || t0); if (quiet > (o.lastOut ? 4000 : 8000)) { fail('codificador de vídeo (' + o.id + ')', 'parou de entregar quadros há ' + Math.round(quiet / 1000) + ' s'); return; } }
          try { onStats(stats()); } catch { /* informativo */ }
        }, 1000);
      },
      setFrame(id, frame) {
        const o = outs.find(o => o.id === id);
        if (!o || !running) { frame.close(); return; }
        // Two captures absorb scheduling jitter between the UI and encoder clocks (<=67 ms).
        // Discard only the oldest pending frame when capture genuinely outruns output.
        o.queue.push({ frame, generation: ++o.nextGeneration });
        while (o.queue.length > 2) { o.queue.shift().frame.close(); o.queueDropped++; }
      },
      // O FFmpeg do serviço foi reiniciado: cabeçalho novo e um quadro-chave logo, para a imagem voltar sem esperar 2 s.
      restart(id) { const o = outs.find(x => x.id === id); if (!o || !o.mux) return; emit(o, o.mux.restart()); o.forceKey = true; },
      requestKeyframe(id) { for (const o of outs) if (!id || o.id === id) o.forceKey = true; },
      stats,
      get failed() { return failed; },
      // Encerramento sem descarregar nada (falha ou troca de motor): nenhum pacote a mais sai daqui.
      abort() {  closed = true; running = false; clearInterval(statsTimer); clearInterval(timer); worker?.terminate(); try { audio.reader?.cancel(); } catch { /* já encerrado */ } for (const o of outs) { try { o.encoder?.close(); } catch { /* já fechado */ } if(dedicated){o.canvas?.close?.();o.canvas=null;for(const item of o.queue.splice(0))item.frame.close();} } try { audio.encoder?.close(); } catch { /* já fechado */ } },
      async stop() {
        
        if (!running) return; running = false; clearInterval(statsTimer); clearInterval(timer); worker?.terminate();
        try { await audio.reader?.cancel(); } catch { /* já encerrado */ }
        for (const o of outs) { try { await o.encoder?.flush(); } catch { /* descartado */ } try { o.encoder?.close(); } catch { /* já fechado */ } if(dedicated){o.canvas?.close?.();o.canvas=null;for(const item of o.queue.splice(0))item.frame.close();} }
        try { await audio.encoder?.flush(); } catch {}
        closed = true;
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
      for (const codec of profiles(width, height)) { try { const r = await VideoEncoder.isConfigSupported(videoConfig(o, codec, hw)); if (r.supported) { config = r.config; hardware = hw === 'prefer-hardware'; break; } } catch { /* tenta o próximo */ } }
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

  function createDedicated(options) {
    const outputs = options.outputs;
    let worker, ready = false, closed = false;
    let rejectStart, resolveStart, resolveStop, abortTimer, lastStats = {}, pgmAt = performance.now(), pgmFrames = window.andromedaProgramFrames || 0;
    const received = new Map(outputs.map(o => [o.id, o]));
    const videoTracks = [];
    const script = `
      importScripts(${JSON.stringify(location.origin + '/mkvmux.js')}, ${JSON.stringify(location.origin + '/engine.js')});
      let session, outstanding = 0, readers = [];
      async function readVideo(id, readable) {
        const reader = readable.getReader(); readers.push(reader);
        try {
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            session.setFrame(id, value);
          }
        } catch(e) { postMessage({type:'error',message:'Captura do PGM ('+id+'): '+e.message}); }
      }
      onmessage = async ({ data: m }) => {
        try {
          if (m.type === 'init') {
            session = AndromedaEngine.create({
              audioReadable: m.audio, dedicated: true, outputs: m.outputs.map(o => ({...o, canvas: null,
                onChunk(bytes) {
                  outstanding += bytes.byteLength;
                  if (outstanding > 6 * 1024 * 1024) throw Error('Fila de saída excedeu 6 MB');
                  postMessage({type:'chunk',id:o.id,bytes}, [bytes.buffer]);
                }
              })),
              avSyncMs: m.avSyncMs,
              onError: e => postMessage({type:'error',message:e.message}),
              onStats: stats => postMessage({type:'stats',stats})
            });
            await session.start();
            for (const input of m.videos) readVideo(input.id, input.readable);
            postMessage({type:'ready'});
          } else if (m.type === 'ack') outstanding = Math.max(0, outstanding - m.bytes);
          else if (m.type === 'restart') session.restart(m.id);
          else if (m.type === 'key') session.requestKeyframe(m.id);
          else if (m.type === 'stop') { await Promise.all(readers.map(r=>r.cancel().catch(()=>{}))); await session.stop(); postMessage({type:'stopped'}); }
          else if (m.type === 'abort') { session?.abort(); await Promise.all(readers.map(r=>r.cancel().catch(()=>{}))); postMessage({type:'aborted'}); }
        } catch(e) { postMessage({type:'error',message:e.message}); }
      };
    `;
    function fail(error) {
      if (closed) return;
      rejectStart?.(error);
      abort();
      options.onError?.(error);
    }
    function abort() {
      closed = true; ready = false;
      rejectStart?.(Error("Saída encerrada"));
      for (const track of videoTracks) track.stop();
      if (worker) {
        try { worker.postMessage({type:'abort'}); abortTimer = setTimeout(() => worker?.terminate(), 1500); }
        catch { worker.terminate(); }
      }
      resolveStop?.();
    }
    return {
      async start() {
        if (closed) throw Error('Saída encerrada');
        const url = URL.createObjectURL(new Blob([script], {type:'text/javascript'}));
        try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
        worker.onerror = e => fail(Error(e.message || 'Falha no processo de vídeo'));
        worker.onmessage = ({data:m}) => {
          if (m.type === 'aborted') { clearTimeout(abortTimer); worker.terminate(); return; }
          if (closed) return;
          if (m.type === 'ready') { ready = true; resolveStart(); }
          else if (m.type === 'chunk') {
            try { received.get(m.id).onChunk(m.bytes); worker.postMessage({type:'ack',bytes:m.bytes.byteLength}); }
            catch(e) { fail(e); }
          } else if (m.type === 'stats') {
            const at = performance.now(), frames = window.andromedaProgramFrames || 0;
            lastStats = { ...m.stats, composedFps: (frames - pgmFrames) * 1000 / Math.max(1, at - pgmAt) };
            pgmAt = at; pgmFrames = frames; options.onStats?.(lastStats);
          }
          else if (m.type === 'error') fail(Error(m.message));
          else if (m.type === 'stopped') abort();
        };
        const started = new Promise((resolve,reject) => {resolveStart=resolve;rejectStart=reject;});
        const audio = new MediaStreamTrackProcessor({track:options.audioTrack}).readable;
        // The browser captures finished canvas frames. The transferable streams let
        // the Worker read them without a full-size VideoFrame copy on the UI thread.
        const videos = outputs.map(o => {
          const track = o.canvas.captureStream(30).getVideoTracks()[0];
          if (!track) throw Error('Captura do PGM indisponível para '+o.id);
          videoTracks.push(track);
          return {id:o.id,readable:new MediaStreamTrackProcessor({track}).readable};
        });
        worker.postMessage({type:'init',audio,videos,outputs:outputs.map(({id,width,height,bitrate})=>({id,width,height,bitrate})),avSyncMs:options.avSyncMs || 0},[audio,...videos.map(v=>v.readable)]);
        const timeout = setTimeout(() => fail(Error('Inicialização da saída excedeu 8 segundos')),8000);
        try { await started; } finally { clearTimeout(timeout); }
        if (closed) return;
      },
      restart(id) { if (ready) worker.postMessage({type:'restart',id}); },
      requestKeyframe(id) { if (ready) worker.postMessage({type:'key',id}); },
      stats() { return lastStats; },
      abort,
      async stop() {
        if (closed) return;
        ready = false; for (const track of videoTracks) track.stop();
        const stopped = new Promise(resolve => {resolveStop=resolve;});
        worker.postMessage({type:'stop'});
        const timeout = setTimeout(abort,3000);
        try { await stopped; } finally {clearTimeout(timeout);}
      }
    };
  }

  // Exercise the same dedicated path before opening the live network/disk sinks.
  // This measures current PGM production, not just encoder configuration support.
  async function qualify({ audioTrack, outputs, avSyncMs = 0, cancelled = () => false, ms = 4200 }) {
    const samples = []; let failure = null, session, track;
    try {
      track = audioTrack.clone();
      session = createDedicated({ audioTrack: track, outputs: outputs.map(o => ({ ...o, onChunk() {} })), avSyncMs,
        onError: e => { failure = e; }, onStats: s => samples.push(s) });
      await session.start();
      const end = performance.now() + ms;
      while (performance.now() < end && !failure && !cancelled()) await new Promise(r => setTimeout(r, 100));
      if (cancelled()) return { ok: false, cancelled: true };
      if (failure) return { ok: false, reason: failure.message, samples };
      const steady = samples.slice(-3), average = key => steady.reduce((sum, s) => sum + (s[key] || 0), 0) / Math.max(1, steady.length);
      const fps = average('fps'), freshFps = average('freshFps'), composedFps = average('composedFps');
      const receivedFps = average('receivedFps'), submittedFps = average('submittedFps');
      return { ok: steady.length === 3 && fps >= 28.5 && freshFps >= 28.5, fps, freshFps, composedFps, receivedFps, submittedFps, samples,
        reason: 'Teste ' + (outputs[0]?.width === 3840 ? '4K30' : '1080p30') + ': composição ' + composedFps.toFixed(1) + ' fps; captura ' + receivedFps.toFixed(1) + ' fps; enviados ao codificador ' + submittedFps.toFixed(1) + ' fps; codificados ' + fps.toFixed(1) + ' fps; PGM novo ' + freshFps.toFixed(1) + ' fps.' };
    } catch (e) { return { ok: false, reason: e.message, samples }; }
    finally { session?.abort(); track?.stop(); }
  }

  return { probe, create, createDedicated, benchmark, qualify, supported: hasApi };
});

