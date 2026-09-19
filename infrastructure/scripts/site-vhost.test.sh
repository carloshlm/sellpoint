#!/usr/bin/env bash
# Los vhosts del sitio, revisados sin nginx instalado.
#
# Por qué existe (F11-SITE-INFRA-02): un vhost es un archivo que nadie ejecuta
# en el CI. `nginx -t` solo dice que la SINTAXIS es válida — un `location /api/`
# que reenvía todo al API en vez de solo `/api/public/` pasa `nginx -t` sin
# pestañear, y una CSP borrada por un `add_header` mal puesto también. Lo que
# esta barrera cuida son las DECISIONES, no la sintaxis:
#
#   · el apex no es una puerta al API (solo `/api/public/` viaja);
#   · la CSP existe, es estricta y no se aflojó en `script-src`;
#   · el `root` apunta a la ruta de DENTRO del contenedor;
#   · las direcciones que los clientes tienen guardadas siguen llegando a la app;
#   · y, sobre todo, que nada de esto esté en `conf.d/` mientras el sitio no se
#     pueda publicar: `conf.d/` viaja a producción en cada push a main.
#
# El hash del guion en línea lo valida `site-csp-hash.sh`, que necesita el build.
#
# Solo bash: sin grep ni sed, para que corra igual en el runner y en una Mac.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
PENDING="$RAIZ/infrastructure/nginx/pending"
CONFD="$RAIZ/infrastructure/nginx/conf.d"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

APEX="$PENDING/sellpointy.com.conf"
SANDBOX="$PENDING/sitio-sandbox.sellpointy.com.conf"

# sin_comentario LÍNEA → la línea sin lo que venga después de `#`.
# Hace falta para contar llaves: un `{` dentro de un comentario descuadraría
# el recorrido de bloques.
sin_comentario() {
  local l="$1"
  printf '%s' "${l%%#*}"
}

# bloque_location ARCHIVO PATRÓN → el texto del `location` cuyo encabezado
# contiene PATRÓN, desde su `{` hasta la `}` que lo cierra. Vacío si no existe.
bloque_location() {
  local archivo="$1" patron="$2" linea limpia dentro=0 nivel=0 salida="" c
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    limpia="$(sin_comentario "$linea")"
    if [[ "$dentro" == 0 ]]; then
      [[ "$limpia" == *location* && "$limpia" == *"$patron"* ]] || continue
      dentro=1
    fi
    salida+="$linea"$'\n'
    while IFS= read -r -n1 c; do
      [[ "$c" == "{" ]] && nivel=$((nivel + 1))
      [[ "$c" == "}" ]] && nivel=$((nivel - 1))
    done < <(printf '%s' "$limpia")
    if [[ "$dentro" == 1 && "$nivel" -le 0 ]]; then
      printf '%s' "$salida"
      return 0
    fi
  done <"$archivo"
  return 1
}

# texto ARCHIVO → el archivo entero en una cadena.
texto() { printf '%s' "$(<"$1")"; }

# linea_csp ARCHIVO → la línea que DEFINE la CSP, sin comentarios.
#
# Mirar el archivo entero no sirve: estos vhosts explican su CSP en prosa
# arriba, así que `script-src` y `'unsafe-inline'` aparecen en los comentarios y
# cualquier comprobación por subcadena pasaría sin que exista la directiva.
linea_csp() {
  local linea limpia
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    limpia="${linea%%#*}"
    if [[ "$limpia" == *default-src* ]]; then
      printf '%s' "$limpia"
      return 0
    fi
  done <"$1"
  return 1
}

# directiva CSP NOMBRE → el valor de esa directiva, hasta el `;` siguiente.
directiva() {
  local resto="${1#*$2}"
  printf '%s' "${resto%%;*}"
}

# server_name_de ARCHIVO PUERTO → las líneas `server_name` de los bloques que
# escuchan en ese puerto, sin comentarios.
server_name_de() {
  local linea limpia puerto=""
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    limpia="${linea%%#*}"
    if [[ "$limpia" == *"listen 443"* ]]; then
      puerto=443
    elif [[ "$limpia" == *"listen 80"* ]]; then
      puerto=80
    fi
    if [[ "$limpia" == *server_name* && "$puerto" == "$2" ]]; then
      printf '%s\n' "$limpia"
    fi
  done <"$1"
}

