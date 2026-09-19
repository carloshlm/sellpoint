#!/usr/bin/env bash
# El despliegue atómico del sitio, contra un directorio temporal.
#
# Por qué existe (F11-SITE-INFRA-01): lo que hace este script es mover UN enlace
# simbólico, y todas las formas de equivocarse son silenciosas. Un `mv` sin `-T`
# (GNU) ni `-h` (BSD) no falla: SIGUE el enlace y deja el nuevo adentro del
# directorio de la release vieja, así que el sitio se queda en la versión
# anterior y el job reporta verde. Una retención que cuenta mal no se nota hasta
# que el disco se llena. Un rollback que borra la release viva tumba el sitio
# entero. Nada de eso lo ve un smoke test de «responde 200».
#
# Por eso el test corre el script DE VERDAD contra un `mktemp -d`: no hay
# fixtures de mentira, hay tars reales y enlaces reales.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$AQUI/site-deploy-remote.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export SITE_ROOT="$TMP/sitio"
RELEASES="$SITE_ROOT/releases"
PUBLIC="$SITE_ROOT/public"

falla=0
ok()   { echo "✓ $1"; }
mal()  { echo "✗ $1" >&2; falla=1; }
comparar() { # comparar DESCRIPCIÓN ESPERADO OBTENIDO
  if [[ "$2" == "$3" ]]; then ok "$1"; else mal "$1 (esperado «$2», obtenido «$3»)"; fi
}

# paquete NOMBRE TEXTO [--sin-index] → un tar.gz con el contenido de un dist.
paquete() {
  local nombre="$1" texto="$2" sin_index="${3:-}"
  local dir="$TMP/build-$nombre"
  rm -rf "$dir"
  mkdir -p "$dir/_astro"
  echo "$texto" >"$dir/_astro/app.js"
  [[ "$sin_index" == "--sin-index" ]] || echo "<!doctype html>$texto" >"$dir/index.html"
  tar -czf "$TMP/$nombre.tgz" -C "$dir" .
  printf '%s' "$TMP/$nombre.tgz"
}

# vigente → el nombre de la release a la que apunta `public`.
vigente() { basename "$(readlink "$PUBLIC" 2>/dev/null || echo NINGUNA)"; }

# cuantas_releases → cuántos directorios hay en releases/ (sin los temporales).
cuantas_releases() { ( cd "$RELEASES" && ls -1d -- */ 2>/dev/null || true ) | wc -l | tr -d ' '; }

# ── 1. Primer despliegue ────────────────────────────────────────────────────
bash "$SCRIPT" sha1 "$(paquete sha1 uno)" >/dev/null
comparar "el primer despliegue deja public apuntando a la release" "sha1" "$(vigente)"
comparar "el sitio se lee a través del enlace" "<!doctype html>uno" "$(cat "$PUBLIC/index.html")"

# El gotcha del `mv`: si `mv` hubiera SEGUIDO el enlace, `public` seguiría
# siendo el enlace viejo y habría un `releases/sha1/public` de regalo.
if [[ -L "$PUBLIC" ]]; then ok "public es un enlace simbólico, no un directorio"; else mal "public dejó de ser un enlace"; fi
if [[ -e "$RELEASES/sha1/public" ]]; then mal "el mv siguió el enlace: apareció releases/sha1/public"; else ok "el enlace nuevo no terminó DENTRO de la release"; fi

# ── 2. Segundo despliegue: el enlace se mueve, la anterior queda ────────────
bash "$SCRIPT" sha2 "$(paquete sha2 dos)" >/dev/null
comparar "el segundo despliegue mueve el enlace" "sha2" "$(vigente)"
comparar "el contenido servido es el nuevo" "<!doctype html>dos" "$(cat "$PUBLIC/index.html")"
if [[ -d "$RELEASES/sha1" ]]; then ok "la release anterior sigue en disco (es el rollback)"; else mal "se borró la release anterior"; fi

# ── 3. Idempotencia ─────────────────────────────────────────────────────────
if bash "$SCRIPT" sha2 "$(paquete sha2 dos)" >/dev/null 2>&1; then
  ok "desplegar el mismo sha dos veces no falla"
else
  mal "desplegar el mismo sha dos veces falló"
fi
comparar "y sigue publicado el mismo" "sha2" "$(vigente)"
comparar "y se sigue leyendo bien" "<!doctype html>dos" "$(cat "$PUBLIC/index.html")"

# ── 4. Un paquete inválido no toca nada ─────────────────────────────────────
if bash "$SCRIPT" sha3 "$(paquete sha3 tres --sin-index)" >/dev/null 2>&1; then
  mal "un paquete sin index.html debería abortar"
else
  ok "un paquete sin index.html aborta"
