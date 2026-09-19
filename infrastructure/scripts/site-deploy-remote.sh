#!/usr/bin/env bash
# Publicación del SITIO estático, con cambio de versión ATÓMICO
# (F11-SITE-INFRA-01). Corre EN el server, invocado por `site.yml` como
# ARCHIVO —nunca por stdin/heredoc, misma regla dura que `deploy-remote.sh`:
# un heredoc por `ssh bash -s` se lo puede tragar cualquier comando que deje
# stdin conectado, y el script termina en silencio con exit 0.
#
#   bash /opt/sellpoint/scripts/site-deploy-remote.sh <sha> <ruta-del-tar>
#   bash /opt/sellpoint/scripts/site-deploy-remote.sh --rollback
#
# ── Por qué un enlace simbólico y no un `rsync` sobre el directorio vivo ──
#
# Un sitio construido no es un archivo: son ~40, y varios se referencian entre
# sí por nombre con huella (`/_astro/Home.BSNZavDl.css`). Copiar encima del
# directorio que nginx está sirviendo abre una ventana de segundos en la que el
# HTML nuevo pide un CSS que todavía no llegó, o el HTML viejo pide uno que ya
# se borró: la visita ve el sitio sin estilos y no hay forma de que se entere
# nadie. Con releases + un enlace que se mueve de un `rename(2)`, el cambio de
# versión es instantáneo y no existe un instante intermedio.
#
# El mismo enlace es lo que hace barato el rollback: volver atrás es moverlo.
#
# ── Dónde viven las cosas ────────────────────────────────────────────────
#
#   /opt/sites/sellpointy.com/releases/<sha>/   ← una por despliegue
#   /opt/sites/sellpointy.com/public            → enlace a la vigente
#
# nginx NO ve esa ruta: el compose monta `/opt/sites` en `/var/www/sites`
# dentro de `nginx-edge` (`docker-compose.prod.yml`), y por eso el `root` del
# vhost dice `/var/www/sites/…`. El mount es `:ro`: acá se escribe desde el
# host, nginx solo lee.
#
# `SITE_ROOT` se parametriza para que `site-deploy-remote.test.sh` corra contra
# un directorio temporal sin tocar nada real.
set -euo pipefail

: "${SITE_ROOT:=/opt/sites/sellpointy.com}"
# Tres releases: la vigente, la anterior (a la que apunta `--rollback`) y una
# de colchón. Más no sirve para nada —a una versión de hace una semana no se
# vuelve, se publica una nueva— y cada una pesa lo que pesa el sitio.
: "${KEEP_RELEASES:=3}"

[ -n "${SITE_ROOT}" ] || { echo "ABORTA: SITE_ROOT vacío." >&2; exit 1; }
RELEASES="${SITE_ROOT}/releases"
PUBLIC="${SITE_ROOT}/public"

uso() {
  echo "Uso: site-deploy-remote.sh <sha> <ruta-del-tar>" >&2
  echo "     site-deploy-remote.sh --rollback" >&2
  exit 1
}

# releases_recientes → los nombres de las releases, de la ÚLTIMA DESPLEGADA a
# la más vieja, una por línea.
#
# El orden sale del mtime del directorio, que cada despliegue actualiza con un
# `touch`: así el orden es «cuándo se publicó por última vez» y no «cuándo se
# desempaquetó». Importa para el rollback — volver a desplegar un sha viejo lo
# convierte en el más nuevo, que es lo correcto.
#
# `ls -t` ordena por mtime descendente y existe igual en GNU (el server) y en
# BSD (la Mac donde corren los tests). El glob `*/` deja fuera los temporales,
# que empiezan con punto.
releases_recientes() {
  ( cd "${RELEASES}" && ls -1dt -- */ 2>/dev/null || true ) |
    while IFS= read -r d; do
      [ -n "${d}" ] || continue
      printf '%s\n' "${d%/}"
    done
}

# apuntar_public DESTINO → deja `public` apuntando a DESTINO, atómicamente.
#
# Se crea un enlace con nombre temporal y se le hace `rename(2)` encima del
# viejo: para quien esté sirviendo una petición, el enlace apunta a la versión
# vieja o a la nueva, nunca a nada. Un `ln -sfn` a secas NO sirve: primero
# borra y después crea, así que hay un instante sin enlace.
#
# ⚠️ `mv -T` (GNU) / `mv -h` (BSD) no es opcional. Sin una de las dos, `mv`
# SIGUE el enlace viejo y deja el nuevo DENTRO del directorio de la release
# (`releases/<sha viejo>/public`): el sitio se queda servido por la versión
# anterior y el error no se nota hasta el despliegue siguiente.
#
# El enlace se escribe RELATIVO a SITE_ROOT (`releases/<sha>`), nunca absoluto:
# `nginx-edge` monta `/opt/sites` como `/var/www/sites`, así que una ruta
# absoluta del host no existe dentro del contenedor y el sitio entero daría 404
# con los archivos perfectamente publicados. Relativo se resuelve desde donde
# esté montada la carpeta.
apuntar_public() {
  local destino="$1" tmp="${SITE_ROOT}/.public.nuevo.$$"
  rm -f "${tmp}"
  ln -s "${destino#"${SITE_ROOT}"/}" "${tmp}"
  if mv -T "${tmp}" "${PUBLIC}" 2>/dev/null; then return 0; fi
  if mv -h "${tmp}" "${PUBLIC}" 2>/dev/null; then return 0; fi
  rm -f "${tmp}"
  echo "ABORTA: este 'mv' no acepta ni -T (GNU) ni -h (BSD), así que no hay forma" >&2
  echo "        de reemplazar el enlace sin seguirlo. Nada fue modificado." >&2
  return 1
}

