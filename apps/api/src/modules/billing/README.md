# Billing — planes, suscripciones y cobro manual (Fase 7)

Este módulo es el sistema de cobro de SellPointy. En esta fase el cobro es
**MANUAL**: el cliente transfiere, el dueño de la plataforma registra el pago
desde el backoffice, y el sistema hace todo lo demás — calcular el cargo,
avanzar el período, degradar al que no paga y avisar antes de cada corte.
Stripe está pospuesto, pero el enchufe ya existe (ver la última sección).

**La regla de oro que atraviesa todo el módulo:** el sistema solo DEGRADA;
PROMOVER es siempre un acto humano. La única puerta hacia `active` es un pago
registrado. Un bug en el cron puede, como mucho, degradar a alguien de más —
eso se ve y se corrige con un pago—; jamás regalar un plan que nadie pagó.

---

## 1. Los planes

| | Free | Basic $199 | Pro $349 | Plus $499 | Premium |
|---|---|---|---|---|---|
| Escritura (`write_access`) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Ventas al día | **10** | ∞ | ∞ | ∞ | ∞ |
| Control de stock | ❌ | **❌** | ✅ | ✅ | ✅ |
| Usuarios / almacenes | 1/1 | 3/1 | 6/4 | 20/10 | ∞ |
| Cotizaciones | — | — | ✅ | ✅ | ✅ |
| Movimientos y traspasos | — | — | ✅ | ✅ | ✅ |
| Lotes, campos y roles custom | — | — | — | ✅ | ✅ |
| Precio publicado | no se vende | ✅ | ✅ | ✅ | **pactado por cliente** |

- Precios por **MERCADO**, no por tipo de cambio: MX $199/$349/$499 MXN ·
  US $15/$29/$45 USD · CA $19/$39/$59 CAD. El mercado lo resuelve
  `resolveMarket` (shared): el `country` del negocio manda; sin país, su
  MONEDA lo deriva (MXN→MX, CAD→CA); y `US` es el default internacional. La
  MISMA función la usan la vitrina y el cobro — mostrar un precio y cobrar
  otro sería el peor error de este módulo.
- **Anual = mensual × 10** (dos meses gratis). Lo exige un CHECK de la base:
  no es una coincidencia del seed, es regla de la casa.
- El trial es de **14 días con nivel Plus**, sin tarjeta, y nace en la MISMA
  transacción que el tenant (`TenantsService.provision`): no existe un tenant
  sin suscripción… creado después de la Fase 7. Los anteriores caen a `free`
  por diseño (fail-closed del resolver).
- `free` es una **fila del catálogo**, no un `if` en el código: el modo
  gratuito se edita como cualquier plan.

La matriz vive en `plans.features` (JSONB validado con `planFeaturesSchema`)
más columnas calientes duras (`max_users`, `daily_sales_limit`, …). Se edita
**sin migración** desde el backoffice — ver runbook §5.8.

## 2. La máquina de estados

```
registro ──────────────► trialing (Plus, 14 días)
                            │
              pago ◄────────┤ cron: trial_ends_at vencido
                │           ▼
                ▼          free ◄────────────────────────────┐
             active ──────────────────────────────┐          │
                ▲   cron: due_at vencido          │          │
                │           ▼                     │          │
              pago ◄─── past_due (gracia 10 días) │          │
                            │                     │          │
                            │ cron: grace_ends_at │ cron: vence el período
                            ▼                     │ CON cancel_at_period_end
                           free                   ▼          │
                                              canceled ──────┘
                                                  ▲    (pago tras reactivar)
                            Carlos: cancel ───────┘
```

Reglas que los tests fijan (`billing-*.e2e-spec.ts`, 49 casos):

- **El ancla no se recalcula.** `anchor_day` se fija con el PRIMER pago:
  quien paga el 31-ene vence el 28-feb y **vuelve al 31** en marzo. Si se
  derivara del último vencimiento, ese cliente perdería 3 días cada mes para
  siempre.
