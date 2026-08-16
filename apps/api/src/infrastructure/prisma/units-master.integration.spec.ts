import { ConfigService } from "@nestjs/config";
import { UNIT_CODES, UNITS } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F2-DB-01: tabla MAESTRA
 * `units`. Mismo molde que `currencies`: global (sin `tenant_id`, sin RLS),
 * poblada desde la migración para que llegue a TODOS los entornos por el
 * pipeline, y de solo lectura para la app.
 *
 * Qué se verifica acá (criterio de CONTRIBUTING: decisiones, no constantes):
 * 1. La app LEE el catálogo — es el contrato del que cuelga `base_unit` de
 *    productos y el helper de conversiones de F2-UOM.
 * 2. La app NO puede escribirlo — decisión de seguridad: el `REVOKE` de la
 *    migración tiene que ganarle al grant amplio de `ALTER DEFAULT PRIVILEGES`
 *    (`20260806172006_app_db_user`). Sin este test, agregar la tabla y
 *    olvidarse del REVOKE pasa desapercibido.
 * 3. El CHECK de `category` existe — sin él, un typo en una migración futura
 *    metería una categoría que el conversor de F2-UOM no sabe manejar.
 *    Se afirma sobre el catálogo de Postgres y no intentando un INSERT
 *    inválido porque `sellpoint_app` no tiene INSERT (punto 2): el error
 *    sería de permisos y taparía lo que se quiere probar.
 */
describe("units — tabla maestra (F2-DB-01)", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("la app lee el catálogo sembrado por la migración, con su categoría", async () => {
    const units = await prisma.unit.findMany({ where: { isActive: true } });
    const byCode = new Map(units.map((unit) => [unit.code, unit]));

    // Las 9 unidades del alcance de F2 (IMPLEMENTACION.md, F2-DB-01). No se
    // asserta el TOTAL de filas a propósito: agregar una unidad nueva es
    // aditivo y no debería romper este test.
    expect(byCode.get("unit")?.category).toBe("count");
    expect(byCode.get("ml")?.category).toBe("volume");
    expect(byCode.get("l")?.category).toBe("volume");
    expect(byCode.get("gr")?.category).toBe("weight");
    expect(byCode.get("kg")?.category).toBe("weight");
    expect(byCode.get("m")?.category).toBe("length");
    expect(byCode.get("cm")?.category).toBe("length");
    expect(byCode.get("oz")?.category).toBe("weight");
    expect(byCode.get("lb")?.category).toBe("weight");
  });

  it("la app NO puede escribir la tabla maestra (el REVOKE le gana al grant por default)", async () => {
    const privileges = await Promise.all(
      ["SELECT", "INSERT", "UPDATE", "DELETE"].map(async (privilege) => {
        const rows = await prisma.$queryRaw<
          { has_privilege: boolean }[]
        >`SELECT has_table_privilege('sellpoint_app', 'public.units', ${privilege}) AS has_privilege`;
        return rows[0]?.has_privilege;
      }),
    );

    expect(privileges).toEqual([true, false, false, false]);
  });

  it("un INSERT desde la app es rechazado en runtime por PERMISOS, no por otra causa", async () => {
    // Se afirma el motivo (42501 = insufficient_privilege) y no un throw
    // cualquiera: sin la tabla creada, un `rejects.toThrow()` pelado pasaría
    // por "relation does not exist" y el test sería verde sin probar nada.
    await expect(
      prisma.$executeRaw`INSERT INTO units (code, name_es, name_en, category) VALUES ('xx', 'x', 'x', 'count')`,
    ).rejects.toThrow(/permission denied|42501/i);
  });

  // F2-UOM-01: contrato entre las DOS fuentes de la misma verdad. La DB manda
  // en la identidad (es la FK de `products.base_unit`); `@sellpoint/shared`
  // manda en los factores (constantes físicas) y es lo que consume el front.
  // Si divergen, el selector de unidad del web ofrecería algo que la DB
  // rechaza, o el conversor no sabría convertir una unidad que sí existe.
  it("el catálogo compartido y la tabla `units` contienen exactamente las mismas unidades", async () => {
    const rows = await prisma.unit.findMany();
    const inDatabase = rows.map((unit) => unit.code).sort();
    const inShared = [...UNIT_CODES].sort();

    expect(inDatabase).toEqual(inShared);
  });

  it("la categoría de cada unidad coincide entre la DB y el catálogo compartido", async () => {
    const rows = await prisma.unit.findMany();

    const mismatches = rows
      .filter((row) => UNITS[row.code as keyof typeof UNITS]?.category !== row.category)
      .map(
        (row) =>
          `${row.code}: DB dice "${row.category}", shared dice "${UNITS[row.code as keyof typeof UNITS]?.category}"`,
      );

    expect(mismatches).toEqual([]);
  });

  it("`category` está acotada por CHECK a las cuatro categorías conocidas", async () => {
    const [constraint] = await prisma.$queryRaw<
      { definition: string }[]
    >`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.units'::regclass
        AND contype = 'c'
        AND conname = 'units_category_check'`;

    expect(constraint?.definition).toContain("count");
    expect(constraint?.definition).toContain("volume");
    expect(constraint?.definition).toContain("weight");
    expect(constraint?.definition).toContain("length");
  });
});
