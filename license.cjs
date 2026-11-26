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

// Código deste computador: impressão digital estável da máquina (no Windows, o MachineGuid do sistema), resumida em
// 16 letras/números. A licença emitida para um código só vale naquele computador: copiar o licenca.txt não adianta.
function machineCode({ platform = process.platform, read = file => fs.readFileSync(file, 'utf8'), exec = require('node:child_process').execFileSync } = {}) {
  let raw = '';
  try {
    if (platform === 'win32') raw = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }))?.[1] || '';
    else if (platform === 'darwin') raw = /"IOPlatformUUID" = "([^"]+)"/.exec(exec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 }))?.[1] || '';
    else raw = read('/etc/machine-id').trim();
  } catch { /* sem identificador do sistema */ }
  if (!raw) raw = require('node:os').hostname();
  const hex = crypto.createHash('sha256').update('andromeda-live:' + raw.toLowerCase()).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g).join('-');
}
const normCode = c => String(c || '').toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{4})(?=.)/g, '$1-');

const PLANS = { teste: { name: 'Teste', days: 14 }, mensal: { name: 'Mensal', days: 31 }, anual: { name: 'Anual', days: 366 } };
const DAY = 86400000, GRACE_DAYS = 3;
const b64 = buffer => Buffer.from(buffer).toString('base64url');

function issue(privateKeyPem, { plan, customer, email = '', days, device = '', id = crypto.randomUUID(), now = Date.now() } = {}) {
  if (!PLANS[plan]) throw Error('Plano desconhecido: use ' + Object.keys(PLANS).join(', ') + '.');
  if (!String(customer || '').trim()) throw Error('Informe o nome do cliente.');
  const length = Number(days ?? PLANS[plan].days);
  if (!Number.isFinite(length) || length < 1 || length > 3660) throw Error('Duração inválida.');
  const payload = { v: 1, id, plan, customer: String(customer).trim().slice(0, 120), email: String(email).trim().slice(0, 160), issued: new Date(now).toISOString(), expires: new Date(now + length * DAY).toISOString() };
  if (device) { const d = normCode(device); if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(d)) throw Error('Código do computador inválido (formato XXXX-XXXX-XXXX-XXXX).'); payload.device = d; }
  const body = b64(JSON.stringify(payload));
  return 'ALV1.' + body + '.' + b64(crypto.sign(null, Buffer.from('ALV1.' + body), crypto.createPrivateKey(privateKeyPem)));
}

function verify(publicKeyPem, token, now = Date.now(), device = null) {
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
  if (payload.device) info.device = payload.device;
  if (payload.device && device && normCode(device) !== payload.device) return { valid: false, otherDevice: true, reason: 'Esta licença é de outro computador (código ' + payload.device + '). Peça a licença para este computador: código ' + normCode(device) + '.', ...info };
  if (now > expires + GRACE_DAYS * DAY) return { valid: false, expired: true, reason: 'Assinatura vencida em ' + payload.expires.slice(0, 10) + '. Renove para voltar a transmitir.', ...info };
  return { valid: true, grace: now > expires, warning: now > expires ? 'Assinatura vencida: tolerância de ' + GRACE_DAYS + ' dias em curso.' : daysLeft <= 7 ? 'A assinatura vence em ' + daysLeft + ' dia(s).' : null, ...info };
}

/* Estado da licença neste computador. Sem chave pública, o licenciamento está desligado. */
function createLicense({ publicKeyFile = path.join(__dirname, 'license-public.pem'), tokenFile = process.env.ANDROMEDA_LICENSE_FILE || path.join(__dirname, 'licenca.txt'), clock = Date.now, device = null } = {}) {
  let code = device; const here = () => code || (code = machineCode());
  const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
  const publicKey = () => read(publicKeyFile);
  function status() {
    if (!publicKey()) return { required: false, valid: true, mode: 'testes', device: here(), message: 'Licenciamento desligado (fase de testes).' };
    const token = read(tokenFile);
    if (!token) return { required: true, valid: false, mode: 'pendente', device: here(), message: 'Informe o token de ativação para transmitir. Código deste computador: ' + here() + '.' };
    const result = verify(publicKey(), token, clock(), here());
    return { required: true, mode: result.valid ? 'ativa' : result.expired ? 'vencida' : 'invalida', message: result.valid ? (result.warning || 'Assinatura ativa.') : result.reason, ...result, licensedFor: result.device || null, device: here() };
  }
  function activate(token) {
    if (!publicKey()) throw Error('Este computador ainda não usa licenciamento.');
    const result = verify(publicKey(), token, clock(), here());
    if (!result.valid) throw Error(result.reason);
    fs.writeFileSync(tokenFile, String(token).trim() + '\n');
    return status();
  }
  return { status, activate };
}

module.exports = { PLANS, GRACE_DAYS, issue, verify, createLicense, machineCode };
