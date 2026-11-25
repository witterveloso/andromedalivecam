#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Instale Docker Engine e Docker Compose no VPS Linux.'; exit 1; }
docker compose version >/dev/null
if [[ ! -f .env ]]; then python3 configure.py; fi
docker compose config --quiet
docker compose up -d --build
echo 'Serviços iniciados. Verifique: docker compose ps e docker compose logs --tail=50'
echo 'Abra no firewall do servidor: 80 e 443 (TCP), 3478 (UDP e TCP) e as portas UDP altas da retransmissão (1024-65535).'
echo 'Saúde: curl -s http://127.0.0.1:8090/health · Valide uma chamada real antes de usar ao vivo. Não publique mesa-cloud.env.'
