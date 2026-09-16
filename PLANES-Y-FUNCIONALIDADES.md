# SellPointy — Planes y funcionalidades

> Documento de trabajo para armar la **lista comercial final de planes**.
> Corte: 2026-09-15 (lista comercial cerrada por Carlos; candados aplicados). Todo lo que dice «hoy» está verificado contra el código y la base de datos de producción, no contra la intención.

## Cómo leer este documento

1. **Los planes tal como están configurados hoy.** Precios, límites y qué desbloquea cada uno.
2. **El inventario completo de funcionalidades.** Todo lo que el sistema ya hace, agrupado por área, con el plan mínimo en el que vive hoy. Es la lista de donde sale lo que puedes poner en cada plan.
3. **Lo que la vitrina muestra y lo que no.** Las 17 líneas de cada tarjeta, y lo que sigue sin decirse.
4. **Los candados.** Dónde se bloquea cada funcionalidad, en el servidor y en la pantalla.
5. **Lo que está en camino.** Para no venderlo antes de tiempo.

---

## 1. Los planes hoy

### Precios

| Plan | México | Estados Unidos | Canadá | Se publica |
|---|---|---|---|---|
| Free | — | — | — | No |
| Basic | $199 MXN | $15 USD | $29 CAD | Sí |
| Pro | $349 MXN | $29 USD | $49 CAD | Sí |
| Plus | $499 MXN | $45 USD | $89 CAD | Sí |
| Premium | Precio pactado | Precio pactado | Precio pactado | No |

- El pago **anual cuesta 10 meses**: dos meses gratis. Es una regla de la base de datos, no un descuento manual.
- Un país sin precio propio usa el de Estados Unidos.
- Canadá subió de 19/39/59 a 29/49/89 el 2026-09-06, para quedar justo debajo de Square, Erply y Shopify POS.

### Límites y reglas

| | Free | Basic | Pro | Plus | Premium |
|---|---|---|---|---|---|
| Usuarios | 1 | 3 | 6 | 20 | Sin límite |
| Almacenes | 1 | 1 | 4 | 10 | Sin límite |
| Ventas por día | 10 | Sin límite | Sin límite | Sin límite | Sin límite |
| Puede capturar y editar | Solo lectura | Sí | Sí | Sí | Sí |
| Control de existencias | No | No | Sí | Sí | Sí |

- **Prueba gratis:** 14 días con el plan **Plus** completo.
- **Periodo de gracia:** 10 días después del vencimiento antes de pasar a Free.
- **Basic vende sin existencias:** no controla stock, así que permite vender con saldo negativo. Desde Pro, cada negocio decide si permite vender sin existencias.

### Qué desbloquea cada plan

Es la lista comercial que Carlos cerró el 2026-09-15, en el orden en que la ventana de planes la muestra: primero todo lo de Basic, luego lo que agrega cada escalón.

| Línea de la vitrina | Free | Basic | Pro | Plus | Premium |
|---|:-:|:-:|:-:|:-:|:-:|
| Punto de venta y tickets | ✅ | ✅ | ✅ | ✅ | ✅ |
| Turno de caja con arqueo | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ticket con tu logo, en 58 u 80 mm | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reportes | — | ✅ | ✅ | ✅ | ✅ |
| Exportar reportes | — | ✅ | ✅ | ✅ | ✅ |
| **Gastos** (módulo) | — | ✅ | ✅ | ✅ | ✅ |
| Control de inventario | — | — | ✅ | ✅ | ✅ |
| Entradas, salidas y kardex | — | — | ✅ | ✅ | ✅ |
| Traspasos entre almacenes | — | — | ✅ | ✅ | ✅ |
| Cotizaciones | — | — | ✅ | ✅ | ✅ |
| Productos compuestos: recetas y kits | — | — | ✅ | ✅ | ✅ |
| **Compras** (módulo: la compra directa con factura) | — | — | ✅ | ✅ | ✅ |
| Órdenes de compra y recepciones parciales | — | — | — | ✅ | ✅ |
| Lotes y caducidades | — | — | — | ✅ | ✅ |
| Subcatálogos y campos propios | — | — | — | ✅ | ✅ |
| Roles personalizados | — | — | — | ✅ | ✅ |
| Módulos a la medida de tu negocio (Recepción, Consultorio médico…) | — | — | — | — | ✅ pactado |

