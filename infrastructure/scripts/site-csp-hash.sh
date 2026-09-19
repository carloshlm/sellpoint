#!/usr/bin/env bash
# El hash del guion en línea del sitio tiene que coincidir con el de la CSP.
#
# Por qué existe (F11-SITE-INFRA-02): el sitio lleva UN guion en línea, el que
# decide el tema claro/oscuro antes del primer pintado
# (`apps/site/src/layouts/Base.astro`, `<script is:inline>`). La CSP del vhost
# lo autoriza por su sha256, que es la forma correcta de permitir un guion en
# línea sin abrir `'unsafe-inline'`.
#
# El problema de un hash es que se rompe EN SILENCIO. Si alguien le cambia una
# coma al guion —o le agrega otro guion en línea—, el HTML sigue siendo válido,
# el build sigue verde y los tests de Astro siguen pasando: lo único que pasa
# es que el navegador se niega a ejecutarlo y el sitio pierde el tema guardado.
# Nadie lo ve hasta que un cliente lo reporta. Es exactamente la forma del bug
# de la CSP y Sentry (`csp-sentry.test.sh`): dos mitades que viven en archivos
# distintos y se separan sin que nada avise.
#
# Esta barrera junta las dos mitades: recalcula el hash desde el HTML CONSTRUIDO
# y lo compara con el que está escrito en los vhosts. Corre en el job `build` de
# `.github/workflows/site.yml`, antes de empaquetar el sitio.
#
# Uso:
#   site-csp-hash.sh                      # valida TODO el build contra los vhosts
#   site-csp-hash.sh --print              # solo imprime el hash, para pegarlo
#   site-csp-hash.sh HTML VHOST [VHOST…]  # un archivo suelto (lo usan los tests)
#
# Sin argumentos recorre TODAS las páginas de `apps/site/dist`, no solo la
# portada: las páginas legales usan la misma plantilla, pero nada impide que
# mañana una traiga su propio guion en línea — y ese moriría en el navegador
# sin que la portada se enterara.
#
# Solo bash y openssl: sin grep ni sed, para que corra igual en el runner y en
# una Mac. `openssl` está en los dos.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"

# El build de referencia y los vhosts que declaran el hash. Los dos vhosts del
# sitio viven en `pending/` porque el sitio todavía no se publica (ver
# `infrastructure/nginx/pending/README.md`); cuando se muevan a `conf.d/`, acá
# se cambia la ruta y nada más.
DIST_POR_OMISION="$RAIZ/apps/site/dist"
HTML_POR_OMISION="$DIST_POR_OMISION/index.html"
VHOSTS_POR_OMISION=(
  "$RAIZ/infrastructure/nginx/pending/sellpointy.com.conf"
  "$RAIZ/infrastructure/nginx/pending/sitio-sandbox.sellpointy.com.conf"
)

# guion_en_linea ARCHIVO → el CONTENIDO del único `<script>` sin atributos.
#
# Busca `<script>` literal: Astro emite así el guion en línea y emite
# `<script type="module" src="…">` para los externos, así que la etiqueta pelada
# identifica al que interesa sin ambigüedad.
#
# Sale 1 si no hay ninguno y 2 si hay más de uno. Más de uno NO es un detalle:
# el segundo no estaría autorizado por la CSP y moriría en el navegador.
guion_en_linea() {
  local contenido resto cuantos=0
  contenido="$(<"$1")"
  resto="$contenido"
  while [[ "$resto" == *"<script>"* ]]; do
    resto="${resto#*<script>}"
    cuantos=$((cuantos + 1))
  done
  [[ "$cuantos" -eq 0 ]] && return 1
  [[ "$cuantos" -gt 1 ]] && return 2
  resto="${contenido#*<script>}"
  printf '%s' "${resto%%</script>*}"
}

