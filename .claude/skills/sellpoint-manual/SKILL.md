---
name: sellpoint-manual
description: >
  Cómo se mantiene al día el manual de usuario de SellPointy (`docs/manual/es/` y las capturas
  de `apps/manual`): qué capítulo toca un cambio, cómo se corrige su texto, cómo se retoman
  sus capturas y qué revisa la prueba del CI.
  Trigger: cualquier cambio en apps/web que altere una pantalla, un texto visible o un flujo;
  un cambio del API que cambie lo que el usuario ve o puede hacer (candados de plan, permisos,
  reglas, mensajes, PDF); escribir o corregir un capítulo o una captura del manual; o que
  `pnpm --filter manual test` falle.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Cambiaste una pantalla del web: un componente, una ruta o un texto de `apps/web/src/i18n/es`.
- Cambiaste el API y eso cambia lo que alguien ve o puede hacer: un candado de plan, un
  permiso, una regla, un mensaje de `apps/api/src/i18n/es`, un PDF (ticket, cotización).
- Vas a escribir un capítulo o una captura nueva.
- La prueba del manual falló en el CI.

## La regla en una frase

**El capítulo se corrige en el MISMO commit que el cambio de pantalla.** El manual describe
lo que SellPointy hace HOY; si el cambio va a producción sin su capítulo, el PDF miente desde
ese día. Pasó en F10-MANFIX: seis pantallas arregladas, cinco capítulos a mano y una captura
rota (`pos:view`) que nadie vio hasta regenerar el manual.

## Pasos

1. **Qué toca.** `pnpm --filter manual affected` (contra `origin/main`, más lo que no has
   commiteado; o `affected <base>`). Dice qué capítulos tienen pantallas que cambiaste (sigue los
   imports del componente hasta la ruta, y las capturas que llegan a ella), qué textos viejos
   del web o del API cita todavía el manual (archivo:línea) y cuándo hay que retomar todas las
   capturas (cambió `seed.ts`, `demo.ts` o `capture.ts`). Lo que no ve: una regla del API que
   el manual cuenta con sus palabras. Para eso, busca el tema en `docs/manual/es/` con `rg`.
2. **Corrige el texto** leyendo el código, no de memoria: el copy exacto sale de los JSON de
   i18n, las reglas del servicio y los candados del plan. Reglas del contenido
   (`docs/manual/README.md`): español neutro con «tú», sin jerga, sin «asentar» («registrar»
   para la acción, «confirmado» para el estado), nada que venga en camino. Si cambian el
   título, quién o el plan de un capítulo, cambia también su fila del índice en el README.
3. **Corrige la captura** si cambió un texto o un selector que usa:
   `apps/manual/src/screens/<parte>.ts` (reglas abajo).
4. **Retómala y mírala.** Con Colima encendido: `pnpm --filter manual manual --serve` (deja
   SellPointy en :5199) y, en otra terminal, `pnpm --filter manual exec tsx src/shoot.ts <id o
   capítulo>`. Ábrela con Read en `docs/manual/dist/img/<id>.png`: que se vea lo que el
   texto dice, sin recortes raros ni datos que no son de la demo.
5. **Prueba.** `pnpm --filter manual test` y `pnpm --filter manual typecheck:full`. Para ver el
   PDF: `pnpm manual:pdf`.
6. **Commit** del cambio de pantalla, el capítulo y la captura juntos.

## Cómo se escribe una captura que pasa la prueba

- **Un objeto literal por captura**, con `id: "…"` fijo (una cadena, no un template) y
  `chapter`. Nada de capturas armadas en un bucle: la prueba lee el código sin correrlo y no
  las vería.
- **Busca por lo que la persona lee**: `getByRole(…, { name })`, `getByLabel`,
  `getByText(…, { exact: true })`, `filter({ hasText })`, `selectOption({ label })`,
  `card(page, "Título")`. Cada literal tiene que existir en las traducciones (web o API, en el
  idioma de la captura: `locale: "en"` usa las de inglés) o en los datos de `seed.ts`/`demo.ts`.
  Si viaja por una función auxiliar (`card`, `title`, `openRow`), la prueba lo sigue.
- **Lo que no sale de ahí** (folios como `SAL-000003`, códigos de barras, montos, nombres que
  pone el API como el rol «Cajero»): una regex (`/^Gasto GAS-/`, que la prueba omite) o una
  entrada en `TEXT_EXCEPTIONS` de `apps/manual/src/manual.test.ts` con su motivo (`why`) y, si
  el texto está escrito en un archivo del repo, ese archivo (`source`): la prueba vigila que
  siga ahí.
- **Los roles de fábrica** llevan el nombre en el idioma de la dueña (la demo, en español:
  Administrador, Encargado, Cajero, Consulta). En `seed.ts` se buscan por su llave con
  `factoryRole(roles, "seller")`, nunca por su nombre.
- **`getByTestId`, `#id`, `[for='…']`, `[data-testid='…']`**: el valor tiene que estar entre
  comillas en `apps/web/src`.
- **Si abre un detalle desde un listado, espera su URL** con `page.waitForURL(/…/)`: así
  `affected` sabe que la captura retrata el detalle.
- **Una captura MIRA**: `prepare` no guarda, no cobra, no confirma.
- **Una pantalla con candado de plan** (`<FeatureGate>`) solo va en un capítulo marcado con ese
  plan o uno mayor.

## Qué revisa la prueba (`apps/manual/src/manual.test.ts`, corre en el CI)

| Revisa | Si falla |
|---|---|
| Cada capítulo abre con `title`, `who` (todos · cajero · dueño) y `plan` opcional (Desde Basic · Desde Pro · En Plus, con aclaración entre paréntesis) | Corrige el bloque inicial |
| El índice del README y `docs/manual/es/` coinciden: archivos, títulos, quién y plan | Escribe el capítulo que falta o corrige la fila |
| Ids únicos; cada `screen:` citado existe y es de ese capítulo; cada captura la cita su capítulo | Cita la captura o bórrala del registro |
| El `path` de cada captura existe en `routeTree.gen.ts` | Corrige la ruta |
| Un capítulo no muestra una pantalla de un plan mayor que su marca | Sube la marca o cambia la captura |
| Cada texto, `data-testid` e id que busca una captura existe | Corrige la captura (y el capítulo) o agrega la excepción con su motivo |
| Sin «asentar» ni voseo en los capítulos | Español neutro con «tú» |

## Comandos

```bash
pnpm --filter manual affected [base]              # qué revisar (por omisión, origin/main)
pnpm --filter manual test                         # la prueba del CI, en un segundo
pnpm --filter manual manual --serve               # SellPointy con la demo en :5199
pnpm --filter manual exec tsx src/shoot.ts <id>   # retoma esas capturas (id o carpeta del capítulo)
pnpm manual                                       # todas las capturas y el PDF (unos 10 min)
pnpm manual:pdf                                   # solo el PDF, con las capturas que ya hay
```

## Anti-patrones

- Dejar el capítulo «para después» o en otro commit.
- Copiar un texto de la pantalla de memoria en vez de leerlo del JSON de i18n.
- Pegar una imagen a mano o citar algo que no sea `screen:<id>`.
- Agregar a `TEXT_EXCEPTIONS` un texto que sí está en las traducciones: corrige la captura.
- Describir algo que todavía no está en producción.
