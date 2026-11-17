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
    ['internet', 'Internet', 'Wi-Fi, 4G ou 5G, de qualquer lugar. Nada para configurar; o computador precisa de internet.'],
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
      internet.textContent = r.invites ? (r.brokersUp ? 'Pronto: ponto de encontro conectado (' + r.brokersUp + ' de ' + r.brokers + '). Convites ativos: ' + r.invites + '.' : 'Procurando o ponto de encontro… confira a internet deste computador.') : 'Pronto. Gere o convite: o link abre a câmera em qualquer rede.';
      internet.dataset.tone = r.invites && !r.brokersUp ? 'warn' : 'ok';
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
  box.innerHTML = '<summary><strong>Rede móvel (4G/5G)</strong><span id="turnState" class="turn-state">verificando…</span></summary>' +
    '<p class="link-note">No 4G/5G a operadora esconde o celular atrás de um endereço compartilhado e a imagem pode não chegar sem um servidor de retransmissão (TURN). Ative uma vez neste computador; os convites passam a usar a retransmissão quando o caminho direto falhar.</p>' +
    '<label>Retransmissão<select id="turnProvider"><option value="cloudflare">Cloudflare (recomendado · cota gratuita mensal)</option><option value="custom">Servidor próprio (coturn)</option><option value="off">Desligada (só Wi-Fi / mesma rede)</option></select></label>' +
    '<div class="turn-cf"><label>ID da chave TURN (Turn Token ID)<input id="turnKeyId" autocomplete="off" spellcheck="false" placeholder="32 letras e números"></label><label>Token da API (API Token)<input id="turnToken" type="password" autocomplete="off" spellcheck="false" placeholder="guardado só neste computador"></label>' +
    '<p class="link-note">Para obter: entre em <b>dash.cloudflare.com</b> → <b>Realtime</b> → <b>TURN Server</b> → <b>Create</b>. Copie o <b>Turn Token ID</b> e o <b>API Token</b> e cole aqui. A conta é gratuita.</p></div>' +
    '<div class="turn-own"><label>Endereços (um por linha)<textarea id="turnUrls" rows="2" spellcheck="false" placeholder="turn:turn.seudominio.com:3478\nturns:turn.seudominio.com:443?transport=tcp"></textarea></label><label>Usuário<input id="turnUser" autocomplete="off" spellcheck="false"></label><label>Senha<input id="turnPass" type="password" autocomplete="off"></label></div>' +
    '<div class="turn-actions"><button type="button" id="turnSave">Salvar e testar</button><span id="turnMessage" class="link-note" role="status"></span></div>';
  step.append(box);
  const q = s => box.querySelector(s);
  const paintForm = () => { const p = q('#turnProvider').value; q('.turn-cf').hidden = p !== 'cloudflare'; q('.turn-own').hidden = p !== 'custom'; };
  q('#turnProvider').onchange = paintForm;
  function paint(s) {
    const state = q('#turnState');
    if (s.provider === 'env') { state.textContent = 'gateway próprio'; state.dataset.tone = 'ok'; box.hidden = true; return; }
    state.textContent = s.provider === 'off' ? 'desligada · 4G/5G pode falhar' : s.ready ? 'ativa · ' + (s.provider === 'cloudflare' ? 'Cloudflare' : 'servidor próprio') : 'com problema';
    state.dataset.tone = s.provider === 'off' ? 'warn' : s.ready ? 'ok' : 'error';
    if (document.activeElement?.closest('#turnBox')) return;
    q('#turnProvider').value = s.provider === 'off' ? (box.dataset.touched ? 'off' : 'cloudflare') : s.provider;
    if (s.keyId) q('#turnKeyId').value = s.keyId;
    if (s.hasToken) q('#turnToken').placeholder = 'salvo · deixe em branco para manter';
    if (s.urls && s.provider === 'custom') q('#turnUrls').value = s.urls.join('\n');
    if (s.username) q('#turnUser').value = s.username;
    if (s.provider === 'custom') q('#turnPass').placeholder = 'salva · deixe em branco para manter';
    q('#turnMessage').textContent = s.error ? 'Problema: ' + s.error : s.ready ? 'Funcionando. Celulares em 4G/5G recebem a retransmissão automaticamente.' : '';
    if (s.provider === 'off' && !box.dataset.opened) { box.open = true; box.dataset.opened = '1'; }
    paintForm();
  }
  async function refresh() { try { const r = await fetch('/api/turn', { cache: 'no-store' }); if (r.ok) paint(await r.json()); else box.hidden = true; } catch { box.hidden = true; } }
  q('#turnSave').onclick = async () => {
    const button = q('#turnSave'); button.disabled = true; box.dataset.touched = '1'; q('#turnMessage').textContent = 'Testando…';
    try {
      const session = liveTx.session || await (await fetch('/api/session')).json();
      const body = { provider: q('#turnProvider').value, keyId: q('#turnKeyId').value, token: q('#turnToken').value, urls: q('#turnUrls').value, username: q('#turnUser').value, credential: q('#turnPass').value };
      const r = await fetch('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': session.token }, body: JSON.stringify(body) });
      const out = await r.json(); if (!r.ok) throw Error(out.error || 'Não foi possível salvar.');
      q('#turnToken').value = ''; q('#turnPass').value = ''; document.activeElement?.blur(); paint(out);
      q('#turnMessage').textContent = out.provider === 'off' ? 'Retransmissão desligada.' : 'Salvo e testado. Gere ou reenvie os convites: as câmeras já conectadas usam a retransmissão ao reconectar.';
    } catch (e) { q('#turnMessage').textContent = e.message; }
    finally { button.disabled = false; }
  };
  setInterval(() => { if (!document.hidden && !flow.closest('[hidden]')) refresh(); }, 15000);
  refresh();
})();
