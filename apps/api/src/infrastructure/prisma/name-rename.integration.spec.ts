import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20260911100000_f1_name_universal_surnames/migration.sql",
);

/**
 * Integration (Postgres real) — F1-NAME-05: el apellido deja de tener género.
 *
 * Este spec existe por UNA razón: `prisma migrate dev` no sabe que un rename
 * es un rename. Para él una columna desapareció y otra nació, así que emite
 * `DROP COLUMN` + `ADD COLUMN` — y eso BORRA el nombre de cada persona de la
 * base. Es el único error de este módulo que destruye datos, y se comete sin
 * darse cuenta: basta con regenerar la migración un día que haga falta.
 *
 * Por eso la primera prueba mira el ARCHIVO, no el resultado: cuando el
 * resultado se pueda observar en producción ya será tarde.
 */
describe("el rename de los apellidos (F1-NAME-05)", () => {
  let admin: PrismaClient;
  const sql = readFileSync(MIGRATION, "utf8");
  /** Sin los comentarios: lo que Postgres realmente ejecuta. */
  const sentencias = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  beforeAll(() => {
    const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL para leer el catálogo de Postgres");
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await admin.$disconnect();
  });

  it("la migración RENOMBRA: cuatro veces, y no borra ni crea una sola columna", () => {
    expect(sentencias.match(/RENAME COLUMN/g)).toHaveLength(4);
    expect(sentencias).not.toMatch(/DROP COLUMN/);
    expect(sentencias).not.toMatch(/ADD COLUMN/);
    // Las cuatro son las que esperamos, en las dos tablas de personas.
    for (const tabla of ["users", "customers"]) {
      expect(sentencias).toContain(
        `ALTER TABLE "${tabla}" RENAME COLUMN "last_name_paternal" TO "last_name";`,
      );
      expect(sentencias).toContain(
        `ALTER TABLE "${tabla}" RENAME COLUMN "last_name_maternal" TO "second_last_name";`,
      );
    }
  });

  it("deja escrito cómo deshacerla: revertir se copia, no se investiga", () => {
    expect(sql).toContain('RENAME COLUMN "last_name" TO "last_name_paternal"');
    expect(sql).toContain('RENAME COLUMN "second_last_name" TO "last_name_maternal"');
  });

  it("en la base viva, las dos tablas ya hablan universal y no queda rastro del modelo mexicano", async () => {
    const filas = await admin.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'customers')
         AND column_name IN ('last_name', 'second_last_name', 'last_name_paternal', 'last_name_maternal')
       ORDER BY table_name, column_name`;
    const porTabla = (t: string) =>
      filas.filter((f) => f.table_name === t).map((f) => f.column_name);

    expect(porTabla("users")).toEqual(["last_name", "second_last_name"]);
    expect(porTabla("customers")).toEqual(["last_name", "second_last_name"]);
  });

  it("ningún índice ni constraint dependía de esas columnas: por eso el rename es inerte", async () => {
    const dependencias = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
       WHERE c.relname IN ('users', 'customers')
         AND a.attname IN ('last_name', 'second_last_name')`;
    expect(Number(dependencias[0]?.n ?? 0)).toBe(0);
  });
});
