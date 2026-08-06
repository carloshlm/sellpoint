#!/usr/bin/env bash
#
# bootstrap.sh — Provisioning inicial del servidor de producción (Vultr, Ubuntu).
#
# Se corre UNA sola vez, como root, pegando este archivo completo (scp o heredoc)
# en una sesión SSH interactiva. Es idempotente: correrlo de nuevo no debería
# romper nada (usa comprobaciones "si ya existe, saltar").
#
# A partir de que este script termina, TODA la operación posterior (Claude,
# GitHub Actions) entra por la clave `deploy`, nunca por root con password.
#
# Uso:
#   scp infrastructure/scripts/bootstrap.sh root@<IP>:/root/bootstrap.sh
#   ssh root@<IP>
#   chmod +x /root/bootstrap.sh && /root/bootstrap.sh
#
set -euo pipefail

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m!! %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# 0. Esperar a que cloud-init termine. Si arranca aún corriendo, `apt` puede
#    estar bloqueado (lock de dpkg) y el resto del script falla a mitad.
# ---------------------------------------------------------------------------
log "Esperando a que cloud-init termine (si sigue corriendo)…"
if command -v cloud-init >/dev/null 2>&1; then
  cloud-init status --wait || true
else
  warn "cloud-init no está instalado en esta imagen; se continúa sin esperar."
fi

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# 0.5 Utilidades base — curl lo necesita tanto la instalación de Docker más
#     abajo como el smoke test de deploy.yml (curl contra /api/health en el
#     server). Se garantiza acá para no depender de que la imagen cloud-init
#     ya la traiga.
# ---------------------------------------------------------------------------
log "Instalando utilidades base (curl, ca-certificates)…"
apt-get update -y
apt-get install -y curl ca-certificates

# ---------------------------------------------------------------------------
# 1. Usuario `deploy` — sin password, autenticación SOLO por clave pública.
#    Se agrega a `sudo` (uso humano/manual con contraseña de root si hiciera
#    falta) y, más abajo, a `docker` una vez que el daemon existe.
# ---------------------------------------------------------------------------
log "Creando usuario deploy (si no existe)…"
if ! id -u deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
else
  echo "El usuario deploy ya existe, se continúa."
fi

# ---------------------------------------------------------------------------
# 2. authorized_keys de deploy con las TRES claves públicas (D2 del proposal):
#      - id_ed25519 de la Mac de Carlos (uso humano, con passphrase)
#      - sellpoint_deploy (uso de Claude/automatización local, sin passphrase)
#      - sellpoint_ci (uso EXCLUSIVO de GitHub Actions vía DEPLOY_SSH_KEY)
#    Cada clave se puede revocar sola borrando una línea, sin tocar las otras.
# ---------------------------------------------------------------------------
log "Instalando authorized_keys de deploy…"
DEPLOY_HOME="/home/deploy"
mkdir -p "${DEPLOY_HOME}/.ssh"

CARLOS_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICwEQH6ZWUXMmFoTXsBb3l9U0OVcLlNiKbrpFSt95F3Y carlos@quotanda.com"
DEPLOY_AUTOMATION_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFuQn9XucBS4giUa8azgsxisFhgeL6Dw8wXoQnlv8qY2 sellpoint-automation"
CI_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILVsa17RDsz0nZmKtIyHR1FQdauJ5xnrxWJoKEXGnNsY sellpoint-ci"

AUTHORIZED_KEYS_FILE="${DEPLOY_HOME}/.ssh/authorized_keys"
touch "${AUTHORIZED_KEYS_FILE}"
for key in "${CARLOS_PUBKEY}" "${DEPLOY_AUTOMATION_PUBKEY}" "${CI_PUBKEY}"; do
  if ! grep -qF "${key}" "${AUTHORIZED_KEYS_FILE}"; then
    echo "${key}" >> "${AUTHORIZED_KEYS_FILE}"
  fi
done

chmod 700 "${DEPLOY_HOME}/.ssh"
chmod 600 "${AUTHORIZED_KEYS_FILE}"
chown -R deploy:deploy "${DEPLOY_HOME}/.ssh"

# ---------------------------------------------------------------------------
# 3. Hardening de sshd: apagar login por password y por root, dejar SOLO
#    autenticación por clave pública. NO se borra la password de root del
#    sistema operativo — sigue siendo el único rescate vía consola web de
#    Vultr si este script (u otro cambio futuro) rompe sshd_config.
# ---------------------------------------------------------------------------
log "Endureciendo sshd_config…"
SSHD_HARDENING_FILE="/etc/ssh/sshd_config.d/99-sellpoint-hardening.conf"
cat > "${SSHD_HARDENING_FILE}" <<'EOF'
# Gestionado por infrastructure/scripts/bootstrap.sh — no editar a mano.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
EOF

