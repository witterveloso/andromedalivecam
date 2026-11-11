#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Instale Docker Engine e Docker Compose no VPS Linux.'; exit 1; }
docker compose version >/dev/null
if [[ ! -f .env ]]; then python3 configure.py; fi
[[ -f turnserver.conf ]] || { echo 'Falta turnserver.conf. Restaure a configuração privada.'; exit 1; }
docker compose config --quiet
docker compose up -d --build
echo 'Serviços iniciados. Verifique: docker compose ps e docker compose logs --tail=50'
echo 'Valide HTTPS e uma chamada real antes de usar ao vivo. Não publique mesa-cloud.env.'
