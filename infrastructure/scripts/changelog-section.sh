#!/usr/bin/env bash
# F6-RELEASE-05 — la sección de UNA versión del CHANGELOG.md, para las notas
# de la GitHub Release. `commit-and-tag-version` escribe cada versión como un
# encabezado `## [1.2.0](…compare…) (2026-09-12)` (o `## 1.2.0 (fecha)` sin
# enlace) seguido de sus subsecciones; esto imprime desde ese encabezado
# (excluido) hasta el siguiente `## ` (excluido). Sin sección: sale ≠ 0.
set -euo pipefail
VERSION="${1:?uso: changelog-section.sh <version>}"
ARCHIVO="${2:-CHANGELOG.md}"
awk -v v="$VERSION" '
  BEGIN { dentro = 0; hallada = 0 }
  /^## / {
    if (dentro) { exit }
    if ($0 ~ ("^## \\[?" v "([]) (]|$)")) { dentro = 1; hallada = 1; next }
  }
  dentro { print }
  END { if (!hallada) { print "sin sección " v " en el CHANGELOG" > "/dev/stderr"; exit 1 } }
' "$ARCHIVO"
