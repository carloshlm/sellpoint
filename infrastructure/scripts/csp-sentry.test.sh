#!/usr/bin/env bash
# La CSP de nginx tiene que dejar pasar al Sentry del front.
#
# Por qué existe (2026-09-14): Sentry del web, la CSP `connect-src 'self'` y
# la variable `VITE_SENTRY_DSN` entraron el MISMO día (2026-08-27), y la CSP
# se validó «por grep»: la SPA no cargaba nada externo. Pero la dirección de
# Sentry no vive en el código, vive en una variable de build de GitHub, así
# que ningún grep del repo la podía encontrar. Resultado: durante 18 días el
# navegador bloqueó cada reporte y producción no mandó un solo error del
# front, en silencio. Carlos lo vio en la consola.
#
# Este test junta las dos mitades que viven separadas: el host del DSN y el
# connect-src de los vhosts de la SPA. Si alguien cambia el proyecto de Sentry
# o endurece la CSP, se pone rojo acá y no en la consola de un cliente.
#
# Solo bash: sin grep ni sed, para que corra igual en el runner y en una Mac.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Los vhosts que sirven la SPA. Lista EXPLÍCITA: la CSP de otro sitio del
# mismo server no es parte de este contrato.
VHOSTS=(
  "$RAIZ/infrastructure/nginx/conf.d/app.sellpointy.com.conf"
  "$RAIZ/infrastructure/nginx/conf.d/sandbox.sellpointy.com.conf"
)

# host_de_dsn DSN → el host, sin esquema, sin llave pública y sin proyecto.
host_de_dsn() {
  local resto="${1#*://}"
  resto="${resto#*@}"
  printf '%s' "${resto%%/*}"
}

# connect_src ARCHIVO → la directiva connect-src de su CSP. Falla sin CSP.
connect_src() {
  local linea re='connect-src([^;"]*)'
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    if [[ "$linea" == *Content-Security-Policy* ]] && [[ "$linea" =~ $re ]]; then
      printf '%s' "${BASH_REMATCH[1]}"
      return 0
    fi
  done <"$1"
  return 1
}

# verificar DSN ARCHIVO... → 0 si TODAS las CSP dejan pasar al host EXACTO.
# Un host parecido no cuenta: `o2.ingest…` no deja pasar a `o1.ingest…`.
verificar() {
  local dsn="$1"
  shift
  local host archivo directiva fallo=0
  host="$(host_de_dsn "$dsn")"
  for archivo in "$@"; do
    if ! directiva="$(connect_src "$archivo")"; then
      echo "✗ $(basename "$archivo"): no tiene Content-Security-Policy con connect-src" >&2
      fallo=1
      continue
    fi
    if [[ " $directiva " != *" https://$host "* ]]; then
      echo "✗ $(basename "$archivo"): connect-src no deja pasar a https://$host" >&2
      fallo=1
    fi
  done
  return "$fallo"
}

falla=0
esperar() { # esperar DESCRIPCIÓN ESPERADO(0|1) COMANDO...
  local descripcion="$1" esperado="$2"
  shift 2
  local obtenido=0
  "$@" 2>/dev/null || obtenido=1
  if [[ "$obtenido" == "$esperado" ]]; then
    echo "✓ $descripcion"
  else
    echo "✗ $descripcion (esperado $esperado, obtenido $obtenido)" >&2
    falla=1
  fi
}

# ── La lógica, con fixtures ─────────────────────────────────────────────────
DSN_FALSO="https://abc123@o111.ingest.us.sentry.io/222"
if [[ "$(host_de_dsn "$DSN_FALSO")" == "o111.ingest.us.sentry.io" ]]; then
  echo "✓ el host sale del DSN sin llave ni proyecto"
else
  echo "✗ host_de_dsn devolvió «$(host_de_dsn "$DSN_FALSO")»" >&2
  falla=1
fi

CON="$TMP/con.conf"
echo "    add_header Content-Security-Policy \"default-src 'self'; connect-src 'self' blob: https://o111.ingest.us.sentry.io; object-src 'none'\" always;" >"$CON"
SIN="$TMP/sin.conf"
echo "    add_header Content-Security-Policy \"default-src 'self'; connect-src 'self' blob:; object-src 'none'\" always;" >"$SIN"
OTRA="$TMP/otra.conf"
echo "    add_header Content-Security-Policy \"default-src 'self'; connect-src 'self' https://o999.ingest.us.sentry.io; object-src 'none'\" always;" >"$OTRA"
SUFIJO="$TMP/sufijo.conf"
echo "    add_header Content-Security-Policy \"connect-src 'self' https://o111.ingest.us.sentry.io.evil.com;\" always;" >"$SUFIJO"
VACIO="$TMP/vacio.conf"
echo "    server_name ejemplo.com;" >"$VACIO"

esperar "una CSP con el host exacto pasa" 0 verificar "$DSN_FALSO" "$CON"
esperar "una CSP sin el host falla (el bug del 2026-08-27)" 1 verificar "$DSN_FALSO" "$SIN"
esperar "otra organización de Sentry no cuenta" 1 verificar "$DSN_FALSO" "$OTRA"
esperar "un host que solo EMPIEZA igual no cuenta" 1 verificar "$DSN_FALSO" "$SUFIJO"
esperar "un vhost sin CSP falla: la SPA siempre la lleva" 1 verificar "$DSN_FALSO" "$VACIO"
esperar "basta UN vhost sin el host para fallar" 1 verificar "$DSN_FALSO" "$CON" "$SIN"

# ── El repo real contra el DSN real ─────────────────────────────────────────
DSN="${VITE_SENTRY_DSN:-}"
if [[ -z "$DSN" ]]; then
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    # En el CI la variable TIENE que llegar: saltar acá sería apagar la
    # barrera sin que nadie se entere, que es justo lo que pasó con la CSP.
    echo "✗ VITE_SENTRY_DSN vacío en el CI: la barrera no puede comparar nada" >&2
    falla=1
  else
    echo "· VITE_SENTRY_DSN no está en el entorno local: se omite el cruce con los vhosts reales"
  fi
else
  esperar "los vhosts de la SPA dejan pasar al Sentry configurado" 0 verificar "$DSN" "${VHOSTS[@]}"
  if [[ "$falla" == 1 ]]; then
    verificar "$DSN" "${VHOSTS[@]}" || true
  fi
fi

exit "$falla"