# linea_de_redireccion ARCHIVO → el encabezado del `location` que manda a la
# app las direcciones guardadas por los clientes.
#
# Se identifica por su DESTINO (`app.` o `sandbox.`) y no por su patrón: el
# patrón es justamente lo que se quiere revisar, y buscarlo por sí mismo sería
# un test que se aprueba solo. El 301 de :80 no se confunde con este porque
# apunta al apex, no a un subdominio de la app.
linea_de_redireccion() {
  local linea encabezado=""
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" == *location* ]] && encabezado="$linea"
    if [[ "$linea" == *'return 301 https://app.sellpointy.com$request_uri'* ||
          "$linea" == *'return 301 https://sandbox.sellpointy.com$request_uri'* ]]; then
      printf '%s' "$encabezado"
      return 0
    fi
  done <"$1"
  return 1
}

# ── Las comprobaciones de un vhost del sitio ────────────────────────────────
#
# Devuelve 0 si el vhost cumple TODO el contrato. Cada fallo se explica.
verificar_vhost() {
  local archivo="$1" nombre todo bloque fallo=0
  nombre="$(basename "$archivo")"
  if [[ ! -f "$archivo" ]]; then
    echo "  ✗ no existe $archivo" >&2
    return 1
  fi
  todo="$(texto "$archivo")"
  reprobar() { echo "  ✗ $nombre: $1" >&2; fallo=1; }

  # CSP estricta. Todo se mide sobre la LÍNEA que define la CSP, no sobre el
  # archivo: los comentarios de estos vhosts nombran las directivas en prosa.
  local csp script
  [[ "$todo" == *"Content-Security-Policy"* ]] || reprobar "no declara Content-Security-Policy"
  if csp="$(linea_csp "$archivo")"; then
    [[ "$csp" == *"default-src 'none'"* ]]     || reprobar "su CSP no arranca en default-src 'none'"
    [[ "$csp" == *"frame-ancestors 'none'"* ]] || reprobar "su CSP no lleva frame-ancestors 'none'"
    [[ "$csp" == *"base-uri 'none'"* ]]        || reprobar "su CSP no lleva base-uri 'none'"
    [[ "$csp" == *"form-action 'self'"* ]]     || reprobar "su CSP no lleva form-action 'self'"
    # `script-src` cerrado: el guion en línea va por hash, no por unsafe-inline.
    script="$(directiva "$csp" "script-src")"
    [[ "$script" == *"sha256-"* ]]     || reprobar "su script-src no autoriza el guion del tema por hash"
    [[ "$script" != *unsafe-inline* ]] || reprobar "su script-src lleva 'unsafe-inline' — el guion va por hash"
  else
    reprobar "no se encontró la directiva CSP (ninguna línea con default-src)"
  fi

  # El root, en la ruta de DENTRO del contenedor.
  [[ "$todo" == *"root /var/www/sites/"* ]] || reprobar "su root no está bajo /var/www/sites/ (es la ruta dentro de nginx-edge)"
  [[ "$todo" != *"root /opt/sites/"* ]]     || reprobar "su root usa /opt/sites, que es la ruta del HOST: daría 404 con todo publicado"

  # Nada de fallback a index.html: esto no es una SPA.
  [[ "$todo" == *"try_files \$uri \$uri/ =404"* ]] || reprobar "le falta el try_files con =404"

  # El API: solo el prefijo público.
  if bloque="$(bloque_location "$archivo" "/api/public/")"; then
    [[ "$bloque" == *proxy_pass* ]]                                          || reprobar "/api/public/ no reenvía a ningún lado"
    [[ "$bloque" == *"proxy_set_header Host"* ]]                             || reprobar "/api/public/ no pasa Host"
    [[ "$bloque" == *"proxy_set_header X-Real-IP"* ]]                        || reprobar "/api/public/ no pasa X-Real-IP"
    [[ "$bloque" == *"X-Forwarded-For \$proxy_add_x_forwarded_for"* ]]       || reprobar "/api/public/ no pasa X-Forwarded-For (el límite por IP del API sale de ahí)"
    [[ "$bloque" == *"X-Forwarded-Proto"* ]]                                 || reprobar "/api/public/ no pasa X-Forwarded-Proto"
    [[ "$bloque" == *"client_max_body_size 16k"* ]]                          || reprobar "/api/public/ no acota el cuerpo a 16k"
    [[ "$bloque" == *limit_req* ]]                                           || reprobar "/api/public/ no tiene limit_req"
  else
    reprobar "no tiene location /api/public/"
  fi

  # Y NADA más del API. Este es el corazón de la decisión: el apex no puede
  # ser una segunda puerta a /auth/*.
  if bloque="$(bloque_location "$archivo" "^~ /api/ ")"; then
    [[ "$bloque" == *"return 404"* ]] || reprobar "el location /api/ genérico no responde 404"
    [[ "$bloque" != *proxy_pass* ]]   || reprobar "el location /api/ genérico REENVÍA al API: el apex quedó abierto a /auth/*"
  else
    reprobar "no tiene un location /api/ que corte todo lo que no es público"
  fi

  # Las direcciones guardadas por los clientes. Se mira la LÍNEA del location
  # que las redirige y no el archivo entero: `login` aparece también en un
  # comentario, y un test que se conforma con eso no prueba nada.
  local redireccion ruta
  redireccion="$(linea_de_redireccion "$archivo" || true)"
  if [[ -z "$redireccion" ]]; then
    reprobar "no tiene el location que manda a la app las direcciones guardadas"
  else
    for ruta in login register forgot-password reset-password verify-email accept-invitation; do
      [[ "$redireccion" == *"$ruta"* ]] || reprobar "no redirige /$ruta (un enlace guardado de un cliente se pierde)"
    done
  fi
  [[ "$todo" == *"return 301 https://"* ]] || reprobar "no tiene ninguna redirección 301"

  # El gotcha de add_header: el location de /_astro/ pone un Cache-Control, así
  # que TIENE que volver a incluir los headers de seguridad y la CSP.
  if bloque="$(bloque_location "$archivo" "/_astro/")"; then
    [[ "$bloque" == *"max-age=31536000, immutable"* ]]      || reprobar "/_astro/ no se cachea como inmutable"
    [[ "$bloque" == *"snippets/security-headers.inc"* ]]    || reprobar "/_astro/ pone un add_header y NO re-incluye security-headers.inc: esas respuestas pierden nosniff y HSTS"
    [[ "$bloque" == *"Content-Security-Policy"* ]]          || reprobar "/_astro/ pone un add_header y pierde la CSP (y ahí se sirven SVG)"
  else
    reprobar "no tiene location /_astro/"
  fi

  # gzip: la imagen nginx:alpine lo trae apagado.
  [[ "$todo" == *"gzip on;"* ]] || reprobar "no enciende gzip (la imagen nginx:alpine lo trae comentado)"

  return "$fallo"
}

