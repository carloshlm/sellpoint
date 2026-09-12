#!/usr/bin/env bash
# F6-RELEASE-02 — el test del script de retención, con un `gh` FALSO.
#
# Fixture: 27 versiones etiquetadas (2 de hoy, 25 viejas) y 6 sin etiqueta
# (1 de hoy, 5 viejas), con ids que NO ordenan igual que las fechas: quien
# ordene por nombre en vez de por fecha conserva las equivocadas. Esperado
# con KEEP=20: se conservan las 20 etiquetadas más nuevas (las 2 de hoy y
# las 18 viejas más recientes), se borran las 7 etiquetadas restantes y las 5
# sin etiqueta viejas, y la sin etiqueta de hoy se protege. Las etiquetadas
# se borran ANTES que las sin etiqueta.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Ahora: 2026-09-12T12:00:00Z. Vieja = hace 10 días; hoy = hace 1 h.
NOW=1789214400
FIXTURE="$TMP/versiones.jsonl"
: >"$FIXTURE"
# ids decrecientes para las FECHAS crecientes: 100 es la más vieja.
for i in $(seq 1 25); do
  id=$((200 - i))                       # 199, 198, … 175
  dia=$(printf "%02d" $((i)))           # 2026-08-01 + i días (todas > 48 h)
  echo "{\"id\":${id},\"created_at\":\"2026-08-${dia}T10:00:00Z\",\"tags\":[\"sha${id}\"]}" >>"$FIXTURE"
done
echo '{"id":5,"created_at":"2026-09-12T11:00:00Z","tags":["shaHoyA","latest"]}' >>"$FIXTURE"
echo '{"id":6,"created_at":"2026-09-12T10:30:00Z","tags":["shaHoyB"]}' >>"$FIXTURE"
for i in $(seq 1 5); do
  echo "{\"id\":$((900 + i)),\"created_at\":\"2026-08-0${i}T10:05:00Z\",\"tags\":[]}" >>"$FIXTURE"
done
echo '{"id":999,"created_at":"2026-09-12T11:00:05Z","tags":[]}' >>"$FIXTURE"

# El gh falso: `api --paginate …` escupe el fixture (una versión por línea,
# como lo haría el --jq real); `api -X DELETE …` anota el id borrado.
DELETES="$TMP/deletes.log"
: >"$DELETES"
cat >"$TMP/gh" <<GH
#!/usr/bin/env bash
if [ "\$1" = "api" ] && [ "\$2" = "--paginate" ]; then cat "$FIXTURE"; exit 0; fi
if [ "\$1" = "api" ] && [ "\$2" = "-X" ] && [ "\$3" = "DELETE" ]; then echo "\$4" | sed 's#.*/versions/##' >>"$DELETES"; exit 0; fi
echo "gh falso: llamada inesperada: \$*" >&2; exit 2
GH
chmod +x "$TMP/gh"

correr() {
  GH_BIN="$TMP/gh" NOW_EPOCH="$NOW" GHCR_PACKAGES="sellpoint-api" KEEP_TAGGED=20 MIN_AGE_HOURS=48 "$@" \
    bash "$AQUI/ghcr-retention.sh"
}

falla() { echo "FALLA: $*" >&2; exit 1; }

# ── 1. La corrida real borra lo debido, en el orden debido ───────────────
salida="$(correr env)"
echo "$salida" | grep -q "paquete=sellpoint-api total=33 etiquetadas=27 borradas=12 fallidas=0 quedan=21 quedan_etiquetadas=20" \
  || falla "métrica inesperada: $salida"
borrados="$(cat "$DELETES" | tr '\n' ' ')"
# Etiquetadas viejas a borrar: las 7 más antiguas por FECHA = ids 199..193.
for id in 199 198 197 196 195 194 193; do
  grep -qx "$id" "$DELETES" || falla "debió borrar la etiquetada vieja $id (por fecha, no por nombre): $borrados"
done
for id in 192 175 5 6; do
  grep -qx "$id" "$DELETES" && falla "NO debió borrar $id: $borrados"
done
for id in 901 902 903 904 905; do
  grep -qx "$id" "$DELETES" || falla "debió borrar la sin etiqueta vieja $id: $borrados"
done
grep -qx "999" "$DELETES" && falla "la sin etiqueta de hoy se protege: $borrados"
primera_sin_etiqueta="$(grep -n -m1 -E '^90[1-5]$' "$DELETES" | cut -d: -f1)"
ultima_etiquetada="$(grep -n -E '^19[3-9]$' "$DELETES" | tail -1 | cut -d: -f1)"
[ "$ultima_etiquetada" -lt "$primera_sin_etiqueta" ] || falla "las etiquetadas van antes que las sin etiqueta: $borrados"
[ "$(wc -l <"$DELETES" | tr -d ' ')" = "12" ] || falla "borró $(wc -l <"$DELETES") en vez de 12: $borrados"

# ── 2. DRY_RUN imprime el plan y no borra ────────────────────────────────
: >"$DELETES"
salida="$(correr env DRY_RUN=1)"
echo "$salida" | grep -q "\[dry-run\] borraría sellpoint-api versión 199" || falla "el dry-run no imprime el plan"
[ ! -s "$DELETES" ] || falla "el dry-run borró algo: $(cat "$DELETES")"

echo "ghcr-retention.test.sh: OK (12 borradas, orden y edad mínima respetados; dry-run sin borrar)"
