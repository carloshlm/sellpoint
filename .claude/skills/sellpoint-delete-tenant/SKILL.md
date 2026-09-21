---
name: sellpoint-delete-tenant
description: >
  Cómo se elimina un negocio (tenant) de SellPointy con todo lo suyo: primero se decide si
  es de PRUEBAS o un CLIENTE REAL. El de pruebas se purga con el guion por nombre; el
  cliente real NO se borra: se desactiva y sus datos se guardan por ley 10 años en México
  y 7 en Canadá y Estados Unidos (la base misma se niega a borrarlo antes).
  Trigger: borrar, eliminar, purgar o limpiar un negocio o tenant, sus usuarios, ventas o
  movimientos; liberar espacio en la base; dar de baja a un cliente.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.1"
---

## When to Use

- Carlos pide borrar uno o varios negocios, «que no quede rastro» o «que no ocupe espacio».
- Un cliente se da de baja y hay que decidir qué pasa con sus datos.
- Alguien propone un `DELETE` a mano sobre tablas con `tenant_id`.

## La regla en una frase

**Antes de borrar se CLASIFICA. Un negocio de pruebas se purga entero; un cliente real se
BLOQUEA (se desactiva) y no se purga hasta que pase su retención legal, contada desde la
desactivación: 10 años en México, 7 en Canadá y 7 en Estados Unidos.** En caso de duda, es
cliente real.

## El código ya lo impone (F7-LIFECYCLE-10)

Esta skill no es el único candado. Para el sistema, **cliente = tiene al menos un pago REAL**
en `subscription_payments` (`status = 'recorded'`, `amount > 0`, `method <> 'courtesy'`), y:

- `purge_tenant()` se NIEGA a borrar a un cliente antes de su plazo. Lo decide
  `tenant_retention_years(uuid)`: `CA` y `US` → 7, cualquier otro país o ninguno → 10,
  `NULL` si no es cliente. Ni el backoffice ni los guiones se lo saltan.
- El backoffice deja «Eliminar negocio» apagado, dice por qué y hasta cuándo, y el API
  responde `409 admin.tenant_under_retention`.
- Los dos guiones de purga lo avisan en el ENSAYO, con nombre y fecha, y abortan.

Lo que el código NO sabe y esta skill sí: un negocio de OTRA persona que nunca pagó (la cuenta
del amigo de Carlos). Para el sistema es borrable a los 30 días; para nosotros es Ruta B.

**Un pago de prueba tiene salida legítima:** se ANULA desde el backoffice (en los pagos del
negocio, botón «Anular»: pide la razón y la deja en la bitácora). El pago anulado no cuenta y el negocio vuelve a ser borrable. Nunca se
borra el pago por SQL ni se toca la función para «destrabar» un negocio.

## De dónde salen los plazos

Decisión de Carlos (2026-09-21): México 10 años, Canadá 7, Estados Unidos 7. Un país que no
esté en la tabla toma 10: equivocarse hacia guardar es barato.

| País | Datos personales | Datos fiscales y comerciales |
|---|---|---|
| México | Bloqueo o eliminación al cumplir la finalidad, salvo plazos legales | 5 años (Código Fiscal) a 10 (Código de Comercio) |
| Canadá | Eliminación al cumplir el propósito | 6 a 7 años (CRA) |
| Estados Unidos | Eliminación a petición (estados como California) | 3 a 7 años (IRS) |

Lo que resuelve la tensión entre las dos columnas es el **bloqueo**: el dato personal deja
de usarse y nadie entra a la cuenta, pero se conserva mientras corre la obligación legal.
Eso es exactamente «desactivar» en SellPointy. La tabla viene de la investigación de Carlos,
no de un abogado: si algún día se confirma otro plazo, se cambia en DOS lugares —
`TENANT_RETENTION_YEARS` en `packages/shared/src/tenant-lifecycle.ts` y una migración nueva
que redefina `tenant_retention_years()`— y `tenant-retention-schema.integration.spec.ts` se
pone en rojo si solo se cambió uno. Después se actualiza esta skill.

