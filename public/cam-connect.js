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
    '<p class="link-note">No 4G/5G a operadora esconde o celular atrás de um endereço compartilhado e a imagem não chega sem retransmissão. A <b>Rede Andrômeda</b> é a retransmissão própria do sistema (sem serviços de terceiros): roda dentro desta mesa, abre a porta no roteador sozinha e entrega ao celular uma credencial temporária junto com o convite.</p>' +
    '<label>Retransmissão<select id="turnProvider"><option value="andromeda">Rede Andrômeda nesta mesa (recomendado)</option><option value="custom">Servidor da Rede Andrômeda (empresa)</option><option value="off">Desligada (só Wi-Fi / mesma rede)</option></select></label>' +
    '<div class="turn-andromeda"><p class="link-note" id="turnOwnInfo"></p><p class="link-note">Na primeira vez, o Windows pergunta se o <b>Andrômeda Live</b> pode receber conexões: clique em <b>Permitir</b> (redes privadas e públicas). Sem isso, o celular no 4G/5G não alcança a mesa.</p></div>' +
    '<div class="turn-cf" hidden><input id="turnKeyId" hidden><input id="turnToken" hidden></div>' +
    '<div class="turn-own"><label>Endereços do servidor (um por linha)<textarea id="turnUrls" rows="2" spellcheck="false" placeholder="turn:rede.suaempresa.com.br:3478\nturn:rede.suaempresa.com.br:3478?transport=tcp"></textarea></label><label>Usuário<input id="turnUser" autocomplete="off" spellcheck="false"></label><label>Senha<input id="turnPass" type="password" autocomplete="off"></label></div>' +
    '<div class="turn-actions"><button type="button" id="turnSave">Salvar e testar</button><span id="turnMessage" class="link-note" role="status"></span></div>';
  step.append(box);
  const q = s => box.querySelector(s);
  const paintForm = () => { const p = q('#turnProvider').value; q('.turn-cf').hidden = true; q('.turn-own').hidden = p !== 'custom'; q('.turn-andromeda').hidden = p !== 'andromeda'; };
  q('#turnProvider').onchange = paintForm;
  function paint(s) {
    const state = q('#turnState');
    if (s.provider === 'env') { state.textContent = 'gateway próprio'; state.dataset.tone = 'ok'; box.hidden = true; return; }
    const own = s.provider === 'andromeda', open5g = own && s.router?.reachable;
    state.textContent = s.provider === 'off' ? 'desligada · 4G/5G pode falhar' : !s.ready ? 'com problema' : own ? (open5g ? 'Rede Andrômeda · 4G/5G pronto' : s.router ? 'Rede Andrômeda · só Wi-Fi (veja abaixo)' : 'Rede Andrômeda · abrindo a porta…') : s.provider === 'custom' ? 'ativa · servidor da Rede Andrômeda' : 'ativa · ' + s.provider;
    state.dataset.tone = s.provider === 'off' ? 'warn' : !s.ready ? 'error' : own && s.router && !open5g ? 'warn' : 'ok';
    if (own) q('#turnOwnInfo').textContent = !s.ready ? 'A retransmissão não iniciou: ' + (s.error || 'porta ocupada') + '.'
      : open5g ? 'Funcionando: porta ' + s.port + ' (UDP e TCP) aberta no roteador ' + (s.router.mapped || []).join(', ') + ' · IP público ' + s.router.externalIP + '. Celulares em 4G/5G mandam a imagem direto para esta mesa.' + (s.stats?.active ? ' Câmeras retransmitidas agora: ' + s.stats.active + '.' : '')
      : s.router ? (s.router.externalIP && !s.router.reachable ? 'A internet deste computador usa endereço compartilhado da operadora (CGNAT: ' + s.router.externalIP + '): o 4G/5G não alcança a mesa por aqui.' : 'O roteador não abriu a porta automaticamente (' + (s.router.error || 'UPnP desligado') + ').') + ' Soluções: ative o UPnP no roteador, ou encaminhe a porta ' + s.port + ' UDP e TCP para ' + s.lan + ', ou use o Servidor da Rede Andrômeda. No Wi-Fi tudo funciona normalmente.'
      : 'Retransmissão ativa na porta ' + s.port + '. Abrindo a porta no roteador…';
    if (document.activeElement?.closest('#turnBox')) return;
    q('#turnProvider').value = s.provider === 'cloudflare' ? 'andromeda' : s.provider;
    if (s.keyId) q('#turnKeyId').value = s.keyId;
    if (s.hasToken) q('#turnToken').placeholder = 'salvo · deixe em branco para manter';
    if (s.urls && s.provider === 'custom') q('#turnUrls').value = s.urls.join('\n');
    if (s.username) q('#turnUser').value = s.username;
    if (s.provider === 'custom') q('#turnPass').placeholder = 'salva · deixe em branco para manter';
    q('#turnMessage').textContent = s.provider === 'andromeda' ? '' : s.error ? 'Problema: ' + s.error : s.ready ? 'Funcionando. Celulares em 4G/5G recebem a retransmissão automaticamente.' : '';
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
