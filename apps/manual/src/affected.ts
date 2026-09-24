import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.js";
import { SCREENS } from "./screens.js";
import {
  buildReport,
  changedMessages,
  type ScreenInfo,
  type TextChange,
} from "./upkeep/affected.js";
import { CHAPTERS_DIR, filesUnder, readRoutes, readScreenSources, WEB_SRC } from "./upkeep/repo.js";
import { analyzeScreens } from "./upkeep/screen-source.js";

/**
 * `pnpm --filter manual affected [base]`
 *   Qué partes del manual hay que revisar por lo que cambió desde `base` (por
 *   omisión `origin/main`), más lo que no se ha commiteado:
 *   - las pantallas del web que cambiaron → las capturas que las retratan →
 *     sus capítulos;
 *   - los textos en español que cambiaron o se borraron → dónde los cita
 *     todavía el manual (capítulos y capturas, archivo:línea);
 *   - la tienda de ejemplo, la manera de capturar o un papel del API →
 *     qué capturas retomar.
 *   Solo lee: no toca nada ni levanta SellPointy.
 */
const base = process.argv[2] ?? "origin/main";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const read = (path: string) => readFileSync(path, "utf8");

let since: string;
try {
  since = git("merge-base", base, "HEAD").trim();
} catch {
  console.error(
    `No encontré «${base}» en git. Pásale otra base, por ejemplo: pnpm --filter manual affected HEAD~3`,
  );
  process.exit(1);
}

// Contra el árbol de trabajo: lo commiteado desde la base, lo que está en
// stage, lo que no, y los archivos nuevos que git todavía no sigue.
const changedFiles = [
  ...new Set([
    ...lines(git("diff", "--name-only", "--no-renames", since)),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ]),
];

const MESSAGES = /^apps\/(web|api)\/src\/i18n\/es\/[^/]+\.json$/;
const textChanges: TextChange[] = changedFiles
  .filter((file) => MESSAGES.test(file))
  .flatMap((file) => {
    let before: unknown = {};
    try {
      before = JSON.parse(git("show", `${since}:${file}`));
    } catch {
      // El archivo es nuevo: nada de antes pudo cambiar.
    }
    const path = join(ROOT, file);
    const after: unknown = existsSync(path) ? JSON.parse(read(path)) : {};
    return changedMessages(file, before, after);
  });

const sources = readScreenSources();
const analysis = analyzeScreens(sources);
const screens: ScreenInfo[] = SCREENS.map((screen) => {
  const facts = analysis.screens.find((candidate) => candidate.id === screen.id);
  return {
    id: screen.id,
    chapter: screen.chapter,
    path: screen.path,
    file: facts?.file ?? null,
    reaches: (facts?.findings ?? [])
      .filter((finding) => finding.kind === "url")
      .map((finding) => new RegExp(finding.value, finding.flags)),
    pdf: (screen as { pdf?: unknown }).pdf !== undefined,
  };
});

process.stdout.write(
  buildReport({
    base,
    changedFiles,
    web: filesUnder(WEB_SRC, (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)).map(
      (path) => ({ path, source: read(join(WEB_SRC, path)) }),
    ),
    routes: readRoutes(),
    screens,
    textChanges,
    chapters: filesUnder(CHAPTERS_DIR, (file) => file.endsWith(".md")).map((file) => ({
      path: `docs/manual/es/${file}`,
      source: read(join(CHAPTERS_DIR, file)),
    })),
    screenSources: sources.map((source) => ({
      path: `apps/manual/src/${source.path}`,
      source: source.source,
    })),
  }),
);
