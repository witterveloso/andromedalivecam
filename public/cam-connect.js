'use strict';
/*
 * Andrômeda Live — como os celulares chegam à mesa (passo 1 dos convites).
 * Internet: Wi-Fi, 4G ou 5G de qualquer lugar, sem configurar nada.
 * Rede local: mesmo Wi-Fi pelo IP do computador, funciona sem internet.
 * Endereço próprio: gateway na nuvem ou Tailscale (o modo antigo).
 */
(() => {
  const flow = $('.invite-flow'), step = flow?.querySelector('.step');
  if (!flow || !step) return;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const MODES = [
    ['internet', 'Internet', 'Wi-Fi, 4G ou 5G, de qualquer lugar. Recomendado.'],
    ['lan', 'Rede local (IP)', 'Celular no mesmo Wi-Fi do computador. Funciona sem internet.'],
    ['gateway', 'Endereço próprio', 'Gateway na nuvem ou Tailscale, já configurados por você.'],
  ];

  const title = step.querySelector('h4'); title.lastChild.textContent = 'Como os celulares se conectam';
  const intro = flow.querySelector('.invite-head p');
  if (intro) intro.textContent = 'Escolha como os celulares chegam à mesa, gere um convite por câmera e envie o link ou o QR code. A imagem vai direto do celular para este computador.';
  const urlField = $('#camPublicURL').closest('label'), save = $('#camSaveURL');

  const choices = make('div', 'link-modes'); choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Como os celulares se conectam');
  const radios = MODES.map(([id, name, text]) => {
    const label = make('label', 'link-mode'), input = make('input'), body = make('span');
    input.type = 'radio'; input.name = 'camLinkMode'; input.value = id;
    body.append(make('strong', '', name), make('small', '', text)); label.append(input, body); choices.append(label);
    // Rede local só abre a escolha do IP; a ativação é no botão. Os outros modos valem na hora.
    input.onchange = () => { if (!input.checked) return; pending = id; paint(); if (id !== 'lan') choose(id); };
    return input;
  });
  const detail = make('div', 'link-detail');
  const internet = make('p', 'link-note');
  const lanBox = make('div', 'link-lan'), ipLabel = make('label', '', 'IP deste computador na rede'), ip = make('select'), activate = make('button', '', 'Ativar rede local'), lanNote = make('p', 'link-note');
  ip.id = 'camLanAddress'; activate.type = 'button'; activate.id = 'camLanActivate'; ipLabel.append(ip); lanBox.append(ipLabel, activate, lanNote);
  const gatewayBox = make('div', 'link-gateway'); gatewayBox.append(urlField, save);
  detail.append(internet, lanBox, gatewayBox);
  step.replaceChildren(title, choices, detail);

  let state = null, busy = false, pending = null;
  function paint() {
    if (!state) return;
    const cloud = state.mode === 'cloud', shown = pending || state.mode;
    choices.hidden = cloud;
    for (const r of radios) { r.checked = r.value === shown; r.disabled = busy; }
    internet.hidden = shown !== 'internet' && !cloud; lanBox.hidden = shown !== 'lan'; gatewayBox.hidden = shown !== 'gateway';
    if (cloud) internet.textContent = 'Gateway público configurado (mesa-cloud.env). Os convites usam esse endereço.';
    else if (state.mode === 'internet') {
      const r = state.relay || {};
      const t = state.turn || {}, mobile = t.provider === 'env' || (t.provider === 'andromeda' ? !!(t.router?.reachable || t.network) : ['custom', 'cloudflare'].includes(t.provider) && t.ready);
      const checking = t.provider === 'andromeda' && t.ready && !t.router && !t.network;
      // Uma frase só: o que o operador precisa saber para mandar o link.
      const reach = mobile ? 'Pronto: o link funciona no Wi-Fi e no 4G/5G.' : checking ? 'Pronto no Wi-Fi. Conferindo o 4G/5G…' : 'Pronto no Wi-Fi. Para o 4G/5G, configure "Rede móvel (4G/5G)" abaixo.';
      internet.textContent = r.invites && !r.brokersUp ? 'Sem conexão com a internet neste computador. Confira a rede.' : reach;
      internet.dataset.tone = (r.invites && !r.brokersUp) || (!mobile && !checking) ? 'warn' : 'ok';
      const tb = document.querySelector('#turnBox'); if (tb && !mobile && !checking && !tb.dataset.autoOpened) { tb.open = true; tb.dataset.autoOpened = '1'; }
    }
    const current = ip.value;
    ip.replaceChildren(...(state.lanAddresses || []).map(a => new Option(a.address + ' · ' + a.name + (a.vpn ? ' (VPN)' : ''), a.address)));
    ip.value = state.lan ? state.lan.origin.replace(/^https:\/\/|:\d+$/g, '') : current || ip.value;
    if (!ip.options.length) { ip.add(new Option('Nenhuma rede encontrada', '')); ip.disabled = true; } else ip.disabled = busy;
    activate.disabled = busy || !ip.value;
    activate.textContent = state.lan ? 'Trocar IP' : 'Ativar rede local';
    lanNote.textContent = state.lan
      ? 'Ativo em ' + state.lan.origin + '. No primeiro acesso o celular avisa que a conexão não é particular: no Android toque em Avançado → Continuar; no iPhone, Mostrar detalhes → visitar este site. Se o Windows perguntar, permita o Andrômeda Live em redes privadas.'
      : 'Escolha o IP do Wi-Fi ou do cabo e ative. O celular precisa estar na mesma rede.';
    lanNote.dataset.tone = state.lan ? 'ok' : '';
  }
  async function choose(mode, address) {
    busy = true; paint();
    try { state = await camAPI('mode', { mode, address }); setupMessage(mode === 'internet' ? 'Modo internet ativo. Gere um convite para cada câmera.' : mode === 'lan' ? 'Rede local ativa em ' + state.lan.origin + '. Gere os convites.' : 'Informe o endereço HTTPS do gateway e salve.'); }
    catch (e) { setupMessage(e.message); await refresh(); }
    finally { busy = false; pending = null; paint(); }
  }
  activate.onclick = () => choose('lan', ip.value);
  async function refresh() {
    try { const r = await fetch('/api/cam/status', { cache: 'no-store' }); if (r.ok) { const s = await r.json(); state = s.mode ? s : { ...s, mode: 'cloud' }; paint(); } } catch { /* serviço fechado */ }
  }
  setInterval(() => { if (!document.hidden && !flow.closest('[hidden]')) refresh(); }, 5000);
  refresh();
})();

