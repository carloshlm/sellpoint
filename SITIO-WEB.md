# El sitio público de sellpointy.com — cómo se trabaja

> Guía de uso del sitio (`apps/site`). Para **cómo se ve**, `SITIO-WEB-DISENO.md`;
> para **qué dice**, `SITIO-WEB-CONTENIDO.md`; para **lo legal**,
> `SITIO-WEB-LEGAL.md`; para **el servidor** (vhosts, certificado, publicar,
> volver atrás), `infrastructure/nginx/SITIO-PUBLICO.md`. Las decisiones de cada
> tarea están en `IMPLEMENTACION.md`, módulo F11-SITE.

## En una página

- **Qué es:** HTML estático armado con Astro. Sin servidor de Node, sin React y
  con unos 6 KB de JavaScript. Lo sirve el `nginx-edge` que ya existe.
- **Dónde vive:** `https://sellpointy.com` (el sitio completo, publicado el
  2026-09-19) y `https://website-sandbox.sellpointy.com` (el mismo sitio, de
  ensayo, con `noindex` y contra el API del sandbox).
- **Qué le pide al servidor:** dos endpoints del API propio —el formulario y la
  medición—, llamados en SU MISMO dominio (`/api/public/…`). Sin terceros, sin
  cookies y sin CORS.
- **Cómo se publica:** solo. Un push que toque `apps/site` corre el workflow
  «Sitio»: primero el de ensayo y, si su prueba de humo pasa, producción.

```bash
pnpm --filter site dev                 # http://localhost:4321
pnpm --filter site test                # construye el sitio y corre las barreras
pnpm --filter site typecheck:full      # astro check
pnpm --filter site lighthouse          # el presupuesto de rendimiento
pnpm --filter site build && pnpm --filter site check:publishable   # ¿se puede publicar?
```

Las pruebas leen el sitio **ya construido** (`test/global-setup.ts` lo arma una
vez): lo que importa es lo que llega al navegador, no lo que dice el código.

## Dónde está cada cosa

| Quiero cambiar… | Está en… |
|---|---|
| Un texto | `src/i18n/locales/{es,en,fr}.ts` |
| Un texto que cambia por PAÍS y no por idioma | `src/i18n/overrides.ts` |
| Mercados, idiomas, monedas, **precios prendidos o apagados** | `src/config/markets.ts` |
| El orden de los beneficios, qué preguntas lleva cada versión, la caja dibujada | `src/config/page.ts` |
| Qué incluye cada plan | `packages/shared/src/plan-showcase.ts` (lo lee también la aplicación) |
| Un color, un tamaño, un radio | `src/styles/tokens.css` — el ÚNICO lugar con colores |
| Una sección de la página | `src/sections/` |
| Una foto | `src/assets/images/` (NUNCA `public/`: ahí no se optimiza) y `<Picture>` como en `sections/InAction.astro` |
| Los números del panel dibujado | `MOCK_DASHBOARD` en `src/config/page.ts` |
| El texto legal | `SITIO-WEB-LEGAL.md` — el sitio lo LEE de ahí al construir |
| A dónde sugiere ir a cada visitante | `src/geo/suggest-market.ts` y su tabla de casos |

## Cambiar un texto

1. Edita la clave en el idioma que corresponda. **Las claves van en inglés; el
   valor, en el idioma de quien lo lee.**
2. Si la clave es nueva, agrégala en los TRES idiomas: el español es el maestro y
   define el tipo, así que una clave que falte no compila — y además falla
   `test/i18n.test.ts`.
3. Si el texto cambia por país (`es-us` no dice «de un jalón»; `en-ca` escribe
   *catalogue*), va en `overrides.ts`, no en el idioma base.
4. La palabra subrayada de un beneficio se marca con `*asteriscos*` DENTRO del
   texto: quien traduce decide cuál es en su idioma.

> ⚠️ **El francés y sus espacios.** Antes de `? ! : ;` y dentro de « » va un
> espacio de NO separación, escrito con su código (`\u202f` o `\u00a0`), nunca
> tecleado: tecleado no se distingue de un espacio normal y el primero que
> «limpie» el archivo lo rompe. Hay barrera. Si el texto lo escribe un asistente
> de IA, que lo genere por programa: al teclear el código, llega convertido al
> carácter invisible.

Un componente de `src/components/` **no puede llevar un texto escrito dentro**
(ni en un `aria-label`): todo llega por propiedades o por *slots*. Hay barrera.

## Agregar un idioma

1. `LANGUAGES` y `LANGUAGE_NAMES` en `markets.ts` — el nombre, en su propio
   idioma («Português», no «Portugués»).
