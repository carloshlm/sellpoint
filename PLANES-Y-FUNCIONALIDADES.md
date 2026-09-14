# SellPointy — Planes y funcionalidades

> Documento de trabajo para armar la **lista comercial final de planes**.
> Corte: 2026-09-13, versión 1.0.4. Todo lo que dice «hoy» está verificado contra el código y la base de datos de producción, no contra la intención.

## Cómo leer este documento

1. **Los planes tal como están configurados hoy.** Precios, límites y qué desbloquea cada uno.
2. **El inventario completo de funcionalidades.** Todo lo que el sistema ya hace, agrupado por área, con el plan mínimo en el que vive hoy. Es la lista de donde sale lo que puedes poner en cada plan.
3. **Lo que falta en la vitrina.** Funcionalidades que existen y el cliente no ve al elegir plan.
4. **Candados que no se cumplen.** Lo que la vitrina promete por plan y nada bloquea.
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

| Funcionalidad del plan | Free | Basic | Pro | Plus | Premium |
|---|:-:|:-:|:-:|:-:|:-:|
| Punto de venta | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reportes y exportación | — | ✅ | ✅ | ✅ | ✅ |
| **Gastos** (módulo) | — | ✅ | ✅ | ✅ | ✅ |
| Cotizaciones | — | — | ✅ | ✅ | ✅ |
| Movimientos de inventario | — | — | ✅ | ✅ | ✅ |
| Traspasos entre almacenes | — | — | ✅ | ✅ | ✅ |
| Productos compuestos (recetas, kits) | — | — | ✅ | ✅ | ✅ |
| **Compras** (módulo, incluye órdenes de compra) | — | — | ✅ | ✅ | ✅ |
| Lotes y caducidades | — | — | — | ✅ | ✅ |
| Campos y catálogos personalizados | — | — | — | ✅ | ✅ |
| Roles personalizados | — | — | — | ✅ | ✅ |
| Módulos verticales (Recepción, Consultorio médico) | — | — | — | — | ✅ pactado |
| Desarrollo a la medida | — | — | — | — | ✅ |

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
| Plus | Todo: lotes y caducidades, personalización profunda |
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
| **Órdenes de compra** con costo acordado y fecha de entrega esperada | Pro, activable por negocio |
| Órdenes de compra impresas en PDF para el proveedor | Pro, activable por negocio |
| **Recepciones parciales** de una orden, con lote, caducidad y remisión | Pro, activable por negocio |
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

## 3. Lo que falta en la vitrina

La ventana de planes solo sabe mostrar usuarios, almacenes y **10 funcionalidades**: punto de venta, compuestos, cotizaciones, movimientos, traspasos, lotes, campos personalizados, roles personalizados, reportes y exportación. Todo lo demás existe, se entrega, y **el cliente no lo ve al comparar planes**:

- **Compras, órdenes de compra y recepciones parciales.** Es de lo más valioso de Pro y hoy no aparece.
- **Gastos.** Viene desde Basic y tampoco se muestra.
- **Proveedores con código y campos propios.**
- **Importación y exportación por Excel.**
- **Impuestos por país**, precio y costo con o sin impuesto.
- **Ticket configurable** con logotipo, en 58 u 80 mm.
- **Descuento protegido con código de autorización.**
- **Turno de caja y arqueo.**
- **App instalable.**
- **Panel del negocio y panel del vendedor.**
- **Español e inglés**, y cinco monedas.
- **Bitácora de auditoría.**
- **Módulos verticales.** Premium no se publica, así que Recepción y Consultorio médico no existen para quien compara planes.

## 4. Candados que la vitrina promete y el sistema no cumple

Antes de fijar la lista final conviene saber esto: la matriz de planes dice que ciertas funcionalidades son de un plan, pero **nada las bloquea** para un plan menor. Un negocio Basic hoy puede usarlas si tiene el permiso.

| Funcionalidad | La matriz dice | Dónde se bloquea hoy |
|---|---|---|
| Productos compuestos | Pro | En ningún lado |
| Roles personalizados | Plus | En ningún lado |
| Campos y subcatálogos personalizados | Plus | Solo se esconde en el menú; el servidor no lo impide |
| Reportes y exportación | Basic | En ningún lado; la migración del 2026-09-06 lo dice explícitamente |
| Kardex | Pro, con los movimientos | En ningún lado |

Sí se bloquean de verdad, en el servidor: cotizaciones, movimientos de inventario, traspasos, lotes, Compras, Gastos, Recepción, Consultorio médico, el límite de usuarios y almacenes, las 10 ventas diarias de Free y el modo de solo lectura.

**Por qué importa:** si un plan se va a vender por una funcionalidad, esa funcionalidad tiene que estar bloqueada en los planes de abajo, o el cliente que paga menos recibe lo mismo. Conviene cerrar estos candados antes de publicar la lista nueva.

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
2. **Pro es el plan de las compras.** Órdenes de compra, recepciones parciales y facturas con puente al inventario son lo que separa a SellPointy de un POS básico, y hoy Pro se vende solo como «inventario, cotizaciones y traspasos».
3. **Basic ya incluye más de lo que dice.** Reportes con exportación y Gastos entran desde Basic; «POS completo sin control de inventario» lo describe por lo que le falta.
4. **Plus es el plan de quien vende caducidad.** Farmacias, alimentos y cosméticos necesitan lotes y próximos a vencer; decirlo con el rubro vende más que «personalización profunda».
5. **Premium merece una vitrina.** Aunque el precio sea pactado, mostrar que existen Recepción, Consultorio médico y el desarrollo a la medida atrae al cliente que ya sabe que los necesita.
6. **Lo que ya dan todos los planes es argumento de venta.** Impuestos de tres países, ticket con logotipo, app instalable y dos idiomas no suben de plan, pero la competencia cobra por varios de ellos.
