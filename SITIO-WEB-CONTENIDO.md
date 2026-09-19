# Sitio web de SellPointy — contenido

> **Estado (2026-09-18):** §4, el texto maestro en español, y §7, el inglés, **APROBADOS por Carlos**. §8, el francés, va en **francés neutro y sin revisor externo** por decisión de Carlos. Lo demás, según cada sección. Es la salida del
> grupo **F11-SITE-DEF** de `IMPLEMENTACION.md`. El diseño vive en
> [`SITIO-WEB-DISENO.md`](SITIO-WEB-DISENO.md); aquí va lo que el sitio DICE.
>
> **Regla de este documento:** cada afirmación está contrastada con el código o
> con `PLANES-Y-FUNCIONALIDADES.md`. Lo que no pude verificar está marcado con
> **⚠️ POR CONFIRMAR** y no se publica hasta resolverlo. Nada de cifras de
> clientes, testimonios ni logos que no existan.

## 0. Tres hechos que ordenan todo lo demás

Verificados el 2026-09-18, antes de escribir una sola promesa:

1. **SellPointy cobra por transferencia y a mano.** El cliente transfiere y Carlos
   registra el pago en el backoffice (`billing/README.md`); Stripe está pospuesto.
   **El sitio no puede tener un «Comprar ahora».** El camino real de una venta es:
   *crea tu cuenta → 14 días con todo → te escribimos → eliges plan → transfieres.*
2. **«Sin tarjeta» es verdad por construcción:** el alta pide nombre, apellido,
   correo y contraseña. No hay captura de tarjeta en ningún punto del sistema.
3. **El sitio tiene, por lo tanto, DOS acciones y no una:**
   - **«Empieza gratis»** → `app.sellpointy.com/register`. Para quien ya decidió probar.
   - **«Quiero este plan»** → el formulario de interés. Para quien quiere hablar antes.

   La primera es la principal y va en el menú, en el hero y en el cierre. La
   segunda vive en la sección de planes. Mezclarlas en un solo botón confunde a
   los dos tipos de visitante.

---

## 1. La promesa, por mercado — `F11-SITE-DEF-01`

**A quién le hablamos:** a la persona que atiende su propio mostrador. No es un
gerente de sistemas ni compara fichas técnicas: quiere dejar de perder tiempo y
dinero, y desconfía de «los sistemas» porque ya le vendieron uno que nadie usó.

**Contra qué compite SellPointy** cambia con el país, y por eso la promesa también:

| Mercado | El visitante hoy usa… | Lo que más le duele | La promesa |
|---|---|---|---|
| **México** | Libreta, Excel, la calculadora, o un punto de venta viejo instalado en una sola computadora | No saber cuánto tiene ni cuánto gana; las filas; la mercancía que se echa a perder | **«Vende, controla tu inventario y compra mejor desde una sola pantalla — sin instalar nada.»** |
| **Estados Unidos** | Square o Clover, o nada | Pagar de más por funciones que no usa; un inventario que se queda corto; atender en español y en inglés | **“Point of sale and real inventory in one place — in English or Spanish, at a price a small shop can carry.”** |
| **Canadá** | Square, Shopify POS, Lightspeed | El precio mensual; que el inventario serio (lotes, caducidades, varias sucursales) cueste un plan superior | **“The point of sale with serious inventory — lots, expiry dates and multiple stores — without the enterprise price.”** |

La frase de marca es la misma en todos: **«Tus ventas son el punto»** (se traduce
en DEF-07 y DEF-08; el juego de palabras con «punto» no sobrevive tal cual al
inglés ni al francés, y eso hay que resolverlo ahí, no forzarlo).

> **DECIDIDO por Carlos el 2026-09-18: el sitio NO nombra a ningún competidor**, en
> ningún idioma. La columna «El visitante hoy usa…» de la tabla de arriba es
> **análisis interno** —sirve para escribir con puntería— y **no se publica**. El
> argumento se sostiene solo: «sin el precio de un sistema empresarial».
>
> Las razones, para quien lo quiera reabrir: un nombre ajeno envejece mal (cambian
> de precio o de plan y el sitio queda diciendo algo falso), obliga a vigilar que
> cada comparación siga siendo verdad, y en Canadá la publicidad comparativa tiene
> reglas propias. Las comparativas siguen en los pospuestos de `F11-SITE`.

## 2. El mapa del sitio y el menú — `F11-SITE-DEF-02`

**Una sola página larga**, más las páginas legales. Un producto con pocas secciones
no necesita más, y cada clic de más es gente que se va.

```
sellpointy.com/es-mx/          ← la página (una por mercado e idioma)
  #que-hace  #beneficios  #planes  #preguntas  #contacto
sellpointy.com/es-mx/privacidad
sellpointy.com/es-mx/terminos
```

**El menú (cinco entradas, el máximo):**

| Posición | Texto | Lleva a |
|---|---|---|
| Izquierda | Logo SellPointy | Arriba de la página |
| Centro | Qué hace | `#que-hace` |
| Centro | Beneficios | `#beneficios` |
| Centro | Planes | `#planes` |
| Centro | Preguntas | `#preguntas` |
| Derecha | 🌐 País e idioma | El selector |
| Derecha | Iniciar sesión | `app.sellpointy.com/login` — enlace de texto, discreto |
| Derecha | **Empieza gratis** | `app.sellpointy.com/register` — el único botón con color |

- «Para quién» **no** va en el menú: es una sección corta que se encuentra sola al bajar.
- «Iniciar sesión» **sí** va arriba: los clientes actuales van a teclear
  `sellpointy.com` por costumbre y tienen que encontrar la puerta en un segundo.
- En celular: logo + «Empieza gratis» + el menú plegado. El botón no se esconde nunca.
- El menú se queda pegado arriba al bajar, con fondo sólido.

**El pie:** las mismas anclas, Privacidad, Términos, el selector de país e idioma,
el correo de contacto y «© 2026 SellPointy».

> **⚠️ POR CONFIRMAR — el correo de contacto público.** `carls.hlm@gmail.com` es
> personal y recibe los avisos del formulario, pero **no debería ser el que se
> publica**: lo cosechan los robots y un Gmail le resta seriedad a un producto
> que cobra. Propuesta: `hola@sellpointy.com` (o `hello@`) reenviado a tu Gmail.

## 3. Las secciones y el trabajo de cada una — `F11-SITE-DEF-03`

El orden sigue las preguntas que se hace alguien antes de comprar. **Una sección
que no responde una pregunta se quita.**

| # | Sección | La pregunta del visitante | Su única llamada a la acción |
|---|---|---|---|
| 1 | **Hero** | «¿Qué es esto y es para mí?» | Empieza gratis |
| 2 | **Qué hace** | «¿Qué puedo hacer con esto?» | — (sigue leyendo) |
| 3 | **En tu mostrador** *(2026-09-19)* | «¿Cómo se ve usarlo?» — la foto de una venta | — |
| 4 | **Beneficios** | «¿Y eso a mí qué me deja?» | — |
| 5 | **Tu panel** *(2026-09-19)* | «¿Y cómo sé cómo va mi negocio?» — el panel, dibujado | — |
| 6 | **Para quién** | «¿Sirve para un negocio como el mío?» | — |
| 7 | **Planes** | «¿Qué incluye y cuál me toca?» | Quiero este plan → formulario |
| 8 | **Preguntas** | «¿Y si…?» — las objeciones | — |
| 9 | **Cierre + formulario** | «Está bien, ¿qué hago ahora?» | Empieza gratis · o escríbenos |
| 10 | **Pie** | «¿Quiénes son? ¿Es serio?» | — |

Lo que **no** lleva el sitio, a propósito: carrusel, video de fondo, contador de
clientes, logos de «confían en nosotros», testimonios, ventana emergente, chat.
Ninguno existe de verdad todavía y todos restan velocidad.

## 4. El texto maestro — español de México — `F11-SITE-DEF-04`

La etiqueta entre corchetes dice **desde qué plan es verdad** cada promesa.
`[Todos]` = Basic, Pro y Plus.

