'use strict';
// Leitor mínimo de Matroska (só para o teste): devolve as faixas e os pacotes de um arquivo gerado pelo FFmpeg.
function readMkv(buf) {
  const out = { tracks: {}, packets: [] }; let pos = 0;
  const vint = (keepMarker = false) => { const first = buf[pos]; let len = 1; while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++; let v = keepMarker ? first : first & (0xff >> len); for (let i = 1; i < len; i++) v = v * 256 + buf[pos + i]; const unknown = !keepMarker && v === Math.pow(2, 7 * len) - 1; pos += len; return { v, len, unknown }; };
  const MASTER = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0, 0xe0, 0xe1]);
  function walk(end, ctx) {
    while (pos < end) {
      const id = vint(true).v, s = vint(), body = s.unknown ? end : pos + s.v;
      if (MASTER.has(id)) {
        const t = id === 0xae ? { number: 0 } : null; if (t) ctx.track = t;
        if (id === 0x1f43b675) ctx.clusterTime = 0;
        walk(Math.min(body, end), ctx); if (t) out.tracks[t.number] = t; pos = Math.min(body, end);
      } else {
        if (id === 0xd7) ctx.track.number = buf[pos]; else if (id === 0x86) ctx.track.codec = buf.toString('latin1', pos, body); else if (id === 0x63a2) ctx.track.private = buf.subarray(pos, body);
        else if (id === 0xb0) ctx.track.width = buf.readUIntBE(pos, body - pos); else if (id === 0xba) ctx.track.height = buf.readUIntBE(pos, body - pos);
        else if (id === 0xe7) ctx.clusterTime = buf.readUIntBE(pos, body - pos);
        else if (id === 0xa3 || id === 0xa1) { const p = pos; const tn = buf[p] & 0x7f, rel = buf.readInt16BE(p + 1), flags = buf[p + 3]; out.packets.push({ track: tn, ms: ctx.clusterTime + rel, key: !!(flags & 0x80), data: buf.subarray(p + 4, body) }); }
        pos = body;
      }
    }
  }
  walk(buf.length, {}); return out;
}

module.exports = { readMkv };
