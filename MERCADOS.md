# SellPoint — Mercados y Localización

> **Fuente de verdad de los países que SellPoint soporta**, y de las diferencias
> de nomenclatura que la UI tiene que respetar en cada uno. Mantener sincronizado
> con `packages/shared/src/i18n.ts` (monedas) y con el catálogo de zonas horarias
> de `apps/web/src/components/onboarding/step-business.tsx`.

---

## 1. Países soportados

Nueve países, en dos bloques. La columna **Moneda esperada** es la que el negocio
elegiría normalmente, no una restricción: el selector de moneda es libre.

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

### Sudamérica (cobertura parcial)

Existe una entrada **regional**: `"Sudamérica (UTC-4)"`, respaldada por la zona
IANA `America/La_Paz` (UTC-4 estable, sin horario de verano). Cubre de facto
Bolivia, Venezuela, Guyana y el Amazonas brasileño, **sin declarar ningún país
sudamericano como mercado soportado** (por eso no aparecen en la tabla de
arriba ni influyen en la discusión de etiquetas de la sección 2).

> ⚠️ Chile NO queda cubierto por esta entrada: Santiago alterna UTC-4/UTC-3 con
> el horario de verano. Si Chile se vuelve mercado, necesita `America/Santiago`
> propio.

**Fuera de alcance por ahora:** el resto de Sudamérica por ciudad (las zonas de
Bogotá, Lima, Santiago y Buenos Aires se retiraron el 2026-08-16), y de
Portugal quedaron fuera Madeira y Azores por decisión explícita.

---

## 2. El problema abierto: las etiquetas no son universales

El wizard de onboarding pide **identificación fiscal** con la etiqueta
`"RFC / RUT"` en español. Eso está mal por dos motivos:

1. **RUT** es de Chile y Uruguay — países que **no** soportamos.
2. **No nombra** el documento de los otros ocho países que sí soportamos.

La etiqueta en inglés (`"Tax ID"`) es genérica y no tiene ese problema.

### Cómo se llama el identificador fiscal en cada país

| País | Nombre local | Formato típico |
|---|---|---|
| México | RFC — Registro Federal de Contribuyentes | 12 (moral) / 13 (física), alfanumérico |
| Estados Unidos | EIN — Employer Identification Number | 9 dígitos (`12-3456789`) |
| Canadá | BN — Business Number | 9 dígitos (+ `RT0001` para GST/HST) |
| Portugal | NIF / NIPC — Número de Identificação Fiscal | 9 dígitos |
| España | NIF (antes CIF para empresas) | letra + 8 caracteres (`B12345678`) |
| Francia | SIREN / SIRET; TVA intracomunitario | SIREN 9, SIRET 14, TVA `FR` + 11 |
| Italia | Partita IVA | 11 dígitos |
| Alemania | USt-IdNr / Steuernummer | `DE` + 9 dígitos |
| Reino Unido | Company Number / VAT number | CN 8 caracteres; VAT `GB` + 9 |

### Lo que falta para resolverlo bien

**`Tenant` no tiene campo de país.** Hoy el único dato geográfico es
`timezone`, del que el país se puede *inferir* (nuestro catálogo es curado), pero
esa inferencia es un acoplamiento implícito y frágil: el día que alguien agregue
una zona compartida por dos países, se rompe en silencio.

Sin campo de país, la UI no puede decidir qué etiqueta mostrar. Por eso esta es
una **decisión de arquitectura pendiente**, no un cambio de copy.

### Opciones sobre la mesa

| Opción | Qué implica | Costo |
|---|---|---|
| **A. Etiqueta genérica** | `"Identificación fiscal"` / `"Tax ID"`, con ejemplos en el placeholder | Trivial. No miente en ningún país, pero tampoco guía |
| **B. Campo `country` + etiquetas por país** | Migración de `Tenant`, selector de país en el paso 1 (que además ordena las zonas horarias), etiqueta y placeholder dinámicos | Medio. Es la solución correcta a largo plazo |
| **C. B + validación de formato** | Todo lo anterior más validación por país (regex de RFC, NIF, VAT…) | Alto. Cada país es un caso; conviene diferirlo |

**Recomendación:** cerrar la sangría con **A** cuando se decida (una línea, deja
de nombrar un país que no atendemos), y planificar **B** dentro de Fase 2, donde
el campo `country` también sirve para ordenar el selector de zonas horarias y
preparar impuestos. **C** se evalúa cuando haya clientes reales que lo pidan.

---

## 3. Otras etiquetas a revisar con el mismo criterio

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