2. Un archivo nuevo en `src/i18n/locales/`, tipado como `Messages`. El compilador
   dice qué falta.
3. Regístralo en `LOCALE_MESSAGES` (`src/i18n/index.ts`).
4. Las direcciones de lo legal en ese idioma: `LEGAL_SLUGS` (`config/legal.ts`),
   y sus tramos en `BOUNDS` (`legal/load.ts`) — con el texto ya traducido en
   `SITIO-WEB-LEGAL.md`.
5. La imagen para redes: `public/og/<idioma>.png` (receta en
   `scripts/og-card.js`).
6. Si la APLICACIÓN todavía no habla ese idioma, agrégalo a
   `APP_MISSING_LANGUAGES` (`config/page.ts`): la sección de planes lo dirá a la
   vista. Prometer un idioma en la portada y entregar otro adentro es la queja
   más fácil de evitar.

## Agregar un mercado

1. Una fila en `MARKETS` (país ISO, moneda, `showPrices: false`) y sus rutas en
   `LOCALES`. La ruta se arma sola: `<idioma>-<país>`.
2. Sus zonas horarias en `src/geo/zones.ts`, y los casos nuevos en
   `test/suggest-market.test.ts`. **Es la pieza que más se va a querer tocar:
   quien la cambie, que deje ahí la fila que lo motivó.**
3. El nombre del país en los tres idiomas (`markets`) y las frases del aviso
   (`geo.notice`), cada una en el idioma de la versión que ofrece.
4. En `config/page.ts`: `BENEFIT_ORDER`, `FAQ_ORDER` y `MOCK_SALE` (el código de
   barras y los importes de la caja dibujada, en SU moneda; una prueba exige que
   el total sea la suma).
5. Los giros de ese país (`whoFor.trades`, por `overrides.ts` si comparten idioma
   con otro mercado).
6. El precio de ese país tiene que existir en el API
   (`GET /billing/plans?country=`), con la MISMA resolución de mercado del cobro.

El selector, el `hreflang`, el sitemap y las páginas legales salen de la matriz:
no hay que tocarlos.

## Prender los precios de un país

Hoy están apagados en los tres mercados, **y apagados no viajan en el HTML** —ni
escondidos con CSS—. Prenderlos es cambiar un `false` por un `true`.

**Antes, el ensayo** (es `F11-SITE-QA-05`, y ya se hizo una vez el 2026-09-19):

```bash
# 1. En src/config/markets.ts:   mx: { …, showPrices: true }
# 2. Construir contra el API del sandbox, en una carpeta aparte:
SITE_API_URL=https://sandbox.sellpointy.com/api \
  pnpm --filter site exec astro build --outDir /tmp/sitio-con-precios
```

Y comprobar, en `/tmp/sitio-con-precios/es-mx/index.html`:

- [ ] Los precios son **los que cobra la aplicación** (hoy `$199 / $349 / $499`).
- [ ] El anual cuesta diez meses (`$1,990…`) y aparece «Paga 10 meses, usa 12».
- [ ] Aparece **«Precios para México.»** con su salida «¿Estás en otro país?».
      Sin esa línea, un visitante de Colombia —que ve la versión mexicana— vería
      pesos y pagaría dólares: el cobro le aplica el precio de Estados Unidos.
- [ ] Los otros mercados siguen SIN precio.
- [ ] Con el API caído (`SITE_API_URL=http://127.0.0.1:9`), **la construcción
      falla**. Publicar sin precios por accidente es peor que no publicar.

**Para prenderlos de verdad:**

1. `showPrices: true` en el mercado. Es del MERCADO, no de la ruta: prender
   Canadá prende `/en-ca/` y `/fr-ca/` a la vez.
2. El workflow «Sitio» necesita `SITE_API_URL` para construir (hoy no la tiene,
   porque no le hace falta): agrégala al paso de construcción de
   `.github/workflows/site.yml`.
3. Agrega `offers` a los datos estructurados (`sections/StructuredData.astro`),
   desde los MISMOS precios que pintan las tarjetas, y cambia a propósito la
   prueba «sin `offers`» de `test/seo.test.ts`. Declararle a Google un precio que
   la página no enseña —o al revés— es motivo de penalización.
4. **Un cambio de precio pide reconstruir el sitio:** el precio queda escrito en
   el HTML (por eso abre al instante y Google lo lee). Basta correr el workflow
   «Sitio» a mano desde Actions.

## Publicar el sitio completo en producción

**Ya está publicado** (2026-09-19): los huecos `[[…]]` de `SITIO-WEB-LEGAL.md`
se llenaron —el responsable es una persona física con SellPointy como nombre
comercial— y la variable de repositorio `SITE_PUBLISH_FULL` está en `true`.

