# Sitio web de SellPointy — guía de diseño «El Punto»

> Dirección visual elegida por Carlos el 2026-09-18 para **sellpointy.com**, entre
> tres propuestas. Este documento reemplaza al prototipo: con lo que hay aquí se
> puede reconstruir el sitio sin haberlo visto.
>
> **Aquí vive CÓMO SE VE. Lo que el sitio DICE vive en
> [`SITIO-WEB-CONTENIDO.md`](SITIO-WEB-CONTENIDO.md)** — y cuando los dos
> discrepen en un texto, manda el de contenido: los de aquí son los del prototipo.
>
> **LEY (Carlos, 2026-09-18):** el sitio real **respeta este diseño**. El hero que
> se construya tiene que verse como el del prototipo: azul a sangre, el círculo
> oscuro saliéndose por la derecha, el titular gigante con el punto amarillo, los
> dos botones y la caja dibujada con su insignia «¡Escaneado!». Lo que el
> prototipo no tenía —planes, preguntas, formulario— se diseña con las reglas de
> §11, no con reglas nuevas.

## 1. La idea

El slogan es **«Tus ventas son el punto»**, y el diseño lo toma al pie de la
letra: el **punto** es el motivo gráfico de todo el sitio.

- El titular del hero termina en un **punto amarillo gigante** en lugar de un
  punto tipográfico.
- Ese mismo círculo reaparece como marca de cada función, como subrayado de los
  beneficios, como forma de fondo y como cierre («Ponle punto final al desorden»).
- Todo lo demás se queda quieto para que el punto se note: **un solo acento,
  usado con disciplina.**

Tono: serio y seguro, de marca. No es juguetón ni «startup». Habla a un dueño de
negocio que quiere ver que esto funciona.

## 2. Color

Cinco colores con nombre. El azul y el amarillo son la marca y **no cambian entre
tema claro y oscuro**; lo que cambia es el fondo, la superficie y la tinta.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--ground` | `#F4F5FA` | `#090C1F` | Fondo de la página. Un blanco frío, no puro |
| `--surface` | `#FFFFFF` | `#121735` | Bandas y tarjetas |
| `--ink` | `#0D1233` | `#ECEFFF` | Texto. Azul casi negro, nunca `#000` |
| `--muted` | `#565D80` | `#A3A9CC` | Texto secundario |
| `--line` | `rgba(13,18,51,.14)` | `rgba(236,239,255,.16)` | Filetes y bordes |
| `--blue` | `#1E3FD8` | `#2747E0` | **La marca.** Hero, bloque final, botones, marcas |
| `--blue-deep` | `#15309F` | `#16277F` | El círculo grande detrás del hero |
| `--on-blue` | `#FFFFFF` | igual | Texto sobre azul |
| `--on-blue-muted` | `rgba(255,255,255,.80)` | igual | Texto secundario sobre azul |
| `--dot` | `#FFC42E` | igual | **El punto.** El único acento |
| `--on-dot` | `#0D1233` | igual | Texto sobre amarillo |

Reglas:

- **El amarillo es escaso.** Punto del titular, botón principal, insignia
  «¡Escaneado!», subrayado de beneficios, una de las cuatro marcas y el círculo
  del bloque final. Si aparece en más lugares, deja de ser «el punto».
- Los neutros tiran a azul a propósito (`#0D1233`, `#565D80`): un gris puro se
  vería ajeno a la marca.
- El dibujo de la caja (`--mock*`) es **siempre claro**, también en tema oscuro:
  representa una pantalla del producto, no una superficie del sitio.
- En tema oscuro, los rótulos (`.eyebrow`) y el énfasis de los beneficios pasan
  de azul/subrayado a **amarillo**, porque el azul no contrasta sobre `#090C1F`.

## 3. Tipografía

Tres familias de Google Fonts, cada una con un papel:

| Papel | Familia | Pesos | Dónde |
|---|---|---|---|
| Titulares | **Bricolage Grotesque** | 700, 800 | `h1`, `h2`, `h3`, marca, total de la caja |
| Texto | **Instrument Sans** | 400, 500, 600 | Párrafos, navegación, botones |
| Datos | **JetBrains Mono** | 500 | Código de barras, etiqueta de propuesta |

```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap
```

Escala y ajustes:

| Elemento | Tamaño | Interlínea | Tracking |
|---|---|---|---|
| `h1` | `clamp(3rem, 8.4vw, 6.9rem)` | `.92` | `-.035em` |
| `h2` | `clamp(2.1rem, 4.6vw, 3.6rem)` | `1` | `-.03em` |
| `h3` de función | `clamp(1.6rem, 2.6vw, 2.2rem)` | `1.1` | `-.02em` |
| `h3` de beneficio | `clamp(1.45rem, 2.3vw, 1.95rem)` | `1.12` | `-.02em` |
| Entradilla | `clamp(1.1rem, 1.6vw, 1.3rem)` | `1.6` | — |
| Cuerpo | `1.0625rem` | `1.6` | — |
| Rótulo (`.eyebrow`) | `.8rem`, mayúsculas, peso 600 | — | `+.14em` |

- Los titulares van **apretados y grandes**: interlínea por debajo de 1 y
  tracking negativo. Es lo que les da presencia.
- `text-wrap: balance` en todos los titulares.
- Los párrafos no pasan de ~34–38em de ancho.
- Cifras con `font-variant-numeric: tabular-nums`.

## 4. El punto y sus variantes

Las cuatro funciones se marcan con cuatro estados del mismo círculo de 30 px. No
son iconos: son el punto, transformándose.

| Función | Marca | CSS |
|---|---|---|
| Vende | Punto lleno azul | `background: var(--blue)` |
| Controla | Anillo | `border: 7px solid var(--blue)` |
| Compra | Medio punto | `linear-gradient(90deg, var(--blue) 50%, transparent 50%)` + borde de 3 px |
| Decide | Punto amarillo | `background: var(--dot)` |

Otros usos del mismo motivo:

- **Titular:** `span.dot`, círculo de `.6em` pegado a la última palabra, en vez
  del punto tipográfico.
- **Logo:** el de la aplicación —la «S» con su punto dentro de un círculo—,
  recoloreado (Carlos, 2026-09-18). **Principal:** círculo `--blue`, «S» blanca,
  punto `--dot`. **Invertido**, para ir sobre el azul del hero y del cierre:
  círculo blanco, «S» `--blue`, punto `--dot`. El punto del logo es siempre
  amarillo. *(El prototipo lo improvisó con CSS —una «S» tipográfica y un
  puntito de 6 px—; el sitio real usa el SVG. Detalle en `SITIO-WEB-CONTENIDO.md` §12.)*
- **Fondo del hero:** círculo de `70vw` en `--blue-deep`, saliéndose por arriba a
  la derecha.
- **Bloque final:** círculo amarillo de 360 px saliéndose por abajo a la derecha.
- **Beneficios:** la palabra clave de cada titular lleva un subrayado grueso
  amarillo (`box-shadow: inset 0 -.38em 0 var(--dot)`).

## 5. Estructura de la página

Pocas secciones, en este orden:

1. **Hero** (azul a sangre): navegación + titular + entradilla + dos botones +
   la caja dibujada.
2. **Qué hace:** dos columnas. A la izquierda el titular, **pegado** al hacer
   scroll (`position: sticky`); a la derecha cuatro filas separadas por filetes.
3. **Beneficios** (banda en `--surface`): cuadrícula de **2×3** dentro de un solo
   marco con filetes internos — una tabla de seis celdas, no seis tarjetas
   sueltas. *(El prototipo tenía cuatro; Carlos aprobó seis el 2026-09-18.
   Verificado en el navegador: el mismo CSS aguanta las tres filas sin tocarlo —
   `:nth-child(2n)` quita el filete derecho y `:nth-last-child(-n+2)` el de abajo,
   sean cuatro celdas o seis — y en celular queda una columna con sus filetes.)*
