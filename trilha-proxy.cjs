'use strict';
// TRILHA: tocador de links (rádios na internet, arquivos de áudio em um endereço).
// O navegador só toca áudio de outro site se ele autorizar (CORS); quase nenhuma rádio autoriza. Por isso a mesa pede o áudio
// ao serviço local, que busca o endereço e entrega o fluxo. Só aceita endereços públicos http/https (nada de rede interna
// ou deste computador), só devolve áudio e exige o token da sessão.
const http = require('node:http'), https = require('node:https'), dns = require('node:dns'), net = require('node:net');

const MAX_REDIRECTS = 5, CONNECT_MS = 15000, IDLE_MS = 25000, PLAYLIST_LIMIT = 64 * 1024;

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('ff')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true;
}

// O endereço é conferido na hora de conectar (e não antes), para não cair em troca de DNS.
function safeLookup(allowPrivate) {
  return (host, options, cb) => {
    dns.lookup(host, options, (err, address, family) => {
      if (err) return cb(err, address, family);
      const list = Array.isArray(address) ? address : [{ address, family }];
      if (!allowPrivate && list.some(a => isPrivateAddress(a.address))) return cb(Object.assign(new Error('Endereço não permitido (rede interna).'), { code: 'EPRIVATE' }));
      return Array.isArray(address) ? cb(null, address) : cb(null, address, family);
    });
  };
}

function parseTarget(raw) {
  let url; try { url = new URL(String(raw || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url;
}

function open(url, { range, allowPrivate, hops = 0, agent = 'AndromedaLive' } = {}) {
  return new Promise((resolve, reject) => {
    // Endereço IP escrito direto no link não passa pelo DNS (o lookup não é chamado): conferir aqui.
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(literal) && isPrivateAddress(literal)) { reject(Object.assign(new Error('Endereço não permitido (rede interna).'), { code: 'EPRIVATE' })); return; }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', lookup: safeLookup(allowPrivate), timeout: CONNECT_MS, headers: { 'User-Agent': agent, Accept: 'audio/*,*/*;q=0.5', 'Icy-MetaData': '0', ...(range ? { Range: range } : {}) } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); if (hops >= MAX_REDIRECTS) return reject(Object.assign(new Error('Redirecionamentos demais.'), { status: 508 }));
        const next = parseTarget(new URL(res.headers.location, url).href); if (!next) return reject(Object.assign(new Error('Endereço não permitido.'), { status: 400 }));
        return open(next, { range, allowPrivate, hops: hops + 1, agent }).then(resolve, reject);
      }
      resolve({ res, req, url });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('A rádio não respondeu.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject); req.end();
  });
}

// .pls / .m3u: lista com o endereço verdadeiro do fluxo. Pega o primeiro endereço http(s).
function firstStream(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:File\d*=)?\s*(https?:\/\/\S+)/i); if (m) return m[1];
  }
  return null;
}
async function readSmall(res) {
  let size = 0; const chunks = [];
  for await (const c of res) { size += c.length; if (size > PLAYLIST_LIMIT) { res.destroy(); return ''; } chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const isAudioType = t => /^(audio\/|application\/ogg|application\/octet-stream|video\/(mp4|webm|ogg))/i.test(t || '');
const isListType = t => /mpegurl|scpls|x-pls/i.test(t || '');

function createAudioProxy({ allowPrivate = process.env.ANDROMEDA_PROXY_ALLOW_PRIVATE === '1', agent } = {}) {
  // Entrega o áudio do endereço `raw` em `res`. Erros viram JSON com mensagem clara (a mesa mostra ao operador).
  async function stream(req, res, raw) {
    const fail = (status, message, code = 'failed') => { if (res.headersSent) { res.destroy(); return; } res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: message, code })); };
    let url = parseTarget(raw); if (!url) { fail(400, 'Endereço inválido. Use um link http:// ou https://.', 'bad-url'); return; }
    let up;
    try {
      up = await open(url, { range: req.headers.range, allowPrivate, agent });
      const lower = url.pathname.toLowerCase();
      if (isListType(up.res.headers['content-type']) || /\.(pls|m3u)$/.test(lower)) { // lista de reprodução: segue para o primeiro fluxo
        if (/\.m3u8$/.test(lower) || /mpegurl/i.test(up.res.headers['content-type'] || '') && /\.m3u8/.test(lower)) { up.res.resume(); fail(415, 'Este link é uma transmissão HLS (.m3u8), que a mesa não toca. Procure o link MP3/AAC da rádio.', 'hls'); return; }
        const target = firstStream(await readSmall(up.res)); up.req.destroy();
        if (!target) { fail(422, 'A lista de reprodução não tem nenhum endereço de áudio.', 'empty-list'); return; }
        url = parseTarget(target); if (!url) { fail(400, 'Endereço inválido na lista de reprodução.', 'bad-url'); return; }
        up = await open(url, { range: req.headers.range, allowPrivate, agent });
      }
    } catch (e) {
      if (e.code === 'EPRIVATE') fail(400, 'Endereço não permitido: só links públicos da internet.', 'private');
      else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') fail(502, 'Não foi possível encontrar este endereço. Confira o link e a internet.', 'dns');
      else fail(e.status || 502, e.message || 'Não foi possível abrir o link.', 'upstream');
      return;
    }
    const { res: r } = up, type = String(r.headers['content-type'] || '');
    if (r.statusCode >= 400) { r.resume(); fail(r.statusCode === 404 ? 404 : 502, 'O endereço respondeu com erro ' + r.statusCode + '.', 'upstream'); return; }
    if (!isAudioType(type)) { r.resume(); up.req.destroy(); fail(415, 'O link não é de áudio (' + (type.split(';')[0] || 'tipo desconhecido') + ').', 'not-audio'); return; }
    const headers = { 'Content-Type': /octet-stream/i.test(type) ? 'audio/mpeg' : type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    for (const h of ['content-length', 'content-range', 'accept-ranges']) if (r.headers[h]) headers[h] = r.headers[h];
    res.writeHead(r.statusCode === 206 ? 206 : 200, headers);
    r.setTimeout(IDLE_MS, () => r.destroy()); r.pipe(res);
    const stop = () => { try { r.destroy(); up.req.destroy(); } catch { /* já encerrado */ } };
    res.on('close', stop); r.on('error', () => res.destroy());
  }
  return { stream };
}

module.exports = { createAudioProxy, isPrivateAddress, firstStream, parseTarget };
