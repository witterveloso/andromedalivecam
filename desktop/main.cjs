'use strict';
/*
 * Andrômeda Live para desktop: o mesmo serviço e a mesma mesa, numa janela própria.
 * - O serviço local roda dentro do programa: sem terminal, sem INICIAR.bat.
 * - A janela não reduz quadros quando fica atrás de outra ou minimizada.
 * - Logs e licença ficam na pasta de dados do usuário (a instalação é só leitura).
 */
const { app, BrowserWindow, Menu, dialog, powerSaveBlocker, session, shell, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path');

// Porta da mesa: 3180. Se outro programa deste computador já usa a 3180, a mesa abre na seguinte livre (3190, 3200…),
// em vez de não abrir. (O próprio Andrômeda Live aberto duas vezes é barrado antes, pela instância única.)
const PORTS = [3180, 3190, 3200, 3210, 3220];
let PORT = PORTS[0], ORIGIN = 'http://localhost:' + PORT;
const smoke = (process.argv.find(a => a.startsWith('--smoke-test=')) || '').slice('--smoke-test='.length);

// Mesa de transmissão: nada de economia de energia no navegador embutido.
for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!smoke && !app.requestSingleInstanceLock()) app.quit();

// Placa de vídeo problemática (driver antigo, placa sem suporte): se o processo da placa cai duas vezes, o programa reabre
// sem aceleração por 3 dias, em vez de ficar com a tela preta ou fechando. Depois disso tenta de novo com a placa.
const gpuFlag = () => path.join(app.getPath('userData'), 'sem-aceleracao.json');
let gpuOff = null;
try { const saved = JSON.parse(fs.readFileSync(gpuFlag(), 'utf8')); if (Date.now() - saved.at < 3 * 86400000) gpuOff = saved; } catch { /* com aceleração */ }
if (process.argv.includes('--sem-aceleracao')) gpuOff = gpuOff || { manual: true }; // modo de segurança, pela linha de comando
if (gpuOff) app.disableHardwareAcceleration();
let gpuCrashes = 0;
app.on('child-process-gone', (_e, details) => {
  if (details.type !== 'GPU' || details.reason === 'clean-exit' || smoke || gpuOff) return;
  if (++gpuCrashes < 2) return;
  try { fs.writeFileSync(gpuFlag(), JSON.stringify({ at: Date.now(), reason: details.reason, exitCode: details.exitCode })); } catch { /* sem onde gravar */ }
  bridge?.audit?.warn('servico', 'placa-de-video', 'A placa de vídeo parou duas vezes (' + details.reason + '): reabrindo sem aceleração por 3 dias. Atualize o driver da placa de vídeo.');
  closeGuard.confirmNow?.(); app.relaunch(); app.exit(0);
});

let win = null, bridge = null, closing = false;
const { createCloseGuard } = require('./closeguard.cjs');
const closeGuard = createCloseGuard({
  dialog, app, disabled: !!smoke, getWindow: () => win,
  // "No ar" = enviando ou preparando a transmissão (mesma regra do aviso do navegador).
  isOnAir: () => win?.webContents.executeJavaScript('typeof busyTx === "function" && busyTx()') ?? false,
});

function report(result) {
  if (!smoke) return;
  try { fs.writeFileSync(smoke, JSON.stringify(result, null, 2)); } catch { /* sem onde escrever */ }
  app.exit(result.ok ? 0 : 1);
}

function fatal(title, detail) {
  if (smoke) { report({ ok: false, error: title + ': ' + detail }); return; }
  dialog.showErrorBox(title, detail);
  app.exit(1);
}

