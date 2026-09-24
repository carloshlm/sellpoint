import { captureAll } from "./capture.js";
import { IMG_DIR } from "./paths.js";

/**
 * `pnpm --filter manual exec tsx src/shoot.ts <filtro>`
 *   Toma de nuevo solo las capturas cuyo id o capítulo contiene `<filtro>`
 *   (por ejemplo `03-setup` o `taxes-`), contra el SellPointy que dejó
 *   encendido `pnpm --filter manual manual --serve`. Para escribir un capítulo
 *   sin esperar la corrida completa; el PDF se arma después con `manual:pdf`.
 */
const filter = process.argv[2];
if (!filter) {
  console.error("Falta el filtro: un id de captura o parte de la ruta del capítulo.");
  process.exit(1);
}

captureAll((screen) => screen.id.includes(filter) || screen.chapter.includes(filter))
  .then(() => console.log(`Listas en ${IMG_DIR}`))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
