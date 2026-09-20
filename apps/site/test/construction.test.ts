import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_LOGIN_URL, APP_REGISTER_URL, appUrl } from "../src/config/links";
import { findHoles } from "../src/legal/load";

// El modo «en construcción» (Carlos, 2026-09-19): lo que sirve PRODUCCIÓN
// mientras lo legal no esté listo. Se construye aparte, con `SITE_MODE`, para
// probar lo que de verdad se publicaría.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "dist-construction");

function htmlFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path, base);
    return entry.name.endsWith(".html") ? [path.slice(base.length + 1)] : [];
  });
}

describe("sitio en construcción", () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    execFileSync("pnpm", ["exec", "astro", "build", "--silent", "--outDir", OUT], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, SITE_MODE: "construction", ASTRO_TELEMETRY_DISABLED: "1" },
    });
  }, 120_000);

  it("publica UNA sola página (y la 404): ni versiones, ni planes, ni lo legal", () => {
    expect(htmlFiles(OUT).sort()).toEqual(["404.html", "index.html"]);
  });

  it("no puede traer huecos legales: es justo lo que se publica mientras existan", () => {
    for (const file of htmlFiles(OUT)) {
      expect(findHoles(readFileSync(join(OUT, file), "utf8")), file).toEqual([]);
    }
  });

  it("deja a la vista las dos puertas de la aplicación", () => {
    // Los clientes actuales teclean sellpointy.com por costumbre: tienen que
    // encontrar la entrada en un segundo, como cuando el apex redirigía.
    const html = readFileSync(join(OUT, "index.html"), "utf8");
    expect(html).toContain(`href="${appUrl(APP_LOGIN_URL, "es-mx")}"`);
    expect(html).toContain(`href="${appUrl(APP_REGISTER_URL, "es-mx")}"`);
    expect([...html.matchAll(/<h1\b/g)].length).toBeGreaterThanOrEqual(1);
  });

  it("habla los tres idiomas y no se deja indexar", () => {
    const html = readFileSync(join(OUT, "index.html"), "utf8");
    for (const lang of ["es-MX", "en-US", "fr-CA"]) expect(html).toContain(`lang="${lang}"`);
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).not.toContain('rel="alternate"');
  });

  it("no anuncia un sitemap de páginas que no existen", () => {
    expect(readFileSync(join(OUT, "robots.txt"), "utf8")).not.toContain("Sitemap:");
    expect(readFileSync(join(OUT, "sitemap.xml"), "utf8")).not.toContain("<loc>");
    expect(existsSync(join(OUT, "favicon.svg"))).toBe(true);
  });
});
