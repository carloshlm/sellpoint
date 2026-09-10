import * as fs from "node:fs";
import * as path from "node:path";
import { EXPENSE_CATEGORY_SEED, expenseCategorySortOrder } from "@sellpoint/shared";

/**
 * BARRERA (F9-EXP-02): las 18 categorías de fábrica viven en DOS lugares por
 * diseño —`EXPENSE_CATEGORY_SEED` (shared, lo que siembra `provision()`) y
 * el `VALUES` del backfill de la migración (lo que recibieron los negocios
 * que ya existían)— y tienen que decir EXACTAMENTE lo mismo: código, nombre
 * en los dos idiomas y orden. Si alguien agrega una categoría en un lado y no
 * en el otro, un negocio nuevo y uno viejo verían catálogos distintos.
 *
 * Lee el SQL y no la base, por la misma razón que `permissions-catalog.spec`:
 * así falla en la máquina de quien lo rompe.
 */
const MIGRACION = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "prisma",
  "migrations",
  "20260919100000_f9_expense_categories",
  "migration.sql",
);

function filasDelBackfill(): { code: string; es: string; en: string; sort: number }[] {
  const sql = fs.readFileSync(MIGRACION, "utf8");
  const bloque = sql.match(/CROSS JOIN \(VALUES([\s\S]*?)\) AS v\(/);
  if (!bloque?.[1]) {
    throw new Error("El backfill de categorías no tiene su bloque VALUES");
  }
  return [...bloque[1].matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m) => ({
    code: m[1] as string,
    es: m[2] as string,
    en: m[3] as string,
    sort: Number(m[4]),
  }));
}

describe("barrera: el backfill SQL y EXPENSE_CATEGORY_SEED son la misma lista (F9-EXP-02)", () => {
  it("mismos códigos, mismos nombres en es y en, mismo orden", () => {
    const sql = filasDelBackfill();
    const shared = EXPENSE_CATEGORY_SEED.map((c, i) => ({
      code: c.code,
      es: c.name.es,
      en: c.name.en,
      sort: expenseCategorySortOrder(i),
    }));
    expect(sql).toEqual(shared);
    expect(sql).toHaveLength(18);
  });

  it("el backfill elige el nombre por el idioma del owner (el primer usuario del negocio)", () => {
    const sql = fs.readFileSync(MIGRACION, "utf8");
    expect(sql).toMatch(/CASE WHEN o\.locale = 'en' THEN v\.name_en ELSE v\.name_es END/);
    expect(sql).toMatch(
      /FROM "users" u WHERE u\.tenant_id = t\.id ORDER BY u\.created_at ASC LIMIT 1/,
    );
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });
});
