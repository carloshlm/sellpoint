# snippet: parámetros TLS comunes a todo server block :443 ssl.
# El vhost que incluye este snippet sigue siendo dueño de sus propios
# ssl_certificate / ssl_certificate_key (uno por dominio, D3 del proposal).
#
# Uso: include /etc/nginx/snippets/ssl-params.inc;  dentro de un server{} :443

ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_session_cache shared:SSL:10m;
