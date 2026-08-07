#!/usr/bin/env bash
# f1-auth AD-4: genera el par RS256 de dev en apps/api/keys/ (gitignored,
# ver U1-03). NUNCA correr esto para producción — ahí las claves se generan
# EN el server y viven en /opt/sellpoint/.env como *_BASE64 (jamás pasan por
# la laptop ni por CI). RSA 2048, chmod 600.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_DIR="${SCRIPT_DIR}/../keys"

mkdir -p "${KEYS_DIR}"

PRIVATE_KEY="${KEYS_DIR}/jwt-private.pem"
PUBLIC_KEY="${KEYS_DIR}/jwt-public.pem"

if [[ -f "${PRIVATE_KEY}" || -f "${PUBLIC_KEY}" ]]; then
  echo "Ya existen claves en ${KEYS_DIR} — no se sobreescriben. Borralas a mano si querés regenerar." >&2
  exit 1
fi

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${PRIVATE_KEY}"
openssl rsa -pubout -in "${PRIVATE_KEY}" -out "${PUBLIC_KEY}"

chmod 600 "${PRIVATE_KEY}" "${PUBLIC_KEY}"

echo "Claves generadas en ${KEYS_DIR}:"
echo "  ${PRIVATE_KEY}"
echo "  ${PUBLIC_KEY}"
echo
echo "Agregá a apps/api/.env (dev):"
echo "  JWT_PRIVATE_KEY_PATH=${PRIVATE_KEY}"
echo "  JWT_PUBLIC_KEY_PATH=${PUBLIC_KEY}"
