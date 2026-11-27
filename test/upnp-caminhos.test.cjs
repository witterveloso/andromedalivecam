'use strict';
// Rede Andrômeda no 4G/5G: a porta precisa ser aberta no roteador. Caminhos além do UPnP simples:
// NAT-PMP (roteadores Mesh/Apple), NAT duplo (Mesh atrás do modem da operadora) e o roteador achado pelo gateway do sistema.
const { test } = require('node:test'), assert = require('node:assert/strict'), dgram = require('node:dgram');
const upnp = require('../upnp.cjs');

// Roteador NAT-PMP de verdade (UDP), com IP público 203.0.113.7.
async function natpmpRouter() {
  const sock = dgram.createSocket('udp4'), seen = [];
  sock.on('message', (msg, from) => {
    const op = msg[1];
    if (op === 0) { const r = Buffer.alloc(12); r[1] = 128; r.writeUInt32BE(1, 4); [203, 0, 113, 7].forEach((v, i) => { r[8 + i] = v; }); sock.send(r, from.port, from.address); return; }
    if (op === 1 || op === 2) { seen.push((op === 2 ? 'TCP ' : 'UDP ') + msg.readUInt16BE(4)); const r = Buffer.alloc(16); r[1] = 128 + op; r.writeUInt16BE(msg.readUInt16BE(4), 8); r.writeUInt16BE(msg.readUInt16BE(6), 10); r.writeUInt32BE(msg.readUInt32BE(8), 12); sock.send(r, from.port, from.address); }
  });
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  return { port: sock.address().port, seen, close: () => sock.close() };
}

test('sem UPnP, a porta abre por NAT-PMP no roteador (Mesh/Apple)', async () => {
  const router = await natpmpRouter();
  try {
    const r = await upnp.openPorts({ internalClient: '192.168.1.226', ports: [{ port: 3478, protocol: 'UDP' }, { port: 3478, protocol: 'TCP' }],
      discoverImpl: async () => [], gatewaysImpl: async () => ['127.0.0.1'], natpmpImpl: o => upnp.natpmpOpen({ ...o, natpmpPort: router.port }) });
    assert.equal(r.ok, true, r.error); assert.equal(r.via, 'nat-pmp'); assert.equal(r.externalIP, '203.0.113.7'); assert.equal(r.reachable, true);
    assert.deepEqual(router.seen, ['UDP 3478', 'TCP 3478']);
  } finally { router.close(); }
});

// Dois roteadores UPnP simulados: o Mesh (192.168.68.1, "IP público" 192.168.1.50) atrás do modem (192.168.1.1, IP 203.0.113.9).
function twoRouters() {
  const calls = [];
  const desc = host => '<root><URLBase>http://' + host + ':5000/</URLBase><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl</controlURL></service></serviceList></device></root>';
  const ext = { '192.168.68.1': '192.168.1.50', '192.168.1.1': '203.0.113.9' };
  const fetchImpl = async (url, opts = {}) => {
    const host = new URL(url).hostname;
    if (!opts.method) return new Response(desc(host), { status: 200 });
    const action = /#(\w+)"/.exec(opts.headers.SOAPAction)[1];
    if (action === 'AddPortMapping') { calls.push(host + ' → ' + /<NewInternalClient>([^<]+)/.exec(opts.body)[1] + ' ' + /<NewProtocol>([^<]+)/.exec(opts.body)[1]); return new Response('<ok/>', { status: 200 }); }
    if (action === 'GetExternalIPAddress') return new Response('<NewExternalIPAddress>' + ext[host] + '</NewExternalIPAddress>', { status: 200 });
    return new Response('', { status: 500 });
  };
  const discoverImpl = async ({ targets }) => targets.includes('192.168.68.1') ? ['http://192.168.68.1:5000/desc.xml'] : targets.includes('192.168.1.1') ? ['http://192.168.1.1:5000/desc.xml'] : [];
  return { calls, fetchImpl, discoverImpl };
}

test('NAT duplo (Mesh atrás do modem): a porta abre nos dois roteadores e o 4G/5G alcança a mesa', async () => {
  const sim = twoRouters();
  const r = await upnp.openPorts({ internalClient: '192.168.68.20', ports: [{ port: 3478, protocol: 'UDP' }, { port: 3478, protocol: 'TCP' }],
    fetchImpl: sim.fetchImpl, discoverImpl: sim.discoverImpl, gatewaysImpl: async () => ['192.168.68.1'], natpmpImpl: async () => { throw Error('sem NAT-PMP'); } });
  assert.equal(r.ok, true, r.error); assert.equal(r.levels, 2); assert.equal(r.externalIP, '203.0.113.9'); assert.equal(r.reachable, true);
  assert.deepEqual(sim.calls, ['192.168.68.1 → 192.168.68.20 UDP', '192.168.68.1 → 192.168.68.20 TCP', '192.168.1.1 → 192.168.1.50 UDP', '192.168.1.1 → 192.168.1.50 TCP'],
    'o Mesh aponta para a mesa e o modem aponta para o Mesh');
});

test('NAT duplo com o modem sem abrir: diz exatamente o que fazer', async () => {
  const sim = twoRouters();
  const r = await upnp.openPorts({ internalClient: '192.168.68.20', ports: [{ port: 3478, protocol: 'UDP' }], fetchImpl: sim.fetchImpl,
    discoverImpl: async ({ targets }) => targets.includes('192.168.68.1') ? ['http://192.168.68.1:5000/desc.xml'] : [], gatewaysImpl: async () => ['192.168.68.1'], natpmpImpl: async () => { throw Error('sem NAT-PMP'); } });
  assert.equal(r.reachable, false); assert.match(r.error, /dois roteadores.*modem/);
});

test('o roteador é achado pela tabela de rotas do sistema (Windows e Linux), com o .1 da rede de reserva', async () => {
  const win = await upnp.gateways({ platform: 'win32', addresses: () => ['192.168.68.20'], run: (cmd, args, o, cb) => cb(null, 'IPv4 Route Table\n Network Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0     192.168.68.1    192.168.68.20     35\n') });
  assert.deepEqual(win, ['192.168.68.1', '192.168.68.254']);
  const linux = await upnp.gateways({ platform: 'linux', addresses: () => ['10.0.0.5'], read: () => 'Iface\tDestination\tGateway\tFlags\nwlan0\t00000000\t0100000A\t0003\n' });
  assert.deepEqual(linux, ['10.0.0.1', '10.0.0.254']);
});