- **Un pago tardío no regala días** (encadena con el vencimiento anterior),
  pero **free → active re-ancla al día del pago**: los meses muertos ni se
  cobran ni se acreditan.
- **Cancelar no corta.** Deja `cancel_at_period_end` con el status intacto —
  el servicio pagado se respeta hasta el corte— y el cron hace la transición
  al vencer, sin gracia (no hay nada que cobrar a quien ya se despidió).
- **La gracia son 10 días** del calendario del negocio, con el plan COMPLETO
  y avisos. El día 11 cae a `free` — pero la suscripción recuerda el plan
  contratado, así el pago tardío sabe a qué volver.
- Todas las fechas guardadas son **límite abierto**: el instante es el
  arranque del día siguiente al último día hábil. La fecha legible de un
  vencimiento es la del milisegundo anterior (`getTime() - 1`).
- **El estado es un DATO que el cron persiste, no un cálculo por request.**
  Entre que un `due_at` vence y que el barrido de las 3 AM lo mueve, el
  `status` sigue diciendo `active` — y está bien: nadie pierde acceso por un
  reloj. Pero el `SubscriptionBlock` trae `overdue: true` en esa ventana, y
  el banner lo anuncia al instante. Avisar es inmediato; degradar es del
  cron.
- **Las fechas se leen en la zona del NEGOCIO**, nunca en la del navegador:
  el vencimiento de un negocio de CDMX no cambia porque su dueño abra la app
  desde Madrid. En el front eso vive en `lib/billing/dates.ts`
  (`formatInstant` para hechos puntuales, `formatDeadline` para límites
  abiertos) y la zona viaja en la sesión y en cada fila del backoffice.

## 3. El modelo de datos

| Tabla | Qué es | RLS |
|---|---|---|
| `plans` | Catálogo global (5 filas sembradas en migración) | sin RLS |
| `plan_prices` | Precio por (plan, país); UNIQUE `(plan_id, country)` | sin RLS |
| `tenant_subscriptions` | UNA por tenant; estado, ancla, períodos | RLS + bypass |
| `subscription_payments` | Pagos con SNAPSHOT de plan/precio; se anulan, no se borran | RLS + bypass |
| `tenant_discounts` | Cupones; UNIQUE parcial: UN activo por tenant | RLS + bypass |
| `billing_notifications` | Avisos enviados; el UNIQUE es la idempotencia del cron | RLS + bypass |

**El bypass acotado.** La policy `billing_admin_bypass` (GUC
`app.billing_admin`) existe SOLO en las 4 tablas de billing y se prende
únicamente vía `PrismaService.withBillingAdminContext()`. Desde ese contexto
se leen las suscripciones de todos los negocios, pero un `SELECT` a `sales`,
`products` o `users` devuelve **cero filas** — lo impone Postgres y lo fija
`billing-admin-isolation.e2e-spec.ts`. Regla dura (hermana de AD-1): el GUC
jamás se setea fuera de ese método.

Los CHECKs de coherencia viven en las migraciones: `amount = gross − discount`
en los pagos, `price_yearly = price_monthly × 10`, estados y métodos por
`IN (...)`, y los de coherencia por estado en la suscripción (un `active` sin
`due_at` no puede existir ni por bug).

## 4. El enforcement

- **`EntitlementsService.resolve(tenantId)`** — el plan efectivo:
  `trialing/active/past_due` → el plan de la suscripción; `free/canceled/sin
  fila` → el plan `free` (fail-closed con WARN). Caché Redis
  `entitlements:{tenantId}` TTL 300 s con `DEL` explícito en cada cambio; si
  Redis cae, fail-open a **Postgres**, nunca a "todo permitido".
