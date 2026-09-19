// F11-SITE-LEGAL-01 — EL CANDADO. Recorre el sitio ya construido y falla si
// queda un solo hueco `[[…]]` de los que solo Carlos puede llenar (la razón
// social real, el domicilio, la ciudad de jurisdicción, los correos del
// dominio). Un hueco sin llenar no puede llegar a producción por descuido.
//
// Bloquea PUBLICAR, no construir: no es parte de `pnpm test` —pondría en rojo
// todos los despliegues mientras los huecos existan—, sino un paso del pipeline
// del sitio, justo antes de desplegar.
//
//   pnpm --filter site build && pnpm --filter site check:publishable
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

const holes = htmlFiles(DIST).flatMap((file) =>
  (readFileSync(file, "utf8").match(/\[\[[^\]]*\]\]/g) ?? []).map(
    (hole) => `  ${relative(DIST, file)} → ${hole}`,
  ),
);

if (holes.length > 0) {
  console.error(`NO PUBLICABLE: quedan ${holes.length} huecos por llenar en SITIO-WEB-LEGAL.md:\n`);
  console.error([...new Set(holes)].join("\n"));
  process.exit(1);
}
console.log("Publicable: ninguna página trae huecos [[…]].");