### 4.1 Hero

- **Titular:** Tus ventas son el punto●
- **Entradilla:** Punto de venta, inventario y compras en un solo lugar. Escanea,
  cobra y lleva el control de tu negocio desde la caja o desde tu celular.
- **Botón principal:** Empieza gratis
- **Botón secundario:** Ver qué hace
- **Línea de confianza:** 14 días con todas las funciones. Sin tarjeta y sin instalar nada.

> Cambié «sabe exactamente cuánto tienes» (del prototipo) por «lleva el control
> de tu negocio»: **saber cuánto tienes es de Pro**, y el hero lo lee también
> quien va a comprar Basic. Las tres afirmaciones de la línea de confianza están
> verificadas: 14 días con Plus completo, sin captura de tarjeta, y es una
> aplicación web.

### 4.2 Qué hace

**Rótulo:** Qué hace · **Titular:** Todo lo que pasa en tu mostrador, en una sola pantalla.
**Entradilla:** Deja de saltar entre la libreta, el Excel y la calculadora.
SellPointy une lo que vendes con lo que tienes y lo que compras.

| Verbo | Texto | Plan |
|---|---|---|
| **Vende** | Cobra con lector de códigos, pistola Bluetooth o la cámara de tu celular. Tickets con tu logo y turno de caja con arqueo, para cerrar el día sin sorpresas. | `[Todos]` |
| **Controla** | Entradas, salidas, traspasos e inventario físico. El historial de cada producto, en todas tus sucursales. | `[Desde Pro]` |
| **Compra** | Registra tus compras con su factura y mantén tus costos al día, para que el precio que pones deje la ganancia que esperas. | `[Desde Pro]` |
| **Decide** | Reportes de ventas y gastos, listos para leer y para exportar. Sin armar nada a mano. | `[Todos]` |

### 4.3 Beneficios

**Rótulo:** Beneficios para tu negocio · **Titular:** Menos tiempo en el sistema. Más tiempo vendiendo.

| Titular (la palabra subrayada va en *cursiva*) | Texto | Plan |
|---|---|---|
| Cobra en *segundos*, no en filas. | Escaneas y el producto ya está en la cuenta. Nadie espera mientras buscas un precio. | `[Todos]` |
| Da de alta tu catálogo en *una tarde*. | Escanea el código y SellPointy reconoce el producto y te sugiere su nombre; tú solo pones el precio. ¿Ya lo tienes en Excel? Súbelo de un jalón. | `[Todos]` |
| Cierra la caja *sin sorpresas*. | Cada turno abre y cierra con su arqueo. Sabes quién cobró, cuánto y si cuadra. | `[Todos]` |
| Sabe *cuánto tienes*, sin contar a mano. | Cada venta descuenta del inventario y cada compra lo repone. Tus existencias son un número, no una corazonada. | `[Desde Pro]` |
| Que nada se te *caduque* en el anaquel. | Lotes con fecha y un aviso claro de lo que está por vencer, para venderlo a tiempo en lugar de tirarlo. | `[En Plus]` |
| Tu negocio completo, *en tu bolsillo*. | Computadora, tablet o celular. Entras desde donde estés y ves lo mismo que en la caja. | `[Todos]` |

> **DECIDIDO por Carlos el 2026-09-18: van los seis**, respetando el diseño
> aprobado. Probado en el navegador con el CSS del prototipo **sin tocarle una
> línea**: el marco pasa de 2×2 a 2×3 solo, los filetes se acomodan y en celular
> queda una columna, sin desbordes. La guía de diseño ya lo refleja (§5).
>
> **⚠️ «Súbelo de un jalón»** es muy mexicano. Está bien para `es-mx`; en `es-us`
> conviene «súbelo de una vez».

### 4.4 Para quién

**Rótulo:** Para quién · **Titular:** Hecho para el negocio que atiendes tú.

México: Abarrotes · Farmacias · Minisúper · Ferreterías · Tlapalerías · Papelerías ·
Boutiques · Refaccionarias · Dulcerías · Tiendas naturistas · Consultorios

> **DECIDIDO por Carlos el 2026-09-18: «Consultorios» se queda** en la lista de
> giros de México. El módulo de Consultorio médico es de **Premium, a la medida y
> con precio pactado**, así que esa píldora **no es como las demás: es un enlace**
> que lleva al formulario con «Algo a la medida» ya elegido. Sin eso, el dueño de
> un consultorio baja a los planes, ve Basic, Pro y Plus, no encuentra lo suyo en
> ninguno y se va — o peor, compra Basic creyendo que ahí está.
>
> **Solo en México.** En Estados Unidos y Canadá «consultorios» salió de la lista
> (§7.4): allá la práctica médica vive bajo regulación que el módulo no cubre.

### 4.5 Cierre

- **Titular:** Ponle punto final al desorden.
- **Texto:** Crea tu cuenta, escanea tus primeros productos y haz tu primera venta
  hoy mismo. Y si prefieres platicarlo antes, escríbenos.
- **Botones:** Empieza gratis · Escríbenos

### 4.6 En tu mostrador y Tu panel — agregadas el 2026-09-19

Carlos pidió integrar dos imágenes sin tocar el hero. Los textos en inglés y en
francés están en `apps/site/src/i18n/locales/` (claves `inAction` e `insights`).

**En tu mostrador** (la foto; va después de «Qué hace»). Promete solo lo que
«Vende» ya decía: escanear, cobrar y el ticket con tu logo.

- **Titular:** Escanea, cobra y entrega el ticket.
- **Entradilla:** Así se ve una venta con SellPointy: pasas el producto por el
  lector, aparece en pantalla con su precio y cobras. Sin teclear precios ni
  buscar en una lista.
- **Pasos:** Escanea · Cobra · Entrega el ticket.
- **Bajo la foto:** «Imagen ilustrativa.» — es una imagen de estudio, no un
  cliente, y se dice.

**Tu panel** (va después de «Beneficios», en banda azul profundo). El panel es
de **todos los planes**, y por eso la sección **no habla de existencias** —Basic
no las lleva—; hay barrera.

- **Titular:** Abre SellPointy y ve cómo va tu día.
- **Entradilla:** Ventas, utilidad y tickets al momento, desde la caja o desde tu
  celular. Sin esperar al corte y sin armar un reporte.
- **Puntos:** lo vendido hoy y en el mes contra tu meta · tu utilidad · tus más
  vendidos y a qué hora vendes más. **Nota:** Incluido en todos los planes.
- El panel es un **dibujo** (HTML y SVG), no una captura: mismas razones que la
  caja del hero, y además una captura real enseña datos de un negocio real.

## 5. La sección de planes — `F11-SITE-DEF-05`

**Rótulo:** Planes · **Titular:** Empieza con lo que necesitas. Crece cuando quieras.
**Entradilla:** Todos los planes incluyen actualizaciones. Los primeros 14 días
pruebas Plus completo, y después eliges.

**Se publican tres planes** —Basic, Pro y Plus—, igual que la vitrina de la
aplicación. **Free no se anuncia** (es a donde cae una cuenta vencida, no un
producto) y **Premium va como una franja aparte**, no como cuarta tarjeta.

### Las tarjetas (en escalera: cada una suma a la anterior)

| | **Basic** | **Pro** · *Recomendado* | **Plus** |
|---|---|---|---|
| **Para** | Empezar a cobrar en orden | Controlar tu inventario | Operar en serio |
| **Usuarios** | 3 | 6 | 20 |
| **Sucursales** | 1 | 4 | 10 |
| **Incluye** | Punto de venta y tickets · Turno de caja con arqueo · Ticket con tu logo · Reportes, con exportación · Gastos | **Todo lo de Basic, más:** Control de inventario · Entradas, salidas y kardex · Traspasos entre sucursales · Cotizaciones · Productos compuestos: recetas y kits · Compras | **Todo lo de Pro, más:** Órdenes de compra y recepciones parciales · Lotes y caducidades · Subcatálogos y campos propios · Roles personalizados |
| **Botón** | Quiero Basic | Quiero Pro | Quiero Plus |

