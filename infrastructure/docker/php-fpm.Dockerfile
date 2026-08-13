# Imagen de php-fpm para los sitios PHP del VPS (D4 del proposal
# vps-multidominio). Existe por UNA razón: la imagen oficial
# `php:8.3-fpm-alpine` NO trae `pdo_pgsql` — solo PDO + pdo_sqlite — así que
# sin esto ningún sitio puede hablar con Postgres.
#
# Se mantiene PINEADA por digest (nunca `latest`): una imagen base que cambia
# sola bajo los pies es un cambio de runtime que nadie revisó.
FROM php:8.3-fpm-alpine@sha256:bf90236449d333cef008b1f01c72a3d4f11a6470a74629665e4c6b6158f03fc8

# libpq: runtime de Postgres. postgresql-dev: headers para compilar la
# extensión — va en la MISMA capa que el build y se borra al final, así no
# queda un compilador dentro de la imagen de producción (superficie de
# ataque gratis en un container que sirve código de terceros).
RUN set -eux; \
    apk add --no-cache libpq; \
    apk add --no-cache --virtual .build-deps postgresql-dev $PHPIZE_DEPS; \
    docker-php-ext-install -j"$(nproc)" pdo_pgsql; \
    apk del --no-network .build-deps; \
    php -m | grep -q pdo_pgsql

# Sin CMD/ENTRYPOINT propios: se hereda el de la imagen base (php-fpm en
# foreground). El hardening (php.ini) y las pools se montan desde el compose
# como bind-mounts read-only — no se hornean acá, así cambiarlos no exige
# rebuild ni pasa por el registry.
