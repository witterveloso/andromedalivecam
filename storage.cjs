'use strict';
/*
 * Armazenamento da gravação: unidades disponíveis (disco interno, HD/SSD externo,
 * pendrive), espaço livre e teste de escrita na pasta escolhida.
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process');
const run = (file, args, timeout) => new Promise(resolve => execFile(file, args, { encoding: 'utf8', timeout, windowsHide: true }, (error, stdout) => resolve(error ? '' : stdout)));

const defaultDir = () => path.join(os.homedir(), 'Videos', 'Andromeda Live');

function space(dir) {
  try { const s = fs.statfsSync(dir); return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; }
  catch { return { free: null, total: null }; }
}

async function windowsVolumes() {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,FreeSpace,Size | ConvertTo-Json -Compress'], 8000);
  if (!out.trim()) return [];
  const system = (process.env.SystemDrive || 'C:').toUpperCase();
  return [].concat(JSON.parse(out)).filter(d => [2, 3].includes(d.DriveType) && d.Size).map(d => ({
    path: d.DeviceID + '\\', label: d.VolumeName || 'Unidade ' + d.DeviceID,
    kind: d.DriveType === 2 ? 'removable' : d.DeviceID.toUpperCase() === system ? 'system' : 'disk',
    free: Number(d.FreeSpace), total: Number(d.Size),
  }));
}

async function unixVolumes() {
  const out = await run('df', ['-kP'], 5000);
  const volumes = [];
  for (const line of out.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/); if (parts.length < 6) continue;
    const mount = parts.slice(5).join(' '), external = /^\/(media|mnt|Volumes|run\/media)\//.test(mount);
    if (mount !== '/' && !external) continue;
    if (/^(tmpfs|devtmpfs|overlay|map)/.test(parts[0]) && mount !== '/') continue;
    try { fs.accessSync(mount, fs.constants.W_OK); } catch { continue; } // só unidades em que dá para gravar
    volumes.push({ path: mount, label: mount === '/' ? 'Disco do sistema' : path.basename(mount), kind: external ? 'removable' : 'system', free: Number(parts[3]) * 1024, total: Number(parts[1]) * 1024 });
  }
  return volumes;
}

async function listVolumes() {
  try { return await (process.platform === 'win32' ? windowsVolumes() : unixVolumes()); } catch { return []; }
}

// Cria a pasta se preciso e confirma, escrevendo um arquivo de teste, que dá para gravar nela.
function checkDir(input) {
  const dir = String(input || '').trim();
  if (!dir || !path.isAbsolute(dir)) throw Error('Informe o caminho completo da pasta de gravação.');
  if (/[|\r\n]/.test(dir)) throw Error('A pasta de gravação contém caracteres não aceitos.');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { throw Error('Não foi possível criar a pasta. Confira se a unidade está conectada.'); }
  const probe = path.join(dir, '.andromeda-teste-' + process.pid);
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe); } catch { throw Error('Sem permissão de escrita nesta pasta.'); }
  return { dir, ...space(dir) };
}

// GB por hora de gravação para um bitrate de vídeo (Mbps) mais 128 kb/s de áudio.
const gbPerHour = bitrate => (Number(bitrate) * 1000 + 128) * 3600 / 8 / 1e6;

module.exports = { defaultDir, listVolumes, checkDir, space, gbPerHour };
