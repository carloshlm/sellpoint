# snippet: headers de seguridad para TODOS los vhosts :443 (D4/S1 del
# proposal vps-multidominio; extendido a system.laradoc.com por W2 del
# verify — system va en gris y no tiene a Cloudflare como capa extra).
#
# HSTS SIN includeSubDomains ni preload a propósito: el ápice no debe dictar
# política de transporte sobre subdominios futuros (D4).
#
# Uso: include /etc/nginx/snippets/security-headers.inc;  dentro de un server{} :443

add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000" always;
# F6-EDGE-01: capacidades del navegador que NINGÚN sitio de este server usa,
# apagadas. camera=(self) y NO camera=(): el escáner de códigos del POS usa
# la cámara del propio origen — cerrarla del todo lo rompería.
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" always;
server_tokens off;
