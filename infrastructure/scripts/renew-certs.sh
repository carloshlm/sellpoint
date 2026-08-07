#!/usr/bin/env bash
# Renovación de certificados de TODOS los lineages (D3 del proposal
# vps-multidominio). Corre por cron en el server como `deploy`.
#
# Dos decisiones deliberadas frente al cron viejo de f0:
#   - SIN --quiet: un fallo de renovación tiene que dejar rastro en el log
#     (W7 del verify de f0: el fallo silencioso deja vencer el cert a los
#     90 días sin que nadie vea nada).
#   - El reload NO va acoplado con && al renew: si UN lineage falla, certbot
#     sale != 0 pero los lineages que SÍ renovaron necesitan el reload igual.
#     El reload es barato e idempotente — se hace SIEMPRE.
set -u
cd /opt/sellpoint

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "=== renew-certs $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
${COMPOSE} run --rm certbot renew --webroot -w /var/www/certbot
RC=$?

${COMPOSE} exec -T nginx-edge nginx -s reload
echo "=== fin renew (certbot rc=${RC}) ==="
exit "${RC}"
