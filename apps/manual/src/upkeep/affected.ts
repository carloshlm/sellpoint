import { basename, dirname, join } from "node:path/posix";
import ts from "typescript";
import { flattenMessages } from "./known-texts.js";
import { matchRoute, parentRoutes, routesReachedBy, type WebRoute } from "./routes.js";
import type { SourceText } from "./screen-source.js";

/**
 * QUÉ PARTE DEL MANUAL TOCA UN CAMBIO: las funciones puras detrás de
 * `pnpm --filter manual affected`. Ninguna llama a git ni lee archivos; el
 * script (`src/affected.ts`) les pasa lo que cambió.
 */

export interface TextChange {
  /** El JSON de traducciones, relativo a la raíz del repo. */
  file: string;
  key: string;
  before: string;
  /** `null` si se borró. */
  after: string | null;
}

/** Los textos que cambiaron o se borraron entre dos versiones de un JSON de traducciones. */
export function changedMessages(file: string, before: unknown, after: unknown): TextChange[] {
  const now = new Map(flattenMessages(after).map((message) => [message.key, message.value]));
  return flattenMessages(before).flatMap(({ key, value }) => {
    const next = now.get(key);
    return next === value ? [] : [{ file, key, before: value, after: next ?? null }];
  });
}

export interface Occurrence {
  file: string;
  line: number;
}

const PLACEHOLDER = /\{\{[^{}]*\}\}|\{[^{}]*\}/g;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length;

/**
 * Dónde aparece un texto VIEJO. Uno corto (una o dos palabras) sale en todos
 * lados, así que en un capítulo solo cuenta marcado como de la pantalla
 * (**Guardar**, «Guardar») y en el código de una captura, como cadena entera
 * ("Guardar"). Uno largo cuenta en cualquier parte, aunque el Markdown lo
 * parta en dos renglones o una regex lo cite. Una interpolación (`{{x}}`)
 * acepta lo que sea en su lugar.
 */
