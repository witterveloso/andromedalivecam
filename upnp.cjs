'use strict';
/*
 * Abertura automática de porta no roteador, sem biblioteca externa. É o que leva a câmera no 4G/5G até a mesa pela
 * Rede Andrômeda (retransmissão própria, porta 3478 UDP/TCP dentro da mesa).
 *
 * O caminho, nesta ordem, até um deles funcionar:
 *  1. UPnP IGD: a mesa procura o roteador (SSDP) em TODAS as placas de rede reais e também direto no endereço do
 *     roteador (gateway) — num computador com placa virtual (Hyper-V, VirtualBox, VPN) a busca só por multicast saía pela
 *     placa errada e o roteador nunca respondia. Pede o encaminhamento (AddPortMapping) e o IP público.
 *  2. NAT-PMP (RFC 6886): muitos roteadores Mesh e Apple abrem porta por NAT-PMP e não por UPnP.
 *  3. Dois roteadores (Mesh atrás do modem da operadora, "NAT duplo"): o primeiro devolve um IP de rede local como
 *     "público". A mesa então pede a mesma porta ao segundo roteador (o modem), apontando para o primeiro.
 * Se o IP público final for de CGNAT (100.64.0.0/10) ou privado, a porta não é alcançável de fora.
 */
const dgram = require('node:dgram'), os = require('node:os'), fs = require('node:fs'), { execFile } = require('node:child_process');

const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2'];
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];
const VIRTUAL = /vethernet|hyper-?v|virtualbox|vmware|vmnet|docker|wsl|loopback|tailscale|zerotier|hamachi|vpn|tap-|tun|bluetooth/i;

const isCgnat = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip) || isCgnat(ip);
const isLan = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

// Endereços IPv4 reais deste computador (cabo, Wi-Fi), para mandar a busca por cada placa.
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const n of list || []) if ((n.family === 'IPv4' || n.family === 4) && !n.internal && !n.address.startsWith('169.254.') && !VIRTUAL.test(name)) out.push(n.address);
  return [...new Set(out)];
}

// Roteador (gateway padrão) de cada rede: lido do sistema; se não der, o .1 e o .254 de cada rede local.
function gateways({ run = execFile, read = f => fs.readFileSync(f, 'utf8'), platform = process.platform, addresses = interfaces } = {}) {
  return new Promise(resolve => {
    const guess = () => addresses().filter(isLan).flatMap(a => { const p = a.split('.').slice(0, 3).join('.'); return [p + '.1', p + '.254']; });
    const finish = list => resolve([...new Set([...list, ...guess()].filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '0.0.0.0'))]);
    try {
      if (platform === 'linux') {
        const rows = read('/proc/net/route').split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(c => c[1] === '00000000' && c[2] && c[2] !== '00000000');
        finish(rows.map(c => { const h = c[2]; return [6, 4, 2, 0].map(i => parseInt(h.slice(i, i + 2), 16)).join('.'); })); return;
      }
      if (platform === 'win32') { run('route', ['print', '-4', '0.0.0.0'], { windowsHide: true, timeout: 4000 }, (e, out) => finish(e ? [] : [...String(out).matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/gm)].map(m => m[1]))); return; }
      if (platform === 'darwin') { run('route', ['-n', 'get', 'default'], { timeout: 4000 }, (e, out) => finish(e ? [] : [/gateway:\s*(\d+\.\d+\.\d+\.\d+)/.exec(String(out))?.[1]].filter(Boolean))); return; }
    } catch { /* sem tabela de rotas */ }
    finish([]);
  });
}

// Procura roteadores (SSDP M-SEARCH) por todas as placas e direto nos endereços dados (unicast). Devolve as URLs LOCATION.
function discover({ timeout = 2500, targets = [], addresses = interfaces() } = {}) {
  return new Promise(resolve => {
    const found = new Set(), socks = [];
    const done = () => { for (const s of socks) { try { s.close(); } catch { /* fechado */ } } resolve([...found]); };
    const query = st => Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
    const open = (bindAddr, sendTo) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); socks.push(sock);
      sock.on('message', msg => { const m = /^location:\s*(\S+)/im.exec(msg.toString()); if (m) found.add(m[1]); });
      sock.on('error', () => {});
      try {
        sock.bind(0, bindAddr, () => {
          try { if (bindAddr) sock.setMulticastInterface(bindAddr); } catch { /* sistema decide */ }
          for (const st of SEARCH_TARGETS) for (let i = 0; i < 2; i++) for (const [host, port] of sendTo) sock.send(query(st), port, host, () => {});
        });
      } catch { /* placa indisponível */ }
    };
    const multicast = [['239.255.255.250', 1900]], unicast = targets.map(t => [t, 1900]);
    if (addresses.length) for (const a of addresses) open(a, [...multicast, ...unicast]); else open(undefined, [...multicast, ...unicast]);
    setTimeout(done, timeout).unref?.();
  });
}

