'use strict';
/*
 * Andromeda Live — transmissão multiplataforma e gravação.
 * O PROGRAM sai uma única vez do navegador; o serviço local codifica uma vez e
 * distribui para todos os destinos ativos e para o arquivo de gravação.
 * As chaves ficam só na memória, a menos que o operador peça para lembrá-las.
 */
(() => {
  const PRESETS = {
    youtube:   { name: 'YouTube',      server: 'rtmps://a.rtmps.youtube.com:443/live2',      help: 'YouTube Studio → Criar → Transmitir ao vivo → Transmissão → Chave de transmissão. Para buscar até 5 s em 1080p, selecione Latência ultrabaixa no YouTube Studio antes de entrar no ar.' },
    facebook:  { name: 'Facebook',     server: 'rtmps://live-api-s.facebook.com:443/rtmp/',   help: 'Facebook → Vídeo ao vivo → Software de streaming → Chave de stream.' },
    instagram: { name: 'Instagram',    server: 'rtmps://live-upload.instagram.com:443/rtmp/', help: 'Instagram no computador → Criar → Vídeo ao vivo. Copie a URL e a chave (conta profissional). Recebe a saída vertical 9:16, enquadrada abaixo.', aspect: '9:16' },
    twitch:    { name: 'Twitch',       server: 'rtmps://live.twitch.tv:443/app',                   help: 'Painel do criador → Configurações → Stream → Chave de transmissão principal.' },
    kick:      { name: 'Kick',         server: '',                                            help: 'Dashboard → Settings → Stream URL & Key. Copie a URL e a chave.' },
    tiktok:    { name: 'TikTok',       server: '',                                            help: 'Disponível para contas com transmissão por software liberada. Copie a URL do servidor e a chave. Recebe a saída vertical 9:16.', aspect: '9:16' },
    linkedin:  { name: 'LinkedIn',     server: '',                                            help: 'Evento ao vivo → transmitir com software (RTMP personalizado). Copie a URL e a chave.' },
    custom:    { name: 'RTMP próprio', server: '',                                            help: 'Qualquer servidor RTMP/RTMPS: informe a URL do servidor e a chave (nome do stream).' },
    srt:       { name: 'SRT',          server: '', protocol: 'srt',                           help: 'Servidor SRT (restream, emissora, nuvem): informe srt://servidor:porta, o Stream ID e a senha, se o servidor usar. Mais latência segura redes instáveis; o SRT reenvia o que se perde no caminho.' },
    whip:      { name: 'WHIP · WebRTC', server: '', protocol: 'whip',                         help: 'Atraso abaixo de 1 segundo. Cole a URL de ingestão WHIP (https://…) e o token, se o servidor pedir. A imagem sai direto da mesa por WebRTC: cada destino WHIP é mais uma codificação neste computador.' },
  };
  const protocolOf = d => PRESETS[d.platform]?.protocol || 'rtmp';
  // Destino completo: RTMP precisa de servidor e chave; SRT e WHIP, só do endereço (Stream ID, senha e token são opcionais).
  const complete = d => !!d.server.trim() && (protocolOf(d) !== 'rtmp' || !!d.key.trim());
  const START = { on: 'No ar ao iniciar', standby: 'Em espera', off: 'Desligado' };
  // Marca de cada plataforma (24×24), desenhada sobre o bloco colorido do destino. Texto fixo do programa, sem dados de fora.
  const svg = body => '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' + body + '</svg>';
  const LOGOS = {
    youtube: svg('<path fill="#fff" fill-rule="evenodd" d="M5 6.5A2.5 2.5 0 0 0 2.5 9v6A2.5 2.5 0 0 0 5 17.5h14a2.5 2.5 0 0 0 2.5-2.5V9A2.5 2.5 0 0 0 19 6.5H5zM10 9.3v5.4l4.8-2.7L10 9.3z"/>'),
    facebook: svg('<path fill="#fff" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.4 1.5-1.4h1.6V4.5c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.2H8v3h2.5V21h3z"/>'),
    instagram: svg('<rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16.8" cy="7.2" r="1.1" fill="#fff"/>'),
    twitch: svg('<path fill="#fff" fill-rule="evenodd" d="M5 3L3.5 6.5v11H8v3l3-3h3.5l6-6V3H5zM10.5 7.5v5h1.7v-5h-1.7zm4.5 0v5h1.7v-5H15z"/>'),
    kick: svg('<rect x="4.5" y="4" width="4.2" height="16" fill="#06130a"/><polygon points="9,12 15,4 20,4 13.5,12" fill="#06130a"/><polygon points="9,12 13.5,12 20,20 15,20" fill="#06130a"/>'),
    tiktok: svg('<g transform="translate(-.7 -.5)"><path fill="#25f4ee" d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.3a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.8 5.8 0 1 0 5 5.7V9.2a7.3 7.3 0 0 0 4.2 1.4V7.5a4.3 4.3 0 0 1-3.3-1.7z"/></g><path transform="translate(.7 .5)" fill="#fe2c55" d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.3a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.8 5.8 0 1 0 5 5.7V9.2a7.3 7.3 0 0 0 4.2 1.4V7.5a4.3 4.3 0 0 1-3.3-1.7z"/><path fill="#fff" d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.3a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.8 5.8 0 1 0 5 5.7V9.2a7.3 7.3 0 0 0 4.2 1.4V7.5a4.3 4.3 0 0 1-3.3-1.7z"/>'),
    linkedin: svg('<rect x="4.5" y="9.5" width="3.2" height="10" fill="#fff"/><circle cx="6.1" cy="5.9" r="1.9" fill="#fff"/><path fill="#fff" d="M10 9.5h3v1.4c.5-.9 1.6-1.7 3.2-1.7 3 0 3.6 2 3.6 4.6v5.7h-3.2v-5c0-1.2-.02-2.6-1.7-2.6-1.7 0-2 1.3-2 2.6v5H10v-10z"/>'),
    srt: svg('<path d="M4 8h11M4 16h11" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M13 5l4 3-4 3M13 13l4 3-4 3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="8" r="1.4" fill="#fff"/><circle cx="20" cy="16" r="1.4" fill="#fff"/>'),
    whip: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" fill="#fff"/>'),
    custom: svg('<circle cx="12" cy="12" r="2" fill="#fff"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" stroke="#fff" fill="none" stroke-width="1.7" stroke-linecap="round"/>'),
  };
  const STORE = 'andromeda.broadcast.v1';
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const gb = bytes => bytes == null ? '—' : bytes >= 1e12 ? (bytes / 1e12).toFixed(2) + ' TB' : bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(bytes / 1e6)) + ' MB';

  const model = { recordFormats: '16:9', formatsVersion: 3, destinations: [{ id: uid(), platform: 'youtube', name: 'YouTube', server: PRESETS.youtube.server, key: '', enabled: true, aspect: '16:9' }], resolution: '1080p', policy: 'fixed', bitrate: 6, encoder: 'auto', record: false, dir: '', remember: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && Array.isArray(saved.destinations)) Object.assign(model, saved, { destinations: saved.destinations.filter(d => PRESETS[d.platform]).slice(0, 6).map(d => {
      const start = START[d.start] ? d.start : d.enabled !== false ? 'on' : 'off';
      return { id: d.id || uid(), platform: d.platform, name: String(d.name || PRESETS[d.platform].name), server: String(d.server || ''), key: saved.remember ? String(d.key || '') : '', passphrase: saved.remember ? String(d.passphrase || '') : '', latency: [200, 500, 1000, 2000, 4000].includes(d.latency) ? d.latency : 2000, start, enabled: start !== 'off', aspect: ['16:9', '9:16'].includes(d.aspect) ? d.aspect : PRESETS[d.platform].aspect || '16:9' };
    }) });
  } catch { /* primeiro uso */ }
  // O padrão antigo habilitava duas capturas sem exigir uma escolha explícita.
  if (model.formatsVersion !== 3) {
    if (!['16:9', '9:16', 'both'].includes(model.recordFormats)) model.recordFormats = '16:9';
    model.formatsVersion = 3;
  }
  // Modo de saída escolhido pelo operador: transmitir e gravar, só transmitir ou só gravar.
  const MODES = { both: 'Transmitir e gravar', stream: 'Só transmitir', record: 'Só gravar' };
  if (!MODES[model.mode]) model.mode = model.record ? 'both' : 'stream';
  model.record = model.mode !== 'stream';
  const streaming = () => model.mode !== 'record';
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...model, destinations: model.destinations.map(d => ({ ...d, key: model.remember ? d.key : '', passphrase: model.remember ? d.passphrase || '' : '' })) })); } catch { /* sem armazenamento */ } };
  // Estado de cada destino na live: states (conectando, no ar, reconectando, em espera, fora do ar), rates (Mbps e hora de entrada),
  // sent (destinos que esta live conhece no serviço) e whip (sessões WebRTC, uma por destino WHIP).
  const live = { states: new Map(), rates: new Map(), sent: new Set(), whip: new Map(), recording: null, recorded: null, files: [], storage: null, checked: null };
  // A compensação de sincronismo é medida e guardada por motor: cada um tem o seu atraso próprio de captura e codificação.
  const avSyncFor = engine => (engine === 'native' ? model.avSyncNativeMs : model.avSyncMs) || 0;
  window.andromedaBroadcast = { model, live, save, avSyncFor };

  const active = () => model.destinations.filter(d => d.enabled && complete(d));
  const pending = () => model.destinations.filter(d => d.enabled && !complete(d));
  const onAtStart = () => active().filter(d => d.start !== 'standby');

  /* ---------- formato da produção: horizontal 16:9 ou vertical 9:16 ----------
   * Live só para Instagram/TikTok é produzida na vertical: o PGM inteiro passa a 1080×1920, as câmeras preenchem a tela
   * (sem bordas laterais), GC e logotipo se ajustam à tela em pé e sai uma única imagem, já em 9:16.
   * Automático: vertical quando todos os destinos da live são 9:16, contando os que entram depois (em espera ou desligados,
   * mas prontos); em "Só gravar", quando a gravação é só 9:16. Basta um YouTube pronto para a live ser horizontal. */
  const liveCandidates = () => model.destinations.filter(d => d.enabled || complete(d)); // podem ir ao ar nesta live
  const PRODUCTION = { auto: 'Automático', '16:9': 'Horizontal 16:9', '9:16': 'Vertical 9:16' };
  if (!PRODUCTION[model.production]) model.production = 'auto';
  function wantsVertical() {
    if (model.production !== 'auto') return model.production === '9:16';
    const dests = streaming() ? liveCandidates() : [];
    if (!dests.length) return model.record && model.recordFormats === '9:16';
    return dests.every(d => d.aspect === '9:16');
  }
  // Na live vale o formato com que ela começou; fora dela, o escolhido.
  const productionVertical = () => busyTx() ? !!liveTx.vertical : wantsVertical();
  const orient = ([w, h]) => productionVertical() ? [Math.min(w, h), Math.max(w, h)] : [Math.max(w, h), Math.min(w, h)];
  window.andromedaOrient = orient;
  window.andromedaFormat = { get vertical() { return productionVertical(); }, get mode() { return model.production; }, wantsVertical };
  // Saída 9:16 da mesa: na produção vertical é o próprio PGM; na horizontal, a versão 9:16 montada do PGM (vertical.js).
  const vOut = () => liveTx.vertical ? programOutput : window.andromedaVertical?.canvas;
  const vSize = () => liveTx.vertical ? [1080, 1920] : window.andromedaVertical.size();
  let shownVertical = null;
  function applyProduction() {
    const v = productionVertical(), first = shownVertical === null; if (v === shownVertical) return; shownVertical = v;
    document.body.classList.toggle('prod-vertical', v);
    for (const c of [$('#monProgram canvas'), $('#monPreview canvas')]) if (c) { const [w, h] = orient([c.width, c.height]); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    if (!busyTx()) for (const c of [hdBase, overlay, programOutput]) { const [w, h] = orient([c.width, c.height]); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    try { window.andromedaPgm?.apply(); } catch { /* aplicado no próximo ciclo */ }
    if (!first) { log(v ? 'Produção vertical 9:16: PGM em 1080×1920, câmeras preenchendo a tela (sem bordas laterais).' : 'Produção horizontal 16:9.'); window.andromedaAudit?.('info', 'formato-producao', v ? 'Produção vertical 9:16' : 'Produção horizontal 16:9'); }
    window.dispatchEvent(new CustomEvent('andromeda-format', { detail: { vertical: v } }));
  }
  // O que vai ao serviço para um destino RTMP/SRT (WHIP fica na mesa).
  const payload = d => ({ id: d.id, platform: d.platform, name: d.name, server: d.server.trim(), key: d.key.trim(), aspect: d.aspect || '16:9', on: d.start !== 'standby', passphrase: (d.passphrase || '').trim(), latency: d.latency || 2000 });

  /* ---------- painel de destinos ---------- */

  const panel = $('.stream-panel'), row = $('.stream-row');
  row.className = 'stream-row broadcast'; row.replaceChildren();
  const prod = make('section', 'prod-format'); prod.setAttribute('aria-label', 'Formato da produção');
  const prodHead = make('header'); prodHead.append(make('strong', '', 'Formato da produção'));
  const prodBox = make('div', 'tx-mode prod-modes'); prodBox.setAttribute('role', 'radiogroup'); prodBox.setAttribute('aria-label', 'Formato da produção');
  const PROD_TIPS = { auto: 'Vertical quando todos os destinos ligados são 9:16 (Instagram, TikTok); senão horizontal.', '16:9': 'PGM deitado (YouTube, Facebook…). Destinos 9:16 recebem um recorte do PGM.', '9:16': 'PGM em pé, 1080×1920, para live só no Instagram/TikTok. Câmeras preenchem a tela, sem bordas laterais.' };
  const prodButtons = Object.entries(PRODUCTION).map(([id, label]) => { const b = make('button', '', label); b.type = 'button'; b.dataset.production = id; b.title = PROD_TIPS[id]; b.setAttribute('role', 'radio'); b.onclick = () => { if (busyTx()) return; model.production = id; save(); summary(); }; prodBox.append(b); return b; });
  const prodNote = make('p', 'prod-note');
  prod.append(prodHead, prodBox, prodNote);
  row.before(prod);
  function paintProduction() {
    const v = productionVertical(), busy = busyTx();
    for (const b of prodButtons) { const sel = b.dataset.production === model.production; b.setAttribute('aria-checked', String(sel)); b.setAttribute('aria-pressed', String(sel)); b.disabled = busy; }
    const wrong = v && streaming() ? liveCandidates().filter(d => d.aspect !== '9:16') : [];
    prod.dataset.vertical = String(v);
    prodNote.dataset.tone = wrong.length ? 'bad' : '';
    prodNote.textContent = (v ? 'Agora: VERTICAL 9:16 · PGM 1080×1920 · as câmeras preenchem a tela, sem bordas laterais · uma imagem só para todos os destinos 9:16' + (model.record ? ' e a gravação 9:16' : '') + '.' : 'Agora: HORIZONTAL 16:9 · PGM 1920×1080' + (liveCandidates().some(d => d.aspect === '9:16') ? ' · os destinos 9:16 recebem o recorte vertical do PGM.' : '.'))
      + (wrong.length ? ' Atenção: ' + wrong.map(d => d.name).join(', ') + (wrong.length === 1 ? ' é 16:9 e fica' : ' são 16:9 e ficam') + ' fora da produção vertical. Desligue ou mude o formato para Horizontal.' : '')
      + (busy ? ' (vale até o fim desta live)' : '');
  }
  const list = make('div', 'dest-list'), adder = make('div', 'dest-add'), quality = make('div', 'quality');
  row.append(list, adder, quality);
  const choose = make('select'); choose.id = 'destPlatform'; choose.setAttribute('aria-label', 'Plataforma do novo destino');
  for (const [id, p] of Object.entries(PRESETS)) choose.add(new Option(p.name, id));
  const add = make('button', '', 'Adicionar destino'); add.type = 'button'; add.id = 'destAdd';
  const remember = make('label', 'stage-check'), rememberBox = make('input'); rememberBox.type = 'checkbox'; rememberBox.id = 'destRemember'; rememberBox.checked = model.remember;
  remember.append(rememberBox, 'Lembrar chaves neste computador');
  adder.append(choose, add, remember);
  add.onclick = () => {
    if (model.destinations.length >= 6) { log('Limite de 6 destinos simultâneos'); return; }
    // Durante a live, o destino novo entra em espera: o operador põe no ar quando quiser, com o botão do próprio cartão.
    const p = PRESETS[choose.value], start = busyTx() ? 'standby' : 'on';
    model.destinations.push({ id: uid(), platform: choose.value, name: p.name, server: p.server, key: '', passphrase: '', latency: 2000, start, enabled: true, aspect: p.aspect || '16:9' });
    save(); render();
  };
  rememberBox.onchange = () => { model.remember = rememberBox.checked; save(); };

  const clock = ms => { const t = Math.max(0, Math.floor(ms / 1000)), two = n => String(n).padStart(2, '0'); return two(Math.floor(t / 3600)) + ':' + two(Math.floor(t / 60) % 60) + ':' + two(t % 60); };
  // No ar = este destino está recebendo; conectando/reconectando = tentando. Os três contam como "ligado" para o botão do cartão.
  const airing = d => ['sending', 'connecting', 'retrying'].includes(live.states.get(d.id)?.state);
  function statusOf(d) {
    const state = live.states.get(d.id);
    if (busyTx() && state) {
      const rate = live.rates.get(d.id), extra = rate?.kbps ? (rate.kbps / 1000).toFixed(1).replace('.', ',') + ' Mbps' + (rate.since ? ' · ' + clock(Date.now() - rate.since) + ' no ar' : '') : '';
      switch (state.state) {
        case 'sending': return ['NO AR', 'on', extra];
        case 'connecting': return ['CONECTANDO', 'wait', ''];
        case 'retrying': return ['RECONECTANDO', 'bad', state.reason];
        case 'stopping': return ['SAINDO DO AR', 'wait', ''];
        case 'standby': return ['EM ESPERA', 'ready', 'Pronto para entrar no ar.'];
        case 'off': return ['FORA DO AR', 'off', 'Saiu do ar. Os outros destinos continuam.'];
        case 'error': return ['ERRO', 'bad', state.reason];
        case 'warning': return ['CONECTANDO', 'wait', state.reason];
      }
    }
    if (busyTx() && complete(d)) return ['FORA DO AR', 'off', 'Pode entrar no ar agora.'];
    if (!d.enabled) return ['DESLIGADO', 'off', ''];
    if (!complete(d)) return ['FALTA ' + (!d.server.trim() ? (protocolOf(d) === 'whip' ? 'URL' : 'SERVIDOR') : 'CHAVE'), 'wait', ''];
    return [d.start === 'standby' ? 'EM ESPERA' : 'PRONTO', 'ready', state?.state === 'warning' ? state.reason : ''];
  }
  function paintStatus() {
    const busy = busyTx(), sending = liveTx.phase === 'sending';
    for (const card of list.children) {
      const d = model.destinations.find(x => x.id === card.dataset.id); if (!d) continue;
      const [text, tone, detail] = statusOf(d), pill = card.querySelector('.dest-state');
      pill.textContent = text; pill.dataset.tone = tone; card.querySelector('.dest-detail').textContent = detail;
      // Durante a live: quem está no ar não muda de configuração; quem está fora pode ser editado e entrar no ar.
      const on = busy && airing(d), air = card.querySelector('.dest-air');
      card.querySelectorAll('input, select, .dest-key button').forEach(el => { el.disabled = on || (busy && el.classList.contains('dest-start')); });
      card.querySelector('.dest-remove').disabled = busy;
      air.hidden = !busy || !streaming(); air.disabled = !sending || !complete(d) || live.states.get(d.id)?.state === 'stopping';
      air.textContent = on ? '■ Sair do ar' : '▶ Entrar no ar'; air.dataset.on = String(on);
      card.dataset.air = on ? 'on' : '';
    }
    add.disabled = choose.disabled = model.destinations.length >= 6 || liveTx.phase === 'stopping';
    quality.querySelectorAll('select, input').forEach(el => { el.disabled = busyTx(); });
  }
  function render() {
    list.replaceChildren(...model.destinations.map(d => {
      const p = PRESETS[d.platform], card = make('article', 'dest'); card.dataset.id = d.id; card.dataset.platform = d.platform;
      const head = make('header'), badge = make('span', 'dest-badge'), title = make('input', 'dest-name');
      badge.innerHTML = LOGOS[d.platform] || LOGOS.custom; badge.setAttribute('role', 'img'); badge.setAttribute('aria-label', p.name);
      title.value = d.name; title.maxLength = 40; title.setAttribute('aria-label', 'Nome do destino');
      const proto = protocolOf(d);
      // Como o destino começa a live: no ar, em espera (entra quando o operador quiser) ou desligado.
      const startSel = make('select', 'dest-start'); for (const [k, v] of Object.entries(START)) startSel.add(new Option(v, k)); startSel.value = d.start || (d.enabled ? 'on' : 'off');
      startSel.setAttribute('aria-label', 'Como ' + d.name + ' começa a transmissão');
      const pill = make('span', 'dest-state'), remove = make('button', 'dest-remove', 'Remover'); remove.type = 'button';
      const air = make('button', 'dest-air', '▶ Entrar no ar'); air.type = 'button'; air.hidden = true; air.setAttribute('aria-label', 'Entrar ou sair do ar em ' + d.name);
      head.append(badge, title, pill, air, startSel, remove);
      const server = make('label', '', proto === 'srt' ? 'Servidor SRT' : proto === 'whip' ? 'URL de ingestão WHIP' : 'Servidor (URL RTMP)'), serverInput = make('input'); serverInput.type = 'url'; serverInput.value = d.server; serverInput.placeholder = proto === 'srt' ? 'srt://servidor:porta' : proto === 'whip' ? 'https://…/whip' : 'rtmp:// ou rtmps://'; serverInput.spellcheck = false; serverInput.autocomplete = 'off'; server.append(serverInput);
      const key = make('label', '', proto === 'srt' ? 'Stream ID (opcional)' : proto === 'whip' ? 'Token (opcional)' : 'Chave de transmissão'), keyRow = make('span', 'dest-key'), keyInput = make('input'), show = make('button', '', 'Mostrar');
      keyInput.type = 'password'; keyInput.value = d.key; keyInput.autocomplete = 'off'; keyInput.spellcheck = false; keyInput.placeholder = proto === 'srt' ? 'Ex.: live/minha-chave' : proto === 'whip' ? 'Bearer token do servidor' : 'Cole a chave da plataforma'; show.type = 'button';
      show.onclick = () => { const reveal = keyInput.type === 'password'; keyInput.type = reveal ? 'text' : 'password'; show.textContent = reveal ? 'Ocultar' : 'Mostrar'; };
      keyRow.append(keyInput, show); key.append(keyRow);
      const aspect = make('label', 'dest-aspect', 'Formato'), aspectSelect = make('select');
      aspectSelect.add(new Option('16:9 · horizontal', '16:9')); aspectSelect.add(new Option('9:16 · vertical', '9:16')); aspectSelect.value = d.aspect || '16:9';
      aspectSelect.setAttribute('aria-label', 'Formato de tela de ' + d.name); aspect.append(aspectSelect);
      aspectSelect.onchange = () => { d.aspect = aspectSelect.value; card.dataset.aspect = d.aspect; save(); summary(); };
      card.dataset.aspect = d.aspect || '16:9';
      const fields = make('div', 'dest-fields'); fields.append(server, key, aspect);
      if (proto === 'srt') {
        const pass = make('label', '', 'Senha SRT (opcional, 10 a 79 caracteres)'), passInput = make('input'); passInput.type = 'password'; passInput.value = d.passphrase || ''; passInput.autocomplete = 'off'; passInput.spellcheck = false; passInput.placeholder = 'Criptografia AES do sinal'; pass.append(passInput);
        const lat = make('label', '', 'Latência'), latSel = make('select'); for (const ms of [200, 500, 1000, 2000, 4000]) latSel.add(new Option(ms + ' ms' + (ms === 2000 ? ' · padrão' : ms <= 500 ? ' · rede local' : ms === 4000 ? ' · rede ruim' : ''), String(ms))); latSel.value = String(d.latency || 2000); lat.append(latSel);
        passInput.oninput = () => { d.passphrase = passInput.value.trim(); save(); };
        latSel.onchange = () => { d.latency = Number(latSel.value); save(); };
        fields.append(pass, lat);
      }
      // Um clique para a sala de controle ao vivo da plataforma (pré-requisito do YouTube Live Verified): conferir a saúde do stream e a latência.
      const studio = STUDIO_URL[d.platform]; const go = studio ? Object.assign(make('a', 'dest-studio', 'Abrir o painel ao vivo do ' + p.name + ' ↗'), { href: studio, target: '_blank', rel: 'noopener noreferrer' }) : null;
      card.append(head, fields, make('p', 'dest-help', p.help), ...(go ? [go] : []), make('p', 'dest-detail'));
      title.oninput = () => { d.name = title.value; save(); };
      serverInput.oninput = () => { d.server = serverInput.value; if (!busyTx()) live.states.delete(d.id); save(); paintStatus(); summary(); };
      keyInput.oninput = () => { d.key = keyInput.value.trim(); save(); paintStatus(); summary(); };
      startSel.onchange = () => { d.start = startSel.value; d.enabled = d.start !== 'off'; save(); paintStatus(); summary(); };
      remove.onclick = () => { model.destinations.splice(model.destinations.indexOf(d), 1); save(); render(); };
      air.onclick = () => { if (airing(d)) leaveAir(d); else enterAir(d); };
      return card;
    }));
    paintStatus(); summary();
  }

  /* ---------- qualidade ---------- */

  const CAP_KEY = 'andromeda.tx.cap.v273';
  // Limite de bitrate por plataforma em 1080p30 (Mbps), das diretrizes publicadas de cada uma. Destinos sem limite conhecido: sem teto.
  const STUDIO_URL = { youtube: 'https://studio.youtube.com/channel/UC/livestreaming', facebook: 'https://www.facebook.com/live/producer', twitch: 'https://dashboard.twitch.tv/stream-manager', linkedin: 'https://www.linkedin.com/video/golive/now/', kick: 'https://dashboard.kick.com/' };
  const PLATFORM_CAP_MBPS = { facebook: 6, twitch: 6, linkedin: 6, instagram: 6, tiktok: 6, kick: 8, youtube: 14 };
  const vRate = () => Math.min(liveTx.vCap || 12, Math.max(6, window.andromedaVertical?.settings.bitrate || 6));
  function readCap() { try { const v = JSON.parse(localStorage.getItem(CAP_KEY) || 'null'); return v && Date.now() - v.at < 14 * 864e5 ? v : null; } catch { return null; } }
  function writeCap(res) { try { localStorage.setItem(CAP_KEY, JSON.stringify({ res, at: Date.now() })); } catch { /* sem armazenamento */ } }
  function clearCap() { try { localStorage.removeItem(CAP_KEY); localStorage.removeItem(BENCH_KEY); } catch { /* sem armazenamento */ } }
  const BENCH_KEY = 'andromeda.tx.bench.v273';
  function readBench(req) { try { const v = JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); return v && v.req === req && Date.now() - v.at < 7 * 864e5 ? v : null; } catch { return null; } }
  function writeBench(req, res, fps) { try { localStorage.setItem(BENCH_KEY, JSON.stringify({ req, res, fps, at: Date.now() })); } catch { /* sem armazenamento */ } }
  const field = (text, control) => { const label = make('label', '', text); label.append(control); return label; };
  const resolution = make('select'); resolution.id = 'txResolution'; for (const r of ['1080p', '2160p']) resolution.add(new Option(r === '2160p' ? '4K 3840×2160 · 30 fps' : '1080p · 30 fps', r));
  const bitrate = make('input'); bitrate.id = 'txBitrate'; bitrate.type = 'number'; bitrate.min = 6; bitrate.max = 20; bitrate.step = .5;
  const encoder = make('select'); encoder.id = 'txEncoder'; encoder.add(new Option('Automático · priorizar GPU', 'auto')); encoder.add(new Option('Processador (x264)', 'libx264'));
  const upload = make('p', 'quality-note');
  const policy = make('select');
  policy.add(new Option('1080p fixo · 30 fps CFR', 'fixed'));
  policy.add(new Option('4K 3840×2160 fixo · 30 fps CFR', 'fixed4k'));
  // Regra da Andrômeda: a saída é sempre 1080p (ou 4K) a 30 fps constantes. Não existe perfil que desça para 720p/540p.
  if (!['fixed','fixed4k'].includes(model.policy)) model.policy = 'fixed';
  policy.value = model.policy;
  policy.onchange = () => { model.policy = policy.value; model.resolution = policy.value === 'fixed4k' ? '2160p' : '1080p'; resolution.value = model.resolution; model.bitrate = policy.value === 'fixed4k' ? Math.max(30, model.bitrate, 42) : Math.min(20, model.bitrate); bitrate.max=policy.value === 'fixed4k'?60:20; bitrate.value=model.bitrate; clearCap(); save(); summary(); };
  quality.append(field('Perfil de saída', policy));
  // Conformidade técnica: o que a mesa vai entregar, item por item, conferido contra as diretrizes publicadas de cada plataforma.
  const compliance = make('section', 'tx-compliance'); compliance.setAttribute('aria-label', 'Conformidade técnica da transmissão');
  quality.append(field('Resolução', resolution), field('Bitrate de vídeo (Mbps)', bitrate), field('Codificador', encoder), upload, compliance);
  if (!['1080p','2160p'].includes(model.resolution)) model.resolution = '1080p'; // configuração salva antes com 720p
  if (model.policy === 'fixed4k') model.resolution = '2160p';
  if (model.resolution === '2160p') model.policy = 'fixed4k';
  model.bitrate = model.resolution === '2160p' ? Math.min(60, Math.max(30, model.bitrate)) : Math.min(20, Math.max(6, model.bitrate)); // 1080p30: no mínimo 6 Mbps
  policy.value = model.policy;
  resolution.value = model.resolution; bitrate.max = model.resolution === '2160p' ? 60 : 20; bitrate.value = model.bitrate;
  resolution.onchange = () => { model.resolution = resolution.value; model.policy=resolution.value==='2160p'?'fixed4k':'fixed'; policy.value=model.policy; model.bitrate = model.policy === 'fixed4k' ? Math.min(60, Math.max(30, model.bitrate, 42)) : Math.min(20, model.bitrate); bitrate.max=model.policy==='fixed4k'?60:20; bitrate.value=model.bitrate; clearCap(); save(); summary(); };
  bitrate.onchange = () => { model.bitrate = Math.max(model.resolution === '2160p' ? 30 : 6, Math.min(model.resolution === '2160p' ? 60 : 20, Number(bitrate.value) || 6)); bitrate.value = model.bitrate; save(); summary(); };
  encoder.onchange = () => { model.encoder = encoder.value; save(); };
  const ENCODER_NAMES = { h264_nvenc: 'Placa NVIDIA (NVENC)', h264_qsv: 'Intel Quick Sync', h264_amf: 'Placa AMD (AMF)', h264_videotoolbox: 'Apple VideoToolbox' };
  function offerEncoders(session) {
    for (const id of session?.encoders || []) if (id !== 'libx264' && ![...encoder.options].some(o => o.value === id)) encoder.add(new Option(ENCODER_NAMES[id] || id, id));
    encoder.value = [...encoder.options].some(o => o.value === model.encoder) ? model.encoder : 'libx264';
  }

  /* ---------- gravação ---------- */

  const rec = make('section', 'record-panel');
  rec.innerHTML = '<header><strong>Gravação</strong><label class="stage-check"><input id="recEnable" type="checkbox">Gravar junto com a transmissão</label></header><div class="rec-body"><label>Pasta de gravação<span class="dest-key"><input id="recDir" type="text" spellcheck="false" autocomplete="off" placeholder="Escolha uma unidade abaixo ou digite o caminho completo"><button id="recCheck" type="button">Verificar pasta</button></span></label><div id="recVolumes" class="volumes" aria-label="Unidades detectadas"></div><p id="recStatus" class="quality-note" role="status"></p></div>';
  // Saída vertical 9:16: prévia e enquadramento (public/vertical.js).
  const verticalCard = window.andromedaVertical?.mount(panel, { onChange: () => summary() });
  panel.append(rec);
  const recEnable = $('#recEnable'), recDir = $('#recDir'), recStatus = $('#recStatus');
  const recFormats = make('select'); recFormats.id = 'recFormats';
  for (const [v, t] of [['both', '16:9 e 9:16 · dois arquivos'], ['16:9', 'Só 16:9 · horizontal'], ['9:16', 'Só 9:16 · vertical']]) recFormats.add(new Option(t, v));
  recFormats.value = ['16:9', '9:16', 'both'].includes(model.recordFormats) ? model.recordFormats : '16:9';
  const recFormatsLabel = make('label', 'rec-formats', 'Formato da gravação'); recFormatsLabel.append(recFormats);
  rec.querySelector('.rec-body').prepend(recFormatsLabel);
  recFormats.onchange = () => { model.recordFormats = recFormats.value; save(); summary(); };
  recEnable.checked = model.record; recDir.value = model.dir;
  recEnable.onchange = () => setMode(recEnable.checked ? (model.mode === 'stream' ? 'both' : model.mode) : 'stream');
  recDir.onchange = () => { model.dir = recDir.value.trim(); live.checked = null; save(); summary(); };
  async function api(path, body) {
    const session = liveTx.session || await checkBridge(); if (!session) throw Error('Serviço local indisponível.');
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Andromeda-Token': session.token }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await r.json().catch(() => ({})); if (!r.ok) throw Error(data.error || 'Falha no serviço local.'); return data;
  }
  async function checkDir() {
    if (!model.dir) { recStatus.textContent = 'Escolha a pasta de gravação.'; return null; }
    try { live.checked = await api('/api/storage/check', { dir: model.dir }); summary(); return live.checked; }
    catch (e) { live.checked = null; recStatus.textContent = e.message; recStatus.dataset.tone = 'bad'; return null; }
  }
  $('#recCheck').onclick = checkDir;
  const KIND = { removable: 'Removível', disk: 'Disco adicional', system: 'Sistema' };
  async function refreshVolumes() {
    if (document.hidden || busyTx()) return;
    try {
      live.storage = await api('/api/storage');
      $('#recVolumes').replaceChildren(...live.storage.volumes.map(v => {
        const b = make('button', 'volume'); b.type = 'button'; b.dataset.kind = v.kind;
        b.append(make('strong', '', v.label), make('span', '', v.path), make('em', '', KIND[v.kind] + ' · ' + gb(v.free) + ' livres de ' + gb(v.total)));
        const target = v.kind === 'system' ? live.storage.defaultDir : v.path.replace(/[\\/]$/, '') + (v.path.includes('\\') ? '\\' : '/') + 'Andromeda Live';
        b.setAttribute('aria-pressed', String(model.dir === target));
        b.onclick = () => { recDir.value = model.dir = target; save(); refreshVolumes(); checkDir(); };
        return b;
      }));
    } catch { /* serviço fechado: o estado do codificador já avisa */ }
  }

  /* ---------- resumo e botões ---------- */

  const startButton = $('#transmitYouTube'), armButton = $$('.page-toolbar .btn-rec')[0] || $('.btn-rec');
  const modeBox = make('div', 'tx-mode'); modeBox.setAttribute('role', 'radiogroup'); modeBox.setAttribute('aria-label', 'O que fazer com o PROGRAM');
  const modeButtons = Object.entries(MODES).map(([id, label]) => { const b = make('button', '', label); b.type = 'button'; b.dataset.mode = id; b.setAttribute('role', 'radio'); b.onclick = () => setMode(id); modeBox.append(b); return b; });
  startButton.after(modeBox);
  function setMode(mode) {
    if (busyTx() || !MODES[mode]) return;
    model.mode = mode; model.record = mode !== 'stream'; recEnable.checked = model.record; save();
    if (model.record && !model.dir && live.storage) { recDir.value = model.dir = live.storage.defaultDir; save(); checkDir(); }
    txStatus(mode === 'record' ? 'Só gravar: nenhuma plataforma recebe o sinal; os destinos ficam como estão.' : mode === 'stream' ? 'Só transmitir: nada é gravado neste computador.' : 'Transmitir e gravar: o mesmo PROGRAM vai para os destinos e para o arquivo.');
    summary();
  }
  $$('button').filter(b => b.textContent === 'Configurar YouTube').forEach(b => b.remove());
  armButton.disabled = false; armButton.id = 'recArm';
  armButton.hidden = true; // substituído pela escolha de modo ao lado do botão principal
  recEnable.closest('label').hidden = true;

  const lastFiles = () => 'Última gravação: ' + (live.files.length ? live.files : [live.recorded]).map(f => (f.format ? f.format + ' → ' : '') + f.file + ' (' + gb(f.size) + ')').join(' · ');
  function summary() {
    applyProduction(); paintProduction();
    { const vc = document.querySelector('.vertical-panel'); if (vc) vc.hidden = productionVertical(); } // na produção vertical não há recorte: o PGM já é 9:16
    const on = streaming() ? onAtStart().length : 0, vert = streaming() ? onAtStart().filter(d => d.aspect === '9:16') : [], vbit = vRate();
    const total = model.bitrate * (on - vert.length) + vbit * vert.length;
    window.andromedaVertical?.setUses(model.destinations.filter(d => streaming() && d.enabled && d.aspect === '9:16').map(d => d.name).concat(model.record && model.recordFormats !== '16:9' ? ['gravação'] : []));
    paintCompliance();
    const waiting = streaming() ? active().length - on : 0;
    upload.textContent = !streaming() ? 'Só gravar: nada é enviado às plataformas.' : on || waiting ? (on ? 'Envio simultâneo para ' + on + ' destino(s): reserve pelo menos ' + (total * 1.3).toFixed(0) + ' Mbps de upload estável.' : 'Nenhum destino no ar ao iniciar.') + (waiting ? ' ' + waiting + ' em espera: entram no ar quando você quiser, com a live rodando.' : '') : 'Nenhum destino pronto: informe servidor e chave.';
    if (model.record) {
      const vbit = vRate(), rate = (model.recordFormats !== '9:16' ? model.bitrate * 1000 + 128 : 0) + (model.recordFormats !== '16:9' ? vbit * 1000 + 128 : 0);
      const perHour = rate * 3600 / 8 / 1e6, free = live.checked?.free;
      recStatus.dataset.tone = '';
      recStatus.textContent = live.recorded ? lastFiles() : !model.dir ? 'Escolha a pasta de gravação.' : 'Cerca de ' + perHour.toFixed(1) + ' GB por hora' + (free != null ? ' · ' + gb(free) + ' livres (' + Math.floor(free / 1e9 / perHour) + ' h de gravação)' : ' · clique em Verificar pasta') + '. ' + (model.recordFormats === 'both' ? 'Dois arquivos MP4: 16:9 e 9:16.' : 'Arquivo MP4 ' + model.recordFormats + '.') + ' (H.264 + AAC)';
    } else recStatus.textContent = live.recorded ? lastFiles() : 'Gravação desligada.';
    paintButtons();
  }
  function paintCompliance() {
    const list = streaming() ? active() : [], vprod = productionVertical(), res = vprod ? '1080×1920 (vertical)' : model.resolution === '2160p' ? '3840×2160' : '1920×1080';
    const rows = [
      ['ok', 'Vídeo', res + ' · 30 fps constantes (regra Andrômeda: nunca abaixo de 1080p30)'],
      ['ok', 'Codificação', 'H.264 High@' + (model.resolution === '2160p' ? '5.1' : '4.1') + ' · bitrate constante (CBR) · quadro-chave a cada 2 s'],
      ['ok', 'Áudio', 'AAC-LC · 48 kHz · estéreo · 160 kbps'],
    ];
    // Uma codificação por formato: todos os destinos 16:9 recebem o mesmo vídeo (e o mesmo bitrate), idem os 9:16.
    const capList = ds => Math.min(Infinity, ...ds.map(d => PLATFORM_CAP_MBPS[d.platform] || Infinity));
    const h = list.filter(d => d.aspect !== '9:16'), v = list.filter(d => d.aspect === '9:16'), capH = capList(h);
    const rateH = model.resolution === '1080p' ? Math.min(capH, model.bitrate) : model.bitrate, rateV = Math.min(capList(v), vRate());
    const limiter = h.filter(d => PLATFORM_CAP_MBPS[d.platform] === capH).map(d => d.name).join(', ');
    if (h.length) rows.push(['ok', 'Saída 16:9', res + ' · ' + rateH + ' Mbps · uma codificação para ' + h.length + (h.length === 1 ? ' destino' : ' destinos') + (rateH < model.bitrate ? ' (ajustado ao limite de ' + limiter + ')' : '')]);
    if (v.length) rows.push(['ok', 'Saída 9:16', '1080×1920 · ' + rateV + ' Mbps · uma codificação para ' + v.length + (v.length === 1 ? ' destino' : ' destinos') + (vprod ? ' · produção vertical: o próprio PGM, sem recorte e sem bordas' : ' · recorte do PGM 16:9')]);
    if (vprod && h.length) rows.push(['warn', 'Formato', h.map(d => d.name).join(', ') + ': 16:9 não entra na produção vertical.']);
    for (const d of list) {
      const proto = protocolOf(d), secure = proto === 'srt' ? !!(d.passphrase || '').trim() : proto === 'whip' ? true : /^rtmps:/i.test(d.server.trim());
      const how = proto === 'srt' ? (secure ? 'SRT com senha (AES)' : 'SRT sem senha: defina uma senha se o servidor aceitar') + ' · latência ' + (d.latency || 2000) + ' ms'
        : proto === 'whip' ? 'WHIP · WebRTC criptografado (DTLS-SRTP) · atraso abaixo de 1 s · codificação própria na mesa'
        : secure ? 'RTMPS (criptografado)' : 'RTMP sem criptografia: use o endereço rtmps:// se a plataforma oferecer';
      rows.push([secure ? 'ok' : 'warn', d.name || d.platform, (d.aspect === '9:16' ? 'recebe a saída 9:16' : 'recebe a saída 16:9') + ' · ' + how + ' · ' + (d.start === 'standby' ? 'em espera, entra no ar quando você quiser' : 'no ar ao iniciar') + ' · conexão própria, com reconexão automática']);
    }
    if (list.length) rows.push(['ok', 'Upload', 'reserve ' + Math.ceil((rateH * h.length + rateV * v.length) * 1.3) + ' Mbps estáveis de upload para ' + list.length + (list.length === 1 ? ' destino' : ' destinos')]);
    if (streaming() && !list.length) rows.push(['warn', 'Destinos', 'Nenhum destino pronto: informe servidor e chave.']);
    compliance.replaceChildren(make('h4', '', 'Conformidade técnica'), ...rows.map(([tone, k, v]) => { const r = make('p', 'tx-comp-row'); r.dataset.tone = tone; r.append(make('b', '', (tone === 'ok' ? '✓ ' : '⚠ ') + k), make('span', '', v)); return r; }),
      make('p', 'tx-comp-note', 'Diretrizes conferidas: YouTube (encoder settings), Meta/Facebook (Live Video API) e Twitch. Cada envio real é medido no Diagnóstico.'));
  }
  function paintButtons() {
    const on = streaming() ? (busyTx() ? model.destinations.filter(airing).length : onAtStart().length) : 0, busy = busyTx(), dests = on ? ' · ' + on + (on === 1 ? ' DESTINO' : ' DESTINOS') : '';
    startButton.textContent = liveTx.phase === 'stopping' ? 'ENCERRANDO…' : busy ? '■ PARAR' : model.mode === 'record' ? '● GRAVAR' : model.mode === 'both' ? '▶ TRANSMITIR + GRAVAR' + dests : '▶ TRANSMITIR' + dests;
    startButton.dataset.mode = model.mode;
    for (const b of modeButtons) { const sel = b.dataset.mode === model.mode; b.setAttribute('aria-checked', String(sel)); b.setAttribute('aria-pressed', String(sel)); b.disabled = busy; }
    startButton.dataset.live = String(busy);
    armButton.textContent = busy && live.recording ? '● GRAVANDO' : model.record ? '● Gravação armada' : '○ Gravação desligada';
    armButton.setAttribute('aria-pressed', String(model.record)); armButton.disabled = busy; armButton.dataset.live = String(busy && !!live.recording);
    policy.disabled = resolution.disabled = bitrate.disabled = encoder.disabled = busy;
    recEnable.disabled = recDir.disabled = $('#recCheck').disabled = recFormats.disabled = busy;
    $$('.volume').forEach(b => { b.disabled = busy; });
    const stats = $$('.tb-stat');
    if (stats[1]) { stats[1].querySelector('.tb-label').textContent = busy && live.recording ? 'REC' : 'REC OFF'; stats[1].querySelector('.tb-dot').style.opacity = busy && live.recording ? 1 : .2; stats[1].querySelector('.tb-val').textContent = busy && live.recording ? format(state.liveSecs) : '00:00:00'; }
    const footer = $('.sim-footer > strong'); if (footer) footer.textContent = liveTx.phase === 'sending' ? 'NO AR · ' + (on || 'REC') : 'PGM';
  }
  const baseSync = sync;
  sync = function () { baseSync(); paintStatus(); paintButtons(); };

  /* ---------- iniciar e parar ---------- */

  async function startBroadcast() {
    if (busyTx()) return;
    // Só gravar ignora os destinos (completos ou não); os outros modos exigem pelo menos um destino pronto.
    const targets = streaming() ? active() : [], missing = streaming() ? pending() : [];
    if (streaming() && !targets.length) { openWorkspace('transmission'); txStatus('Informe servidor e chave de pelo menos um destino' + (model.mode === 'both' ? ', ou escolha Só gravar.' : '.')); return; }
    if (missing.length) { openWorkspace('transmission'); txStatus(missing.map(d => d.name).join(', ') + ': falta servidor ou chave. Complete ou desligue o destino.'); return; }
    if (!window.MediaRecorder || !programOutput.captureStream) { txStatus('Use Chrome ou Edge atualizado para transmitir.'); return; }
    const captureTypes = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].filter(t => MediaRecorder.isTypeSupported(t));
    if (!captureTypes.length) { txStatus('Este navegador não oferece o formato de captura necessário. Use Chrome ou Edge.'); return; }
    liveTx.vertical = wantsVertical(); // formato desta live (fixo até ela terminar)
    const epoch = ++liveTx.epoch; liveTx.phase = 'preparing'; live.states.clear(); live.recording = null; live.recorded = null; sync(); txStatus('Preparando saída PROGRAM…');
    try {
      const session = await checkBridge(); if (epoch !== liveTx.epoch) return; liveTx.apiToken = session?.token;
      if (!session?.ffmpegReady) throw Error('Codificador indisponível. Execute INSTALAR.bat e INICIAR.bat.');
      if (session.busy) throw Error('Outra aba já está transmitindo. Encerre-a antes de continuar.');
      // Assinatura: sem licença ativa, a mesa leva o operador direto ao lugar de ativar (Diagnóstico → Licença), com o código do computador.
      if (session.license && !session.license.valid) { try { openWorkspace('diagnostics'); document.querySelector('#licenseToken')?.focus(); } catch { /* aba ausente */ } throw Error(session.license.message); }
      const available = session.encoders || [];
      const selectedEncoder = model.encoder === 'auto'
        ? (['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'].find(id => available.includes(id)) || 'libx264')
        : (available.includes(model.encoder) ? model.encoder : 'libx264');
      { const pf = await window.andromedaPreflight?.(targets); if (epoch !== liveTx.epoch) return; if (pf?.block) throw Error(pf.block); if (pf?.warn) { log('Pré-voo: ' + pf.warn); txStatus('Pré-voo: ' + pf.warn); } }
      if (model.record && !(await checkDir())) throw Error('Pasta de gravação indisponível: ' + (recStatus.textContent || 'confira a unidade.'));
      const ac = await window.audioMixer.enable(); liveTx.audioContext = ac; if (epoch !== liveTx.epoch) return;
      const destination = window.audioMixer.destination;
      if ($('#txAudio').value === 'mic') {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        if (epoch !== liveTx.epoch) { mic.getTracks().forEach(t => t.stop()); return; }
        liveTx.micStream = mic; const gain = ac.createGain(), analyser = ac.createAnalyser(); analyser.fftSize = 256;
        liveTx.micNode = ac.createMediaStreamSource(mic); liveTx.micNode.connect(gain).connect(analyser).connect(window.audioMixer.master); liveTx.gain = gain; liveTx.analyser = analyser; setGain();
        mic.getAudioTracks()[0].onended = () => { if (busyTx()) finishTransport('Microfone desconectado. O envio foi interrompido.'); };
      }
      // Saída: 1080p30 (ou 4K30). Regra do produto: nunca abaixo de 1080p a 30 fps.
      const fixed = ['fixed','fixed4k'].includes(model.policy) && !liveTx.calibrating; let outRes = fixed ? (model.policy==='fixed4k'?'2160p':'1080p') : (model.resolution === '2160p' ? '2160p' : '1080p'); clearCap(); // regra: nunca abaixo de 1080p30
      const requestedRes=outRes;let outBitrate=model.bitrate;
      const vprod = liveTx.vertical; if (vprod && outRes === '2160p') { log('Produção vertical: saída em 1080×1920 a 30 fps.'); outRes = '1080p'; }
      let [width, height] = vprod ? [1080, 1920] : outRes === '2160p' ? [3840,2160] : [1920, 1080];
      for (const canvas of [hdBase, overlay, programOutput]) { canvas.width = width; canvas.height = height; } hdOn = true; // o monitor da tela continua em 960×540
      routeProgramOutput();
      // Formatos desta transmissão: 16:9 para YouTube/Facebook…, 9:16 para Instagram/TikTok, e os da gravação.
      const vTargets = targets.filter(d => d.aspect === '9:16'), hTargets = targets.filter(d => d.aspect !== '9:16');
      if (vprod && hTargets.length) throw Error('Produção vertical 9:16: ' + hTargets.map(d => d.name).join(', ') + (hTargets.length === 1 ? ' é 16:9' : ' são 16:9') + '. Desligue ' + (hTargets.length === 1 ? 'esse destino' : 'esses destinos') + ' ou mude o Formato da produção para Horizontal ou Automático.');
      // Uma codificação vai para todos os destinos: o bitrate precisa caber no limite de cada plataforma ligada (diretrizes publicadas
      // para 1080p30: Facebook, Twitch, LinkedIn, Instagram e TikTok até 6 Mbps; Kick até 8; YouTube recomenda 5 a 14). O piso é 6 Mbps.
      const capOf = list => Math.min(Infinity, ...list.map(d => PLATFORM_CAP_MBPS[d.platform] || Infinity));
      const capH = capOf(hTargets); if (outRes === '1080p' && capH < outBitrate) { log('Bitrate 16:9 ajustado para ' + capH + ' Mbps: limite de ' + hTargets.filter(d => PLATFORM_CAP_MBPS[d.platform] === capH).map(d => d.name).join(', ') + ' em 1080p30.'); outBitrate = capH; }
      liveTx.vCap = capOf(vTargets);
      let recFormats = model.recordFormats || '16:9'; const recordH = !vprod && model.record && recFormats !== '9:16', recordV = model.record && (vprod || recFormats !== '16:9');
      if (vprod && model.record && recFormats !== '9:16') log('Produção vertical: a gravação sai em 9:16 (um arquivo, a mesma imagem do ar).');
      if (vprod) recFormats = '9:16';
      // Tecnologia Andrômeda Multiplataforma: a mesa desenha e codifica UMA imagem (16:9). O serviço cria o 9:16 dela (destinos
      // verticais e gravação 9:16) e liga qualquer formato no meio da live. Só o WHIP 9:16 (que sai direto da mesa) ainda
      // precisa da imagem vertical montada aqui.
      const serverVertical = !vprod && !!session.derive && !targets.some(d => protocolOf(d) === 'whip' && d.aspect === '9:16');
      liveTx.serverVertical = serverVertical;
      // Produção vertical: o PGM já é 9:16 e é a única saída (destinos 9:16 e gravação 9:16).
      let needV = vprod || (!!window.andromedaVertical && (vTargets.length > 0 || recordV) && !serverVertical), needH = !vprod && (serverVertical || hTargets.length > 0 || recordH || !needV);
      if (!vprod && !window.andromedaVertical && targets.some(d => d.aspect === '9:16')) throw Error('Saída vertical indisponível nesta mesa. Atualize o programa.');
      // Motor de envio: o próprio (WebCodecs: uma só codificação, no navegador) ou o padrão (MediaRecorder → FFmpeg). O padrão é sempre o plano B.
      if (fixed) log('Perfil '+outRes+'30: preparando saída dedicada');
      let engine = 'webm', nativeSession = null, nativeDown = 0;
      if ((fixed || (model.engine || 'auto') !== 'standard') && window.AndromedaEngine) {
        const wanted = [needH && [width, height, model.bitrate * 1e6], needV && [vSize()[0], vSize()[1], vRate() * 1e6]].filter(Boolean);
        const probes = await Promise.all(wanted.map(([w, h, b]) => AndromedaEngine.probe({ width: w, height: h, bitrate: b }))); if (epoch !== liveTx.epoch) return;
        const bad = probes.find(p => !p.ok);
        if (!bad) { engine = 'native'; liveTx.hardware = probes.every(p => p.hardware); } else log('Motor Andrômeda indisponível neste computador: ' + bad.reason + ' Usando o codificador padrão.');
      }
      // Computador sem o codificador H.264 do navegador (Windows "N" sem o Media Feature Pack, driver de vídeo antigo ou
      // aceleração desligada): a saída continua 1080p a 30 fps, codificada pelo FFmpeg (placa de vídeo quando houver
      // NVENC/Quick Sync/AMF; senão o processador). Mais pesado, mas a live abre em qualquer computador.
      let planBPreset = null;
      if (fixed && engine !== 'native') {
        if (typeof MediaRecorder !== 'function') throw Error('Este computador não tem codificador de vídeo disponível no navegador da mesa. Consulte Diagnóstico.');
        const note = 'Codificador de vídeo do navegador indisponível neste computador: a saída ' + outRes + '30 é codificada pelo FFmpeg (' + (selectedEncoder || 'automático') + '), mais pesado para o computador.';
        log(note); window.andromedaAudit?.('warn', 'motor-plano-b', note, { encoder: selectedEncoder || 'auto' }); liveTx.outputResolution = outRes;
        // Sem placa de vídeo que codifique, o processador faz tudo (mesa + codificação 1080p): x264 "superfast" gasta cerca de metade.
        if (!selectedEncoder || selectedEncoder === 'libx264') planBPreset = 'superfast';
      }
      model.engineUsed = engine; liveTx.engine = engine;
      // Teste do computador (só o motor próprio e só quando ainda não há resultado recente para este tamanho): do tamanho pedido para baixo, o primeiro que
      // sai a pelo menos 26 quadros por segundo, com a mesa desenhando junto. O resultado vale por 7 dias; escolher a resolução na lista refaz o teste.
      let sizeNote = '';
      if (!fixed && engine === 'native' && !liveTx.calibrating && window.AndromedaEngine?.benchmark && !readBench(outRes)) {
        const ladder = [vprod ? [1080, 1920, '1080p'] : [1920, 1080, '1080p']]; let chosen = null; /* só mede: a saída fica em 1080p de qualquer jeito */ const tried = [];
        for (const [w, h, label] of ladder) {
          txStatus('Testando o computador em ' + label + '…'); for (const canvas of [hdBase, overlay, programOutput]) { canvas.width = w; canvas.height = h; } await new Promise(r => setTimeout(r, 500)); if (epoch !== liveTx.epoch) return;
          const rf0 = window.andromedaProgramFrames || 0, t0 = performance.now(), r = await AndromedaEngine.benchmark({ canvas: programOutput, width: w, height: h, bitrate: model.bitrate * 1e6 }); if (epoch !== liveTx.epoch) return;
          const desk = ((window.andromedaProgramFrames || 0) - rf0) / ((performance.now() - t0) / 1000); tried.push(label + ' ' + (r.ok ? r.fps + ' q/s' : 'falhou'));
          if (r.ok && r.fps >= 29 && desk >= 29) { chosen = [w, h, label, r.fps]; break; } if (!r.ok && r.reason) break;
        }
        const pick = chosen || ladder[ladder.length - 1]; [width, height] = [pick[0], pick[1]]; for (const canvas of [hdBase, overlay, programOutput]) { canvas.width = width; canvas.height = height; }
        writeBench(outRes, pick[2], chosen ? chosen[3] : 0); if (pick[2] !== outRes) writeBench(pick[2], pick[2], chosen ? chosen[3] : 0); log('Teste do computador: ' + tried.join(' → ') + '. Transmitindo em ' + pick[2] + '.'); window.andromedaAudit?.('info', 'teste-do-computador', 'Teste do computador: ' + tried.join(' → ') + ' · transmitindo em ' + pick[2]);
        if (pick[2] !== outRes) { writeCap(pick[2]); sizeNote = 'Este computador não sustenta ' + outRes + ': transmitindo em ' + pick[2] + '.'; txStatus(sizeNote); }
      } else if (false) { const b = readBench(outRes); const hit = null; if (hit && hit[0] < width) { [width, height] = [hit[0], hit[1]]; for (const canvas of [hdBase, overlay, programOutput]) { canvas.width = width; canvas.height = height; } } }
      if (fixed && engine === 'native') {
        txStatus('Verificando PGM e codificador em '+outRes+'30 antes de abrir o envio…');
        // Captura lembrada: se a captura por quadro já foi a que sustentou 30 fps neste computador, o teste começa por ela.
        liveTx.capture = (() => { try { return localStorage.getItem('andromeda.tx.capture.v1') === 'frame' ? 'frame' : 'stream'; } catch { return 'stream'; } })();
        const testOutput = (capture = liveTx.capture) => {
          const outputs = [];
          if (needH) outputs.push({ id:'h', canvas:programOutput, width, height, bitrate:outBitrate * 1e6 });
          if (needV) { const c=vOut(); outputs.push({ id:'v', canvas:c, width:c.width, height:c.height, bitrate:vRate() * 1e6 }); }
          return AndromedaEngine.qualify({ audioTrack:destination.stream.getAudioTracks()[0], outputs, avSyncMs:avSyncFor('native'), capture, cancelled:()=>epoch !== liveTx.epoch });
        };
        let check = await testOutput();
        if (epoch !== liveTx.epoch || check.cancelled) return;
        window.andromedaAudit?.(check.ok ? 'info' : 'warn', 'teste-saida-dedicada', check.reason || 'Teste interrompido', { fps:check.fps, fpsPGM:check.freshFps });
        // A mesa desenhou bem, mas a captura do canvas ficou para trás: antes de baixar a resolução, tenta a captura por quadro na mesma resolução.
        if (!check.ok && !check.cancelled && (check.composedFps || 0) >= 25 && (check.receivedFps || 0) < 28.5 && window.VideoFrame) {
          const other = liveTx.capture === 'frame' ? 'stream' : 'frame';
          txStatus('Captura em ' + outRes + ' abaixo de 30 fps. Testando o outro método de captura…');
          const alt = await testOutput(other);
          if (epoch !== liveTx.epoch || alt.cancelled) return;
          window.andromedaAudit?.(alt.ok ? 'info' : 'warn', 'teste-saida-dedicada', alt.reason || 'Teste interrompido', { fps:alt.fps, fpsPGM:alt.freshFps, captura:other });
          if (alt.ok) { check = alt; liveTx.capture = other; try { localStorage.setItem('andromeda.tx.capture.v1', other); } catch { /* sem armazenamento */ } log('Saída em ' + outRes + '30 com captura ' + (other === 'frame' ? 'por quadro' : 'por fluxo') + ' (o outro método não sustentou 30 fps neste computador).'); }
        }
        if (!check.ok && ['2160p','1080p'].includes(outRes) && needH && !needV) {
          const ladder=[[1920,1080,'1080p']].filter(([w])=>w<width); // só 4K → 1080p; abaixo de 1080p nunca
          for (const [w,h,label] of ladder) {
            [width,height]=[w,h];outRes=label;outBitrate=Math.min(outBitrate,12);
            for (const canvas of [hdBase,overlay,programOutput]) { canvas.width=w;canvas.height=h; }
            routeProgramOutput();await new Promise(r=>setTimeout(r,500));
            if (epoch !== liveTx.epoch) return;
            txStatus(requestedRes+' não sustentou 30 fps. Testando saída em '+label+'30…');
            check = await testOutput();
            if (epoch !== liveTx.epoch || check.cancelled) return;
            window.andromedaAudit?.(check.ok ? 'info' : 'warn','teste-saida-dedicada',check.reason || 'Teste interrompido',{fps:check.fps,fpsPGM:check.freshFps});
            if (check.ok) { liveTx.notice='Saída em '+label+'30: '+requestedRes+' não sustentou 30 fps';log(liveTx.notice);window.andromedaAudit?.('warn','resolucao-reduzida',liveTx.notice,{solicitada:requestedRes,efetiva:label});break; }
          }
        }
        // O codificador produz 1080p30 (quadros codificados a 30/s) mas a mesa não desenha 30 imagens novas por segundo neste computador:
        // a saída continua 1080p a 30 fps constantes (o codificador repete o último quadro quando falta um novo) e a mesa entra em modo leve.
        // Só não abre se o próprio codificador não consegue 1080p a 30 quadros por segundo.
        if (!check.ok && (check.fps || 0) >= 28.5) {
          window.andromedaLight = true; liveTx.notice = 'Computador no limite para ' + outRes + '30: a saída segue em ' + outRes + ' a 30 fps constantes, com mesa em modo leve. Para imagem mais fluida, feche programas pesados e use o carregador ligado.';
          log(liveTx.notice); window.andromedaAudit?.('warn', 'computador-no-limite', liveTx.notice, { fps: check.fps, fpsPGM: check.freshFps, composicao: check.composedFps });
          // Gravação 16:9 e 9:16 ao mesmo tempo é escolha do operador: as duas continuam, mesmo com o computador no limite
          // (antes o 9:16 era desligado sozinho, e a gravação vertical sumia sem o operador pedir). Só avisa.
          if (recordV && recordH) {
            const note = 'Gravando 16:9 e 9:16 ao mesmo tempo, como escolhido. Neste computador as duas imagens ocupam o processador no limite: feche programas pesados e deixe o carregador ligado.';
            log(note); window.andromedaAudit?.('warn', 'gravacao-dupla-no-limite', note, { fpsPGM: check.freshFps }); liveTx.notice += ' ' + note;
          }
        } else if (!check.ok) throw Error((check.reason || 'O teste da saída dedicada falhou.') + ' O codificador deste computador não produziu ' + outRes + ' a 30 fps; a transmissão não foi aberta (regra: só 1080p ou 4K a 30 fps).');
        liveTx.outputResolution=outRes;
      }
      let stream = null, vStream = null;
      // Trecho navegador → serviço com folga de bitrate, para a codificação final não herdar perdas.
      const hBits = Math.min(24, outBitrate * 1.6) * 1e6, vBits = Math.min(16, (vRate()) * 1.6) * 1e6; 
      function makeRecorder(media, bits) {
        let error;
        for (const mimeType of captureTypes) {
          try { return new MediaRecorder(media, { mimeType, videoBitsPerSecond: bits, audioBitsPerSecond: 160000 }); }
          catch (e) { error = e; }
        }
        throw error;
      }
      let recorder = null, recorderV = null;
      // Gravadores do motor padrão: criados já no começo quando ele é o escolhido, ou só se o motor próprio falhar.
      const buildStandard = () => {
        const video = programOutput.captureStream(30); liveTx.videoStream = video;
        stream = new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
        recorder = makeRecorder(stream, hBits); liveTx.recorder = recorder;
        if (needV) {
          const vVideo = vOut().captureStream(30); liveTx.verticalStream = vVideo;
          vStream = new MediaStream([...vVideo.getVideoTracks(), ...destination.stream.getAudioTracks()]); recorderV = makeRecorder(vStream, vBits);
          liveTx.recorderV = recorderV;
        }
      };
      if (needV && !vprod) window.andromedaVertical.setLive(true);
      if (engine === 'webm') buildStandard();
      const dual = needV;
      const socket = new WebSocket('ws://' + location.host + '/publish', 'andromeda.' + session.token); liveTx.socket = socket; liveTx.pending = 0; liveTx.notice = sizeNote; liveTx.phase = 'connecting';
      // Cada destino começa no ar ou em espera. RTMP/SRT vão ao distribuidor do serviço; WHIP sai direto da mesa (WebRTC).
      const serverTargets = targets.filter(d => protocolOf(d) !== 'whip'), whipTargets = targets.filter(d => protocolOf(d) === 'whip');
      live.sent = new Set(serverTargets.map(d => d.id)); live.rates.clear();
      for (const d of targets) live.states.set(d.id, { state: d.start === 'standby' ? 'standby' : 'connecting' });
      sync(); txStatus('Conectando o codificador…');
      liveTx.stopTimer = setTimeout(() => { if (epoch === liveTx.epoch && liveTx.phase !== 'sending') finishTransport('O codificador não iniciou o envio. Confira a conexão e tente de novo.'); }, 35000);
      // Com dois formatos, cada pedaço leva 1 byte de canal: 0 = 16:9, 1 = 9:16.
      const pipe = (rec, channel) => {
        rec.ondataavailable = e => {
          if (epoch !== liveTx.epoch || !e.data.size) return;
          if (socket.readyState !== WebSocket.OPEN) { finishTransport('A conexão com o serviço local foi perdida.'); return; }
          if (liveTx.pending + e.data.size > (dual ? 12 : 8) * 1024 * 1024 || socket.bufferedAmount > (dual ? 10 : 6) * 1024 * 1024) { finishTransport('Acúmulo de vídeo: o computador não está acompanhando. Feche aplicações pesadas ou reduza o bitrate (a resolução fica em 1080p).'); return; }
          const chunk = dual ? new Blob([new Uint8Array([channel]), e.data]) : e.data;
          liveTx.pending += chunk.size; socket.send(chunk);
        };
        rec.onerror = () => finishTransport('O navegador interrompeu a captura de vídeo. Reinicie o envio.');
      };
      if (recorder) pipe(recorder, 0); if (recorderV) pipe(recorderV, 1);
      // ---- Motor próprio ----
      const sendNative = channel => bytes => {
        if (epoch !== liveTx.epoch || engine !== 'native') return;
        if (socket.readyState !== WebSocket.OPEN) { finishTransport('A conexão com o serviço local foi perdida.'); return; }
        if (socket.bufferedAmount > (outRes === '2160p' ? 32 : 6) * 1024 * 1024) { fallbackToStandard('o envio ao serviço local acumulou'); return; }
        if (dual) { const out = new Uint8Array(bytes.length + 1); out[0] = channel; out.set(bytes, 1); socket.send(out); } else socket.send(bytes);
      };
      // Qualquer falha do motor próprio passa a sessão, sem encerrá-la, para o codificador padrão (o serviço troca o FFmpeg e abre outra gravação, _p2).
      let groupsReady = ['h'];
      const fallbackToStandard = reason => {
        if (engine !== 'native' || epoch !== liveTx.epoch) return;
        if (fixed) { finishTransport('Saída dedicada interrompida: ' + reason + '. Consulte o Diagnóstico.'); return; }
        engine = 'webm'; liveTx.engine = 'webm'; model.engineUsed = 'webm';
        const dead = nativeSession; nativeSession = null; liveTx.native = null; try { dead?.abort(); } catch { /* já parado */ }
        log('Motor Andrômeda desligado (' + reason + '). Continuando com o codificador padrão.'); window.andromedaAudit?.('warn', 'motor-padrao', 'Motor Andrômeda desligado: ' + reason);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'engine', engine: 'webm', reason }));
        buildStandard(); if (recorder) pipe(recorder, 0); if (recorderV) pipe(recorderV, 1);
        if (recorder && (groupsReady.includes('h') || !dual)) recorder.start(100); else liveTx.recorder = null;
        if (recorderV && groupsReady.includes('v')) recorderV.start(100);
      };
      // Regulador de carga: se o computador não acompanha (quadros descartados ou a mesa a poucos quadros por segundo), baixa a resolução SEM encerrar a transmissão
      // só de 4K para 1080p (nunca abaixo de 1080p30); em 1080p o computador sem fôlego ganha o modo leve da mesa, e o codificador mantém 30 fps repetindo quadros.
      const STEPS = [[3840, 2160, '2160p'], [1920, 1080, '1080p']]; /* regra: 1080p30 é o piso, o regulador nunca desce abaixo disso */ let shiftAt = Date.now(), over = 0, severe = 0, deskSlow = 0, lastRf = typeof rf === 'number' ? rf : 0;
      const downshift = async (reason, force = false, wait = 30000) => {
        if (engine !== 'native' || epoch !== liveTx.epoch || (!force && Date.now() - shiftAt < wait)) return false;
        if (width <= 1920) { if (!window.andromedaLight) { window.andromedaLight = true; log('Mesa em modo leve para manter 1080p30 (' + reason + ').'); } return false; } // no piso: alivia a mesa em vez de reduzir // carência: no começo tudo está aquecendo
        const i = STEPS.findIndex(x => x[0] === width); if (i < 0 || i >= STEPS.length - 1) return false;
        shiftAt = Date.now(); over = 0; deskSlow = 0; const [w, h, label] = STEPS[i + 1]; width = w; height = h;
        for (const canvas of [hdBase, overlay, programOutput]) { canvas.width = w; canvas.height = h; }
        const old = nativeSession; nativeSession = null; liveTx.native = null; try { old?.abort(); } catch { /* já parado */ }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync', reason }));
        const m = 'Resolução reduzida para ' + label + ' (' + reason + '). A transmissão continua; o computador não sustentava ' + STEPS[i][2] + '.';
        log(m); liveTx.notice = m; txStatus(m); window.andromedaAudit?.('warn', 'resolucao-reduzida', m, { de: STEPS[i][2], para: label, motivo: reason });
        await startNative(groupsReady); return true;
      };
      liveTx.downshift = downshift;
      const startNative = async groups => {
        groupsReady = groups; const outputs = [];
        if (groups.includes('h') || !dual) outputs.push({ id: 'h', canvas: programOutput, width, height, bitrate: outBitrate * 1e6, onChunk: sendNative(0) });
        if (needV && groups.includes('v')) { const c = vOut(); outputs.push({ id: 'v', canvas: c, width: c.width, height: c.height, bitrate: vRate() * 1e6, onChunk: sendNative(1) }); }
        nativeSession = (fixed ? AndromedaEngine.createDedicated : AndromedaEngine.create)({
          audioTrack: destination.stream.getAudioTracks()[0], outputs, avSyncMs: liveTx.calibrating ? 0 : avSyncFor('native'), capture: liveTx.capture || 'stream',
          onError: e => fallbackToStandard(e.message),
          onStats: s => { liveTx.nativeStats = s;
            if (Date.now() - (liveTx.workerAuditAt || 0) > 15000) {
              liveTx.workerAuditAt = Date.now();
              window.andromedaAudit?.('info','saida-dedicada','Cadência do codificador H.264',s);
            } if (s.dropped > 4) nativeDown++; else nativeDown = 0;
            over = (s.dropped > 4 || (s.fps > 0 && s.fps < 22)) ? over + 1 : 0; const nowRf = typeof rf === 'number' ? rf : 0, desk = nowRf - lastRf; lastRf = nowRf; deskSlow = desk < 10 && !document.hidden ? deskSlow + 1 : 0;
            severe = s.dropped > 10 ? severe + 1 : 0; // sinal forte (mais de 10 de 30 quadros descartados por segundo): reage em 3 s, depois de 8 s de aquecimento
            if (severe >= 3) downshift('mais de um terço dos quadros descartados por 3 s seguidos', false, 8000); else if (over >= 10) downshift('quadros descartados por 10 s seguidos'); else if (deskSlow >= 8) downshift('a mesa caiu para ' + desk + ' quadros por segundo'); if (nativeDown >= 5 && Date.now() - (liveTx.overloadAt || 0) > 60000) { liveTx.overloadAt = Date.now(); window.andromedaLight = true; const m = 'Atenção: o computador não está acompanhando a codificação (' + s.dropped + ' quadros descartados no último segundo). Mesa em modo leve; feche programas pesados (a saída continua em 1080p30).'; log(m); liveTx.notice = m; window.andromedaAudit?.('warn', 'sobrecarga', m, { motor: 'andromeda', descartados: s.dropped }); } },
        });
        liveTx.native = nativeSession;
        try { await nativeSession.start(); log(fixed ? 'Saída dedicada ativa: H.264 em Worker, alvo 30 fps, vídeo compartilhado entre envio e gravação.' : 'Motor Andrômeda ativo: H.264, uma codificação de vídeo.'); } catch (e) { fallbackToStandard(e.message); }
      };
      // Autorrecuperação: o codificador de um formato foi reiniciado no serviço e precisa de um gravador novo (o WebM só tem
      // cabeçalho no começo de cada gravador). O antigo é solto sem enviar mais nada.
      const reopen = group => {
        const vertical = group === 'v' && recorderV, old = vertical ? recorderV : recorder; if (!old || (group === 'v' && !recorderV)) return;
        old.ondataavailable = null; old.onerror = null; try { if (old.state !== 'inactive') old.stop(); } catch { /* já parado */ }
        const fresh = vertical ? makeRecorder(vStream, vBits) : makeRecorder(stream, hBits);
        if (vertical) { recorderV = fresh; liveTx.recorderV = fresh; } else { recorder = fresh; liveTx.recorder = fresh; }
        pipe(fresh, vertical ? 1 : 0); fresh.start(100);
      };
      socket.onopen = () => { if (epoch !== liveTx.epoch) return; socket.send(JSON.stringify({ type: 'start', resolution: outRes, bitrate: outBitrate, encoder: selectedEncoder, destinations: serverTargets.map(payload), whip: { h: whipTargets.filter(d => d.aspect !== '9:16').length, v: whipTargets.filter(d => d.aspect === '9:16').length }, record: model.record ? { dir: model.dir, formats: recFormats } : null, vertical: { resolution: '1080p', bitrate: vRate(), mode: window.andromedaVertical?.settings.mode, pos: window.andromedaVertical?.settings.pos }, derive: !!liveTx.serverVertical, channels: dual ? 2 : 1, avSyncMs: liveTx.calibrating ? 0 : avSyncFor(engine), engine, preset: planBPreset || model.preset || 'veryfast', resync: true, calibrate: !!liveTx.calibrating })); };
      socket.onmessage = event => {
        if (epoch !== liveTx.epoch) return; let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'ready') { try { const groups = msg.groups || ['h']; groupsReady = groups; if (engine === 'native') startNative(groups); else { if (groups.includes('h') || !dual) { if (recorder.state === 'inactive') recorder.start(100); } else liveTx.recorder = null; if (recorderV && groups.includes('v') && recorderV.state === 'inactive') recorderV.start(100); } navigator.wakeLock?.request('screen').then(lock => { if (epoch === liveTx.epoch) liveTx.wakeLock = lock; else lock.release(); }).catch(() => {}); txStatus('Enviando PROGRAM ao codificador…');
          window.andromedaAudit?.('info','captura-pronta','Captura iniciada', { motor: engine, formato: recorder?.mimeType || engine, grupos: groups.join(',') });
        } catch (e) { finishTransport('Falha ao iniciar a captura do PGM: ' + e.message); } }
        else if (msg.type === 'ack') liveTx.pending = Math.max(0, liveTx.pending - msg.bytes);
        else if (msg.type === 'avsync') window.andromedaSync?.onResult(msg);
        else if (msg.type === 'recording') { if (live.recording?.epoch !== epoch) live.files = []; live.recording = { ...msg, epoch }; paintButtons(); }
        // Gravação Andrômeda: estado de cada gravador (retomando depois de uma falha do disco, gravando de novo).
        else if (msg.type === 'recording-state') { recStatus.dataset.tone = msg.state === 'retrying' ? 'bad' : ''; recStatus.textContent = 'Gravação ' + msg.format + (msg.state === 'retrying' ? ': retomando sozinha (' + msg.reason + '). A transmissão segue normal.' : ': gravando' + (msg.part > 1 ? ' (parte ' + msg.part + '; no fim vira um arquivo só)' : '') + '.'); if (msg.state === 'retrying') window.andromedaAudit?.('warn', 'gravacao-falhou', 'Gravação ' + msg.format + ': ' + msg.reason); }
        else if (msg.type === 'recorded') { live.recorded = msg; live.files.push(msg); log('Gravação ' + (msg.format || '') + ' salva: ' + msg.file); summary(); }
        else if (msg.type === 'destination') {
          const before = live.states.get(msg.id)?.state;
          // Aviso (servidor suspeito) não apaga o estado de conexão: só acrescenta o motivo.
          live.states.set(msg.id, msg.state === 'warning' && before ? { ...live.states.get(msg.id), reason: msg.reason } : { state: msg.state, reason: msg.reason || '' }); paintStatus(); paintButtons();
          const d = model.destinations.find(x => x.id === msg.id), name = d?.name || 'Destino';
          if (msg.state === 'retrying' && before !== 'retrying') log(name + ': ' + msg.reason + ' — reconectando sozinho');
          else if (msg.state === 'sending' && before !== 'sending') log(name + (before === 'retrying' ? ' voltou ao ar' : ' no ar'));
          else if (msg.state === 'off' && before && before !== 'off' && liveTx.phase === 'sending') log(name + ' saiu do ar');
          else if (msg.state === 'error') log(name + ': ' + msg.reason);
        }
        // Resumo das saídas do serviço (mesmo computador, mesmo relógio): taxa real e hora em que cada destino entrou no ar.
        else if (msg.type === 'outputs') { for (const o of msg.list || []) if (o.state === 'sending') live.rates.set(o.id, { kbps: o.kbps, since: o.since || 0 }); else live.rates.delete(o.id); paintStatus(); }
        else if (msg.type === 'sending' && liveTx.phase !== 'stopping') {
          if (liveTx.phase !== 'sending') {
            clearTimeout(liveTx.stopTimer); liveTx.startedAt = Date.now(); state.liveSecs = 0;
            const first = targets.filter(d => d.start !== 'standby'), waiting = targets.filter(d => d.start === 'standby');
            for (const d of whipTargets) if (d.start !== 'standby') startWhip(d);
            log(targets.length ? 'Programa no ar' + (first.length ? ': ' + first.map(d => d.name).join(', ') : ' (nenhum destino ligado ainda)') + (waiting.length ? ' · em espera: ' + waiting.map(d => d.name).join(', ') : '') + (model.record ? ' + gravação' : '') : 'Gravação iniciada');
          }
          liveTx.phase = 'sending'; if (!liveTx.calibrating) state.live = true; liveTx.frames = msg.frames; sync();
          const states = [...live.states.values()].map(s => s.state), trouble = states.filter(s => s === 'retrying').length, airCount = states.filter(s => s === 'sending').length;
          txStatus((liveTx.notice ? liveTx.notice + ' — ' : '') + (targets.length ? airCount + ' de ' + targets.length + ' destino(s) no ar' : 'Gravando') + ' · ' + msg.frames + ' quadros' + (trouble ? ' · ' + trouble + ' reconectando' : '') + (targets.length ? '. Cada destino entra e sai do ar no próprio cartão.' : '. Só gravando: nada vai para as plataformas.'));
        }
        else if (msg.type === 'health') { liveTx.health = msg; }
        else if (msg.type === 'restart') { if (engine === 'native') nativeSession?.restart(msg.group); else reopen(msg.group); log(msg.message); }
        else if (msg.type === 'engine') { log(msg.message); }
        else if (msg.type === 'notice') { if (msg.overload) window.andromedaLight = true; log(msg.message); liveTx.notice = msg.message; txStatus(msg.message); }
        else if (msg.type === 'error') finishTransport(msg.message);
        else if (msg.type === 'stopped') finishTransport();
      };
      socket.onerror = () => { if (epoch === liveTx.epoch) finishTransport('Não foi possível abrir a conexão com o serviço local.'); };
      socket.onclose = () => { if (epoch === liveTx.epoch) finishTransport(liveTx.phase === 'stopping' ? null : 'Serviço local desconectado. O envio foi interrompido.'); };
    } catch (e) { if (epoch === liveTx.epoch) finishTransport(e.name === 'NotAllowedError' ? 'Permissão de microfone negada. Autorize o navegador ou use somente o mixer das fontes.' : e.message); }
  }
  window.startBroadcast = startBroadcast;
  // Enquadramento 9:16 mudado com a live no ar (recorte arrastado, modo trocado): o serviço refaz o 9:16 em ~2 s.
  let lastVertical = '';
  setInterval(() => {
    if (!busyTx() || !liveTx.serverVertical || liveTx.socket?.readyState !== WebSocket.OPEN) { lastVertical = ''; return; }
    const v = window.andromedaVertical?.settings; if (!v) return;
    const key = v.mode + ':' + Number(v.pos).toFixed(3);
    if (!lastVertical) { lastVertical = key; return; }
    if (key !== lastVertical) { lastVertical = key; liveTx.socket.send(JSON.stringify({ type: 'vertical', vertical: { mode: v.mode, pos: v.pos } })); log('Enquadramento 9:16 atualizado ao vivo.'); }
  }, 800);

  /* ---------- cada destino entra e sai do ar sozinho, com a live rodando ---------- */

  function enterAir(d) {
    if (liveTx.phase !== 'sending' || !complete(d)) return;
    if (liveTx.vertical && (d.aspect || '16:9') !== '9:16') { live.states.set(d.id, { state: 'error', reason: 'Esta live é vertical 9:16 e este destino é 16:9. Ele entra numa live horizontal.' }); log(d.name + ': 16:9 não entra numa live vertical.'); paintStatus(); paintButtons(); return; }
    if (protocolOf(d) === 'whip') { startWhip(d); return; }
    const socket = liveTx.socket; if (socket?.readyState !== WebSocket.OPEN) return;
    live.states.set(d.id, { state: 'connecting', reason: '' }); live.sent.add(d.id);
    socket.send(JSON.stringify({ type: 'output', id: d.id, action: 'start', destination: { ...payload(d), on: true } }));
    window.andromedaAudit?.('info', 'destino-ligado', d.name + ': entrando no ar pela mesa'); paintStatus(); paintButtons();
  }
  function leaveAir(d) {
    if (protocolOf(d) === 'whip') { live.whip.get(d.id)?.stop(); return; }
    const socket = liveTx.socket; if (socket?.readyState !== WebSocket.OPEN) return;
    live.states.set(d.id, { state: 'stopping', reason: '' });
    socket.send(JSON.stringify({ type: 'output', id: d.id, action: 'stop' }));
    paintStatus(); paintButtons();
  }

  // WHIP: imagem do PROGRAM (ou da saída 9:16) e som da mesa, direto por WebRTC. Uma sessão por destino, cada uma independente.
  function whipTrack(aspect) {
    liveTx.whipTracks = liveTx.whipTracks || {};
    const current = liveTx.whipTracks[aspect];
    if (current && current.readyState === 'live') return current;
    const canvas = aspect === '9:16' ? vOut() : programOutput;
    if (!canvas?.captureStream) return null;
    return (liveTx.whipTracks[aspect] = canvas.captureStream(30).getVideoTracks()[0]);
  }
  function startWhip(d) {
    if (!window.AndromedaWhip || !window.RTCPeerConnection) { live.states.set(d.id, { state: 'error', reason: 'WebRTC indisponível nesta mesa.' }); paintStatus(); return; }
    let session = live.whip.get(d.id);
    if (!session) {
      const video = whipTrack(d.aspect || '16:9'), audio = window.audioMixer?.destination?.stream.getAudioTracks()[0];
      if (!video) { live.states.set(d.id, { state: 'error', reason: 'A saída ' + (d.aspect || '16:9') + ' não está disponível.' }); paintStatus(); return; }
      session = window.AndromedaWhip.create({
        url: d.server.trim(), token: d.key.trim(), video, audio, apiToken: liveTx.apiToken,
        bitrate: (d.aspect === '9:16' ? vRate() : Math.min(model.bitrate, 12)) * 1e6,
        onState: (state, reason) => {
          const before = live.states.get(d.id)?.state;
          live.states.set(d.id, { state, reason: reason || '' });
          if (state === 'sending') { if (!live.rates.get(d.id)?.since) live.rates.set(d.id, { kbps: 0, since: Date.now() }); if (before !== 'sending') { log(d.name + ' no ar (WHIP)'); window.andromedaAudit?.('info', 'destino-no-ar', d.name + ' no ar (WHIP)'); } }
          else { if (state !== 'retrying') live.rates.delete(d.id); if (state === 'retrying' && before !== 'retrying') { log(d.name + ': ' + reason); window.andromedaAudit?.('warn', 'destino-reconectando', d.name + ': ' + reason); } if (state === 'off' && before === 'sending') log(d.name + ' saiu do ar'); }
          paintStatus(); paintButtons();
        },
        onStats: st => { const r = live.rates.get(d.id); if (r) r.kbps = st.kbps; },
      });
      live.whip.set(d.id, session);
    }
    session.start();
  }
  function stopAllWhip() {
    for (const s of live.whip.values()) { try { s.stop(); } catch { /* já parada */ } }
    live.whip.clear();
    for (const t of Object.values(liveTx.whipTracks || {})) { try { t.stop(); } catch { /* já parada */ } }
    liveTx.whipTracks = {};
  }
  // Ao encerrar a live (pelo operador ou por falha), as sessões WHIP terminam junto.
  const baseFinish = finishTransport;
  finishTransport = function (error) { stopAllWhip(); return baseFinish(error); };
  startButton.onclick = () => busyTx() ? stopTransport() : startBroadcast();

  const pgmHealth = make('small');
  document.querySelector('.sim-footer > strong').after(pgmHealth);
  Object.assign(pgmHealth.style,{flex:'0 0 auto',whiteSpace:'nowrap',color:'white',padding:'0 4px'});
  let lastHealthAt=performance.now(), lastFrames=0;
  setInterval(() => {
    const now=performance.now(), frames=window.andromedaProgramFrames || 0;
    const fps=Math.round((frames-lastFrames)*1000/Math.max(1,now-lastHealthAt));
    lastHealthAt=now; lastFrames=frames;
    pgmHealth.hidden=!busyTx();
    const mode = model.policy !== 'adaptive' ? ' · alvo 30 CFR' : '';
    const encoded = liveTx.engine === 'native' ? liveTx.nativeStats?.fps : null;
    const fresh = liveTx.engine === 'native' ? liveTx.nativeStats?.freshFps : null;
    pgmHealth.textContent=programOutput.width+'×'+programOutput.height+' · PGM '+fps+' fps' + (encoded == null ? '' : ' · codificado '+encoded+' fps') + (fresh == null ? '' : ' · novos '+fresh+' fps');
    pgmHealth.style.color=fps<27 || (encoded != null && encoded<27) || (fresh != null && fresh<27) ? '#ffc76a':'#a9ffcc';
  },1000);
  // Saída e taxa no cabeçalho; espaço em disco durante a gravação.
  setInterval(() => {
    const sending = liveTx.phase === 'sending', on = streaming() ? active().length : 0, rate = sending ? (model.bitrate * Math.max(1, on)).toFixed(0) + ' Mbps alvo' + (on > 1 ? ' (' + on + '×' + model.bitrate + ')' : '') : '0 Mbps';
    const out = $$('.tb-stat')[3]; if (out) out.querySelector('.tb-val').textContent = rate;
    const total = $('.bd-val'); if (total) total.textContent = rate;
    if (!busyTx() && live.states.size) { live.states.clear(); paintStatus(); }
    paintButtons();
  }, 500);
  setInterval(async () => {
    if (!busyTx()) { refreshVolumes(); return; }
    if (!live.recording) return;
    try { const s = await api('/api/storage/check', { dir: model.dir }); if (s.free != null && s.free < 2e9) { txStatus('Atenção: restam ' + gb(s.free) + ' na unidade de gravação.'); window.andromedaAudit?.('warn', 'disco-baixo', 'Pouco espaço na unidade de gravação', { livreGB: +(s.free / 1e9).toFixed(1) }); } } catch { /* conferido de novo no próximo ciclo */ }
  }, 20000);

  // As abas antigas de stream e gravação das configurações gerais saem de cena: a página Transmissão é a fonte única.
  const frame = $('#settingsDialog iframe');
  const tidy = () => { const doc = frame?.contentDocument; if (!doc) return; for (const tab of ['stream', 'gravacao']) { const t = doc.querySelector('[data-tab="' + tab + '"]'); if (t) t.hidden = true; } const note = doc.querySelector('#configFeedback'); if (note) note.textContent = 'Nomes, quantidade de câmeras e automações. Destinos, qualidade e gravação ficam na página Transmissão.'; };
  frame?.addEventListener('load', tidy); tidy();

  checkBridge().then(session => { offerEncoders(session); refreshVolumes(); });
  render();
})();
