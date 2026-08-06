#!/usr/bin/env bash
#
# backup-postgres.sh — Dump nocturno de Postgres a Cloudflare R2 (D12 del
# proposal f0-deploy).
#
# Se ESCRIBE y commitea en este batch. La INSTALACIÓN (copiar al server,
# `rclone.conf` con el token de R2, cron) es tarea de batch 2 (requiere SSH),
# ver M5 en el proposal. Pensado para correr vía cron 09:15 UTC (03:15 CDMX)
# — el server queda en UTC a propósito, así el cron no tiene sorpresas con
# el cambio de horario de verano.
#
# Uso esperado en el server (una vez instalado):
#   /opt/sellpoint/scripts/backup-postgres.sh
#
set -euo pipefail

COMPOSE_FILE="/opt/sellpoint/docker-compose.prod.yml"
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
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-sellpoint}" -Fc "${POSTGRES_DB:-sellpoint}" > "${DUMP_PATH}"

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
rclone copy "${DUMP_PATH}" "${BUCKET}" --quiet

# ---------------------------------------------------------------------------
# 4. Retención: 14 días, visible en git (no un lifecycle rule invisible en
#    un dashboard). Se borra por fecha directamente en el bucket.
# ---------------------------------------------------------------------------
log "Borrando backups con más de ${RETENTION_DAYS} días…"
rclone delete "${BUCKET}" --min-age "${RETENTION_DAYS}d" --quiet

log "Backup completo: ${DUMP_NAME}"
