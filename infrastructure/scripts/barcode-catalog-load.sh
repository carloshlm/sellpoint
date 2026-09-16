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
# Desde F10-LANG el volcado es el JSONL (12.9 GB), que es el único que trae
# los nombres por idioma, y NO se guarda en disco: el generador lo transmite.
# Un portátil con 23 GB libres no tiene por qué aguantar 12.9 GB para quedarse
# con 200,000 filas. A 15 MB/s cada región tarda unos 15 minutos de red.
#
# `BARCODE_VOLCADO` sigue existiendo por si alguien SÍ tiene el archivo bajado
# y quiere ahorrarse la descarga entre regiones.
# ── El CSV ya generado se REUSA entre ambientes ──────────────────────────
#
# Cargar dos regiones en local, sandbox y producción son seis corridas, y sin
# esto serían seis descargas de 12.9 GB — hora y media de red para generar seis
# veces exactamente el mismo archivo. Con `BARCODE_CSV` apuntando a una ruta
# persistente, la primera corrida lo genera y las otras cinco lo reusan:
#
#   export BARCODE_CSV=~/catalogo-canada.csv.gz
#   barcode-catalog-load.sh local   canada --criterio venta   # descarga
#   barcode-catalog-load.sh sandbox canada --criterio venta   # reusa
#   barcode-catalog-load.sh prod    canada --criterio venta   # reusa
#
# ⚠️ Es POR REGIÓN: usar el mismo archivo para «canada» y «latam» cargaría
# Canadá dos veces. Una variable por región, o borrarla entre una y otra.
CSV="${BARCODE_CSV:-${TRABAJO}/catalogo.csv.gz}"
if [[ -f "${CSV}" ]]; then
  echo "→ Reusando el CSV ya generado: ${CSV} ($(du -h "${CSV}" | cut -f1))"
  echo "  ⚠️  Tiene que ser el de la región ${REGION}. Si no, bórralo."
else
  echo "→ Generando la región ${REGION} (criterio ${CRITERIO})…"
  SIN_COMPRIMIR="${CSV%.gz}"
  if [[ -n "${BARCODE_VOLCADO:-}" && -f "${BARCODE_VOLCADO}" ]]; then
    echo "  (leyendo el volcado local ${BARCODE_VOLCADO})"
    python3 "${GENERADOR}" csv "${SIN_COMPRIMIR}" --region "${REGION}" \
      --criterio "${CRITERIO}" --volcado "${BARCODE_VOLCADO}"
  else
    echo "  (transmitiendo 12.9 GB desde Open Food Facts, sin guardarlos)"
    python3 "${GENERADOR}" csv "${SIN_COMPRIMIR}" --region "${REGION}" \
      --criterio "${CRITERIO}"
  fi
  gzip -f "${SIN_COMPRIMIR}"
  echo "→ CSV comprimido: $(du -h "${CSV}" | cut -f1)"
fi

# ── 2. Cargar ────────────────────────────────────────────────────────────
# Tabla temporal + INSERT … ON CONFLICT, y NO un COPY directo: el COPY no sabe
# de conflictos y reventaría con el primer GTIN repetido. Qué hace el conflicto
# y por qué, en el comentario del propio SQL.
CARGA_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE carga (
  gtin14 CHAR(14), product_name VARCHAR(300),
  name_es VARCHAR(300), name_en VARCHAR(300), name_lang CHAR(2),
  brand VARCHAR(120), unit_size VARCHAR(60),
  country_code CHAR(2), market_code CHAR(2),
  search VARCHAR(300), source VARCHAR(24)
) ON COMMIT DROP;
COPY carga FROM STDIN WITH (FORMAT csv);
SQL
)
FIN_SQL=$(cat <<'SQL'
\.
INSERT INTO global_barcode_catalog
  (gtin14, product_name, name_es, name_en, name_lang, brand, unit_size,
   country_code, market_code, search, source, updated_at)
SELECT gtin14, product_name,
       nullif(name_es,''), nullif(name_en,''), nullif(name_lang,''),
       nullif(brand,''), nullif(unit_size,''),
       nullif(country_code,''), nullif(market_code,''),
       search, source, now()
FROM carga
-- ── Por qué esto ya no es DO NOTHING (F10-LANG, 2026-09-16) ─────────────
--
-- Con DO NOTHING, volver a correr esto no corregiría UNA SOLA fila: las
-- 953,969 ya existen, y los nombres por idioma nunca llegarían. Se actualiza,
-- pero con dos candados:
--
-- 1. El WHERE de abajo: una fila que aportó un NEGOCIO no se toca jamás, ni
--    por una recarga nuestra. Es la LEY de Carlos escrita en SQL.
-- 2. Los COALESCE de los nombres por idioma: se LLENA la casilla vacía, nunca
--    se pisa una escrita. Un negocio canadiense que tecleó «Extra Virgin Olive
--    Oil» no lo pierde porque Open Food Facts publique un volcado nuevo.
--
-- El resto de los campos sí se refrescan desde el volcado: son de Open Food
-- Facts y nadie más los escribe.
ON CONFLICT (gtin14) DO UPDATE SET
  product_name = EXCLUDED.product_name,
  name_es      = COALESCE(global_barcode_catalog.name_es, EXCLUDED.name_es),
  name_en      = COALESCE(global_barcode_catalog.name_en, EXCLUDED.name_en),
  name_lang    = EXCLUDED.name_lang,
  brand        = EXCLUDED.brand,
  unit_size    = EXCLUDED.unit_size,
  search       = EXCLUDED.search,
  updated_at   = now()
WHERE global_barcode_catalog.source = 'open_food_facts';
COMMIT;
ANALYZE global_barcode_catalog;
SELECT count(*) AS productos_en_el_catalogo FROM global_barcode_catalog;
SQL
)

echo "→ Cargando en ${BASE}…"
if [[ -z "${SSH_HOST}" ]]; then
  { printf '%s\n' "${CARGA_SQL}"; gzip -dc "${CSV}"; printf '%s\n' "${FIN_SQL}"; } \
    | docker exec -i "${CONTENEDOR}" psql -U sellpoint -d "${BASE}"
else
  # Se manda comprimido por la red y se descomprime del otro lado: son
  # ~20 MB en vez de ~60. `ssh -n` no aplica acá porque stdin ES el dato.
  { printf '%s\n' "${CARGA_SQL}"; gzip -dc "${CSV}"; printf '%s\n' "${FIN_SQL}"; } \
    | ssh "${SSH_HOST}" "docker exec -i ${CONTENEDOR} psql -U sellpoint -d ${BASE}"
fi

echo "✓ Listo."
