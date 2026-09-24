import { relative } from "node:path";
import { captureAll } from "./capture.js";
import { createDemo } from "./demo.js";
import { ROOT } from "./paths.js";
import { buildPdf } from "./pdf.js";
import { type Stack, up } from "./stack.js";

/**
 * `pnpm --filter manual manual`
 *   Levanta el SellPointy del manual, crea el negocio de demostración, toma
 *   todas las capturas, lo apaga y arma el PDF en `docs/manual/dist/`.
 *   Necesita Colima encendido (Postgres y Redis).
 *
 * `pnpm --filter manual manual:pdf`
 *   Solo el PDF, con las capturas que ya existen: para corregir un texto sin
 *   volver a levantar nada.
 */
const pdfOnly = process.argv.includes("--pdf-only");
let stack: Stack | null = null;

process.on("SIGINT", async () => {
  await stack?.down();
  process.exit(130);
});

async function main(): Promise<void> {
  if (!pdfOnly) {
    stack = await up();
    try {
      await createDemo(stack);
      await captureAll();
    } finally {
      await stack.down();
      stack = null;
    }
  }
  const pdf = await buildPdf();
  console.log(`Listo: ${relative(ROOT, pdf)}`);
}

main().catch(async (error: unknown) => {
  await stack?.down();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
