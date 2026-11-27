'use strict';
/*
 * PONTO — comunicação da direção (DTV / coordenação) com apresentador e repórter.
 *
 * Caminho próprio, separado do intercom dos operadores de câmera:
 *  - convites próprios (Ponto 1 a 4: Apresentador, Repórter…), com chave própria;
 *  - ponto de encontro próprio (canal cifrado próprio, derivado da chave do convite);
 *  - conexão WebRTC de áudio própria entre a mesa e o celular de quem está no ar.
 *
 * O apresentador ouve no fone: a voz da direção (quando ela fala com ele) e, se quiser, o retorno do programa (que abaixa
 * sozinho quando a direção fala). Ele recebe também avisos escritos (ex.: "30 s", "chama o VT") e pode chamar a direção.
 *
 * Mensagens (JSON):
 *  mesa → serviço: signal {slot, signal}, cue {slots:[…], talking}, msg {slot|'all', text}, return {slot, on}
 *  ponto → serviço: join {key} (ou pelo ponto de encontro), signal {signal}, talkback {active}, presence {state}, return {on}
 *  serviço → mesa: ready, ponto {slot,name}, ponto-left {slot}, signal {slot,signal}, talkback {slot,active}, return {slot,on}
 *  serviço → ponto: ready {slot,name,iceServers}, negotiate, signal, cue {talking}, msg {text,at}, desk-offline
 */
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const SLOTS = [0, 1, 2, 3];
const VALID = 7 * 86400000; // o link vale 7 dias desde o último uso, inclusive depois de fechar e abrir o programa