**La franja de Premium:** «¿Tu negocio necesita algo a la medida? Módulos hechos
para tu giro —recepción, consultorio médico y más—, con usuarios y sucursales sin
límite. **Escríbenos.**»

Debajo: **«Ver todo lo que incluye cada plan»** → la tabla completa con las 17
líneas de la vitrina, tal como las dice la aplicación.

> **DECIDIDO por Carlos el 2026-09-18:** **Pro es el plan «Recomendado»**,
> **Basic dice a la vista que no lleva existencias**, y **el soporte no se
> menciona hasta que exista un correo de `sellpointy.com`**.

**Tres decisiones tomadas aquí, con su razón:**

- **«Recomendado», no «El más elegido».** No hay datos de ventas que lo respalden,
  y una frase así sin respaldo es justo la clase de afirmación que este documento
  prohíbe. Se recomienda **Pro** porque es el primer plan que cumple la promesa
  central del producto —saber cuánto tienes—: Basic cobra, pero no controla
  existencias.
- **Basic debe decir con claridad que NO controla inventario.** Hoy vende aunque
  el saldo sea negativo. Una línea honesta bajo la tarjeta —«Basic no lleva
  existencias. Si necesitas saber cuánto tienes, tu plan es Pro»— evita al cliente
  enojado y, de paso, empuja a Pro.
- **«Soporte» NO se menciona todavía — PENDIENTE, por decisión de Carlos
  (2026-09-18).** Hoy no hay un soporte formal. La intención es darlo **por
  correo**, pero antes hace falta un correo del dominio `sellpointy.com`. Hasta
  que exista, el sitio no promete soporte en ningún idioma: la entradilla se quedó
  con lo que sí es verdad, las actualizaciones. **Cuando el correo exista** se
  agrega en los tres idiomas — *«soporte por correo» · “email support” · « assistance
  par courriel »* — y conviene decir también en cuánto tiempo se contesta.

### Cuando se prendan los precios (la estructura ya queda lista)

Cada tarjeta tiene su hueco: precio, moneda, `/mes`, el selector **Mensual / Anual**
y la leyenda **«Paga 10 meses, usa 12»** (el anual cuesta diez meses: es una regla
de la base, no una promoción). Bajo las tarjetas: **«Precios en {moneda}. Se paga
por transferencia.»** — hay que decirlo antes de que lo descubran al final.

## 6. La matriz de mercados — `F11-SITE-DEF-06`

Documento **y** configuración: esta tabla es el archivo tipado del que salen las rutas.

| Mercado | Ruta | Idioma | Por omisión | Moneda | Número | `showPrices` |
|---|---|---|:-:|---|---|:-:|
| México | `/es-mx/` | Español | ✅ | MXN | `1,250.50` | `false` |
| Estados Unidos | `/en-us/` | Inglés | ✅ | USD | `1,250.50` | `false` |
| Estados Unidos | `/es-us/` | Español | | USD | `1,250.50` | `false` |
| Canadá | `/en-ca/` | Inglés | ✅ | CAD | `1,250.50` | `false` |
| Canadá | `/fr-ca/` | Francés | | CAD | `1 250,50` | `false` |

- **`showPrices` es por MERCADO, no por ruta:** prender Canadá prende `/en-ca/` y
  `/fr-ca/` a la vez. Un mercado con el precio en un idioma y sin él en el otro no
  tiene explicación posible.
- **El francés escribe los números distinto** (`1 250,50 $`, con el signo al final y
  espacio fino). Lo resuelve `Intl.NumberFormat("fr-CA")`; **no se formatea a mano**.
- **`/` (sin mercado) sirve la versión de MÉXICO en español** — decidido por Carlos
  el 2026-09-18: «si el sistema no adivina tu país que muestre México, donde
  estarán la mayoría de clientes». Es la página completa, no una redirección, y es
  también el `x-default` de `hreflang`: lo que Google enseña a quien no encaja en
  ninguna otra versión.
- **Lo que pasa con cada visitante:**

  | El sitio detecta… | Le sugiere… |
  |---|---|
  | México | `/es-mx/` |
  | Estados Unidos | `/en-us/`, o `/es-us/` si su navegador está en español |
  | Canadá | `/en-ca/`, o `/fr-ca/` si su navegador está en francés |
  | Otro país, navegador en español (Colombia, España…) | `/es-mx/` |
  | Otro país, otro idioma | `/en-us/` |
  | **Nada (no pudo adivinar)** | **`/es-mx/`** |

- **⚠️ Una costura que hay que cerrar ANTES de prender precios, no ahora.** El
  cobro manda a Estados Unidos (USD) a todo país sin precio propio
  (`resolveMarket`). Con esta decisión, un visitante de Colombia verá la versión
  mexicana: mientras los precios estén apagados no pasa nada, pero el día que se
  prendan **vería pesos mexicanos y pagaría dólares**. La salida ya está en el
  diseño: `showPrices` es por mercado, y la versión mexicana debe decir junto al
  precio **«Precios para México»** con un enlace a «¿Estás en otro país?». Queda
  anotado en `F11-SITE-PLANS-04` y en el simulacro `F11-SITE-QA-05`.

## 7. El inglés — `F11-SITE-DEF-07`

> **Estado: APROBADO por Carlos el 2026-09-18.** Adaptado del texto maestro, no
> traducido: donde el español habla de «la libreta», el inglés
> habla de lo que ese lector sí tiene en la cabeza.

### 7.1 Las reglas

- **Los términos del producto son los de la aplicación en inglés**, tal cual salen
  en pantalla (tomados de `apps/web/src/i18n/en/`):

| Español | Inglés — como lo dice la aplicación |
|---|---|
| Punto de venta y tickets | Point of sale and receipts |
| Turno de caja con arqueo | Cash shift with till count |
| Ticket con tu logo | Receipt with your logo |
| Control de inventario | Inventory control |
| Entradas, salidas y kardex | Entries, exits and stock ledger |
| Traspasos entre sucursales | Transfers between stores |
| Cotizaciones | Quotes |
| Productos compuestos: recetas y kits | Composite products: recipes and kits |
| Lotes y caducidades | Lots and expiration dates |
| Órdenes de compra y recepciones parciales | Purchase orders and partial receipts |
| Subcatálogos y campos propios | Subcatalogs and custom fields |
| Roles personalizados | Custom roles |
| Carga rápida | Quick load |
| Próximos a vencer | Expiring soon |
| Compras · Gastos · Proveedores | Purchases · Expenses · Suppliers |

- **«Ticket» es «receipt»**, nunca «ticket»: en inglés un *ticket* es una multa o
  un boleto.
- El precio es **“Price”** · lo vencido es **“Expired”** (reglas ya decididas).
- **En el texto de venta se dice «the history of every product», no «stock ledger»
  ni «kardex».** El término técnico va en la tabla de planes, donde tiene que
  coincidir con la aplicación; en un párrafo que vende, nadie busca un *ledger*.
- **Una inconsistencia que encontré en la aplicación, no en el sitio:** la vitrina
  dice «stock ledger» y la pestaña del producto dice «Kardex». No lo toco aquí,
  pero conviene unificarlo algún día.

### 7.2 El slogan

> **DECIDIDO por Carlos el 2026-09-18: «Sales. That's the point.»**

«Tus ventas son el punto» tiene un doble sentido —el punto de venta y «lo que
importa»— que **no sobrevive a una traducción literal**: *“Your sales are the point”*
suena a frase a medias.

La frase la propuso Carlos como *“Sales, that's the point”*; se le cambió **solo la
puntuación**. Con coma son dos oraciones completas unidas a la fuerza, y a un
nativo le suena a error de redacción; con punto es natural y pega más.

**Por qué ganó:** *that's the point* significa «eso es lo que importa», que es
**exactamente** lo que dice «son el punto» en español — y conserva el guiño a
*point of sale*. La candidata anterior, *“Sales, to the point.”*, era ingeniosa
pero decía otra cosa: *to the point* es «ir al grano» y habla del estilo del
producto, no del cliente.