Turno de caja y ticket con logo no suben de plan: se listan porque son argumento de venta y hasta el 2026-09-15 no se decían. Las órdenes de compra dejaron de ir dentro de Compras: son el escalón de Plus (flag `purchase_orders`, en AND con el módulo), y se listan PEGADAS a Compras aunque rompan la escalera — se leen juntas (Carlos, 2026-09-15).

**Cómo funcionan los módulos.** Hay dos clases:

- **Módulo de plan.** Viene incluido desde un plan mínimo: Gastos desde Basic y Compras desde Pro. También se puede pactar como extra en un plan menor sin subir de plan.
- **Módulo vertical pactado.** Recepción y Consultorio médico no se incluyen en ningún plan público. Activar uno convierte al negocio en **Premium con precio pactado**.

### Lo que hoy lee el cliente al elegir plan

Estas son las frases que muestra la ventana de planes, textuales:

| Plan | Descripción |
|---|---|
| Free | Modo gratuito: consulta y hasta 10 ventas al día |
| Basic | POS completo sin control de inventario |
| Pro | Inventario completo, cotizaciones y traspasos |
| Plus | Lotes y caducidades, órdenes de compra y personalización profunda |
| Premium | Plus sin límites más desarrollo a la medida |

---

## 2. Inventario completo de funcionalidades

La columna **Hoy** dice el plan mínimo en el que vive cada funcionalidad. «Todos» significa que no depende del plan, solo del permiso del usuario.

### Punto de venta

| Funcionalidad | Hoy |
|---|---|
| Venta con buscador por nombre, código o código de barras | Todos |
| Venta de productos, servicios y conceptos libres | Todos |
| Presentaciones de venta (pieza, caja, kilo) con su precio | Todos |
| Cantidades fraccionadas solo donde la unidad lo permite | Todos |
| Cobro en efectivo, tarjeta y transferencia, con cambio | Todos |
| Descuento al ticket protegido con código de autorización | Todos |
| Turno de caja: apertura, cierre y arqueo con diferencia | Todos |
| Gastos pagados desde el cajón que se restan del arqueo | Basic |
| Historial de ventas con filtros | Todos |
| Ticket en PDF de 58 u 80 mm | Todos |
| Ticket configurable: logotipo, qué datos del negocio se imprimen, mensaje propio | Todos |
| Marca de impuesto por línea en el ticket | Todos |
| Mostrar u ocultar existencias en la pantalla de venta | Todos (útil desde Pro, que controla existencias) |
| Vender sin existencias, a elección del negocio | Pro |
| Cotizaciones: crear, imprimir y convertir en venta | Pro |
| App instalable en computadora, tablet y celular (PWA) | Todos |

### Impuestos y dinero

| Funcionalidad | Hoy |
|---|---|
| Impuestos por país: México (IVA), Canadá (GST, HST, PST, QST) y Estados Unidos (sales tax) | Todos |
| Precio con o sin impuesto incluido, a elección del negocio | Todos |
| Costo con o sin impuesto incluido, sembrado según el país | Todos |
| Grupos de impuesto propios y un impuesto predeterminado | Todos |
| Reporte de impuestos cobrados | Basic |
| Monedas: peso mexicano, dólar estadounidense, dólar canadiense, euro y libra | Todos |
| Registro fiscal validado por país: RFC en México, Business Number con cuenta GST/HST en Canadá | Todos |

### Catálogos

| Funcionalidad | Hoy |
|---|---|
| Productos con código, código de barras, categoría e impuesto | Todos |
| Presentaciones con factor de conversión, costo y precio | Todos |
| Unidades de medida con conversión (pieza, kilo, litro, metro…) | Todos |
| Servicios | Todos |
| Almacenes con dirección y datos de contacto | Todos |
| Proveedores con código propio (PROV-001) | Todos |
| Importación y exportación por Excel: productos, servicios, almacenes y proveedores | Todos |
| Plantilla de importación en el idioma del usuario, con errores que dicen la columna | Todos |
| Productos compuestos: recetas y kits que descuentan sus componentes | Pro |
| Campos personalizados en productos, servicios, almacenes y proveedores | Plus |
| Subcatálogos propios (listas que el negocio define) | Plus |

