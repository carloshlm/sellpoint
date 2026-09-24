import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Marked } from "marked";
import { chromium } from "playwright";
import { appVersion, DIST_DIR, IMG_DIR, MANUAL_DIR, ROOT } from "./paths.js";

/**
 * Arma el PDF: portada, índice y los capítulos que ya existen, en el orden de
 * sus archivos (`01-start/02-sign-in.md` antes que `02-sell/05-…`). Un
 * capítulo que todavía no se escribió simplemente no sale: el PDF crece con
 * el manual.
 *
 * Cada capítulo abre con un bloque así, y lo demás es Markdown:
 *
 *   ---
 *   title: Entrar, salir y tu contraseña
 *   who: todos            (todos · cajero · dueño)
 *   plan: Desde Pro       (opcional; sin él, «Todos los planes»)
 *   ---
 */
const CHAPTERS_DIR = join(MANUAL_DIR, "es");

const PARTS: Record<string, string> = {
  "01-start": "Parte 1 — Primeros pasos",
  "02-sell": "Parte 2 — Vender",
  "03-setup": "Parte 3 — Preparar tu negocio",
  "04-inventory": "Parte 4 — Inventario",
  "05-purchasing": "Parte 5 — Compras y gastos",
  "06-insights": "Parte 6 — Cómo va tu negocio",
  "07-team": "Parte 7 — Tu equipo y tu cuenta",
  "90-appendix": "Apéndices",
};

const WHO: Record<string, string> = { todos: "Todos", cajero: "Cajero", dueño: "Dueño" };

interface Chapter {
  id: string;
  number: string;
  part: string | null;
  title: string;
  who: string;
  plan: string | null;
  html: string;
}

function chapterFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return chapterFiles(path);
      return name.endsWith(".md") ? [path] : [];
    });
}

/** El ancho de un PNG, leído de su cabecera (bytes 16 a 19). */
/** Ancho y alto de un PNG, leídos de su encabezado (IHDR). */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** El alto máximo de una captura en la página (`max-height` de manual.css), en px CSS. */
const MAX_IMAGE_HEIGHT_PX = (125 / 25.4) * 96;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `![Texto](screen:id)` → la captura, con el texto como pie. Una cita a una captura que no existe detiene todo. */
const markdown = new Marked({
  renderer: {
    image({ href, text }) {
      if (!href.startsWith("screen:")) {
        throw new Error(`Imagen «${href}»: en el manual solo se citan capturas, con screen:<id>.`);
      }
      const id = href.slice("screen:".length);
      const file = join(IMG_DIR, `${id}.png`);
      if (!existsSync(file)) {
        throw new Error(
          `Un capítulo cita la captura «${id}», que no está en el registro de pantallas.`,
        );
      }
      // Las capturas se toman al doble de densidad: a la mitad de sus píxeles
      // se ven del tamaño real de la pantalla, y una recortada no se estira.
      // Una captura alta se ANGOSTA en la misma proporción: si solo se
      // topara el alto con `max-height`, el ancho fijo la deformaría.
      const png = pngSize(file);
      const width = Math.round(
        Math.min(png.width / 2, (MAX_IMAGE_HEIGHT_PX * png.width) / png.height),
      );
      return `<figure><img src="img/${id}.png" style="width:${width}px" alt="${escapeHtml(text)}"><figcaption>${escapeHtml(text)}</figcaption></figure>`;
    },
  },
});

function parseChapter(path: string): Chapter {
  const source = readFileSync(path, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const where = relative(CHAPTERS_DIR, path);
  if (!match) throw new Error(`${where}: falta el bloque --- title/who --- al inicio.`);
  const meta = Object.fromEntries(
    (match[1] as string)
      .split("\n")
      .map((line) => line.match(/^(\w+):\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1] as string, (m[2] as string).trim()]),
  ) as Record<string, string>;
  if (!meta.title || !meta.who || !WHO[meta.who]) {
    throw new Error(`${where}: el bloque inicial necesita title y who (todos, cajero o dueño).`);
  }
  const folder = basename(dirname(path));
  const html = (markdown.parse(match[2] as string) as string)
    // Una figura no va dentro de un párrafo.
    .replace(/<p>(<figure>[\s\S]*?<\/figure>)<\/p>/g, "$1");
  return {
    id: where.replace(/\.md$/, "").replace(/[^\w]+/g, "-"),
    // `30-dashboard.md` → «30»; los apéndices (`a-plans.md`) → «A».
    number: (basename(path).match(/^(\w+?)-/)?.[1] ?? "").replace(/^0+(?=\d)/, "").toUpperCase(),
    part: PARTS[folder] ?? null,
    title: meta.title,
    who: WHO[meta.who] as string,
    plan: meta.plan ?? null,
    html,
  };
}

