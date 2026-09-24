import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { MANUAL_DIR, ROOT } from "../paths.js";
import { createCodeIndex, createTextIndex, demoLiterals, flattenMessages } from "./known-texts.js";
import { type PlanTable, readPlanTable } from "./plans.js";
import { parseRouteTree, type WebRoute } from "./routes.js";
import type { SourceText } from "./screen-source.js";

/**
 * Dónde vive cada pieza que revisa la regla del manual. Solo lee archivos:
 * nada se levanta ni se compila.
 */
export const CHAPTERS_DIR = join(MANUAL_DIR, "es");
export const MANUAL_README = join(MANUAL_DIR, "README.md");
export const MANUAL_SRC = join(ROOT, "apps/manual/src");
export const WEB_SRC = join(ROOT, "apps/web/src");
export const ROUTE_TREE = join(WEB_SRC, "routeTree.gen.ts");
/** Los idiomas de la app. El manual va en español; una captura puede pedir `locale: "en"`. */
export type Locale = "es" | "en";
/** Las traducciones de un idioma: las del web y las del API (sus mensajes y sus PDF también salen en pantalla). */
export const messageDirs = (locale: Locale) => [
  join(WEB_SRC, "i18n", locale),
  join(ROOT, "apps/api/src/i18n", locale),
];
/** Los datos de la tienda de ejemplo. */
export const DEMO_FILES = ["seed.ts", "demo.ts"].map((name) => join(MANUAL_SRC, name));

const read = (path: string) => readFileSync(path, "utf8");
const posix = (path: string) => path.split(sep).join("/");

/** Los archivos bajo `dir`, en orden y con su ruta relativa a `dir` (con `/`). */
export function filesUnder(dir: string, keep: (relative: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map(posix).filter(keep).sort();
}

/** Los capítulos escritos, con su ruta relativa a `docs/manual/es/`. */
export function readChapters(): { file: string; source: string }[] {
  return filesUnder(CHAPTERS_DIR, (file) => file.endsWith(".md")).map((file) => ({
    file,
    source: read(join(CHAPTERS_DIR, file)),
  }));
}

/** El registro de pantallas y la sesión de las capturas: lo que busca cada una en la pantalla. */
export function readScreenSources(): SourceText[] {
  const files = [
    "capture.ts",
    "screens.ts",
    ...filesUnder(join(MANUAL_SRC, "screens"), (file) => /^[^/]+\.ts$/.test(file)).map(
      (file) => `screens/${file}`,
    ),
  ];
  return files
    .filter((file) => !file.endsWith(".test.ts") && existsSync(join(MANUAL_SRC, file)))
    .map((path) => ({ path, source: read(join(MANUAL_SRC, path)) }));
}

/** Cada texto que SellPointy puede poner en pantalla en ese idioma, con su archivo. */
export function readMessages(
  locale: Locale = "es",
): { file: string; key: string; value: string }[] {
  return messageDirs(locale).flatMap((dir) =>
    filesUnder(dir, (file) => file.endsWith(".json")).flatMap((file) =>
      flattenMessages(JSON.parse(read(join(dir, file)))).map((message) => ({
        file: posix(join(dir, file)).replace(`${posix(ROOT)}/`, ""),
        ...message,
      })),
    ),
  );
}

export const readDemoTexts = () => DEMO_FILES.flatMap((file) => demoLiterals(read(file)));

export const readTextIndex = (locale: Locale = "es") =>
  createTextIndex({
    app: readMessages(locale).map((message) => message.value),
    demo: readDemoTexts(),
  });

/** El código del web, sin sus pruebas: ahí tiene que existir cada id que busca una captura. */
export const readWebCode = () =>
  filesUnder(
    WEB_SRC,
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith("test/"),
  ).map((file) => read(join(WEB_SRC, file)));

export const readCodeIndex = () => createCodeIndex(readWebCode());

export const readRoutes = (): WebRoute[] => parseRouteTree(read(ROUTE_TREE));

/** El archivo de una ruta (`routes/expenses.index`), o `null` si no está. */
export function readRouteSource(module: string): string | null {
  for (const extension of [".tsx", ".ts"]) {
    const path = join(WEB_SRC, `${module}${extension}`);
    if (existsSync(path)) return read(path);
  }
  return null;
}

export const readPlans = (): PlanTable =>
  readPlanTable(
    read(join(ROOT, "packages/shared/src/plan-showcase.ts")),
    read(join(ROOT, "packages/shared/src/plan-modules.ts")),
  );
