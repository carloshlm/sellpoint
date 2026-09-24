import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** La raíz del repo: `apps/manual/src` → tres niveles arriba. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const API_DIR = join(ROOT, "apps/api");
export const WEB_DIR = join(ROOT, "apps/web");
export const MANUAL_DIR = join(ROOT, "docs/manual");
/** Lo que se genera y NO se versiona (`dist/` está en el .gitignore raíz). */
export const DIST_DIR = join(MANUAL_DIR, "dist");
export const IMG_DIR = join(DIST_DIR, "img");
/** El web compilado para las capturas: aparte del `dist/` del propio web. */
export const CACHE_DIR = join(ROOT, "apps/manual/.cache");

/**
 * La versión que describe el manual: la del `package.json` raíz, que es la
 * que corta `pnpm release` y la que dice el CHANGELOG.
 */
export function appVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}
