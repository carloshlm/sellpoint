import { relative } from "node:path";
import { captureAll } from "./capture.js";
import { CASHIER, createDemo, createNewcomer, DEMO, NEWCOMER, payPlusPlan } from "./demo.js";
import { ROOT } from "./paths.js";
import { buildPdf } from "./pdf.js";
import { seedBusiness } from "./seed.js";
import { type Stack, up, WEB_URL } from "./stack.js";

/**
 * `pnpm --filter manual manual`
 *   Levanta el SellPointy del manual, crea el negocio de demostración, toma
 *   todas las capturas, lo apaga y arma el PDF en `docs/manual/dist/`.
 *   Necesita Colima encendido (Postgres y Redis).
 *
 * `pnpm --filter manual manual:pdf`
 *   Solo el PDF, con las capturas que ya existen: para corregir un texto sin
 *   volver a levantar nada.
 *
 * `pnpm --filter manual manual --serve`
 *   Levanta y siembra, y lo deja ENCENDIDO para recorrerlo a mano (en
 *   http://localhost:5199) mientras se escribe un capítulo. Ctrl+C lo apaga.
 */
const pdfOnly = process.argv.includes("--pdf-only");
const serve = process.argv.includes("--serve");
let stack: Stack | null = null;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await stack?.down();
    process.exit(130);
  });
}

async function main(): Promise<void> {
  if (!pdfOnly) {
    stack = await up();
    try {
      const demo = await createDemo(stack);
      await payPlusPlan(stack, demo);
      await seedBusiness(stack, demo);
      await createNewcomer(stack);
      if (serve) {
        console.log(`Encendido en ${WEB_URL}/login?lang=es. Ctrl+C lo apaga.`);
        for (const [who, account] of [
          ["la dueña", DEMO],
          ["el cajero", CASHIER],
          ["la cuenta nueva", NEWCOMER],
        ] as const) {
          console.log(`  · ${who}: ${account.email} / ${account.password}`);
        }
        await new Promise(() => {});
      }
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