Ojo con lo que borra la purga: `subscription_payments` tiene `tenant_id`. Purgar a un
cliente real borra también los pagos que ese cliente le hizo a SellPointy, que son
contabilidad DE CARLOS, no solo del cliente.

## Paso 0 — ¿En qué base?

| Base | Retención | Quién la corre |
|---|---|---|
| `sellpoint_prod` (producción) | SÍ: aquí viven los clientes reales | Carlos. El clasificador le niega el SSH a Claude aunque Carlos lo autorice: se le dan los comandos |
| `sellpoint_sandbox` | No: nunca tiene clientes reales. Tampoco tiene respaldos | Carlos, igual que producción |
| `sellpoint_dev` / `sellpoint_test` (local) | No | Claude, con Colima encendido (`colima start`) |

Si Carlos no dice cuál, se pregunta. Nunca se asume producción ni se asume local.

## Paso 1 — La ficha del negocio

Primero los nombres VIVOS: nunca se copian de un comentario, de la memoria ni de una
conversación vieja (en producción hubo dos «Negocio CUATRO»).

```bash
docker exec sellpoint-postgres psql -U sellpoint -d sellpoint_prod \
  -c "SELECT name, created_at::date FROM tenants ORDER BY created_at"
```

Luego la ficha de cada negocio que se quiere borrar:

```sql
SELECT t.id, t.name, t.country, t.created_at::date AS alta,
  t.suspended_at, t.suspended_reason, s.status AS suscripcion,
  (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS usuarios,
  (SELECT string_agg(u.email, ', ') FROM users u WHERE u.tenant_id = t.id) AS correos,
  (SELECT count(*) FROM sales v WHERE v.tenant_id = t.id) AS ventas,
  (SELECT count(*) FROM subscription_payments p WHERE p.tenant_id = t.id
     AND p.status = 'recorded' AND p.method <> 'courtesy' AND p.amount > 0) AS pagos_reales,
  tenant_retention_years(t.id) AS anios_de_retencion  -- NULL = el sistema no lo ve como cliente
FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
WHERE t.name = 'NOMBRE EXACTO';
```

## Paso 2 — Clasificar

| Situación | Clase |
|---|---|
| Carlos confirma que es SUYO (prueba interna) y `pagos_reales = 0` | **Pruebas** → Ruta A |
| Tiene `pagos_reales > 0` y el pago fue de verdad | **Cliente real** → Ruta B, aunque diga «prueba» en el nombre |
| Tiene `pagos_reales > 0` pero Carlos confirma que ese pago lo registró ÉL como prueba | Se anula el pago en el backoffice y pasa a **Pruebas** → Ruta A |
| Es de OTRA persona, aunque esté en prueba (ej.: «Who Cut the Cheese», del amigo de Carlos) | **Cliente real** → Ruta B |
| `sellpoint_sandbox`, `sellpoint_dev` o `sellpoint_test` | **Pruebas** → Ruta A |
| Cualquier duda | **Cliente real** → Ruta B |

La clase la CONFIRMA Carlos: Claude le enseña la ficha (correos incluidos, para que reconozca
de quién es) y pregunta. Nunca se deduce del nombre del negocio ni de su plan.

## Ruta A — Negocio de pruebas: se purga entero

Se usa `infrastructure/scripts/purge-tenants-by-name.sql`: borra EXACTAMENTE los nombres que
recibe llamando a `purge_tenant(uuid)`, la única definición de «eliminar un negocio» (62
tablas, en una transacción). No se usa `purge-tenants.sql`, que borra por exclusión: un
olvido en su lista borra un negocio vivo.

