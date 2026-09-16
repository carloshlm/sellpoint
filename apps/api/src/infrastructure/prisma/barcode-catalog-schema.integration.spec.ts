import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * F10-QUICKCAT-03 — el sello de procedencia del catálogo global, contra la
 * base de verdad.
 *
 * Hay una sola cosa que este spec tiene que impedir, y no se ve leyendo el
 * código: que eliminar un negocio borre filas del catálogo que usan todos los
 * demás. `purge_tenant` recorre `information_schema` y borra de TODA tabla con
 * una columna llamada `tenant_id`, así que el día que alguien «normalice» el
 * nombre de `contributed_by_tenant_id` el daño es silencioso y total. Acá se
 * ejecuta la purga de verdad y se mira si la fila sigue.
 */
describe("catálogo global de códigos de barras: sello de procedencia (F10-QUICKCAT-03)", () => {
  let prisma: PrismaService;
  let negocio: string;
  const stamp = Date.now();
  // Un GTIN-14 de prueba que no choca con las 953,969 filas reales: el rango
  // 999 es de cupones y no entra por importación.
  const GTIN = "09990000000000";

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    negocio = (await prisma.tenant.create({ data: { name: `Aporta ${stamp}` } })).id;
  });

  afterAll(async () => {
    await prisma.globalBarcodeCatalog.deleteMany({ where: { gtin14: GTIN } });
    await prisma.tenant.deleteMany({ where: { id: negocio } });
    await prisma.onModuleDestroy();
  });

  it("borrar el negocio que aportó un código NO borra el código del catálogo", async () => {
    await prisma.globalBarcodeCatalog.create({
      data: {
        gtin14: GTIN,
        productName: "Aportado por un negocio",
        search: "aportado por un negocio",
        source: "tenant_contributed",
        confirmations: 1,
        contributedByTenantId: negocio,
        contributedAt: new Date(),
      },
    });

    await prisma.tenant.update({
      where: { id: negocio },
      data: { suspendedAt: new Date(), suspendedReason: "fin del spec" },
    });
    await prisma.$queryRaw`SELECT purge_tenant(${negocio}::uuid)`;

    const fila = await prisma.globalBarcodeCatalog.findUnique({ where: { gtin14: GTIN } });
    expect(fila?.productName).toBe("Aportado por un negocio");
    // El sello queda apuntando a un negocio que ya no existe, y está BIEN: es
    // procedencia para auditar, no una relación que alguien vaya a recorrer.
    expect(fila?.contributedByTenantId).toBe(negocio);
  });

  it("una fila nuestra sin sello no entra, y una de Open Food Facts con sello tampoco", async () => {
    const base = { productName: "X", search: "x", confirmations: 0 };

    await expect(
      prisma.globalBarcodeCatalog.create({
        data: { ...base, gtin14: "09990000000001", source: "tenant_contributed" },
      }),
    ).rejects.toThrow(/contribution_check/);

    await expect(
      prisma.globalBarcodeCatalog.create({
        data: {
          ...base,
          gtin14: "09990000000002",
          source: "open_food_facts",
          contributedByTenantId: negocio,
          contributedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/contribution_check/);
  });
});
