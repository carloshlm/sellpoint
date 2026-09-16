#!/usr/bin/env bash
#
# barcode-catalog-load.sh — Carga el catálogo global de códigos de barras
# (GTIN → nombre) en un ambiente.
#
# Por qué existe: los DATOS del catálogo NO viajan en el repo. Son ~950,000
# filas que en formato migración pesan 125 MB, y a git no se le borra nada:
# entrarían una vez y las arrastraríamos para siempre, en cada clon y cada
# CI, para algo que se regenera con un comando. Lo que sí viaja es la
# ESTRUCTURA (migración 20260925100000_f10_barcode_global_catalog) y el
# generador (apps/api/prisma/seed/barcode-catalog/).
#
# O sea: el esquema lo despliega el pipeline como siempre; los datos entran
# por acá, una vez por ambiente, y se refrescan cuando queramos.
#
# Uso:
#   # Local (el contenedor de desarrollo)
#   infrastructure/scripts/barcode-catalog-load.sh local latam
#   infrastructure/scripts/barcode-catalog-load.sh local usa --criterio venta
#
#   # Remotos (por SSH, con la llave sellpoint_ci)
#   infrastructure/scripts/barcode-catalog-load.sh sandbox latam
#   infrastructure/scripts/barcode-catalog-load.sh prod    latam
#
# Fuente de los datos: volcado de Open Food Facts (ODbL). Atribución
# obligatoria; el share-alike aplica a la base DERIVADA, y por eso la columna
# `source` separa estas filas de las que aportan los negocios.
set -euo pipefail

AMBIENTE="${1:?Falta el ambiente: local | sandbox | prod}"
REGION="${2:?Falta la región: latam | usa | canada | norteamerica | MX | ...}"
shift 2
CRITERIO="prefijo"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --criterio) CRITERIO="${2:?--criterio necesita un valor}"; shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GENERADOR="${RAIZ}/apps/api/prisma/seed/barcode-catalog/build-migration.py"
TRABAJO="$(mktemp -d)"
trap 'rm -rf "${TRABAJO}"' EXIT

# ── Parámetros por ambiente ──────────────────────────────────────────────
# Mismos nombres que usa deploy-remote.sh. El sandbox tiene su propio
# contenedor de Postgres; prod usa el histórico `sellpoint-postgres`.
# El host SSH es el MISMO para los dos ambientes remotos: sandbox y producción
# comparten servidor (216.238.73.144) y se distinguen por contenedor y base.
# El alias `sellpoint-prod` y la llave viven en ~/.ssh/config.
case "${AMBIENTE}" in
  local)   SSH_HOST=""                CONTENEDOR="sellpoint-postgres"         BASE="sellpoint_dev" ;;
  sandbox) SSH_HOST="sellpoint-prod"  CONTENEDOR="sellpoint-sandbox-postgres" BASE="sellpoint_sandbox" ;;
  prod)    SSH_HOST="sellpoint-prod"  CONTENEDOR="sellpoint-postgres"         BASE="sellpoint_prod" ;;
  *) echo "Ambiente desconocido: ${AMBIENTE} (local | sandbox | prod)" >&2; exit 2 ;;
esac

echo "→ Ambiente ${AMBIENTE}: ${BASE} en ${CONTENEDOR}${SSH_HOST:+ (vía ssh ${SSH_HOST})}"

# ── 1. Generar el CSV ────────────────────────────────────────────────────
# En CSV y no en INSERT porque `COPY` mete un millón de filas en segundos y
# el archivo pesa la mitad. El volcado se baja una vez (1.2 GB) y se reusa si
# se piden varias regiones seguidas.
VOLCADO="${BARCODE_VOLCADO:-${TRABAJO}/volcado.csv.gz}"
if [[ ! -f "${VOLCADO}" ]]; then
  echo "→ Descargando el volcado de Open Food Facts (1.2 GB)…"
  curl -sL --retry 2 -o "${VOLCADO}" \
    "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
fi

CSV="${TRABAJO}/catalogo.csv"
echo "→ Generando la región ${REGION} (criterio ${CRITERIO})…"
python3 "${GENERADOR}" csv "${CSV}" --region "${REGION}" \
  --criterio "${CRITERIO}" --volcado "${VOLCADO}"

gzip -f "${CSV}"
echo "→ CSV comprimido: $(du -h "${CSV}.gz" | cut -f1)"

# ── 2. Cargar ────────────────────────────────────────────────────────────
# Tabla temporal + INSERT … ON CONFLICT DO NOTHING, y NO un COPY directo:
# el COPY no sabe de conflictos y reventaría con el primer GTIN repetido.
# El DO NOTHING es deliberado — un nombre que un negocio confirmó a mano
# jamás se pisa con uno de Open Food Facts.
CARGA_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE carga (
  gtin14 CHAR(14), product_name VARCHAR(300), brand VARCHAR(120),
  unit_size VARCHAR(60), country_code CHAR(2), market_code CHAR(2),
  search VARCHAR(300), source VARCHAR(24)
) ON COMMIT DROP;
COPY carga FROM STDIN WITH (FORMAT csv);
SQL
)
FIN_SQL=$(cat <<'SQL'
\.
INSERT INTO global_barcode_catalog
  (gtin14, product_name, brand, unit_size, country_code, market_code,
   search, source, updated_at)
SELECT gtin14, product_name,
       nullif(brand,''), nullif(unit_size,''),
       nullif(country_code,''), nullif(market_code,''),
       search, source, now()
FROM carga
ON CONFLICT (gtin14) DO NOTHING;
COMMIT;
ANALYZE global_barcode_catalog;
SELECT count(*) AS productos_en_el_catalogo FROM global_barcode_catalog;
SQL
)

echo "→ Cargando en ${BASE}…"
if [[ -z "${SSH_HOST}" ]]; then
  { printf '%s\n' "${CARGA_SQL}"; gzip -dc "${CSV}.gz"; printf '%s\n' "${FIN_SQL}"; } \
    | docker exec -i "${CONTENEDOR}" psql -U sellpoint -d "${BASE}"
else
  # Se manda comprimido por la red y se descomprime del otro lado: son
  # ~20 MB en vez de ~60. `ssh -n` no aplica acá porque stdin ES el dato.
  { printf '%s\n' "${CARGA_SQL}"; gzip -dc "${CSV}.gz"; printf '%s\n' "${FIN_SQL}"; } \
    | ssh "${SSH_HOST}" "docker exec -i ${CONTENEDOR} psql -U sellpoint -d ${BASE}"
fi

echo "✓ Listo."
