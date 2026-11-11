'use strict';
/*
 * Andromeda Live — organização da interface.
 * Carregado por último: só reposiciona nós já criados pelos outros scripts
 * (nunca recria elementos de mídia nem troca ids) e desenha o QR do convite.
 */
(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };

  /* Cabeçalho único: marca, abas e estado da transmissão na mesma barra. */
  const topbar = $('.topbar'), tabs = $('.workspace-tabs');
  if (topbar && tabs) topbar.insertBefore(tabs, $('.topbar-center'));

  /* Ações soltas de cada página viram uma barra de ações. */
  for (const page of document.querySelectorAll('.workspace-page')) {
    const loose = [...page.children].filter(el => el.tagName === 'BUTTON');
    if (!loose.length) continue;
    const bar = make('div', 'page-toolbar');
    bar.append(...loose); page.prepend(bar);
  }
  const brand = $('.logo-name'); if (brand) brand.textContent = 'Andrômeda';
  const rename = (selector, text) => { const el = $(selector); if (el) el.textContent = text; };
  rename('#settingsButton', 'Configurações gerais');
  rename('#mediaButton', 'Fontes de câmera');

  /* "Personalizar a mesa" fica recolhido: é ajuste ocasional, não operação. */
  const layout = $('.layout-settings');
  if (layout) {
    const title = $('h2', layout), toggle = make('button', 'layout-toggle');
    toggle.type = 'button'; toggle.textContent = title.textContent; title.replaceChildren(toggle);
    const setOpen = open => { layout.dataset.open = String(open); toggle.setAttribute('aria-expanded', String(open)); };
    toggle.onclick = () => setOpen(layout.dataset.open !== 'true');
    setOpen(false);
    const customize = [...(tabs?.querySelectorAll('button') || [])].find(b => !b.dataset.page);
    customize?.addEventListener('click', () => { setOpen(true); layout.scrollIntoView({ block: 'start' }); });
  }

  /* Convites: três passos e QR code para apontar a câmera do celular. */
  const invite = $('#camInvite')?.closest('.transport-panel');
  if (invite) {
    invite.classList.add('invite-flow');
    const field = id => $('#' + id).closest('label') || $('#' + id);
    const step = (number, title, ...nodes) => {
      const box = make('div', 'step'), heading = make('h4');
      heading.append(make('b', '', String(number)), title); box.append(heading, ...nodes); return box;
    };
    const head = make('div', 'invite-head');
    head.append($('strong', invite), $('p', invite));

    const qr = make('div', 'qr-box');
    const canvas = make('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'QR code do convite');
    const empty = make('span', '', 'O QR code aparece aqui depois de gerar o convite.');
    qr.append(canvas, empty);
    const actions = make('div', 'step-actions');
    actions.append($('#camCopyLink'), $('#camShare'), $('#camWhatsapp'));
    const send = make('div', 'send');
    send.append(field('camLink'), actions, make('small', '', 'O link é privado e vale 12 horas. Gerar outro convite para o mesmo canal invalida o anterior.'));
    const share = step(3, 'Enviar ao celular', qr, send); share.classList.add('share');

    const camera = make('div', 'step-actions');
    camera.append($('#camInvite'), $('#camRevoke'));
    invite.append(
      head,
      step(1, 'Endereço público da mesa', field('camPublicURL'), $('#camSaveURL')),
      step(2, 'Câmera e qualidade', field('camSlot'), field('camName'), field('camProfile'), camera),
      share,
      $('#camSetupStatus'),
    );

    const link = $('#camLink');
    const draw = () => {
      const url = link.value.trim(), generator = window.qrcode;
      qr.dataset.ready = String(!!url && !!generator);
      if (!url || !generator) return;
      const code = generator(0, 'M'); code.addData(url); code.make();
      const count = code.getModuleCount(), quiet = 4, scale = Math.max(4, Math.ceil(640 / (count + quiet * 2)));
      canvas.width = canvas.height = (count + quiet * 2) * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
      for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (code.isDark(row, col)) ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    };
    link.addEventListener('input', draw); draw();
  }

  /* Textos de apoio que ocupavam altura na operação viram dica ao passar o mouse. */
  const hint = $('.lever-hint'), lever = $('.transition-lever');
  if (hint && lever) lever.title = hint.textContent;
  const note = $('.pgm-audio-monitor small');
  if (note) $('.pgm-audio-monitor').title = note.textContent;

  /* Indica a página aberta ao CSS (por exemplo, para a barra de atalhos). */
  const pageName = () => { document.body.dataset.page = tabs?.querySelector('[aria-pressed="true"]')?.dataset.page || ''; };
  if (tabs) { new MutationObserver(pageName).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] }); pageName(); }
})();
