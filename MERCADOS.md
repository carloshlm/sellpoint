# SellPoint — Mercados y Localización

> **Fuente de verdad de los países que SellPoint soporta**, y de las diferencias
> de nomenclatura que la UI tiene que respetar en cada uno. Mantener sincronizado
> con `packages/shared/src/i18n.ts` (monedas), `packages/shared/src/countries.ts`
> (catálogo ISO 3166-1 completo) y `apps/web/src/lib/tenant/markets.ts` (zonas
> horarias curadas, moneda por defecto y sigla fiscal por país).

---

## 1. Países soportados

**26 países en cuatro bloques**: Norteamérica, Europa, Centroamérica y
Sudamérica. La columna **Moneda** es la que el negocio elegiría normalmente, no
una restricción: el selector de moneda es libre y ofrece las cinco habilitadas.

### Norteamérica

| País | Moneda esperada | Zonas horarias ofrecidas |
|---|---|---|
| México | MXN | Centro (CDMX), Sureste (Cancún), Sonora (Hermosillo), Pacífico (Tijuana) |
| Estados Unidos | USD | Este, Centro, Montaña, Arizona, Pacífico, Alaska, Hawái |
| Canadá | CAD | Terranova, Atlántico, Este, Centro, Montaña, Pacífico |

### Europa

| País | Moneda esperada | Zonas horarias ofrecidas |
|---|---|---|
| Portugal | EUR | Lisboa |
| España | EUR | Peninsular (Madrid), Canarias (Las Palmas) |
| Francia | EUR | París |
| Italia | EUR | Roma |
| Alemania | EUR | Berlín |
| Reino Unido (Inglaterra) | GBP | Londres |

**Monedas habilitadas:** `MXN`, `USD`, `CAD`, `EUR`, `GBP` — definidas en
`SUPPORTED_CURRENCIES` (`packages/shared/src/i18n.ts`), con test de contrato.

### Centroamérica

Ninguno tiene horario de verano: su offset es estable todo el año.

| País | Moneda por defecto | Zona horaria |
|---|---|---|
| Belice | USD | Belmopán (UTC-6) |
| Costa Rica | USD | San José (UTC-6) |
| El Salvador | USD | San Salvador (UTC-6) |
| Guatemala | USD | Ciudad de Guatemala (UTC-6) |
| Honduras | USD | Tegucigalpa (UTC-6) |
| Nicaragua | USD | Managua (UTC-6) |
| Panamá | USD | Ciudad de Panamá (UTC-5) |

### Sudamérica

| País | Moneda por defecto | Zonas horarias ofrecidas |
|---|---|---|
| Argentina | USD | Buenos Aires (UTC-3) |
| Bolivia | USD | La Paz (UTC-4) |
| Brasil | USD | Brasilia (UTC-3), Amazonas (UTC-4), Acre (UTC-5) |
| Chile | USD | Continental (UTC-4/-3), Isla de Pascua (UTC-6/-5) |
| Colombia | USD | Bogotá (UTC-5) |
| Ecuador | USD | Continental (UTC-5), Galápagos (UTC-6) |
| Paraguay | USD | Asunción (UTC-3) |
| Perú | USD | Lima (UTC-5) |
| Uruguay | USD | Montevideo (UTC-3) |
| Venezuela | USD | Caracas (UTC-4) |

> **Sobre la moneda por defecto:** Latinoamérica opera con **USD** por decisión
> operativa (2026-08-16), no porque su moneda local no exista. Cada moneda se
> irá habilitando conforme lleguen clientes que la necesiten — el proceso es el
> mismo que se usó para CAD, EUR y GBP: agregar el código a
> `SUPPORTED_CURRENCIES`, una migración con el `CHECK` ampliado y la fila del
> catálogo, y las etiquetas en ambos idiomas.

> **Sobre el horario de verano:** solo **Chile** lo tiene activo (Santiago
> alterna UTC-4/-3). Paraguay lo abolió en 2024 y Brasil en 2019. Por eso el
> catálogo guarda ciudades IANA y no offsets crudos: un `UTC-4` fijo mentiría
> media parte del año.

