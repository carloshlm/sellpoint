import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./paths.js";
import { SCREENS } from "./screens.js";
import { citedImages, copyProblems, readFrontMatter } from "./upkeep/chapters.js";
import { missingTexts } from "./upkeep/known-texts.js";
import { parseManualIndex } from "./upkeep/manual-index.js";
import { planGap } from "./upkeep/plans.js";
import {
  type Locale,
  MANUAL_README,
  readChapters,
  readCodeIndex,
  readPlans,
  readRouteSource,
  readRoutes,
  readScreenSources,
  readTextIndex,
} from "./upkeep/repo.js";
import { featureGates, matchRoute } from "./upkeep/routes.js";
import { analyzeScreens, type Finding } from "./upkeep/screen-source.js";

/**
 * LA REGLA QUE MANTIENE EL MANUAL AL DÍA (fase 4). Corre en el CI con cada
 * cambio y solo lee archivos: no levanta SellPointy ni toma capturas. Si algo
 * de aquí falla, el manual ya no describe lo que hace el sistema; la skill
 * `sellpoint-manual` dice cómo ponerlo al día.
 */

/**
 * Textos que buscan las capturas y que NO salen de las traducciones ni de los
 * datos de la demo, cada uno con su motivo. Lo que está aquí deja de
 * revisarse contra las traducciones: que la lista sea corta. Si el texto está
 * escrito en un archivo del repo, `source` lo nombra y la prueba revisa que
 * siga ahí, entre comillas.
 */
const TEXT_EXCEPTIONS: Record<string, { why: string; source?: string }> = {
  // Folios: los numera el API al crear cada documento de la demo, en el orden de seed.ts.
  "SAL-000001": { why: "folio de la primera salida de la demo: la merma de agua, confirmada" },
  "SAL-000003": { why: "folio del traspaso que sigue en camino a la Sucursal Norte" },
  "INV-000001": { why: "folio del conteo en curso de la demo" },
  "GAS-000002": { why: "folio del segundo gasto de la demo: el recibo de luz, por pagar" },
  "COM-000001": { why: "folio de la compra a Distribuidora del Valle" },
  "OCO-000001": { why: "folio de la orden de compra a Lácteos San Juan" },
  "RCP-000001": { why: "folio de la recepción parcial de esa orden" },
  // Códigos de barras: seed.ts los calcula (ean13) o la captura los escanea sin darlos de alta.
  "7501055300013": { why: "el código de barras del agua; seed.ts lo calcula con ean13" },
  "7509999000204": {
    why: "un código de la serie ficticia 750999… que no existe: la captura lo escanea para mostrar un producto nuevo",
  },
  // Nombres que pone el API al crear el negocio, en el idioma de la dueña: son
  // datos del negocio, no traducciones de la pantalla.
  Cajero: {
    why: "el rol de fábrica del cajero: el API lo crea con su nombre en español porque la dueña de la demo se registra en español",
    source: "apps/api/src/modules/tenants/role-catalog.ts",
  },
};

/** El idioma de cada captura: el de su `locale`, o español. */
const localeOf = (id: string): Locale => {
  const screen = SCREENS.find((candidate) => candidate.id === id) as
    | { locale?: Locale }
    | undefined;
  return screen?.locale ?? "es";
};

const chapters = readChapters();
const chapterByFile = new Map(chapters.map((chapter) => [chapter.file, chapter]));
const index = parseManualIndex(readFileSync(MANUAL_README, "utf8"));
const analysis = analyzeScreens(readScreenSources());

const where = (finding: Finding) =>
  `${finding.file}:${finding.line}${finding.screen ? ` (captura ${finding.screen})` : ""}`;

