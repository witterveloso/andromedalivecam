'use strict';
/*
 * Codificação do PROGRAM: uma única codificação H.264 + AAC alimenta todos os
 * destinos RTMP e, se pedido, o arquivo de gravação (muxer tee do FFmpeg).
 * Cada destino passa por uma fila própria (muxer fifo) que reconecta sozinha,
 * então a queda de uma plataforma não interrompe as outras nem a gravação.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PLATFORMS = {
  youtube:   { name: 'YouTube',      example: 'rtmps://a.rtmps.youtube.com:443/live2',      hosts: /^[ab]\.rtmps?\.youtube\.com$/, strict: true },
  facebook:  { name: 'Facebook',     example: 'rtmps://live-api-s.facebook.com:443/rtmp/',   hosts: /(^|\.)(facebook\.com|fbcdn\.net)$/ },
  instagram: { name: 'Instagram',    example: 'rtmps://live-upload.instagram.com:443/rtmp/', hosts: /(^|\.)(instagram\.com|fbcdn\.net)$/ },
  twitch:    { name: 'Twitch',       example: 'rtmps://live.twitch.tv/app',                  hosts: /(^|\.)(twitch\.tv|live-video\.net)$/ },
  kick:      { name: 'Kick',         example: 'rtmps://…global-contribute.live-video.net/app', hosts: /(^|\.)(kick\.com|live-video\.net)$/ },
  tiktok:    { name: 'TikTok',       example: 'rtmp://push-rtmp-….tiktokcdn.com/…',          hosts: /tiktok/ },
  linkedin:  { name: 'LinkedIn',     example: 'rtmps://….linkedin.com:443/live',             hosts: /(^|\.)(linkedin\.com|licdn\.com|live-video\.net|azure\.net|media\.azure\.net)$/ },
  custom:    { name: 'RTMP próprio', example: 'rtmp://servidor/app',                         hosts: null },
};
const MAX_DESTINATIONS = 6;
const KEY = /^[A-Za-z0-9_\-.~?=&%+]{4,512}$/;

function fail(message) { throw Error(message); }

function validateDestination(input, index) {
  const platform = PLATFORMS[input?.platform] ? input.platform : 'custom', rule = PLATFORMS[platform];
  const label = String(input?.name || rule.name).slice(0, 40);
  let u;
  try { u = new URL(String(input?.server || '').trim()); } catch { fail('Destino ' + label + ': informe a URL do servidor (rtmp:// ou rtmps://).'); }
  if (!['rtmp:', 'rtmps:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash) fail('Destino ' + label + ': use somente a URL do servidor, começando com rtmp:// ou rtmps://, sem chave nem parâmetros.');
  if (/[|'\[\]\\\s]/.test(u.pathname)) fail('Destino ' + label + ': a URL do servidor contém caracteres não aceitos.');
  if (rule.strict && (!rule.hosts.test(u.hostname) || !/^\/live2\/?$/.test(u.pathname) || (u.port && !['443', '1935'].includes(u.port)))) fail('Use a URL RTMP/RTMPS principal fornecida pelo YouTube Studio, terminando em /live2.');
  const key = String(input?.key || '').trim();
  if (!KEY.test(key)) fail('Destino ' + label + ': informe apenas a chave de transmissão, sem espaços nem a URL.');
  const warning = rule.hosts && !rule.hosts.test(u.hostname) ? 'O servidor de ' + label + ' não parece ser de ' + rule.name + '. Confira a URL copiada da plataforma.' : null;
  return { id: String(input?.id ?? index).slice(0, 40), platform, name: label, target: u.toString().replace(/\/$/, '') + '/' + key, warning };
}

function validateBroadcast(input) {
  if (!input || typeof input !== 'object') fail('Configuração ausente.');
  const list = Array.isArray(input.destinations) ? input.destinations : [];
  if (list.length > MAX_DESTINATIONS) fail('Use no máximo ' + MAX_DESTINATIONS + ' destinos simultâneos.');
  const destinations = list.map(validateDestination);
  if (new Set(destinations.map(d => d.target)).size !== destinations.length) fail('Há dois destinos com o mesmo servidor e a mesma chave.');
  const record = input.record ? validateRecording(input.record) : null;
  if (!destinations.length && !record) fail('Ative pelo menos um destino ou a gravação.');
  const resolution = input.resolution; if (!['720p', '1080p'].includes(resolution)) fail('Esta versão transmite em 720p ou 1080p.');
  const bitrate = Number(input.bitrate); if (!Number.isFinite(bitrate) || bitrate < 3 || bitrate > 20) fail('Bitrate deve ficar entre 3 e 20 Mbps.');
  const encoder = ENCODERS[input.encoder] ? input.encoder : 'libx264';
  return { destinations, record, resolution, bitrate, fps: 30, encoder };
}

function validateRecording(input) {
  const dir = String(input.dir || '').trim();
  if (!dir || !path.isAbsolute(dir)) fail('Escolha a pasta de gravação.');
  if (/[|\r\n]/.test(dir)) fail('A pasta de gravação contém caracteres não aceitos.');
  // Nome com a data e a hora locais do computador, que é como o operador procura o arquivo.
  const now = new Date(), two = n => String(n).padStart(2, '0');
  const stamp = now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate()) + '-' + two(now.getHours()) + '-' + two(now.getMinutes()) + '-' + two(now.getSeconds());
  return { dir, file: path.join(dir, 'Andromeda_' + stamp + '.mkv') };
}

/* Compatibilidade: destino único do YouTube (formato da 0.3 em diante). */
function validateConfig(input) {
  if (!input || typeof input !== 'object') fail('Configuração ausente.');
  try { new URL(input.server); } catch { fail('Informe a URL do servidor do YouTube.'); }
  const key = String(input.key || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,256}$/.test(key)) fail('Informe apenas a chave de stream do YouTube, sem espaços ou URL.');
  const cfg = validateBroadcast({ destinations: [{ platform: 'youtube', server: input.server, key }], resolution: input.resolution, bitrate: input.bitrate });
  return { ...cfg, target: cfg.destinations[0].target };
}