```bash
# 1. LOCAL — sube el guion
scp infrastructure/scripts/purge-tenants-by-name.sql sellpoint-prod:/tmp/
ssh sellpoint-prod

# 2. RESPALDO. Sin respaldo no se corre (el sandbox no tiene: ahí se omite)
/opt/sellpoint/scripts/backup-postgres.sh

# 3. ENSAYO — no toca nada
docker exec -i sellpoint-postgres psql -U sellpoint -d sellpoint_prod \
  -v ON_ERROR_STOP=1 -v modo=ensayo \
  -v borrar='Negocio A|Negocio B' < /tmp/purge-tenants-by-name.sql

# 4. BORRAR — solo si el ensayo listó exactamente lo esperado
#    (mismo comando con -v modo=borrar)

# 5. Opcional: las claves derivadas en Redis (caducan solas)
docker exec sellpoint-redis redis-cli --scan --pattern 'entitlements:*' \
  | xargs -r docker exec -i sellpoint-redis redis-cli DEL
```

Carlos pega la salida del ensayo y Claude la revisa ANTES del paso 4. El guion aborta sin
tocar nada si un nombre no existe, está repetido, la lista cubre todos los negocios, o alguno
es un cliente bajo retención (`NO SE PUEDE: … es CLIENTE`). Ese último aviso no se «arregla»:
se vuelve al Paso 2 con Carlos.

## Ruta B — Cliente real: se bloquea, no se borra

1. **Desactivar** desde el backoffice (Negocios → el negocio → «Desactivar negocio»). Pide motivo;
   que diga la fecha límite, por ejemplo `Baja del cliente — retención legal hasta 2036-09-21`.
   Desactivar pone `suspended_at`: nadie entra y la suscripción deja de cobrar.
2. **No se elimina.** El backoffice habilita «Eliminar negocio» a los 30 días de desactivado
   (`TENANT_DELETE_COOLING_DAYS`), pero esa regla no sabe de clientes reales. Para un
   cliente que paga, el botón sigue apagado hasta que pase su retención y el API lo rechaza;
   para uno de otra persona que nunca pagó, el botón SÍ se enciende a los 30 días: no se usa.
3. **Cumplida la retención desde `suspended_at`** (10 años MX, 7 CA y US), se comprueba y se
   sigue la Ruta A:

```sql
SELECT name, country, suspended_at,
  coalesce(tenant_retention_years(id), 10) AS anios,
  suspended_at + make_interval(years => coalesce(tenant_retention_years(id), 10)) AS se_puede_borrar_desde
FROM tenants WHERE name = 'NOMBRE EXACTO';
```

Si `se_puede_borrar_desde` está en el futuro, no se borra, aunque Carlos lo pida por espacio.
Se le explica por qué y cuándo sí. El plazo se cuenta desde la desactivación porque todos los
registros del negocio son anteriores a ella: es la cuenta más conservadora.

Sobre el espacio: un negocio pequeño ocupa pocos megas en Postgres. Guardarlo esos años cuesta
casi nada; borrarlo antes de tiempo puede costar una multa.

## Lo que NO se hace

- `DELETE` a mano sobre tablas con `tenant_id`: duplica `purge_tenant` y deja huérfanos.
- Borrar por exclusión (`purge-tenants.sql`) con una lista copiada de cualquier lado.
- Decidir la clase de un negocio sin que Carlos la confirme.
- Purgar a un cliente real antes de su retención, ni por espacio ni porque el backoffice ya
  lo permita.
- «Destrabar» a un cliente borrando sus pagos por SQL, redefiniendo `purge_tenant()` o
  moviendo `suspended_at` al pasado en producción. La única salida es anular un pago que de
  verdad fue de prueba.
- Borrar sin respaldo en producción, o sin haber visto el ensayo.

## Resources

- `infrastructure/scripts/purge-tenants-by-name.sql` — la purga por nombre, con ensayo.
- `apps/api/prisma/migrations/20260909100000_f7_tenant_lifecycle/migration.sql` —
  `purge_tenant(uuid)`: qué borra y qué exige.
- `apps/api/prisma/migrations/20260930100000_f7_tenant_retention/migration.sql` —
  `tenant_retention_years(uuid)` y el candado de retención dentro de `purge_tenant`.
- `packages/shared/src/tenant-lifecycle.ts` — los 30 días de quien nunca pagó y
  `TENANT_RETENTION_YEARS`, la retención de un cliente por país.
