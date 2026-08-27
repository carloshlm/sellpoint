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
# 3. DESCIFRAR (F6-BACKUPS-02: los dumps en R2 van cifrados con age; la
#    clave privada la guarda Carlos FUERA del server):
#      age -d -i <archivo-con-la-clave-privada> < <dump>.age > <dump>
# 4. Restaurar POR STDIN, conservando owners (los roles sellpoint/sellpoint_app
#    existen en ambos clusters; sus passwords NO viajan en el dump):
#      docker exec -i <container-postgres> pg_restore -U sellpoint \
#        -d <db-destino> --clean --if-exists < /tmp/restore/<dump>
# 5. docker start <container-api> y esperar healthy.
# OJO: --clean deja el destino como ESPEJO del dump — todo lo previo se pierde.
set -euo pipefail

COMPOSE_FILE="/opt/sellpoint/docker-compose.prod.yml"
# Ruta absoluta a propósito: el binario es estático (batch 3, sin sudo en el
# server) instalado en /home/deploy/bin/rclone, y cron NO carga el PATH de
# una sesión de login — un `rclone` a secas fallaría con "command not found"
# silenciosamente en cada corrida nocturna.
RCLONE="/home/deploy/bin/rclone"
AGE="/home/deploy/bin/age"
BUCKET="r2:sellpoint-backups"
RETENTION_DAYS="14"
# F6-BACKUPS-02: la clave PÚBLICA de age (la privada vive con Carlos, fuera
# del server). Si el archivo no existe, el backup sube SIN cifrar y lo avisa
# — degradarse es mejor que no respaldar.
AGE_RECIPIENT_FILE="/opt/sellpoint/age-recipient.txt"
ENV_FILE="/opt/sellpoint/.env"
TIMESTAMP="$(date -u +%Y%m%d-%H%M)"
DUMP_NAME="sellpoint-${TIMESTAMP}.dump"
DUMP_PATH="/tmp/${DUMP_NAME}"

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

# ── F6-BACKUPS-01: si el backup muere, GRITA por correo ──────────────────
# Mismo patrón (y mismas credenciales del .env) que cert-expiry-check.sh.
# Fail-mode benigno: sin credenciales, la alerta queda solo en el log del
# cron — jamás rompe el backup por no poder avisar.
alertar() {
  local mensaje="$1"
  local api_key from to
  api_key="$(grep '^RESEND_API_KEY=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2-)"
  from="$(grep '^MAIL_FROM=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2-)"
  to="$(grep '^ALERT_EMAIL=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2-)"
  if [ -z "${api_key}" ] || [ -z "${from}" ] || [ -z "${to}" ]; then
    log "AVISO: sin credenciales de alerta en .env — el fallo queda solo en este log"
    return 0
  fi
  curl -s -o /dev/null -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"from":"SellPointy Backups <%s>","to":["%s"],"subject":"FALLO el backup nocturno de Postgres","text":%s}' \
         "${from}" "${to}" "$(printf '%s' "${mensaje}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" || true
}

PASO="arranque"
on_error() {
  log "ERROR en el paso: ${PASO}"
  alertar "El backup nocturno de Postgres FALLÓ en el paso: ${PASO}. Revisa /opt/sellpoint/logs/backup.log en el server (ssh deploy@216.238.73.144). Sin backup de hoy hasta que se corrija."
}
trap on_error ERR

cleanup() {
  rm -f "${DUMP_PATH}" "${DUMP_PATH}.age"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Dump — formato custom (-Fc): ya viene comprimido y permite restaurar
#    selectivo con pg_restore (a diferencia de un dump plano de texto).
# ---------------------------------------------------------------------------
PASO="pg_dump"
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
PASO="verificación de tamaño"
DUMP_SIZE="$(stat -c%s "${DUMP_PATH}" 2>/dev/null || stat -f%z "${DUMP_PATH}")"
if [ "${DUMP_SIZE}" -eq 0 ]; then
  log "ERROR: el dump salió con 0 bytes. Abortando sin subir a R2."
  alertar "El backup nocturno generó un dump de 0 BYTES — no se subió nada a R2. Revisa el estado de Postgres."
  exit 1
fi
log "Dump generado OK (${DUMP_SIZE} bytes)."

# ---------------------------------------------------------------------------
# 2b. Cifrado (F6-BACKUPS-02): age con la clave pública del server; nadie
#     sin la privada (que vive con Carlos) puede leer un dump robado de R2.
#     CPU una vez al día — despreciable. Sin recipient: sube sin cifrar y
#     lo avisa por correo (degradación visible, nunca silenciosa).
# ---------------------------------------------------------------------------
PASO="cifrado age"
UPLOAD_PATH="${DUMP_PATH}"
if [ -f "${AGE_RECIPIENT_FILE}" ] && [ -x "${AGE}" ]; then
  "${AGE}" -R "${AGE_RECIPIENT_FILE}" -o "${DUMP_PATH}.age" "${DUMP_PATH}"
  UPLOAD_PATH="${DUMP_PATH}.age"
  log "Dump cifrado OK ($(stat -c%s "${UPLOAD_PATH}") bytes)."
else
  log "AVISO: sin ${AGE_RECIPIENT_FILE} o sin binario age — subiendo SIN cifrar."
  alertar "AVISO: el backup de hoy se subió SIN CIFRAR (falta la clave age o el binario en el server)."
fi

# ---------------------------------------------------------------------------
# 3. Subida a R2 vía rclone (binario estático, soporte nativo S3-compatible).
# ---------------------------------------------------------------------------
PASO="subida a R2"
log "Subiendo a ${BUCKET}…"
"${RCLONE}" copy "${UPLOAD_PATH}" "${BUCKET}" --quiet

# ---------------------------------------------------------------------------
# 4. Retención: 14 días, visible en git (no un lifecycle rule invisible en
#    un dashboard). Se borra por fecha directamente en el bucket.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 3b. Respaldo cifrado de los .env (F6-SECRETS-01): si el server muere, las
#     credenciales y llaves JWT de ambos ambientes se recuperan de R2 con la
#     misma clave age de los dumps. Nombre FIJO (se sobrescribe): el .env no
#     necesita historial, necesita la última versión. Sin cifrado no viaja:
#     un .env plano en R2 sería regalar el reino.
# ---------------------------------------------------------------------------
PASO="respaldo de .env"
if [ -f "${AGE_RECIPIENT_FILE}" ] && [ -x "${AGE}" ]; then
  for ambiente in sellpoint sellpoint-sandbox; do
    if [ -f "/opt/${ambiente}/.env" ]; then
      "${AGE}" -R "${AGE_RECIPIENT_FILE}" -o "/tmp/${ambiente}.env.age" "/opt/${ambiente}/.env"
      "${RCLONE}" copyto "/tmp/${ambiente}.env.age" "${BUCKET}/env/${ambiente}.env.age" --quiet
      rm -f "/tmp/${ambiente}.env.age"
    fi
  done
  log "Respaldo de .env cifrados OK."
fi

PASO="retención"
# Los env/*.age sobreviven la retención porque se reescriben a diario (la
# fecha del objeto siempre es de hoy). Si el cron muriera >14 días, la
# alerta de arriba habría gritado mucho antes.
log "Borrando backups con más de ${RETENTION_DAYS} días…"
"${RCLONE}" delete "${BUCKET}" --min-age "${RETENTION_DAYS}d" --quiet

log "Backup completo: ${DUMP_NAME}"