4. **Para quién:** píldoras con los giros. Una de cada tres va rellena de tinta.
5. **Cierre:** bloque azul de esquinas de 32 px con el círculo amarillo.
6. **Pie:** una línea.

Medidas:

- Contenedor: `min(1180px, 100% - 32px)` — 16 px de margen en celular.
- Aire entre secciones: `clamp(64px, 9vw, 120px)`.
- Hero: rejilla `1.15fr / .85fr`, separación de 48 px.
- «Qué hace»: rejilla `.8fr / 1.2fr`, separación de 64 px.
- Radios: botones y píldoras `999px`; caja `22px`; marco de beneficios `24px`;
  bloque final `32px`. **Las filas de funciones no llevan radio:** son filetes.
- La alineación es **a la izquierda**. Nada centrado salvo el botón «Cobrar».

## 6. Componentes

**Botones** — píldora, `14px 22px`, peso 600. Tres variantes: `btn-dot`
(amarillo, el principal), `btn-ghost` (borde blanco translúcido, sobre azul) y
`btn-blue`. Al pasar el cursor suben 2 px.

**La caja dibujada** — tarjeta blanca de 22 px de radio con sombra larga
(`0 40px 80px -30px`). Dentro: cabecera en mayúsculas pequeñas, una franja
punteada con un código de barras hecho en CSS (`repeating-linear-gradient`),
tres líneas de venta, el total en Bricolage 800 a `2.3rem` y el botón «Cobrar».
Encima, girada 5°, la insignia amarilla «¡Escaneado!». **Es HTML y CSS, no una
imagen:** se ve nítida en cualquier pantalla y no hay captura que mantener.

**Filas de funciones** — rejilla `44px / 1fr`. Filete superior de 2 px en tinta
para abrir la lista y filetes de 1 px entre filas.

**Celdas de beneficios** — relleno `clamp(24px, 3.4vw, 44px)`. Titular + un
párrafo. Sin iconos.

**Píldoras de giros** — borde de 1.5 px en tinta; `:nth-child(3n+1)` rellena.

## 7. Movimiento

Una sola animación, a propósito: **el punto del titular aparece con un rebote**
al cargar (`scale 0 → 1`, 0.7 s, `cubic-bezier(.2,1.6,.4,1)`, retraso de 0.35 s).
Es el momento de la marca; más animación lo diluiría.

Lo demás es respuesta al cursor (botones que suben 2 px) y scroll suave. Con
`prefers-reduced-motion: reduce` todo eso se apaga.

## 8. Celular (≤ 900 px)

- La navegación se queda en logo + botón.
- Hero y «Qué hace» pasan a una columna; el titular deja de estar pegado.
- Beneficios pasa a una columna y conserva los filetes entre celdas.
- Verificado a 390 px: sin scroll horizontal.

## 9. Voz del texto

- Español neutro, de **tú**. Frases cortas. Verbos antes que adjetivos.
- Se habla del negocio del cliente, no del sistema: «Cobra en segundos, no en
  filas», no «POS de alto rendimiento».
- Las cuatro funciones son cuatro verbos: **Vende, Controla, Compra, Decide.**
- **No se inventa nada:** sin cifras de clientes, sin testimonios, sin precios
  hasta que existan de verdad.

**Los textos de abajo son los del PROTOTIPO y están superados.** Los vigentes,
aprobados por Carlos en tres idiomas, viven en `SITIO-WEB-CONTENIDO.md`. Dos
cambios que importan: la entradilla ya no dice «sabe exactamente cuánto tienes»
(eso es de Pro, y el hero lo lee quien va a comprar Basic), y los beneficios son
seis. Se conservan aquí solo como registro de lo que se aprobó visualmente:

- Titular: «Tus ventas son el punto●»
- Entradilla: «Punto de venta, inventario y compras en un solo lugar. Escanea,
  cobra y sabe exactamente cuánto tienes, desde la caja o desde tu celular.»
- Botones: «Empieza gratis» · «Ver qué hace». Debajo: «Sin instalar nada. Sin
  tarjeta para probarlo.»
- Qué hace: «Todo lo que pasa en tu mostrador, en una sola pantalla.»
- Beneficios: «Menos tiempo en el sistema. Más tiempo vendiendo.» — *Cobra en
  segundos, no en filas* · *Da de alta tu catálogo en una tarde* · *Que nada se
  te caduque en el anaquel* · *Tu negocio completo, en tu bolsillo*
- Para quién: «Hecho para el negocio que atiendes tú.»
- Cierre: «Ponle punto final al desorden.»

## 10. Lo que este diseño NO hace

- No usa degradados, ni iconos de librería, ni ilustraciones, ni fotos de stock.
- No centra los textos.
- No mete un segundo color de acento.
- No pone capturas del producto: la caja se dibuja en HTML.
- No redondea todo igual: cada radio está elegido (ver §5).

## 11. Lo que el prototipo NO tenía — y cómo se diseña sin salirse

El contenido aprobado pide cuatro piezas que el prototipo no dibujó. **Ninguna
trae reglas nuevas:** todas se arman con lo que ya existe arriba.

**La navegación crece.** El prototipo tenía tres enlaces y un botón; el sitio real
lleva *Qué hace · Beneficios · Planes · Preguntas*, el selector de país e idioma,
«Iniciar sesión» y «Empieza gratis». Para que el hero se siga viendo como el
aprobado: los enlaces conservan su estilo (`--on-blue-muted`, peso 500); el
selector e «Iniciar sesión» van como **texto**, sin borde ni fondo; **el único
elemento con color sigue siendo el botón amarillo**. Si a 1180 px no cabe todo en
un renglón, lo primero que se pliega es el selector (a un icono), nunca el botón.

**Planes** — tres columnas dentro de **un solo marco con filetes**, igual que los
beneficios: no tres tarjetas flotando. El nombre del plan en Bricolage 800; usuarios
y almacenes con `tabular-nums`; la lista con el **punto azul de 8 px** como viñeta
(el motivo, otra vez) y no con palomitas. **El plan recomendado no cambia de
color de fondo:** lleva arriba una píldora amarilla «Recomendado» —el mismo
recurso que la insignia «¡Escaneado!»— y su botón es el `btn-dot`; los otros dos
usan un botón con borde en tinta. Así el amarillo sigue siendo escaso y señala
una sola cosa. La franja de Premium es un renglón bajo el marco, con filete
arriba, sin caja propia.

**Preguntas frecuentes** — el mismo patrón de «Qué hace»: titular a la izquierda,
pegado; a la derecha, filas separadas por filetes (2 px en tinta para abrir, 1 px
entre filas), **sin radios ni cajas**. La pregunta en Bricolage 700 al tamaño del
`h3` de beneficio; el indicador de abrir/cerrar es **un punto**: anillo cuando
está cerrada, lleno cuando está abierta (`.mark.ring` → `.mark`, a 18 px).

**El formulario** — vive dentro del bloque azul del cierre o inmediatamente
debajo, sobre `--surface` con el radio de 24 px del marco de beneficios. Campos
con borde de 1.5 px en `--line`, radio de 12 px (el del botón «Cobrar»), foco con
el contorno amarillo de 3 px que ya usa todo el sitio. Etiquetas arriba del campo,
en peso 600. **Un solo botón, `btn-dot`.** El estado de éxito reemplaza al
formulario y abre con un punto amarillo grande que hace el mismo rebote del
titular: es la segunda y última animación del sitio, y se la gana.

