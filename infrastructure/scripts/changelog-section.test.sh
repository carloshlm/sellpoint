#!/usr/bin/env bash
# F6-RELEASE-05 — el extractor de secciones del CHANGELOG, con un fixture.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/CHANGELOG.md" <<'MD'
# Cambios

Cabecera del archivo.

## [1.1.0](https://github.com/carloshlm/sellpoint/compare/v1.0.0...v1.1.0) (2026-10-01)

### Novedades

* **compras:** algo nuevo

## 1.0.0 (2026-09-12)

### Novedades

* **cost:** la venta congela el neto

### Correcciones

* **purchases:** un arreglo
MD
falla() { echo "FALLA: $*" >&2; exit 1; }
s110="$(bash "$AQUI/changelog-section.sh" 1.1.0 "$TMP/CHANGELOG.md")"
echo "$s110" | grep -q "algo nuevo" || falla "1.1.0 no trae su novedad"
echo "$s110" | grep -q "congela el neto" && falla "1.1.0 se llevó la sección de 1.0.0"
echo "$s110" | grep -q "^## " && falla "la sección no debe incluir encabezados de versión"
s100="$(bash "$AQUI/changelog-section.sh" 1.0.0 "$TMP/CHANGELOG.md")"
echo "$s100" | grep -q "congela el neto" || falla "1.0.0 no trae su novedad"
echo "$s100" | grep -q "un arreglo" || falla "1.0.0 no trae sus correcciones"
echo "$s100" | grep -q "algo nuevo" && falla "1.0.0 se llevó la de 1.1.0"
if bash "$AQUI/changelog-section.sh" 9.9.9 "$TMP/CHANGELOG.md" >/dev/null 2>&1; then falla "una versión ausente debe salir ≠ 0"; fi
echo "changelog-section.test.sh: OK"
