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
 *  - cloudflare (legado, não é mais oferecido na tela): Cloudflare Realtime TURN. A mesa guarda o ID e o token da chave TURN (segredo de longa duração,
 *    nunca vai ao navegador) e gera credenciais temporárias de 24 h, renovadas a cada 12 h.
 *  - custom: servidor próprio (coturn ou outro): URLs, usuário e senha.
 *  - off: só STUN (funciona no Wi-Fi e na mesma rede; costuma falhar no 4G/5G).
 */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createTurnServer, credentials, lanAddress } = require('./andromeda-turn.cjs');
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

function createTurn({ dataDir, fetchImpl = globalThis.fetch, clock = Date.now, onEvent = () => {}, port = Number(process.env.ANDROMEDA_TURN_PORT || 3478), openPorts = upnp.openPorts, closePorts = upnp.closePorts, lan = lanAddress,
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
  const own = { server: null, port: 0, lan: '', router: null, error: '' }; // Rede Andrômeda nesta mesa
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
    own.lan = lan(); own.error = '';
    for (const p of [port, port + 1, port + 2]) {
      try {
        own.server = await createTurnServer({ secret, port: p, relayAddress: own.lan, allowPeer: ip => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip), onEvent }).listen();
        own.port = p; break;
      } catch (e) { own.error = 'porta ' + p + ' ocupada'; own.server = null; }
    }
    if (!own.server) return;
    onEvent('info', 'rede-andromeda', 'Rede Andrômeda ativa nesta mesa (porta ' + own.port + ' UDP/TCP)');
    // Abre a porta no roteador em segundo plano; a mesa funciona no Wi-Fi mesmo se o roteador recusar.
    openPorts({ internalClient: own.lan, ports: [{ port: own.port, protocol: 'UDP' }, { port: own.port, protocol: 'TCP' }] }).then(r => {
      own.router = r;
      onEvent(r.reachable ? 'info' : 'warn', 'rede-andromeda-roteador', r.reachable ? 'Porta ' + own.port + ' aberta no roteador; IP público ' + r.externalIP + ' (câmeras no 4G/5G chegam direto na mesa)'
        : 'Câmeras no 4G/5G: ' + (r.error ? 'o roteador não abriu a porta (' + r.error + ')' : 'a internet desta mesa usa CGNAT (' + r.externalIP + ')') + '. Use o servidor da Rede Andrômeda ou encaminhe a porta ' + own.port + ' UDP/TCP para ' + own.lan + '.');
    }).catch(() => {});
  }
  function ownServers() {
    if (!own.server) return [];
    const c = credentials(secret, { ttl: 24 * 3600, id: 'camera' }), hosts = [];
    if (own.router?.reachable && own.router.externalIP) hosts.push(own.router.externalIP);
    hosts.push(own.lan);
    return [{ urls: hosts.map(h => 'stun:' + h + ':' + own.port) },
      { urls: hosts.flatMap(h => ['turn:' + h + ':' + own.port + '?transport=udp', 'turn:' + h + ':' + own.port + '?transport=tcp']), username: c.username, credential: c.credential }];
  }
  function stopOwn() { own.server?.close(); own.server = null; if (own.router?.control) closePorts({ control: own.router.control, ports: [{ port: own.port, protocol: 'UDP' }, { port: own.port, protocol: 'TCP' }] }).catch(() => {}); own.router = null; }
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
        router: own.router ? { ok: own.router.ok, reachable: own.router.reachable, externalIP: own.router.externalIP, error: own.router.error, mapped: own.router.mapped } : null, stats: own.server?.stats() || null };
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
