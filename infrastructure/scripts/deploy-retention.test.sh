#!/usr/bin/env bash
# La higiene de disco de `deploy-remote.sh`, con un `docker` FALSO.
#
# Por qué existe (2026-09-12): la retención era por HORAS («24h») y eso acota
# el calendario, no el disco. Quince deploys en un día × ~3 GB llenaron los
# 47 GB del server sin que la limpieza pudiera tocar una sola imagen —ninguna
# llegaba a 24 h— y el deploy abortó por 183 MB. Ahora se cuentan DEPLOYS, que
# es lo que sí acota los GB, y este test lo fija.
#
# Fixture con la trampa a propósito: los IDs NO ordenan igual que las fechas.
# Quien ordene por id (o confíe en el orden que devuelve el daemon) conserva
# las equivocadas y el test lo caza.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Seis imágenes por repo: las más nuevas llevan los ids más CHICOS.
IMAGENES="$TMP/imagenes.txt"
: >"$IMAGENES"
for repo in sellpoint-api sellpoint-web sellpoint-migrate; do
  for i in 1 2 3 4 5 6; do
    dia=$(printf "%02d" $((12 - i))) # i=1 → el 11 (la más nueva)
    echo "${repo}|2026-09-${dia} 10:00:00 +0000 UTC|${repo}-id${i}" >>"$IMAGENES"
  done
done

# El docker falso: `images <repo> --format …` filtra el fixture por repo (en el
# orden en que está escrito, que NO es el cronológico); `rmi` anota el id. La
# imagen «en uso» rebota, igual que el docker real.
BORRADOS="$TMP/borrados.log"
: >"$BORRADOS"
EN_USO="sellpoint-api-id6"
cat >"$TMP/docker" <<DOCKER
#!/usr/bin/env bash
if [ "\$1" = "images" ]; then
  repo="\${2##*/}"
  grep "^\${repo}|" "$IMAGENES" | while IFS='|' read -r r creado id; do
    printf '%s|%s\n' "\$creado" "\$id"
  done
  exit 0
fi
if [ "\$1" = "rmi" ]; then
  if [ "\$2" = "$EN_USO" ]; then exit 1; fi
  echo "\$2" >>"$BORRADOS"; exit 0
fi
exit 0
DOCKER
chmod +x "$TMP/docker"
PATH="$TMP:$PATH"

# La función tal cual vive en el script de deploy: se extrae por marcadores
# para que este test falle si alguien la cambia sin pasar por acá.
GHCR_OWNER="carloshlm"
KEEP_DEPLOYS=4
# shellcheck disable=SC2016
sed -n '/^limpiar_imagenes_viejas() {$/,/^}$/p' "$AQUI/deploy-remote.sh" >"$TMP/fn.sh"
[ -s "$TMP/fn.sh" ] || { echo "FALLA: no se encontró limpiar_imagenes_viejas en deploy-remote.sh"; exit 1; }
# shellcheck source=/dev/null
. "$TMP/fn.sh"
limpiar_imagenes_viejas

esperado="$TMP/esperado.txt"
{
  # De cada repo sobran las DOS más viejas (id5 e id6) porque se conservan 4.
  # `sellpoint-api-id6` está en uso: el rmi falla y sobrevive.
  echo "sellpoint-api-id5"
  echo "sellpoint-migrate-id5"
  echo "sellpoint-migrate-id6"
  echo "sellpoint-web-id5"
  echo "sellpoint-web-id6"
} | sort >"$esperado"
sort "$BORRADOS" >"$TMP/obtenido.txt"

if ! diff -u "$esperado" "$TMP/obtenido.txt"; then
  echo "FALLA: no se borraron exactamente las imágenes que sobran."
  exit 1
fi

# Y la red de seguridad, dicha aparte para que el motivo quede en el log.
if grep -q "^${EN_USO}$" "$TMP/obtenido.txt"; then
  echo "FALLA: se borró una imagen EN USO."
  exit 1
fi

echo "OK: conserva las ${KEEP_DEPLOYS} más nuevas por repo, borra el resto y respeta la que está en uso."
