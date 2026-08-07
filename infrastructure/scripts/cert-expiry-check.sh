#!/usr/bin/env bash
# Alerta de expiración de certificados (D3 del proposal vps-multidominio).
# Corre semanal por cron en el server como `deploy`. Si algún lineage tiene
# menos de THRESHOLD_DAYS de vida, alerta por email vía la API de Resend.
#
# Fail-mode benigno: si RESEND_API_KEY o ALERT_EMAIL no están en
# /opt/sellpoint/.env, degrada a log — nunca falla por falta de config.
# Umbral overrideable por argumento para probar el camino de alerta:
#   cert-expiry-check.sh 100   # alerta con certs de <100 días
set -u
cd /opt/sellpoint

THRESHOLD_DAYS="${1:-21}"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "=== cert-expiry-check $(date -u '+%Y-%m-%d %H:%M:%S') UTC (umbral: ${THRESHOLD_DAYS} días) ==="

CERTS="$(${COMPOSE} run --rm certbot certificates 2>/dev/null)"
if [ -z "${CERTS}" ]; then
  echo "ERROR: certbot certificates no devolvió salida"
  exit 1
fi

# Líneas tipo: "Expiry Date: 2026-11-05 00:24:11+00:00 (VALID: 89 days)"
ALERTAS=""
while IFS= read -r line; do
  case "${line}" in
    *"Certificate Name:"*) CURRENT_NAME="${line##*: }" ;;
    *"INVALID"*) ALERTAS="${ALERTAS}\n- ${CURRENT_NAME:-?}: CERTIFICADO INVÁLIDO (${line#*(})" ;;
    *"VALID:"*)
      DAYS="$(printf '%s' "${line}" | sed -n 's/.*VALID: \([0-9]\+\) day.*/\1/p')"
      if [ -n "${DAYS}" ] && [ "${DAYS}" -lt "${THRESHOLD_DAYS}" ]; then
        ALERTAS="${ALERTAS}\n- ${CURRENT_NAME:-?}: quedan ${DAYS} días"
      fi
      ;;
  esac
done <<EOF
${CERTS}
EOF

if [ -z "${ALERTAS}" ]; then
  echo "OK: ningún cert por debajo de ${THRESHOLD_DAYS} días"
  exit 0
fi

MENSAJE="Certificados TLS por vencer en sellpoint-prod (216.238.73.144):$(printf '%b' "${ALERTAS}")

Renovación manual: ssh deploy@216.238.73.144 y correr /opt/sellpoint/scripts/renew-certs.sh
Log de renovaciones: /opt/sellpoint/logs/certbot-renew.log"

printf 'ALERTA:%b\n' "${ALERTAS}"

# Credenciales: solo del .env del server, nunca hardcodeadas.
RESEND_API_KEY="$(grep '^RESEND_API_KEY=' .env 2>/dev/null | cut -d= -f2-)"
ALERT_EMAIL="$(grep '^ALERT_EMAIL=' .env 2>/dev/null | cut -d= -f2-)"

if [ -z "${RESEND_API_KEY}" ] || [ -z "${ALERT_EMAIL}" ]; then
  echo "AVISO: RESEND_API_KEY o ALERT_EMAIL ausentes en .env — alerta solo por log"
  exit 0
fi

HTTP_CODE="$(curl -s -o /tmp/resend-alert-response.json -w '%{http_code}' \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer ${RESEND_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"from":"no-reply@laradoc.com","to":["%s"],"subject":"[sellpoint-prod] Certificados TLS por vencer","text":%s}' \
       "${ALERT_EMAIL}" "$(printf '%s' "${MENSAJE}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${MENSAJE}")")")"

if [ "${HTTP_CODE}" = "200" ]; then
  echo "Email de alerta enviado a ${ALERT_EMAIL}"
else
  echo "ERROR enviando email (HTTP ${HTTP_CODE}): $(head -c 300 /tmp/resend-alert-response.json 2>/dev/null)"
fi
