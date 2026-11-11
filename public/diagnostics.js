'use strict';
/*
 * Andromeda Live — diagnóstico e auditoria na mesa.
 * Envia ao serviço o que o operador fez e o que falhou no navegador, e mostra a
 * trilha completa da sessão (serviço, câmeras, codificador, mesa) numa página.
 */
(() => {
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  let token = null, queue = [], last = 0, unseen = 0, filter = 'all';
  const events = [];

  async function session() {
    if (liveTx.session) return liveTx.session;
    try { const r = await fetch('/api/session', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
  }
  async function flush() {
    if (!queue.length) return;
    token ??= (await session())?.token; if (!token) return;
    const batch = queue; queue = [];
    for (const body of batch) fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': token }, body: JSON.stringify(body) }).catch(() => {});
  }
  function audit(level, code, message, data) { if (queue.length < 200) queue.push({ level, code, message: String(message).slice(0, 500), data }); flush(); }
  window.andromedaAudit = audit;

  // Toda ação registrada na mesa (cortes, seleções, conexões) entra na trilha.
  const baseLog = log;
  log = function (message) { baseLog(message); audit(/falh|erro|indispon|interromp|perdid|recus/i.test(message) ? 'warn' : 'info', 'operacao', message, { pgm: sources[state.pgm], prv: sources[state.prv] }); };
  window.addEventListener('error', e => audit('error', 'erro-javascript', e.message || 'Erro na página', { arquivo: String(e.filename || '').split('/').pop(), linha: e.lineno }));
  window.addEventListener('unhandledrejection', e => audit('error', 'erro-javascript', e.reason?.message || String(e.reason || 'Promessa rejeitada')));
  window.addEventListener('offline', () => audit('error', 'rede', 'O computador ficou sem rede'));
  window.addEventListener('online', () => audit('info', 'rede', 'Rede restabelecida'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && busyTx()) audit('warn', 'aba-oculta', 'A aba da mesa ficou oculta durante o envio: o navegador pode reduzir os quadros'); });

  // Quadros por segundo do desenho da mesa: queda sustentada é o primeiro sinal de computador no limite.
  let frames = 0, slow = 0, lastWarn = 0, fps = 0;
  const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  setInterval(() => {
    fps = frames; frames = 0;
    if (document.hidden) { slow = 0; return; }
    slow = fps < 20 ? slow + 1 : 0;
    if (slow >= 5 && Date.now() - lastWarn > 60000) { lastWarn = Date.now(); audit('warn', 'fps-baixo', 'A mesa está desenhando a ' + fps + ' quadros por segundo', { enviando: busyTx() }); }
  }, 1000);

  /* ---------- página ---------- */

  const page = make('section', 'workspace-page diagnostics-page'); page.hidden = true;
  page.innerHTML = '<div class="diag-cards"><article class="diag-card"><h3>Serviço</h3><p id="diagService">Verificando…</p></article><article class="diag-card"><h3>Sessão de auditoria</h3><p id="diagSession">—</p><div class="diag-counts"><span data-level="info" id="diagInfo">0</span><span data-level="warn" id="diagWarn">0</span><span data-level="error" id="diagError">0</span></div></article><article class="diag-card"><h3>Licença</h3><p id="diagLicense">—</p><div id="diagActivate" hidden><textarea id="licenseToken" rows="2" spellcheck="false" placeholder="Cole o token de ativação"></textarea><button id="licenseApply" type="button">Ativar</button></div></article></div><section class="dock-panel diag-log"><div class="dock-handle">Eventos da sessão</div><div class="diag-tools"><button type="button" data-filter="all" aria-pressed="true">Tudo</button><button type="button" data-filter="alerts" aria-pressed="false">Avisos e erros</button><span id="diagFps"></span><a id="diagExport" href="/api/audit/export" download>Exportar auditoria (.jsonl)</a></div><div class="diag-scroll"><table><thead><tr><th>Hora</th><th>Nível</th><th>Origem</th><th>Evento</th></tr></thead><tbody id="diagRows"></tbody></table><p id="diagEmpty">Nenhum evento ainda.</p></div></section>';
  [...document.querySelectorAll('.workspace-page')].at(-1).after(page);
  pages.diagnostics = page;
  const tab = make('button', '', 'Diagnóstico'); tab.dataset.page = 'diagnostics'; tab.onclick = () => { openWorkspace('diagnostics'); unseen = 0; badge(); };
  nav.insertBefore(tab, [...nav.children].find(b => !b.dataset.page) || null);
  const badge = () => { tab.dataset.alerts = unseen ? String(Math.min(99, unseen)) : ''; tab.setAttribute('aria-label', unseen ? 'Diagnóstico, ' + unseen + ' aviso(s) novo(s)' : 'Diagnóstico'); };

  const LEVEL = { info: 'Info', warn: 'Aviso', error: 'Erro' };
  function paint() {
    const rows = events.filter(e => filter === 'all' || e.level !== 'info').slice(-400).reverse();
    $('#diagRows').replaceChildren(...rows.map(e => {
      const tr = make('tr'); tr.dataset.level = e.level;
      const detail = e.data ? ' · ' + Object.entries(e.data).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ') : '';
      tr.append(make('td', '', new Date(e.time).toLocaleTimeString('pt-BR')), make('td', '', LEVEL[e.level]), make('td', '', e.source), make('td', '', e.message + detail.slice(0, 300)));
      return tr;
    }));
    $('#diagEmpty').hidden = rows.length > 0;
  }
  page.querySelectorAll('[data-filter]').forEach(b => { b.onclick = () => { filter = b.dataset.filter; page.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paint(); }; });

  function paintLicense(lic) {
    if (!lic) return;
    $('#diagLicense').textContent = lic.required ? lic.message + (lic.customer ? ' · ' + lic.customer + ' · plano ' + lic.planName + ' · vence em ' + lic.expires.slice(0, 10).split('-').reverse().join('/') : '') : lic.message;
    $('#diagLicense').dataset.tone = !lic.valid ? 'bad' : lic.warning ? 'warn' : '';
    $('#diagActivate').hidden = !lic.required || (lic.valid && !lic.warning);
  }
  $('#licenseApply').onclick = async () => {
    token ??= (await session())?.token;
    try {
      const r = await fetch('/api/license', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': token }, body: JSON.stringify({ token: $('#licenseToken').value.trim() }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error);
      $('#licenseToken').value = ''; paintLicense(data); if (liveTx.session) liveTx.session.license = data; log('Licença ativada: plano ' + data.planName);
    } catch (e) { $('#diagLicense').textContent = e.message || 'Não foi possível ativar.'; $('#diagLicense').dataset.tone = 'bad'; }
  };

  async function poll() {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/audit?since=' + last, { cache: 'no-store' }); if (!r.ok) return;
      const data = await r.json();
      for (const e of data.events) { events.push(e); last = Math.max(last, e.seq); if (e.level !== 'info' && page.hidden) unseen++; }
      if (events.length > 1500) events.splice(0, events.length - 1500);
      $('#diagInfo').textContent = data.summary.counts.info + ' info'; $('#diagWarn').textContent = data.summary.counts.warn + ' avisos'; $('#diagError').textContent = data.summary.counts.error + ' erros';
      $('#diagSession').textContent = data.summary.file ? 'Gravada em ' + data.summary.file : 'Somente em memória nesta sessão.';
      $('#diagFps').textContent = 'Mesa: ' + fps + ' quadros/s';
      if (data.events.length) paint();
      badge();
    } catch { /* serviço fechado */ }
  }
  async function service() {
    const s = await session();
    $('#diagService').textContent = s ? 'Versão ' + s.version + ' · ' + (s.ffmpegReady ? 'FFmpeg pronto' : 'FFmpeg ausente') + ' · codificadores: ' + (s.encoders || []).join(', ') : 'Serviço local indisponível. Execute INICIAR.bat.';
    paintLicense(s?.license);
  }
  setInterval(poll, 3000); setInterval(service, 30000);
  poll(); service();
  audit('info', 'mesa-aberta', 'Mesa aberta no navegador', { navegador: navigator.userAgent.replace(/^.*?(Chrome|Edg|Firefox|Safari)\//, '$1/').slice(0, 40), tela: screen.width + 'x' + screen.height });
})();
