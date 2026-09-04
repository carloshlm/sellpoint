---
name: sellpoint-vertical-catalog
description: >
  Cómo un módulo vertical de SellPointy (consultorio, óptica, dental, taller…) tiene su
  propio catálogo —que NO es producto ni servicio del POS— y lo vende en caja por el
  puente de la cotización, dejando rastro por ítem para sus propios tops.
  Trigger: crear un módulo vertical nuevo, agregarle un catálogo propio, o hacer que algo
  que no es producto ni servicio se cobre en el punto de venta.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Nace una vertical nueva (`MODULE_KEYS` gana una clave) con un catálogo propio: estudios,
  tratamientos, armazones, mano de obra por tipo…
- Un módulo existente necesita que algo suyo «se cobre en caja».
- Alguien propone meter ese catálogo en `products`/`services` con una bandera, o tocar el
  POS para que «entienda» al módulo. Las dos cosas están prohibidas por la LEY de la fase 9.

## La idea en una frase

**El POS vende productos, servicios y CONCEPTOS. El módulo emite un documento con líneas
que apuntan a SU catálogo, lo convierte en una cotización (conceptos para su catálogo,
productos para lo que sale del almacén) y la caja cobra esa cotización por folio.** El POS
solo guarda dos textos opacos por línea (`source_module`, `source_ref`); jamás importa nada
del módulo. La dirección de dependencia es siempre módulo → core.

## Critical Patterns

1. **Catálogo propio, tabla propia, prefijo del módulo.** `<module>_<catalog>` con
   `tenant_id`, `code` (UNIQUE por tenant, `btrim(code) <> ''`), `name`, `description`,
   `cost`, `price` (`≥ 0`), `attributes JSONB`, `is_active`, auditoría. Sin `service_warehouses`:
   es catálogo del negocio, no del almacén. Bloque RLS canónico en la MISMA migración
   (`ENABLE` + `FORCE` + policy `tenant_isolation`). Molde: `20260903140000_f9_clinic_catalogs`,
   `study-catalog.service.ts` (clase base parametrizada por delegate, no `if kind`).
2. **El documento del módulo tiene líneas con FK REAL a su catálogo.**
   `<module>_<document>_lines` con exactamente una referencia (`num_nonnulls(...) = 1`),
   CHECK de coherencia con el tipo del documento, y SNAPSHOT de `description`, `quantity`,
   `unit_price`. El `id` de cada línea se genera ANTES de insertar (`randomUUID()`), porque
   ese id es el `source_ref` que viaja al POS. Molde: `medical_clinic_order_lines` y
   `medical-orders.service.ts#resolverLineas`.
3. **El puente es la cotización, en UNA transacción.** Resuelve TODAS las líneas antes de
   pedir folio (el lock de la serie dura hasta el commit). Para lo que sale del almacén:
   `QuotesService.resolverLineasParaModulo(tx, user, warehouseId, lines)` (hereda vencidos y
   presentaciones no vendibles). Para el catálogo propio: líneas `kind: "concept"` con
   `description` = nombre del ítem, `unitPrice` = su precio, `sourceModule` = la clave del
   módulo, `sourceRef` = id de la línea del documento; en la cabecera de la cotización,
   `sourceRef` = id del documento. El folio del documento ES el de la cotización
   (`nextFolio(tx, tenantId, "quote", "COT")`); sin serie propia cuando se cobra.
4. **Qué se vende lo decide una configuración por negocio**, no el código. Tabla
   `<module>_settings` (una fila por tenant, defaults sin fila) leída DENTRO de la tx del
   documento: si el negocio vende ese tipo → cotización; si no → folio de serie propia (tres
   letras, únicas en `ALL_FOLIO_PREFIXES`) y `quote_id` NULL, con CHECK «el prefijo no
   miente» (`folio LIKE 'COT-%' ⇔ quote_id IS NOT NULL`). Molde: `medical_clinic_settings`,
   `settings.service.ts`, LEY 26.
5. **El cobro no es del módulo.** La caja encuentra el `COT-…` en `GET /pos/lookup`,
   `for-sale` relee precios de catálogo para productos y congela el precio de los conceptos,
   y la venta identifica cada concepto por `quoteLineId` (la venta NUNCA acepta un precio del
   cliente). El módulo no necesita `pos:quote`: la cotización es interna. Estado de cobro
   derivado: `quote_id NULL` → `not_for_sale`; `quotes.status = 'loaded'` → `charged`; si no
   → `pending`. Cancelar el documento cancela la cotización si sigue `open`; cobrado → 409.
6. **Lo vendido por ítem es una VISTA, no una tabla.** `<module>_sold_items` =
   `sale_items` (por `source_module`) ⋈ líneas del documento (por `source_ref`) ⋈ catálogos,
   con `security_invoker = true` para heredar la RLS. Los tops del módulo agrupan por ID de
   catálogo (nunca por nombre) y excluyen `sales.status <> 'completed'`. Nada de tablas
   paralelas ni «ganchos» del POS hacia el módulo (LEY 28; F9-CLINIC-29/30 como molde). Ojo:
   hasta F4-CONCEPT-10 el POS solo copia el origen en líneas de concepto; los productos que
   vienen de una cotización con origen lo pierden al cobrarse.