**La píldora «Consultorios»** es la única de los giros que es un **enlace**: lleva
al formulario con «Algo a la medida» ya elegido. Se ve igual que las demás —no
gana color ni icono— y se distingue solo al pasar el cursor (sube 2 px, como los
botones) y con el foco del teclado. Las otras píldoras son texto y no reaccionan.

**Las etiquetas de plan** («Desde Pro», «En Plus») que acompañan a algunos
beneficios: texto en `.eyebrow` —mayúsculas pequeñas, azul; amarillo en tema
oscuro—, **sin píldora ni fondo**. Son una nota al pie, no un adorno.

---

## Anexo A — CSS completo del prototipo

Tal cual salió del prototipo aprobado. Las clases `.tag` y «Propuesta A» eran la
etiqueta de la propuesta y no van en el sitio real.

```css
:root{
  --ground:#F4F5FA; --surface:#FFFFFF; --ink:#0D1233; --muted:#565D80;
  --line:rgba(13,18,51,.14);
  --blue:#1E3FD8; --blue-deep:#15309F; --on-blue:#FFFFFF; --on-blue-muted:rgba(255,255,255,.80);
  --dot:#FFC42E; --on-dot:#0D1233;
  --mock:#FFFFFF; --mock-ink:#0D1233; --mock-muted:#5F6688; --mock-line:rgba(13,18,51,.12);
  --display:"Bricolage Grotesque","Arial Narrow",system-ui,sans-serif;
  --body:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#090C1F; --surface:#121735; --ink:#ECEFFF; --muted:#A3A9CC;
    --line:rgba(236,239,255,.16);
    --blue:#2747E0; --blue-deep:#16277F;
  }
}
:root[data-theme="dark"]{
  --ground:#090C1F; --surface:#121735; --ink:#ECEFFF; --muted:#A3A9CC;
  --line:rgba(236,239,255,.16);
  --blue:#2747E0; --blue-deep:#16277F;
}
*{box-sizing:border-box;margin:0}
html{scroll-behavior:smooth}
body{background:var(--ground);color:var(--ink);font-family:var(--body);font-size:1.0625rem;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}
:focus-visible{outline:3px solid var(--dot);outline-offset:3px;border-radius:4px}
.wrap{width:min(1180px,100% - 32px);margin-inline:auto}

/* ── Hero: el azul es la marca, en los dos temas ── */
.hero{background:var(--blue);color:var(--on-blue);position:relative;isolation:isolate;overflow:hidden}
.hero::before{content:"";position:absolute;z-index:-1;right:-18vw;top:-22vw;width:70vw;height:70vw;border-radius:50%;background:var(--blue-deep)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:22px}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--display);font-weight:800;font-size:1.3rem;letter-spacing:-.02em;text-decoration:none}
.brand i{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--on-blue);color:var(--blue);font-style:normal;font-size:1rem}
.brand i::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--dot);margin-left:1px;align-self:end;margin-bottom:9px}
.brand i{grid-auto-flow:column}
.nav ul{display:flex;gap:28px;list-style:none;padding:0;font-weight:500;font-size:.98rem}
.nav ul a{text-decoration:none;color:var(--on-blue-muted)}
.nav ul a:hover{color:var(--on-blue)}
.btn{display:inline-flex;align-items:center;gap:10px;font:600 1rem var(--body);padding:14px 22px;border-radius:999px;text-decoration:none;border:2px solid transparent;transition:transform .15s ease}
.btn:hover{transform:translateY(-2px)}
.btn-dot{background:var(--dot);color:var(--on-dot)}
.btn-ghost{border-color:rgba(255,255,255,.5);color:var(--on-blue)}
.btn-blue{background:var(--blue);color:var(--on-blue)}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center;padding-block:56px 96px}
h1{font-family:var(--display);font-weight:800;font-size:clamp(3rem,8.4vw,6.9rem);line-height:.92;letter-spacing:-.035em;text-wrap:balance}
h1 .dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--dot);margin-left:.06em;transform-origin:center;animation:pop .7s cubic-bezier(.2,1.6,.4,1) .35s both}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
.lead{font-size:clamp(1.1rem,1.6vw,1.3rem);color:var(--on-blue-muted);max-width:34em;margin-top:28px}
.cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.fine{margin-top:16px;font-size:.9rem;color:var(--on-blue-muted)}

/* ── La caja, dibujada ── */
.pos{background:var(--mock);color:var(--mock-ink);border-radius:22px;padding:22px;box-shadow:0 40px 80px -30px rgba(3,8,40,.65);position:relative}
.pos-head{display:flex;justify-content:space-between;align-items:center;font-size:.8rem;color:var(--mock-muted);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.scan{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border:1.5px dashed var(--mock-line);border-radius:12px;font-family:var(--mono);font-size:.85rem}
.bars{width:46px;height:26px;flex:none;background:repeating-linear-gradient(90deg,var(--mock-ink) 0 2px,transparent 2px 4px,var(--mock-ink) 4px 7px,transparent 7px 9px,var(--mock-ink) 9px 10px,transparent 10px 13px)}
.pos ul{list-style:none;padding:0;margin-top:8px}
.pos li{display:flex;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid var(--mock-line);font-size:.98rem}
.pos li span:last-child{font-variant-numeric:tabular-nums;font-weight:600}
.pos li small{display:block;color:var(--mock-muted);font-size:.8rem}
.total{display:flex;justify-content:space-between;align-items:baseline;margin-top:16px;font-family:var(--display);font-weight:800}
.total b{font-size:2.3rem;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pay{margin-top:14px;display:block;text-align:center;background:var(--blue);color:var(--on-blue);padding:14px;border-radius:12px;font-weight:600}
.badge{position:absolute;right:-14px;top:-18px;background:var(--dot);color:var(--on-dot);font-weight:700;font-size:.85rem;padding:9px 14px;border-radius:999px;transform:rotate(5deg)}

/* ── Secciones ── */
section{padding-block:clamp(64px,9vw,120px)}
.eyebrow{font-size:.8rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--blue)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .eyebrow{color:var(--dot)}}
:root[data-theme="dark"] .eyebrow{color:var(--dot)}
h2{font-family:var(--display);font-weight:800;font-size:clamp(2.1rem,4.6vw,3.6rem);line-height:1;letter-spacing:-.03em;text-wrap:balance;margin-top:14px}
.split{display:grid;grid-template-columns:.8fr 1.2fr;gap:64px;align-items:start}
.split > div:first-child{position:sticky;top:32px}
.split p.sub{color:var(--muted);margin-top:18px;max-width:30em}
.rows{border-top:2px solid var(--ink)}
.row{display:grid;grid-template-columns:44px 1fr;gap:20px;padding-block:30px;border-bottom:1px solid var(--line)}
.row h3{font-family:var(--display);font-weight:700;font-size:clamp(1.6rem,2.6vw,2.2rem);letter-spacing:-.02em;line-height:1.1}
.row p{color:var(--muted);margin-top:8px;max-width:38em}
.mark{width:30px;height:30px;margin-top:6px;border-radius:50%;background:var(--blue)}
.mark.ring{background:transparent;border:7px solid var(--blue)}
.mark.half{background:linear-gradient(90deg,var(--blue) 50%,transparent 50%);border:3px solid var(--blue)}
.mark.sun{background:var(--dot)}

.band{background:var(--surface);border-block:1px solid var(--line)}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:0;margin-top:48px;border:1px solid var(--line);border-radius:24px;overflow:hidden}
.card{padding:clamp(24px,3.4vw,44px);border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.card:nth-child(2n){border-right:0}
.card:nth-last-child(-n+2){border-bottom:0}
.card h3{font-family:var(--display);font-weight:700;font-size:clamp(1.45rem,2.3vw,1.95rem);line-height:1.12;letter-spacing:-.02em;text-wrap:balance}
.card h3 em{font-style:normal;box-shadow:inset 0 -.38em 0 var(--dot)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .card h3 em{box-shadow:none;color:var(--dot)}}
:root[data-theme="dark"] .card h3 em{box-shadow:none;color:var(--dot)}
.card p{color:var(--muted);margin-top:12px}

.giros{display:flex;flex-wrap:wrap;gap:10px;margin-top:36px}
.giros span{border:1.5px solid var(--ink);border-radius:999px;padding:10px 20px;font-weight:500}
.giros span:nth-child(3n+1){background:var(--ink);color:var(--ground)}

.final{background:var(--blue);color:var(--on-blue);border-radius:32px;padding:clamp(40px,7vw,96px);position:relative;overflow:hidden;isolation:isolate}
.final::after{content:"";position:absolute;z-index:-1;right:-90px;bottom:-130px;width:360px;height:360px;border-radius:50%;background:var(--dot)}
.final h2{margin-top:0;max-width:12em}
.final p{color:var(--on-blue-muted);margin-top:18px;max-width:30em}
footer{padding-block:40px;color:var(--muted);font-size:.92rem;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.tag{position:fixed;left:16px;bottom:16px;z-index:9;background:var(--ink);color:var(--ground);font:500 .78rem var(--mono);padding:8px 12px;border-radius:8px}

@media (max-width:900px){
  .nav ul{display:none}
  .hero-grid,.split{grid-template-columns:1fr;gap:40px}
  .split > div:first-child{position:static}
  .hero-grid{padding-block:32px 72px}
  .cards{grid-template-columns:1fr}
  .card{border-right:0}
  .card:nth-last-child(2){border-bottom:1px solid var(--line)}
  .badge{right:8px}
}
@media (prefers-reduced-motion: reduce){h1 .dot{animation:none}.btn{transition:none}html{scroll-behavior:auto}}
```

