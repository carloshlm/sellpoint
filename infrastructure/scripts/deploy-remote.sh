#!/usr/bin/env bash
# Script remoto de deploy (U6 del proposal vps-multidominio, C1/C2 del
# verify). Corre EN el server, invocado por deploy.yml como ARCHIVO:
#   bash /opt/sellpoint/scripts/deploy-remote.sh "<sha>"
#
# Historia: este script vivía como heredoc dentro de deploy.yml y se
# ejecutaba por `ssh bash -s`. `docker compose exec -T` deja stdin
# conectado (-T solo desactiva el TTY), así que el primer exec DRENABA el
# resto del heredoc: bash llegaba a EOF y salía con 0 — el reload y el
# smoke test NUNCA corrieron mientras el job reportaba verde (verify
# vps-multidominio, CRITICAL C1/C2, 2026-08-07). Como archivo, esa clase
# de bug no existe. Los `< /dev/null` se conservan como cinturón además
# de los tiradores del `ssh -n` del workflow.
set -euo pipefail
NEW_TAG="$1"
cd /opt/sellpoint

PREV_TAG="$(grep '^IMAGE_TAG=' .env | cut -d= -f2)"
echo "Tag previo: ${PREV_TAG} -> Tag nuevo: ${NEW_TAG}"

write_image_tag() {
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
}

# Rollback centralizado: revierte el tag, re-levanta y re-verifica. Se usa
# en TODO fallo posterior a write_image_tag — incluido `up -d` (incidente
# f1-auth U1, 2026-08-07: la api nueva falló su healthcheck, `set -e` mató
# el script ANTES del smoke y el rollback de D10 nunca corrió; la api quedó
# en restart loop hasta un rollback manual. `up -d` a pelo bajo `set -e`
# es un modo de fallo sin red).
rollback_and_exit() {
  echo "Rollback a ${PREV_TAG}."
  write_image_tag "${PREV_TAG}"
  docker compose -f docker-compose.prod.yml up -d || true
  for i in $(seq 1 10); do
    if curl -fsS --resolve system.laradoc.com:443:127.0.0.1 https://system.laradoc.com/api/health > /dev/null; then
      echo "Rollback verificado: /api/health responde con el tag previo."
      break
    fi
    sleep 5
  done
  exit 1
}

write_image_tag "${NEW_TAG}"

echo "Corriendo migraciones (one-shot, antes de tocar la app viva)..."
if ! docker compose -f docker-compose.prod.yml run --rm migrate < /dev/null; then
  echo "Migración FALLÓ. Revirtiendo IMAGE_TAG a ${PREV_TAG} sin desplegar."
  write_image_tag "${PREV_TAG}"
  exit 1
fi

echo "Pull + up -d..."
# `pull` ignora los servicios con build: (php-fpm) — su imagen se buildea
# acá. Con cache es un no-op de ~1s cuando el Dockerfile no cambió.
if ! docker compose -f docker-compose.prod.yml build php-fpm; then
  echo "Build de php-fpm FALLÓ. Revirtiendo IMAGE_TAG sin desplegar."
  write_image_tag "${PREV_TAG}"
  exit 1
fi
# --ignore-buildable: sin esto, pull intenta bajar del registry la imagen
# local de php-fpm (sellpoint-php-fpm:local, que no existe en ningún
# registry) y aborta el deploy entero.
if ! docker compose -f docker-compose.prod.yml pull --ignore-buildable; then
  echo "Pull FALLÓ. Revirtiendo IMAGE_TAG sin desplegar."
  write_image_tag "${PREV_TAG}"
  exit 1
fi
# up -d espera los healthchecks de depends_on: si un container nuevo no
# llega a healthy, sale != 0 — y ESO debe disparar rollback, no matar el
# script (ver rollback_and_exit arriba).
if ! docker compose -f docker-compose.prod.yml up -d; then
  echo "up -d FALLÓ (¿healthcheck de un container nuevo?)."
  rollback_and_exit
fi

# Regla dura (D2): config de nginx SIEMPRE `nginx -t` antes de reload,
# NUNCA --force-recreate. `up -d` NO reinicia nginx-edge si solo cambió
# el contenido de conf.d/ (bind-mount): sin este reload explícito la
# config nueva queda en disco pero jamás en memoria.
echo "Validando config de nginx (nginx -t)..."
if ! docker compose -f docker-compose.prod.yml exec -T nginx-edge nginx -t < /dev/null; then
  echo "nginx -t FALLÓ. Abortando deploy SIN recargar (la config vieja sigue sirviendo)."
  exit 1
fi

# Mismo problema que nginx pero en php-fpm: sus configs (conf.d/pool.d)
# entran por bind-mount, así que `up -d` NO recrea el container cuando solo
# cambia su contenido — el proceso seguiría con la config vieja. USR2 es el
# reload graceful de php-fpm (termina workers al vaciarse, relee TODO:
# php.ini, extensiones, pools). Idempotente y barato — se hace SIEMPRE.
echo "Recargando php-fpm (USR2 graceful)..."
docker compose -f docker-compose.prod.yml exec -T php-fpm kill -USR2 1 < /dev/null || \
  echo "AVISO: reload de php-fpm falló (¿container caído?) — up -d de arriba ya lo habría levantado"

echo "nginx -t OK. Recargando (nginx -s reload)..."
T0="$(date -u '+%Y-%m-%dT%H:%M:%S')"
docker compose -f docker-compose.prod.yml exec -T nginx-edge nginx -s reload < /dev/null

# Gate de EVIDENCIA del reload (C1 del verify): exit 0 del comando solo
# prueba que la señal se emitió. La prueba de que el master la procesó es
# el "reconfiguring" en su log. OJO: `nginx -T` NO sirve acá — relee el
# DISCO, no la memoria del worker (daría siempre falso OK).
# Se captura a variable y se grepea DESPUÉS: `... | grep -q` bajo pipefail
# es una carrera — grep -q sale al primer match, docker logs muere con
# SIGPIPE (141) y el gate falla justo cuando SÍ hay evidencia (falso
# negativo real del run 31142186631, 2026-08-07).
sleep 2
RELOAD_LOG="$(docker logs --since "${T0}" sellpoint-nginx-edge 2>&1 || true)"
if [[ "${RELOAD_LOG}" != *"reconfiguring"* ]]; then
  echo "Reload SIN EVIDENCIA en el log de nginx (no apareció 'reconfiguring'). Abortando."
  exit 1
fi
echo "Reload confirmado por log del master (reconfiguring)."

# --resolve contra el origen, no a través de Cloudflare (S5 de f0): se
# ejercita el vhost real, el TLS real y el strip de /api real sin que una
# caída de CF dispare un rollback espurio.
echo "Smoke test /api/health en system.laradoc.com, contra el origen (hasta 30 intentos x 5s)..."
SMOKE_OK=0
for i in $(seq 1 30); do
  if curl -fsS --resolve system.laradoc.com:443:127.0.0.1 https://system.laradoc.com/api/health > /dev/null; then
    SMOKE_OK=1
    break
  fi
  sleep 5
done

if [ "${SMOKE_OK}" -eq 1 ]; then
  echo "Smoke OK. Limpiando imagenes viejas."
  docker image prune -f
else
  echo "Smoke FALLÓ."
  rollback_and_exit
fi