export function findOldText(
  text: string,
  files: readonly SourceText[],
  kind: "chapter" | "code",
): Occurrence[] {
  const statics = text.split(PLACEHOLDER);
  if (statics.join("").replace(/[^\p{L}]/gu, "").length < 3) return [];
  const words = statics.join(" ").trim().split(/\s+/).length;
  const short = words <= 2 && statics.length === 1;
  const body = statics
    .map((part) => escapeRegex(part).replace(/\s+/g, "\\s+"))
    .join("[\\s\\S]{1,40}?");
  const pattern = !short
    ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`
    : kind === "chapter"
      ? `(?<=\\*|«|"|“)${body}(?=\\*|»|"|”)`
      : `(?<=["'\`])${body}(?=["'\`])`;
  const regex = new RegExp(pattern, short ? "gu" : "giu");
  return files.flatMap((file) => {
    const lines = new Set(
      [...file.source.matchAll(regex)].map((m) => lineAt(file.source, m.index)),
    );
    return [...lines].map((line) => ({ file: file.path, line }));
  });
}

/** Un import del web (`@/…` o relativo) → el archivo, relativo a `apps/web/src`, o `null`. */
function resolveImport(from: string, specifier: string, known: Set<string>): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/** El grafo de imports del web al revés: de cada archivo, quién lo importa. */
export function importersOf(files: readonly SourceText[]): Map<string, string[]> {
  const known = new Set(files.map((file) => file.path));
  const importers = new Map<string, string[]>();
  for (const file of files) {
    for (const reference of ts.preProcessFile(file.source, true, true).importedFiles) {
      const target = resolveImport(file.path, reference.fileName, known);
      if (target) importers.set(target, [...(importers.get(target) ?? []), file.path]);
    }
  }
  return importers;
}

/** La raíz del web: lo que ella dibuja sale en todas las pantallas. */
const ROOT_ROUTE = /^routes\/__root\.tsx?$/;

/**
 * Las rutas que dibuja un archivo del web: la suya si es una ruta, y las de
 * las rutas que lo importan, directa o indirectamente. Lo que llega a la raíz
 * (`__root`) llega a todas.
 */
export function routesReached(
  file: string,
  importers: Map<string, string[]>,
  routes: readonly WebRoute[],
): string[] {
  const byFile = new Map<string, string>();
  for (const route of routes) {
    if (!route.module) continue;
    for (const extension of [".tsx", ".ts"])
      byFile.set(`${route.module}${extension}`, route.fullPath);
  }
  const reached = new Set<string>();
  const seen = new Set([file]);
  const queue = [file];
  let root = false;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (ROOT_ROUTE.test(current)) root = true;
    const route = byFile.get(current);
    if (route) reached.add(route);
    for (const importer of importers.get(current) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return routes.map((route) => route.fullPath).filter((path) => root || reached.has(path));
}

/** Lo que `affected` necesita saber de cada captura del registro. */
export interface ScreenInfo {
  id: string;
  /** Relativo a `docs/manual/es/`. */
  chapter: string;
  path: string;
  /** El archivo del registro, relativo a `apps/manual/src` (`screens/team.ts`). */
  file: string | null;
  /** Las regex de sus `waitForURL`: las pantallas a las que llega desde la que abre. */
  reaches: RegExp[];
  /** Si es la captura de un PDF del API y no de una pantalla. */
  pdf: boolean;
}

export type Via = "path" | "url" | "parent";

/**
 * Las capturas que retratan una ruta: las que la abren (`path`) y las que
 * llegan a ella desde otra (`waitForURL`). Si ninguna la retrata y es un
 * detalle (`$param`), las que abren una ruta de más arriba, por si llegan a
 * ella con un clic.
 */
export function screensForRoute(
  route: string,
  screens: readonly ScreenInfo[],
  fullPaths: readonly string[],
): { screen: ScreenInfo; via: Via }[] {
  const pages = screens.filter((screen) => !screen.pdf);
  const found: { screen: ScreenInfo; via: Via }[] = [];
  for (const screen of pages) {
    if (matchRoute(screen.path, fullPaths) === route) found.push({ screen, via: "path" });
    else if (routesReachedBy(screen.reaches, [route]).length > 0)
      found.push({ screen, via: "url" });
  }
  if (found.length > 0 || !route.includes("$")) return found;
  const parents = new Set(parentRoutes(route, fullPaths));
  return pages
    .filter((screen) => parents.has(matchRoute(screen.path, fullPaths) ?? ""))
    .map((screen) => ({ screen, via: "parent" as const }));
}

export interface ReportInput {
  /** La base del rango, como la escribió quien corre el script. */
  base: string;
  /** Lo que cambió, relativo a la raíz del repo. */
  changedFiles: readonly string[];
  /** El código del web sin sus pruebas, relativo a `apps/web/src`. */
  web: readonly SourceText[];
  routes: readonly WebRoute[];
  screens: readonly ScreenInfo[];
  textChanges: readonly TextChange[];
  /** Los capítulos, con su ruta desde la raíz (`docs/manual/es/…`). */
  chapters: readonly SourceText[];
  /** El registro de capturas, con su ruta desde la raíz (`apps/manual/src/screens/…`). */
  screenSources: readonly SourceText[];
}

const WEB_PREFIX = "apps/web/src/";
const MANUAL_SRC = "apps/manual/src/";
const CHAPTERS = "docs/manual/es/";
/** Un archivo que cambia las pantallas de más capítulos que esto es una pieza compartida. */
const SHARED_CHAPTERS = 6;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const shootFilter = (chapter: string) => basename(chapter).replace(/\.md$/, "");

/** El reporte de `affected`, corto y en el orden en que se trabaja. */
export function buildReport(input: ReportInput): string {
  const fullPaths = input.routes.map((route) => route.fullPath);
  const importers = importersOf(input.web);
  const changed = [...new Set(input.changedFiles)].sort();

  // ── Pantallas que cambiaron → sus capturas → sus capítulos ─────────────
  // capítulo → pantalla → { capturas, archivos que la cambiaron }
  const byChapter = new Map<string, Map<string, { ids: Set<string>; files: Set<string> }>>();
  const shared: string[] = [];
  for (const file of changed) {
    if (!file.startsWith(WEB_PREFIX) || !/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) {
      continue;
    }
    const found = routesReached(file.slice(WEB_PREFIX.length), importers, input.routes).flatMap(
      (route) => screensForRoute(route, input.screens, fullPaths).map((hit) => ({ route, ...hit })),
    );
    const chapters = new Set(found.map((hit) => hit.screen.chapter));
    if (chapters.size > SHARED_CHAPTERS) {
      shared.push(
        `  ${file}: toca ${chapters.size} capítulos. Si cambió cómo se ve, retoma todas las capturas.`,
      );
      continue;
    }
    for (const { route, screen, via } of found) {
      const pages = byChapter.get(screen.chapter) ?? new Map();
      const page = via === "parent" ? `${route} (si llegan desde más arriba)` : route;
      const entry = pages.get(page) ?? { ids: new Set<string>(), files: new Set<string>() };
      entry.ids.add(screen.id);
      entry.files.add(file.slice(WEB_PREFIX.length));
      pages.set(page, entry);
      byChapter.set(screen.chapter, pages);
    }
  }

  // ── Textos viejos que el manual todavía cita ───────────────────────────
  const texts: string[] = [];
  let unused = 0;
  for (const change of input.textChanges) {
    const occurrences = [
      ...findOldText(change.before, input.chapters, "chapter"),
      ...findOldText(change.before, input.screenSources, "code"),
    ];
    if (occurrences.length === 0) {
      unused += 1;
      continue;
    }
    const now = change.after === null ? "se borró" : `→ «${change.after}»`;
    texts.push(`  «${change.before}» ${now} (${change.file} · ${change.key})`);
    for (const { file, line } of occurrences) texts.push(`    ${file}:${line}`);
  }
  if (unused > 0 && texts.length > 0) {
    texts.push(
      `  ${unused} ${plural(unused, "texto más cambió y no aparece", "textos más cambiaron y no aparecen")} en el manual.`,
    );
  }

  // ── La demo, la manera de capturar, los papeles del API ────────────────
  const retake: string[] = [];
  const demo = changed.filter((file) => /^apps\/manual\/src\/(seed|demo)\.ts$/.test(file));
  if (demo.length > 0) {
    retake.push(`La tienda de ejemplo cambió (${demo.join(", ")}): retoma todas las capturas.`);
  }
  const machinery = changed.filter((file) =>
    /^apps\/manual\/src\/(capture|stack)\.ts$|^apps\/manual\/src\/screens\/kit\.ts$/.test(file),
  );
  if (machinery.length > 0) {
    retake.push(
      `Cambió cómo se toman las capturas (${machinery.join(", ")}): retoma todas las capturas.`,
    );
  }
  for (const file of changed) {
    const registry = file.match(/^apps\/manual\/src\/(screens\/(?!kit\.ts$)[^/]+\.ts)$/)?.[1];
    if (!registry) continue;
    const ids = input.screens.filter((screen) => screen.file === registry).map((s) => s.id);
    if (ids.length > 0) retake.push(`Cambiaron capturas de ${file}: retoma ${ids.join(", ")}.`);
  }
  const papers = changed.filter(
    (file) => /^apps\/api\/src\/.*(pdf|ticket)/i.test(file) && !/\.spec\.ts$/.test(file),
  );
  const pdfScreens = input.screens.filter((screen) => screen.pdf).map((screen) => screen.id);
  if (papers.length > 0 && pdfScreens.length > 0) {
    retake.push(
      `Cambió un papel del API (${papers.join(", ")}): retoma las capturas de PDF: ${pdfScreens.join(", ")}.`,
    );
  }

  const sections: string[] = [];
  if (byChapter.size > 0) {
    const lines = ["Capítulos con pantallas que cambiaron (archivos de apps/web/src)"];
    for (const chapter of [...byChapter.keys()].sort()) {
      lines.push(`  ${CHAPTERS}${chapter}  (retoma: shoot.ts ${shootFilter(chapter)})`);
      for (const [page, { ids, files }] of byChapter.get(chapter) ?? []) {
        lines.push(`    ${page}: ${[...ids].join(", ")}`);
        lines.push(`      por ${[...files].join(", ")}`);
      }
    }
    sections.push(lines.join("\n"));
  }
  if (shared.length > 0) {
    sections.push(["Piezas compartidas (cambian muchas pantallas a la vez)", ...shared].join("\n"));
  }
  if (texts.length > 0) {
    sections.push(
      ["Textos que cambiaron o se borraron y el manual todavía cita", ...texts].join("\n"),
    );
  }
  if (retake.length > 0) sections.push(retake.join("\n"));

  if (sections.length === 0) {
    return `Nada del manual depende de lo que cambió desde ${input.base}.\n`;
  }
  const touched = changed.filter((file) => file.startsWith(CHAPTERS));
  if (touched.length > 0) sections.push(`Ya tocaste: ${touched.join(", ")}`);
  sections.push(
    [
      "Cómo seguir: corrige el texto de cada capítulo y, si cambió un texto o un selector, su",
      `captura en ${MANUAL_SRC}screens/. Retoma con \`pnpm --filter manual manual --serve\` y, en`,
      "otra terminal, `pnpm --filter manual exec tsx src/shoot.ts <id o capítulo>` (todas:",
      "`pnpm manual`). Al final, `pnpm --filter manual test`, y el capítulo va en el MISMO commit.",
    ].join("\n"),
  );
  return `Manual: qué revisar por lo que cambió desde ${input.base} (y lo que no has commiteado)\n\n${sections.join("\n\n")}\n`;
}