describe("el manual al día", () => {
  describe("capítulos", () => {
    it("cada capítulo abre con title, who y, si aplica, una marca de plan del índice", () => {
      const problems = chapters.flatMap(({ file, source }) =>
        readFrontMatter(source).problems.map((problem) => `${file}: ${problem}`),
      );
      expect(problems).toEqual([]);
    });
  });

  describe("índice ↔ archivos", () => {
    it("cada capítulo del índice de docs/manual/README.md está escrito", () => {
      const missing = index
        .filter((entry) => !chapterByFile.has(entry.file))
        .map((entry) => `${entry.file} (README.md:${entry.line}, «${entry.title}») no existe`);
      expect(missing, "El índice promete capítulos que faltan en docs/manual/es/.").toEqual([]);
    });

    it("cada archivo de docs/manual/es está en el índice", () => {
      const listed = new Set(index.map((entry) => entry.file));
      const extra = chapters
        .filter((chapter) => !listed.has(chapter.file))
        .map(
          (chapter) => `${chapter.file} no está en la tabla del índice de docs/manual/README.md`,
        );
      expect(extra).toEqual([]);
    });

    it("el título, quién y plan de cada capítulo son los del índice", () => {
      const problems = index.flatMap((entry) => {
        const chapter = chapterByFile.get(entry.file);
        const meta = chapter && readFrontMatter(chapter.source).meta;
        if (!meta) return [];
        const differences: string[] = [];
        if (meta.title !== entry.title) {
          differences.push(`title «${meta.title}», el índice dice «${entry.title}»`);
        }
        if (meta.who !== entry.who) {
          differences.push(`who «${meta.who}», el índice dice «${entry.who}»`);
        }
        if (meta.plan !== entry.plan) {
          differences.push(`plan «${meta.plan ?? "—"}», el índice dice «${entry.plan ?? "—"}»`);
        }
        return differences.map((difference) => `${entry.file}: ${difference}`);
      });
      expect(problems).toEqual([]);
    });
  });

  describe("registro de pantallas ↔ capítulos", () => {
    it("cada captura tiene un id propio", () => {
      const seen = new Set<string>();
      const repeated = SCREENS.filter((screen) => seen.has(screen.id) || !seen.add(screen.id)).map(
        (screen) => `${screen.id} está dos veces en el registro`,
      );
      expect(repeated).toEqual([]);
    });

    it("un capítulo solo cita capturas del registro, y de las suyas", () => {
      const byId = new Map(SCREENS.map((screen) => [screen.id, screen]));
      const problems = chapters.flatMap(({ file, source }) =>
        citedImages(source).flatMap((image) => {
          const at = `${file}:${image.line}`;
          if (image.screen === null) {
            return [`${at}: la imagen «${image.href}» no es una captura; se citan con screen:<id>`];
          }
          const screen = byId.get(image.screen);
          if (!screen) return [`${at}: cita screen:${image.screen}, que no está en el registro`];
          if (screen.chapter !== file) {
            return [
              `${at}: cita screen:${image.screen}, que el registro pone en ${screen.chapter}`,
            ];
          }
          return [];
        }),
      );
      expect(problems).toEqual([]);
    });

    it("cada captura del registro la cita el capítulo que declara", () => {
      const orphans = SCREENS.filter((screen) => {
        const chapter = chapterByFile.get(screen.chapter);
        return !chapter || !citedImages(chapter.source).some((image) => image.screen === screen.id);
      }).map((screen) =>
        chapterByFile.has(screen.chapter)
          ? `${screen.id}: ${screen.chapter} no la cita`
          : `${screen.id}: su capítulo ${screen.chapter} no existe`,
      );
      expect(orphans).toEqual([]);
    });
  });

  describe("rutas", () => {
    const routes = readRoutes();
    const fullPaths = routes.map((route) => route.fullPath);

    it("cada captura abre una ruta que existe en el web", () => {
      const missing = SCREENS.filter((screen) => matchRoute(screen.path, fullPaths) === null).map(
        (screen) => `${screen.id}: ${screen.path} no está en apps/web/src/routeTree.gen.ts`,
      );
      expect(missing).toEqual([]);
    });

    it("una pantalla con candado de plan solo sale en un capítulo marcado con ese plan o uno mayor", () => {
      const plans = readPlans();
      const problems = SCREENS.flatMap((screen) => {
        const route = routes.find((r) => r.fullPath === matchRoute(screen.path, fullPaths));
        const source = route?.module ? readRouteSource(route.module) : null;
        const chapter = chapterByFile.get(screen.chapter);
        if (!source || !chapter) return [];
        const mark = readFrontMatter(chapter.source).meta?.plan ?? null;
        const gap = planGap(mark, featureGates(source), plans);
        if (!gap) return [];
        return [
          `${screen.id} (${screen.chapter}): ${route?.fullPath} pide ${gap.minPlan ?? "un plan que la lista no conoce"} (<FeatureGate feature="${gap.feature}">) y el capítulo ${mark ? `dice «${mark}»` : "no tiene marca de plan"}`,
        ];
      });
      expect(problems).toEqual([]);
    });
  });

  describe("lo que buscan las capturas existe", () => {
    it("el análisis ve todas las capturas del registro", () => {
      expect(analysis.screens.map((screen) => screen.id).sort()).toEqual(
        SCREENS.map((screen) => screen.id).sort(),
      );
    });

    it("cada texto está en las traducciones o en los datos de la demo", () => {
      const indexes = { es: readTextIndex("es"), en: readTextIndex("en") };
      const problems = missingTexts(
        analysis.findings,
        analysis.screens,
        localeOf,
        indexes,
        TEXT_EXCEPTIONS,
      ).map(
        (finding) =>
          `${where(finding)}: «${finding.value}»${finding.exact ? " (exacto)" : ""} no está`,
      );
      expect(
        problems,
        "La captura busca un texto que el web ya no muestra: corrige la captura (y el capítulo), o, si el texto sale de otro lado, agrégalo a TEXT_EXCEPTIONS con su motivo.",
      ).toEqual([]);
    });

    it("cada data-testid e id de un selector está en el código del web", () => {
      const code = readCodeIndex();
      const problems = analysis.findings
        .filter((finding) => finding.kind === "code" && !code.has(finding.value))
        .map((finding) => `${where(finding)}: «${finding.value}» no está en apps/web/src`);
      expect(problems).toEqual([]);
    });

    it("cada excepción la usa una captura, todavía hace falta y sigue en su archivo", () => {
      const texts = readTextIndex();
      const used = new Set(analysis.findings.map((finding) => finding.value));
      const stale = Object.entries(TEXT_EXCEPTIONS).flatMap(([text, { source }]) => {
        if (!used.has(text)) return [`«${text}»: ninguna captura lo busca; bórralo de la lista`];
        if (texts.has(text, true)) return [`«${text}»: ya está en las traducciones o la demo`];
        const path = source && join(ROOT, source);
        if (path && !(existsSync(path) && readFileSync(path, "utf8").includes(`"${text}"`))) {
          return [`«${text}»: ya no está en ${source}; la captura busca algo que cambió`];
        }
        return [];
      });
      expect(stale).toEqual([]);
    });
  });

  describe("copy", () => {
    for (const rule of ["asentar", "voseo"] as const) {
      it(`sin ${rule === "asentar" ? "«asentar» en ninguna forma" : "voseo"}`, () => {
        const problems = chapters.flatMap(({ file, source }) =>
          copyProblems(source)
            .filter((problem) => problem.rule === rule)
            .map((problem) => `${file}:${problem.line}: «${problem.word}» — ${problem.hint}`),
        );
        expect(problems).toEqual([]);
      });
    }
  });
});