Lo que decide qué sirve `sellpointy.com`:

1. **El candado legal.** Con `SITE_PUBLISH_FULL` en `true`, **un solo hueco
   `[[…]]` detiene todo** antes de empaquetar. Un hueco nuevo se ve en amarillo
   en `website-sandbox.sellpointy.com/es-mx/privacidad/`, y se comprueba con
   `pnpm --filter site build && pnpm --filter site check:publishable` (tiene que
   responder «Publicable»).
2. **Volver a «en construcción»:** `gh variable set SITE_PUBLISH_FULL --body
   false` y correr el workflow «Sitio». Regresar, la misma variable en `true`.
3. **Si cambia el responsable** (por ejemplo, al constituir una sociedad):
   P1 y T1 de `SITIO-WEB-LEGAL.md` en los tres idiomas, y la identidad del
   remitente en `apps/api/src/modules/mail/templates/sender-identity.ts`.
4. **La aceptación DENTRO de la aplicación está encendida** desde el 2026-09-19
   (`CURRENT_TERMS_VERSION` en `packages/shared/src/terms.ts`): el registro pide
   dos casillas —términos y aviso de privacidad— y quien ya tenía cuenta las
   acepta al entrar. **Si un texto legal cambia de fondo, pon ahí la fecha
   nueva:** todos vuelven a aceptar. Un retoque de redacción NO pide fecha
   nueva, porque cada cambio le pone la pared a todos los usuarios.

## Las barreras, y qué cuida cada una

Una barrera es una prueba que falla cuando alguien rompe una regla del sitio sin
darse cuenta. Si una se pone roja, **no se apaga: se lee el comentario que trae**.

| Prueba | Falla si… |
|---|---|
| `scaffold` | entra un adaptador de servidor o un framework de interfaz |
| `tokens` | aparece un color fuera de `tokens.css`, o los dos bloques del tema oscuro se separan |
| `contrast` | un par de texto baja de AA, o el foco deja de verse sobre algún fondo |
| `fonts` | se pide una fuente a un tercero, o se precarga más de una |
| `i18n` | a un idioma le falta una clave, o hay un espacio invisible tecleado |
| `components` | un componente trae un texto escrito dentro |
| `sections` | una imagen pesa más de 250 KB, los números del panel no cuadran, o el panel —que es de todos los planes— habla de existencias |
| `pages` | aparece una página que nadie pidió, o un guion incrustado en el HTML (la CSP lo bloquearía) |
| `seo` | el `hreflang` deja de ser recíproco, o se declara un precio con los precios apagados |
| `plans` | el sitio y la aplicación llaman distinto a una línea de plan, o un precio apagado viaja en el HTML |
| `lead-logic` | lo que arma el formulario deja de pasar el esquema REAL del API |
| `legal` | un hueco `[[…]]` aparece fuera de las páginas legales, o la app enlaza a una dirección legal que no existe |
| `construction` | la página «en construcción» trae más de una página, o un hueco legal |

Y dos que viven fuera de `pnpm test`: `check:publishable` (el candado legal, en
el pipeline) y el presupuesto de Lighthouse (rendimiento ≥ 95, accesibilidad 100,
titular pintado en menos de 2.5 s, menos de 50 KB de JavaScript, cero terceros).

## Lo que sigue pendiente

- **De Carlos:** confirmar el dominio «Verified» en Resend y pasar el remitente
  a `no-reply@sellpointy.com` (que los avisos lleguen a la bandeja y no a
  correo no deseado) · decidir si el sitio de ensayo —abierto a internet, solo
  con `noindex`— necesita contraseña.
- **Ya resuelto, para quien lo busque:** a quién se le avisa de un prospecto lo
  decide `PLATFORM_NOTIFY_EMAILS` en el `.env` del servidor (hoy,
  `contact@sellpointy.com`, en producción y en el sandbox). Es distinta de
  `BILLING_ADMIN_EMAILS`, que decide QUIÉN ENTRA al backoffice; vacía, los avisos
  caen en esa otra. Cambiarla pide recrear el API (`up -d --force-recreate`): un
  `restart` no vuelve a leer el `.env`.
- **De una persona, no de una herramienta:** el sitio en aparatos de verdad
  (Safari de iPhone, Chrome de Android), la lectura de cada idioma por alguien
  que lo hable como lengua materna, y el recorrido con lector de pantalla.
- **Pospuesto con nombre:** página por giro, blog, testimonios, comparativas,
  más mercados, el francés dentro de la aplicación, captcha, envío a un CRM.
