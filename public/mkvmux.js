/*
 * Empacotador Matroska ao vivo do Andrômeda (motor próprio).
 *
 * Recebe pacotes H.264 (formato "avc", com os quadros precedidos pelo tamanho) e Opus já codificados pelo WebCodecs, cada um com o
 * seu instante em milissegundos, e devolve os bytes de um arquivo Matroska que pode ser lido enquanto é escrito: o segmento e os
 * clusters não têm tamanho declarado. O FFmpeg do serviço lê isso sem recodificar o vídeo.
 *
 * Por que um empacotador próprio: o MediaRecorder do navegador só entrega VP8/VP9 em WebM com os instantes que ele quer e sem controle
 * sobre quadro-chave ou taxa. Aqui o instante de cada quadro é o do relógio da mesa (é nele que o sincronismo de som e imagem é aplicado),
 * o quadro-chave é pedido por nós e cada pacote sai no mesmo instante em que fica pronto.
 *
 * Uso (navegador e Node):
 *   const mux = AndromedaMkv.create({ video: { width, height, description }, audio: { channels: 2, sampleRate: 48000, description } });
 *   enviar(mux.header());
 *   enviar(mux.video(bytes, instanteMs, ehQuadroChave));   // devolve um Uint8Array (pode incluir o começo de um cluster novo)
 *   enviar(mux.audio(bytes, instanteMs));
 *   // reinício do codificador: nova instância, ou mux.restart() devolve um cabeçalho novo e exige um quadro-chave a seguir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AndromedaMkv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const enc = new TextEncoder();
  const bytes = v => (v instanceof Uint8Array ? v : new Uint8Array(v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v));
  const concat = parts => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const idBytes = id => { const out = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255); return Uint8Array.from(out); };

  // Tamanho EBML (1 a 8 bytes). Escolhe o menor tamanho que cabe.
  function size(n) {
    if (n < 127) return Uint8Array.of(0x80 | n);
    if (n < 16383) return Uint8Array.of(0x40 | (n >> 8), n & 255);
    if (n < 2097151) return Uint8Array.of(0x20 | (n >> 16), (n >> 8) & 255, n & 255);
    if (n < 268435455) return Uint8Array.of(0x10 | (n >>> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255);
    const out = new Uint8Array(8); out[0] = 0x01; let v = n; for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); } return out;
  }
  const UNKNOWN = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

  const el = (id, ...content) => { const body = concat(content); return concat([idBytes(id), size(body.length), body]); };
  const uint = (id, n) => { const out = []; let v = n; do { out.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return el(id, Uint8Array.from(out)); };
  const str = (id, s) => el(id, enc.encode(s));
  const f64 = (id, n) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return el(id, b); };

  const ID = {
    EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
    TrackEntry: 0xae, Timecode: 0xe7, SimpleBlock: 0xa3,
  };

  // OpusHead (RFC 7845): usado quando o codificador não entrega a descrição.
  function opusHead(channels, sampleRate, preSkip = 312) {
    const b = new Uint8Array(19), dv = new DataView(b.buffer); b.set(enc.encode('OpusHead')); b[8] = 1; b[9] = channels; dv.setUint16(10, preSkip, true); dv.setUint32(12, sampleRate, true); dv.setInt16(16, 0, true); b[18] = 0; return b;
  }

  function create({ video, audio }) {
    if (!video || !video.description) throw Error('O H.264 precisa da descrição (avcC) para entrar no Matroska.');
    const a = audio ? { channels: audio.channels || 2, sampleRate: audio.sampleRate || 48000, description: audio.description ? bytes(audio.description) : opusHead(audio.channels || 2, audio.sampleRate || 48000) } : null;
    const preSkip = a ? new DataView(a.description.buffer, a.description.byteOffset, a.description.byteLength).getUint16(10, true) : 0;
    let cluster = null; // { time } do cluster aberto
    let needKey = true;  // depois do cabeçalho, o vídeo só entra a partir de um quadro-chave
    let started = false;

    function header() {
      started = true; cluster = null; needKey = true;
      const ebml = el(ID.EBML, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'matroska'), uint(0x4287, 4), uint(0x4285, 2));
      const info = el(ID.Info, uint(0x2ad7b1, 1000000), str(0x4d80, 'Andromeda Engine'), str(0x5741, 'Andromeda Engine'));
      const tracks = [el(ID.TrackEntry, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), uint(0x9c, 0), str(0x86, 'V_MPEG4/ISO/AVC'), el(0x63a2, bytes(video.description)),
        el(0xe0, uint(0xb0, video.width), uint(0xba, video.height)))];
      if (a) tracks.push(el(ID.TrackEntry, uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), uint(0x9c, 0), str(0x86, 'A_OPUS'), el(0x63a2, a.description),
        uint(0x56aa, Math.round(preSkip / 48000 * 1e9)), uint(0x56bb, 80000000), el(0xe1, f64(0xb5, a.sampleRate), uint(0x9f, a.channels))));
      return concat([ebml, idBytes(ID.Segment), UNKNOWN, info, el(ID.Tracks, ...tracks)]);
    }

    // Cada quadro-chave abre um cluster novo; um cluster também fecha quando o tempo relativo não cabe mais em 16 bits.
    function block(track, data, ms, key) {
      if (!started) throw Error('Chame header() antes de enviar pacotes.');
      const t = Math.max(0, Math.round(ms)); const parts = [];
      if (track === 1) { if (needKey && !key) return new Uint8Array(0); if (key) needKey = false; }
      if (!cluster || (track === 1 && key) || t - cluster.time > 32000 || t - cluster.time < -32000) {
        // O cluster abre com o tempo mínimo possível: o de um áudio que chegue antes do quadro-chave ainda cabe como tempo negativo.
        cluster = { time: t }; parts.push(idBytes(ID.Cluster), UNKNOWN, uint(ID.Timecode, t));
      }
      const rel = t - cluster.time, payload = bytes(data), head = Uint8Array.of(0x80 | track, (rel >> 8) & 255, rel & 255, key ? 0x80 : 0x00);
      parts.push(idBytes(ID.SimpleBlock), size(head.length + payload.length), head, payload);
      return concat(parts);
    }

    return {
      header,
      video: (data, ms, key) => block(1, data, ms, !!key),
      audio: (data, ms) => (a ? block(2, data, ms, true) : new Uint8Array(0)),
      // Recomeço depois de uma queda do codificador do serviço: cabeçalho novo; o vídeo só volta a partir do próximo quadro-chave.
      restart: header,
      get waitingKey() { return needKey; },
    };
  }

  return { create, opusHead, size, el };
});
