# Contribuir a SellPoint

> **TL;DR:** commits convencionales en español, `main` deploya a producción automáticamente, el pre-commit no perdona, y donde hay lógica hay TDD. Si vas a hacer un cambio grande, primero mirá el árbol de decisión SDD en [IMPLEMENTACION.md](./IMPLEMENTACION.md#11-criterio-sdd--usamos-spec-driven-development-en-esta-tarea).

## Commits

- **Conventional Commits, en español, en minúsculas**: `feat(api): agrega healthcheck de redis`
- Tipos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`
- `commitlint` rechaza lo que no cumpla el formato
- **Sin `Co-Authored-By` ni atribución de herramientas** — regla dura del repo
- **Commits por unidad de trabajo entregable**: el código, sus tests y sus docs van JUNTOS en el mismo commit — nunca "commit de modelos, commit de tests" por separado

## Branches y deploy

| Branch | Qué pasa |
|--------|----------|
| `main` | **Cada push deploya a producción** (build → GHCR → SSH deploy → smoke test con rollback) |
| ramas | `feat/nombre-corto`, `fix/nombre-corto` — merge a main cuando estés listo |

> ⚠️ Push a `main` = producción en ~2 minutos. Los checks (lint + tests + build) corren ANTES del deploy y lo frenan si fallan — pero igual: lo que pusheás, se publica.

## Pre-commit (automático)

`husky` + `lint-staged` corren **Biome** sobre los archivos staged. Si hay errores de lint o formato, el commit se rechaza. Biome es el ÚNICO linter/formatter del repo — los scaffolds que traen ESLint/Prettier/oxlint se desarman al integrarlos.

## Testing

- **TDD estricto donde hay lógica**: test RED primero, después el código (GREEN), después refactor
- API: `jest` (`pnpm --filter api test`, e2e con `test:e2e`) · Web: `vitest` (`pnpm --filter web test`)
- Config/wiring puro no exige TDD, pero SÍ verificación explícita (el criterio de "hecho" de cada tarea del plan)

### Qué SÍ y qué NO se testea (LEY, Carlos 2026-08-16)

Criterio: **¿la aserción verifica una decisión que toma el código, o solo que
una constante se pintó?**

| ✅ Se testea | ❌ No se testea |
|---|---|
| "Elijo México → aparece la etiqueta (RFC)" — salida de la lógica de derivación | "La línea de ayuda existe" — copy estático |
| "Elijo España → el selector ofrece solo sus 2 zonas" (afirmado por **id IANA**, no por etiqueta) | "La etiqueta dice exactamente 'España — Peninsular…'" |
| Reglas transversales sobre datos (el guardián de voseo) | Que un texto de producto siga estando |

Motivo: un test de copy no protege nada —si alguien borra la línea, no se rompe
nada— y cobra peaje cada vez que se ajusta una palabra. Afirmar por
identificador en vez de por etiqueta desacopla el test del copy sin perder
cobertura de la lógica.

Y si un guardián recorre muchas entradas, que sea **un** test que las recorra y
reporte todas las violaciones juntas, no un `it.each` que infle la suite con una
prueba por dato.

## Copy de la UI

Español **neutro** (nunca voseo: `tienes`, no `tenés`) e inglés **americano**.
Aplica a `apps/web/src/i18n/**` y `apps/api/src/i18n/**` — web, errores de API y
correos. Detalle y tabla de equivalencias en [MERCADOS.md §3](./MERCADOS.md).
Hay un test guardián que falla en CI si se cuela una forma voseante.

## Las 3 fuentes de verdad

1. **Código** — lo que ES
2. **[IMPLEMENTACION.md](./IMPLEMENTACION.md)** — checkboxes de progreso + Bitácora de decisiones (§13, una línea por decisión con su `topic_key`)
3. **engram** — memoria persistente de las sesiones con Claude (decisiones completas, gotchas)

Regla: cada hecho vive en UNA fuente; la Bitácora es índice, no duplicado.
