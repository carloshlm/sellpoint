# Manual de usuario de SellPointy

El manual que leen los clientes: cómo usar SellPointy, pantalla por pantalla.
Se **genera**, no se escribe como documento fijo, porque el sistema cambia cada
semana y un PDF con capturas pegadas a mano envejece en días.

| Pieza | Dónde vive | Estado |
|---|---|---|
| Textos, un archivo por capítulo | `docs/manual/es/` | 28 de 38: el capítulo 2, las partes 3 a 7 y los apéndices |
| El registro de pantallas: qué captura cita cada capítulo y cómo se toma | `apps/manual/src/screens/`, un archivo por parte | Listo |
| El generador: levanta un SellPointy aparte, crea el negocio de demostración, toma las capturas y arma el PDF | `apps/manual/` | Listo |
| El PDF y las capturas | `docs/manual/dist/` (no se versiona) | Se genera |
| La regla que lo mantiene al día: cada cambio de pantalla actualiza su capítulo | una skill + una prueba (fase 4) | Por construir |

## Cómo se genera

Con Colima encendido (Postgres y Redis), desde la raíz:

```bash
pnpm manual       # todo: capturas nuevas y PDF (unos 2 minutos)
pnpm manual:pdf   # solo el PDF, con las capturas que ya hay: para corregir un texto
```

Para escribir un capítulo con el sistema a la mano:

```bash
pnpm --filter manual manual --serve               # levanta y siembra, y lo deja encendido en :5199
pnpm --filter manual exec tsx src/shoot.ts 04-inventory   # retoma solo esas capturas
```

El resultado queda en `docs/manual/dist/SellPointy-Manual-de-usuario-v<versión>.pdf`.
La versión es la del `package.json` raíz.

Lo que hace `pnpm manual`, para que nada sorprenda:

- **Borra y recrea la base `sellpoint_manual`**, solo esa: nunca toca `sellpoint_dev` ni
  `sellpoint_test`. Enciende su propio API en `:3100` y su propio web, compilado, en `:5199`,
  y los apaga al terminar.
- **Crea el negocio de demostración por el camino de un cliente real**: se registra, verifica
  el correo con el enlace que el API escribe en su consola y termina el asistente de alta.
  Es «Abarrotes La Esquina», de Ana Pérez (`ana.perez@example.com`), en México.
- **Compila el API**, y eso le quita las traducciones a un API de desarrollo encendido: el
  generador avisa, y basta con reiniciarlo después.

## Cómo se escribe un capítulo

Cada archivo abre con un bloque que dice qué es y para quién:

```markdown
---
title: Entrar, salir y tu contraseña
who: todos          (todos · cajero · dueño)
plan: Desde Pro     (opcional; sin él, el capítulo es de todos los planes)
---
```

Después es Markdown normal. Una captura se cita por su nombre en el registro de pantallas:
`![Texto que va de pie de foto](screen:sign-in)`. Si el capítulo cita una captura que no
existe, el PDF no se arma y dice cuál falta.

## Las fases (aprobadas por Carlos el 2026-09-23)

1. ✅ **El índice** — este documento.
2. ✅ Las capturas automáticas y el PDF, probados con el capítulo 2.
3. Los capítulos. Hechas las partes 3 a 7 y los apéndices (2026-09-24); faltan la Parte 1 (salvo el capítulo 2), la Parte 2 y la portada.
4. La regla para mantenerlo al día.

## Reglas del contenido

- **Español neutro con «tú»**, para el dueño o el cajero de un negocio pequeño, sin jerga técnica.
  Primero solo en español; el inglés viene después, en `docs/manual/en/`.
- **Describe lo que SellPointy hace HOY.** Nada que esté en camino, nada inventado.
- Cada capítulo dice **quién lo usa** (todos, cajero, dueño) y, si aplica, **desde qué plan**,
  con las mismas marcas del sitio: *Desde Basic*, *Desde Pro*, *En Plus*.
- Las capturas salen de un **negocio de demostración con datos inventados**
  (el agua, el queso y el aceite del sitio). Nunca de un cliente.
- Los nombres de archivo van en inglés (los lee un script); el texto, en español.

## Fuera del manual

- **Recepción y Consultorio médico:** módulos a la medida; el consultorio está en pausa
  (pendiente NOM-024). Entran cuando tengan clientes.
- **El Backoffice:** solo lo usa Carlos.

## El índice

La **Parte 2 se puede imprimir sola** como guía corta del cajero.