- **`SubscriptionGuard`** — 4º APP_GUARD (Throttler → JwtAuth → Permissions →
  Subscription: un 403 de rol nunca se disfraza de 402 de plan). GET/HEAD
  pasan siempre — el free tier VE todo. Los mutantes: sin `write_access` →
  **402** `billing.read_only`; `@RequiresFeature('lots')` sin el flag → 402;
  `@CheckPlanLimit('users'|'warehouses')` cuenta SOLO al crear (un downgrade
  jamás suspende usuarios ni borra almacenes). `@AllowedInFreeTier()` marca
  lo poco que se opera sin plan: vender, caja, cancelar venta, perfil,
  `/billing/*` y todo `/admin/billing/*`.
- **10 ventas/día** — `SalesPlanGate`, DENTRO de la transacción de la venta y
  ANTES de `nextFolio` (un rechazo no gasta numeración). Cuenta el día del
  NEGOCIO y las canceladas devuelven cupo.
- **Vender sin stock** — la regla efectiva es la unión:
  `!plan.stock_control || tenant.sell_without_stock`. El negativo se ASIENTA
  con kardex completo: es la lista de qué inventariar al subir de plan, y el
  upgrade la devuelve como `warnings.negativeStock`.

## 5. Runbook del dueño

La puerta es el **`PlatformAdminGuard`: cuatro llaves en AND** —
`users.is_platform_admin` **y** email en `BILLING_ADMIN_EMAILS` (env,
obligatoria en producción) **y** cuenta activa **y** email verificado. El
flag no viaja en el JWT: se consulta por PK en cada request de `/admin/*`,
así que revocarlo es inmediato.

La operación semanal vive en la UI: **`app.sellpointy.com/admin/billing`**
(tabla de negocios + expediente + modal "Registrar pago"). La tabla lista
**todos los negocios**, tengan o no suscripción: los anteriores a la Fase 7
salen como "Sin suscripción", y registrarles un pago los da de alta (exige
`planCode`, porque no hay plan previo del que heredar). Todo lo demás es
solo-API.
Para usar la API a mano, primero un token:

```bash
TOKEN=$(curl -s https://app.sellpointy.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<tu-email>","password":"<tu-password>"}' | jq -r .accessToken)
AUTH="Authorization: Bearer $TOKEN"
BASE=https://app.sellpointy.com/api/admin/billing
```

El `tenantId` de cada negocio sale de `GET $BASE/tenants` (la misma lista de
la UI). **Toda palanca lleva `reason`**: cada acción queda en `audit_logs`
con su porqué.

### 5.1 Registrar un pago (LA operación)

UI: fila del negocio → "Registrar pago". API:

```bash
curl -s -X POST "$BASE/tenants/<tenantId>/payments" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{
    "billingCycle": "monthly",
    "method": "transfer",
    "paidAt": "2026-08-28T18:00:00.000Z"
  }'
```

- `method`: `transfer` · `cash` · `card` · `other` · `courtesy`.
- `planCode` (opcional) cambia el plan EN EL MISMO ACTO — el caso típico:
  el trial Plus que contrata Basic paga $199 y queda en Basic.
- `paidAt` **no puede ser futura** (422 `billing.paid_at_in_future`, medido
  en el día del negocio): un pago es un hecho, y un hecho futuro es un error
  de dedo que contaría para el MRR. Cobrar por adelantado se hace con la
  fecha de HOY — el período encadena solo con el anterior.
