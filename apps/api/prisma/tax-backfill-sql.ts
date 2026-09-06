import { resolveTaxDefaults, TAX_CURATED_COUNTRIES } from "@sellpoint/shared";

/**
 * F4-TAX-05 — genera el SQL del backfill de impuestos para los negocios que
 * ya existían. La fuente de verdad es `resolveTaxDefaults` (shared): el SQL
 * NO se escribe a mano, se genera con
 *
 *   pnpm --filter api exec tsx prisma/tax-backfill-sql.ts > prisma/migrations/<stamp>_f4_taxes_backfill/migration.sql
 *
 * y `tax-backfill.integration.spec.ts` fija que el archivo de la migración
 * es EXACTAMENTE lo que esta función emite: si shared cambia, el spec avisa.
 *
 * Los negocios existentes no tienen región: Canadá recibe solo lo federal
 * (GST 5% default) y la tarjeta de impuestos pide la provincia; Estados
 * Unidos nace sin impuesto hasta que configure el suyo. México recibe IVA 16%
 * incluido: el precio no cambia, el ticket empieza a desglosar.
 */
const literal = (texto: string) => `'${texto.replace(/'/g, "''")}'`;

export function buildTaxBackfillSql(): string {
  const grupos: string[] = [];
  const tasas: string[] = [];
  const excluidos: string[] = [];
  for (const pais of TAX_CURATED_COUNTRIES) {
    const defaults = resolveTaxDefaults(pais);
    if (defaults.mode === "excluded") excluidos.push(literal(pais));
    defaults.groups.forEach((g, gi) => {
      grupos.push(
        `(${literal(pais)}, ${literal(g.code)}, ${literal(g.name)}, ${g.isDefault}, ${gi})`,
      );
      g.rates.forEach((r, ri) => {
        tasas.push(
          `(${literal(pais)}, ${literal(g.code)}, ${literal(r.code)}, ${literal(r.name)}, ${r.rate}, ${ri})`,
        );
      });
    });
  }
  const fallback = resolveTaxDefaults(null);
  const fb = fallback.groups[0];
  if (fallback.groups.length !== 1 || fb === undefined || fb.rates.length !== 0) {
    throw new Error("el fallback debe ser un solo grupo sin tasas");
  }

  return `-- F4-TAX-05 — Backfill de impuestos para los negocios que ya existían.
--
-- GENERADO por prisma/tax-backfill-sql.ts desde \`resolveTaxDefaults\` (shared).
-- No se edita a mano: el spec tax-backfill.integration.spec.ts compara este
-- archivo con lo que el generador emite.
--
-- Idempotente: solo toca negocios SIN grupos (NOT EXISTS). Los documentos
-- históricos quedan con tax_mode = 'included', tax_total = 0 y
-- tax_amount = 0 por DEFAULT de F4-TAX-04: se leen correctos sin tocarlos.
--
-- Sin región (los negocios existentes no la tienen): Canadá recibe solo lo
-- federal y la tarjeta de impuestos pedirá la provincia; Estados Unidos nace
-- sin impuesto. México: IVA 16% incluido, el precio no cambia.

-- 1) El modo, solo donde el precio NO trae el impuesto.
UPDATE tenants t
   SET tax_mode = 'excluded'
 WHERE t.country IN (${excluidos.join(", ")})
   AND NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id);

-- 2) Los grupos y sus componentes, por país curado.
WITH nuevos AS (
  INSERT INTO tax_groups (tenant_id, code, name, is_default, is_active, sort_order, updated_at)
  SELECT t.id, v.code, v.name, v.is_default, true, v.sort_order, now()
    FROM tenants t
    JOIN (VALUES
${grupos.map((g) => `      ${g}`).join(",\n")}
    ) AS v(country, code, name, is_default, sort_order) ON v.country = t.country
   WHERE NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id)
  RETURNING id, tenant_id, code
)
INSERT INTO tax_rates (tenant_id, tax_group_id, code, name, rate, sort_order)
SELECT n.tenant_id, n.id, r.code, r.name, r.rate, r.sort_order
  FROM nuevos n
  JOIN tenants t ON t.id = n.tenant_id
  JOIN (VALUES
${tasas.map((r) => `    ${r}`).join(",\n")}
  ) AS r(country, group_code, code, name, rate, sort_order)
    ON r.country = t.country AND r.group_code = n.code;

-- 3) El resto (sin país, o país no curado): sin impuesto, precio final.
INSERT INTO tax_groups (tenant_id, code, name, is_default, is_active, sort_order, updated_at)
SELECT t.id, ${literal(fb.code)}, ${literal(fb.name)}, true, true, 0, now()
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id);
`;
}

if (process.argv[1]?.endsWith("tax-backfill-sql.ts")) {
  process.stdout.write(buildTaxBackfillSql());
}
