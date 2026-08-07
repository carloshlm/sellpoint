# snippet: hardening genérico de los vhosts PHP de los ápices (D4 del
# proposal vps-multidominio, unidad U4).
#
# ⚠️ Ajuste respecto al placeholder especulativo de U1: el `location ~
# \.php$ { fastcgi_pass ... }` NO vive acá. Cada sitio tiene su PROPIA pool
# de php-fpm (D4: aislamiento entre sitios vía `open_basedir`), y php-fpm no
# puede enrutar por Host header dentro de un mismo listener — cada pool
# necesita su propio puerto. Como el puerto difiere por sitio, ese location
# queda en el vhost de cada dominio (ver conf.d/laradoc.com.conf y
# conf.d/berrinchitosdent.com.conf), con el mismo hardening en los tres:
# `try_files $uri =404;` ANTES de `fastcgi_pass` — es lo que bloquea el
# exploit clásico de path-info (ej. /img/foo.jpg/x.php ejecutando el jpg).
# Requiere `cgi.fix_pathinfo=0` en php.ini (infrastructure/php-fpm/conf.d/,
# aplica a ambas pools) para ser efectivo.
#
# Uso: include /etc/nginx/snippets/php-site.inc;  dentro del server{} :443
# del sitio, junto al location ~ \.php$ { ... } propio del vhost.

location ~ /\. {
    deny all;
}

autoindex off;