# ── Corredor ────────────────────────────────────────────────────────────────
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

# ── 1. El candado: nada del sitio en conf.d/ ────────────────────────────────
#
# `deploy.yml` copia conf.d/ y snippets/ COMPLETOS a producción en cada push a
# main. Mientras los textos legales tengan huecos, el vhost del sitio no puede
# estar ahí. Se busca por el `root` del sitio y no por el server_name, porque
# `conf.d/app.sellpointy.com.conf` legítimamente declara `sellpointy.com` (es
# el 301 al apex que sigue vigente hasta el encendido).
sitio_en_confd() {
  local archivo
  for archivo in "$CONFD"/*.conf; do
    if [[ "$(texto "$archivo")" == *"/var/www/sites/sellpointy.com"* ]]; then
      echo "  ✗ $(basename "$archivo") sirve el sitio y vive en conf.d/: viaja a producción en el próximo push" >&2
      return 0
    fi
  done
  return 1
}
esperar "ningún vhost de conf.d/ sirve el sitio todavía" 1 sitio_en_confd

# El 301 del apex a la app SIGUE en pie: quitarlo antes de mover el vhost
# dejaría el apex sin nada durante la ventana.
apex_sigue_redirigiendo() {
  [[ "$(texto "$CONFD/app.sellpointy.com.conf")" == *"server_name sellpointy.com;"* ]]
}
esperar "el apex sigue redirigiendo a app mientras el sitio no se enciende" 0 apex_sigue_redirigiendo

# Y el pipeline no copia pending/ — si alguien agrega ese scp, esto se pone rojo.
pipeline_copia_pending() {
  [[ "$(texto "$RAIZ/.github/workflows/deploy.yml")" == *pending* ]]
}
esperar "deploy.yml NO copia pending/ al server" 1 pipeline_copia_pending

# ── 2. Los dos vhosts reales cumplen el contrato ────────────────────────────
esperar "el vhost del apex cumple el contrato" 0 verificar_vhost "$APEX"
esperar "el vhost del sitio en pruebas cumple el contrato" 0 verificar_vhost "$SANDBOX"
if [[ "$falla" == 1 ]]; then
  verificar_vhost "$APEX" || true
  verificar_vhost "$SANDBOX" || true
fi

# ── 3. Lo propio de cada uno ────────────────────────────────────────────────
apex_ok() {
  local t; t="$(texto "$APEX")"
  [[ "$t" == *"proxy_pass http://api:3000/public/;"* ]] || { echo "  ✗ el apex no reenvía al API de PRODUCCIÓN" >&2; return 1; }
  [[ "$t" == *"https://app.sellpointy.com\$request_uri"* ]] || { echo "  ✗ el apex no manda los enlaces guardados a la app" >&2; return 1; }
  [[ "$t" == *"root /var/www/sites/sellpointy.com/public;"* ]] || { echo "  ✗ el apex no sirve el root del sitio" >&2; return 1; }
  # `www` no puede estar en el server_name de :443: el certificado de hoy no lo
  # cubre y servirlo daría un error de certificado. En :80 sí, porque desde ahí
  # se resuelve el ACME del día que se reemita.
  [[ "$(server_name_de "$APEX" 443)" != *"www.sellpointy.com"* ]] || { echo "  ✗ el apex declara www en :443 y el certificado no lo cubre" >&2; return 1; }
  [[ "$(server_name_de "$APEX" 80)" == *"www.sellpointy.com"* ]]  || { echo "  ✗ el apex no atiende www en :80: certbot no podría resolver su ACME" >&2; return 1; }
  return 0
}
esperar "el apex: API de producción, redirecciones a la app y www fuera de :443" 0 apex_ok

sandbox_ok() {
  local t; t="$(texto "$SANDBOX")"
  [[ "$t" == *'X-Robots-Tag "noindex, nofollow"'* ]] || { echo "  ✗ el sitio en pruebas no lleva X-Robots-Tag" >&2; return 1; }
  [[ "$t" == *"sandbox-api"* ]] || { echo "  ✗ el sitio en pruebas no apunta al API del sandbox" >&2; return 1; }
  [[ "$t" != *"http://api:3000"* ]] || { echo "  ✗ el sitio en pruebas apunta al API de PRODUCCIÓN" >&2; return 1; }
  [[ "$t" == *"resolver 127.0.0.11"* ]] || { echo "  ✗ el sitio en pruebas no usa resolución diferida: un sandbox caído haría fallar el nginx -t de producción" >&2; return 1; }
  [[ "$t" == *"root /var/www/sites/sitio-sandbox.sellpointy.com/public;"* ]] || { echo "  ✗ el sitio en pruebas no tiene su root propio" >&2; return 1; }
  return 0
}
esperar "el sitio en pruebas: noindex, API del sandbox y resolución diferida" 0 sandbox_ok

# Las dos zonas de rate limit tienen nombres distintos: dos `limit_req_zone`
# con el mismo nombre hacen fallar el `nginx -t` de CADA deploy de producción.
nombres_de_zona() { # nombres_de_zona ARCHIVO → los nombres declarados
  local linea re='zone=([A-Za-z0-9_]+):'
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" == limit_req_zone* ]] || continue
    [[ "$linea" =~ $re ]] && printf '%s\n' "${BASH_REMATCH[1]}"
  done <"$1"
}
zonas_sin_colision() {
  local za zb
  za="$(nombres_de_zona "$APEX")"
  zb="$(nombres_de_zona "$SANDBOX")"
  [[ -n "$za" && -n "$zb" ]] || { echo "  ✗ algún vhost no declara su limit_req_zone" >&2; return 1; }
  [[ "$za" != "$zb" ]] || { echo "  ✗ los dos vhosts declaran la zona «$za»: nginx -t falla si los dos llegan a conf.d/" >&2; return 1; }
  # Y ninguna choca con las que ya existen en 02-ratelimit.conf.
  local ya; ya="$(nombres_de_zona "$CONFD/02-ratelimit.conf")"
  local z
  for z in $za $zb; do
    [[ $'\n'"$ya"$'\n' != *$'\n'"$z"$'\n'* ]] || { echo "  ✗ la zona «$z» ya existe en 02-ratelimit.conf" >&2; return 1; }
  done
  return 0
}
esperar "las zonas de rate limit no chocan entre sí ni con 02-ratelimit.conf" 0 zonas_sin_colision

# ── 4. Fixtures: las comprobaciones de verdad atrapan un vhost malo ─────────
#
# Sin esto, `verificar_vhost` podría estar devolviendo 0 siempre y nadie se
# enteraría — que es la forma clásica de tener un test decorativo. Cada fixture
# rompe UNA sola cosa del vhost real, para saber qué atrapa cada comprobación.
#
# `${cadena//viejo/nuevo}` es sustitución de bash: mismo efecto que un sed, sin
# depender de si el sed de turno es el de GNU o el de BSD.
ORIGINAL="$(texto "$APEX")"
fixture() { # fixture NOMBRE CONTENIDO → la ruta del archivo escrito
  printf '%s\n' "$2" >"$TMP/$1.conf"
  printf '%s' "$TMP/$1.conf"
}

esperar "un vhost sin CSP no pasa" 1 \
  verificar_vhost "$(fixture sin-csp "${ORIGINAL//Content-Security-Policy/X-Nada}")"

# Un /api/ genérico que reenvía: EL bug que este archivo existe para impedir.
esperar "un vhost que reenvía TODO /api/ no pasa" 1 \
  verificar_vhost "$(fixture api-abierto "${ORIGINAL/        return 404;/        proxy_pass http://api:3000/;}")"

esperar "un vhost con el root del HOST (/opt/sites) no pasa" 1 \
  verificar_vhost "$(fixture root-host "${ORIGINAL//root \/var\/www\/sites\//root \/opt\/sites\/}")"

esperar "un /_astro/ que se come los headers de seguridad no pasa" 1 \
  verificar_vhost "$(fixture astro-pelado "${ORIGINAL//include \/etc\/nginx\/snippets\/security-headers.inc;/}")"

# ⚠️ El patrón y el reemplazo van en VARIABLES: con las comillas simples
# escritas dentro de `${cadena//…/…}`, bash las lee como comillas y la
# sustitución no ocurre (o revienta con "bad substitution"). Escrito así, el
# fixture de verdad afloja el script-src.
PAT_SCRIPT="script-src 'self' 'sha256-"
REP_SCRIPT="script-src 'unsafe-inline' 'self' 'sha256-"
esperar "un script-src con 'unsafe-inline' no pasa" 1 \
  verificar_vhost "$(fixture script-abierto "${ORIGINAL//$PAT_SCRIPT/$REP_SCRIPT}")"

esperar "un vhost que dejó de redirigir /login no pasa" 1 \
  verificar_vhost "$(fixture sin-login "${ORIGINAL//^\/(?:login|register/^\/(?:register}")"

# ── 5. El calculador del hash, con HTML de mentira ──────────────────────────
#
# `site-csp-hash.sh` corre en el CI contra el build real, que acá no
# necesariamente existe. Su LÓGICA sí se puede probar con fixtures: que saque
# el hash de los bytes exactos, que lo compare bien y que se plante si aparece
# un segundo guion en línea.
HASHER="$AQUI/site-csp-hash.sh"
printf '%s' '<html><head><script>alert(1)</script></head></html>' >"$TMP/pagina.html"
HASH_ESPERADO="$(printf '%s' 'alert(1)' | openssl dgst -sha256 -binary | openssl base64 -A)"
printf 'add_header Content-Security-Policy "default-src '"'"'none'"'"'; script-src '"'"'self'"'"' '"'"'sha256-%s'"'"'" always;\n' "$HASH_ESPERADO" >"$TMP/bueno.conf"
printf 'add_header Content-Security-Policy "default-src '"'"'none'"'"'; script-src '"'"'self'"'"' '"'"'sha256-AAAA'"'"'" always;\n' >"$TMP/malo.conf"
printf 'server_name ejemplo.com;\n' >"$TMP/sin-script-src.conf"

esperar "un vhost con el hash correcto pasa" 0 bash "$HASHER" "$TMP/pagina.html" "$TMP/bueno.conf"
esperar "un vhost con otro hash falla (el guion moriría en el navegador)" 1 bash "$HASHER" "$TMP/pagina.html" "$TMP/malo.conf"
esperar "un vhost sin script-src falla" 1 bash "$HASHER" "$TMP/pagina.html" "$TMP/sin-script-src.conf"

printf '%s' '<html><script>alert(1)</script><script>otra()</script></html>' >"$TMP/dos-guiones.html"
esperar "una página con DOS guiones en línea falla" 1 bash "$HASHER" "$TMP/dos-guiones.html" "$TMP/bueno.conf"
printf '%s' '<html><script type="module" src="/a.js"></script></html>' >"$TMP/sin-guion.html"
esperar "una página sin guion en línea falla" 1 bash "$HASHER" "$TMP/sin-guion.html" "$TMP/bueno.conf"

if [[ "$falla" == 0 ]]; then
  echo "site-vhost.test.sh: OK"
else
  echo "site-vhost.test.sh: FALLA" >&2
fi
exit "$falla"
