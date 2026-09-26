# RUNBOOK — Cómo se opera SellPointy

Este documento es para quien tenga que operar SellPointy: desplegar, volver atrás, restaurar la base,
mirar qué está pasando o levantar un ambiente nuevo. **Su regla:** solo describe procedimientos que ya se
ensayaron o que corren todos los días; lo que nunca se probó lleva la marca **⚠️ no ensayado**. La fuente
de cada paso va entre paréntesis.

| | |
|---|---|
| **Revisado** | 2026-09-26 |
| **Operador** | Carlos Hernandez Hernandez, el único hoy (SEGURIDAD §2.8) |
| **Documentos hermanos** | [SEGURIDAD.md](./SEGURIDAD.md) (qué medidas hay y por qué) · [ARQUITECTURA.md](./ARQUITECTURA.md) §2.4 (la infraestructura) · [CONTRIBUTING.md](./CONTRIBUTING.md) (cómo se trabaja en el código) |

**Si Carlos no está, lee primero la [sección 0](#0-antes-de-empezar-lo-que-necesitas):** sin dos cosas que
solo él tiene, ningún procedimiento de este documento se puede ejecutar.

---

## 0. Antes de empezar: lo que necesitas

| Qué | Para qué | Quién lo tiene hoy |
|---|---|---|
| Una llave SSH autorizada para el usuario `deploy` | Entrar al servidor | Hoy solo hay dos: la personal de Carlos y la del pipeline (`sellpoint-ci`). Para que otra persona entre, Carlos agrega su llave pública en `/home/deploy/.ssh/authorized_keys` |
| La llave privada de `age` | Descifrar los respaldos | Carlos, en su gestor de contraseñas, fuera del servidor (SEGURIDAD §3). **Sin ella nadie puede leer un respaldo** |
| Acceso a GitHub (`carloshlm/sellpoint`) | Ver y relanzar despliegues | Carlos (cuenta con segundo factor y passkey desde el 2026-09-25; sus códigos de recuperación, guardados por él fuera del repo) |

Con eso, desde tu máquina:

```bash
ssh deploy@216.238.73.144
```

(Es la IP del VPS; `app.sellpointy.com` resuelve a ella porque el DNS de Cloudflare está en gris, sin proxy.)

---

## 1. El mapa: dónde corre qué

Un solo servidor: **VPS de Vultr, High Frequency 2 GB, Ciudad de México**, Ubuntu LTS. Adentro, todo en
Docker Compose, con el usuario `deploy`.

| Ambiente | Dominio | Carpeta en el servidor | Base de datos |
|---|---|---|---|
| Producción | `app.sellpointy.com` | `/opt/sellpoint/` (`docker-compose.prod.yml` y `.env`) | `sellpoint_prod` |
| Sandbox (pruebas) | `sandbox.sellpointy.com` | `/opt/sellpoint-sandbox/` (`docker-compose.sandbox.yml` y `.env`) | `sellpoint_sandbox` |
| Sitio público | `sellpointy.com` y `website-sandbox.sellpointy.com` | `/opt/sites/<dominio>/` (archivos estáticos) | — |

**Contenedores** (`container_name` en cada compose):

| Producción | Sandbox | Qué es |
|---|---|---|
| `sellpoint-nginx-edge` | — (entra por el de producción) | nginx: el único con puertos publicados (80 y 443), TLS y todos los vhosts |
| `sellpoint-web` | `sellpoint-sandbox-web` | La SPA de React, servida por nginx sin privilegios |
| `sellpoint-api` | `sellpoint-sandbox-api` | La API de NestJS |
| `sellpoint-postgres` | `sellpoint-sandbox-postgres` | PostgreSQL 16, solo en la red interna |
| `sellpoint-redis` | `sellpoint-sandbox-redis` | Redis 7: límites, épocas de sesión, cachés |
| `sellpoint-migrate` | `sellpoint-sandbox-migrate` | Corre `prisma migrate deploy` y termina |
| `sellpoint-php-fpm` | — | PHP de los sitios informativos de otros dominios que viven en el mismo VPS |
| `sellpoint-certbot` | — | Renueva los certificados cuando lo llama el cron |

**Lo que corre solo** (crontab del usuario `deploy`; IMPLEMENTACION §13, 2026-08-06 a 2026-08-27):

| Qué | Cuándo | Qué hace si falla |
|---|---|---|
| `/opt/sellpoint/scripts/backup-postgres.sh` | Diario, 09:15 UTC (03:15 en CDMX) | Correo a Carlos que dice en qué paso falló. Log: `/opt/sellpoint/logs/backup.log` |
| `infrastructure/scripts/renew-certs.sh` | Diario, 04:30 UTC | No hace nada hasta ~30 días antes de que venza un certificado |
| `infrastructure/scripts/cert-expiry-check.sh` | Semanal | Correo si un certificado está por vencer |
| Monitores de UptimeRobot (fuera del servidor) | Cada 5 min contra `/api/health` de producción y del sandbox | Correo a `carls.hlm@gmail.com` |

El sandbox **no tiene respaldos**: se recupera volviendo a migrar y sembrar, o restaurándole un respaldo
de producción (§4).

---

## 2. Desplegar

**No hay despliegue a mano.** Se despliega con un push a `main`, y lo hace el pipeline
(`.github/workflows/deploy.yml`):

1. `checks`: lint, tipos, pruebas unitarias, de integración contra RLS real, e2e y build.
2. Imágenes a GHCR: `sellpoint-api`, `sellpoint-web` y `sellpoint-migrate`, etiquetadas con el SHA del commit.
3. Sandbox: migración y prueba de humo. **Si falla, producción no arranca.**
4. Producción: lo mismo, y si la prueba de humo falla se revierte sola (§3).
5. Si el commit lleva un tag `vX.Y.Z`, publica la versión (§8).

Tarda **~18 min** de punta a punta. Para seguirlo desde tu máquina:

```bash
gh run list --workflow deploy.yml --limit 3
gh run watch <id> --exit-status
```

- Un push que **solo cambia `.md`, `.claude/` o `apps/site/`** no despliega la aplicación (`paths-ignore` en `deploy.yml`).
- El sitio público tiene su propio pipeline, `site.yml`, que no toca la aplicación.
- Antes de pushear, las compuertas del CI se corren desde la raíz: `pnpm lint`, `pnpm typecheck:full`, `pnpm test`, `pnpm --filter api test:e2e` (si cambió el API, una migración o algo de `packages/shared`) y `pnpm build` (CONTRIBUTING.md).
- Un despliegue que falló por algo pasajero se relanza con `gh run rerun <id>`, o desde la pestaña Actions (`workflow_dispatch`).

**Qué hace en el servidor** (`infrastructure/scripts/deploy-remote.sh`, que viaja por `scp` y corre con
`ssh -n`, nunca como heredoc; ver §6.2):

1. Borra imágenes viejas: conserva las **4 más nuevas** de cada repo, y aborta si quedan menos de 3000 MB libres.
2. Guarda el `IMAGE_TAG` que estaba corriendo y escribe el nuevo en el `.env`.
3. Baja las imágenes (3 intentos) y **después** migra (3 intentos): así la base no queda adelantada si el pull falla.
4. `docker compose up -d --remove-orphans`.
5. En producción, valida y recarga nginx (`nginx -t` antes; si falla, sigue sirviendo la configuración vieja).
6. Prueba de humo: 30 intentos cada 5 s contra `https://<dominio>/api/health`. Si falla, revierte.

---

## 3. Volver atrás

### 3.1 Automático

Si `up -d` o la prueba de humo fallan, `deploy-remote.sh` regresa solo al `IMAGE_TAG` anterior, levanta de
nuevo y verifica `/api/health` (`rollback_and_exit`). Se ensayó el 2026-08-27 con un fallo provocado
(F6-DRILL-02). El run queda en rojo, pero el servicio sigue respondiendo con la versión anterior.

### 3.2 A mano

Es lo mismo que hace el script, escrito para una persona. Sirve cuando la versión nueva pasó la prueba de
humo pero tiene un error de negocio.

```bash
ssh deploy@216.238.73.144
cd /opt/sellpoint
grep '^IMAGE_TAG=' .env                    # la versión que corre hoy
docker images ghcr.io/carloshlm/sellpoint-api --format '{{.Tag}}  {{.CreatedAt}}'   # las que hay en disco
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha-anterior>/" .env
docker compose -f docker-compose.prod.yml up -d
curl -fsS --resolve app.sellpointy.com:443:127.0.0.1 https://app.sellpointy.com/api/health
```

La respuesta de `/api/health` trae `version` y `build`: confirma que es la que querías.

**Límites que tienes que conocer:**

- **La base no vuelve atrás.** Las migraciones ya aplicadas se quedan. Una versión anterior tiene que convivir con el esquema nuevo: casi siempre funciona porque las migraciones agregan (columnas, tablas), pero una que renombra datos los deja renombrados. Ejemplo: F10-MANFIX-22 renombró los roles de fábrica, y volver atrás el código deja los nombres nuevos, y está bien así.
- **Mientras más atrás, más riesgo.** El servidor conserva solo las últimas 4 imágenes de cada repo, y GHCR, las 20 más nuevas con etiqueta (nunca borra una de menos de 48 h). Volver una semana atrás significa correr código que no conoce una semana de migraciones: no lo hagas sin revisar qué migraciones entraron desde entonces (`apps/api/prisma/migrations/`).
- Si la imagen no está en disco, `up -d` intenta bajarla de GHCR con el token de solo lectura del servidor.
- Después de volver atrás a mano, el siguiente push a `main` despliega de nuevo lo más reciente: corrige el error antes de pushear.

### 3.3 El sitio público

```bash
ssh deploy@216.238.73.144
SITE_ROOT=/opt/sites/sellpointy.com bash /opt/sellpoint/scripts/site-deploy-remote.sh --rollback
```

Para el sitio de ensayo, `SITE_ROOT=/opt/sites/website-sandbox.sellpointy.com`. Mueve el enlace `public` a la versión anterior de `releases/`. Se conservan 3 y
solo vuelve una: para ir más atrás, publica una versión nueva. El pipeline lo hace solo si su despliegue
falla (`site.yml`, `if: failure()`).

---

## 4. Restaurar la base desde un respaldo

Es el procedimiento del encabezado de `infrastructure/scripts/backup-postgres.sh`, ensayado el
2026-08-27 contra el sandbox (F6-DRILL-01) y verificado con el cifrado ese mismo día (F6-BACKUPS-02).

**Lo que hay en el respaldo:** cada noche, un `pg_dump` completo de `sellpoint_prod`, cifrado con `age`
antes de salir del servidor, en Cloudflare R2 (`r2:sellpoint-backups`), con 14 días de historia. Los
nombres son `sellpoint-AAAAMMDD-HHMM.dump.age`. Además, los dos `.env` cifrados en `env/`.

**Tiempos medidos:** la restauración tardó **19 s de máquina** con una base de 388 KB (no se ha vuelto a
medir); se pierde lo escrito desde el último respaldo, **hasta 24 h** (RPO).

**⚠️ `--clean` deja la base destino como espejo del respaldo: todo lo que tenía se pierde.** Si vas a
restaurar encima de producción, primero respalda lo que hay (paso 0).

### Paso a paso

Todo en el servidor, como `deploy`. El ejemplo restaura **producción**; para el sandbox, cambia
`sellpoint-api` → `sellpoint-sandbox-api`, `sellpoint-postgres` → `sellpoint-sandbox-postgres` y
`sellpoint_prod` → `sellpoint_sandbox`.

```bash
ssh deploy@216.238.73.144

# 0. Solo si restauras encima de producción: respaldar el estado actual primero
bash /opt/sellpoint/scripts/backup-postgres.sh

# 1. Elegir y bajar el respaldo
RCLONE_CONFIG=~/.config/rclone/rclone.conf /home/deploy/bin/rclone lsl r2:sellpoint-backups --max-depth 1
mkdir -p /tmp/restore
RCLONE_CONFIG=~/.config/rclone/rclone.conf \
  /home/deploy/bin/rclone copy r2:sellpoint-backups/<dump>.age /tmp/restore/

# 2. Parar la API: nadie escribe durante la restauración
docker stop sellpoint-api

# 3. Descifrar. La llave privada entra en un archivo temporal y sale al final
install -m 600 /dev/null /tmp/restore/age.key       # archivo vacío, legible solo por deploy
nano /tmp/restore/age.key                           # pega la llave privada (AGE-SECRET-KEY-…) y guarda
/home/deploy/bin/age -d -i /tmp/restore/age.key < /tmp/restore/<dump>.age > /tmp/restore/<dump>

# 4. Restaurar por stdin, conservando los dueños (los roles existen en ambos clusters;
#    sus contraseñas no viajan en el respaldo)
docker exec -i sellpoint-postgres pg_restore -U sellpoint \
  -d sellpoint_prod --clean --if-exists < /tmp/restore/<dump>

# 5. Levantar la API y esperar a que esté sana
docker start sellpoint-api
curl -fsS --resolve app.sellpointy.com:443:127.0.0.1 https://app.sellpointy.com/api/health

# 6. Borrar la llave y el respaldo descifrado
rm -f /tmp/restore/age.key /tmp/restore/<dump>
```

**Cómo saber que salió bien:** en el ensayo, la prueba fue entrar a `sandbox.sellpointy.com` con
credenciales de **producción** y ver una venta real (VTA-000022) servida desde la base restaurada.
Haz lo equivalente: entra y abre una venta o un producto que sepas que existía a la hora del respaldo.

**Consejo:** si hay tiempo, restaura primero en el **sandbox** y verifica ahí. Es exactamente lo que se
ensayó, y no toca producción. El costo es que el sandbox queda como copia de producción.

**Si el respaldo no tiene `.age`:** si falta la llave pública (`/opt/sellpoint/age-recipient.txt`), el
respaldo sube sin cifrar y manda un correo avisando. En ese caso sáltate el paso 3.

### Recuperar un `.env`

⚠️ **no ensayado.** Los `.env` de los dos ambientes viajan cada noche a
`r2:sellpoint-backups/env/sellpoint.env.age` y `env/sellpoint-sandbox.env.age` (solo la última versión).
Se bajan con el mismo `rclone copy` y se descifran con el mismo `age -d`. El archivo real lleva permisos
600 y dueño `deploy`.

---

## 5. Mirar qué está pasando

Todo en el servidor, desde `/opt/sellpoint` (o `/opt/sellpoint-sandbox`).

| Para | Comando |
|---|---|
| ¿Está viva la app y qué versión corre? | `curl -fsS --resolve app.sellpointy.com:443:127.0.0.1 https://app.sellpointy.com/api/health` → `status`, `db`, `redis`, `version`, `build` |
| Estado de los contenedores | `docker compose -f docker-compose.prod.yml ps` |
| Logs de un servicio | `docker logs --tail 200 -f sellpoint-api` (o `sellpoint-nginx-edge`, `sellpoint-postgres`…) |
| Logs de los respaldos | `tail -n 50 /opt/sellpoint/logs/backup.log` |
| Disco | `df -h /` y `docker system df` |
| La base (como administrador) | `docker exec -it sellpoint-postgres psql -U sellpoint -d sellpoint_prod` |
| Redis | `docker exec -it sellpoint-redis redis-cli` |

- **Los logs viven en Docker**, no en archivos del host: cada contenedor rota a 10 MB × 3 archivos. No hay logs centralizados.
- **Ojo con `psql -U sellpoint`:** es el superusuario y **se salta el RLS**, así que ves las filas de todos los negocios. La app se conecta como `sellpoint_app`, que sí está sujeto al RLS. Consulta con cuidado y no escribas a mano: para borrar un negocio de pruebas hay un procedimiento (§8).
- nginx no guarda en sus logs lo que va después de `?` en la URL (ahí viajan tokens).

---

## 6. Problemas conocidos

Los cuatro primeros son incidentes reales de producción, con su fecha. Si ves el síntoma, empieza por aquí.

### 6.1 Disco lleno (2026-08-18)

- **Síntoma:** el despliegue muere en su primer paso con `sed: couldn't flush: No space left on device`.
- **Causa:** `docker image prune -f` sin `-a` solo borraba imágenes sin etiqueta, y todas llevan su SHA: durante meses liberó 0 bytes. Además, la limpieza corría al final y solo si el despliegue salía bien.
- **Arreglo que quedó:** la limpieza va al principio de `deploy-remote.sh`, acotada a los tres repos de GHCR (conserva 4 por repo), y el script aborta si quedan menos de 3000 MB.
- **Si vuelve a pasar:** `docker system df` para ver qué ocupa. **Nunca un `docker image prune -af` sin acotar:** se lleva `certbot/certbot`, que no tiene contenedor vivo (pasó el 2026-08-21). (F6-DISK-RETENTION; IMPLEMENTACION §13, 2026-08-18 y 2026-08-21)

### 6.2 Un despliegue en verde que no desplegó nada (2026-08-06)

- **Síntoma:** el run de GitHub sale verde, pero los contenedores tienen el mismo `StartedAt` de antes.
- **Causa:** el script remoto viajaba como heredoc por SSH, y `docker compose run --rm migrate` leía el mismo stdin: se tragó el resto del script, y bash terminó con `exit 0` justo después de migrar.
- **Arreglo que quedó:** `< /dev/null` en cada `docker compose run`, `ssh -n`, y **los scripts remotos viajan como archivo (`scp`), nunca como heredoc**. Si escribes un paso nuevo en el pipeline, respeta esa regla. (`deploy.yml`, comentario inicial; IMPLEMENTACION §13, 2026-08-06)

### 6.3 Producción le habló a la base del sandbox (2026-08-27)

- **Síntoma:** tres «olvidé mi contraseña» de producción terminaron en la base del **sandbox**.
- **Causa:** Docker registra el nombre del servicio como DNS en **todas** las redes del contenedor. El sandbox tenía un servicio llamado `api` y compartía red con el nginx de producción, así que `api` quedó ambiguo y nginx lo resolvió hacia el sandbox.
- **Arreglo que quedó:** los servicios del sandbox se llaman `sandbox-web` y `sandbox-api`, y el vhost del sandbox resuelve su upstream en cada petición (con el sandbox caído, solo ese vhost da 502). **Regla:** ningún servicio de otro stack conectado a la red del edge puede llamarse como uno de producción. (`docker-compose.sandbox.yml` y `nginx/conf.d/sandbox.sellpointy.com.conf`, comentarios)

### 6.4 Un pull que falla con «lease does not exist» (2026-08-26 a 2026-08-28)

- **Síntoma:** el despliegue falla bajando imágenes o migrando, con `failed commit on ref` o `lease does not exist`.
- **Causa:** los despliegues de producción y del sandbox bajaban la misma imagen al mismo tiempo sobre el mismo daemon de Docker, y containerd perdía la carrera.
- **Arreglo que quedó:** el pull y la migración tienen 3 intentos cada 15 s; el segundo encuentra la capa que el otro ya bajó (`prisma migrate deploy` es idempotente). Desde el pipeline único (2026-09-10) el sandbox termina antes de que empiece producción, así que la carrera ya no debería darse; los reintentos se quedan. **Si lo ves:** relanza el run. (`deploy-remote.sh`, comentarios del pull y de la migración)

### 6.5 Otros que conviene reconocer

| Síntoma | Causa | Qué hacer | Fuente |
|---|---|---|---|
| La API nueva queda reiniciándose en bucle después de un despliegue | Falló su healthcheck y el script moría antes de revertir | Ya corregido: todo fallo después de escribir el tag revierte. Si lo ves, rollback a mano (§3.2) | `deploy-remote.sh`, incidente 2026-08-07 |
| Postgres se reinicia 1–3 s en cada despliegue | Leía el `.env` entero y el `IMAGE_TAG` nuevo lo recreaba | Ya corregido: postgres recibe solo sus tres variables. No le pongas `env_file` | `deploy-remote.sh`, incidente 2026-09-08 |
| Sentry no recibe errores del navegador | La CSP de nginx bloqueaba el envío (así estuvo hasta el 2026-09-14) | El CI cruza la CSP con el DSN; si cambias uno, revisa el otro | `infra/scripts/csp-sentry.test.sh`; IMPLEMENTACION §13, 2026-09-14 |
| Correo «el respaldo falló en el paso X» | Lo dice el paso: R2, `pg_dump`, cifrado… | Revisa `/opt/sellpoint/logs/backup.log` y corre el respaldo a mano cuando esté arreglado | `backup-postgres.sh` (`trap ERR`) |
| `nginx -t` falla en un despliegue | Un error en un vhost | El despliegue no recarga nginx y sigue sirviendo la configuración vieja: corrige el vhost y vuelve a pushear | `deploy-remote.sh` |

**En desarrollo, no en producción:** toda la suite del API en rojo con un error de Prisma al arrancar
significa que Docker (Colima) está apagado; mensajes con claves de i18n crudas en el servidor local
después de `pnpm --filter api build` se arreglan reiniciándolo; y una columna nueva que «no existe» en el
navegador con las pruebas en verde significa que falta migrar `sellpoint_dev` (§8).

---

## 7. Levantar un ambiente nuevo

Es el orden en que se levantó producción (F0-DEPLOY-00 a 13, agosto de 2026) y luego el sandbox. Los
guiones están en `infrastructure/scripts/`.

1. **Servidor base.** `bootstrap.sh`, como `root`, una sola vez: crea `deploy` sin contraseña, instala las llaves autorizadas, cierra SSH (sin `root`, solo llave pública; valida con `sshd -t` antes de recargar), `ufw` solo con 22, 80 y 443, `fail2ban` para SSH, swap de 2 GB, Docker, y `/opt/sellpoint` a nombre de `deploy`. ⚠️ El guion instala tres llaves; hoy el servidor tiene dos (la de Carlos y `sellpoint-ci`): revisa la lista antes de correrlo.
2. **DNS** del dominio hacia la IP, en Cloudflare, en gris.
3. **`.env` en el servidor**, nunca por el chat ni por git: se escribe ahí, con permisos 600 y dueño `deploy`. `infrastructure/env.prod.example` dice qué variables lleva y con qué formato. Las llaves del JWT se generan **en el servidor** (`openssl`) y entran como `JWT_PRIVATE_KEY_BASE64` y `JWT_PUBLIC_KEY_BASE64`; un ambiente nuevo genera las suyas, nunca copia las de otro.
4. **nginx solo HTTP** primero (el vhost de `infrastructure/nginx/bootstrap/`).
5. **TLS:** `tls-bootstrap.sh <dominio>` corre **desde tu máquina** contra el servidor: instala el vhost HTTP, pide el certificado con `--dry-run` primero (Let's Encrypt limita a 5 duplicados por semana) y luego el real. El vhost con TLS se commitea al repo **después** de tener el certificado.
6. **Primer despliegue** por el pipeline. La migración `app_db_user` crea el rol `sellpoint_app` **sin contraseña**; después hay que dársela y escribir la misma en el `.env`:

   ```bash
   docker exec sellpoint-sandbox-postgres psql -U sellpoint -d sellpoint_sandbox \
     -c "ALTER ROLE sellpoint_app WITH LOGIN PASSWORD '<SELLPOINT_APP_PASSWORD>'"
   ```

   (Ese es el del sandbox; en producción, `sellpoint-postgres` y `sellpoint_prod`.) Si el rol no puede entrar, la API no arranca, y hace bien: tampoco arranca si alguien le pone un rol que se salte el RLS.
7. **Imágenes:** el servidor necesita un `docker login ghcr.io` con un token de solo lectura.
8. **Crons** del usuario `deploy` (§1): respaldo, renovación de certificados y aviso de vencimiento.
9. **UptimeRobot:** un monitor HTTP a `https://<dominio>/api/health`.

(Fuentes: `bootstrap.sh`, `tls-bootstrap.sh`, `infrastructure/env.prod.example`, IMPLEMENTACION §F0-DEPLOY.)

---

## 8. Tareas de rutina

| Tarea | Cómo | Fuente |
|---|---|---|
| Publicar una versión con número | `pnpm release:dry`, luego `pnpm release` y `git push --follow-tags origin main`. Sin `--follow-tags` el tag no viaja. Con producción en verde, el pipeline etiqueta las imágenes con `:X.Y.Z` y publica la Release | README, «Releases» |
| Rotar las llaves del JWT | Generar un par nuevo en el servidor (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` y extraer la pública), reemplazar las dos `*_BASE64` en el `.env` del ambiente y recrear la API. **Todas las sesiones se cierran**: hazlo en horario valle | IMPLEMENTACION §13, 2026-08-27 |
| Borrar un negocio de pruebas | Con la skill `.claude/skills/sellpoint-delete-tenant/`. Primero se confirma en qué base, luego se clasifica: sin pagos reales se purga con `purge-tenants-by-name.sql` (ensayo antes de borrar, y respaldo antes en producción); **un cliente con pagos no se borra**, se desactiva, y la base impide purgarlo antes de 10 años en México y 7 en Canadá y Estados Unidos. Nunca un `DELETE` a mano | La skill; SEGURIDAD §2.9 |
| Migrar la base de desarrollo | `pnpm test` migra solo `sellpoint_test`. La del servidor local va aparte: `cd apps/api && DATABASE_URL="postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_dev" pnpm exec prisma migrate deploy` | ARQUITECTURA §9 |
| Antes de un cambio grande de infraestructura | ⚠️ Hoy solo existe el respaldo de la base (§4). El snapshot de la máquina en Vultr está pospuesto (F6-DR-01) | IMPLEMENTACION, F6-DR-01 |

---

## 9. Cuentas y accesos

Ningún valor secreto vive en este documento ni en el repo: aquí solo dice **dónde** está cada cosa.

| Servicio | Para qué | Dónde vive la credencial | Quién |
|---|---|---|---|
| GitHub `carloshlm/sellpoint` | Código, pipeline, GHCR | Cuenta de Carlos, con segundo factor y passkey | Carlos |
| GitHub Actions | Desplegar | Secrets `DEPLOY_SSH_KEY` (la privada de `sellpoint-ci`), `DEPLOY_HOST`, `DEPLOY_USER`; GHCR con `GITHUB_TOKEN` | El repo |
| GHCR desde el servidor | Bajar imágenes | Token de GitHub de solo lectura, con `docker login` en el servidor (2026-08-06). ⚠️ Su vencimiento no consta en el repo: revísalo en GitHub | Carlos |
| Servidor (SSH) | Operar | `/home/deploy/.ssh/authorized_keys`: la llave personal de Carlos y `sellpoint-ci` | Carlos |
| `/opt/sellpoint/.env` y `/opt/sellpoint-sandbox/.env` | Secretos de cada ambiente | En el servidor (600, `deploy`), con copia cifrada en R2 (§4) | Carlos |
| Llave privada de `age` | Descifrar respaldos | Gestor de contraseñas de Carlos; la pública, en `/opt/sellpoint/age-recipient.txt` | Carlos |
| Vultr | El VPS | Panel de Vultr (alertas de ancho de banda, caídas y facturas por correo) | Carlos |
| Cloudflare | DNS y R2 | Panel de Cloudflare; el token de R2 solo ve el bucket `sellpoint-backups` (por eso `rclone lsd r2:` da 403 y `rclone lsd r2:sellpoint-backups` funciona) | Carlos |
| Resend | Correo transaccional y alertas | `RESEND_API_KEY` en el `.env`; dominio `sellpointy.com` con SPF y DKIM, DMARC en `p=none` | Carlos |
| Sentry | Errores | `SENTRY_DSN` en el `.env` (API) y `VITE_SENTRY_DSN` horneado en el build (web) | Carlos |
| UptimeRobot | Monitores | Cuenta de Carlos; avisa a `carls.hlm@gmail.com` | Carlos |
| Registrador de `sellpointy.com` | El dominio | ⚠️ **Por confirmar**: no consta en el repo | Carlos |
| Backoffice de la plataforma | Operar cobros y negocios | La marca en la base más el correo en `BILLING_ADMIN_EMAILS` (SEGURIDAD §2.3) | Carlos |

**Correos de contacto:** alertas a `carls.hlm@gmail.com`; privacidad, `privacy@sellpointy.com`.

---

## 10. Si trabajas con el asistente (Claude)

- **Un push bloqueado por el clasificador del modo automático lo hace Carlos.** El asistente no debe buscar otra ruta para empujar.
- Para entrar al servidor, el asistente usa la forma literal `ssh deploy@216.238.73.144 …`, no el alias de `~/.ssh/config`: sus permisos están atados a esa cadena.
- Tiene dos usuarios de prueba en la app: uno normal en producción y uno **administrador de plataforma** en el sandbox. El backoffice se prueba en el sandbox, no en producción. Sus contraseñas viven fuera del repo, en la carpeta de credenciales de Carlos.

---

## 11. Lo que este documento todavía no cubre

- **La máquina no tiene respaldo:** los auto-backups de Vultr y la revisión del cifrado del disco están pospuestos por Carlos (F6-DR-01, 2026-09-25). Si se pierde el VPS, hay que levantar uno nuevo (§7) y restaurar la base (§4).
- **Todo depende de una persona:** sin la llave de `age` y una llave SSH autorizada, que hoy solo tiene Carlos, nadie puede restaurar. Que otra persona pueda hacerlo exige que Carlos le entregue ambas.
- Los pasos marcados **⚠️** no se han ensayado o tienen un dato por confirmar: la recuperación de un `.env`, el vencimiento del token de GHCR, el registrador del dominio y la lista de llaves que instala `bootstrap.sh`.
- El RTO se midió con una base de 388 KB; hay que volver a medirlo cuando crezca (F6-DRILL-01).

---

## 12. Cómo se mantiene

- Quien cambie un procedimiento (el pipeline, un script de `infrastructure/`, un cron, una cuenta) corrige su sección **en el mismo commit**, y la fecha de «Revisado».
- Un incidente nuevo de producción entra a §6 con fecha, síntoma, causa y arreglo.
- Un paso **⚠️ no ensayado** pierde la marca cuando se ensaya, con la fecha del ensayo.
