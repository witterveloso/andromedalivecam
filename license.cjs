'use strict';
/*
 * Licença por assinatura. O token é um texto assinado (Ed25519):
 *
 *   ALV1.<dados em base64url>.<assinatura em base64url>
 *
 * Só quem tem a chave privada (o vendedor, fora deste repositório) consegue
 * emitir; o programa confere com a chave pública. Sem chave pública instalada
 * o licenciamento fica desligado, que é o modo da fase de testes.
 */
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

const PLANS = { teste: { name: 'Teste', days: 14 }, mensal: { name: 'Mensal', days: 31 }, anual: { name: 'Anual', days: 366 } };
const DAY = 86400000, GRACE_DAYS = 3;
const b64 = buffer => Buffer.from(buffer).toString('base64url');

function issue(privateKeyPem, { plan, customer, email = '', days, id = crypto.randomUUID(), now = Date.now() } = {}) {
  if (!PLANS[plan]) throw Error('Plano desconhecido: use ' + Object.keys(PLANS).join(', ') + '.');
  if (!String(customer || '').trim()) throw Error('Informe o nome do cliente.');
  const length = Number(days ?? PLANS[plan].days);
  if (!Number.isFinite(length) || length < 1 || length > 3660) throw Error('Duração inválida.');
  const payload = { v: 1, id, plan, customer: String(customer).trim().slice(0, 120), email: String(email).trim().slice(0, 160), issued: new Date(now).toISOString(), expires: new Date(now + length * DAY).toISOString() };
  const body = b64(JSON.stringify(payload));
  return 'ALV1.' + body + '.' + b64(crypto.sign(null, Buffer.from('ALV1.' + body), crypto.createPrivateKey(privateKeyPem)));
}

function verify(publicKeyPem, token, now = Date.now()) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'ALV1') return { valid: false, reason: 'Token de ativação em formato inválido.' };
  let payload;
  try {
    if (!crypto.verify(null, Buffer.from('ALV1.' + parts[1]), crypto.createPublicKey(publicKeyPem), Buffer.from(parts[2], 'base64url'))) return { valid: false, reason: 'Token de ativação não reconhecido.' };
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return { valid: false, reason: 'Token de ativação não reconhecido.' }; }
  const expires = Date.parse(payload.expires), daysLeft = Math.ceil((expires - now) / DAY);
  if (!PLANS[payload.plan] || !Number.isFinite(expires)) return { valid: false, reason: 'Token de ativação incompleto.' };
  const info = { id: payload.id, plan: payload.plan, planName: PLANS[payload.plan].name, customer: payload.customer, issued: payload.issued, expires: payload.expires, daysLeft };
  if (now > expires + GRACE_DAYS * DAY) return { valid: false, expired: true, reason: 'Assinatura vencida em ' + payload.expires.slice(0, 10) + '. Renove para voltar a transmitir.', ...info };
  return { valid: true, grace: now > expires, warning: now > expires ? 'Assinatura vencida: tolerância de ' + GRACE_DAYS + ' dias em curso.' : daysLeft <= 7 ? 'A assinatura vence em ' + daysLeft + ' dia(s).' : null, ...info };
}

/* Estado da licença neste computador. Sem chave pública, o licenciamento está desligado. */
function createLicense({ publicKeyFile = path.join(__dirname, 'license-public.pem'), tokenFile = process.env.ANDROMEDA_LICENSE_FILE || path.join(__dirname, 'licenca.txt'), clock = Date.now } = {}) {
  const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
  const publicKey = () => read(publicKeyFile);
  function status() {
    if (!publicKey()) return { required: false, valid: true, mode: 'testes', message: 'Licenciamento desligado (fase de testes).' };
    const token = read(tokenFile);
    if (!token) return { required: true, valid: false, mode: 'pendente', message: 'Informe o token de ativação para transmitir.' };
    const result = verify(publicKey(), token, clock());
    return { required: true, mode: result.valid ? 'ativa' : result.expired ? 'vencida' : 'invalida', message: result.valid ? (result.warning || 'Assinatura ativa.') : result.reason, ...result };
  }
  function activate(token) {
    if (!publicKey()) throw Error('Este computador ainda não usa licenciamento.');
    const result = verify(publicKey(), token, clock());
    if (!result.valid) throw Error(result.reason);
    fs.writeFileSync(tokenFile, String(token).trim() + '\n');
    return status();
  }
  return { status, activate };
}

module.exports = { PLANS, GRACE_DAYS, issue, verify, createLicense };
