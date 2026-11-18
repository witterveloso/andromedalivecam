/*
 * Slides · leitor de PPTX embutido (plano B).
 * Quando o computador não tem PowerPoint nem LibreOffice, a mesa ainda abre .pptx/.ppsx por aqui: lê o arquivo (um ZIP de XML),
 * e desenha fundo, imagens, formas, tabelas simples e textos de cada slide. É uma versão simplificada (sem animações, efeitos,
 * SmartArt, gráficos e fontes que o Windows não tenha); com PowerPoint ou LibreOffice a conversão é fiel e este leitor não é usado.
 */
(() => {
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const EMU_PT = 12700;
  const te = new TextDecoder();

  /* ---------- ZIP (sem bibliotecas: central directory + deflate-raw do navegador) ---------- */
  async function readZip(buf) {
    const dv = new DataView(buf); let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo PPTX inválido (não é um ZIP).');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const entries = new Map();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      entries.set(te.decode(new Uint8Array(buf, p + 46, nl)), { method, csize, lho }); p += 46 + nl + el + cl;
    }
    async function read(name) {
      const e = entries.get(name); if (!e) return null;
      const nl = dv.getUint16(e.lho + 26, true), el = dv.getUint16(e.lho + 28, true), data = new Uint8Array(buf, e.lho + 30 + nl + el, e.csize);
      if (e.method === 0) return data;
      return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    return { has: n => entries.has(n), read, async text(n) { const d = await read(n); return d ? te.decode(d) : null; } };
  }

  const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');
  const kids = (el, name) => [...(el?.children || [])].filter(c => c.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;
  const path = (el, ...names) => { let n = el; for (const x of names) { n = kid(n, x); if (!n) return null; } return n; };
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
  function resolve(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const out = dirOf(base).split('/').filter(Boolean);
    for (const part of target.split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
    return out.join('/');
  }

  /* ---------- cores ---------- */
  function hslToRgb(h, s, l) { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)].map(x => Math.round(x * 255)); }
  function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; let h = 0, s = 0; if (max !== min) { const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function colorOf(el, theme, map) {
    const c = el && [...el.children].find(x => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'].includes(x.localName)); if (!c) return null;
    let hex = null;
    if (c.localName === 'srgbClr') hex = c.getAttribute('val');
    else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') || (c.getAttribute('val') === 'windowText' ? '000000' : 'FFFFFF');
    else if (c.localName === 'schemeClr') { let v = c.getAttribute('val'); v = map[v] || v; hex = theme[v] || theme[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v]] || '000000'; }
    else if (c.localName === 'prstClr') hex = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' }[c.getAttribute('val')] || '000000';
    else return null;
    let rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) || 0), alpha = 1;
    for (const m of c.children) {
      const v = num(m.getAttribute('val')) / 100000;
      if (m.localName === 'lumMod' || m.localName === 'lumOff') { const [h, s, l] = rgbToHsl(...rgb); rgb = hslToRgb(h, s, Math.max(0, Math.min(1, m.localName === 'lumMod' ? l * v : l + v))); }
      else if (m.localName === 'tint') rgb = rgb.map(x => Math.round(x + (255 - x) * (1 - v)));
      else if (m.localName === 'shade') rgb = rgb.map(x => Math.round(x * v));
      else if (m.localName === 'alpha') alpha = v;
    }
    return alpha < 1 ? 'rgba(' + rgb.join(',') + ',' + alpha.toFixed(2) + ')' : 'rgb(' + rgb.join(',') + ')';
  }
  const fillOf = (props, theme, map) => {
    if (!props) return null;
    if (kid(props, 'noFill')) return 'none';
    const solid = kid(props, 'solidFill'); if (solid) return colorOf(solid, theme, map);
    const grad = kid(props, 'gradFill'); if (grad) { const stop = kid(kid(grad, 'gsLst'), 'gs'); return colorOf(stop, theme, map); }
    return null;
  };

  /* ---------- tema, layouts, mestre ---------- */
  async function loadRels(zip, part) {
    const text = await zip.text(dirOf(part) + '_rels/' + part.slice(part.lastIndexOf('/') + 1) + '.rels'), map = new Map();
    if (text) for (const r of parseXml(text).getElementsByTagNameNS('*', 'Relationship')) map.set(r.getAttribute('Id'), { target: resolve(part, r.getAttribute('Target')), type: r.getAttribute('Type') || '' });
    return map;
  }
  async function loadTheme(zip, masterRels) {
    const theme = {}, rel = [...masterRels.values()].find(r => /theme$/.test(r.type)); let fonts = { major: '', minor: '' };
    const text = rel && await zip.text(rel.target); if (!text) return { colors: theme, fonts };
    const doc = parseXml(text), scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
    for (const c of scheme?.children || []) { const v = c.firstElementChild; theme[c.localName] = v?.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : v?.getAttribute('lastClr') || '000000'; }
    fonts = { major: doc.getElementsByTagNameNS('*', 'majorFont')[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface') || '', minor: doc.getElementsByTagNameNS('*', 'minorFont')[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface') || '' };
    return { colors: theme, fonts };
  }

  /* ---------- formas ---------- */
  const IDENT = { x: 0, y: 0, sx: 1, sy: 1 };
  function xfrmOf(spPr) {
    const x = kid(spPr, 'xfrm'); if (!x) return null; const off = kid(x, 'off'), ext = kid(x, 'ext'); if (!off || !ext) return null;
    return { x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), w: num(ext.getAttribute('cx')), h: num(ext.getAttribute('cy')), rot: num(x.getAttribute('rot')) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1' };
  }
  const place = (b, g) => ({ ...b, x: g.x + b.x * g.sx, y: g.y + b.y * g.sy, w: b.w * g.sx, h: b.h * g.sy });
  const phOf = sp => { const ph = path(sp, 'nvSpPr', 'nvPr', 'ph') || path(sp, 'nvPicPr', 'nvPr', 'ph'); return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null; };
  const isTitle = t => t === 'title' || t === 'ctrTitle';
  function findPlaceholder(tree, ph) {
    if (!ph || !tree) return null;
    const list = [...tree.children].filter(c => c.localName === 'sp');
    return list.find(sp => { const p = phOf(sp); return p && ph.idx && p.idx === ph.idx; }) || list.find(sp => { const p = phOf(sp); return p && p.type === ph.type; }) || (ph.type === 'subTitle' ? list.find(sp => phOf(sp)?.type === 'body') : null) || null;
  }

  // Estilo de texto herdado do mestre (tamanhos e cores dos títulos e do corpo)
  function paraDefaults(master, ph, level) {
    const styles = path(master, 'txStyles'), style = !ph ? kid(styles, 'otherStyle') : isTitle(ph.type) ? kid(styles, 'titleStyle') : kid(styles, 'bodyStyle');
    return path(style, 'lvl' + (level + 1) + 'pPr') || path(style, 'lvl1pPr');
  }
  function textDefaults(master, ph, level) {
    const styles = path(master, 'txStyles'); const style = !ph ? kid(styles, 'otherStyle') : isTitle(ph.type) ? kid(styles, 'titleStyle') : ph.type === 'body' || ph.type === 'subTitle' || ph.idx ? kid(styles, 'bodyStyle') : kid(styles, 'otherStyle');
    return path(style, 'lvl' + (level + 1) + 'pPr', 'defRPr') || path(style, 'lvl1pPr', 'defRPr');
  }

  async function parse(buf) {
    const zip = await readZip(buf);
    const presXml = await zip.text('ppt/presentation.xml'); if (!presXml) throw new Error('Arquivo PPTX inválido (sem presentation.xml).');
    const pres = parseXml(presXml), sz = pres.getElementsByTagNameNS('*', 'sldSz')[0], W = num(sz?.getAttribute('cx'), 9144000), H = num(sz?.getAttribute('cy'), 5143500);
    const presRels = await loadRels(zip, 'ppt/presentation.xml');
    const order = [...pres.getElementsByTagNameNS('*', 'sldId')].map(e => e.getAttributeNS(NS_R, 'id')).map(id => presRels.get(id)?.target).filter(Boolean);
    const images = new Map(), cacheImage = async name => {
      if (!images.has(name)) images.set(name, (async () => { try { const data = await zip.read(name); if (!data) return null; const ext = name.split('.').pop().toLowerCase(); const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext]; if (!type) return null; return await createImageBitmap(new Blob([data], { type })); } catch { return null; } })());
      return images.get(name);
    };
    const parts = new Map(), loadPart = async name => {
      if (!parts.has(name)) parts.set(name, (async () => { const text = await zip.text(name); return text ? { doc: parseXml(text), rels: await loadRels(zip, name), name } : null; })());
      return parts.get(name);
    };

    const slides = order.map((slidePath, index) => ({
      index,
      async render(ctx, w, h) {
        const slide = await loadPart(slidePath); if (!slide) return;
        const layoutRel = [...slide.rels.values()].find(r => /slideLayout$/.test(r.type)), layout = layoutRel && await loadPart(layoutRel.target);
        const masterRel = layout && [...layout.rels.values()].find(r => /slideMaster$/.test(r.type)), master = masterRel && await loadPart(masterRel.target);
        const { colors, fonts } = master ? await loadTheme(zip, master.rels) : { colors: {}, fonts: {} };
        const mapEl = master && kid(master.doc.documentElement, 'clrMap'); const clrMap = mapEl ? Object.fromEntries([...mapEl.attributes].map(a => [a.name, a.value])) : {};
        const scale = w / W, px = e => e * scale;
        const textColor = colorOf(parseXml('<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="tx1"/></a:solidFill>').documentElement, colors, clrMap) || '#000';
        const typeface = (face, major) => { const f = face && !face.startsWith('+') ? face : major ? fonts.major : fonts.minor; return (f ? '"' + f + '", ' : '') + '"Carlito", "Segoe UI", Arial, sans-serif'; };
        // fundo: slide → layout → mestre
        const bgOf = part => { const bg = part && path(part.doc.documentElement, 'cSld', 'bg'); if (!bg) return null; const pr = kid(bg, 'bgPr'); if (pr) return fillOf(pr, colors, clrMap); const ref = kid(bg, 'bgRef'); return ref ? colorOf(ref, colors, clrMap) : null; };
        ctx.fillStyle = [bgOf(slide), bgOf(layout), bgOf(master)].find(c => c && c !== 'none') || '#ffffff'; ctx.fillRect(0, 0, w, h);

        const drawTree = async (part, onlyDecor) => {
          const tree = part && path(part.doc.documentElement, 'cSld', 'spTree'); if (!tree) return;
          await drawShapes(tree, part, IDENT, onlyDecor);
        };
        async function drawShapes(tree, part, group, onlyDecor) {
          for (const el of tree.children) {
            const kind = el.localName;
            if (kind === 'grpSp') {
              const pr = kid(el, 'grpSpPr'), x = kid(pr, 'xfrm'); let g = group;
              if (x) { const off = kid(x, 'off'), ext = kid(x, 'ext'), co = kid(x, 'chOff'), ce = kid(x, 'chExt'); const cw = num(ce?.getAttribute('cx'), 1) || 1, chh = num(ce?.getAttribute('cy'), 1) || 1; const sx = num(ext?.getAttribute('cx')) / cw, sy = num(ext?.getAttribute('cy')) / chh; g = { x: group.x + (num(off?.getAttribute('x')) - num(co?.getAttribute('x')) * sx) * group.sx, y: group.y + (num(off?.getAttribute('y')) - num(co?.getAttribute('y')) * sy) * group.sy, sx: sx * group.sx, sy: sy * group.sy }; }
              await drawShapes(el, part, g, onlyDecor); continue;
            }
            if (!['sp', 'pic', 'cxnSp', 'graphicFrame'].includes(kind)) continue;
            const ph = phOf(el); if (onlyDecor && ph) continue; // layout e mestre: só o que é decoração (logos, faixas), nunca os campos de texto
            if (kind === 'graphicFrame') { await drawTable(el, group, part); continue; }
            const spPr = kid(el, 'spPr');
            // Posição própria → do layout → do mestre (os campos de título e corpo quase sempre herdam a posição).
            let box = xfrmOf(spPr), inherited = null;
            if (ph) { const fromLayout = findPlaceholder(path(layout?.doc.documentElement, 'cSld', 'spTree'), ph), fromMaster = findPlaceholder(path(master?.doc.documentElement, 'cSld', 'spTree'), ph); inherited = fromLayout || fromMaster; if (!box) box = xfrmOf(kid(fromLayout, 'spPr')) || xfrmOf(kid(fromMaster, 'spPr')); }
            if (!box) continue;
            const b = place(box, group), X = px(b.x), Y = px(b.y), Wd = px(b.w), Ht = px(b.h);
            ctx.save();
            if (box.rot || box.flipH || box.flipV) { ctx.translate(X + Wd / 2, Y + Ht / 2); ctx.rotate(box.rot * Math.PI / 180); ctx.scale(box.flipH ? -1 : 1, box.flipV ? -1 : 1); ctx.translate(-(X + Wd / 2), -(Y + Ht / 2)); }
            if (kind === 'pic') {
              const rid = kid(kid(el, 'blipFill'), 'blip')?.getAttributeNS(NS_R, 'embed'), target = rid && part.rels.get(rid)?.target, bmp = target && await cacheImage(target);
              if (bmp) { const crop = kid(kid(el, 'blipFill'), 'srcRect'), l = num(crop?.getAttribute('l')) / 100000, t = num(crop?.getAttribute('t')) / 100000, r = num(crop?.getAttribute('r')) / 100000, bt = num(crop?.getAttribute('b')) / 100000; ctx.drawImage(bmp, bmp.width * l, bmp.height * t, bmp.width * (1 - l - r), bmp.height * (1 - t - bt), X, Y, Wd, Ht); }
              ctx.restore(); continue;
            }
            // forma: preenchimento e contorno
            const style = kid(el, 'style'), styleFill = num(kid(style, 'fillRef')?.getAttribute('idx')) > 0 ? colorOf(kid(style, 'fillRef'), colors, clrMap) : null, styleLine = num(kid(style, 'lnRef')?.getAttribute('idx')) > 0 ? colorOf(kid(style, 'lnRef'), colors, clrMap) : null, styleFont = colorOf(kid(style, 'fontRef'), colors, clrMap);
            const geom = kid(spPr, 'prstGeom')?.getAttribute('prst') || 'rect', fill = fillOf(spPr, colors, clrMap) ?? styleFill, ln = kid(spPr, 'ln'), lnFill = (ln && fillOf(ln, colors, clrMap)) ?? (ln ? styleLine : (kid(spPr, 'prstGeom') && !kid(spPr, 'noFill') ? styleLine : null)), lnW = ln ? Math.max(1, px(num(ln.getAttribute('w'), 12700))) : 0;
            const outline = () => { ctx.beginPath(); if (geom === 'ellipse') ctx.ellipse(X + Wd / 2, Y + Ht / 2, Wd / 2, Ht / 2, 0, 0, 7); else if (geom === 'roundRect') ctx.roundRect(X, Y, Wd, Ht, Math.min(Wd, Ht) * .16); else if (geom === 'line' || kind === 'cxnSp') { ctx.moveTo(X, Y); ctx.lineTo(X + Wd, Y + Ht); } else ctx.rect(X, Y, Wd, Ht); };
            if (fill && fill !== 'none' && kind !== 'cxnSp') { outline(); ctx.fillStyle = fill; ctx.fill(); }
            if (lnFill && lnFill !== 'none') { outline(); ctx.strokeStyle = lnFill; ctx.lineWidth = lnW; ctx.stroke(); }
            const body = kid(el, 'txBody'); if (body) drawText(body, { X, Y, W: Wd, H: Ht }, ph, inherited, styleFont);
            ctx.restore();
          }
        }
        function drawText(body, rect, ph, inherited, styleFont) {
          const bodyPr = kid(body, 'bodyPr'), pad = a => px(num(bodyPr?.getAttribute(a), a === 'lIns' || a === 'rIns' ? 91440 : 45720));
          const left = rect.X + pad('lIns'), top = rect.Y + pad('tIns'), width = Math.max(10, rect.W - pad('lIns') - pad('rIns')), height = rect.H - pad('tIns') - pad('bIns');
          const fontScale = num(path(bodyPr, 'normAutofit')?.getAttribute('fontScale'), 100000) / 100000;
          const lvlStyle = path(inherited ? kid(inherited, 'txBody') : null, 'lstStyle'), lines = [];
          for (const p of kids(body, 'p')) {
            const pPr = kid(p, 'pPr'), level = num(pPr?.getAttribute('lvl')), lvl = path(lvlStyle, 'lvl' + (level + 1) + 'pPr'), def = textDefaults(master?.doc.documentElement, ph, level);
            const algn = pPr?.getAttribute('algn') || lvl?.getAttribute('algn') || paraDefaults(master?.doc.documentElement, ph, level)?.getAttribute('algn') || (ph && isTitle(ph.type) && ph.type === 'ctrTitle' ? 'ctr' : ph?.type === 'subTitle' ? 'ctr' : 'l');
            const bulletOn = !kid(pPr, 'buNone') && (kid(pPr, 'buChar') || kid(lvl, 'buChar') || (ph && !isTitle(ph.type) && ph.type === 'body' && !kid(lvl, 'buNone')));
            const marL = px(num(pPr?.getAttribute('marL'), num(lvl?.getAttribute('marL'), bulletOn ? 342900 + level * 342900 : 0))), indent = px(num(pPr?.getAttribute('indent'), num(lvl?.getAttribute('indent'), bulletOn ? -342900 : 0)));
            const runs = [];
            for (const r of p.children) {
              if (r.localName === 'br') { runs.push({ br: true }); continue; }
              if (!['r', 'fld'].includes(r.localName)) continue;
              const rPr = kid(r, 'rPr'), text = kid(r, 't')?.textContent || ''; if (!text) continue;
              const defSz = num(def?.getAttribute('sz'), 0) || num(path(lvlStyle, 'lvl1pPr', 'defRPr')?.getAttribute('sz'), 0) || (ph ? (isTitle(ph.type) ? 4400 : ph.type === 'subTitle' ? 2400 : 2800) : 1800);
              const sz = (num(rPr?.getAttribute('sz'), 0) || num(lvl && kid(lvl, 'defRPr')?.getAttribute('sz'), 0) || defSz) / 100 * fontScale;
              const color = fillOf(rPr, colors, clrMap) || fillOf(kid(lvl, 'defRPr'), colors, clrMap) || styleFont || fillOf(def, colors, clrMap) || textColor;
              const face = kid(rPr, 'latin')?.getAttribute('typeface');
              runs.push({ text, px: px(sz * EMU_PT), bold: rPr?.getAttribute('b') === '1' || (rPr?.getAttribute('b') == null && !!(def?.getAttribute('b') === '1')), italic: rPr?.getAttribute('i') === '1', color, font: typeface(face, ph && isTitle(ph.type)), u: rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none' });
            }
            const size = runs.find(r => r.px)?.px || px((ph ? 28 : 18) * EMU_PT);
            lines.push({ runs, algn, bullet: bulletOn, marL, indent, size, spcBef: px(num(kid(kid(pPr, 'spcBef'), 'spcPts')?.getAttribute('val')) / 100 * EMU_PT) });
          }
          // quebra de linha por palavras
          const out = [];
          for (const para of lines) {
            const avail = width - para.marL; let cur = { items: [], w: 0, size: para.size, algn: para.algn, first: true, para, spc: para.spcBef };
            const push = () => { out.push(cur); cur = { items: [], w: 0, size: para.size, algn: para.algn, first: false, para, spc: 0 }; };
            if (!para.runs.length) { out.push({ items: [], w: 0, size: para.size, algn: para.algn, first: true, para, spc: para.spcBef, empty: true }); continue; }
            for (const run of para.runs) {
              if (run.br) { push(); continue; }
              ctx.font = (run.italic ? 'italic ' : '') + (run.bold ? 'bold ' : '') + run.px + 'px ' + run.font;
              for (const word of run.text.split(/(\s+)/)) {
                if (!word) continue; const wd = ctx.measureText(word).width, lim = avail;
                if (cur.w + wd > lim && cur.items.length && word.trim()) push();
                if (!cur.items.length && !word.trim()) continue; cur.items.push({ word, run, w: wd }); cur.w += wd; cur.size = Math.max(cur.size, run.px);
              }
            }
            out.push(cur);
          }
          const lineH = l => l.size * 1.2, total = out.reduce((a, l) => a + lineH(l) + l.spc, 0), anchor = bodyPr?.getAttribute('anchor') || (ph && isTitle(ph.type) ? 'ctr' : 't');
          let y = anchor === 'ctr' ? top + (height - total) / 2 : anchor === 'b' ? top + height - total : top;
          for (const l of out) {
            y += l.spc; const x0 = left + l.para.marL, lw = l.items.reduce((a, i) => a + i.w, 0), avail = width - l.para.marL;
            let x = l.algn === 'ctr' ? x0 + (avail - lw) / 2 : l.algn === 'r' ? x0 + avail - lw : x0;
            if (l.first && l.para.bullet && l.items.length) { ctx.font = l.size + 'px ' + l.items[0].run.font; ctx.fillStyle = l.items[0].run.color; ctx.textBaseline = 'alphabetic'; ctx.fillText('•', left + l.para.marL + l.para.indent, y + l.size * .95); }
            for (const it of l.items) {
              ctx.font = (it.run.italic ? 'italic ' : '') + (it.run.bold ? 'bold ' : '') + it.run.px + 'px ' + it.run.font; ctx.fillStyle = it.run.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
              ctx.fillText(it.word, x, y + l.size * .95); if (it.run.u) ctx.fillRect(x, y + l.size * 1.02, it.w, Math.max(1, l.size / 18)); x += it.w;
            }
            y += lineH(l);
          }
        }
        async function drawTable(frame, group, part) {
          const tbl = frame.getElementsByTagNameNS('*', 'tbl')[0], x = kid(frame, 'xfrm'); if (!tbl || !x) return;
          const off = kid(x, 'off'), cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map(c => num(c.getAttribute('w')));
          const b = place({ x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), w: 0, h: 0 }, group); let y = px(b.y);
          for (const tr of kids(tbl, 'tr')) {
            const rowH = px(num(tr.getAttribute('h'))); let cx = px(b.x);
            kids(tr, 'tc').forEach((tc, ci) => {
              const cw = px(cols[ci] || 0); const f = fillOf(kid(tc, 'tcPr'), colors, clrMap); if (f && f !== 'none') { ctx.fillStyle = f; ctx.fillRect(cx, y, cw, rowH); }
              ctx.strokeStyle = 'rgba(120,120,120,.6)'; ctx.lineWidth = 1; ctx.strokeRect(cx, y, cw, rowH);
              const body = kid(tc, 'txBody'); if (body) { ctx.save(); ctx.beginPath(); ctx.rect(cx, y, cw, rowH); ctx.clip(); drawText(body, { X: cx, Y: y, W: cw, H: rowH }, null, null); ctx.restore(); }
              cx += cw;
            });
            y += rowH;
          }
        }
        await drawTree(master, true); await drawTree(layout, true); await drawTree(slide, false);
      },
    }));
    return { size: { w: W, h: H }, slides };
  }

  window.andromedaPptx = { parse, readZip };
})();
