'use strict';
/*
 * Modo Rede local: a mesa abre um endereço HTTPS no IP do computador (porta 3443),
 * com certificado próprio gerado na primeira vez. O celular no mesmo Wi-Fi abre
 * https://IP:3443/cam/ sem internet e sem Tailscale. Como o certificado não é de uma
 * autoridade pública, o celular avisa uma vez e o operador confirma.
 */
const fs = require('node:fs'), https = require('node:https'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');

const PORT = Number(process.env.ANDROMEDA_LAN_PORT || 3443);

// Endereços IPv4 da rede local (Wi-Fi e cabo), sem loopback nem faixas de VPN/link-local.
function lanAddresses() {
  const out = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) for (const item of items || []) {
    if (item.family !== 'IPv4' && item.family !== 4) continue;
    if (item.internal || item.address.startsWith('169.254.')) continue;
    const vpn = /tailscale|zerotier|vpn|vethernet|virtualbox|vmware|docker|wsl/i.test(name);
    out.push({ name, address: item.address, vpn });
  }
  return out.sort((a, b) => Number(a.vpn) - Number(b.vpn));
}

async function certificateFor(dataDir, addresses) {
  const file = path.join(dataDir, 'certificado-rede-local.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const x509 = new crypto.X509Certificate(saved.cert);
    const covers = addresses.every(ip => x509.subjectAltName?.includes('IP Address:' + ip));
    if (covers && Date.parse(x509.validTo) - Date.now() > 30 * 86400000) return saved;
  } catch { /* gera um novo */ }
  const selfsigned = require('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...addresses.map(ip => ({ type: 7, ip }))];
  const pem = await selfsigned.generate([{ name: 'commonName', value: 'Andromeda Live (rede local)' }, { name: 'organizationName', value: 'Andromeda Live' }], { keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] });
  const saved = { key: pem.private, cert: pem.cert, fingerprint: pem.fingerprint };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  return saved;
}

// Mesmo atendimento do gateway da câmera (páginas, /signal), servido em HTTPS para a rede.
async function startLan({ hub, dataDir, address, port = PORT, bind = '0.0.0.0' }) {
  const addresses = [...new Set([address, ...lanAddresses().map(a => a.address)].filter(Boolean))];
  const { key, cert, fingerprint } = await certificateFor(dataDir, addresses);
  const server = https.createServer({ key, cert }, (req, res) => hub.gateway.emit('request', req, res));
  server.on('upgrade', (req, socket, head) => hub.gateway.emit('upgrade', req, socket, head));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bind, () => { server.off('error', reject); resolve(); }); });
  const actual = server.address().port, origin = 'https://' + address + ':' + actual;
  hub.configure(origin + '/');
  return { origin, port: actual, fingerprint, close: () => new Promise(r => server.close(() => r())) };
}

module.exports = { lanAddresses, startLan, certificateFor, PORT };
