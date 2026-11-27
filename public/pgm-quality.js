'use strict';
/*
 * Qualidade e superfícies do PGM.
 * O monitor da tela fica sempre em 960×540. A imagem em ALTA DEFINIÇÃO (Full HD 1920×1080 por padrão) existe só enquanto alguém a usa:
 * durante a transmissão/gravação (a resolução vem do envio) ou com a janela de saída aberta (a qualidade vem da escolha abaixo).
 * Ao encerrar o envio ou fechar a janela de saída, tudo volta ao tamanho leve. Em PC fraco o desenho em 1080p é caro (o log de um notebook com placa
 * de vídeo integrada mostrou a mesa a 1 quadro por segundo com o PGM em 1080p), então a imagem HD não deve ficar ligada à toa.
 */
(() => {
  const KEY = 'andromeda.pgm.v1', SIZES = { hd: [1920, 1080], eco: [1280, 720] }, LIGHT = [960, 540];
  let q = 'hd'; try { const v = JSON.parse(localStorage.getItem(KEY) || '{}').q; if (SIZES[v]) q = v; } catch { /* sem armazenamento */ }
  const orient = s => (window.andromedaOrient || (x => x))(s);
  const size = () => orient(SIZES[q]);
  const sending = () => typeof busyTx === 'function' && busyTx();
  const windowOpen = () => typeof outputWindow !== 'undefined' && !!outputWindow && !outputWindow.closed;
  function resize(list, [w, h]) { for (const c of list) if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; } }
  function apply() {
    if (typeof programOutput === 'undefined' || typeof overlay === 'undefined' || typeof hdBase === 'undefined') return;
    if (sending()) { hdOn = true; return; } // durante o envio quem manda é a resolução da transmissão
    const hd = windowOpen(); hdOn = hd; resize([hdBase, overlay, programOutput], hd ? size() : orient(LIGHT));
    try { if (typeof routeProgramOutput === 'function') routeProgramOutput(); } catch { /* o desenho blindado da mesa registra a falha */ }
  }
  // Ao encerrar o envio, o PGM volta ao tamanho leve (antes ficava em 1080p até fechar o programa).
  if (typeof finishTransport === 'function') { const orig = finishTransport; window.finishTransport = function (...a) { const r = orig.apply(this, a); setTimeout(apply, 0); return r; }; }
  setInterval(apply, 1000); // acompanha a abertura e o fechamento da janela de saída

  const host = document.querySelector('#txResolution')?.parentElement?.parentElement;
  if (host) {
    const label = document.createElement('label'), sel = document.createElement('select'); sel.id = 'pgmQuality';
    sel.add(new Option('Alta definição · 1920 × 1080 (padrão)', 'hd')); sel.add(new Option('Econômica · 1280 × 720 (PC mais fraco)', 'eco')); sel.value = q;
    label.append('Qualidade da janela de saída do PGM', sel); host.insertBefore(label, host.firstChild?.nextSibling || null);
    sel.onchange = () => { q = sel.value; try { localStorage.setItem(KEY, JSON.stringify({ q })); } catch { /* sem armazenamento */ } apply(); };
  }

  // Proteção do computador: com a janela de saída aberta (fora do envio), se o desenho cair abaixo de 14 quadros/s por ~8 s, o PGM passa à econômica.
  let slow = 0, lastRf = typeof rf === 'number' ? rf : 0;
  setInterval(() => {
    const now = typeof rf === 'number' ? rf : 0, fps = (now - lastRf) / 2; lastRf = now;
    if (document.hidden || sending() || !windowOpen() || q !== 'hd') { slow = 0; return; }
    slow = fps < 14 ? slow + 1 : 0;
    if (slow >= 4) { slow = 0; q = 'eco'; const sel = document.querySelector('#pgmQuality'); if (sel) sel.value = 'eco'; apply(); const m = 'Janela de saída passou para a qualidade econômica (1280 × 720): o desenho da mesa estava a ' + fps.toFixed(0) + ' quadros por segundo. Volte ao HD em Transmissão → Qualidade.'; try { log(m); window.andromedaAudit?.('warn', 'pgm-economico', m); } catch { /* sem registro */ } }
  }, 2000);
  window.andromedaPgm = { apply, size, get quality() { return q; }, get hd() { return hdOn; } };
  apply();
})();