**Fuera de alcance por ahora:** de Portugal quedaron fuera Madeira y Azores por
decisión explícita.

---

## 2. Las etiquetas no universales — RESUELTA (2026-08-16, ad-hoc post-Fase 1)

El wizard de onboarding pedía **identificación fiscal** con la etiqueta fija
`"RFC / RUT"` en español. Eso estaba mal por dos motivos:

1. **RUT** es de Chile y Uruguay — países que en ese momento **no**
   soportábamos (hoy sí, con su propia sigla — ver tabla).
2. **No nombraba** el documento de los otros países que sí soportamos.

Se resolvió con la **opción B** del análisis original (campo `country` +
etiquetas por país), sin la **C** (validación de formato por país — sigue
fuera de alcance, cada país es un caso distinto y conviene diferirlo hasta
que haya clientes reales que lo pidan).

### Qué cambió

- **`Tenant.country`**: `CHAR(2)` nullable, ISO 3166-1 alpha-2 — migración
  aditiva, sin `CHECK` SQL (la validación vive en `updateTenantSchema` vía
  `isCountryCode`, `packages/shared/src/countries.ts`). Un tenant que ya
  había completado el paso 1 del wizard ANTES de este cambio tiene
  `country = NULL` y vuelve a caer en el paso 1 hasta elegirlo — consecuencia
  deliberada, no un bug.
- **País es el PRIMER campo del paso 1**, requerido. Los nombres se
  renderizan con `Intl.DisplayNames([locale], { type: "region" })` — CERO
  claves i18n de países — ordenados por nombre localizado.
- **Catálogo curado vs. resto del mundo** (`apps/web/src/lib/tenant/markets.ts`):
  - Los **26 países curados** (§1 de este documento) ofrecen SOLO sus zonas
    horarias propias en el selector (1 a 7 según el país; si es una sola,
    queda preseleccionada) y una sigla fiscal exacta (tabla abajo).
  - Cualquier otro país ISO válido (~224 más, ej. Japón) **también filtra
    sus zonas** (decisión de Carlos, 2026-08-16): elegir Japón deja
    `Asia/Tokyo`, no las 418 del mundo. El mapa país→zonas se genera desde
    el `zone.tab` de IANA a `apps/web/src/lib/tenant/country-timezones.ts`
    (247 países, 418 zonas) y lo resuelve `resolveCountryTimezones()`, que
    da precedencia al catálogo curado. Si el país tiene varias zonas se
    preselecciona la del navegador **solo si pertenece a ese país**; si no,
    queda vacío para que el usuario elija. Etiquetas = identificador IANA
    tal cual (no hay 418 traducciones). Solo los territorios sin zona en
    IANA (deshabitados, ej. Isla Bouvet) caen al catálogo completo. La
    etiqueta fiscal es la genérica sin sigla y la moneda preselecciona USD.

> **Gotcha de `Intl` (costó dos bugs):** `Intl.supportedValuesOf("timeZone")`
> devuelve los alias **legacy** (`Asia/Calcutta`), no los nombres modernos que
> usa IANA (`Asia/Kolkata`) — aunque `Intl` sí **acepta** los modernos. Filtrar
> el mapa contra esa lista borraba países enteros (India, Vietnam, Nepal,
> Myanmar, Eritrea, Feroe). La validez de una zona se prueba construyendo un
> `Intl.DateTimeFormat`, nunca consultando `supportedValuesOf`.
>
> **Gotcha de CLDR:** `Intl.DisplayNames` resuelve códigos ISO **retirados**
> al nombre del país sucesor (`VD` → "Vietnam", `DY` → "Benín"), así que
> generar el catálogo de países sin excluirlos produce entradas **duplicadas**
> en el selector. Excluidos: `HV`, `DY`, `NH`, `RH`, `VD`.
  - Cambiar de país **re-deriva** zona horaria y moneda (nunca al montar el
    form, solo ante un cambio real del usuario): si la zona actual no
    pertenece al país curado nuevo, se resetea (a la única del país o a
    elegir); la moneda se re-preselecciona SOLO si el usuario no la tocó a
    mano explícitamente.
