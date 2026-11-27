'use strict';
/*
 * Retransmissão TURN para as câmeras em rede móvel (4G/5G).
 *
 * Só com STUN, a imagem do celular precisa de um caminho direto até a mesa. As operadoras móveis põem o
 * aparelho atrás de NAT compartilhado (CGNAT, muitas vezes simétrico, às vezes só IPv6) e a mesa costuma estar
 * atrás do roteador: o caminho direto falha e a câmera "conecta" mas a imagem não chega. Um servidor TURN
 * retransmite a mídia quando o caminho direto não existe (inclusive pela porta 443, que redes restritas liberam).
 *
 * Provedores:
 *  - andromeda (padrão): a Rede Andrômeda dentro da própria mesa (andromeda-turn.cjs, código nosso): STUN e TURN na porta
 *    3478 UDP/TCP, porta aberta no roteador por UPnP (upnp.cjs), credenciais temporárias geradas aqui. Sem serviço de terceiros.
 *  - custom: servidor da Rede Andrômeda da empresa (o mesmo andromeda-turn.cjs, no kit cloud/) ou outro TURN próprio.
 *  - cloudflare (recomendado para 4G/5G em qualquer rede, sem mexer no roteador): Cloudflare Realtime TURN. A mesa guarda o ID e o token da chave TURN (segredo de longa duração,
 *    nunca vai ao navegador) e gera credenciais temporárias de 24 h, renovadas a cada 12 h.
 *  - custom: servidor próprio (coturn ou outro): URLs, usuário e senha.
 *  - off: só STUN (funciona no Wi-Fi e na mesma rede; costuma falhar no 4G/5G).
 */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createTurnServer, credentials, lanAddress, localAddresses, routeAddress, isCgnatIp, isLanIp } = require('./andromeda-turn.cjs');
const upnp = require('./upnp.cjs');

// Sem STUN de terceiros: a própria retransmissão Andrômeda responde STUN.
const STUN = [];
const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys/';
const TTL = 86400, REFRESH_MS = 12 * 3600 * 1000;

function cleanUrls(list) {
  // Porta 53 é bloqueada pelos navegadores (a própria Cloudflare recomenda removê-la).
  return (Array.isArray(list) ? list : [list]).map(String).filter(u => /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u));
}
function normalize(iceServers) {
  const list = Array.isArray(iceServers) ? iceServers : iceServers ? [iceServers] : [];
  return list.map(s => ({ urls: cleanUrls(s.urls), ...(s.username ? { username: String(s.username), credential: String(s.credential || '') } : {}) })).filter(s => s.urls.length);
}
const hasRelay = servers => servers.some(s => s.urls.some(u => /^turns?:/.test(u)));

