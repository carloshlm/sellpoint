# snippet: ACME HTTP-01 challenge — se incluye en TODOS los server blocks :80
# (vhosts versionados en conf.d/ y plantillas de bootstrap/). certbot escribe
# el token en el webroot compartido, nginx lo sirve directo sin proxy.
#
# Uso: include /etc/nginx/snippets/acme.inc;  dentro de un server{} :80

location /.well-known/acme-challenge/ {
    root /var/www/certbot;
}