/* ---------- argumentos do FFmpeg ---------- */

// Codificadores por GPU são opcionais: só entram se o teste de um quadro passar nesta máquina.
const ENCODERS = {
  libx264: kb => ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high', '-b:v', kb + 'k', '-minrate', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-x264-params', 'nal-hrd=cbr:force-cfr=1'],
  h264_nvenc: kb => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-profile:v', 'high', '-rc', 'cbr', '-b:v', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-bf', '0'],
  h264_qsv: kb => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-profile:v', 'high', '-b:v', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-bf', '0'],
  h264_amf: kb => ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-profile:v', 'high', '-rc', 'cbr', '-b:v', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-bf', '0'],
  h264_videotoolbox: kb => ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-profile:v', 'high', '-b:v', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-bf', '0'],
};
const detected = new Map();
function detectEncoders(ffmpeg) {
  if (!ffmpeg) return ['libx264'];
  if (detected.has(ffmpeg)) return detected.get(ffmpeg);
  const list = ['libx264'];
  for (const name of Object.keys(ENCODERS)) {
    if (name === 'libx264') continue;
    const probe = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30', '-frames:v', '5', ...ENCODERS[name](4000), '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { timeout: 8000, windowsHide: true });
    if (probe.status === 0) list.push(name);
  }
  detected.set(ffmpeg, list);
  return list;
}