function createPontoHub({ sessionToken, iceServers = [], clock = Date.now, onEvent = () => {}, inviteURL = null, onInvite = () => {}, onInviteEnd = () => {}, store = null } = {}) {
  const ice = () => typeof iceServers === 'function' ? iceServers() : iceServers;
  const invites = new Map(), pontos = new Map(); // chave -> {slot,name,expires} · slot -> {ws,name,key,talkback,returnOn}
  let desk = null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 300000, perMessageDeflate: false });
  const send = (ws, msg) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 500000) ws.send(JSON.stringify(msg)); };
  const state = () => ({ slots: SLOTS, pontos: [...pontos].map(([slot, p]) => ({ slot, name: p.name, talkback: !!p.talkback, returnOn: !!p.returnOn })), invites: [...invites.values()].map(i => ({ slot: i.slot, name: i.name, expires: i.expires })) });
  const cleanName = (name, slot) => String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || ('Ponto ' + (slot + 1));

  const persist = () => { try { store?.save([...invites].map(([key, v]) => ({ key, ...v }))); } catch { /* sem disco: vale até fechar o programa */ } };
  function revoke(slot) {
    let had = pontos.has(slot);
    for (const [key, inv] of invites) if (inv.slot === slot) { invites.delete(key); onInviteEnd(key); had = true; persist(); }
    pontos.get(slot)?.ws.close(4002, 'Ponto revogado pela direção');
    if (had) onEvent('info', 'ponto-revogado', 'Convite do Ponto ' + (slot + 1) + ' revogado', { slot });
  }
  function invite(slot, name) {
    if (!SLOTS.includes(slot)) throw Error('Ponto inválido (use 1 a 4).');
    const key = crypto.randomBytes(24).toString('hex'), url = inviteURL?.(key);
    if (!url) throw Error('Endereço do app do ponto indisponível.');
    revoke(slot);
    const inv = { slot, name: cleanName(name, slot), expires: clock() + VALID };
    invites.set(key, inv); persist(); onInvite(key);
    onEvent('info', 'ponto-convite', 'Convite do PONTO criado: ' + inv.name, { slot });
    return { slot, name: inv.name, url, expires: inv.expires };
  }

  function connect(ws, role, credential) {
    let slot = null;
    if (role === 'desk') {
      if (credential !== sessionToken) { ws.close(4001, 'Mesa não autorizada'); return; }
      if (desk && desk !== ws) desk.close(4005, 'Outra janela da mesa assumiu o PONTO');
      desk = ws; send(ws, { type: 'ready', iceServers: ice() });
      for (const [s, p] of pontos) { send(ws, { type: 'ponto', slot: s, name: p.name }); send(p.ws, { type: 'negotiate', iceServers: ice() }); }
    } else {
      const inv = invites.get(credential);
      if (!inv || inv.expires < clock()) { ws.close(4001, 'Convite do ponto inválido ou expirado. Peça outro à direção.'); return; }
      slot = inv.slot; inv.expires = Math.max(inv.expires, clock() + VALID); persist();
      const old = pontos.get(slot); if (old && old.ws !== ws) old.ws.close(4006, 'O ponto foi aberto em outro aparelho');
      pontos.set(slot, { ws, name: inv.name, key: credential, talkback: false, returnOn: false });
      onEvent('info', 'ponto-conectado', inv.name + ' entrou no PONTO', { slot });
      send(ws, { type: 'ready', slot, name: inv.name, iceServers: ice(), desk: !!desk });
      send(desk, { type: 'ponto', slot, name: inv.name });
      if (desk) send(ws, { type: 'negotiate', iceServers: ice() });
    }
    let count = 0; const rate = setInterval(() => { count = 0; }, 1000); rate.unref?.();
    ws.on('message', raw => {
      if (++count > 150) { ws.close(4008, 'Limite de mensagens'); return; }
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'signal' && m.signal && typeof m.signal === 'object') {
        const clean = {}, s = m.signal;
        if (s.description && ['offer', 'answer'].includes(s.description.type) && typeof s.description.sdp === 'string' && s.description.sdp.length < 100000) clean.description = { type: s.description.type, sdp: s.description.sdp };
        if (s.candidate && typeof s.candidate.candidate === 'string' && s.candidate.candidate.length < 4096) clean.candidate = s.candidate;
        if (!Object.keys(clean).length) return;
        if (role === 'desk') send(pontos.get(m.slot)?.ws, { type: 'signal', signal: clean }); else send(desk, { type: 'signal', slot, signal: clean });
        return;
      }
      if (role === 'desk') {
        const targets = (list => Array.isArray(list) ? list.filter(s => pontos.has(s)) : [])(m.slots ?? (m.slot === 'all' ? [...pontos.keys()] : [m.slot]));
        if (m.type === 'cue') { for (const [s, p] of pontos) send(p.ws, { type: 'cue', talking: m.talking === true && targets.includes(s) }); return; }
        if (m.type === 'msg') {
          const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140); if (!text) return;
          for (const s of targets) send(pontos.get(s).ws, { type: 'msg', text, at: clock() });
          onEvent('info', 'ponto-aviso', 'Aviso no PONTO: ' + text, { para: targets.map(s => pontos.get(s).name) });
          return;
        }
        if (m.type === 'return') { const p = pontos.get(m.slot); if (p) { p.returnOn = m.on === true; send(p.ws, { type: 'return', on: p.returnOn }); } return; }
        return;
      }
      // Quem está no ar: chamar a direção, ligar/desligar o retorno do programa, avisar que o app saiu da tela.
      const p = pontos.get(slot); if (!p || p.ws !== ws) return;
      if (m.type === 'talkback') { p.talkback = m.active === true; send(desk, { type: 'talkback', slot, active: p.talkback }); if (p.talkback) onEvent('info', 'ponto-chamando', p.name + ' chamou a direção', { slot }); return; }
      if (m.type === 'return') { p.returnOn = m.on === true; send(desk, { type: 'return', slot, on: p.returnOn }); return; }
      if (m.type === 'presence') { send(desk, { type: 'presence', slot, state: m.state === 'background' ? 'background' : 'foreground' }); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearInterval(rate);
      if (role === 'desk' && desk === ws) { desk = null; for (const p of pontos.values()) send(p.ws, { type: 'desk-offline' }); }
      else if (role === 'ponto' && pontos.get(slot)?.ws === ws) { onEvent('warn', 'ponto-saiu', pontos.get(slot).name + ' saiu do PONTO', { slot }); pontos.delete(slot); send(desk, { type: 'ponto-left', slot }); }
    });
  }

  // Convites vencidos saem sozinhos (7 dias sem uso).
  const sweep = setInterval(() => { for (const [k, v] of invites) if (v.expires < clock()) { invites.delete(k); onInviteEnd(k); persist(); if (pontos.get(v.slot)?.key === k) pontos.get(v.slot).ws.close(4003, 'Convite do ponto expirou'); } }, 30000);
  sweep.unref?.();

  function restore() {
    let n = 0;
    try { for (const v of store?.load() || []) { if (!v || !/^[0-9a-f]{48}$/.test(v.key || '') || !SLOTS.includes(v.slot) || !(v.expires > clock())) continue; invites.set(v.key, { slot: v.slot, name: cleanName(v.name, v.slot), expires: v.expires }); onInvite(v.key); n++; } } catch { /* começa sem convites */ }
    return n;
  }
  return {
    state, invite, revoke, restore,
    deskUpgrade(req, socket, head) { if (req.headers['sec-websocket-protocol'] !== 'andromeda.' + sessionToken) { socket.destroy(); return; } wss.handleUpgrade(req, socket, head, ws => connect(ws, 'desk', sessionToken)); },
    // Para o ponto de encontro (relay.cjs): o celular chega por lá e vira uma conexão igual a um WebSocket.
    join: (ws, key) => connect(ws, 'ponto', key),
    lookup: key => { const inv = invites.get(key); return inv && inv.expires >= clock() ? { kind: 'ponto', name: inv.name, slot: inv.slot, desk: !!desk } : null; },
    renegotiate() { if (!desk) return 0; send(desk, { type: 'ice', iceServers: ice() }); for (const p of pontos.values()) send(p.ws, { type: 'negotiate', iceServers: ice() }); return pontos.size; },
    close() { clearInterval(sweep); for (const ws of wss.clients) ws.terminate(); wss.close(); for (const p of pontos.values()) p.ws.close(1001); },
  };
}

module.exports = { createPontoHub, SLOTS };