- `amountReceived` (opcional): lo que de verdad llegó. **Si NO cubre el
  cargo, el pago se rechaza** con 422 `billing.amount_below_charge` diciendo
  cuánto falta — un error de dedo no puede regalar un mes. Para aceptarlo
  igual, `allowPartial: true` (en la UI, la casilla "Aceptar aunque no cubra
  el costo del plan"): el faltante queda escrito en `notes` y en la bitácora.
  Un pago de MÁS nunca se rechaza. El pago siempre registra el monto
  CALCULADO (el CHECK no admite otra cosa) y **el período jamás se deriva del
  monto**.
- `periodStart` (opcional): override explícito — "reactivar desde hoy sin
  cobrar los meses muertos" cuando NO quieres el encadenamiento por defecto.

El cargo se calcula solo: precio del mercado del tenant (o `custom_price` en
Premium) − cupón vigente. La suscripción pasa a `active`, la gracia se limpia
y al negocio le llega el correo `payment-received`.

### 5.2 El expediente de un negocio

En la UI, el **nombre del negocio** abre su expediente: plan, estado, cupón
vigente y el **historial de pagos** con el período que cubrió cada uno, sus
notas y el botón de anular. Por API:

```bash
curl -s "$BASE/tenants/<tenantId>" -H "$AUTH"
```

Un negocio SIN suscripción —los anteriores a la Fase 7— responde `status:
"none"` sobre el plan `free` en vez de 404: es lo que el sistema le aplica
hoy, y es a quien hay que cobrarle.

### 5.3 Anular un pago

Un pago capturado por error NO se borra — se anula con razón, y el estado
presente se recalcula desde los pagos vivos (puede volver a `active`,
`past_due`, `trialing` o `free`, según lo que quede):

```bash
curl -s -X POST "$BASE/tenants/<tenantId>/payments/<paymentId>/void" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"reason": "transferencia rebotada"}'
```

### 5.4 Dar un cupón (y quitarlo)

Un solo cupón activo por negocio; para cambiar, se revoca y se otorga otro.

```bash
# −$200 por período, durante 12 períodos:
curl -s -X POST "$BASE/tenants/<tenantId>/discounts" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{
    "kind": "fixed_amount", "amount": "200",
    "startsAt": "2026-09-01T00:00:00.000Z", "maxPeriods": 12,
    "reason": "promoción de lanzamiento"
  }'
# Gratis por un rango de fechas: {"kind": "free", "startsAt": ..., "endsAt": ...}

# Revocar:
curl -s -X DELETE "$BASE/tenants/<tenantId>/discounts/<discountId>" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"reason": "terminó la promoción"}'
```

El cupón se agota solo: `applied_periods` sube con cada pago y el período 13
cobra tarifa de lista sin que nadie tenga que acordarse.

### 5.5 Correr el barrido a mano

```bash
curl -s -X POST "$BASE/jobs/run-daily" -H "$AUTH" -d '{}'
```

Es el MISMO job del cron de las 3 AM. Correrlo dos veces es inofensivo: las
transiciones son `updateMany WHERE status = ...` (la segunda pasada mueve 0
filas) y los avisos rebotan en el UNIQUE de `billing_notifications`. Úsalo
para "córrelo y mira qué movió" — el log dice cuántas suscripciones tocó.

### 5.6 Dar de alta un Premium

Premium no tiene precio publicado: exige `custom_price` pactado por cliente.
Dos pasos — primero el plan con su precio, luego el pago normal:

```bash
curl -s -X PATCH "$BASE/tenants/<tenantId>/subscription" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{
    "planCode": "premium", "customPrice": "1500.00",
    "reason": "plan a la medida acordado con el cliente"
  }'
# Luego el pago (§5.1): el cargo sale del custom_price, mensual o ×10 anual.
```

Mover a Premium sin `customPrice` (ni uno previo) rebota con 422
`billing.custom_price_required` — la invariante la impone `BillingService`.

### 5.7 Cancelar y reactivar

```bash
curl -s -X POST "$BASE/tenants/<tenantId>/cancel" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"reason": "cierra el negocio"}'
# El status NO cambia: el período pagado se respeta y el cron cierra al vencer.

curl -s -X POST "$BASE/tenants/<tenantId>/reactivate" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"reason": "se arrepintió"}'
# Solo con el período aún vivo; vencido, la puerta es un pago (422).
```

### 5.8 Editar precios y features de un plan

```bash
curl -s "$BASE/plans" -H "$AUTH"          # el catálogo completo con precios

curl -s -X PATCH "$BASE/plans/pro" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{
    "prices": [{"country": "MX", "currency": "MXN", "priceMonthly": "399.00"}]
  }'
```

El anual se deriva SIEMPRE (×10); las `features` pasan por el schema estricto
(un typo revienta, no se guarda). Los precios nuevos aplican a los pagos
FUTUROS — cada pago viejo guarda su snapshot. Los entitlements cacheados
expiran solos (TTL ≤ 5 min).

### 5.9 Cambios de plan y el aviso de negativos

`PATCH .../subscription` con `planCode` mueve el plan sin cobrar (el cobro con
cambio de plan es §5.1). Al mover a un plan CON control de stock, la respuesta
trae `warnings.negativeStock: [{sku, warehouse, quantity}]` — la lista exacta
de qué inventariar; un conteo físico (F3) la corrige. `anchorDay` también se
puede fijar a mano ahí: es palanca de RESCATE, normalmente la fija el primer
pago y nunca se toca.

## 6. El cron y los correos

`BillingDailyJob.run(now)` — cinco pasos puros y testeables:
`expireTrials → openGrace → expireGrace → sendReminders → invalidateCaches`.
El registro del reloj vive aparte (`BillingCronRegistrar`, dinámico vía
SchedulerRegistry) y lo controla el env:

| Variable | Default | Qué hace |
|---|---|---|
| `BILLING_CRON_ENABLED` | **false** | Degradar es opt-in explícito del ambiente |
| `BILLING_CRON_TZ` | `America/Mexico_City` | Zona del disparo |
| `BILLING_CRON_HOUR` | `3` | Hora local del disparo |
| `BILLING_ADMIN_EMAILS` | `""` (obligatoria en prod) | La whitelist del backoffice |

Avisos (dedup por `UNIQUE(subscription, kind, anchor_at)` — INSERT antes del
mail): `trial-ending` (T-3), `trial-ended`, `payment-due-soon` (T-7 y T-3),
`payment-past-due` (al abrir gracia y T-3 del corte), `plan-downgraded` (día
11) y `payment-received` (lo dispara el registro del pago, no el cron). El
destinatario es el usuario activo más antiguo con `tenants:manage`. El envío
es post-commit y best-effort: un SMTP caído jamás revierte una transición.

## 7. El enchufe de Stripe (pospuesto, no olvidado)

Cuando el volumen justifique la pasarela, el modelo NO necesita migración.
Ya existen:

- `plans.gateway_product_id` — el Product de Stripe por plan.
- `plan_prices.gateway_price_monthly_id` / `gateway_price_yearly_id` — los
  Price por mercado (en Stripe el precio es por moneda, por eso viven aquí y
  no en `plans`).
- `tenant_subscriptions.gateway` (`'manual'` hoy) + `gateway_customer_id` +
  `gateway_subscription_id`.
- `subscription_payments.gateway` + `gateway_reference` + `external_id` con
  **UNIQUE parcial** — la idempotencia del webhook: el mismo evento entregado
  dos veces inserta una sola.
- La separación `service_period_end` / `due_at` que hoy coincide: con
  pasarela divergen (Stripe cobra ANTES del corte del servicio).

Lo que falta construir:

1. **El adapter** (`StripeGateway`): crear customer al onboarding, checkout
   session para contratar, sincronizar el catálogo (product/price IDs hacia
   las columnas de arriba).
2. **El webhook** (`POST /billing/webhooks/stripe`): verificación de firma,
   y `invoice.paid` → el MISMO `recordPayment` de hoy con
   `gateway: 'stripe'` y `external_id` — el motor de períodos no cambia.
3. **El front de tarjeta**: el CTA "Contratar" del modal de planes pasa de
   "Contáctanos" a checkout embebido.
4. **La convivencia**: decidir si los reintentos de cobro de Stripe
   reemplazan nuestra gracia de 10 días o corren dentro de ella, y qué pasa
   con un tenant `gateway='stripe'` al que se le registra un pago manual
   (probablemente: prohibirlo salvo `courtesy`).
5. **Impuestos y factura fiscal** (hoy manuales por decisión explícita):
   Stripe Tax puede entrar en el mismo movimiento.

---

*Los 49 casos e2e del módulo viven en `apps/api/test/e2e/billing-*.e2e-spec.ts`
y son la especificación ejecutable de todo lo de arriba.*