- **Zona horaria y moneda siguen SIEMPRE visibles y editables** — el país
  solo preselecciona, nunca oculta ni fuerza un valor.

### Sigla fiscal exacta por país curado

| País | Sigla | País | Sigla |
|---|---|---|---|
| México | RFC | Argentina | CUIT |
| Estados Unidos | EIN | Bolivia | NIT |
| Canadá | BN | Brasil | CNPJ |
| Portugal | NIF | Chile | RUT |
| España | NIF | Colombia | NIT |
| Francia | SIREN/SIRET | Ecuador | RUC |
| Italia | Partita IVA | Paraguay | RUC |
| Alemania | USt-IdNr | Perú | RUC |
| Reino Unido | Company Number / VAT | Uruguay | RUT |
| Belice | TIN | Venezuela | RIF |
| Costa Rica | Cédula Jurídica | | |
| El Salvador | NIT | | |
| Guatemala | NIT | | |
| Honduras | RTN | | |
| Nicaragua | RUC | | |
| Panamá | RUC | | |

Formato en UI: `"Identificación fiscal (RFC)"` / `"Tax ID (RFC)"` para un
país curado; `"Identificación fiscal"` / `"Tax ID"` (sin paréntesis) para el
resto del mundo. **Sin validación de formato** — fuera de alcance (opción C).

---

## 3. Voz de la UI — LEY

**Todo texto visible para el usuario se escribe en español neutro y en inglés
americano neutro.** Aplica a la web, a los mensajes de error de la API y a los
correos — todo lo que viva en `apps/web/src/i18n/**` y `apps/api/src/i18n/**`.

### Español: neutro, nunca voseo

El producto es México-first y se vende a 26 mercados. El voseo rioplatense
(`podés`, `elegí`, `necesitás`, `escribinos`) suena extranjero en la mayoría de
ellos, así que **no se usa**, aunque el equipo hable así.

| ❌ Voseo | ✅ Neutro |
|---|---|
| No tenés permiso | No tienes permiso |
| Elegí un país | Elige un país |
| Revisá tu email | Revisa tu correo |
| Ingresá un email válido | Ingresa un correo válido |
| ¿Necesitás otra moneda? Escribinos | ¿Necesitas otra moneda? Escríbenos |
| Probá de nuevo | Intenta de nuevo |

Regla práctica: conjuga en **tú** (`tienes`, `puedes`, `eliges`) y usa
imperativos de tú (`elige`, `revisa`, `ingresa`, `intenta`). Evita también
regionalismos de cualquier país (`platicar`, `coger`, `ordenador`, `celu`).

### Inglés: americano neutro

Ortografía de EE. UU. (`color`, `organization`, `canceled`, `license` como
sustantivo), sin britanismos (`colour`, `whilst`, `apologise`) ni modismos.

### Guardarraíl

`apps/web/src/i18n/i18n.test.tsx` incluye un test que **falla en CI** si
aparece una forma voseante en cualquier archivo `es/*.json`. Igual que el
guardián de links de correo: la convención no depende de que alguien la
recuerde en el review.

---

## 4. Otras etiquetas a revisar con el mismo criterio

Candidatas detectadas al escribir este documento; ninguna verificada en
profundidad todavía:

- **Dirección** — hoy es un campo de texto libre. Los formatos postales difieren
  (código postal antes o después de la ciudad, condado/provincia/estado…).
- **Nombre del impuesto de venta** — IVA (México, España, Portugal, Italia),
  TVA (Francia), MwSt (Alemania), VAT (Reino Unido), Sales Tax/GST/HST
  (EE. UU. y Canadá, además variable por estado o provincia). Relevante desde
  que el POS emita tickets (Fase 4).
- **Formato de fecha y de número** — ya resuelto vía `Intl` con el locale del
  usuario, pero conviene verificarlo cuando haya reportes impresos.

---

*Documento de mercados de SellPoint. Creado el 2026-08-16 al habilitarse Europa.
Mantener sincronizado con [ARQUITECTURA.md](ARQUITECTURA.md) y
[CASOS_DE_USO.md](CASOS_DE_USO.md).*
