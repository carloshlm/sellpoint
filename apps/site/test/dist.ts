import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** La carpeta que arma `astro build` (la construye `global-setup.ts`). */
export const DIST = fileURLToPath(new URL("../dist", import.meta.url));

/** Todos los archivos de `dist/`, como rutas relativas. */
export function distFiles(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? distFiles(path) : [relative(DIST, path)];
  });
}

export function readDist(file: string): string {
  return readFileSync(join(DIST, file), "utf8");
}

/** Las páginas construidas: `index.html`, `es-mx/index.html`… */
export function distPages(): string[] {
  return distFiles().filter((file) => file.endsWith(".html"));
}

/** El CSS que de verdad recibe una página: el enlazado más el incrustado. */
export function cssOf(page: string): string {
  const html = readDist(page);
  const linked = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) =>
    readDist((match[1] as string).replace(/^\//, "")),
  );
  const inlined = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return [...linked, ...inlined].join("\n");
}

/**
 * El JavaScript que de verdad recibe una página: el incrustado, el enlazado Y
 * todo lo que esos módulos importan (Vite parte el código compartido en trozos
 * aparte, y un presupuesto que no los cuenta se queda corto). Cada archivo, una
 * sola vez aunque lo importen dos.
 */
export function scriptsOf(page: string): string[] {
  const html = readDist(page);
  const seen = new Set<string>();
  const scripts: string[] = [];

  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readDist(file);
    scripts.push(code);
    for (const match of code.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      visit(posix.join(posix.dirname(file), match[1] as string));
    }
  };

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = (match[1] as string).match(/\bsrc="([^"]+)"/)?.[1];
    if (src) visit(src.replace(/^\//, ""));
    else scripts.push(match[2] as string);
  }
  return scripts;
}