**En el diseño** el titular se parte en dos renglones, igual que en español:

```
Sales.
That's the point●
```

El primer punto es tipográfico normal; **el último es el punto amarillo**. Dos
renglones cortos y el remate con el color de la marca.

| Descartada | Por qué |
|---|---|
| Your sales. That's the point. | Más fiel por el «tus», pero más larga, y el *your* no aporta en un titular |
| Sales — that's the point. | Correcta; la raya se ve rara en letra gigante |
| Sales, to the point. | Ingeniosa, pero dice «ir al grano», no «es lo que importa» |
| Get to the point of sale. | Larga para el titular y suena a instrucción |

### 7.3 El texto — Estados Unidos (`/en-us/`)

**Hero**
- **Headline:** Sales. That's the point●
- **Lead:** Point of sale, inventory and purchasing in one place. Scan, charge and
  stay on top of your business — from the register or from your phone.
- **Buttons:** Start free · See what it does
- **Trust line:** 14 days with every feature. No credit card. Nothing to install.

**What it does** — *Everything that happens at your counter, on one screen.*
Stop jumping between a notebook, a spreadsheet and a calculator. SellPointy
connects what you sell with what you have and what you buy.

| | Text | Plan |
|---|---|---|
| **Sell** | Ring up sales with a barcode scanner, a Bluetooth gun or your phone's camera. Receipts with your logo, and cash shifts with a till count so you close the day with no surprises. | `[All]` |
| **Track** | Entries, exits, transfers and physical counts. The history of every product, across all your stores. | `[From Pro]` |
| **Buy** | Record your purchases with their invoice and keep your costs current, so the price you set leaves the margin you expect. | `[From Pro]` |
| **Decide** | Sales and expense reports, ready to read and ready to export. Nothing to build by hand. | `[All]` |

**Benefits** — *Less time in the system. More time selling.*

| Headline (underlined word in *italics*) | Text | Plan |
|---|---|---|
| Ring up sales in *seconds*, not lines. | Scan it and it's on the bill. Nobody waits while you look up a price. | `[All]` |
| Build your catalog in *one afternoon*. | Scan the barcode and SellPointy recognizes the product and suggests its name — you just set the price. Already have it in a spreadsheet? Upload it in one go. | `[All]` |
| Close the register with *no surprises*. | Every shift opens and closes with its own till count. You know who rang up what, how much, and whether it adds up. | `[All]` |
| Know *what you have* without counting by hand. | Every sale comes off the shelf and every purchase goes back on. Your stock is a number, not a hunch. | `[From Pro]` |
| Let nothing *expire* on the shelf. | Lots with dates, and a clear heads-up on what's about to expire — so you sell it in time instead of throwing it out. | `[On Plus]` |
| Your whole business, *in your pocket*. | Computer, tablet or phone. Log in from anywhere and see exactly what the register sees. | `[All]` |

**Who it's for** — *Built for the business you run yourself.*
Grocery stores · Convenience stores · Latin markets · Hardware stores · Gift shops ·
Boutiques · Auto parts · Candy shops · Health food stores · Pet supplies

**Plans** — *Start with what you need. Grow when you're ready.*
The first 14 days you get all of Plus. Then you pick.
Basic: *Start ringing up sales the right way* · Pro: *Take control of your inventory* ·
Plus: *Run a serious operation* · Buttons: *I want Basic / Pro / Plus* ·
Under Basic: *Basic doesn't track stock. If you need to know what you have, Pro is your plan.*
Premium strip: *Need something built for your business? Custom modules, with
unlimited users and stores. **Get in touch.***

**Closing** — *Put an end to the mess.* Create your account, scan your first
products and make your first sale today. Prefer to talk first? Drop us a line.
Buttons: *Start free · Contact us*

> **DECIDIDO por Carlos el 2026-09-18: una sola frase para Estados Unidos y
> Canadá, «Put an end to the mess.»** La alternativa, *“Put a full stop to the
> mess”*, conservaba el juego con «punto», pero *full stop* es inglés británico:
> en Estados Unidos el punto final es *period* y la frase no se entiende a la
> primera. Mantener dos versiones del mismo remate por un matiz que casi nadie
> nota no valía el trabajo. El juego con el punto ya lo lleva el titular.

### 7.4 Lo que cambia en Estados Unidos respecto a México

- **Dos giros se quitan y uno se agrega.** *Farmacias* y *consultorios* salen: en
  Estados Unidos y Canadá una farmacia vive bajo regulación sanitaria y de recetas
  que SellPointy no cubre, y anunciarlo ahí es prometer de más. Entra **Latin
  markets**: es el negocio que más valora operar en español y en inglés.
- **Un argumento que México no necesita y aquí vende:** la aplicación es bilingüe
  **por usuario** — el dueño en inglés y la cajera en español, a la vez. Va como
  pregunta frecuente: *“Can my staff use it in Spanish?” — “Yes. Each person picks
  their own language, English or Spanish, on the same account.”* `[verificado: el
  idioma es un ajuste de cada usuario]`
- **Impuestos.** *“Are sales taxes set up for me?” — “When you create your account,
  SellPointy starts you off with your state's base sales tax rate. If your city or
  county adds its own, you adjust it once and you're done.”*
  `[verificado: packages/shared/src/tax-defaults.ts trae la tasa base de los 50
  estados y DC — «sin la local: el punto de partida», dice su propio comentario]`.
  **Por eso NO se dice «your sales tax is set up for you»:** en buena parte de
  Estados Unidos la tasa real es la estatal más la local, y prometer que ya está
  lista es prometer un número equivocado en el ticket.

### 7.5 Canadá en inglés (`/en-ca/`) — solo las diferencias

- **Ortografía canadiense:** *colour, centre, catalogue* (no *catalog*), *cheque*.
  Así, el beneficio queda *“Build your catalogue in one afternoon.”*
- **Giros:** Convenience stores · Grocery stores · Hardware stores · Health food
  stores · Gift shops · Boutiques · Pet supplies · Bakeries · Candy shops
- **Impuestos, que aquí son un argumento fuerte:** *“SellPointy sets up GST, HST
  or PST for your province when you sign up.”* `[verificado: hay valores sembrados
  para ON, BC, QC, NS, MB y AB]`
- **La promesa de Canadá** (§1) se apoya en lotes, caducidades y varias sucursales:
  en `/en-ca/` el beneficio de caducidades **sube al segundo lugar**.
- La línea de confianza dice *“No credit card.”* igual, y los precios, cuando se
  prendan, van en **CAD** con el formato `$1,250.50`.

## 8. El francés — `F11-SITE-DEF-08`

> **DECIDIDO por Carlos el 2026-09-18: francés NEUTRO, sin revisor externo.**
> No hay una persona de Quebec disponible, así que el texto se escribe en francés
> estándar internacional: el que se lee con naturalidad en Montreal, en París y en
> Dakar. **Es la decisión correcta para este caso:** el riesgo del borrador
> anterior era usar mal un regionalismo quebequense, y un francés estándar bien
> escrito no tiene ese problema.
>
> **Lo que un revisor todavía aportaría, para que lo sepas:** el oído. El texto de
> abajo es gramaticalmente correcto y usa vocabulario que cualquier francófono
> entiende; lo que no puedo garantizar es el matiz fino de tono. Si algún día
> quieres cerrarlo, una hora de un corrector profesional alcanza — es una mejora,
> **no un requisito para publicar**.

### 8.1 Las reglas

- **Tratamiento de « vous »**, siempre.
- **Se elige la palabra que entienden todos.** Donde Quebec y Francia usan palabras
  distintas, va la que ninguno de los dos siente ajena:

