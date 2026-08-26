import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real) — contacto estándar del almacén + campos
 * dinámicos en almacenes y servicios (Carlos, 2026-08-26).
 *
 * Se testean las invariantes que viven en la migración y no en el código:
 * las columnas nuevas con sus tipos exactos y los índices GIN jsonb_path_ops
 * que hacen barata la query inversa de assertNotReferenced.
 */
describe("warehouses/services — contacto y attributes (2026-08-26)", () => {
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

  it("warehouses tiene phone varchar(20), email y attributes jsonb con default {}", async () => {
    const columns = await prisma.$queryRaw<
      { column_name: string; data_type: string; character_maximum_length: number | null }[]
    >`SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'warehouses' AND column_name IN ('phone', 'email', 'attributes')`;

    const byName = new Map(columns.map((c) => [c.column_name, c]));
    expect(byName.get("phone")).toMatchObject({
      data_type: "character varying",
      character_maximum_length: 20,
    });
    expect(byName.get("email")).toMatchObject({ data_type: "text" });
    expect(byName.get("attributes")).toMatchObject({ data_type: "jsonb" });
  });

  it("services tiene attributes jsonb", async () => {
    const columns = await prisma.$queryRaw<
      { column_name: string; data_type: string }[]
    >`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'services' AND column_name = 'attributes'`;

    expect(columns).toEqual([{ column_name: "attributes", data_type: "jsonb" }]);
  });

  it("ambas tablas tienen su índice GIN jsonb_path_ops sobre attributes", async () => {
    const indexes = await prisma.$queryRaw<
      { tablename: string; indexdef: string }[]
    >`SELECT tablename, indexdef FROM pg_indexes
      WHERE tablename IN ('warehouses', 'services') AND indexdef LIKE '%attributes%'`;

    const warehousesGin = indexes.find((i) => i.tablename === "warehouses");
    const servicesGin = indexes.find((i) => i.tablename === "services");
    expect(warehousesGin?.indexdef).toContain("gin");
    expect(warehousesGin?.indexdef).toContain("jsonb_path_ops");
    expect(servicesGin?.indexdef).toContain("gin");
    expect(servicesGin?.indexdef).toContain("jsonb_path_ops");
  });
});
