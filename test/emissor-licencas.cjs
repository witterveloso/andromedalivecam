'use strict';
// O emissor de licenças (página offline do vendedor) gera chaves e licenças que o programa aceita: mesmo formato e assinatura.
// Roda num Chromium (Playwright); sem Playwright instalado, o teste é pulado.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { verify, createLicense } = require('../license.cjs');
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: Playwright ausente'); process.exit(0); }
(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'tools', 'emissor-licencas.html'));
  const dl = page.waitForEvent('download'); await page.click('#makeKeys'); const priv = await (await dl).path();
  const privPem = fs.readFileSync(priv, 'utf8'), pubPem = await page.inputValue('#pubPem');
  assert.match(privPem, /^-----BEGIN PRIVATE KEY-----/); assert.match(pubPem, /^-----BEGIN PUBLIC KEY-----/);
  await page.fill('#customer', 'Igreja Exemplo'); await page.selectOption('#plan', 'mensal'); await page.fill('#device', 'ab12cd34ef56a7b8');
  await page.click('#emit'); const token = await page.inputValue('#token');
  assert.match(await page.textContent('#emitMsg'), /Licença emitida para Igreja Exemplo/);
  const r = verify(pubPem, token, Date.now(), 'AB12-CD34-EF56-A7B8');
  assert(r.valid && r.plan === 'mensal' && r.customer === 'Igreja Exemplo' && r.device === 'AB12-CD34-EF56-A7B8' && r.daysLeft === 31, JSON.stringify(r));
  assert(!verify(pubPem, token, Date.now(), 'FFFF-FFFF-FFFF-FFFF').valid, 'outro computador é recusado');
  // O programa instalado ativa a licença (arquivo de chave pública + licença na pasta de dados do usuário).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-emissor-')); fs.writeFileSync(path.join(dir, 'license-public.pem'), pubPem);
  const lic = createLicense({ publicKeyFile: path.join(dir, 'license-public.pem'), tokenFile: path.join(dir, 'licenca.txt'), device: 'AB12-CD34-EF56-A7B8' });
  assert.equal(lic.status().mode, 'pendente'); assert.equal(lic.activate(token).mode, 'ativa');
  // Sem chave carregada / dados errados: mensagens claras, nada emitido.
  await page.reload(); await page.fill('#customer', 'X'); await page.fill('#device', '1234'); await page.click('#emit'); assert.match(await page.textContent('#emitMsg'), /licenca-privada\.pem/);
  assert.deepEqual(errors, []);
  fs.rmSync(dir, { recursive: true, force: true }); await browser.close();
  console.log('PASS: emissor de licenças offline: chaves Ed25519, licença por computador aceita pelo programa');
})().catch(e => { console.error(e); process.exit(1); });
