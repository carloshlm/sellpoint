# snippet: headers de seguridad para los sitios PHP informativos (D4/S1 del
# proposal vps-multidominio). Se usa recién en U4 (ápices PHP) — se crea acá
# porque U1 versiona la carpeta snippets/ completa de una vez.
#
# HSTS SIN includeSubDomains ni preload a propósito: el ápice no debe dictar
# política de transporte sobre subdominios futuros (D4).
#
# Uso: include /etc/nginx/snippets/security-headers.inc;  dentro de un server{} :443

add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000" always;
server_tokens off;
