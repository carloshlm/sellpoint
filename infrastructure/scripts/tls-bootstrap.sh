#!/usr/bin/env bash
#
# tls-bootstrap.sh <dominio> — etapa 1 de TLS para un dominio nuevo
# (D2 del proposal vps-multidominio). Corre LOCALMENTE (Mac de Carlos o
# Claude), NO en el server: opera contra el server por SSH/SCP. No toca
# ningún vhost ya productivo — copia UN archivo nuevo a conf.d/ y emite
# UN certificado nuevo. Queda versionado para reusarlo con el 4º dominio.
#
# Precondición: infrastructure/nginx/bootstrap/<dominio>.http.conf debe
# existir en el repo (ver infrastructure/nginx/bootstrap/README.md).
#
# Uso:
#   infrastructure/scripts/tls-bootstrap.sh system.laradoc.com
#   infrastructure/scripts/tls-bootstrap.sh berrinchitosdent.com www.berrinchitosdent.com
#
# El primer argumento es el dominio "primario": nombra el archivo bootstrap
# (<primario>.http.conf) y el conf.d de destino en el server. Argumentos
# extra (U4: el www del ápice) se agregan como -d adicionales al MISMO
# certificado — sigue siendo un lineage por dominio primario (D3), el www
# es un SAN del mismo cert, no un lineage propio.
#
# Variables de entorno opcionales:
#   DEPLOY_HOST (default 216.238.73.144)
#   DEPLOY_USER (default deploy)
#
# Al terminar, el certificado existe en el server pero el vhost TLS
# definitivo TODAVÍA NO se commitea al repo — esa es la regla dura de D2:
# el vhost :443 se agrega a conf.d/ y se commitea SOLO después de que este
# script terminó OK (si no, el próximo "nginx -t" del deploy automático
# aborta por un ssl_certificate inexistente).
set -euo pipefail

DOMAIN="${1:?Uso: tls-bootstrap.sh <dominio> [dominio-extra...]}"
shift || true
CERTBOT_DOMAIN_ARGS=(-d "${DOMAIN}")
for extra in "$@"; do
  CERTBOT_DOMAIN_ARGS+=(-d "${extra}")
done
DEPLOY_HOST="${DEPLOY_HOST:-216.238.73.144}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP_FILE="${REPO_ROOT}/infrastructure/nginx/bootstrap/${DOMAIN}.http.conf"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
COMPOSE="docker compose -f docker-compose.prod.yml"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "${BOOTSTRAP_FILE}" ] || die "No existe ${BOOTSTRAP_FILE}. Crealo primero (ver infrastructure/nginx/bootstrap/README.md)."

log "1/5 — Copiando vhost http-only de ${DOMAIN} a conf.d/ en el server (archivo NUEVO, no toca otros vhosts)..."
scp "${BOOTSTRAP_FILE}" "${REMOTE}:/opt/sellpoint/nginx/conf.d/${DOMAIN}.conf"

log "2/5 — nginx -t && nginx -s reload en el server..."
ssh "${REMOTE}" "cd /opt/sellpoint && ${COMPOSE} exec -T nginx-edge nginx -t"
ssh "${REMOTE}" "cd /opt/sellpoint && ${COMPOSE} exec -T nginx-edge nginx -s reload"

log "3/5 — certbot --dry-run para ${DOMAIN} (OBLIGATORIO antes de la emisión real — límite de 5 duplicados/semana de Let's Encrypt)..."
ssh "${REMOTE}" "cd /opt/sellpoint && ${COMPOSE} run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --key-type ecdsa --register-unsafely-without-email --agree-tos -n \
  --dry-run ${CERTBOT_DOMAIN_ARGS[*]}"

log "4/5 — Emisión REAL para ${DOMAIN}..."
ssh "${REMOTE}" "cd /opt/sellpoint && ${COMPOSE} run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --key-type ecdsa --register-unsafely-without-email --agree-tos -n \
  ${CERTBOT_DOMAIN_ARGS[*]}"

log "5/5 — Listo. El certificado de ${DOMAIN} ya existe en el server."
cat <<EOF

Siguiente paso (MANUAL, fuera de este script — regla dura de D2):
  1. Crear infrastructure/nginx/conf.d/${DOMAIN}.conf (vhost TLS definitivo,
     mismo patrón que laradoc.com.conf) en el repo.
  2. scp ese archivo a ${REMOTE}:/opt/sellpoint/nginx/conf.d/${DOMAIN}.conf
     (reemplaza el http-only que copió este script).
  3. nginx -t && nginx -s reload en el server.
  4. Recién ahí: commitear el vhost TLS al repo — el cert YA existe, así que
     el próximo "nginx -t" del deploy automático no puede fallar por
     ssl_certificate inexistente.
EOF
