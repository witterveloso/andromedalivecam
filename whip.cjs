'use strict';
/*
 * WHIP (WebRTC-HTTP Ingestion Protocol): destino de atraso mínimo (abaixo de 1 s).
 *
 * A imagem vai direto da mesa por WebRTC (o navegador da mesa já tem WebRTC); o serviço só faz a apresentação HTTP com o
 * servidor WHIP, porque o navegador não pode falar com qualquer endereço (CORS) e o token não precisa ficar exposto em
 * cabeçalhos da página. Fluxo (RFC 9725):
 *   mesa → POST /api/whip/offer {url, token, sdp}  → serviço → POST url (application/sdp, Authorization: Bearer token)
 *   servidor → 201 + resposta SDP + Location (o recurso da sessão)  → mesa
 *   fim: mesa → POST /api/whip/stop {location, token} → serviço → DELETE location
 */
const net = require('node:net');

const MAX_SDP = 64 * 1024;
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

// Endereços aceitos: HTTPS em qualquer servidor; HTTP só na própria máquina ou na rede local (servidores como MediaMTX no estúdio).
function localHost(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (net.isIPv4(h)) { const [a, b] = h.split('.').map(Number); return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254); }
  if (net.isIPv6(h)) return h === '::1' || /^f[cd]/i.test(h) || /^fe80/i.test(h);
  return false;
}
function checkUrl(value) {
  let u; try { u = new URL(String(value || '').trim()); } catch { throw Error('Informe o endereço WHIP completo (https://…).'); }
  if (u.username || u.password) throw Error('O endereço WHIP não pode ter usuário e senha. Use o campo Token.');
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && localHost(u.hostname)) return u;
  throw Error(u.protocol === 'http:' ? 'Use https:// (http:// só para servidores nesta máquina ou na rede local).' : 'O endereço WHIP começa com https://.');
}
const auth = token => {
  const t = String(token || '').trim().replace(/^Bearer\s+/i, '');
  if (!t) return {};
  if (!TOKEN.test(t)) throw Error('Token WHIP inválido (sem espaços nem quebras de linha).');
  return { Authorization: 'Bearer ' + t };
};
function failure(status) {
  if (status === 401 || status === 403) return 'O servidor WHIP recusou o token (' + status + '). Confira o token.';
  if (status === 404) return 'Endereço WHIP não encontrado (404). Confira a URL.';
  if (status === 405 || status === 415) return 'Este endereço não aceita WHIP (' + status + '). Confira se é a URL de ingestão WHIP.';
  if (status === 409 || status === 429 || status === 503) return 'O servidor WHIP está ocupado ou já tem uma transmissão nesta chave (' + status + '). Tente de novo em instantes.';
  return 'O servidor WHIP respondeu ' + status + '.';
}

async function offer({ url, token, sdp }, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const u = checkUrl(url), headers = { 'Content-Type': 'application/sdp', Accept: 'application/sdp', ...auth(token) };
  const body = String(sdp || '');
  if (!/^v=0\r?\n/.test(body) || body.length > MAX_SDP) throw Error('Oferta WebRTC inválida.');
  let res;
  try { res = await fetchImpl(u.toString(), { method: 'POST', headers, body, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw Error(e.name === 'TimeoutError' ? 'O servidor WHIP não respondeu em ' + timeoutMs / 1000 + ' s.' : 'Sem conexão com o servidor WHIP (' + (e.cause?.code || e.message) + ').'); }
  if (res.status !== 201 && res.status !== 200) throw Error(failure(res.status));
  const answer = await res.text();
  if (!/^v=0\r?\n/.test(answer) || answer.length > MAX_SDP) throw Error('O servidor WHIP não devolveu uma resposta WebRTC válida.');
  const loc = res.headers.get('location');
  let location = null;
  if (loc) { try { location = checkUrl(new URL(loc, res.url || u).toString()).toString(); } catch { location = null; } }
  return { sdp: answer, location };
}

// Encerra a sessão no servidor (DELETE no recurso). Falhas são ignoradas: a conexão WebRTC já foi fechada pela mesa.
async function stop({ location, token }, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!location) return { ok: true };
  try { const u = checkUrl(location); const res = await fetchImpl(u.toString(), { method: 'DELETE', headers: auth(token), signal: AbortSignal.timeout(timeoutMs) }); return { ok: res.ok, status: res.status }; }
  catch { return { ok: false }; }
}

module.exports = { offer, stop, checkUrl, localHost };
