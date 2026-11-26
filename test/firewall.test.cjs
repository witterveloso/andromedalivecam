'use strict';
// Firewall do Windows: a mesa reconhece quando ele bloqueia as câmeras e libera com um pedido de administrador.
const { test } = require('node:test'), assert = require('node:assert/strict');
const firewall = require('../firewall.cjs');

test('firewall: bloqueio vence permissão; rede pública sem regra para pública = não liberado; "Any" libera tudo', () => {
  // O caso do computador novo: "Permitir" só em redes privadas e o cabo entrou como rede Pública.
  let st = firewall.evaluate({ category: 'Public', name: 'Rede 2', rules: [{ action: 'Allow', profile: 'Private' }, { action: 'Block', profile: 'Public' }] });
  assert.equal(st.allowed, false); assert.equal(st.blocked, true); assert.match(st.message, /BLOQUEANDO/); assert.match(st.message, /pública/);
  st = firewall.evaluate({ category: 'Private', name: 'Casa', rules: [{ action: 'Allow', profile: 'Private' }, { action: 'Block', profile: 'Public' }] });
  assert.equal(st.allowed, true, 'na rede privada o mesmo computador está liberado');
  st = firewall.evaluate({ category: 'Public', rules: [] }); assert.equal(st.allowed, false); assert.equal(st.blocked, false, 'sem regra: ainda não liberado (o Windows vai perguntar)');
  st = firewall.evaluate({ category: 'DomainAuthenticated', rules: [{ action: 'Allow', profile: 'Any' }] }); assert.equal(st.profile, 'Domain'); assert.equal(st.allowed, true);
  st = firewall.evaluate({ category: 'Public', rules: [{ action: 'Allow', profile: 'Domain, Private, Public' }] }); assert.equal(st.allowed, true);
});

test('firewall: liberar pede administrador uma vez, remove só os bloqueios do próprio programa e cria a regra para qualquer rede', async () => {
  const scripts = []; const run = async script => { scripts.push(script); return scripts.length === 1 ? { ok: true, out: '', err: '' } : { ok: true, out: JSON.stringify({ rules: [{ action: 'Allow', profile: 'Any' }], category: 'Public', name: 'Rede 2' }), err: '' }; };
  const r = await firewall.fix({ exe: "C:\\Program Files\\Andromeda Live\\Andromeda Live.exe", run });
  assert.equal(r.ok, true); assert.match(scripts[0], /-Verb RunAs/); const inner = Buffer.from(/-EncodedCommand','([^']+)'/.exec(scripts[0])[1], 'base64').toString('utf16le');
  assert.match(inner, /Action -eq 'Block' \} \| Remove-NetFirewallRule/); assert.match(inner, /-Program \$exe -Action Allow -Profile Any/); assert.match(inner, /\$exe = 'C:\\Program Files\\Andromeda Live\\Andromeda Live\.exe'/);
  const refused = await firewall.fix({ exe: 'x.exe', run: async () => ({ ok: false, out: '', err: 'The operation was canceled by the user.' }) });
  assert.equal(refused.ok, false); assert.match(refused.error, /recusado/);
});

test('firewall: no Windows de verdade a leitura funciona sem administrador (regras do programa e categoria da rede)', { skip: process.platform !== 'win32' && 'só no Windows' }, async () => {
  const st = await firewall.check({ maxAgeMs: 0 });
  assert.equal(st.supported, true); assert.notEqual(st.unknown, true, st.message); assert.match(st.profile, /Public|Private|Domain/); assert.equal(typeof st.allowed, 'boolean');
});
