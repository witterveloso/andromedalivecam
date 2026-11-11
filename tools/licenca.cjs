#!/usr/bin/env node
'use strict';
/*
 * Ferramenta do vendedor: cria o par de chaves e emite tokens de ativação.
 *
 *   node tools/licenca.cjs chaves
 *   node tools/licenca.cjs emitir --plano anual --cliente "Nome do cliente" [--email a@b.c] [--dias 366]
 *   node tools/licenca.cjs conferir <token>
 *
 * A chave privada (licenca-privada.pem) fica só com o vendedor: nunca vai para o
 * GitHub nem para o computador do cliente. A pública (license-public.pem) segue
 * com o programa e é o que liga a exigência de licença.
 */
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { issue, verify, PLANS } = require('../license.cjs');

const root = path.join(__dirname, '..');
const privateFile = process.env.ANDROMEDA_PRIVATE_KEY || path.join(root, 'licenca-privada.pem');
const publicFile = path.join(root, 'license-public.pem');
const [command, ...rest] = process.argv.slice(2);
const option = name => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : undefined; };
const stop = message => { console.error(message); process.exit(1); };

if (command === 'chaves') {
  if (fs.existsSync(privateFile)) stop('Já existe ' + privateFile + '. Apagar essa chave invalida todos os tokens já vendidos.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Chave privada: ' + privateFile + '  (guarde em local seguro, com cópia; não envie a ninguém)');
  console.log('Chave pública: ' + publicFile + '  (distribua junto com o programa)');
} else if (command === 'emitir') {
  if (!fs.existsSync(privateFile)) stop('Chave privada não encontrada. Rode primeiro: node tools/licenca.cjs chaves');
  try {
    const token = issue(fs.readFileSync(privateFile, 'utf8'), { plan: option('plano'), customer: option('cliente'), email: option('email'), days: option('dias') });
    const info = verify(fs.readFileSync(publicFile, 'utf8'), token);
    console.error('Plano ' + info.planName + ' · ' + info.customer + ' · vence em ' + info.expires.slice(0, 10));
    console.log(token);
  } catch (e) { stop(e.message + '\nPlanos: ' + Object.entries(PLANS).map(([id, p]) => id + ' (' + p.days + ' dias)').join(', ')); }
} else if (command === 'conferir') {
  if (!fs.existsSync(publicFile)) stop('Chave pública não encontrada.');
  console.log(JSON.stringify(verify(fs.readFileSync(publicFile, 'utf8'), rest[0]), null, 2));
} else stop('Uso:\n  node tools/licenca.cjs chaves\n  node tools/licenca.cjs emitir --plano mensal|anual|teste --cliente "Nome" [--email a@b.c] [--dias N]\n  node tools/licenca.cjs conferir <token>');