// No tee, | separa saídas e [ ] delimita opções: escapamos o que puder aparecer num caminho de arquivo.
const teeEscape = value => value.replace(/\\/g, '/').replace(/(['\[\]])/g, '\\$1');
const FIFO = 'f=fifo:fifo_format=flv:drop_pkts_on_overflow=1:attempt_recovery=1:recover_any_error=1:recovery_wait_time=2:restart_with_keyframe=1:onfail=ignore';

function outputArgs(cfg) {
  const outputs = cfg.destinations.map(d => '[' + FIFO + ']' + d.target);
  if (cfg.record) outputs.push('[f=matroska:onfail=ignore]' + teeEscape(cfg.record.file));
  return ['-flags', '+global_header', '-f', 'tee', outputs.join('|')];
}

function argsForBroadcast(cfg) {
  const size = cfg.resolution === '720p' ? '1280:720' : '1920:1080', kb = Math.round(cfg.bitrate * 1000);
  return ['-hide_banner', '-loglevel', 'warning', '-nostats', '-nostdin', '-thread_queue_size', '128', '-probesize', '1000000', '-analyzeduration', '1000000', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${size}:flags=bilinear,setsar=1`, '-r', '30',
    ...ENCODERS[cfg.encoder || 'libx264'](kb), '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-af', 'aresample=async=1:first_pts=0', '-progress', 'pipe:3', '-stats_period', '1',
    ...outputArgs(cfg)];
}

/* Compatibilidade: um destino, saída FLV direta (falha de conexão encerra o processo). */
function argsFor(c) {
  const size = c.resolution === '720p' ? '1280:720' : '1920:1080', kb = Math.round(c.bitrate * 1000);
  return ['-hide_banner', '-loglevel', 'warning', '-nostats', '-nostdin', '-thread_queue_size', '128', '-probesize', '1000000', '-analyzeduration', '1000000', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${size}:flags=bilinear,setsar=1`, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-b:v', kb + 'k', '-minrate', kb + 'k', '-maxrate', kb + 'k', '-bufsize', (kb * 2) + 'k', '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-af', 'aresample=async=1:first_pts=0', '-progress', 'pipe:3', '-stats_period', '1', '-f', 'flv', '-flvflags', 'no_duration_filesize', '-rw_timeout', '15000000', c.target];
}

function findFFmpeg() {
  // A versão instalada com o pacote vem antes da do sistema: é a que os testes validam.
  const candidates = []; if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try { const bundled = require('ffmpeg-static'); if (bundled) candidates.push(bundled); } catch { /* opcional */ }
  candidates.push('ffmpeg');
  for (const candidate of candidates) {
    const v = spawnSync(candidate, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (v.status === 0 && /libx264/.test(v.stdout) && /\baac\b/.test(v.stdout)) return candidate;
  }
  return null;
}

/* ---------- leitura do log do FFmpeg ---------- */

// Remove qualquer URL de destino (que carrega a chave) antes de um texto sair do processo.
function redact(text, cfg) {
  let out = String(text);
  for (const d of cfg?.destinations || []) out = out.split(d.target).join('rtmp://' + d.name + '/•••');
  return out.replace(/rtmps?:\/\/[^\s'"]+/g, m => m.replace(/\/[^/]*$/, '/•••'));
}

// Associa uma linha de erro do FFmpeg ao destino a que ela se refere.
function destinationEvents(chunk, cfg) {
  const events = [];
  for (const line of String(chunk).split('\n')) {
    if (!/Error opening|Connection (refused|timed out|reset)|Failed to resolve|Broken pipe|failed|Server error|NetStream/i.test(line)) continue;
    const target = cfg.destinations.find(d => line.includes(d.target) || line.includes(new URL(d.target).host));
    if (!target) continue;
    const reason = /refused/i.test(line) ? 'conexão recusada' : /resolve/i.test(line) ? 'endereço não encontrado' : /timed out/i.test(line) ? 'tempo esgotado' : /Server error|NetStream|40[13]/i.test(line) ? 'recusado pela plataforma (confira a chave)' : 'conexão interrompida';
    if (!events.some(e => e.id === target.id)) events.push({ id: target.id, name: target.name, state: 'retrying', reason });
  }
  return events;
}

function safeError(stderr) {
  if (/Server error|NetStream.Publish|403|401|Authentication|not authorized|Already publishing/i.test(stderr)) return 'O YouTube recusou a publicação. Confira a chave e se outra aplicação está usando a mesma transmissão.';
  if (/Connection refused|Failed to resolve|Connection timed out|I\/O error|Network is unreachable|Error opening output/i.test(stderr)) return 'Falha ao conectar ao YouTube. Confira URL, internet, firewall e chave no YouTube Studio.';
  if (/Invalid data|EBML|does not contain any stream|matches no streams/i.test(stderr)) return 'O codificador não recebeu vídeo e áudio válidos. Reinicie o envio no Chrome ou Edge.';
  return 'O codificador foi interrompido. Confira as credenciais, a conexão e tente iniciar novamente.';
}
function safeBroadcastError(stderr) {
  if (/Invalid data|EBML|does not contain any stream|matches no streams/i.test(stderr)) return 'O codificador não recebeu vídeo e áudio válidos. Reinicie o envio no Chrome ou Edge.';
  if (/No space left|Permission denied|Read-only file system/i.test(stderr)) return 'Não foi possível gravar na pasta escolhida: sem espaço ou sem permissão.';
  return 'O codificador foi interrompido. Confira a conexão e os destinos e inicie novamente.';
}

module.exports = { PLATFORMS, MAX_DESTINATIONS, validateConfig, validateBroadcast, validateDestination, argsFor, argsForBroadcast, detectEncoders, findFFmpeg, safeError, safeBroadcastError, redact, destinationEvents };
