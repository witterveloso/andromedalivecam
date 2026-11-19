'use strict';
/*
 * Fade das inserções no AR. Toda camada colocada direto no PROGRAM (GC, LOGO, JANELA e REGRESSIVA) entra e sai com fade de 2 segundos.
 * A TRILHA (música de fundo) tem a sua própria regra (entra em 2 s, sai em 3 s) e não passa por aqui.
 * Só o PROGRAM é afetado: os rascunhos e a prévia dos efeitos continuam mostrando o resultado final na hora.
 * Cada camada guarda seu nível (0 a 1); com o nível pleno ela é desenhada direto, e só durante o fade passa por uma tela auxiliar.
 */
(() => {
  const levels = new Map(); let scratch = null, lastPip = null;
  const api = { seconds: 2 };
  function level(key, on, now) {
    let f = levels.get(key); if (!f) { f = { a: on ? 1 : 0, at: now }; levels.set(key, f); return f.a; } // já no ar na abertura: sem fade
    const dt = Math.min(0.25, Math.max(0, (now - f.at) / 1000)); f.at = now;
    f.a = Math.max(0, Math.min(1, f.a + (on ? 1 : -1) * dt / Math.max(0.05, api.seconds)));
    return f.a;
  }
  // Desenha uma camada com o nível de fade dela. "draw(c)" desenha a camada inteira no contexto c.
  function apply(ctx, key, on, draw, now = performance.now()) {
    const a = level(key, on, now); if (a <= 0) return 0;
    if (a >= 1) { draw(ctx); return 1; }
    const w = ctx.canvas.width, h = ctx.canvas.height; scratch = scratch || document.createElement('canvas');
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    const sc = scratch.getContext('2d'); sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = 1; sc.clearRect(0, 0, w, h); draw(sc);
    ctx.save(); ctx.globalAlpha = a; ctx.drawImage(scratch, 0, 0); ctx.restore(); return a;
  }
  api.apply = apply; api.level = key => levels.get(key)?.a ?? 0; api.reset = () => levels.clear();
  window.andromedaFade = api;

  const C = window.AndromedaComposition; if (!C?.compose) return;
  const base = C.compose;
  const only = (s, which) => ({ ...s, pip: { ...s.pip, on: which === 'pip' }, layers: s.layers.map((l, j) => ({ ...l, on: which === 'gc' + j })), logo: { ...s.logo, on: which === 'logo' } });
  C.compose = function (ctx, w, h, settings, opts = {}) {
    if (typeof programOutput === 'undefined' || ctx.canvas !== programOutput || !settings?.layers) return base.apply(this, arguments);
    const now = performance.now(), { pip, logo } = opts;
    if (settings.pip.on && pip) lastPip = pip;
    apply(ctx, 'pip', !!(settings.pip.on && pip), c => base(c, w, h, only(settings, 'pip'), { pip: pip || lastPip, logo: null }), now);
    settings.layers.forEach((l, i) => apply(ctx, 'gc' + i, !!(l.on && (String(l.title || '').trim() || String(l.subtitle || '').trim())), c => base(c, w, h, only(settings, 'gc' + i), { pip: null, logo: null }), now));
    apply(ctx, 'logo', !!(settings.logo.on && logo), c => base(c, w, h, only(settings, 'logo'), { pip: null, logo }), now);
  };
})();
