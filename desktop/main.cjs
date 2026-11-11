'use strict';
/*
 * Andrômeda Live para desktop: o mesmo serviço e a mesma mesa, numa janela própria.
 * - O serviço local roda dentro do programa: sem terminal, sem INICIAR.bat.
 * - A janela não reduz quadros quando fica atrás de outra ou minimizada.
 * - Logs e licença ficam na pasta de dados do usuário (a instalação é só leitura).
 */
const { app, BrowserWindow, Menu, dialog, powerSaveBlocker, session, shell } = require('electron');
const fs = require('node:fs'), path = require('node:path');

const PORT = 3180, ORIGIN = 'http://localhost:' + PORT;
const smoke = (process.argv.find(a => a.startsWith('--smoke-test=')) || '').slice('--smoke-test='.length);

// Mesa de transmissão: nada de economia de energia no navegador embutido.
for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!smoke && !app.requestSingleInstanceLock()) app.quit();

let win = null, bridge = null, closing = false;

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
  loadCloudConfig(data);
  const { createBridge } = require('../server.cjs');
  const candidate = createBridge({ port: PORT, camPort: 3185 });
  const busy = message => e => { if (e.code === 'EADDRINUSE') fatal('Andrômeda Live já está aberto', message); else fatal('Não foi possível iniciar o serviço', e.message); };
  candidate.cameraHub.gateway.on('error', busy('A porta 3185 (convites das câmeras) está em uso. Feche a outra janela do Andrômeda Live ou o INICIAR.bat e abra de novo.'));
  const started = await new Promise((resolve, reject) => {
    candidate.server.once('listening', () => resolve(true));
    candidate.server.once('error', reject);
    candidate.listen();
  }).catch(busy('A porta 3180 está em uso. Feche a outra janela do Andrômeda Live ou o INICIAR.bat e abra de novo.'));
  if (started) bridge = candidate;
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
  contents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { title: 'PROGRAM (AR)', backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } } };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!url.startsWith(ORIGIN)) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // A mesa pede confirmação ao sair durante um envio (beforeunload); aqui ela vira uma pergunta clara.
  contents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Continuar no ar', 'Encerrar e fechar'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Transmissão em andamento', message: 'A mesa está enviando ou gravando.', detail: 'Fechar agora interrompe a transmissão em todas as plataformas e finaliza a gravação.',
    });
    if (choice === 1) event.preventDefault();
  });
  contents.on('render-process-gone', (_e, details) => {
    if (closing || smoke) return;
    const choice = dialog.showMessageBoxSync(win, { type: 'error', buttons: ['Recarregar a mesa', 'Fechar'], defaultId: 0, title: 'A mesa parou', message: 'A tela da mesa parou de responder (' + details.reason + ').', detail: 'O serviço local continua ativo. Recarregar reabre a mesa; refaça a seleção de fontes antes de voltar ao ar.' });
    if (choice === 0) contents.reload(); else app.quit();
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'i') { contents.toggleDevTools(); event.preventDefault(); }
    else if (input.control && input.key.toLowerCase() === 'r' && !input.shift) event.preventDefault(); // sem recarregar a mesa por engano no ar
  });
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
    report({ ok, ...result, ffmpeg: require('../encoder.cjs').findFFmpeg(), cloudGateway: process.env.ANDROMEDA_CLOUD_URL || null, logDir: process.env.ANDROMEDA_LOG_DIR, platform: process.platform + '-' + process.arch, electron: process.versions.electron });
  } catch (e) { report({ ok: false, error: e.message }); }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { closing = true; });
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