| Concepto | Se usa (neutro) ✅ | Se evita | Por qué |
|---|---|---|---|
| Correo electrónico | **courriel** | e-mail, mail | Es el término oficial en Francia **y** el de uso diario en Quebec |
| Subir un archivo | **importer** | téléverser · uploader | *Téléverser* es de Quebec, *uploader* es anglicismo; *importer* es estándar |
| Escanear | **scanner** | numériser | *Scanner* se entiende en todas partes; *numériser* suena a digitalizar documentos |
| Ticket de compra | **reçu** | ticket de caisse | *Reçu* es neutro; *ticket de caisse* es solo de Francia |
| Código de barras | **code-barres** | code à barres | La forma más extendida |
| Celular | **téléphone** | cellulaire · portable | Uno es de Quebec y el otro de Francia; *téléphone* no falla |
| Hoja de cálculo | **tableur** / Excel | chiffrier | *Chiffrier* solo se usa en Quebec |
| Cotización | **devis** | soumission | *Devis* se entiende en todo el mundo francófono |
| Estante | **étagères** | tablettes · rayons | Regionalismo de cada lado |
| Plan de suscripción | **forfait** | abonnement | Común a los dos |
| Tienda de conveniencia | **commerces de proximité** | dépanneur · supérette | Ídem |

- **Los impuestos de Canadá conservan su nombre propio: TPS, TVH, TVQ.** No son
  regionalismos, son el nombre legal del impuesto; «neutralizarlos» sería un error.
- **La puntuación francesa lleva espacio antes de `: ; ! ?`** y usa comillas
  angulares con espacio: « ainsi ». Ese espacio debe ser **de no separación**
  (`\u202F` o `&nbsp;`), o un signo de interrogación queda solo al inicio de un renglón.
- **El francés es hasta un 30% más largo que el inglés.** Los titulares ya están
  escritos cortos a propósito; F11-SITE-QA-01 los revisa en pantalla.

**Glosario del producto.** La aplicación no está en francés, así que estos términos
**nacen aquí** y habrá que respetarlos el día que llegue:

| Español | Francés |
|---|---|
| Punto de venta | Point de vente |
| Turno de caja con arqueo | Session de caisse avec comptage |
| Control de inventario | Gestion des stocks |
| Entradas, salidas e historial | Entrées, sorties et historique |
| Traspasos entre sucursales | Transferts entre succursales |
| Cotizaciones | Devis |
| Productos compuestos: recetas y kits | Produits composés : recettes et kits |
| Compras · Gastos · Proveedores | Achats · Dépenses · Fournisseurs |
| Órdenes de compra y recepciones parciales | Bons de commande et réceptions partielles |
| Lotes y caducidades | Lots et dates de péremption |
| Subcatálogos y campos propios | Sous-catalogues et champs personnalisés |
| Roles personalizados | Rôles personnalisés |
| Prueba gratis | Essai gratuit |

### 8.2 El slogan

El doble sentido con «punto» no sobrevive literal: *« Vos ventes sont le point »* no
significa nada. Pero el francés tiene una expresión que lo resuelve mejor que el inglés:

> **Vos ventes. Un point, c'est tout.**

*« Un point, c'est tout »* es una frase hecha —«y punto», «no hay más que hablar»—
**de todo el mundo francófono**, no de una región: por eso sobrevive al cambio a
francés neutro. Contiene la palabra **point**, evoca el *point de vente*, y
**termina en punto**: el punto amarillo vuelve a ser la puntuación. Dice lo mismo
que el español —las ventas son lo que importa y lo demás sobra—.

```
Vos ventes.
Un point, c'est tout●
```

| Alternativa | Por qué no |
|---|---|
| Vos ventes, c'est l'essentiel. | Correcta y clara, pero pierde el «punto» y con él el motivo del diseño. **Es la salida segura** si algún día alguien objeta la principal |
| Vos ventes sont le point. | Traducción literal: no significa nada en francés |

### 8.3 El texto — `/fr-ca/`

**Hero**
- **Titre :** Vos ventes. Un point, c'est tout●
- **Chapeau :** Point de vente, stocks et achats au même endroit. Scannez,
  encaissez et gardez le contrôle de votre commerce, à la caisse ou sur votre téléphone.
- **Boutons :** Commencer gratuitement · Découvrir les fonctions
- **Ligne de confiance :** 14 jours avec toutes les fonctionnalités. Sans carte
  bancaire. Rien à installer.

**Ce qu'il fait** — *Tout ce qui se passe à votre comptoir, sur un seul écran.*
Fini les allers-retours entre le cahier, le tableur et la calculatrice.
SellPointy relie ce que vous vendez, ce que vous avez et ce que vous achetez.

| | Texte | Forfait |
|---|---|---|
| **Vendez** | Encaissez avec un lecteur de codes-barres, un lecteur Bluetooth ou l'appareil photo de votre téléphone. Des reçus à votre logo et des sessions de caisse avec comptage, pour terminer la journée sans surprise. | `[Tous]` |
| **Contrôlez** | Entrées, sorties, transferts et inventaires physiques. L'historique de chaque produit, dans toutes vos succursales. | `[Dès Pro]` |
| **Achetez** | Enregistrez vos achats avec leur facture et gardez vos coûts à jour, pour que votre prix de vente laisse la marge que vous attendez. | `[Dès Pro]` |
| **Décidez** | Des rapports de ventes et de dépenses, prêts à lire et à exporter. Rien à préparer à la main. | `[Tous]` |

**Avantages** — *Moins de temps dans le système. Plus de temps pour vendre.*

| Titre (le mot souligné en *italique*) | Texte | Forfait |
|---|---|---|
| Encaissez en *quelques secondes*. | Vous scannez, et le produit est déjà sur le reçu. Personne n'attend pendant que vous cherchez un prix. | `[Tous]` |
| Que rien ne *périme* sur vos étagères. | Des lots avec leur date et une alerte claire sur ce qui arrive à échéance, pour le vendre à temps plutôt que de le jeter. | `[Avec Plus]` |
| Sachez *ce que vous avez*, sans compter à la main. | Chaque vente sort du stock et chaque achat le réapprovisionne. Votre inventaire est un chiffre, pas une impression. | `[Dès Pro]` |
| Créez votre catalogue en *un après-midi*. | Scannez le code-barres : SellPointy reconnaît le produit et propose son nom, il ne vous reste qu'à fixer le prix. Vos produits sont déjà dans Excel ? Importez-les en une seule fois. | `[Tous]` |
| Fermez la caisse *sans surprise*. | Chaque session s'ouvre et se ferme avec son comptage. Vous savez qui a encaissé quoi, combien, et si le compte est juste. | `[Tous]` |
| Tout votre commerce, *dans votre poche*. | Ordinateur, tablette ou téléphone. Connectez-vous de n'importe où et voyez exactement ce que voit la caisse. | `[Tous]` |

> El beneficio de caducidades va **segundo**, como en `/en-ca/`: es el argumento de
> Canadá (§1).

**Pour qui** — *Conçu pour le commerce que vous tenez vous-même.*
Commerces de proximité · Épiceries · Quincailleries · Magasins de produits naturels ·
Boutiques de cadeaux · Boutiques de vêtements · Animaleries · Boulangeries · Confiseries

**Forfaits** — *Commencez avec l'essentiel. Évoluez à votre rythme.*
Pendant les 14 premiers jours, vous profitez de tout le forfait Plus. Ensuite, vous choisissez.
Basic : *Pour encaisser avec méthode* · Pro : *Pour maîtriser vos stocks* · Plus :
*Pour une gestion complète* · Boutons : *Je choisis Basic / Pro / Plus* ·
Sous Basic : *Basic ne gère pas les stocks. Si vous avez besoin de savoir ce que
vous avez, le forfait qu'il vous faut est Pro.* · Bande Premium : *Besoin d'une
solution sur mesure ? Des modules conçus pour votre activité, avec utilisateurs et
succursales illimités. **Écrivez-nous.***

**Taxes** *(pregunta frecuente)* — *« Les taxes sont-elles déjà configurées ? » —
« À la création de votre compte, SellPointy configure les taxes de votre province :
TPS et TVQ au Québec, TVH ou TVP ailleurs. Vous pouvez les modifier à tout moment. »*
`[verificado: tax-defaults.ts tiene QC y las demás provincias]`

