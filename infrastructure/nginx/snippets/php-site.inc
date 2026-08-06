# snippet: bloque PHP-FPM hardened para los sitios informativos (D4 del
# proposal vps-multidominio). Se usa recién en U4 — se crea acá porque U1
# versiona la carpeta snippets/ completa de una vez. El servicio php-fpm
# todavía no existe en el compose (lo crea U4); este archivo no se incluye
# desde ningún vhost activo hasta entonces.
#
# El try_files ANTES de fastcgi_pass es lo que bloquea el exploit clásico de
# path-info (ej. /img/foo.jpg/x.php ejecutando el jpg). Requiere
# cgi.fix_pathinfo=0 en php.ini (U4) para ser efectivo.
#
# Uso: include /etc/nginx/snippets/php-site.inc;  dentro del server{} del sitio

location ~ \.php$ {
    try_files $uri =404;
    fastcgi_pass php-fpm:9000;
    fastcgi_index index.php;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}

location ~ /\. {
    deny all;
}

autoindex off;