function dataUri(path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

/**
 * Las fuentes van INCRUSTADAS: el HTML se abre como archivo y Chromium no
 * deja que una página `file://` cargue fuentes de otro archivo.
 */
function styles(version: string): string {
  const fonts = join(ROOT, "apps/manual/node_modules/@fontsource-variable");
  const display = dataUri(
    join(fonts, "bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2"),
    "font/woff2",
  );
  const body = dataUri(
    join(fonts, "instrument-sans/files/instrument-sans-latin-wght-normal.woff2"),
    "font/woff2",
  );
  return readFileSync(join(ROOT, "apps/manual/src/manual.css"), "utf8")
    .replace("__FONT_DISPLAY__", display)
    .replace("__FONT_BODY__", body)
    .replace("__VERSION__", version);
}

function monthYear(): string {
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(new Date());
}

function page(chapters: Chapter[], version: string): string {
  const logo = readFileSync(join(ROOT, "apps/site/src/assets/brand/logo-inverted.svg"), "utf8");
  const index: string[] = [];
  let lastPart: string | null = null;
  for (const c of chapters) {
    if (c.part && c.part !== lastPart) {
      index.push(`<li class="toc-part">${escapeHtml(c.part)}</li>`);
      lastPart = c.part;
    }
    index.push(
      `<li><a href="#${c.id}"><span class="toc-n">${escapeHtml(c.number)}</span>${escapeHtml(c.title)}</a></li>`,
    );
  }
  lastPart = null;
  const body = chapters.map((c) => {
    const partLabel =
      c.part && c.part !== lastPart ? `<p class="part-label">${escapeHtml(c.part)}</p>` : "";
    lastPart = c.part ?? lastPart;
    const plan = c.plan ? `<span class="badge plan">${escapeHtml(c.plan)}</span>` : "";
    return `<section class="chapter" id="${c.id}">
      ${partLabel}
      <h1><span class="n">${escapeHtml(c.number)}</span>${escapeHtml(c.title)}</h1>
      <p class="meta"><span class="badge">Quién lo usa: ${escapeHtml(c.who)}</span>${plan}</p>
      ${c.html}
    </section>`;
  });
  return `<!doctype html>
<html lang="es-MX">
<head><meta charset="utf-8"><title>SellPointy — Manual de usuario v${version}</title><style>${styles(version)}</style></head>
<body>
  <section class="cover">
    <div class="cover-logo">${logo}</div>
    <p class="cover-kicker">SellPointy</p>
    <h1 class="cover-title">Manual de usuario</h1>
    <p class="cover-version">Versión ${escapeHtml(version)} · ${escapeHtml(monthYear())}</p>
    <p class="cover-note">Las pantallas de este manual son de un negocio de demostración, con datos inventados.</p>
  </section>
  <section class="toc">
    <h1>Contenido</h1>
    <ol>${index.join("")}</ol>
  </section>
  ${body.join("\n")}
</body>
</html>`;
}

export async function buildPdf(): Promise<string> {
  const chapters = chapterFiles(CHAPTERS_DIR).map(parseChapter);
  if (chapters.length === 0) throw new Error("No hay capítulos en docs/manual/es/.");
  const version = appVersion();
  mkdirSync(DIST_DIR, { recursive: true });
  const htmlPath = join(DIST_DIR, "manual.html");
  writeFileSync(htmlPath, page(chapters, version));

  const pdfPath = join(DIST_DIR, `SellPointy-Manual-de-usuario-v${version}.pdf`);
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await tab.evaluate(async () => {
      await document.fonts.ready;
    });
    await tab.pdf({
      path: pdfPath,
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
  console.log(`PDF armado con ${chapters.length} capítulo(s).`);
  return pdfPath;
}