7. **Todo documento tiene su papel.** Renderer PURO (`build<Document>Definition(input, t)`)
   con el molde de `document-pdf.renderer.ts` (LETTER, encabezado del negocio) + servicio
   con `PdfPrinter(FONTS)` + `GET /<module>/<documents>/:id/document`. El ticket térmico de
   la cotización sigue siendo de la caja. Web: `imprimirPdf` (iframe) para abrir el cuadro
   de impresión.
8. **Cableado del módulo, en el orden que compila.** `MODULE_KEYS` + `MODULE_NAV` en el
   MISMO commit (la clave nueva rompe `Record<ModuleKey, …>` del web); permisos
   `<module>:read` / `:manage` / `:<acción>` por migración SQL (Viewer solo `:read`; comentar
   en `MANAGER_EXCLUDED_CODES` qué NO se excluye y por qué); `@RequiresModule("<module>")`
   a nivel de clase en todos los controllers (402 también en GET); i18n del api en
   `<module>.json` y del web en `<module>Camel.json` (el namespace sale del NOMBRE del
   archivo); prefijos de folio de tres letras. Al activar el módulo por SQL en local:
   `DEL entitlements:<tenantId>` en Redis y volver a entrar.
9. **Web con los moldes de la casa.** Catálogo = `StudiesScreen`-like con `<Card>` para el
   formulario (skill `sellpoint-forms`), tabla con las constantes compartidas (skill
   `sellpoint-tables`); picker del catálogo por casilla (`StudyPicker`), cascarón del
   documento (`OrderFormShell`) con aviso «lista para cobrar en caja con el folio …» o
   «registrada, no se cobra en caja» según `quoteId`, y «Imprimir». Los 4xx del API se
   muestran con su `message` (ya viene traducido).

## Checklist de pruebas (lo que fija el patrón)

- Integración de esquema: RLS en cada tabla nueva (contexto A no ve B; WITH CHECK rebota);
  CHECKs de referencia única y de forma por tipo; borrar un ítem de catálogo en uso → RESTRICT.
- Unit del documento: `folio === quote.folio`; total = suma de líneas; producto sin stock →
  422 del POS; ítem inactivo → 422 propio; sin líneas → 422; sin almacén → 404; configuración
  «no vende» → folio propio y `quote_id` NULL (mutante: ignorar la configuración rompe).
- e2e: sin el módulo → 402; documento → cotización → la caja la encuentra por folio →
  `for-sale` → cobro: `sale_items` con `kind='concept'`, `source_module` y `source_ref`;
  `stock_movements` SOLO con productos; cancelar cobrado → 409; la caja NO encuentra un folio
  de la serie propia.
- Vista/top: una venta anulada desaparece; un ítem renombrado sigue en la misma fila.

## Ejemplos vivos

- API: `apps/api/src/modules/medical-clinic/{study-catalog,lab-studies,medical-orders,settings,medical-order-pdf}.service.ts`
  y `medical-order-pdf.renderer.ts`; migraciones `20260903140000_f9_clinic_catalogs`,
  `20260903160000_f9_clinic_orders`, `20260903180000_f9_clinic_settings`.
- Core del POS que lo sostiene: `packages/shared/src/pos-lines.ts` (`POS_LINE_KINDS`),
  migración `20260903120000_f4_concept_lines`, `quotes.service.ts#resolverLineasParaModulo`
  y `#forSale`, `sales.service.ts#resolverPrecios` (rama `quoteLineId`).
- Web: `apps/web/src/components/medical-clinic/{studies-screen,study-picker,order-form-shell}.tsx`,
  `routes/medical-clinic.records.$recordId.orders.$orderKind.tsx`.
- Plan y decisiones: `IMPLEMENTACION.md` LEY de la fase 9, puntos 15-28; módulos F4-CONCEPT y
  F9-CLINIC. Engram: `sellpoint/f9-clinic-atomizacion`, `sellpoint/f9-clinic-settings`,
  `sellpoint/module-sold-items`.

## Anti-patrones

- Un catálogo vertical dentro de `products` o `services` con una columna «tipo».
- Una `LookupStrategy` nueva para que el buscador de la caja encuentre ítems del módulo: la
  caja carga la COTIZACIÓN por folio, no el catálogo.
- Un `source_ref` con FK desde el core a una tabla del módulo, o un `import` del módulo en
  `pos/`.
- Una tabla `<module>_sales` escrita al cobrar: segunda verdad que hay que sincronizar.
- Un top que agrupa por nombre.
- Registrar la clave del módulo sin su entrada de navegación en el mismo commit.