## Anexo B — Estructura HTML del prototipo

```html
<header class="hero">
  <div class="wrap">
    <nav class="nav" aria-label="Principal">
      <a class="brand" href="#"><i>S</i>SellPointy</a>
      <ul>
        <li><a href="#que-hace">Qué hace</a></li>
        <li><a href="#beneficios">Beneficios</a></li>
        <li><a href="#giros">Para quién</a></li>
      </ul>
      <a class="btn btn-dot" href="#empezar">Empieza gratis</a>
    </nav>
    <div class="hero-grid">
      <div>
        <h1>Tus ventas son el punto<span class="dot" aria-hidden="true"></span></h1>
        <p class="lead">Punto de venta, inventario y compras en un solo lugar. Escanea, cobra y sabe exactamente cuánto tienes, desde la caja o desde tu celular.</p>
        <div class="cta-row">
          <a class="btn btn-dot" href="#empezar">Empieza gratis</a>
          <a class="btn btn-ghost" href="#que-hace">Ver qué hace</a>
        </div>
        <p class="fine">Sin instalar nada. Sin tarjeta para probarlo.</p>
      </div>
      <div class="pos" aria-label="Ejemplo de una venta en SellPointy">
        <span class="badge">¡Escaneado!</span>
        <div class="pos-head"><span>Venta en curso</span><span>Caja 1</span></div>
        <div class="scan"><span class="bars" aria-hidden="true"></span>7501055300013</div>
        <ul>
          <li><span>Agua natural 1 L<small>2 piezas</small></span><span>$28.00</span></li>
          <li><span>Galletas de avena 170 g<small>1 pieza</small></span><span>$24.90</span></li>
          <li><span>Aceite de oliva 500 ml<small>1 pieza</small></span><span>$189.00</span></li>
        </ul>
        <div class="total"><span>Total</span><b>$241.90</b></div>
        <span class="pay">Cobrar</span>
      </div>
    </div>
  </div>
</header>

<main>
<section id="que-hace">
  <div class="wrap split">
    <div>
      <p class="eyebrow">Qué hace</p>
      <h2>Todo lo que pasa en tu mostrador, en una sola pantalla.</h2>
      <p class="sub">Deja de saltar entre la libreta, el Excel y la calculadora. SellPointy une lo que vendes con lo que tienes y lo que compras.</p>
    </div>
    <div class="rows">
      <div class="row"><span class="mark" aria-hidden="true"></span><div><h3>Vende</h3><p>Punto de venta con lector de códigos, pistola Bluetooth o la cámara de tu celular. Cotizaciones, tickets y cierre de turno sin hojas de cálculo.</p></div></div>
      <div class="row"><span class="mark ring" aria-hidden="true"></span><div><h3>Controla</h3><p>Entradas, salidas, traspasos e inventario físico. Lotes, caducidades y el historial de cada producto, en todos tus almacenes.</p></div></div>
      <div class="row"><span class="mark half" aria-hidden="true"></span><div><h3>Compra</h3><p>Órdenes de compra, proveedores y costos siempre al día, para que el precio que pones deje la ganancia que esperas.</p></div></div>
      <div class="row"><span class="mark sun" aria-hidden="true"></span><div><h3>Decide</h3><p>Reportes de ventas, gastos y existencias: qué se mueve, qué se estanca y qué está por vencer, sin armar nada a mano.</p></div></div>
    </div>
  </div>
</section>

<section class="band" id="beneficios">
  <div class="wrap">
    <p class="eyebrow">Beneficios para tu negocio</p>
    <h2>Menos tiempo en el sistema. Más tiempo vendiendo.</h2>
    <div class="cards">
      <article class="card"><h3>Cobra en <em>segundos</em>, no en filas.</h3><p>Escaneas y el producto ya está en la cuenta. Nadie espera mientras buscas un precio en la libreta.</p></article>
      <article class="card"><h3>Da de alta tu catálogo en <em>una tarde</em>.</h3><p>Con la Carga rápida escaneas el código y SellPointy reconoce el producto y te sugiere su nombre. Tú solo pones el precio.</p></article>
      <article class="card"><h3>Que nada se te <em>caduque</em> en el anaquel.</h3><p>Lotes con fecha y avisos de lo que está por vencer, para venderlo a tiempo en lugar de tirarlo.</p></article>
      <article class="card"><h3>Tu negocio completo, <em>en tu bolsillo</em>.</h3><p>Funciona en computadora, tablet y celular. En español y en inglés. Entras desde donde estés y ves lo mismo que en la caja.</p></article>
    </div>
  </div>
</section>

<section id="giros">
  <div class="wrap">
    <p class="eyebrow">Para quién</p>
    <h2>Hecho para el negocio que atiendes tú.</h2>
    <div class="giros">
      <span>Abarrotes</span><span>Farmacias</span><span>Minisúper</span><span>Ferreterías</span><span>Papelerías</span><span>Consultorios</span><span>Boutiques</span><span>Refaccionarias</span><span>Tiendas naturistas</span><span>Dulcerías</span>
    </div>
  </div>
</section>

<section id="empezar" style="padding-top:0">
  <div class="wrap">
    <div class="final">
      <h2>Ponle punto final al desorden.</h2>
      <p>Crea tu cuenta, escanea tus primeros productos y haz tu primera venta hoy mismo.</p>
      <div class="cta-row"><a class="btn btn-dot" href="#">Empieza gratis</a></div>
    </div>
  </div>
</section>
</main>

<div class="wrap"><footer><span>© 2026 SellPointy. Tus ventas son el punto.</span><span>sellpointy.com</span></footer></div>
<span class="tag">Propuesta A · El Punto</span>
```
