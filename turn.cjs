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
 *  - cloudflare: Cloudflare Realtime TURN. A mesa guarda o ID e o token da chave TURN (segredo de longa duração,
 *    nunca vai ao navegador) e gera credenciais temporárias de 24 h, renovadas a cada 12 h.
 *  - custom: servidor próprio (coturn ou outro): URLs, usuário e senha.
 *  - off: só STUN (funciona no Wi-Fi e na mesma rede; costuma falhar no 4G/5G).
 */
const fs = require('node:fs'), path = require('node:path');

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
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

function createTurn({ dataDir, fetchImpl = globalThis.fetch, clock = Date.now, onEvent = () => {} } = {}) {
  const file = path.join(dataDir, 'turn.json');
  let config = { provider: 'off' };
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved && ['off', 'cloudflare', 'custom'].includes(saved.provider)) config = saved; } catch { /* sem configuração */ }
  let relay = [], expires = 0, lastError = '', refreshing = null, timer = null;

  function validate(input) {
    const provider = ['off', 'cloudflare', 'custom'].includes(input?.provider) ? input.provider : null;
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
        else { relay = []; expires = 0; }
        lastError = '';
        return true;
      } catch (e) { lastError = e.message; onEvent('warn', 'turn-falhou', 'Retransmissão TURN indisponível: ' + e.message); return false; }
    })();
    // Libera depois de atribuir (sem await no caminho, a função termina antes da atribuição).
    const current = refreshing; current.finally(() => { if (refreshing === current) refreshing = null; });
    return current;
  }
  function schedule() {
    clearInterval(timer); timer = null;
    if (config.provider === 'cloudflare') { timer = setInterval(() => refresh(), REFRESH_MS); timer.unref?.(); }
  }

  return {
    // Lista enviada a cada câmera e à mesa no início da negociação.
    servers() {
      if (config.provider === 'cloudflare' && clock() > expires - 3600 * 1000) refresh();
      return [...STUN, ...relay];
    },
    status() {
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
      fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      schedule();
      onEvent('info', 'turn-configurado', 'Retransmissão TURN: ' + ({ off: 'desligada (só STUN)', cloudflare: 'Cloudflare', custom: 'servidor próprio' })[next.provider]);
      return this.status();
    },
    async start() { await refresh(); schedule(); return this.status(); },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createTurn, normalize, STUN };