# enlace_vivo → la release a la que apunta `public`, como ruta ABSOLUTA (el
# enlace es relativo; ver `apuntar_public`). Vacío si no hay enlace.
enlace_vivo() {
  local destino
  destino="$(readlink "${PUBLIC}" 2>/dev/null || true)"
  [ -n "${destino}" ] || return 0
  case "${destino}" in
    /*) printf '%s' "${destino}" ;;
    *) printf '%s' "${SITE_ROOT}/${destino}" ;;
  esac
}

# limpiar_releases → conserva las KEEP_RELEASES más nuevas y borra el resto.
#
# La que se está sirviendo NUNCA se borra, aunque haya quedado fuera de esa
# ventana: pasa justo después de un rollback, y borrarla dejaría el enlace
# colgando y el sitio en 404 completo. Es la misma red de seguridad que en
# `deploy-remote.sh`, donde una imagen en uso sobrevive porque el `rmi` falla;
# acá `rm -rf` no falla solo, hay que decirlo.
limpiar_releases() {
  local viva n=0 r
  viva="$(enlace_vivo)"
  while IFS= read -r r; do
    n=$((n + 1))
    [ "${n}" -le "${KEEP_RELEASES}" ] && continue
    if [ "${RELEASES}/${r}" = "${viva}" ]; then
      echo "· se conserva ${r}: es la release VIVA (quedó fuera de las ${KEEP_RELEASES} más nuevas, seguramente por un rollback)."
      continue
    fi
    rm -rf "${RELEASES:?}/${r}"
    echo "· borrada la release ${r}"
  done < <(releases_recientes)
}

rollback() {
  local actual objetivo="" visto=0 r
  actual="$(enlace_vivo)"
  if [ -z "${actual}" ]; then
    echo "ABORTA: ${PUBLIC} no es un enlace simbólico — no hay a qué volver." >&2
    exit 1
  fi
  while IFS= read -r r; do
    if [ "${visto}" = 1 ]; then objetivo="${r}"; break; fi
    [ "${RELEASES}/${r}" = "${actual}" ] && visto=1
  done < <(releases_recientes)

  if [ "${visto}" != 1 ]; then
    echo "ABORTA: el enlace apunta a ${actual}, que no es ninguna de las releases." >&2
    exit 1
  fi
  if [ -z "${objetivo}" ]; then
    echo "ABORTA: ${actual##*/} es la release más vieja que queda: no hay una anterior." >&2
    echo "        La salida es publicar una versión nueva, no volver más atrás." >&2
    exit 1
  fi

  apuntar_public "${RELEASES}/${objetivo}"
  echo "Rollback listo: public → ${objetivo} (antes ${actual##*/})."
}

desplegar() {
  local sha="$1" paquete="$2"
  [ -f "${paquete}" ] || { echo "ABORTA: no existe el paquete ${paquete}. Nada fue modificado." >&2; exit 1; }

  mkdir -p "${RELEASES}"
  local destino="${RELEASES}/${sha}"
  local staging="${RELEASES}/.tmp-${sha}-$$"

  # Se desempaqueta en un temporal y se VERIFICA antes de tocar nada vivo: un
  # tar truncado o armado desde el directorio equivocado no puede llegar a
  # mover el enlace. El contrato del paquete es «el contenido de dist en la
  # raíz del tar» (`tar -czf sitio.tgz -C apps/site/dist .`), y la prueba de
  # que se cumplió es que exista `index.html` arriba de todo.
  rm -rf "${staging}"
  mkdir -p "${staging}"
  if ! tar -xzf "${paquete}" -C "${staging}"; then
    rm -rf "${staging}"
    echo "ABORTA: no se pudo desempaquetar ${paquete}. Nada fue modificado." >&2
    exit 1
  fi
  if [ ! -f "${staging}/index.html" ]; then
    rm -rf "${staging}"
    echo "ABORTA: el paquete no trae index.html en su raíz." >&2
    echo "        Se arma con: tar -czf sitio.tgz -C apps/site/dist ." >&2
    echo "        Nada fue modificado: el sitio sigue sirviendo la release anterior." >&2
    exit 1
  fi

  if [ -d "${destino}" ]; then
    if [ "$(enlace_vivo)" = "${destino}" ]; then
      # IDEMPOTENCIA: la release ya existe Y es la que se está sirviendo.
      # Borrarla para reemplazarla dejaría el enlace colgando, aunque fuera un
      # instante. Y no hace falta: el mismo sha es el mismo commit, o sea el
      # mismo build. Se descarta lo desempaquetado y se sigue — el enlace se
      # vuelve a apuntar igual y la retención corre lo mismo.
      echo "La release ${sha} ya está publicada: no hay nada que mover."
      rm -rf "${staging}"
    else
      # Existe pero no la sirve nadie (un despliegue que falló después, o un
      # sha al que se le hizo rollback y ahora vuelve). Se puede reemplazar sin
      # ventana porque nadie la está leyendo.
      echo "La release ${sha} existía sin estar publicada: se reemplaza."
      rm -rf "${destino}"
      mv "${staging}" "${destino}"
    fi
  else
    mv "${staging}" "${destino}"
  fi

  # El mtime es «cuándo se publicó por última vez» — de ahí sale el orden del
  # rollback y de la retención. Ver `releases_recientes`.
  touch "${destino}"

  apuntar_public "${destino}"
  echo "Publicado: public → ${sha}."

  limpiar_releases
  echo "Listo. El sitio sirve ${sha} desde ${PUBLIC}."
}

case "${1:-}" in
  --rollback) rollback ;;
  ""|-h|--help) uso ;;
  *)
    [ $# -eq 2 ] || uso
    desplegar "$1" "$2"
    ;;
esac