| # | Capítulo | Archivo | Quién | Plan |
|---|---|---|---|---|
| — | Portada y «Cómo leer este manual» | `00-read-me.md` | todos | — |
| | **Parte 1 — Primeros pasos** | | | |
| 1 | Crear tu cuenta y el asistente de alta | `01-start/01-create-account.md` | todos | — |
| 2 | Entrar, salir y tu contraseña | `01-start/02-sign-in.md` | todos | — |
| 3 | Conoce la pantalla: menú, idioma, tema e instalar la app | `01-start/03-the-screen.md` | todos | — |
| 4 | Mi perfil: tus datos | `01-start/04-my-profile.md` | todos | — |
| | **Parte 2 — Vender** | | | |
| 5 | Tu turno de caja: abrir, cerrar y arqueo | `02-sell/05-cash-shift.md` | cajero | — |
| 6 | Hacer una venta | `02-sell/06-make-a-sale.md` | cajero | — |
| 7 | El ticket: imprimirlo y reimprimirlo | `02-sell/07-ticket.md` | cajero | — |
| 8 | Historial de ventas | `02-sell/08-sales-history.md` | cajero | — |
| 9 | Cotizaciones | `02-sell/09-quotes.md` | cajero | Desde Pro |
| 10 | Gastos pagados desde el cajón | `02-sell/10-drawer-expenses.md` | cajero | Desde Basic |
| 11 | Tu panel de vendedor | `02-sell/11-seller-dashboard.md` | cajero | — |
| | **Parte 3 — Preparar tu negocio** | | | |
| 12 | Datos del negocio y el ticket | `03-setup/12-business-and-ticket.md` | dueño | — |
| 13 | Impuestos | `03-setup/13-taxes.md` | dueño | — |
| 14 | Descuentos y su código de autorización | `03-setup/14-discounts.md` | dueño | — |
| 15 | Sucursales | `03-setup/15-stores.md` | dueño | — |
| 16 | Productos | `03-setup/16-products.md` | dueño | — |
| 17 | Productos compuestos: recetas y kits | `03-setup/17-composite-products.md` | dueño | Desde Pro |
| 18 | Servicios | `03-setup/18-services.md` | dueño | — |
| 19 | Proveedores | `03-setup/19-suppliers.md` | dueño | Desde Basic |
| 20 | Importar y exportar con Excel | `03-setup/20-spreadsheets.md` | dueño | — |
| 21 | Campos y subcatálogos propios | `03-setup/21-custom-catalogs.md` | dueño | En Plus |
| | **Parte 4 — Inventario** | | | Desde Pro |
| 22 | Existencias y kardex | `04-inventory/22-stock-and-kardex.md` | dueño | Desde Pro |
| 23 | Entradas y salidas | `04-inventory/23-entries-and-exits.md` | dueño | Desde Pro |
| 24 | Traspasos entre sucursales | `04-inventory/24-transfers.md` | dueño | Desde Pro |
| 25 | Inventario físico: el conteo | `04-inventory/25-physical-count.md` | dueño | Desde Pro |
| 26 | Lotes y próximos a vencer | `04-inventory/26-lots-and-expiry.md` | dueño | En Plus |
| | **Parte 5 — Compras y gastos** | | | |
| 27 | Gastos | `05-purchasing/27-expenses.md` | dueño | Desde Basic |
| 28 | Compras con la factura del proveedor | `05-purchasing/28-purchases.md` | dueño | Desde Pro |
| 29 | Órdenes de compra y recepciones | `05-purchasing/29-purchase-orders.md` | dueño | En Plus |
| | **Parte 6 — Cómo va tu negocio** | | | |
| 30 | El panel | `06-insights/30-dashboard.md` | dueño | — |
| 31 | Reportes y exportarlos a Excel | `06-insights/31-reports.md` | dueño | Desde Basic |
| | **Parte 7 — Tu equipo y tu cuenta** | | | |
| 32 | Usuarios: invitar y asignarles sucursal | `07-team/32-users.md` | dueño | — |
| 33 | Roles: los de fábrica y los personalizados | `07-team/33-roles.md` | dueño | En Plus (personalizados) |
| 34 | Mi plan: pagos, siguiente cobro y qué pasa si vence | `07-team/34-my-plan.md` | dueño | — |
| | **Apéndices** | | | |
| A | Qué incluye cada plan | `90-appendix/a-plans.md` | todos | — |
| B | Qué puede hacer cada rol | `90-appendix/b-roles.md` | todos | — |
| C | Tu equipo: lector de código de barras e impresora de tickets | `90-appendix/c-hardware.md` | todos | — |
| D | Problemas comunes | `90-appendix/d-troubleshooting.md` | todos | — |

Unas 60 a 80 páginas, con capítulos cortos de 1 a 3 páginas.
