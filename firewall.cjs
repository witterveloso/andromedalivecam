'use strict';
/*
 * Firewall do Windows: em cada computador novo, a primeira vez que o Andrômeda Live recebe conexões o Windows pergunta
 * "Permitir?". Se a resposta foi "Cancelar", ou se só "redes privadas" ficou marcado e a rede atual é "Pública" (o
 * padrão para cabo e Wi-Fi novos), o Windows cria uma regra de BLOQUEIO e as câmeras não chegam à mesa — sem erro visível.
 *
 * check(): lê as regras de entrada do próprio programa e a categoria da rede atual (sem pedir administrador).
 * fix():   com UM pedido de administrador (aviso do Windows), remove os bloqueios do programa e cria uma regra que
 *          permite entrada em qualquer rede (privada, pública, domínio). Só para o executável do Andrômeda Live.
 */
const { execFile } = require('node:child_process');

const q = s => "'" + String(s).replace(/'/g, "''") + "'"; // texto entre aspas simples do PowerShell
const RULE = 'Andromeda Live (cameras)';

function powershell(script, timeout = 20000) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout },
      (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
  });
}

// Categoria da rede (Public/Private/DomainAuthenticated) → nome do perfil de firewall (Public/Private/Domain).
const profileOf = category => /domain/i.test(category) ? 'Domain' : /private/i.test(category) ? 'Private' : 'Public';
const covers = (ruleProfile, profile) => /any/i.test(ruleProfile) || String(ruleProfile).split(/\s*,\s*/).some(p => p.toLowerCase() === profile.toLowerCase());

// Decide, a partir das regras do programa e da rede atual, se a entrada está liberada. Bloqueio vence permissão no Windows.
function evaluate({ rules = [], category = '', name = '' } = {}) {
  const profile = profileOf(category);
  const relevant = rules.filter(r => covers(r.profile, profile));
  const blocked = relevant.some(r => /block/i.test(r.action)), allowed = !blocked && relevant.some(r => /allow/i.test(r.action));
  return { supported: true, network: name, category: category || 'Desconhecida', profile, allowed, blocked, rules: rules.length,
    message: allowed ? 'Firewall do Windows: Andrômeda Live liberado nesta rede (' + (name || 'rede atual') + ', ' + profileLabel(profile) + ').'
      : blocked ? 'O firewall do Windows está BLOQUEANDO o Andrômeda Live nesta rede (' + (name || 'rede atual') + ', ' + profileLabel(profile) + '): as câmeras não chegam à mesa.'
        : 'O firewall do Windows ainda não liberou o Andrômeda Live nesta rede (' + (name || 'rede atual') + ', ' + profileLabel(profile) + '). Libere para as câmeras chegarem à mesa.' };
}
const profileLabel = p => ({ Public: 'pública', Private: 'privada', Domain: 'domínio' })[p] || p;

let cache = null;
async function check({ exe = process.execPath, maxAgeMs = 30000, run = powershell } = {}) {
  if (process.platform !== 'win32' && run === powershell) return { supported: false };
  if (cache && Date.now() - cache.at < maxAgeMs && cache.exe === exe) return cache.value;
  const script = '$exe = ' + q(exe) + "; $r = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } | ForEach-Object { @{ action = [string]$_.Action; profile = [string]$_.Profile } }); " +
    '$p = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Sort-Object { $_.IPv4Connectivity -ne \'Internet\' } | Select-Object -First 1; ' +
    '[pscustomobject]@{ rules = $r; category = [string]$p.NetworkCategory; name = [string]$p.Name } | ConvertTo-Json -Depth 4 -Compress';
  const r = await run(script);
  let value;
  try { const data = JSON.parse(r.out.trim()); value = evaluate({ rules: [].concat(data.rules || []).filter(Boolean), category: data.category, name: data.name }); }
  catch { value = { supported: true, unknown: true, allowed: null, blocked: null, message: 'Não foi possível ler o firewall do Windows' + (r.err ? ': ' + r.err.split('\n')[0].slice(0, 140) : '.') }; }
  cache = { at: Date.now(), exe, value };
  return value;
}

// Um pedido de administrador (aviso do Windows): tira os bloqueios do programa e libera a entrada em qualquer rede.
async function fix({ exe = process.execPath, run = powershell } = {}) {
  if (process.platform !== 'win32' && run === powershell) return { ok: false, error: 'Só no Windows.' };
  const inner = '$exe = ' + q(exe) + '; ' +
    "Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue; " +
    'Remove-NetFirewallRule -DisplayName ' + q(RULE) + ' -ErrorAction SilentlyContinue; ' +
    'New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Description ' + q('Cameras do Andromeda Cam chegando a mesa (Wi-Fi, cabo, 4G/5G).') + ' -Direction Inbound -Program $exe -Action Allow -Profile Any | Out-Null';
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const r = await run("try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + encoded + "'; exit $p.ExitCode } catch { Write-Error $_; exit 5 }", 120000);
  cache = null;
  if (!r.ok) return { ok: false, error: /cancel|operation was canceled|cancelada|1223/i.test(r.err) ? 'O pedido de administrador foi recusado. Clique de novo e confirme no aviso do Windows.' : 'Não foi possível liberar o firewall: ' + r.err.split('\n')[0].slice(0, 160) };
  const after = await check({ exe, maxAgeMs: 0, run });
  return { ok: !!after.allowed, status: after, error: after.allowed ? '' : 'O firewall continua bloqueando. Confira se outro antivírus/firewall está ativo.' };
}

module.exports = { check, fix, evaluate, profileOf, _internal: { q, RULE, powershell } };
