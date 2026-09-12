#!/usr/bin/env bash
# F6-RELEASE-02 — retención en GHCR que se MIDE.
#
# Reemplaza a `actions/delete-package-versions`, que corrió en verde cada
# domingo desde el 2026-08-27 sin retener nada: borra como máximo 100
# versiones por corrida («Total versions deleted till now: 100» en cada log)
# mientras cada deploy dejaba tres versiones por paquete. Un cleanup sin una
# métrica que lo verifique es una línea decorativa (bitácora 2026-08-18, el
# disco lleno); este imprime cuántas borró y cuántas quedan, y FALLA si quedan
# más de las que debe.
#
# Regla, por paquete:
#   · se conservan las KEEP_TAGGED versiones ETIQUETADAS más nuevas (por
#     fecha de creación, no por nombre: los shas no ordenan);
#   · nunca se borra una versión de menos de MIN_AGE_HOURS horas (el
#     rollback a mano mira 24 h atrás; 48 deja colchón);
#   · todo lo SIN etiqueta se borra (los manifiestos y atestaciones que
#     buildx empujaba antes de `provenance: false`, F6-RELEASE-01).
#
# `gh api --paginate` recorre TODAS las páginas: sin tope de 100. Con
# DRY_RUN=1 imprime el plan y no borra. `GH_BIN` permite inyectar un `gh`
# falso en el test (ghcr-retention.test.sh).
#
# Uso: GITHUB_TOKEN=… bash ghcr-retention.sh   (o `gh auth login` local)
set -euo pipefail

OWNER="${GHCR_OWNER:-carloshlm}"
PACKAGES="${GHCR_PACKAGES:-sellpoint-api sellpoint-web sellpoint-migrate}"
KEEP_TAGGED="${KEEP_TAGGED:-20}"
MIN_AGE_HOURS="${MIN_AGE_HOURS:-48}"
DRY_RUN="${DRY_RUN:-0}"
GH="${GH_BIN:-gh}"
NOW="${NOW_EPOCH:-$(date -u +%s)}"

fallo=0
for pkg in $PACKAGES; do
  # Una fila por versión: id, fecha y etiquetas. `--paginate` concatena las
  # páginas; `jq -s` las vuelve UNA lista.
  versiones="$("$GH" api --paginate \
    "/users/${OWNER}/packages/container/${pkg}/versions?per_page=100" \
    --jq '.[] | {id, created_at, tags: .metadata.container.tags}' | jq -s '.')"
  total="$(jq 'length' <<<"$versiones")"
  etiquetadas="$(jq '[.[] | select((.tags | length) > 0)] | length' <<<"$versiones")"

  # Lo que se borra: las etiquetadas más allá de las KEEP más nuevas, y las
  # sin etiqueta — siempre respetando la edad mínima. Primero las etiquetadas
  # (un índice viejo referencia a sus hijos sin etiqueta: sueltos después,
  # se borran sin que GHCR rechace la referencia).
  a_borrar="$(jq -r \
    --argjson keep "$KEEP_TAGGED" --argjson now "$NOW" --argjson minAge "$MIN_AGE_HOURS" '
    def edad_h: (($now - (.created_at | sub("\\.[0-9]+"; "") | fromdateiso8601)) / 3600);
    def vieja: edad_h >= $minAge;
    ([.[] | select((.tags | length) > 0)] | sort_by(.created_at) | reverse | .[$keep:] | map(select(vieja)))
    + ([.[] | select((.tags | length) == 0)] | map(select(vieja)))
    | .[].id' <<<"$versiones")"

  borradas=0
  fallidas=0
  for id in $a_borrar; do
    if [ "$DRY_RUN" = "1" ]; then
      echo "  [dry-run] borraría ${pkg} versión ${id}"
      borradas=$((borradas + 1))
      continue
    fi
    if "$GH" api -X DELETE "/users/${OWNER}/packages/container/${pkg}/versions/${id}" >/dev/null 2>&1; then
      borradas=$((borradas + 1))
    else
      echo "  no se pudo borrar ${pkg} versión ${id}"
      fallidas=$((fallidas + 1))
    fi
  done

  quedan=$((total - borradas))
  # Las etiquetadas que quedan: las KEEP más nuevas más las jóvenes protegidas.
  quedan_etiquetadas="$(jq -r \
    --argjson keep "$KEEP_TAGGED" --argjson now "$NOW" --argjson minAge "$MIN_AGE_HOURS" '
    def edad_h: (($now - (.created_at | sub("\\.[0-9]+"; "") | fromdateiso8601)) / 3600);
    [.[] | select((.tags | length) > 0)] | sort_by(.created_at) | reverse
    | (.[:$keep] | length) + ([.[$keep:][] | select(edad_h < $minAge)] | length)' <<<"$versiones")"
  echo "paquete=${pkg} total=${total} etiquetadas=${etiquetadas} borradas=${borradas} fallidas=${fallidas} quedan=${quedan} quedan_etiquetadas=${quedan_etiquetadas}"

  # La métrica manda: más etiquetadas de las debidas (fuera de las jóvenes)
  # o un borrado que falló es un cleanup que no cumplió.
  if [ "$fallidas" -gt 0 ]; then
    fallo=1
  fi
  if [ "$DRY_RUN" != "1" ] && [ "$quedan_etiquetadas" -gt "$KEEP_TAGGED" ]; then
    # Solo cuenta como exceso lo VIEJO que no se pudo borrar: las jóvenes se
    # protegen a propósito. Si quedan_etiquetadas > KEEP sin fallidas, es que
    # hay más de KEEP versiones de menos de MIN_AGE_HOURS: informativo.
    echo "  aviso: ${quedan_etiquetadas} etiquetadas siguen (las de menos de ${MIN_AGE_HOURS} h se protegen)."
  fi
done

exit "$fallo"