### Inventario

| Funcionalidad | Hoy |
|---|---|
| Entradas y salidas con folio, borrador y PDF | Pro |
| Traspasos entre almacenes con envío y recepción | Pro |
| Inventario físico: plantilla, conteo, conciliación y aprobación | Pro |
| Kardex por producto | Todos |
| Costo promedio ponderado | Pro |
| Existencias por almacén y valorización | Pro |
| Ubicación del producto dentro del almacén | Todos |
| Lotes y fechas de caducidad | Plus |
| Pantalla de próximos a vencer | Plus |

### Compras y gastos

| Funcionalidad | Hoy |
|---|---|
| **Gastos** con categoría, proveedor o beneficiario, impuesto y vencimiento | Basic |
| 18 categorías de gasto de fábrica, más las propias | Basic |
| Gasto pendiente de pago, y pago posterior con método y cuenta | Basic |
| Exportación de gastos | Basic |
| **Compras**: la factura del proveedor con sus líneas, impuestos y cargos extra | Pro |
| Aviso cuando el total de la factura no cuadra con sus líneas | Pro |
| Puente de la compra a la entrada de inventario | Pro |
| Actualización del costo del catálogo desde la compra | Pro |
| Último costo pagado a cada proveedor, sugerido al capturar | Pro |
| **Órdenes de compra** con costo acordado y fecha de entrega esperada | Plus, activable por negocio |
| Órdenes de compra impresas en PDF para el proveedor | Plus, activable por negocio |
| **Recepciones parciales** de una orden, con lote, caducidad y remisión | Plus, activable por negocio |
| Cerrar una línea corta cuando ya no llegará lo que falta | Pro, activable por negocio |
| Facturar una o varias recepciones en una sola compra | Pro, activable por negocio |
| Aviso de variación de precio y de cantidad entre orden, recepción y factura | Pro, activable por negocio |

### Reportes y panel

| Funcionalidad | Hoy |
|---|---|
| Panel del negocio con indicadores del período, incluida la utilidad | Todos |
| Panel del vendedor: su turno, lo cobrado y sus ventas | Todos |
| Reporte de ventas por período | Basic |
| Reporte de cierres de turno | Basic |
| Reporte de existencias | Basic |
| Reporte de impuestos | Basic |
| Exportación de reportes a Excel | Basic |

### Usuarios, seguridad y negocio

| Funcionalidad | Hoy |
|---|---|
| Invitación de usuarios por correo | Todos |
| Roles de fábrica: Admin, Manager, Seller y Viewer | Todos |
| Roles personalizados con permisos a elegir | Plus |
| Alcance por almacén: cada usuario opera solo los suyos | Todos |
| Almacén asignado por usuario | Todos |
| Verificación de correo y recuperación de contraseña | Todos |
| Bitácora de auditoría de cada cambio | Todos |
| Asistente de alta del negocio | Todos |
| Idioma por usuario: español e inglés | Todos |
| Nombres, direcciones y códigos postales con el formato de cada país | Todos |
| Mi plan: historial de pagos y fecha del siguiente cobro | Todos |

### Módulos verticales

| Funcionalidad | Hoy |
|---|---|
| **Recepción**: registro de clientes y turnos con ticket de turno | Premium pactado |
| **Consultorio médico**: pacientes y expediente | Premium pactado |
| Historia clínica completa: 16 formularios | Premium pactado |
| Diagnósticos con catálogo CIE-10 | Premium pactado |
| Catálogos de estudios de laboratorio y diagnósticos, con precio | Premium pactado |
| Órdenes de estudios | Premium pactado |
| Notas médicas, referencias e interconsultas | Premium pactado |
| Datos del médico en el papel: cédula profesional y especialidad | Premium pactado |
| Cobro de consultas y estudios en caja, a través de la cotización | Premium pactado |

---

## 3. Lo que la vitrina muestra y lo que no

Desde el 2026-09-15 cada tarjeta lista las **17 líneas** de la tabla de arriba, siempre en el mismo orden y con palomita o guion, para comparar de un vistazo. Lo que sigue existiendo sin decirse al comparar planes, porque lo dan todos y no distingue a ninguno:

