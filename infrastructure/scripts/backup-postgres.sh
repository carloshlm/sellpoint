#!/usr/bin/env bash
#
# backup-postgres.sh — Dump nocturno de Postgres a Cloudflare R2 (D12 del
# proposal f0-deploy).
#
# Instalado en /opt/sellpoint/scripts/backup-postgres.sh, corre vía cron de
# `deploy` a las 09:15 UTC (03:15 CDMX) — el server queda en UTC a propósito,
# así el cron no tiene sorpresas con el cambio de horario de verano.
# rclone.conf (token R2 scoped a `sellpoint-backups`) fue escrito por Carlos
# directo en el server (nunca por el chat, D12/M5).
#
# Uso esperado en el server (una vez instalado):
#   /opt/sellpoint/scripts/backup-postgres.sh
#
#
# ── RESTORE (probado el 2026-08-27, F6-DRILL-01 — RTO 19 s con DB de 388 KB) ──
# 1. Bajar el dump:   RCLONE_CONFIG=~/.config/rclone/rclone.conf \
#      /home/deploy/bin/rclone copy r2:sellpoint-backups/<dump> /tmp/restore/
# 2. Parar el api del ambiente destino (nadie escribe durante el restore):
#      docker stop <container-api>
# 3. Restaurar POR STDIN, conservando owners (los roles sellpoint/sellpoint_app
#    existen en ambos clusters; sus passwords NO viajan en el dump):
#      docker exec -i <container-postgres> pg_restore -U sellpoint \
#        -d <db-destino> --clean --if-exists < /tmp/restore/<dump>
# 4. docker start <container-api> y esperar healthy.
# OJO: --clean deja el destino como ESPEJO del dump — todo lo previo se pierde.
set -euo pipefail

COMPOSE_FILE="/opt/sellpoint/docker-compose.prod.yml"
# Ruta absoluta a propósito: el binario es estático (batch 3, sin sudo en el
# server) instalado en /home/deploy/bin/rclone, y cron NO carga el PATH de
# una sesión de login — un `rclone` a secas fallaría con "command not found"
# silenciosamente en cada corrida nocturna.
RCLONE="/home/deploy/bin/rclone"
BUCKET="r2:sellpoint-backups"
RETENTION_DAYS="14"
TIMESTAMP="$(date -u +%Y%m%d-%H%M)"
DUMP_NAME="sellpoint-${TIMESTAMP}.dump"
DUMP_PATH="/tmp/${DUMP_NAME}"

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

cleanup() {
  rm -f "${DUMP_PATH}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Dump — formato custom (-Fc): ya viene comprimido y permite restaurar
#    selectivo con pg_restore (a diferencia de un dump plano de texto).
# ---------------------------------------------------------------------------
log "Generando dump: ${DUMP_NAME}"
# ⚠️ POSTGRES_USER/POSTGRES_DB NO se leen del entorno de este script (que
# corre standalone por cron, sin sourcear /opt/sellpoint/.env) — se toman
# de las env vars que YA tiene el propio container `postgres` (inyectadas
# ahí por `env_file:` en el compose). Así el script no hardcodea ni
# duplica el nombre real de la DB (que en prod es `sellpoint_prod`, no
# `sellpoint`) y nunca hace falta imprimir ni exportar el password.
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "${DUMP_PATH}"

# ---------------------------------------------------------------------------
# 2. Verificación mínima: un dump de 0 bytes es peor que no tener backup
#    (da falsa sensación de seguridad). Se corta acá si pasa.
# ---------------------------------------------------------------------------
DUMP_SIZE="$(stat -c%s "${DUMP_PATH}" 2>/dev/null || stat -f%z "${DUMP_PATH}")"
if [ "${DUMP_SIZE}" -eq 0 ]; then
  log "ERROR: el dump salió con 0 bytes. Abortando sin subir a R2."
  exit 1
fi
log "Dump generado OK (${DUMP_SIZE} bytes)."

# ---------------------------------------------------------------------------
# 3. Subida a R2 vía rclone (binario estático, soporte nativo S3-compatible).
# ---------------------------------------------------------------------------
log "Subiendo a ${BUCKET}…"
"${RCLONE}" copy "${DUMP_PATH}" "${BUCKET}" --quiet

# ---------------------------------------------------------------------------
# 4. Retención: 14 días, visible en git (no un lifecycle rule invisible en
#    un dashboard). Se borra por fecha directamente en el bucket.
# ---------------------------------------------------------------------------
log "Borrando backups con más de ${RETENTION_DAYS} días…"
"${RCLONE}" delete "${BUCKET}" --min-age "${RETENTION_DAYS}d" --quiet

log "Backup completo: ${DUMP_NAME}"
