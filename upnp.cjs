'use strict';
/*
 * Abertura automática de porta no roteador (UPnP IGD), sem biblioteca externa.
 *
 * A retransmissão Andrômeda roda dentro da mesa (porta 3478 UDP/TCP). Para o celular no 5G alcançá-la, o roteador
 * precisa encaminhar essa porta para o computador da mesa. A maioria dos roteadores domésticos aceita o pedido
 * por UPnP: a mesa encontra o roteador (SSDP), pede o encaminhamento (SOAP AddPortMapping) e descobre o IP público
 * (GetExternalIPAddress). Se o IP público for de CGNAT (100.64.0.0/10) ou privado, a porta não é alcançável de fora
 * e a mesa avisa para usar o servidor da Rede Andrômeda.
 */
const dgram = require('node:dgram');

const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2'];
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

// Procura roteadores na rede local (SSDP M-SEARCH) e devolve as URLs de descrição (LOCATION).
function discover({ timeout = 2500 } = {}) {
  return new Promise(resolve => {
    const found = new Set(), sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch { /* fechado */ } resolve([...found]); };
    sock.on('message', msg => { const m = /^location:\s*(\S+)/im.exec(msg.toString()); if (m) found.add(m[1]); });
    sock.on('error', done);
    sock.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
        for (let i = 0; i < 2; i++) sock.send(q, 1900, '239.255.255.250');
      }
    });
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

const isCgnat = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip) || isCgnat(ip);

/**
 * openPorts({ internalClient, ports: [{ port, protocol }], description, location?, fetchImpl? })
 * → { ok, externalIP, reachable, router, mapped: [...], error }
 */
async function openPorts({ internalClient, ports, description = 'Andromeda Live', lease = 3600, location = null, fetchImpl = globalThis.fetch, discoverImpl = discover } = {}) {
  const out = { ok: false, externalIP: null, reachable: false, router: null, mapped: [], error: '' };
  try {
    const locations = location ? [location] : await discoverImpl();
    if (!locations.length) throw Error('nenhum roteador com UPnP respondeu na rede local');
    let ctrl = null, lastError = null;
    for (const loc of locations) { try { ctrl = await controlOf(loc, fetchImpl); out.router = new URL(loc).host; break; } catch (e) { lastError = e; } }
    if (!ctrl) throw lastError || Error('roteador sem UPnP');
    for (const { port, protocol } of ports) {
      const args = lease => ({ NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol, NewInternalPort: port, NewInternalClient: internalClient, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease });
      try { await soap(ctrl, 'AddPortMapping', args(lease), fetchImpl); }
      catch (e) { if (e.code === 725) await soap(ctrl, 'AddPortMapping', args(0), fetchImpl); else throw e; } // 725: o roteador só aceita encaminhamento permanente
      out.mapped.push(protocol + ' ' + port);
    }
    out.externalIP = tag(await soap(ctrl, 'GetExternalIPAddress', {}, fetchImpl), 'NewExternalIPAddress');
    out.reachable = !!out.externalIP && !isPrivate(out.externalIP);
    out.ok = true;
    out.control = ctrl;
  } catch (e) { out.error = e.message; }
  return out;
}

async function closePorts({ control, ports, fetchImpl = globalThis.fetch }) {
  if (!control) return;
  for (const { port, protocol } of ports) { try { await soap(control, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol }, fetchImpl); } catch { /* já removida */ } }
}

module.exports = { discover, openPorts, closePorts, isCgnat, isPrivate, _internal: { controlOf, soap, tag } };