log "Validando sintaxis de sshd_config ANTES de recargar (sshd -t)…"
if ! sshd -t; then
  warn "sshd -t FALLÓ. NO se recarga sshd. Revisá ${SSHD_HARDENING_FILE} a mano."
  warn "MANTENÉ esta sesión de root abierta — es tu único acceso hasta corregir el error."
  exit 1
fi

warn "A partir de acá, PasswordAuthentication y root por SSH quedan deshabilitados."
warn "MANTENÉ esta sesión abierta hasta confirmar en OTRA terminal que 'ssh -i ~/.ssh/sellpoint_deploy deploy@<IP>' funciona."

systemctl reload sshd || service ssh reload

# ---------------------------------------------------------------------------
# 4. ufw — sólo 22 (SSH), 80 (HTTP/ACME) y 443 (HTTPS) entrantes.
#    Gotcha: esto NO protege puertos publicados por Docker (docker escribe
#    en la cadena DOCKER-USER/nat y saltea ufw). Por eso postgres/redis NUNCA
#    llevan `ports:` en el compose de producción.
# ---------------------------------------------------------------------------
log "Configurando ufw…"
if ! command -v ufw >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ufw
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---------------------------------------------------------------------------
# 5. fail2ban — banea IPs con intentos fallidos de SSH.
# ---------------------------------------------------------------------------
log "Instalando y configurando fail2ban…"
if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y fail2ban
fi

cat > /etc/fail2ban/jail.local <<'EOF'
# Gestionado por infrastructure/scripts/bootstrap.sh — no editar a mano.
[sshd]
enabled = true
bantime = 1h
maxretry = 5
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# ---------------------------------------------------------------------------
# 6. Swap de 2GB — el server tiene poca RAM (2GB); esto amortigua picos, no
#    es plan de capacidad (los builds corren en GitHub Actions, no acá).
# ---------------------------------------------------------------------------
log "Configurando swap de 2GB (swappiness 10)…"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
else
  echo "/swapfile ya existe, se continúa."
fi

if ! grep -qF "/swapfile" /etc/fstab; then
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

if ! grep -qF "vm.swappiness" /etc/sysctl.conf; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi
sysctl -w vm.swappiness=10 >/dev/null

# ---------------------------------------------------------------------------
# 7. Docker — vía el repo oficial de Docker. Ubuntu 26.04 es muy reciente y
#    el repo oficial puede no tener publicado su codename todavía (riesgo R1
#    del proposal): si el `apt install docker-ce` falla, se cae a
#    get.docker.com (el script oficial resuelve el codename correcto solo).
# ---------------------------------------------------------------------------
log "Instalando Docker…"
if ! command -v docker >/dev/null 2>&1; then
  set +e
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  UBUNTU_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  DOCKER_OFFICIAL_REPO_STATUS=$?
  set -e

  if [ "${DOCKER_OFFICIAL_REPO_STATUS:-1}" -ne 0 ] || ! command -v docker >/dev/null 2>&1; then
    warn "El repo oficial de Docker falló (probable codename '${UBUNTU_CODENAME}' aún no publicado). Fallback a get.docker.com…"
    rm -f /etc/apt/sources.list.d/docker.list
    curl -fsSL https://get.docker.com | sh
  fi
else
  echo "Docker ya está instalado, se continúa."
fi

systemctl enable docker
systemctl start docker

# Ahora que el grupo docker existe, se agrega deploy.
usermod -aG docker deploy

# ---------------------------------------------------------------------------
# 8. /opt/sellpoint — layout donde vive el compose de producción, propiedad
#    de deploy (no de root: los deploys por Actions corren como deploy).
# ---------------------------------------------------------------------------
log "Creando /opt/sellpoint…"
mkdir -p /opt/sellpoint
chown deploy:deploy /opt/sellpoint

log "Bootstrap completo."
echo "Verificación recomendada, DESDE OTRA terminal, sin cerrar esta sesión:"
echo "  ssh -i ~/.ssh/sellpoint_deploy deploy@<IP> whoami   # debe imprimir 'deploy'"
echo "  ssh root@<IP>                                        # debe ser RECHAZADO"