/*
 * Rede móvel (4G/5G): retransmissão TURN.
 * Sem TURN, celular em dados móveis (CGNAT da operadora) e mesa atrás do roteador muitas vezes não acham caminho
 * direto: a câmera aparece conectada, mas a imagem não chega. A mesa guarda a chave e gera credenciais temporárias.
 */
(() => {
  const flow = $('.invite-flow'), step = flow?.querySelector('.step'); if (!step) return;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const box = make('details', 'turn-box'); box.id = 'turnBox';
  // Rede móvel (4G/5G): a câmera precisa de uma retransmissão na internet para chegar à mesa pelos dados móveis.
  // Rede Andrômeda nesta mesa (recomendado): retransmissão própria; a mesa abre a porta no roteador sozinha (UPnP, NAT-PMP,
  // inclusive Mesh atrás do modem). Cloudflare e o servidor da empresa ficam como alternativas.
  box.innerHTML = '<summary><strong>Rede móvel (4G/5G)</strong><span id="turnState" class="turn-state">verificando…</span></summary>' +
    '<label>Retransmissão<select id="turnProvider"><option value="andromeda">Rede Andrômeda nesta mesa (recomendado)</option><option value="cloudflare">Cloudflare</option><option value="custom">Servidor da Rede Andrômeda (empresa)</option><option value="off">Desligada · só Wi-Fi</option></select></label>' +
    '<div class="turn-fw" hidden><p class="link-note" id="turnFirewall" role="status"></p><button type="button" id="fwFix">Liberar no firewall do Windows</button></div><div class="turn-andromeda"><p class="link-note" id="turnOwnInfo"></p></div>' +
    '<div class="turn-cf" hidden><p class="link-note">Cloudflare → Realtime → TURN Server → Create: copie o <b>Key ID</b> e o <b>API token</b>.</p><label>Key ID<input id="turnKeyId" autocomplete="off" spellcheck="false"></label><label>API token<input id="turnToken" type="password" autocomplete="off" spellcheck="false"></label></div>' +
    '<div class="turn-own"><label>Endereços do servidor (um por linha)<textarea id="turnUrls" rows="2" spellcheck="false" placeholder="turn:rede.suaempresa.com.br:3478\nturn:rede.suaempresa.com.br:3478?transport=tcp"></textarea></label><label>Usuário<input id="turnUser" autocomplete="off" spellcheck="false"></label><label>Senha<input id="turnPass" type="password" autocomplete="off"></label></div>' +
    '<div class="turn-actions"><button type="button" id="turnSave">Salvar e testar</button><span id="turnMessage" class="link-note" role="status"></span></div>';
  step.append(box);
  const q = s => box.querySelector(s);
  const paintForm = () => { const p = q('#turnProvider').value; q('.turn-cf').hidden = p !== 'cloudflare'; q('.turn-own').hidden = p !== 'custom'; q('.turn-andromeda').hidden = p !== 'andromeda'; };
  q('#turnProvider').onchange = paintForm;
  function paint(s) {
    const state = q('#turnState');
    if (s.provider === 'env') { state.textContent = 'gateway próprio'; state.dataset.tone = 'ok'; box.hidden = true; return; }
    const own = s.provider === 'andromeda', viaNet = own && !s.router?.reachable && !!s.network, open5g = own && (s.router?.reachable || viaNet);
    const ready4g = s.provider === 'cloudflare' || s.provider === 'custom' ? s.ready : open5g;
    state.textContent = s.provider === 'off' ? 'desligada · só Wi-Fi' : !s.ready ? 'com problema' : ready4g ? '4G/5G pronto' : own && !s.router ? 'conferindo…' : 'falta configurar';
    state.dataset.tone = !s.ready && s.provider !== 'off' ? 'error' : ready4g ? 'ok' : 'warn';
    // Uma linha, só o que muda a decisão do operador.
    if (own) q('#turnOwnInfo').textContent = !s.ready ? 'Não iniciou: ' + (s.error || 'porta ocupada') + '.'
      : open5g ? 'Funcionando no 4G/5G.' : !s.router ? 'Conferindo o roteador…'
      : s.router?.levels === 2 || /dois roteadores/.test(s.router?.error || '') ? 'Há dois roteadores (Mesh + modem): ative o UPnP no modem da operadora ou ponha o Mesh em modo ponte. A mesa tenta de novo sozinha.'
      : 'O roteador não liberou o 4G/5G: ative o UPnP (ou NAT-PMP) no roteador. A mesa tenta de novo sozinha a cada minuto.';
    if (document.activeElement?.closest('#turnBox')) return;
    q('#turnProvider').value = s.provider;
    if (s.keyId) q('#turnKeyId').value = s.keyId;
    if (s.hasToken) q('#turnToken').placeholder = 'salvo · deixe em branco para manter';
    if (s.urls && s.provider === 'custom') q('#turnUrls').value = s.urls.join('\n');
    if (s.username) q('#turnUser').value = s.username;
    if (s.provider === 'custom') q('#turnPass').placeholder = 'salva · deixe em branco para manter';
    q('#turnMessage').textContent = s.provider === 'andromeda' || s.provider === 'off' ? '' : s.error ? 'Problema: ' + s.error : s.ready ? 'Funcionando no Wi-Fi e no 4G/5G.' : '';
    if (s.provider === 'off' && !box.dataset.opened) { box.open = true; box.dataset.opened = '1'; }
    paintForm();
  }
  async function refresh() { try { const r = await fetch('/api/turn', { cache: 'no-store' }); if (r.ok) paint(await r.json()); else box.hidden = true; } catch { box.hidden = true; } paintFirewall(); }
  // Firewall do Windows: em computador novo (ou rede nova marcada como "Pública"), ele pode bloquear as câmeras sem aviso.
  async function paintFirewall(st) {
    try { st = st || await (await fetch('/api/firewall', { cache: 'no-store' })).json(); } catch { return; }
    const wrap = q('.turn-fw'), note = q('#turnFirewall'), btn = q('#fwFix');
    if (!st.supported) { wrap.hidden = true; return; }
    // Só aparece quando o firewall atrapalha; liberado, não há nada a dizer.
    wrap.hidden = !!st.allowed || st.unknown; note.textContent = st.allowed ? '' : 'O firewall do Windows está bloqueando as câmeras.'; note.dataset.tone = 'warn'; btn.hidden = !!st.allowed;
    if (!st.allowed && !box.dataset.fwOpened) { box.open = true; box.dataset.fwOpened = '1'; }
  }
  q('#fwFix').onclick = async () => {
    const btn = q('#fwFix'), note = q('#turnFirewall'); btn.disabled = true; note.textContent = 'Confirme no aviso do Windows (pede permissão de administrador uma vez)…';
    try {
      const session = liveTx.session || await (await fetch('/api/session')).json();
      const out = await (await fetch('/api/firewall/fix', { method: 'POST', headers: { 'X-Andromeda-Token': session.token } })).json();
      if (out.status) paintFirewall(out.status); if (!out.ok) note.textContent = out.error || 'Não foi possível liberar.'; else note.textContent = 'Liberado: as câmeras chegam à mesa em qualquer rede (Wi-Fi, cabo, pública ou privada).';
      note.dataset.tone = out.ok ? 'ok' : 'warn';
    } catch (e) { note.textContent = e.message; } finally { btn.disabled = false; }
  };
  q('#turnSave').onclick = async () => {
    const button = q('#turnSave'); button.disabled = true; box.dataset.touched = '1'; q('#turnMessage').textContent = 'Testando…';
    try {
      const session = liveTx.session || await (await fetch('/api/session')).json();
      const body = { provider: q('#turnProvider').value, keyId: q('#turnKeyId').value, token: q('#turnToken').value, urls: q('#turnUrls').value, username: q('#turnUser').value, credential: q('#turnPass').value };
      const r = await fetch('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': session.token }, body: JSON.stringify(body) });
      const out = await r.json(); if (!r.ok) throw Error(out.error || 'Não foi possível salvar.');
      q('#turnToken').value = ''; q('#turnPass').value = ''; document.activeElement?.blur(); paint(out);
      q('#turnMessage').textContent = out.provider === 'off' ? 'Desligada: só Wi-Fi.' : 'Salvo e testado. As câmeras usam a retransmissão ao conectar ou reconectar (o mesmo link vale).';
    } catch (e) { q('#turnMessage').textContent = e.message; }
    finally { button.disabled = false; }
  };
  setInterval(() => { if (!document.hidden && !flow.closest('[hidden]')) refresh(); }, 15000);
  refresh();
})();