function createTurn({ dataDir, fetchImpl = globalThis.fetch, clock = Date.now, onEvent = () => {}, port = Number(process.env.ANDROMEDA_TURN_PORT || 3478), openPorts = upnp.openPorts, closePorts = upnp.closePorts, lan = null, watchMs = 10000,
  network = process.env.ANDROMEDA_TURN_URLS && process.env.ANDROMEDA_TURN_SECRET ? { urls: cleanUrls(process.env.ANDROMEDA_TURN_URLS.split(',')), secret: process.env.ANDROMEDA_TURN_SECRET } : null } = {}) {
  // Servidor da Rede Andrômeda da empresa (mesa-cloud.env): soma-se à retransmissão desta mesa como reserva
  // (mesa atrás de CGNAT ou roteador sem UPnP). Credenciais temporárias geradas aqui com o segredo da rede.
  const networkServers = () => {
    if (!network?.urls?.length || !network.secret) return [];
    const c = credentials(network.secret, { ttl: 24 * 3600, id: 'camera' }), hosts = [...new Set(network.urls.map(u => /^turns?:([^?]+)/.exec(u)?.[1]).filter(Boolean))];
    return [{ urls: hosts.map(h => 'stun:' + h) }, { urls: network.urls, username: c.username, credential: c.credential }];
  };
  const file = path.join(dataDir, 'turn.json');
  let config = { provider: 'andromeda' };
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved && ['off', 'cloudflare', 'custom', 'andromeda'].includes(saved.provider)) config = saved; } catch { /* sem configuração */ }
  // Segredo da retransmissão desta mesa: gerado uma vez, guardado só aqui (as câmeras recebem credenciais temporárias).
  let secret = ''; try { secret = JSON.parse(fs.readFileSync(file, 'utf8')).secret || ''; } catch { /* primeiro uso */ }
  if (!/^[0-9a-f]{64}$/.test(secret)) { secret = crypto.randomBytes(32).toString('hex'); try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...config, secret }), { mode: 0o600 }); } catch { /* só nesta sessão */ } }
  const own = { server: null, port: 0, lan: '', lans: [], router: null, error: '' }; // Rede Andrômeda nesta mesa
  // Endereços desta mesa, o da rota padrão primeiro (cabo ou Wi-Fi, o que estiver levando à internet). Refeito a cada
  // 10 s: trocar do Wi-Fi para o cabo com o programa aberto não deixa as câmeras apontando para o endereço antigo.
  const addresses = async () => lan ? [lan()] : [...new Set([await routeAddress(), ...localAddresses()].filter(Boolean))];
  let watch = null;
  let relay = [], expires = 0, lastError = '', refreshing = null, timer = null;

  function validate(input) {
    const provider = ['off', 'cloudflare', 'custom', 'andromeda'].includes(input?.provider) ? input.provider : null;
    if (provider === 'andromeda') return { provider };
    if (!provider) throw Error('Escolha o provedor de retransmissão.');
    if (provider === 'cloudflare') {
      const keyId = String(input.keyId || '').trim(), token = String(input.token || '').trim() || (config.provider === 'cloudflare' ? config.token : '');
      if (!/^[A-Za-z0-9]{16,64}$/.test(keyId)) throw Error('Informe o ID da chave TURN da Cloudflare (Turn Key ID).');
      if (!/^[A-Za-z0-9._-]{20,200}$/.test(token || '')) throw Error('Informe o token da chave TURN da Cloudflare (API Token).');
      return { provider, keyId, token };
    }
    if (provider === 'custom') {
      const urls = cleanUrls(String(input.urls || '').split(/[\s,]+/).filter(Boolean));
      if (!urls.some(u => /^turns?:/.test(u))) throw Error('Informe ao menos um endereço turn: ou turns:, por exemplo turn:turn.seudominio.com:3478.');
      const username = String(input.username || '').trim(), credential = String(input.credential || '') || (config.provider === 'custom' ? config.credential : '');
      if (!username || !credential) throw Error('Informe o usuário e a senha do servidor TURN.');
      return { provider, urls, username, credential };
    }
    return { provider: 'off' };
  }

  async function fetchCloudflare(cfg) {
    if (!fetchImpl) throw Error('Sem acesso à internet neste computador.');
    const r = await fetchImpl(CF_API + encodeURIComponent(cfg.keyId) + '/credentials/generate-ice-servers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: TTL }),
      signal: AbortSignal.timeout?.(10000),
    });
    if (r.status === 401 || r.status === 403) throw Error('A Cloudflare recusou a chave TURN: confira o ID e o token.');
    if (!r.ok) throw Error('A Cloudflare respondeu ' + r.status + ' ao gerar as credenciais TURN.');
    const body = await r.json();
    const servers = normalize(body.iceServers).filter(s => s.username);
    if (!hasRelay(servers)) throw Error('A Cloudflare não devolveu servidores TURN.');
    return servers;
  }

  // force: uma troca de configuração não espera nem reaproveita a renovação em andamento da configuração anterior.
  async function refresh(cfg = config, force = false) {
    if (refreshing && !force) return refreshing;
    refreshing = (async () => {
      try {
        if (cfg.provider === 'cloudflare') { relay = await fetchCloudflare(cfg); expires = clock() + TTL * 1000; }
        else if (cfg.provider === 'custom') { relay = [{ urls: cfg.urls, username: cfg.username, credential: cfg.credential }]; expires = Infinity; }
        else if (cfg.provider === 'andromeda') { await startOwn(); relay = []; expires = Infinity; if (!own.server) throw Error(own.error || 'a retransmissão Andrômeda não iniciou'); }
        else { relay = []; expires = 0; }
        lastError = '';
        return true;
      } catch (e) { lastError = e.message; onEvent('warn', 'turn-falhou', 'Retransmissão TURN indisponível: ' + e.message); return false; }
    })();
    // Libera depois de atribuir (sem await no caminho, a função termina antes da atribuição).
    const current = refreshing; current.finally(() => { if (refreshing === current) refreshing = null; });
    return current;
  }
  // Liga a Rede Andrômeda nesta mesa: servidor STUN/TURN próprio + porta aberta no roteador (UPnP).
  async function startOwn() {
    if (own.server) return;
    own.lans = await addresses(); own.lan = own.lans[0] || '127.0.0.1'; own.error = '';
    for (const p of [port, port + 1, port + 2]) {
      try {
        // Só entrega mídia para esta própria mesa (rede local ou os endereços deste computador): nunca vira retransmissor aberto.
        own.server = await createTurnServer({ secret, port: p, relayAddress: () => own.lan, allowPeer: ip => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || own.lans.includes(ip), onEvent }).listen();
        own.port = p; break;
      } catch (e) { own.error = 'porta ' + p + ' ocupada'; own.server = null; }
    }
    if (!own.server) return;
    onEvent('info', 'rede-andromeda', 'Rede Andrômeda ativa nesta mesa (porta ' + own.port + ' UDP/TCP) · ' + describeLan());
    probeRouter();
    clearInterval(watch); watch = setInterval(() => recheck().catch(() => {}), watchMs); watch.unref?.();
  }
  const describeLan = () => own.lan + (isLanIp(own.lan) ? ' (rede local)' : isCgnatIp(own.lan) ? ' (ligado direto no modem, endereço compartilhado da operadora)' : ' (ligado direto na internet)');
  // Como o celular de fora chega a esta mesa:
  //  - computador ligado direto no modem com IP público: chega direto, sem roteador no meio (só o firewall do Windows decide);
  //  - computador ligado direto no modem com IP de CGNAT: de fora não chega; só o servidor da Rede Andrômeda resolve;
  //  - computador atrás de roteador: o roteador precisa abrir a porta (UPnP), como antes.
  function probeRouter(changed = false) {
    const lanIp = own.lan, done = r => {
      if (own.lan !== lanIp || !own.server) return; own.router = r;
      // Só depois de saber como o celular de fora chega (porta aberta, IP público) é que as câmeras são chamadas a reconectar.
      if (changed) setTimeout(() => onEvent('info', 'rede-pronta', 'Rede nova pronta: ' + describeLan() + (r.reachable ? ' · 4G/5G alcança a mesa' : ' · 4G/5G só pelo servidor da Rede Andrômeda')), 0);
      onEvent(r.reachable ? 'info' : 'warn', 'rede-andromeda-roteador', r.reachable
        ? (r.direct ? 'Computador ligado direto na internet (IP público ' + r.externalIP + '): câmeras no 4G/5G chegam direto na mesa. Se o Windows perguntar, permita o Andrômeda Live também em redes públicas.'
          : 'Porta ' + own.port + ' aberta no roteador; IP público ' + r.externalIP + ' (câmeras no 4G/5G chegam direto na mesa)')
        : 'Câmeras no 4G/5G: ' + (r.direct ? 'este computador está ligado direto no modem com endereço compartilhado da operadora (CGNAT ' + r.externalIP + '); de fora não há caminho' : r.error ? 'o roteador não abriu a porta (' + r.error + ')' : 'a internet desta mesa usa CGNAT (' + r.externalIP + ')') + '. Use o servidor da Rede Andrômeda' + (r.direct ? '' : ' ou encaminhe a porta ' + own.port + ' UDP/TCP para ' + own.lan) + '.');
    };
    if (!isLanIp(lanIp) && lanIp !== '127.0.0.1') { const cg = isCgnatIp(lanIp); done({ ok: !cg, reachable: !cg, direct: true, externalIP: lanIp, mapped: [], error: cg ? 'CGNAT' : '' }); return; }
    openPorts({ internalClient: lanIp, ports: [{ port: own.port, protocol: 'UDP' }, { port: own.port, protocol: 'TCP' }] }).then(done).catch(e => done({ ok: false, reachable: false, error: e.message, mapped: [] }));
  }
  async function recheck() {
    if (!own.server) return;
    const now = await addresses(); if (!now.length || (now[0] === own.lan && now.join() === own.lans.join())) return;
    const before = own.lan; own.lans = now; own.lan = now[0];
    if (before !== own.lan) {
      onEvent('info', 'rede-mudou', 'A rede deste computador mudou: ' + before + ' → ' + describeLan() + '. As câmeras novas e as que reconectarem já usam o endereço novo.');
      if (own.router?.control) closePorts({ control: own.router.control, ports: [{ port: own.port, protocol: 'UDP' }, { port: own.port, protocol: 'TCP' }] }).catch(() => {});
      own.router = null; probeRouter(true);
    }
  }
  function ownServers() {
    if (!own.server) return [];
    const c = credentials(secret, { ttl: 24 * 3600, id: 'camera' }), hosts = [];
    if (own.router?.reachable && own.router.externalIP) hosts.push(own.router.externalIP);
    hosts.push(...own.lans);
    const uniq = [...new Set(hosts)];
    return [{ urls: uniq.map(h => 'stun:' + h + ':' + own.port) },
      { urls: uniq.flatMap(h => ['turn:' + h + ':' + own.port + '?transport=udp', 'turn:' + h + ':' + own.port + '?transport=tcp']), username: c.username, credential: c.credential }];
  }
  function stopOwn() { clearInterval(watch); watch = null; own.server?.close(); own.server = null; if (own.router?.control) closePorts({ control: own.router.control, ports: [{ port: own.port, protocol: 'UDP' }, { port: own.port, protocol: 'TCP' }] }).catch(() => {}); own.router = null; }
  function schedule() {
    clearInterval(timer); timer = null;
    if (config.provider === 'cloudflare') { timer = setInterval(() => refresh(), REFRESH_MS); timer.unref?.(); }
  }

  return {
    // Lista enviada a cada câmera e à mesa no início da negociação.
    servers() {
      if (config.provider === 'cloudflare' && clock() > expires - 3600 * 1000) refresh();
      if (config.provider === 'andromeda') return [...ownServers(), ...networkServers()];
      // Servidor próprio (Rede Andrômeda da empresa): o mesmo endereço responde STUN.
      const stun = config.provider === 'custom' ? [...new Set(relay.flatMap(r => r.urls).map(u => /^turns?:([^?]+)/.exec(u)?.[1]).filter(Boolean).map(h => 'stun:' + h))] : [];
      return [...STUN, ...(stun.length ? [{ urls: stun }] : []), ...relay];
    },
    status() {
      if (config.provider === 'andromeda') return { provider: 'andromeda', ready: !!own.server || !!network, network: network ? network.urls : null, error: own.server ? '' : (own.error || lastError), port: own.port, lan: own.lan,
        lans: own.lans, router: own.router ? { ok: own.router.ok, reachable: own.router.reachable, direct: !!own.router.direct, externalIP: own.router.externalIP, error: own.router.error, mapped: own.router.mapped } : null, stats: own.server?.stats() || null };
      return { provider: config.provider, ready: hasRelay(relay), error: lastError, expires: Number.isFinite(expires) && expires ? new Date(expires).toISOString() : null,
        keyId: config.provider === 'cloudflare' ? config.keyId : undefined, hasToken: config.provider === 'cloudflare' ? !!config.token : undefined,
        urls: config.provider === 'custom' ? config.urls : config.provider === 'cloudflare' ? relay.flatMap(s => s.urls).filter(u => /^turns?:/.test(u)) : [],
        username: config.provider === 'custom' ? config.username : undefined };
    },
    // Salva só se as credenciais funcionarem (no caso da Cloudflare), para não deixar a mesa sem retransmissão.
    async save(input) {
      const next = validate(input), previous = config;
      config = next;
      const ok = await refresh(next, true);
      if (!ok && next.provider === 'cloudflare') { config = previous; await refresh(previous, true); throw Error(lastError || 'Não foi possível validar a chave TURN.'); }
      if (next.provider !== 'andromeda') stopOwn();
      fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...config, secret }), { mode: 0o600 });
      schedule();
      onEvent('info', 'turn-configurado', 'Retransmissão: ' + ({ off: 'desligada (só Wi-Fi / mesma rede)', cloudflare: 'Cloudflare', custom: 'servidor da Rede Andrômeda', andromeda: 'Rede Andrômeda nesta mesa' })[next.provider]);
      return this.status();
    },
    async start() { await refresh(); schedule(); return this.status(); },
    stop() { clearInterval(timer); timer = null; stopOwn(); },
  };
}

module.exports = { createTurn, normalize, STUN };