**Fermeture** — *Mettez fin au désordre.* Créez votre compte, scannez vos premiers
produits et réalisez votre première vente dès aujourd'hui. Vous préférez en parler
d'abord ? Écrivez-nous. · Boutons : *Commencer gratuitement · Nous écrire*

### 8.4 La línea de honestidad

> **DECIDIDO por Carlos el 2026-09-18:** el francés **sí llegará a la aplicación**,
> así que la línea lleva las dos frases.

La versión francesa dice que la aplicación todavía no está en francés. Va en la
sección de planes, a la vista, no escondida en las preguntas:

> *« L'application est disponible en anglais et en espagnol. Le français sera
> bientôt disponible. »*

**Sin fecha, a propósito.** «Bientôt» compromete la intención, no un día; una fecha
publicada que se pasa es la queja más fácil de evitar. **El día que el francés
entre a la aplicación, esta línea se quita** — queda anotado en
`IMPLEMENTACION.md` para que no se olvide.

> **Una advertencia que no es de redacción, Carlos — y que NO puedo cerrar yo.**
> La Carta de la lengua francesa de Quebec (reforzada por la Ley 96) regula el
> idioma del comercio en la provincia. Lo que entiendo, **sin ser abogado y sin
> haberlo verificado contra el texto vigente**:
>
> - La **publicidad comercial dirigida a Quebec —un sitio web incluido— debe estar
>   en francés.** Eso juega a favor de tener `/fr-ca/`.
> - Sobre el **producto**, la ley pide que el software esté disponible en francés…
>   **salvo que no exista versión en francés**, que es justo el caso de SellPointy
>   hoy. Esa excepción existe, pero no sé cómo aplica a un servicio por
>   suscripción vendido a negocios y no a consumidores.
>
> **No saques conclusiones de estos dos párrafos: son la pregunta, no la
> respuesta.** Va a la lista del abogado de la sección 10. Y una nota sobre el
> francés neutro: **la ley pide francés, no francés de Quebec**, así que tu
> decisión no cambia este punto en ningún sentido.

## 9. El formulario de interés — `F11-SITE-DEF-09`

**Titular:** Cuéntanos de tu negocio · **Entradilla:** Normalmente te escribimos en
un día hábil, para ayudarte a elegir y arrancar.

> **DECIDIDO por Carlos el 2026-09-18: «Normalmente en un día hábil».** Primero
> eligió «Te escribimos pronto» y lo cambió en el mismo día; **esta es la vigente.**
> Es el punto medio: le dice al prospecto qué esperar —que es lo que lo anima a
> escribir— sin convertirlo en garantía. «Normalmente» es la palabra que hace el
> trabajo: describe cómo se atiende, no promete un plazo. **Si algún día deja de
> ser verdad la mayoría de las veces, se cambia**: un «normalmente» que no se
> cumple es una promesa rota con un adverbio delante.

| Campo | Tipo | Obligatorio | Notas |
|---|---|:-:|---|
| Nombre | texto | ✅ | `autocomplete="name"` |
| Correo | correo | ✅ | `autocomplete="email"` |
| País | lista | ✅ | Ya elegido según el mercado que está viendo |
| Plan que te interesa | lista | ✅ | Ya elegido según el botón que tocó: Basic · Pro · Plus · Algo a la medida · Todavía no sé |
| Giro de tu negocio | lista | | Los de la sección «Para quién» + «Otro» |
| Mensaje | texto largo | | «¿Algo que debamos saber?» |
| ☐ Consentimiento | casilla | ✅ | **Nunca marcada de antemano** (lo exige la ley canadiense) |

- **Sin teléfono.** Cada campo de más baja las respuestas, y quien quiera que le
  llamen lo escribe en el mensaje.
- **«Todavía no sé»** es una opción a propósito: es el prospecto que más necesita
  que le escribas, y sin esa salida elige uno al azar o se va.
- **Texto de la casilla:** «Acepto que SellPointy me escriba a este correo sobre mi
  solicitud. Puedo pedir que dejen de hacerlo cuando quiera. [Aviso de privacidad]»
- **Botón:** Enviar · mientras envía: Enviando…
- **Al terminar** (reemplaza al formulario): **«¡Listo, {nombre}!** Recibimos tu
  mensaje y te escribimos a {correo}. Mientras tanto, puedes **empezar tu prueba
  gratis** — son 14 días con todo.»
- **Si falla:** «No pudimos enviar tu mensaje. Inténtalo de nuevo.» Lo escrito **no
  se borra**. *(La salida «o escríbenos a…» se agrega cuando exista el correo de
  `sellpointy.com`.)*
- **Respuesta automática al prospecto: sí**, en su idioma, con el mismo texto del
  mensaje de éxito. Le confirma que llegó y le deja el enlace de la prueba.

### El formulario en los tres idiomas

Los textos de arriba son el maestro en español. Estos son los otros dos, con el
mismo criterio que §7 y §8 (el francés, neutro y de « vous »):

| | Español | English | Français |
|---|---|---|---|
| Titular | Cuéntanos de tu negocio | Tell us about your business | Parlez-nous de votre commerce |
| Entradilla | Normalmente te escribimos en un día hábil, para ayudarte a elegir y arrancar. | We usually reply within one business day, to help you choose and get started. | Nous répondons généralement en un jour ouvrable, pour vous aider à choisir et à démarrer. |
| Nombre | Nombre | Name | Nom |
| Correo | Correo | Email | Courriel |
| País | País | Country | Pays |
| Plan | Plan que te interesa | Plan you're interested in | Forfait qui vous intéresse |
| — opciones | Algo a la medida · Todavía no sé | Something custom · Not sure yet | Une solution sur mesure · Je ne sais pas encore |
| Giro | Giro de tu negocio | Type of business | Type de commerce |
| Mensaje | ¿Algo que debamos saber? | Anything we should know? | Quelque chose à nous préciser ? |
| Casilla | Acepto que SellPointy me escriba a este correo sobre mi solicitud. Puedo pedir que dejen de hacerlo cuando quiera. | I agree to SellPointy emailing me about my request. I can ask them to stop at any time. | J'accepte que SellPointy m'écrive à cette adresse au sujet de ma demande. Je peux demander l'arrêt de ces envois à tout moment. |
| Botón | Enviar · Enviando… | Send · Sending… | Envoyer · Envoi… |
| Éxito | ¡Listo, {nombre}! Recibimos tu mensaje y te escribimos a {correo}. Mientras tanto, puedes empezar tu prueba gratis — son 14 días con todo. | All set, {name}! We got your message and will write to {email}. Meanwhile, you can start your free trial — 14 days with everything. | C'est noté, {nom} ! Nous avons bien reçu votre message et vous écrirons à {courriel}. En attendant, vous pouvez commencer votre essai gratuit : 14 jours avec toutes les fonctionnalités. |
| Error | No pudimos enviar tu mensaje. Inténtalo de nuevo. | We couldn't send your message. Please try again. | Votre message n'a pas pu être envoyé. Veuillez réessayer. |

> El mensaje de error decía «…o escríbenos a {correo de contacto}». **Esa salida
> espera al correo de `sellpointy.com`**; mientras no exista, el error ofrece solo
> reintentar — y como lo escrito no se borra, reintentar no cuesta nada.

## 10. Lo legal — `F11-SITE-DEF-10`

**⏸ Necesita una decisión tuya antes de escribir una línea:** ¿lo redacta un
abogado o partimos de una plantilla que después revisa uno? Yo puedo preparar el
borrador y la lista de lo que cada ley exige, **pero no debe publicarse sin revisión
profesional**: son tres jurisdicciones y un error aquí cuesta más que todo el sitio.

Lo que tiene que cubrir, por ley:

| Ley | Dónde aplica | Lo que exige del sitio |
|---|---|---|
| **LFPDPPP** | México | Aviso de privacidad con responsable, datos que se recaban, finalidades y cómo ejercer los derechos ARCO |
| **CASL** | Canadá | Consentimiento **expreso** antes de escribirle a alguien, con registro de cuándo y qué aceptó; cada correo con forma de darse de baja |
| **Ley 25** | Quebec | Un responsable de datos personales **nombrado**, consentimiento claro y por finalidad, y aviso de privacidad en francés |

