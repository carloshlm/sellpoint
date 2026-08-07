# bootstrap/ — etapa 1 de TLS por dominio nuevo

Esta carpeta **nunca la copia el pipeline de deploy** (`deploy.yml` solo scp's
`conf.d/` y `snippets/`). Es la plantilla manual para dar de alta un dominio
que todavía no tiene certificado.

## Convención

Un archivo por dominio: `<dominio>.http.conf` — solo `:80`, solo el ACME
challenge (`include /etc/nginx/snippets/acme.inc;`) más el proxy/contenido
que corresponda. Sin bloque `:443` (el certificado no existe todavía; si
`ssl_certificate` apunta a un archivo inexistente, `nginx -t` falla).

## Flujo (`infrastructure/scripts/tls-bootstrap.sh <dominio>`, U3/U4)

1. Copiar `bootstrap/<dominio>.http.conf` a `conf.d/` en el server (archivo
   **nuevo**, no toca ningún vhost existente) → `nginx -t && nginx -s reload`
2. `certbot --dry-run` para ese dominio
3. Emisión real
4. Recién ahí se commitea al repo el vhost `:443` definitivo en `conf.d/` —
   **nunca antes** de que el certificado exista en el server (si no, el
   siguiente `nginx -t` del deploy automático falla por `ssl_certificate`
   inexistente y aborta el deploy).

## Dominios ya emitidos

- `system.laradoc.com` — TLS emitido 2026-08-07 (U3), expira 2026-11-05.
  El vhost http-only de esta carpeta sigue versionado como referencia del
  patrón para el próximo dominio; el vhost TLS definitivo vive en
  `../conf.d/system.laradoc.com.conf`.

## Dominios pendientes (bloqueados, no forman parte de U1/U3)

- `berrinchitosdent.com` — bloqueado por M2/M3 (DNS + contenido pendientes)
