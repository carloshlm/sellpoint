---
name: sellpoint-delete-tenant
description: >
  Cómo se elimina un negocio (tenant) de SellPointy con todo lo suyo: primero se decide si
  es de PRUEBAS o un CLIENTE REAL. El de pruebas se purga con el guion por nombre; el
  cliente real NO se borra: se desactiva y sus datos se guardan 10 años por ley.
  Trigger: borrar, eliminar, purgar o limpiar un negocio o tenant, sus usuarios, ventas o
  movimientos; liberar espacio en la base; dar de baja a un cliente.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Carlos pide borrar uno o varios negocios, «que no quede rastro» o «que no ocupe espacio».
- Un cliente se da de baja y hay que decidir qué pasa con sus datos.
- Alguien propone un `DELETE` a mano sobre tablas con `tenant_id`.

## La regla en una frase

**Antes de borrar se CLASIFICA. Un negocio de pruebas se purga entero; un cliente real se
BLOQUEA (se desactiva) y se purga hasta que pasen 10 años desde su desactivación.** En caso
de duda, es cliente real.

## Por qué 10 años

Decisión de Carlos (2026-09-21): de los plazos de retención de los tres mercados se toma el
más largo y se aplica a todos, para tener UNA sola regla.

| País | Datos personales | Datos fiscales y comerciales |
|---|---|---|
| México | Bloqueo o eliminación al cumplir la finalidad, salvo plazos legales | 5 años (Código Fiscal) a 10 (Código de Comercio) |
| Canadá | Eliminación al cumplir el propósito | 6 a 7 años (CRA) |
| Estados Unidos | Eliminación a petición (estados como California) | 3 a 7 años (IRS) |

Lo que resuelve la tensión entre las dos columnas es el **bloqueo**: el dato personal deja
de usarse y nadie entra a la cuenta, pero se conserva mientras corre la obligación legal.
Eso es exactamente «desactivar» en SellPointy. La tabla viene de la investigación de Carlos,
no de un abogado: si algún día se confirma otra cosa, se cambia aquí y en ningún otro lado.

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
     AND p.status = 'recorded' AND p.method <> 'courtesy' AND p.amount > 0) AS pagos_reales
FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
WHERE t.name = 'NOMBRE EXACTO';
```

## Paso 2 — Clasificar

| Situación | Clase |
|---|---|
| Carlos confirma que es SUYO (prueba interna) y `pagos_reales = 0` | **Pruebas** → Ruta A |
| Tiene `pagos_reales > 0` | **Cliente real** → Ruta B, aunque diga «prueba» en el nombre |
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
tocar nada si un nombre no existe, está repetido o la lista cubre todos los negocios.

## Ruta B — Cliente real: se bloquea, no se borra

1. **Desactivar** desde el backoffice (Negocios → el negocio → «Desactivar negocio»). Pide motivo;
   que diga la fecha límite, por ejemplo `Baja del cliente — retención legal hasta 2036-09-21`.
   Desactivar pone `suspended_at`: nadie entra y la suscripción deja de cobrar.
2. **No se elimina.** El backoffice habilita «Eliminar negocio» a los 30 días de desactivado
   (`TENANT_DELETE_COOLING_DAYS`), pero esa regla no sabe de clientes reales. Para un
   cliente real, ese botón NO se usa antes de los 10 años.
3. **A los 10 años de `suspended_at`**, se comprueba y se sigue la Ruta A:

```sql
SELECT name, suspended_at,
  suspended_at + interval '10 years' AS se_puede_borrar_desde,
  suspended_at <= now() - interval '10 years' AS ya_se_puede
FROM tenants WHERE name = 'NOMBRE EXACTO';
```

Si `ya_se_puede` es `false`, no se borra, aunque Carlos lo pida por espacio. Se le explica
por qué y cuándo sí. Los 10 años se cuentan desde la desactivación porque todos los
registros del negocio son anteriores a ella: es el plazo más conservador.

Sobre el espacio: un negocio pequeño ocupa pocos megas en Postgres. Guardarlo 10 años cuesta
casi nada; borrarlo antes de tiempo puede costar una multa.

## Lo que NO se hace

- `DELETE` a mano sobre tablas con `tenant_id`: duplica `purge_tenant` y deja huérfanos.
- Borrar por exclusión (`purge-tenants.sql`) con una lista copiada de cualquier lado.
- Decidir la clase de un negocio sin que Carlos la confirme.
- Purgar a un cliente real antes de los 10 años, ni por espacio ni porque el backoffice ya
  lo permita.
- Borrar sin respaldo en producción, o sin haber visto el ensayo.

## Resources

- `infrastructure/scripts/purge-tenants-by-name.sql` — la purga por nombre, con ensayo.
- `apps/api/prisma/migrations/20260909100000_f7_tenant_lifecycle/migration.sql` —
  `purge_tenant(uuid)`: qué borra y qué exige.
- `packages/shared/src/tenant-lifecycle.ts` — desactivar y el enfriamiento de 30 días.