- **Proveedores con código y campos propios.**
- **Importación y exportación por Excel.**
- **Impuestos por país**, precio y costo con o sin impuesto.
- **Descuento protegido con código de autorización.**
- **App instalable.**
- **Panel del negocio y panel del vendedor.**
- **Español e inglés**, y cinco monedas.
- **Bitácora de auditoría.**

## 4. Los candados

Regla de la casa: el flag del plan frena **mutaciones** en el servidor (crear, editar, borrar responde 402) y nunca las lecturas — un negocio que baja de plan sigue viendo lo que hizo. En la pantalla, además, el menú pone candado y la URL de la pantalla muestra la tarjeta «no está en tu plan» en vez de la pantalla (F9-PLANLIST-05). Estado al 2026-09-15:

| Funcionalidad | Plan | Servidor | Pantalla |
|---|---|---|---|
| Cotizaciones | Pro | 402 al crear | Candado en menú y en la ruta |
| Entradas, salidas, inventario físico y kardex | Pro | 402 al crear documentos | Candado en menú y en las rutas; pestañas de stock y kardex del producto ocultas |
| Traspasos | Pro | 402 al crear | Candado en menú y en la ruta |
| Productos compuestos | Pro | 402 al armar la composición | Interruptor «se arma a partir de otros» apagado con aviso; pestaña de composición en solo lectura |
| Compras (módulo) | Pro | 402 hasta para leer sin el módulo | El grupo del menú no existe |
| Lotes y caducidades | Plus | 402 al editar lotes | Candado en «Próximos a vencer» |
| Subcatálogos y campos propios | Plus | 402 al crear o editar catálogos, campos y registros | Candado en menú y en las rutas |
| Roles personalizados | Plus | 402 al crear, editar o borrar roles; la lista se lee para asignar | Página de solo lectura con la tarjeta de candado |
| Órdenes de compra y recepciones | Plus | 402 al crear (módulo Compras en AND) | Candado en el enlace del menú y en las cuatro rutas; el ajuste de Mi perfil se ve deshabilitado |
| Reportes y exportación | Basic | Nada: Free es de solo lectura y no llega | Menú por permiso |
| Usuarios, almacenes, ventas diarias de Free, solo lectura | Todos | Sí | Sí |

Reportes es el único renglón de la vitrina sin candado propio: Free no puede escribir y Basic ya lo incluye, así que no hay a quién frenar.

## 5. Lo que está en camino

No conviene venderlo todavía:

| Qué | Estado |
|---|---|
| Costo neto de la venta y del compuesto cuando el costo se captura con impuesto | En construcción |
| App móvil nativa | Futuro, solo concepto |
| Verticales de dental, óptica y taller | Concepto, sin construir |
| Cobro en línea con tarjeta desde Mi plan | Pospuesto: hoy los pagos se registran desde el backoffice |

---

## Ideas para hacer la lista más atractiva

Propuestas para discutir, no decisiones:

1. **Vender el trabajo, no el flag.** «Movimientos de inventario» no dice nada a un comerciante; «Entradas, salidas, traspasos e inventario físico» sí.
2. **Pro es el plan de las compras; Plus, el de planearlas.** La compra directa con factura y puente al inventario es de Pro; las órdenes al proveedor con recepciones parciales son el escalón de Plus (decisión del 2026-09-15).
3. **Basic ya incluye más de lo que dice.** Reportes con exportación y Gastos entran desde Basic; «POS completo sin control de inventario» lo describe por lo que le falta.
4. **Plus es el plan de quien vende caducidad.** Farmacias, alimentos y cosméticos necesitan lotes y próximos a vencer; decirlo con el rubro vende más que «personalización profunda».
5. **Premium merece una vitrina.** Aunque el precio sea pactado, mostrar que existen Recepción, Consultorio médico y el desarrollo a la medida atrae al cliente que ya sabe que los necesita.
6. **Lo que ya dan todos los planes es argumento de venta.** Ticket con logotipo y turno de caja con arqueo ya se dicen en cada tarjeta desde el 2026-09-15; impuestos de tres países, app instalable y dos idiomas siguen sin decirse, y la competencia cobra por varios de ellos.