// Modo nuvem (câmeras por 4G/5G pelo gateway): o mesmo mesa-cloud.env gerado por cloud/configure.py,
// copiado para a pasta de dados do programa. Só variáveis ANDROMEDA_* são aceitas.
function loadCloudConfig(data) {
  const file = path.join(data, 'mesa-cloud.env');
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(ANDROMEDA_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return file;
}

async function startService() {
  const data = app.getPath('userData');
  fs.mkdirSync(data, { recursive: true });
  process.env.ANDROMEDA_LOG_DIR ||= path.join(data, 'logs');
  process.env.ANDROMEDA_LICENSE_FILE ||= path.join(data, 'licenca.txt');
  process.env.ANDROMEDA_DATA_DIR ||= data;
  loadCloudConfig(data);
  const { createBridge } = require('../server.cjs');
  for (const port of PORTS) {
    const candidate = createBridge({ port, camPort: port + 5 });
    // A porta dos convites por gateway (camPort) só é usada no modo gateway: ocupada, a mesa abre assim mesmo e avisa.
    candidate.cameraHub.gateway.on('error', e => candidate.audit?.warn('servico', 'porta-gateway', 'A porta ' + (port + 5) + ' (convites por gateway próprio) está em uso por outro programa: ' + e.code + '. Os convites pela internet e pela rede local funcionam normalmente.'));
    const result = await new Promise(resolve => {
      candidate.server.once('listening', () => resolve('ok'));
      candidate.server.once('error', e => resolve(e.code === 'EADDRINUSE' ? 'busy' : e));
      candidate.listen();
    });
    if (result === 'ok') {
      PORT = port; ORIGIN = 'http://localhost:' + port; bridge = candidate; await candidate.ready();
      if (port !== PORTS[0]) candidate.audit?.warn('servico', 'porta-alternativa', 'A porta ' + PORTS[0] + ' está em uso por outro programa deste computador: a mesa abriu na porta ' + port + '.');
      reportMachine(candidate);
      return;
    }
    candidate.shutdown?.();
    if (result !== 'busy') { fatal('Não foi possível iniciar o serviço', result.message || String(result)); return; }
  }
  fatal('Portas da mesa em uso', 'As portas ' + PORTS.join(', ') + ' estão em uso por outros programas. Feche o INICIAR.bat ou o outro programa e abra o Andrômeda Live de novo.');
}

// Ficha do computador no Diagnóstico: o que varia de máquina para máquina e explica a maioria dos problemas.
async function reportMachine(b) {
  try {
    const os = require('node:os'), gpu = await app.getGPUInfo('basic').catch(() => ({})), feat = app.getGPUFeatureStatus();
    const device = (gpu.gpuDevice || []).find(d => d.active) || (gpu.gpuDevice || [])[0] || {};
    const ram = Math.round(os.totalmem() / 1073741824);
    b.audit?.info('servico', 'computador', 'Computador: ' + os.cpus()[0]?.model?.trim() + ' · ' + os.cpus().length + ' núcleos · ' + ram + ' GB · ' + os.version?.() + ' ' + os.arch() + (gpuOff ? ' · SEM aceleração de vídeo' : ''),
      { versao: app.getVersion(), sistema: os.version?.() + ' ' + os.release(), arquitetura: os.arch(), memoriaGB: ram, nucleos: os.cpus().length, porta: PORT, aceleracao: gpuOff ? 'desligada' : 'ligada',
        placa: device.vendorId ? { fabricante: '0x' + device.vendorId.toString(16), modelo: '0x' + device.deviceId.toString(16), driver: device.driverVersion } : null,
        codificacaoDeVideo: feat.video_encode, decodificacaoDeVideo: feat.video_decode, webgl: feat.webgl2, pastaDeDados: app.getPath('userData') });
    if (ram < 8) b.audit?.warn('servico', 'pouca-memoria', 'Este computador tem ' + ram + ' GB de memória: para 1080p30 com câmeras, o recomendado é 8 GB ou mais. Feche outros programas durante a live.');
  } catch { /* ficha opcional */ }
}

function allowMedia() {
  const trusted = url => typeof url === 'string' && (url.startsWith(ORIGIN + '/') || url === ORIGIN);
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'wakeLock', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed.has(permission) && trusted(details.requestingUrl || contents.getURL())));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => allowed.has(permission) && trusted(origin));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, show: false,
    title: 'Andrômeda Live', backgroundColor: '#060817', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  const contents = win.webContents;
  // "Visualizar saída PGM" abre uma janela em branco que a mesa preenche; links externos vão para o navegador.
  contents.setWindowOpenHandler(({ url, frameName }) => {
    // Segunda tela: abre no outro monitor (se houver), ocupando a área útil dele.
    if ((!url || url === 'about:blank') && frameName === 'andromeda-segunda-tela') {
      const here = screen.getDisplayMatching(win.getBounds()), other = screen.getAllDisplays().find(d => d.id !== here.id) || here, area = other.workArea;
      return { action: 'allow', overrideBrowserWindowOptions: { title: 'Andrômeda Live · Segunda tela', x: area.x, y: area.y, width: area.width, height: area.height, backgroundColor: '#060817', autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { backgroundThrottling: false } } };
    }
    if (!url || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { title: 'PROGRAM (AR)', backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } } };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (child, details) => {
    if (details.frameName !== 'andromeda-segunda-tela') return;
    child.maximize();
    // F11 vai para a página (a mesa decide: comando atribuído ou tela cheia desta janela).
  });
  contents.on('will-navigate', (event, url) => { if (!url.startsWith(ORIGIN)) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // A mesa pede confirmação ao sair durante um envio (beforeunload); aqui ela vira uma pergunta clara.
  contents.on('will-prevent-unload', event => {
    if (closeGuard.confirmed) { event.preventDefault(); return; } // a pergunta de fechar já avisou sobre o envio
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Continuar no ar', 'Encerrar e fechar'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Transmissão em andamento', message: 'A mesa está enviando ou gravando.', detail: 'Fechar agora interrompe a transmissão em todas as plataformas e finaliza a gravação.',
    });
    if (choice === 1) event.preventDefault();
  });
  contents.on('render-process-gone', (_e, details) => {
    if (closing || smoke) return;
    const choice = dialog.showMessageBoxSync(win, { type: 'error', buttons: ['Recarregar a mesa', 'Fechar'], defaultId: 0, title: 'A mesa parou', message: 'A tela da mesa parou de responder (' + details.reason + ').', detail: 'O serviço local continua ativo. Recarregar reabre a mesa; refaça a seleção de fontes antes de voltar ao ar.' });
    if (choice === 0) contents.reload(); else { closeGuard.confirmNow(); app.quit(); }
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    // F1–F12 chegam à mesa (atalhos do Andrômeda Live); F11 sem função na mesa alterna a tela cheia pela própria página.
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { contents.toggleDevTools(); event.preventDefault(); }
    else if (input.control && input.key.toLowerCase() === 'r' && !input.shift) event.preventDefault(); // sem recarregar a mesa por engano no ar
  });
  win.on('close', event => closeGuard.handleClose(event)); // pergunta antes de fechar (toque sem querer no X)
  win.on('closed', () => { win = null; });
  if (smoke) contents.once('did-finish-load', () => setTimeout(checkPage, 2500));
  win.loadURL(ORIGIN + '/');
}