Y entra el pendiente de la bitácora del 2026-09-17: **la cláusula sobre el catálogo
compartido de productos** en los términos.

## 11. Preguntas frecuentes — `F11-SITE-DEF-11`

| Pregunta | Respuesta | Verificado |
|---|---|:-:|
| **¿Tengo que instalar algo?** | No. SellPointy funciona en el navegador de tu computadora, tablet o celular. Entras con tu correo y listo. | ✅ |
| **¿Qué lector de códigos necesito?** | Cualquiera: los lectores USB y las pistolas Bluetooth funcionan al conectarlos. Y si no tienes uno, la cámara de tu celular o tablet también escanea. | ✅ |
| **¿Qué impresora de tickets necesito?** *(2026-09-19, pedida por Carlos)* | Cualquier impresora térmica de 58 u 80 mm que tu computadora, tablet o celular reconozca: por USB, Bluetooth o red. SellPointy arma el ticket a la medida del papel y lo manda a imprimir desde el navegador, sin instalar programas. Y si no entregas tickets, no necesitas impresora: la venta queda registrada igual. — *No nombra Android ni ninguna marca a propósito: el ticket es un PDF que imprime el navegador, así que sirve lo que el equipo reconozca; hay barrera.* | ✅ |
| **¿Puedo subir los productos que ya tengo en Excel?** | Sí. Descargas la plantilla, pegas tus productos y los subes de una vez. Y los que tengan código de barras los puedes dar de alta escaneándolos. | ✅ |
| **¿Qué pasa cuando terminan los 14 días?** | Eliges el plan que te convenga. Si todavía no te decides, tu información no se borra: sigue ahí esperándote. | ✅ |
| **¿Cómo se paga?** | Por transferencia, cada mes o por año. Si pagas el año completo, pagas 10 meses y usas 12. | ✅ |
| **¿Puedo cambiar de plan después?** | Sí. Nos escribes desde la pantalla «Mi plan» de tu cuenta, nos dices a cuál quieres pasar y lo activamos. | ✅ |
| **¿Mi información es mía?** | Sí. Tus ventas, tus precios, tus clientes y tus existencias son solo tuyos: no se comparten ni se venden. Lo único común es el catálogo de códigos de barras —el nombre que viene impreso en el empaque—, que es lo que te permite dar de alta un producto con solo escanearlo. | ✅ |
| **¿En qué idiomas está?** | En español y en inglés. Cada persona de tu equipo elige el suyo. | ✅ |

> **Las tres respuestas que no pude cerrar solo — las tres CERRADAS:**
> - ~~«Cuando terminan los 14 días»~~ — **CERRADA (Carlos, 2026-09-18): se queda
>   sencilla.** La base dice 10 días de gracia y luego el plan gratuito (1 usuario,
>   10 ventas al día, sin capturar ni editar), y **nunca se borra nada**. El sitio
>   cuenta solo esto último: explicar la gracia y el modo gratuito en una página de
>   venta es darle al visitante un motivo para no pagar. «No se borra nada» le
>   quita el miedo sin enseñarle esa salida; el detalle se lo cuenta la aplicación
>   cuando llega el momento.
> - ~~«Cambiar de plan»~~ — **CERRADA (Carlos, 2026-09-18):** el cliente escribe
>   y Carlos lo activa, igual que hoy desde la aplicación. Verificado: «Mi plan» ya
>   tiene el formulario «Escríbenos para activar tu plan» (`POST
>   /billing/me/plan-request`), que manda nombre, correo, negocio y mensaje. El sitio
>   dice ese mismo camino, con las mismas palabras que la aplicación: **«lo activamos»**.
> - ~~«Mi información es mía»~~ — **CERRADA (Carlos, 2026-09-18): la opción A, la
>   verdad completa.** Lo que el sistema comparte es poquísimo —el nombre y el
>   código de barras de un producto, que vienen impresos en el empaque— y **nada
>   del negocio**: ni precios, ni ventas, ni clientes, ni existencias, ni
>   proveedores. Pero «no se comparte nada» sería falso, y una frase falsa en una
>   página de venta es la que alguien usa después en tu contra. Dicho de frente
>   deja de ser un secreto incómodo y pasa a ser lo que es: **una ventaja del
>   producto**. Y quien lo leyó no puede decir que no sabía.
>
>   **Esto MATIZA la decisión del 2026-09-17**, cuando Carlos pidió que la pantalla
>   de Carga rápida dejara de decir «Nuevo para todos». No se contradicen: **la
>   pantalla no interrumpe al usuario con eso mientras trabaja; el sitio y los
>   términos sí lo dicen, una vez y con claridad.** La cláusula de los términos
>   (§10) sigue pendiente y debe decir lo mismo que esta respuesta, con el detalle
>   que aquí no cabe: que el nombre que un negocio teclea puede quedar en ese
>   catálogo común.

### Las preguntas en los tres idiomas

| | English | Français |
|---|---|---|
| Instalar | **Do I need to install anything?** No. SellPointy runs in the browser on your computer, tablet or phone. You log in with your email and that's it. | **Dois-je installer quelque chose ?** Non. SellPointy fonctionne dans le navigateur de votre ordinateur, de votre tablette ou de votre téléphone. Vous vous connectez avec votre courriel, et c'est tout. |
| Lector | **What barcode scanner do I need?** Any of them: USB scanners and Bluetooth guns work as soon as you plug them in. And if you don't have one, your phone or tablet camera scans too. | **De quel lecteur de codes-barres ai-je besoin ?** N'importe lequel : les lecteurs USB et Bluetooth fonctionnent dès qu'ils sont branchés. Et si vous n'en avez pas, l'appareil photo de votre téléphone ou de votre tablette fait aussi l'affaire. |
| Excel | **Can I upload the products I already have in a spreadsheet?** Yes. Download the template, paste your products and upload them in one go. Anything with a barcode you can also add just by scanning it. | **Puis-je importer les produits que j'ai déjà dans Excel ?** Oui. Téléchargez le modèle, collez vos produits et importez-les en une seule fois. Ceux qui ont un code-barres peuvent aussi être ajoutés en les scannant. |
| 14 días | **What happens when the 14 days are up?** You pick the plan that fits. If you haven't decided yet, your information isn't deleted — it stays right there waiting for you. | **Que se passe-t-il à la fin des 14 jours ?** Vous choisissez le forfait qui vous convient. Si vous n'avez pas encore décidé, vos données ne sont pas supprimées : elles vous attendent. |
| Pago | **How do I pay?** By bank transfer, monthly or yearly. Pay for the full year and you pay for 10 months and use 12. | **Comment payer ?** Par virement bancaire, au mois ou à l'année. En payant l'année complète, vous payez 10 mois et en utilisez 12. |
| Cambiar | **Can I change plans later?** Yes. Write to us from the “My plan” screen in your account, tell us which plan you want, and we'll activate it. | **Puis-je changer de forfait plus tard ?** Oui. Écrivez-nous depuis l'écran « Mon forfait » de votre compte, indiquez le forfait souhaité, et nous l'activons. |
| Datos | **Is my information mine?** Yes. Your sales, prices, customers and stock are yours alone: they are never shared or sold. The only thing in common is the barcode catalog — the name printed on the package — which is what lets you add a product just by scanning it. | **Mes données m'appartiennent-elles ?** Oui. Vos ventes, vos prix, vos clients et vos stocks n'appartiennent qu'à vous : ils ne sont ni partagés ni vendus. Le seul élément commun est le catalogue de codes-barres — le nom imprimé sur l'emballage —, qui vous permet d'ajouter un produit simplement en le scannant. |
| Idiomas | **What languages is it in?** English and Spanish. Each person on your team picks their own. | **Dans quelles langues est-il offert ?** En anglais et en espagnol. Chaque membre de votre équipe choisit la sienne. Le français sera bientôt disponible. |

