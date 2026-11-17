'use strict';
/*
 * Pré-voo e perfil automático (cartão "Este computador" no Codificador).
 *
 * - Verificar e ajustar: mede quanto o computador codifica (mesmos parâmetros da transmissão) e escolhe sozinho resolução,
 *   velocidade do codificador e, se preciso, o codificador da placa de vídeo, deixando folga para o navegador e o sistema.
 * - Ao iniciar uma transmissão: confere se os servidores das plataformas respondem a partir daqui. Se nenhum responder, não
 *   inicia (a live falharia); se algum não responder, avisa e segue (a mesa tenta reconectar sozinha).
 * - Modo leve: se o codificador ficar para trás durante a live, a mesa desenha as miniaturas com menos frequência
 *   (a saída do AR continua em 30 quadros por segundo).
 */
(() => {
  const B = window.andromedaBroadcast; if (!B || typeof transportPanel === 'undefined') return;
  const { model } = B;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const api = async (url, body) => {
    const session = liveTx.session || await (await fetch('/api/session')).json();
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': session.token }, body: JSON.stringify(body || {}) });
    const out = await r.json().catch(() => ({})); if (!r.ok) throw Error(out.error || 'Falha ' + r.status); return out;
  };
  const PRESET_NAMES = { veryfast: 'Equilibrado (melhor qualidade)', superfast: 'Rápido (menos CPU)', ultrafast: 'Máximo desempenho (menos CPU ainda)' };
  if (!PRESET_NAMES[model.preset]) model.preset = 'veryfast';

  const card = make('section', 'pf-card'); card.setAttribute('aria-label', 'Este computador');
  card.innerHTML = '<h4>Este computador</h4>' +
    '<p class="pf-help">Mede quanto o computador codifica e escolhe sozinho a resolução e a velocidade que deixam folga para a transmissão não travar.</p>' +
    '<div class="pf-row"><button type="button" id="pfRun">Verificar e ajustar automaticamente</button><span id="pfState" class="pf-state" role="status"></span></div>' +
    '<label class="pf-field">Motor de envio <select id="pfEngine"></select></label><p class="pf-note" id="pfEngineNote"></p>' +
    '<label class="pf-field">Velocidade do codificador (motor padrão) <select id="pfPreset"></select></label>' +
    '<ul id="pfList" class="pf-list" aria-label="Resultado da medição"></ul>' +
    '<p class="pf-note" id="pfNote"></p>';
  transportPanel.append(card);
  const q = s => card.querySelector(s);
  for (const [v, t] of Object.entries(PRESET_NAMES)) q('#pfPreset').add(new Option(t, v));
  q('#pfPreset').value = model.preset;
  // Motor de envio: Automático usa o Andrômeda quando o navegador oferece H.264 e Opus; qualquer falha durante a live volta ao padrão sozinha.
  const ENGINE_NAMES = { auto: 'Automático (recomendado)', native: 'Andrômeda (codificação no navegador)', standard: 'Padrão (FFmpeg recodifica)' };
  if (!ENGINE_NAMES[model.engine]) model.engine = 'auto';
  for (const [v, t] of Object.entries(ENGINE_NAMES)) q('#pfEngine').add(new Option(t, v));
  q('#pfEngine').value = model.engine;
  q('#pfEngine').onchange = () => { model.engine = q('#pfEngine').value; B.save(); q('#pfNote').textContent = 'Vale a partir da próxima transmissão. A compensação de sincronismo é guardada por motor: calibre de novo ao trocar.'; };
  if (window.AndromedaEngine) AndromedaEngine.probe({ width: 1280, height: 720, bitrate: 4e6 }).then(p => {
    q('#pfEngineNote').textContent = p.ok ? 'Neste computador o motor Andrômeda está disponível (H.264 ' + (p.hardware ? 'pela placa de vídeo' : 'por software') + ').' : 'Motor Andrômeda indisponível aqui (' + p.reason + ') — a mesa usa o padrão.';
  });
  q('#pfPreset').onchange = () => { model.preset = q('#pfPreset').value; B.save(); q('#pfNote').textContent = 'Vale a partir da próxima transmissão.'; };
  const busy = () => typeof busyTx === 'function' && busyTx();
  let running = false;
  function paint() { q('#pfRun').disabled = running || busy(); q('#pfPreset').disabled = busy(); q('#pfEngine').disabled = busy(); q('#pfRun').textContent = running ? 'Medindo o computador…' : 'Verificar e ajustar automaticamente'; if (document.activeElement !== q('#pfPreset')) q('#pfPreset').value = model.preset; }
  setInterval(paint, 700);

  function applyProfile(rec, hardware) {
    model.resolution = rec.resolution; model.preset = rec.preset;
    const res = document.querySelector('#txResolution'); if (res) { res.value = rec.resolution; res.dispatchEvent(new Event('change')); }
    if (rec.encoder && rec.encoder !== 'libx264') { const enc = document.querySelector('#txEncoder'); if (enc && [...enc.options].some(o => o.value === rec.encoder)) { enc.value = rec.encoder; enc.dispatchEvent(new Event('change')); model.encoder = rec.encoder; } }
    else { const enc = document.querySelector('#txEncoder'); if (enc && model.encoder !== 'libx264') { enc.value = 'libx264'; enc.dispatchEvent(new Event('change')); } model.encoder = 'libx264'; }
    model.profiledAt = Date.now(); B.save(); paint();
  }
  async function run() {
    if (running || busy()) return;
    running = true; paint(); q('#pfList').replaceChildren(); q('#pfState').textContent = 'Medindo (alguns segundos)…'; q('#pfNote').textContent = '';
    try {
      const vertical = model.recordFormats !== '16:9' && model.record || model.destinations.some(d => d.enabled && d.aspect === '9:16');
      const out = await api('/api/benchmark', { vertical: !!vertical, verticalHeight: window.andromedaVertical?.settings.resolution === '1080p' ? 1920 : 1280 });
      for (const t of out.tests) { const li = make('li', '', t.label + ': ' + (t.speed ? t.speed.toString().replace('.', ',') + '× o tempo real' : 'falhou')); q('#pfList').append(li); }
      if (!out.recommended) { q('#pfState').textContent = 'Não foi possível medir.'; q('#pfNote').textContent = out.notes.join(' '); return; }
      applyProfile(out.recommended, out.hardware);
      q('#pfState').textContent = 'Ajustado: ' + out.recommended.label + (out.recommended.load !== null ? ' · usa cerca de ' + out.recommended.load + '% do computador' : '');
      q('#pfNote').textContent = (out.machine.cores + ' núcleos · ' + out.machine.model + ' · ' + Math.round(out.machine.freeMemoryMB / 1024 * 10) / 10 + ' GB de memória livre. ') + out.notes.join(' ');
      log('Computador verificado: ' + out.recommended.label); try { window.andromedaAudit?.('info', 'perfil-automatico', 'Perfil automático: ' + out.recommended.label, { nucleos: out.machine.cores, testes: out.tests.map(t => t.size + ' ' + t.preset + ' ' + t.speed + 'x').join('; ') }); } catch { /* auditoria opcional */ }
    } catch (e) { q('#pfState').textContent = 'Não foi possível medir: ' + e.message; }
    finally { running = false; paint(); }
  }
  q('#pfRun').onclick = run;

  /* ---------- ao iniciar a transmissão ---------- */
  // Devolve { block } se não adianta começar, ou { warn } para avisar e seguir.
  window.andromedaPreflight = async targets => {
    try {
      if (!targets.length) return {};
      const out = await api('/api/preflight', { destinations: targets.map(d => ({ name: d.name, server: d.server.trim() })) });
      const down = out.destinations.filter(d => !d.ok);
      if (down.length === out.destinations.length) return { block: 'Sem conexão com ' + down.map(d => d.name + ' (' + d.error + ')').join(', ') + '. Confira a internet deste computador e o endereço do servidor.' };
      const warn = [];
      if (down.length) warn.push(down.map(d => d.name + ' não respondeu (' + d.error + '); a mesa tenta reconectar sozinha').join('; '));
      if (!model.profiledAt) warn.push('dica: clique em "Verificar e ajustar automaticamente" (Codificador) para a mesa escolher o melhor perfil para este computador');
      if (out.machine.freeMemoryMB < 600) warn.push('pouca memória livre (' + out.machine.freeMemoryMB + ' MB): feche outros programas');
      return warn.length ? { warn: warn.join(' · ') } : {};
    } catch { return {}; } // se o pré-voo falhar, não impede a transmissão
  };
  // Modo leve: ativado por aviso de sobrecarga; desligado ao iniciar outra transmissão.
  window.andromedaLight = false;
  paint();
  window.andromedaPreflightUI = { run, card, paint };
})();