# html_del_dist DIRECTORIO → todos los `.html` que cuelgan de ahí.
#
# Recursión a mano en vez de `find` o de `shopt -s globstar`: `find` está
# prohibido por convención del repo y `globstar` no existe en el bash 3.2 que
# trae macOS. Un `for` sobre `*` y una llamada recursiva funcionan en los dos.
html_del_dist() {
  local entrada
  for entrada in "$1"/*; do
    [[ -e "$entrada" ]] || continue
    if [[ -d "$entrada" ]]; then
      html_del_dist "$entrada"
    elif [[ "${entrada%.html}" != "$entrada" ]]; then
      printf '%s\n' "$entrada"
    fi
  done
}

# hash_csp TEXTO → `sha256-…` en base64, tal como se escribe en la CSP.
#
# `printf '%s'` y no `echo`: el hash es sobre los bytes EXACTOS del guion, y un
# salto de línea de más lo cambia entero.
hash_csp() {
  printf '%s' "$1" | openssl dgst -sha256 -binary | openssl base64 -A |
    { read -r b64; printf 'sha256-%s' "$b64"; }
}

# hashes_de_script_src ARCHIVO → los `sha256-…` que su `script-src` autoriza,
# uno por línea. Falla si el archivo no declara `script-src`.
hashes_de_script_src() {
  local linea resto encontrado=0 re="'(sha256-[A-Za-z0-9+/=]+)'"
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" == *script-src* ]] || continue
    encontrado=1
    resto="$linea"
    while [[ "$resto" =~ $re ]]; do
      printf '%s\n' "${BASH_REMATCH[1]}"
      resto="${resto#*"${BASH_REMATCH[0]}"}"
    done
  done <"$1"
  return $((1 - encontrado))
}

# ── Programa ────────────────────────────────────────────────────────────────
SOLO_IMPRIMIR=0
if [[ "${1:-}" == "--print" ]]; then
  SOLO_IMPRIMIR=1
  shift
fi

HTML="${1:-$HTML_POR_OMISION}"
if [[ $# -gt 1 ]]; then
  shift
  VHOSTS=("$@")
else
  VHOSTS=("${VHOSTS_POR_OMISION[@]}")
fi

if [[ ! -f "$HTML" ]]; then
  echo "✗ no existe $HTML — construí el sitio primero: pnpm --filter site... build" >&2
  exit 1
fi

# hash_de_pagina ARCHIVO → su `sha256-…`, o explica por qué no se puede.
hash_de_pagina() {
  local archivo="$1" guion estado=0
  guion="$(guion_en_linea "$archivo")" || estado=$?
  case "$estado" in
    1)
      echo "✗ $archivo no tiene ningún <script> en línea." >&2
      echo "  Si el guion del tema se quitó a propósito, hay que sacar el hash de la CSP" >&2
      echo "  de los vhosts (dejarlo de más no rompe nada, pero miente sobre qué se permite)." >&2
      return 1
      ;;
    2)
      echo "✗ $archivo tiene MÁS DE UN <script> en línea." >&2
      echo "  La CSP autoriza uno solo por su hash: el nuevo moriría en el navegador." >&2
      echo "  O se le calcula su hash y se agrega a script-src en los dos vhosts, o se" >&2
      echo "  convierte en un archivo aparte (que 'self' ya permite)." >&2
      return 1
      ;;
  esac
  hash_csp "$guion"
}

HASH="$(hash_de_pagina "$HTML")" || exit 1

if [[ "$SOLO_IMPRIMIR" == 1 ]]; then
  printf "%s\n" "$HASH"
  exit 0
fi

falla=0

# En el modo por omisión (sin rutas explícitas) se revisa el build ENTERO: cada
# página tiene que traer el MISMO guion en línea y ninguno más. Una página con
# un guion distinto es una página a la que la CSP le apaga el tema.
if [[ "$HTML" == "$HTML_POR_OMISION" && -d "$DIST_POR_OMISION" ]]; then
  paginas=0
  while IFS= read -r pagina; do
    paginas=$((paginas + 1))
    [[ "$pagina" == "$HTML" ]] && continue
    if ! suyo="$(hash_de_pagina "$pagina")"; then
      falla=1
      continue
    fi
    if [[ "$suyo" != "$HASH" ]]; then
      echo "✗ ${pagina#"$DIST_POR_OMISION"/} tiene un guion en línea DISTINTO al de la portada ($suyo)." >&2
      falla=1
    fi
  done < <(html_del_dist "$DIST_POR_OMISION")
  echo "· revisadas ${paginas} páginas de apps/site/dist"
fi

for vhost in "${VHOSTS[@]}"; do
  nombre="$(basename "$vhost")"
  if [[ ! -f "$vhost" ]]; then
    echo "✗ no existe el vhost $vhost" >&2
    falla=1
    continue
  fi
  if ! declarados="$(hashes_de_script_src "$vhost")"; then
    echo "✗ $nombre: su CSP no declara script-src" >&2
    falla=1
    continue
  fi
  if [[ $'\n'"$declarados"$'\n' == *$'\n'"$HASH"$'\n'* ]]; then
    echo "✓ $nombre autoriza el guion del tema ($HASH)"
  else
    echo "✗ $nombre: su script-src NO autoriza el guion en línea del sitio." >&2
    echo "  Esperado: '$HASH'" >&2
    echo "  Declarado: ${declarados:-（ningún hash）}" >&2
    falla=1
  fi
done

if [[ "$falla" != 0 ]]; then
  echo "" >&2
  echo "Cómo se arregla: pegá el hash esperado en el script-src de los vhosts de" >&2
  echo "infrastructure/nginx/pending/. Para obtenerlo suelto:" >&2
  echo "  pnpm --filter site... build && infrastructure/scripts/site-csp-hash.sh --print" >&2
fi

exit "$falla"