const tag = (xml, name) => { const m = new RegExp('<(?:\\w+:)?' + name + '>([^<]*)</(?:\\w+:)?' + name + '>', 'i').exec(xml); return m ? m[1].trim() : null; };

// Lê a descrição do roteador e acha o serviço de conexão WAN e seu endereço de controle.
async function controlOf(location, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(location, { signal: AbortSignal.timeout?.(4000) }); if (!r.ok) throw Error('descrição do roteador: HTTP ' + r.status);
  const xml = await r.text(), base = tag(xml, 'URLBase') || location;
  for (const service of SERVICES) {
    const blocks = xml.split(/<service>/i).slice(1);
    for (const b of blocks) if (tag(b, 'serviceType') === service) { const control = tag(b, 'controlURL'); if (control) return { service, url: new URL(control, base).toString() }; }
  }
  throw Error('o roteador não oferece encaminhamento de portas por UPnP');
}

async function soap(ctrl, action, args = {}, fetchImpl = globalThis.fetch) {
  const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="' + ctrl.service + '">' +
    Object.entries(args).map(([k, v]) => '<' + k + '>' + String(v).replace(/[<&>]/g, '') + '</' + k + '>').join('') + '</u:' + action + '></s:Body></s:Envelope>';
  const r = await fetchImpl(ctrl.url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: '"' + ctrl.service + '#' + action + '"' }, body, signal: AbortSignal.timeout?.(4000) });
  const text = await r.text();
  if (!r.ok) { const code = tag(text, 'errorCode'), desc = tag(text, 'errorDescription'); throw Object.assign(Error('roteador recusou ' + action + (code ? ' (' + code + (desc ? ' ' + desc : '') + ')' : ' (HTTP ' + r.status + ')')), { code: Number(code) || 0 }); }
  return text;
}

/* ---------- NAT-PMP (RFC 6886) ---------- */
function natpmpRequest(gateway, packet, { port = 5351, timeout = 2500, expectOp } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4'); let tries = 0, timer = null;
    const finish = (err, val) => { clearTimeout(timer); try { sock.close(); } catch { /* fechado */ } if (err) reject(err); else resolve(val); };
    sock.on('error', e => finish(e));
    sock.on('message', msg => {
      if (msg.length < 8 || msg[0] !== 0 || msg[1] !== expectOp) return;
      const code = msg.readUInt16BE(2); if (code) { finish(Error('o roteador recusou o NAT-PMP (código ' + code + ')')); return; }
      finish(null, msg);
    });
    const send = () => { if (++tries > 3) { finish(Error('o roteador não respondeu ao NAT-PMP')); return; } sock.send(packet, port, gateway, () => {}); timer = setTimeout(send, timeout / 3); };
    send();
  });
}
async function natpmpOpen({ gateway, ports, lease = 3600, natpmpPort = 5351 }) {
  const ext = await natpmpRequest(gateway, Buffer.from([0, 0]), { port: natpmpPort, expectOp: 128 });
  const externalIP = [8, 9, 10, 11].map(i => ext[i]).join('.'), mapped = [];
  for (const { port, protocol } of ports) {
    const op = protocol === 'TCP' ? 2 : 1, p = Buffer.alloc(12);
    p[0] = 0; p[1] = op; p.writeUInt16BE(port, 4); p.writeUInt16BE(port, 6); p.writeUInt32BE(lease, 8);
    const r = await natpmpRequest(gateway, p, { port: natpmpPort, expectOp: 128 + op });
    mapped.push(protocol + ' ' + r.readUInt16BE(10));
  }
  return { externalIP, mapped };
}

