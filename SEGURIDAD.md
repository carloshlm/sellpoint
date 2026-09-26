# Seguridad de SellPointy

Estas son las medidas con las que SellPointy cuida la información de los negocios que lo usan y los
datos personales que esos negocios capturan. **La regla de este documento:** solo aparece lo que ya
existe y se puede comprobar en el código, en la infraestructura o en la bitácora del proyecto, y cada
afirmación lleva su fuente. Lo que todavía no existe está en la
[sección 5](#5-lo-que-no-hay-todavía), también por escrito.

| | |
|---|---|
| **Revisado** | 2026-09-25 |
| **Responsable** | Carlos Hernandez Hernandez, persona física que opera SellPointy (Aviso de privacidad, P1) |
| **Preguntas de privacidad** | privacy@sellpointy.com |
| **Leyes que piden demostrar las medidas** | México: LFPDPPP · Canadá: PIPEDA · Estados Unidos: leyes estatales |

**Cómo leer las fuentes.** Van entre paréntesis o en la columna «Dónde está». Estas son las abreviaturas:

| Abreviatura | Significa |
|---|---|
| `api/` · `mig/` | `apps/api/src/` · `apps/api/prisma/migrations/` |
| `infra/` · `wf/` | `infrastructure/` · `.github/workflows/` |
| Bitácora AAAA-MM-DD | La entrada de esa fecha en `IMPLEMENTACION.md` §13 |
| F6-…, F9-…, F10-… | La tarea con ese código en `IMPLEMENTACION.md` |
| Aviso P·, Términos T·, Anexo A· | La cláusula en `SITIO-WEB-LEGAL.md`, el texto publicado en sellpointy.com |

---

## 1. Resumen

**Qué se protege.** Los datos de cada negocio (productos, ventas, inventario, compras, usuarios) y los
datos personales que el negocio captura de sus clientes, proveedores y empleados. En el módulo de
Consultorio médico, además, datos de salud de pacientes. Todo vive en una base de datos en un servidor
ubicado en la Ciudad de México (Aviso P5).

| Si alguien pregunta… | La respuesta corta |
|---|---|
| ¿Otro negocio puede ver mis datos? | No. La propia base de datos filtra cada consulta por negocio: aunque la aplicación tuviera un error, la base no entrega filas de otro negocio. |
| ¿Cómo se entra? | Cada persona entra con su propio usuario, un correo verificado y una contraseña de al menos 12 caracteres. La contraseña se guarda de forma irreversible, hay límites de intentos y las sesiones caducan. |
| ¿Quién puede hacer qué? | Lo decide el dueño del negocio con roles y permisos, y puede limitar a cada persona a ciertas sucursales. |
| ¿La información viaja protegida? | Sí, siempre por HTTPS. |
| ¿Y si se pierde el servidor? | Cada noche se hace un respaldo cifrado que se guarda fuera del servidor, con 14 días de historia. La restauración se ensayó el 2026-08-27 y tardó 19 segundos con la base de entonces. |
| ¿Queda rastro de lo que se hace? | Sí. Las acciones importantes quedan en una bitácora: quién, qué, cuándo y desde dónde. |
| ¿Quién administra el servidor? | Solo Carlos. Se entra con llave SSH, sin contraseñas y sin acceso de administrador (`root`). |

**Lo que todavía no hay** (el detalle está en §5): no está verificado que el disco del servidor esté
cifrado, no hay segundo factor de autenticación, no se registra quién consulta un expediente clínico y
SellPointy no está certificado conforme a la NOM-024-SSA3-2012.

---

## 2. Las medidas, capa por capa

### 2.1 Aislamiento entre negocios

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Seguridad por fila (RLS) con `FORCE` | Cada tabla de negocio lleva `tenant_id` y la política `tenant_isolation`. La base solo devuelve y solo deja escribir filas del negocio abierto; si no hay un negocio abierto, devuelve cero filas. La tienen todas las tablas con `tenant_id` salvo las tres de tokens de acceso (59 de 62 al 2026-09-25) | `mig/20260806171516_enable_rls_tenant_isolation`, `mig/*_f2_enable_rls`, `mig/*_f3_enable_rls` y la migración de cada módulo | 2026-08-06 |
| La aplicación no puede saltarse el RLS | La API se conecta con el rol `sellpoint_app`, que no es superusuario ni tiene `BYPASSRLS`. Las migraciones usan otro rol | `mig/20260806172006_app_db_user`; Bitácora 2026-08-06 | 2026-08-06 |
| Candado al arrancar | Si alguien configura por error un rol que se salta el RLS, la API se niega a arrancar | `api/infrastructure/prisma/prisma.service.ts` (`assertRolNoSaltaRls`) | 2026-08-31 |
| Una sola puerta para abrir un negocio | `withTenantContext` abre el negocio solo durante la transacción y con el negocio del token ya verificado, así que una conexión reutilizada nunca lo hereda | `prisma.service.ts` | 2026-08-06 |
| Excepciones acotadas | (1) Para iniciar sesión se busca el negocio por correo con una función que solo ve dos columnas (`auth_resolve_tenant_by_email`); los tokens de acceso se buscan por su huella. (2) El cobro automático y el backoffice abren las tablas de facturación y de módulos, nunca las de ventas o inventario (`billing_admin_bypass`). (3) Los catálogos globales, sin dueño, no llevan RLS (monedas, unidades, permisos, planes, CIE-10, códigos de barras) | `mig/20260807033400_auth_login_gateway`, `withBillingAdminContext` en `prisma.service.ts`, `apps/api/prisma/schema.prisma` | 2026-08-06 · 2026-08-27 |
| Probado en cada despliegue | Las pruebas de integración corren como `sellpoint_app` contra el RLS real | `wf/checks.yml`; `api/infrastructure/prisma/*-rls.integration.spec.ts` | 2026-08-12 |

### 2.2 Acceso: quién eres

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Contraseñas | Se guardan con argon2id (19 MiB, 2 pasadas) y exigen 12 caracteres como mínimo, sin reglas de composición (criterio NIST). Nunca se guardan ni se registran en claro | `api/infrastructure/crypto/argon2.hasher.ts`, `api/modules/auth/dto/register-tenant.dto.ts`; Bitácora 2026-08-12 | 2026-08-12 |
| Correo verificado | Nadie entra sin verificar su correo. El enlace de verificación dura 24 h y el de nueva contraseña, 30 min y un solo uso. En ambos casos es un token aleatorio de 256 bits del que solo se guarda su huella SHA-256 | `api/modules/auth/auth.service.ts`, `…/services/one-time-token.service.ts` | 2026-08-12 |
| Token de acceso | JWT firmado con RS256 que vive 15 min. El algoritmo está fijo: no acepta `none` ni HS256. Las llaves se generan en el servidor, entran por variable de entorno (`JWT_*_BASE64`) y nunca están en git. La rotación está documentada | `…/services/token.service.ts`, `api/config/env.schema.ts`, `infra/env.prod.example`; Bitácora 2026-08-27 (F6-SECRETS-01) | 2026-08-12 |
| Sesión (refresh) | Vive en una cookie `httpOnly`, `Secure` y `SameSite=Strict`, válida solo en el dominio de la app y en `/api/auth`. Dura 7 días, se renueva con el uso y tiene un tope de 30. Cada uso la rota, y si alguien reusa una ya rotada se revoca la sesión entera | `…/cookie/refresh-cookie.ts`, `…/services/refresh-token.service.ts` | 2026-08-12 |
| Revocación inmediata | Suspender a un usuario, cambiar un rol o cambiar la contraseña invalida en el acto los tokens vivos (una época por usuario y por negocio en Redis). Restablecer la contraseña cierra todas las sesiones y cambiarla cierra las demás. Un negocio desactivado no puede entrar ni renovar la sesión | `…/guards/jwt-auth.guard.ts`, `api/infrastructure/redis/perm-epoch.service.ts`, `api/modules/users/users-admin.service.ts`, `auth.service.ts` | 2026-08-12 |
| En el navegador | El token de acceso vive solo en memoria, nunca en `localStorage` | `apps/web/src/stores/auth.store.ts` | 2026-08-14 |
| Sesiones a la vista | En «Mi perfil», cada usuario ve sus sesiones abiertas: desde cuándo existen y hasta cuándo duran | `GET /auth/sessions`, `…/services/session-list.ts` | 2026-08-14 |
| Límites de intentos | En la app: 5 intentos por IP cada 15 min en las rutas de acceso; 10 por hora por correo al entrar, al pedir una contraseña nueva y al reenviar la verificación; 300 peticiones por minuto por IP en toda la API (valores por omisión). En el borde, nginx corta a 30 por minuto, con ráfaga de 10, en `/api/auth/` | `…/guards/auth-email-throttler.guard.ts`, `env.schema.ts`, `infra/nginx/conf.d/02-ratelimit.conf` | 2026-08-12 · 2026-08-27 |
| Sin enumerar cuentas | Entrar, pedir una contraseña nueva y reenviar la verificación responden igual exista o no la cuenta, y al entrar se tarda lo mismo en ambos casos. El registro sí avisa si un correo ya tiene cuenta, dentro del límite por IP | `auth.service.ts`, `auth.controller.ts`; F10-MANFIX-11 | 2026-08-12 · 2026-09-24 |
| Términos aceptados con versión | Nadie crea una cuenta sin aceptar los Términos y el Aviso. Se guarda qué versión aceptó y cuándo, y queda en la bitácora. Si la versión cambia, todos vuelven a aceptar. La vigente es `2026-09-21` | `packages/shared/src/terms.ts`, `api/modules/legal/terms.service.ts`, columnas `users.terms_version` y `terms_accepted_at` | 2026-09-19 |

### 2.3 Autorización: qué puedes hacer

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Cerrado por omisión | Todo endpoint exige un token válido, salvo los marcados `@Public()`. Los controles corren en orden fijo: límite, identidad, permisos y plan | `api/app.module.ts` (`APP_GUARD`) | 2026-08-12 |
| Permisos por catálogo | Cada rol de un negocio tiene permisos del tipo `recurso:acción`. Más de 200 endpoints declaran `@RequirePermissions` y exigen todos los permisos que piden; sin usuario identificado, la respuesta es no | `api/modules/auth/guards/permissions.guard.ts` | 2026-08-12 |
| Sin escalada de privilegios | Nadie puede dar un permiso que no tiene ni asignar un rol con permisos que no tiene. El último administrador activo no se puede quitar (responde 409) | `api/modules/roles/roles.service.ts`, `…/role-assignment-guard.ts`, `…/tenant-admin-guard.ts`; Bitácora 2026-08-12 | 2026-08-12 |
| Roles de fábrica con llave fija | Administrador, Encargado, Cajero y Consulta llevan una clave inmutable (`system_key`) que sobrevive a un cambio de nombre | `mig/20261001120000_f10_manfix_role_system_key`; F10-MANFIX-22 | 2026-09-24 |
| Alcance por sucursal | Un usuario con almacenes asignados solo opera en ellos; el administrador los ve todos | `api/infrastructure/warehouse-scope/`, tabla `user_warehouse_scopes` con RLS (`mig/20260813211500_f1_scope_enable_rls`) | 2026-08-13 |
| Plan y módulos | Lo que el plan no incluye no se puede crear (responde 402). Un módulo especializado apagado no responde ni siquiera para leer | `api/modules/billing/guards/subscription.guard.ts` (`@RequiresFeature`, `@RequiresModule`) | 2026-08-27 · 2026-09-02 |
| Backoffice del operador | Pide cuatro llaves a la vez: una marca en la base, el correo en la lista `BILLING_ADMIN_EMAILS`, un usuario activo y un correo verificado. La marca no viaja en el token, así que revocarla es inmediato, y con la lista vacía nadie entra. Desde ahí se ven los usuarios, los tableros y los reportes de cualquier negocio; no hay pantallas clínicas. Las acciones del backoffice quedan en la bitácora; sus consultas, no | `api/modules/billing/guards/platform-admin.guard.ts`, `api/modules/admin/admin-tenants.controller.ts`; Bitácora 2026-08-28 | 2026-08-28 |

### 2.4 Bitácora de auditoría

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| La tabla | `audit_logs` guarda quién hizo qué acción, sobre qué y cuándo, el antes y el después, la IP y el navegador. Tiene RLS, así que cada negocio solo tiene la suya | `api/modules/audit/audit.service.ts`, `mig/20260806171429_audit_log` | 2026-08-06 |
| Qué se registra | Más de cien acciones: entrar (con éxito o no), salir, cambios y restablecimientos de contraseña, reuso de sesión y verificación de correo; usuarios, roles y alcances; la configuración del negocio; catálogos, productos, servicios y almacenes; movimientos de inventario, compras y gastos; cobros, planes y módulos del backoffice; el Consultorio; y la aceptación de los términos | `rg 'action: "' apps/api/src` (2026-09-25) | 2026-08-12, y crece con cada módulo |
| Lo que no se registra | Un intento con un correo que no existe (no hay negocio donde anotarlo) va solo al log de la aplicación. Las **lecturas** no se registran: nadie anota quién abrió un expediente, un reporte o una pantalla del backoffice (§5) | `audit.service.ts` (docblock) | — |
| Inventario inalterable | Los movimientos de inventario no se pueden editar ni borrar, porque la base se lo prohíbe a la aplicación. Un documento confirmado tampoco se toca: se corrige con otro movimiento | `mig/20260818150000_f3_enable_rls` (`REVOKE UPDATE, DELETE`), `mig/20260818041500_f3_document_immutability` (trigger) | 2026-08-18 |

### 2.5 En tránsito y en el borde

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| HTTPS obligatorio | HTTP redirige a HTTPS con TLS 1.2 o 1.3. Los certificados son de Let's Encrypt, se renuevan por cron y llega un aviso por correo si alguno está por vencer | `infra/nginx/conf.d/app.sellpointy.com.conf`, `infra/nginx/snippets/ssl-params.inc`, `infra/scripts/renew-certs.sh`, `…/cert-expiry-check.sh` | 2026-08-06 |
| Cabeceras de seguridad | HSTS de un año (sin `preload`, a propósito), `nosniff`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` (la cámara solo para el escáner; micrófono, ubicación, pagos y USB apagados). La CSP solo permite el propio origen y el envío de errores a Sentry. La API suma Helmet | `infra/nginx/snippets/security-headers.inc`, el vhost de la app, `api/main.ts`; prueba `infra/scripts/csp-sentry.test.sh` | 2026-08-06 · 2026-08-27 |
| CORS | Solo los orígenes de la app hablan con la API usando credenciales. El sitio público usa dos rutas sin cookies | `api/main.ts`, `api/common/http/cors.ts`, `infra/env.prod.example` | 2026-08-06 |
| Logs sin secretos | nginx no guarda lo que va después de `?` en la URL ni el Referer con tokens. La API censura `authorization`, las cookies, las contraseñas y el Referer | `infra/nginx/conf.d/01-noquery-log.conf`, `api/app.module.ts` (`redact`) | 2026-08-14 |
| Correo autenticado | Los correos salen de `sellpointy.com` con SPF y DKIM. DMARC está en modo de solo observar (`p=none`) | F11-SITE-INFRA-05 | 2026-09-19 |
| Sin proxy delante | La app usa el DNS de Cloudflare en gris: nginx es la única capa y no hay WAF (§5) | Comentario del vhost de la app; Pospuestos de la Fase 6 | — |

### 2.6 En reposo

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Dónde viven los datos | En una base Postgres dentro de un servidor (VPS) de Vultr en la Ciudad de México, incluidas las imágenes (logotipos). Redis solo guarda datos de control: límites de intentos, épocas de sesión y cachés | Aviso P5; Bitácora 2026-08-04; `schema.prisma` (`logo_png`) | 2026-08-06 |
| La base no está expuesta | Solo nginx publica puertos (80 y 443). Postgres escucha únicamente en `127.0.0.1` y Redis no publica ninguno | `infra/docker-compose.prod.yml` | 2026-08-06 |
| Lo que se guarda como huella | Las contraseñas y el PIN del punto de venta, con argon2. Los tokens de sesión y los enlaces, con SHA-256 | `argon2.hasher.ts`, `api/modules/tenants/tenant-profile.service.ts`, `one-time-token.service.ts` | 2026-08-12 |
| Secretos | Los `.env` viven solo en el servidor, fuera de git, y su copia viaja cifrada a R2 (§3) | `.gitignore`, `infra/scripts/backup-postgres.sh` | 2026-08-27 |
| Cifrado del disco | **No verificado.** Se revisa en el panel de Vultr, no en el código. Carlos lo pospuso el 2026-09-25 (§5) | F9-CLINIC-NOM024-05, F6-DR-01 | — |

### 2.7 Entrada e integridad

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Validación | Cada cuerpo y cada consulta pasa por un esquema zod (más de 200 usos en los controladores). Los ids de ruta y de consulta tienen que ser UUID antes de tocar la base, y una prueba recorre el router y falla si una ruta nueva lo olvida | `api/common/pipes/zod-validation.pipe.ts`, `api/common/http/uuid-param.decorator.ts`, `apps/api/test/e2e/route-ids.e2e-spec.ts`; F10-MANFIX-17 y 20 | 2026-08-12 · 2026-09-24 |
| SQL parametrizado | Todas las consultas van parametrizadas (Prisma y `$queryRaw` con plantilla); no hay SQL armado con texto | `rg "queryRawUnsafe\|executeRawUnsafe"` sin resultados (2026-09-25) | — |
| Cobro sin duplicados | El punto de venta manda un `Idempotency-Key`, así que reintentar un cobro no cobra dos veces | `api/modules/pos/pos.controller.ts`; Bitácora 2026-08-21 | 2026-08-21 |
| Tamaño máximo | El cuerpo JSON puede pesar hasta 6 MB en la API y 8 MB en nginx | `api/common/http/body-limits.ts`, el vhost de la app | — |

### 2.8 Operación

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| El servidor | SSH solo con llave, sin contraseña y sin `root`. El firewall `ufw` solo abre los puertos 22, 80 y 443, y `fail2ban` vigila SSH. Según el guion de aprovisionamiento hay tres llaves autorizadas: la de Carlos (con frase de paso), una de automatización sin frase de paso en su equipo y la de GitHub Actions | `infra/scripts/bootstrap.sh` | 2026-08-06 |
| Un solo operador | Carlos opera solo: el servidor, la base y las cuentas de los proveedores (Vultr, Cloudflare, Sentry, Resend) son suyas | `bootstrap.sh`; F6-WATCH-01 y 02; Aviso P1 | — |
| Contenedores | La API y la web corren sin `root` y con memoria limitada. Al runtime de la API se le quitó `npm` después de que Trivy encontró una vulnerabilidad | `infra/docker/api.Dockerfile`, `…/web.Dockerfile`, `docker-compose.prod.yml`; Bitácora 2026-08-27 | 2026-08-27 |
| Despliegue | Solo con un push a `main`. Primero corren el lint, la revisión de tipos, las pruebas unitarias y de integración contra RLS real, las e2e y el build; después se construyen las imágenes en GHCR; luego el sandbox corre su migración y una prueba de humo; al final va producción, que se revierte sola si su prueba de humo falla | `wf/deploy.yml`, `wf/checks.yml`, `infra/scripts/deploy-remote.sh`; F6-DRILL-02 | 2026-08-06 (pipeline único: 2026-09-10) |
| Dependencias | Dependabot revisa cada semana. Trivy busca vulnerabilidades críticas en la imagen de la API en cada despliegue, en modo informativo: avisa, pero no frena | `.github/dependabot.yml`, `wf/deploy.yml` | 2026-08-06 · 2026-08-27 |
| Monitoreo | Dos monitores externos revisan la app y el sandbox cada 5 min y avisan por correo. Sentry recibe solo errores: los 5xx de la API y los errores del navegador en `app.sellpointy.com` (estos, de verdad, desde el 2026-09-14; antes los bloqueaba la CSP). No guarda trazas ni graba sesiones, y no tiene filtro propio (`beforeSend`): envía lo que el SDK manda por omisión | F6-WATCH-01; `api/main.ts`, `api/common/filters/all-exceptions.filter.ts`, `apps/web/src/lib/sentry.ts`; Bitácora 2026-09-14 | 2026-08-27 |
| Logs | Rotan a 10 MB × 3 archivos por servicio | `docker-compose.prod.yml` | 2026-08-14 |

### 2.9 Retención y borrado

| Medida | Qué hace | Dónde está | Desde |
|---|---|---|---|
| Desactivar antes de borrar | Un negocio se desactiva con fecha, autor y motivo, y deja de poder entrar. Es reversible | `mig/20260909100000_f7_tenant_lifecycle`, `auth.service.ts` | 2026-09-04 |
| Borrar solo por una puerta | La única forma de borrar un negocio es `purge_tenant()`. Se niega si el negocio está activo, y si es cliente (tiene al menos un pago real) no borra nada antes de 10 años en México ni de 7 en Canadá y Estados Unidos, contados desde la desactivación. El candado vive en la base, así que ni un guion se lo salta | `mig/20260930100000_f7_tenant_retention`; Bitácora 2026-09-21; `.claude/skills/sellpoint-delete-tenant/SKILL.md` | 2026-09-21 |
| Prospectos del sitio | Se borran solos a los 24 meses (Aviso P8) | `api/modules/site/site-leads-retention.job.ts` | 2026-09-18 |
| Lo borrado en los respaldos | Sigue en los respaldos hasta 14 días | `backup-postgres.sh` (`RETENTION_DAYS`) | — |

---

## 3. Respaldos y recuperación

| Aspecto | Cómo funciona |
|---|---|
| Frecuencia | Cada noche a las 03:15 de la Ciudad de México (09:15 UTC), por cron en el servidor |
| Qué se respalda | La base de producción completa (`pg_dump`) y los `.env` de producción y del sandbox |
| Cifrado | Con `age`, antes de salir del servidor. La llave pública está en el servidor y la privada la guarda Carlos fuera de él |
| Destino | Cloudflare R2, en un bucket propio y con un token limitado a ese bucket |
| Historia | 14 días; de los `.env` solo se guarda la última versión |
| Si algo falla | Un respaldo vacío no se sube, y cualquier fallo manda un correo que dice en qué paso ocurrió. Si falta la llave, el respaldo sube sin cifrar y también avisa por correo |

(Fuente: `infra/scripts/backup-postgres.sh`; F6-BACKUPS-01 y 02, F6-SECRETS-01; Bitácora 2026-08-27.)

**Tiempos medidos** en el ensayo de restauración (F6-DRILL-01, Bitácora 2026-08-27):

| Métrica | Valor | Nota |
|---|---|---|
| RTO: cuánto tarda la restauración | 19 s de máquina | Medido con una base de 388 KB; no se ha vuelto a medir |
| RPO: cuántos datos se pueden perder | Hasta 24 h | La edad del último respaldo; en el ensayo fueron 7 h 38 min |

**Cómo se probó.** Se bajó un respaldo real de R2, se descifró y se restauró en el sandbox, que vive
en el mismo servidor y con las mismas medidas. Después se entró con credenciales de producción y se
vio una venta real. Ese día el sandbox quedó como copia de producción. El paso a paso está en el
encabezado de `backup-postgres.sh`. En el ensayo de reversión (F6-DRILL-02, el mismo día) se
provocó un fallo a propósito: el despliegue se revirtió solo y el servicio siguió respondiendo.

**Límites que conviene saber:**

- Todo depende de la llave privada de Carlos: sin ella nadie puede leer los respaldos, ni un atacante ni otra persona del equipo.
- Se respalda la base, no la máquina. Los respaldos automáticos de Vultr están pospuestos (F6-DR-01).
- Todavía no existe un procedimiento formal para que otra persona restaure: es `RUNBOOK.md`, pendiente (F6-DR-02).

---

## 4. Datos de salud (Consultorio médico)

**Estado.** El módulo existe: expediente, historia clínica, notas, recetas y órdenes (F9-CLINIC,
F9-CLINIC-HC y F9-CLINIC-DOC, construidos del 2026-09-03 al 2026-09-09). Está en pausa por la
NOM-024: el 2026-09-21 se decidió que al cliente médico **no se le activa el módulo** hasta que un
abogado diga qué exposición hay por no estar certificado (Bitácora 2026-09-21). Ese cliente sí puede
usar el punto de venta, el inventario y la recepción.

| Qué lo protege hoy | Detalle | Fuente |
|---|---|---|
| Se enciende por negocio | Solo el operador lo activa, desde el backoffice. Apagado, la API no responde ni siquiera para leer | `@RequiresModule("medical_clinic")` en `api/modules/medical-clinic/*.controller.ts`; `subscription.guard.ts` |
| Permisos propios | `medical_clinic:read`, `medical_clinic:attend` y `medical_clinic:manage` | Controladores del módulo |
| Aislamiento | Sus tablas llevan RLS con `FORCE`, igual que las demás | `mig/20260903*_f9_clinic_*` |
| Rastro de los cambios | Crear un expediente, guardar una sección (con el texto de antes y el de después), cerrar el expediente, emitir o cancelar una orden y cambiar la configuración quedan en `audit_logs` | `api/modules/medical-clinic/sections.service.ts`, `records.service.ts`, `medical-orders.service.ts`; F9-CLINIC-DOC-08 (2026-09-09) |
| Lo que dicen los Términos | El Anexo A (A1–A11) forma parte de los Términos v2. El médico es el responsable de los datos y SellPointy, el encargado (A4). A6 dice que SellPointy no está certificado. Según A9, el personal de SellPointy no consulta expedientes salvo que el médico lo pida o una autoridad lo ordene por escrito. A10 obliga a avisar de una vulneración | `SITIO-WEB-LEGAL.md` (A1–A11); F11-SITE-LEGAL-05 |
| Fuera del módulo, no | Los Términos prohíben guardar datos de salud en las notas de una venta o en la ficha de un cliente del punto de venta | Términos T10 |

**Lo que falta** (también en §5): el registro de quién consulta cada expediente (F9-CLINIC-NOM024-04),
la aceptación del Anexo al activar el módulo (F9-CLINIC-NOM024-02), la certificación
(F9-CLINIC-NOM024-01), el cifrado por campo y la verificación del disco. Lo que promete A9 hoy es un
compromiso, no una barrera técnica: quien tiene acceso a la base (solo Carlos) puede leer los
expedientes.

---

## 5. Lo que no hay todavía

**Pendientes con tarea o decisión escrita:**

| Qué falta | Por qué importa | Estado (fuente) |
|---|---|---|
| Verificar el cifrado del disco del servidor | Si alguien se llevara el disco, podría leer los datos | Pospuesto por Carlos el 2026-09-25; se revisa en el panel de Vultr (F9-CLINIC-NOM024-05, F6-DR-01) |
| Respaldo de la máquina (auto-backups de Vultr) | Recuperaría el servidor entero; hoy solo se recuperan los datos | Pospuesto el 2026-09-25 (F6-DR-01) |
| `RUNBOOK.md` | Que otra persona pueda restaurar y operar sin Carlos | Pendiente (F6-DR-02) |
| Registro de consultas de expedientes | Ante una fuga de datos de salud no se podría saber quién vio qué | F9-CLINIC-NOM024-04 |
| Certificación NOM-024-SSA3-2012 | La norma prevé que el sistema de expediente clínico electrónico esté certificado | F9-CLINIC-NOM024-01; el piso realista es de 9 a 12 meses |
| Aceptación del Anexo A al activar el módulo | Sería una prueba más sólida de quién aceptó, cuándo y qué versión | F9-CLINIC-NOM024-02 |
| RLS en las tablas puente de roles | `user_roles` y `role_permissions` no tienen `tenant_id` ni RLS; solo guardan pares de identificadores | Backlog S3 de f1-rbac (Bitácora 2026-08-12) |
| Proxy de Cloudflare (WAF y origen oculto) | Filtraría ataques antes de que lleguen al servidor | Pospuesto hasta tener más clientes (Pospuestos de la Fase 6) |
| Logs centralizados y gestor de secretos | Hoy los logs se leen por SSH y los secretos viven en `.env` con una copia cifrada | Pospuestos por tamaño (Pospuestos de la Fase 6, F6-SECRETS-01) |
| Un escaneo que frene el despliegue | Trivy solo informa y no hay `pnpm audit` en el CI | Decisión de la Fase 6 (F6-SUPPLY-02) |
| Firmar las imágenes (cosign) | Probaría que la imagen que corre es la que se construyó | Pospuesto (F6-RELEASE) |

**Sin tarea todavía:**

| Qué falta | Por qué importa |
|---|---|
| Segundo factor de autenticación (MFA) | Hoy basta una contraseña robada para entrar |
| Plan escrito de respuesta a incidentes | Los Términos prometen avisar «sin demora injustificada» (T7, A10) y no hay un procedimiento escrito |
| Bitácora inalterable y consultable | El rol de la aplicación puede modificar `audit_logs` (le falta el `REVOKE` que sí tienen los movimientos de inventario), y no hay una pantalla para consultarla: se lee en la base |
| Registro de las lecturas del backoffice | Las consultas del operador a los datos de un negocio no dejan rastro |
| Cifrado por campo | Con acceso a la base (solo Carlos), los datos, incluidos los de salud, se leen en claro |
| Filtro propio en Sentry (`beforeSend`) | Garantizaría que ningún evento de error lleve datos personales |
| DMARC en modo de rechazo | Con `p=none`, un correo que suplante a `sellpointy.com` no se bloquea |
| Documentación de la API cerrada | `/api/docs` (OpenAPI) es pública: no expone datos, pero sí el mapa de rutas (`api/main.ts`) |
| Actualizaciones automáticas del sistema operativo | No consta en el repositorio que estén configuradas |
| Un nuevo ensayo de restauración | El RTO se midió con una base de 388 KB; la propia tarea pide volver a medirlo cuando la base crezca (F6-DRILL-01) |
| Revisión externa | Nadie ajeno al proyecto ha revisado estas medidas (ni auditoría ni prueba de penetración) |

---

## 6. Cómo se mantiene este documento

**Quién:** quien cambie una medida (Carlos, o el asistente que trabaje con él) corrige su fila en el
**mismo commit**. El responsable es Carlos.

**Cuándo se toca:**

- [ ] Al agregar, quitar o cambiar una medida: su fila en §2, con la fuente y la fecha.
- [ ] Al cerrar un pendiente de §5: la fila pasa a §2 (o a §3 o §4) con su fuente.
- [ ] Al publicar una versión nueva de los Términos: revisar §4 y las cláusulas citadas.
- [ ] En cada cambio: actualizar la fecha de «Revisado» al principio.

**Reglas de escritura:** solo lo que se puede comprobar hoy, nunca lo prometido; la fuente entre
paréntesis; la fecha sale de la bitácora o de git, no del nombre de la migración, porque algunas
carpetas llevan fechas adelantadas (por ejemplo, `20261001120000_…` se escribió el 2026-09-24).

**Relación con otros documentos:**

| Documento | Qué aporta |
|---|---|
| [ARQUITECTURA.md](./ARQUITECTURA.md) §3.1 y §5 | El diseño de la seguridad. **Ojo:** §5 conserva partes del diseño original que no describen lo que corre, como los parámetros de Argon2, los respaldos «en S3 con KMS», el cifrado de disco dado por hecho, los límites de tasa, CloudWatch, `pnpm audit` o el MFA. Donde difieran, manda este documento |
| `RUNBOOK.md` | Los procedimientos de operación: restaurar, revertir un despliegue, leer logs. **Todavía no existe** (F6-DR-02) |
| [SITIO-WEB-LEGAL.md](./SITIO-WEB-LEGAL.md) | Lo que SellPointy promete en el Aviso y en los Términos. Este documento muestra con qué se cumple |
| [IMPLEMENTACION.md](./IMPLEMENTACION.md) | Las tareas (F6, F9-CLINIC-NOM024) y la bitácora con fecha de cada decisión |