// Conferência automática usada na CI: o programa empacotado abre, a mesa carrega e o serviço responde.
async function checkPage() {
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const session = await (await fetch('/api/session')).json();
      const tabs = [...document.querySelectorAll('.workspace-tabs button')].map(b => b.textContent.trim());
      return {
        title: document.title, cells: document.querySelectorAll('.mv-cell').length, tabs,
        broadcast: typeof startBroadcast === 'function', mosaic: typeof andromedaStage === 'object',
        version: session.version, ffmpegReady: session.ffmpegReady, encoders: session.encoders,
        mediaRecorder: typeof MediaRecorder === 'function' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'),
      };
    })()`);
    const ok = result.cells === 10 && result.broadcast && result.mosaic && result.ffmpegReady && result.mediaRecorder && result.tabs.includes('Transmissão');
    try { fs.writeFileSync(smoke.replace(/\.json$/, '') + '.png', (await win.webContents.capturePage()).toPNG()); } catch { /* captura opcional */ }
    report({ ok, ...result, porta: PORT, aceleracao: gpuOff ? 'desligada' : 'ligada', ffmpeg: require('../encoder.cjs').findFFmpeg(), cloudGateway: process.env.ANDROMEDA_CLOUD_URL || null, logDir: process.env.ANDROMEDA_LOG_DIR, platform: process.platform + '-' + process.arch, electron: process.versions.electron });
  } catch (e) { report({ ok: false, error: e.message }); }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', event => { closeGuard.handleBeforeQuit(event); if (!event.defaultPrevented) closing = true; });
app.on('window-all-closed', () => { bridge?.shutdown(); app.quit(); });
if (smoke) setTimeout(() => report({ ok: false, error: 'tempo esgotado' }), 90000).unref();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  allowMedia();
  await startService();
  if (!bridge) return;
  if (!smoke) powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
}).catch(e => fatal('Não foi possível abrir o Andrômeda Live', e.message));
