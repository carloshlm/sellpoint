# snippet: IP real del cliente detrás de Cloudflare (D8/R3 del proposal
# vps-multidominio). Se usa SOLO en vhosts "naranja" (laradoc.com,
# berrinchitosdent.com — U4); system.laradoc.com va "gris" y no lo necesita,
# nginx-edge ya ve la IP real directo.
#
# Sin esto, $remote_addr / X-Forwarded-For son la IP del edge de Cloudflare
# para TODOS los visitantes → el limit_req del formulario contaría todo
# Cloudflare en un solo balde (inútil, o peor: bloquea a todos).
#
# ⚠️ set_real_ip_from debe ser la lista EXPLÍCITA de rangos de Cloudflare,
# NUNCA un CIDR abierto (R3). Fuente oficial:
#   https://www.cloudflare.com/ips-v4  y  https://www.cloudflare.com/ips-v6
# Copiado el 2026-08-06 — revisar contra la fuente si Cloudflare rota rangos.
#
# Uso: include /etc/nginx/snippets/cloudflare-realip.inc;  dentro del server{}

set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;
