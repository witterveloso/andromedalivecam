'use strict';
// Slides: converte apresentações e documentos (PPTX, PPT, ODP, KEY, DOCX, XLSX…) em PDF para a mesa.
// A mesa abre PDF e imagens sozinha; o resto passa por aqui. Ordem: Microsoft PowerPoint (Windows, melhor fidelidade) → LibreOffice.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const POWERPOINT_EXT = new Set(['ppt', 'pptx', 'pps', 'ppsx', 'pot', 'potx', 'pptm', 'ppsm', 'potm']);
const LIMIT = 500 * 1024 * 1024, TIMEOUT_MS = 240000;

function run(cmd, args, { timeout = TIMEOUT_MS, env } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false, child;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try { child = spawn(cmd, args, { windowsHide: true, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { finish({ code: -1, out, err: e.message }); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* já terminou */ } finish({ code: -2, out, err: err + ' (tempo esgotado)' }); }, timeout);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ code: -1, out, err: e.message })); child.on('close', code => finish({ code, out, err }));
  });
}

function findLibreOffice(env = process.env, platform = process.platform) {
  const candidates = [];
  if (env.ANDROMEDA_SOFFICE) candidates.push(env.ANDROMEDA_SOFFICE);
  if (platform === 'win32') { for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) { if (base) candidates.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe')); } }
  else if (platform === 'darwin') candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  else candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice');
  for (const c of candidates) { try { if (c && fs.statSync(c).isFile()) return c; } catch { /* próximo */ } }
  return null;
}

// PowerPoint instalado? (só Windows; a chave COM existe quando o Office está instalado.)
async function hasPowerPoint(platform = process.platform) {
  if (platform !== 'win32') return false;
  const r = await run('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], { timeout: 8000 });
  return r.code === 0;
}

const PS_SCRIPT = [
  "param([string]$In, [string]$Out)",
  "$ErrorActionPreference = 'Stop'",
  "$app = $null; $pres = $null",
  "try {",
  "  $app = New-Object -ComObject PowerPoint.Application",
  "  # Abre somente leitura, sem janela. 32 = ppSaveAsPDF.",
  "  $pres = $app.Presentations.Open($In, -1, 0, 0)",
  "  $pres.SaveAs($Out, 32)",
  "} finally {",
  "  if ($pres) { try { $pres.Close() } catch {} }",
  "  if ($app) { try { $app.Quit() } catch {} }",
  "}",
].join('\r\n');

async function convertWithPowerPoint(dir, input, output) {
  const script = path.join(dir, 'ppt-to-pdf.ps1'); fs.writeFileSync(script, '﻿' + PS_SCRIPT);
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, input, output]);
  return r.code === 0 && fs.existsSync(output);
}

async function convertWithLibreOffice(soffice, dir, input, profileDir) {
  const profile = (process.platform === 'win32' ? 'file:///' + profileDir.replace(/\\/g, '/') : 'file://' + profileDir);
  const r = await run(soffice, ['-env:UserInstallation=' + profile, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--convert-to', 'pdf:impress_pdf_Export', '--outdir', dir, input]);
  let out = path.join(dir, path.basename(input).replace(/\.[^.]*$/, '') + '.pdf');
  if (!fs.existsSync(out)) { // documentos e planilhas não usam o filtro do Impress
    const r2 = await run(soffice, ['-env:UserInstallation=' + profile, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--convert-to', 'pdf', '--outdir', dir, input]);
    if (!fs.existsSync(out)) return { ok: false, detail: (r2.err || r.err || '').trim().slice(-300) };
  }
  return { ok: true, file: out };
}

// Um conversor por vez (o LibreOffice não gosta de dois processos no mesmo perfil).
function createSlidesConverter({ dataDir = path.join(__dirname, 'dados'), tmpRoot = os.tmpdir(), onEvent = () => {} } = {}) {
  let queue = Promise.resolve(), engines = null;
  const profileDir = path.join(dataDir, 'libreoffice-perfil');
  async function detect(force = false) {
    if (engines && !force) return engines;
    // ANDROMEDA_SLIDES_ENGINE=none desliga os conversores (para testar o leitor simplificado ou por suporte).
    const off = process.env.ANDROMEDA_SLIDES_ENGINE === 'none';
    const [powerpoint, soffice] = off ? [false, null] : [await hasPowerPoint(), findLibreOffice()];
    engines = { powerpoint, libreoffice: !!soffice, soffice };
    return engines;
  }
  const status = async () => { const e = await detect(true); return { powerpoint: e.powerpoint, libreoffice: e.libreoffice, ready: e.powerpoint || e.libreoffice }; };

  // Recebe o corpo da requisição (arquivo bruto) e devolve o caminho do PDF; quem chama apaga a pasta com cleanup().
  async function convert(stream, extension) {
    const ext = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'andromeda-slides-')), input = path.join(dir, 'apresentacao.' + ext), output = path.join(dir, 'apresentacao.pdf');
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* resto do sistema */ } };
    try {
      let size = 0;
      await new Promise((resolve, reject) => {
        const sink = fs.createWriteStream(input);
        stream.on('data', c => { size += c.length; if (size > LIMIT) { reject(Object.assign(new Error('Arquivo muito grande (limite 500 MB).'), { status: 413 })); stream.destroy(); } });
        stream.on('error', reject); stream.on('aborted', () => reject(new Error('Envio interrompido.'))); sink.on('error', reject); sink.on('finish', resolve); stream.pipe(sink);
      });
      if (!size) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
      const result = queue.then(async () => {
        const e = await detect();
        if (!e.powerpoint && !e.libreoffice) throw Object.assign(new Error('NO_ENGINE'), { status: 501 });
        if (e.powerpoint && POWERPOINT_EXT.has(ext)) {
          if (await convertWithPowerPoint(dir, input, output)) { onEvent('info', 'slides-powerpoint', 'Apresentação convertida pelo PowerPoint'); return output; }
          onEvent('warn', 'slides-powerpoint-falhou', 'O PowerPoint não converteu; tentando o LibreOffice');
        }
        if (e.libreoffice) {
          fs.mkdirSync(profileDir, { recursive: true });
          const r = await convertWithLibreOffice(e.soffice, dir, input, profileDir);
          if (r.ok) { onEvent('info', 'slides-libreoffice', 'Apresentação convertida pelo LibreOffice'); return r.file; }
          throw Object.assign(new Error('Não foi possível converter este arquivo.' + (r.detail ? ' (' + r.detail + ')' : '')), { status: 422 });
        }
        throw Object.assign(new Error('Não foi possível converter este arquivo com o PowerPoint.'), { status: 422 });
      });
      queue = result.catch(() => {});
      return { file: await result, cleanup };
    } catch (e) { cleanup(); throw e; }
  }
  return { convert, status, detect };
}

module.exports = { createSlidesConverter, findLibreOffice, hasPowerPoint, POWERPOINT_EXT, LIMIT, randomId: () => crypto.randomBytes(4).toString('hex') };