fi
comparar "y el sitio sigue sirviendo la release buena" "sha2" "$(vigente)"
if [[ -d "$RELEASES/sha3" ]]; then mal "quedó una release a medio hacer en disco"; else ok "no quedó basura de la release fallida"; fi

# ── 5. Retención: tres releases, las tres últimas ───────────────────────────
for n in 3 4 5 6; do
  bash "$SCRIPT" "sha$n" "$(paquete "sha$n" "$n")" >/dev/null
  # `ls -t` tiene resolución de segundo en algunos sistemas de archivos: sin
  # esta pausa, cuatro despliegues en el mismo segundo quedan sin orden y el
  # test se vuelve inestable por una razón que no es la del script.
  sleep 1
done
comparar "se conservan exactamente 3 releases" "3" "$(cuantas_releases)"
comparar "la vigente es la última desplegada" "sha6" "$(vigente)"
for n in 4 5 6; do
  if [[ -d "$RELEASES/sha$n" ]]; then ok "sobrevive sha$n (una de las 3 últimas)"; else mal "se borró sha$n, que es de las 3 últimas"; fi
done
for n in 1 2 3; do
  if [[ -d "$RELEASES/sha$n" ]]; then mal "sobrevivió sha$n, que sobraba"; else ok "se borró sha$n, que sobraba"; fi
done

# ── 6. Rollback ─────────────────────────────────────────────────────────────
bash "$SCRIPT" --rollback >/dev/null
comparar "el rollback vuelve a la release anterior" "sha5" "$(vigente)"
comparar "y el contenido servido es el de esa versión" "<!doctype html>5" "$(cat "$PUBLIC/index.html")"

# ── 7. Un segundo rollback encadenado ───────────────────────────────────────
bash "$SCRIPT" --rollback >/dev/null
comparar "un segundo rollback baja otro escalón" "sha4" "$(vigente)"

# ── 8. La release VIVA nunca se borra, aunque quede fuera de la ventana ─────
#
# Escenario real: alguien movió el enlace a mano en el server (el rollback de
# emergencia de las 3 de la mañana) o bajó la retención. La release que se está
# sirviendo queda fuera de las más nuevas — y borrarla dejaría el enlace
# colgando y el sitio entero en 404. `rm -rf` no falla solo como el `rmi` de
# `deploy-remote.sh`: acá la red de seguridad hay que escribirla, así que hay
# que probarla.
VIEJO="$TMP/viejo"
export SITE_ROOT="$VIEJO"
RELEASES="$SITE_ROOT/releases"
PUBLIC="$SITE_ROOT/public"
for r in uno dos tres; do
  KEEP_RELEASES=5 bash "$SCRIPT" "$r" "$(paquete "$r" "$r")" >/dev/null
  sleep 1
done
ln -sfn "$RELEASES/uno" "$PUBLIC" # el rollback a mano del operador
comparar "el enlace quedó en la release más vieja" "uno" "$(vigente)"
KEEP_RELEASES=1 bash "$SCRIPT" uno "$(paquete uno uno)" >/dev/null
if [[ -d "$RELEASES/uno" ]]; then ok "la release VIVA sobrevive a la retención"; else mal "se borró la release VIVA: el sitio quedaría en 404"; fi
if [[ -e "$PUBLIC/index.html" ]]; then ok "y el enlace no quedó colgando"; else mal "el enlace quedó colgando"; fi
if [[ -d "$RELEASES/dos" ]]; then mal "la retención de 1 no borró lo que sobraba"; else ok "lo que sobraba sí se borró"; fi

# ── 9. Rollback sin release anterior ────────────────────────────────────────
SOLO="$TMP/solo"
rm -rf "$SOLO"
SITE_ROOT="$SOLO" bash "$SCRIPT" unica "$(paquete unica sola)" >/dev/null
if SITE_ROOT="$SOLO" bash "$SCRIPT" --rollback >/dev/null 2>&1; then
  mal "un rollback sin release anterior debería abortar"
else
  ok "un rollback sin release anterior aborta con mensaje"
fi
comparar "y deja el sitio como estaba" "unica" "$(basename "$(readlink "$SOLO/public")")"

# ── 10. Uso incorrecto ───────────────────────────────────────────────────────
if bash "$SCRIPT" >/dev/null 2>&1; then mal "sin argumentos debería mostrar el uso y salir ≠ 0"; else ok "sin argumentos sale ≠ 0"; fi
if bash "$SCRIPT" solo-sha >/dev/null 2>&1; then mal "con un solo argumento debería salir ≠ 0"; else ok "con un solo argumento sale ≠ 0"; fi

if [[ "$falla" == 0 ]]; then
  echo "site-deploy-remote.test.sh: OK"
else
  echo "site-deploy-remote.test.sh: FALLA" >&2
fi
exit "$falla"