**Preguntas que SOLO van en un mercado** (ya escritas en §7.4, §7.5 y §8.3): en
Estados Unidos, *“Can my staff use it in Spanish?”* y la de la tasa estatal de
impuestos; en Canadá, la de TPS/TVH/TVQ (GST/HST/PST). **En México no va ninguna
de impuestos:** el IVA se configura solo y nadie lo pregunta.

> **⚠️ POR CONFIRMAR antes de publicar Estados Unidos y Canadá: «¿Cómo se paga?».**
> En México «por transferencia» es exacto. No sé **cómo le cobras hoy a un cliente
> de Canadá o de Estados Unidos** — transferencia internacional, Interac e-Transfer,
> otra cosa. Escribí «bank transfer» / « virement bancaire », que es lo genérico;
> si el medio real es otro, esta respuesta cambia en esos dos mercados.
>
> **«Mi plan» en inglés y en francés:** usé *“My plan”* (así se llama la pantalla
> en la aplicación en inglés) y *« Mon forfait »* (nace aquí; entra al glosario de §8.1).

## 12. Recursos gráficos — `F11-SITE-DEF-12`

> **DECIDIDO por Carlos el 2026-09-18: UNA sola marca. El logo es el de la
> aplicación —la «S» con su punto dentro de un círculo—, recoloreado: azul de
> marca y el punto en amarillo.** Se conserva la forma que los clientes ya
> conocen; lo que cambia es que el punto, que era blanco, pasa a ser **el punto**
> del slogan. El logo de la aplicación también cambia: quien crea su cuenta desde
> el sitio tiene que reconocer a dónde llegó.

**Dos variantes, y las dos hacen falta:**

| Variante | Círculo | «S» | Punto | Dónde |
|---|---|---|---|---|
| **Principal** | `#1E3FD8` | blanco | `#FFC42E` | La aplicación, el favicon, los iconos de instalación, fondos claros, correos |
| **Invertida** | blanco | `#1E3FD8` | `#FFC42E` | Sobre el azul de marca: el menú del hero y el bloque de cierre del sitio |

La invertida no es un capricho: **un círculo azul sobre el hero azul desaparece.**
Es la que ya traía el prototipo aprobado.

**Lo que hay que producir** (pasa a construcción: `F11-SITE-BASE-07`):

- **Redibujarlo en SVG.** Hoy el logo solo existe como PNG (`apps/web/public/brand/
  icon-source.png`, 1254 px), y ampliado se nota que **el círculo no es un círculo
  perfecto**: tiene el borde irregular de una imagen trazada. En vector se corrige
  de paso —círculo exacto, punto exacto— y se acaba el problema de verse borroso.
- Favicon e iconos de instalación, **para el sitio y para la aplicación** (hoy son
  `favicon-32/192/512`, `apple-touch-icon`, `icon-maskable-512`, `logo-light` y
  `logo-dark`).
- Una versión a **una tinta** (todo en `--ink` o todo en blanco) para donde no hay
  color: un sello, un fax, un fondo fotográfico.
- La imagen para compartir en redes (1200 × 630), **una por idioma**, con el
  titular y el punto amarillo.

**Una regla que se desprende:** el punto del logo es **siempre amarillo** —nunca
blanco, nunca azul—, salvo en la versión a una tinta. Es lo que lo une al titular.

> **Ojo con el ticket:** el logo que se imprime en el ticket de venta es **el del
> negocio del cliente**, no el de SellPointy. Este cambio no lo toca.

## 13. Qué se mide — `F11-SITE-DEF-13`

**La conversión es una de dos cosas:** un clic en «Empieza gratis» o un formulario
enviado. Todo lo demás es contexto.

| Evento | Por qué importa |
|---|---|
| Clic en «Empieza gratis» (y desde qué sección) | La conversión principal, y qué parte de la página convence |
| Apertura del formulario (y con qué plan) | Qué plan despierta interés |
| Formulario enviado | La conversión secundaria |
| Cambio de país o idioma | Si la detección acierta: muchos cambios = detecta mal |
| «Ver todo lo que incluye» | Si las tarjetas resumidas alcanzan o la gente necesita el detalle |

> **DECIDIDO por Carlos el 2026-09-18: sin herramientas de terceros ni contenedores
> nuevos.** «Ya tengo mi VPS… puedes usar nuestro mismo contenedor de la API y web
> para crear nuevos endpoints para el sitio». Tiene razón, y la pregunta correcta
> era la suya: no hace falta un producto para contar cinco cosas.

**Cómo se mide:** el sitio manda cada evento a un endpoint del API propio
(`POST /public/site-events`), que lo guarda en una tabla; una pantalla del
backoffice los cuenta por fecha y por mercado.

**Lo que se guarda:** la fecha, el evento, el mercado, el idioma, la sección, el
plan y el **dominio** de donde llegó el visitante (`google.com`, nunca la URL).
**Lo que NO se guarda:** la IP, el navegador, ni ningún identificador de la
persona. Desde esa tabla no se puede reconstruir a nadie — y por eso **no hay
cookies, no hay aviso de consentimiento y el aviso de privacidad no tiene nada que
declarar**.

**Lo que se cede a sabiendas:** no hay «visitantes únicos», solo conteos: 100
visitas de una persona y 100 personas se ven igual. Para saber si el sitio vende,
que es la pregunta, no hace falta distinguirlas.

---

## Lo que necesito de ti para seguir

### Ya decidido (2026-09-18)

| Decisión | Resultado |
|---|---|
| Texto maestro en español | ✅ Aprobado |
| Inglés | ✅ Aprobado — slogan «Sales. That's the point.», cierre «Put an end to the mess.» |
| Francés | ✅ Neutro y sin revisor externo — slogan « Vos ventes. Un point, c'est tout. » |
| ¿El francés llegará a la aplicación? | ✅ Sí: `/fr-ca/` lo anuncia como «bientôt», sin fecha |
| Plan recomendado | ✅ Pro, con la etiqueta «Recomendado» |
| ¿Basic dice que no lleva existencias? | ✅ Sí, a la vista |
| Soporte | ⏸ No se menciona hasta tener un correo de `sellpointy.com` |
| ¿Seis beneficios o cuatro? | ✅ Seis, en 2×3 — el diseño lo aguanta sin cambios |
| ¿Se promete un plazo de respuesta? | ✅ «Normalmente en un día hábil» — describe, no garantiza |
| Menú y orden de las secciones | ✅ Aprobados |
| ¿Con qué se mide? | ✅ Con el API propio: sin terceros, sin cookies, sin contenedores nuevos |
| ¿Una sola marca? | ✅ Sí: el logo de la aplicación, en azul y con el punto amarillo — dos variantes |
| Las tres preguntas frecuentes sin cerrar | ✅ Cerradas — «¿mi información es mía?» dice la verdad completa (opción A) |
| ¿Se nombra a la competencia? | ✅ No, en ningún idioma |
| ¿Qué ve quien llega sin país detectado? | ✅ México en español; también es el `x-default` para Google |
| ¿«Consultorios» en los giros de México? | ✅ Se queda, como enlace al formulario con «Algo a la medida» |

### Un solo pendiente destraba tres cosas: el correo de `sellpointy.com`

Con un correo del dominio (propuesta: `hola@sellpointy.com`, reenviado a tu Gmail) se cierran a la vez:

1. **El soporte** — se puede prometer «soporte por correo» en los planes (§5).
2. **El correo de contacto público** — el del pie y el del mensaje de error del formulario (§2, §9).
3. **El remitente de los avisos** — `F11-SITE-INFRA-05` ya pide verificar SPF, DKIM y
   DMARC de `sellpointy.com` en Resend; es el mismo trabajo de DNS.

### Lo que sigue abierto

| # | Decisión | Dónde |
|---|---|---|
| 6 | Lo legal: ¿abogado o plantilla revisada? Incluye la pregunta de la Ley 96 | §10, §8.4 |

Ninguna bloquea el arranque de la construcción (`F11-SITE-BASE`); todas bloquean
la publicación.