/* ---------- abertura em um roteador ---------- */
async function upnpOpen({ locations, internalClient, ports, description, lease, fetchImpl }) {
  let ctrl = null, lastError = null, router = null;
  for (const loc of locations) { try { ctrl = await controlOf(loc, fetchImpl); router = new URL(loc).host; break; } catch (e) { lastError = e; } }
  if (!ctrl) throw lastError || Error('roteador sem UPnP');
  const mapped = [];
  for (const { port, protocol } of ports) {
    const args = l => ({ NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol, NewInternalPort: port, NewInternalClient: internalClient, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: l });
    try { await soap(ctrl, 'AddPortMapping', args(lease), fetchImpl); }
    catch (e) { if (e.code === 725) await soap(ctrl, 'AddPortMapping', args(0), fetchImpl); else throw e; } // 725: só aceita encaminhamento permanente
    mapped.push(protocol + ' ' + port);
  }
  const externalIP = tag(await soap(ctrl, 'GetExternalIPAddress', {}, fetchImpl), 'NewExternalIPAddress');
  return { router, control: ctrl, mapped, externalIP };
}

/**
 * openPorts({ internalClient, ports: [{ port, protocol }], … })
 * → { ok, externalIP, reachable, router, via: 'upnp'|'nat-pmp', levels, mapped: [...], error, control }
 */
async function openPorts({ internalClient, ports, description = 'Andromeda Live', lease = 3600, location = null, fetchImpl = globalThis.fetch, discoverImpl = discover, gatewaysImpl = gateways, natpmpImpl = natpmpOpen } = {}) {
  const out = { ok: false, externalIP: null, reachable: false, router: null, via: '', levels: 0, mapped: [], error: '' };
  const errors = [];
  // Um nível: UPnP (busca em todas as placas + direto no roteador); se não houver, NAT-PMP.
  async function level(client, gws, loc) {
    try {
      const locations = loc ? [loc] : await discoverImpl({ targets: gws });
      if (!locations.length) throw Error('nenhum roteador com UPnP respondeu na rede local');
      const r = await upnpOpen({ locations: gws.length && !loc ? prefer(locations, gws) : locations, internalClient: client, ports, description, lease, fetchImpl });
      return { ...r, via: 'upnp' };
    } catch (e) { errors.push(e.message); }
    for (const gw of gws) {
      try { const r = await natpmpImpl({ gateway: gw, ports, lease }); return { ...r, router: gw, via: 'nat-pmp' }; }
      catch (e) { errors.push(e.message); }
    }
    return null;
  }
  // Respostas do roteador certo primeiro (o gateway desta rede), não de outro aparelho UPnP qualquer.
  const prefer = (locs, gws) => [...locs].sort((a, b) => Number(!gws.some(g => a.includes('//' + g))) - Number(!gws.some(g => b.includes('//' + g))));
  try {
    const gws = location ? [] : await gatewaysImpl();
    const first = await level(internalClient, gws, location);
    if (!first) throw Error(errors[0] || 'nenhum roteador respondeu');
    Object.assign(out, { ok: true, router: first.router, via: first.via, control: first.control, mapped: first.mapped, externalIP: first.externalIP, levels: 1 });
    // NAT duplo: o primeiro roteador está atrás de outro (Mesh ligado no modem). Abre a mesma porta no segundo, para o primeiro.
    if (out.externalIP && isLan(out.externalIP) && !location) {
      const p = out.externalIP.split('.').slice(0, 3).join('.'), upstream = [p + '.1', p + '.254'].filter(ip => ip !== out.externalIP);
      const second = await level(out.externalIP, upstream, null);
      if (second?.externalIP) { out.levels = 2; out.via += '+' + second.via; out.mapped.push(...second.mapped.map(m => m + ' (2º roteador)')); out.externalIP = second.externalIP; out.upstream = { router: second.router, control: second.control }; }
      else out.error = 'dois roteadores: o segundo (modem da operadora) não abriu a porta. Ative o UPnP no modem ou coloque o Mesh em modo ponte.';
    }
    out.reachable = !!out.externalIP && !isPrivate(out.externalIP);
  } catch (e) { out.error = e.message; }
  return out;
}

async function closePorts({ control, upstream, ports, fetchImpl = globalThis.fetch }) {
  for (const c of [control, upstream?.control]) {
    if (!c) continue;
    for (const { port, protocol } of ports) { try { await soap(c, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol }, fetchImpl); } catch { /* já removida */ } }
  }
}

module.exports = { discover, gateways, openPorts, closePorts, natpmpOpen, isCgnat, isPrivate, _internal: { controlOf, soap, tag, interfaces, natpmpRequest } };
