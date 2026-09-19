import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * F11-SITE-LEAD-01 / F11-SITE-SEO-06 — las dos tablas del sitio público,
 * contra la base de verdad.
 *
 * Hay una sola cosa que este spec tiene que impedir, y no se ve leyendo el
 * código: que eliminar un negocio borre prospectos o mediciones del sitio.
 * `purge_tenant` recorre `information_schema` y borra de TODA tabla con una
 * columna llamada `tenant_id`, así que el día que alguien le agregue esa
 * columna a `site_leads` —para «relacionar el prospecto con el negocio que
 * abrió»— el daño es silencioso y total. Acá se ejecuta la purga de verdad y
 * se mira si las filas siguen.
 *
 * Mismo molde que `barcode-catalog-schema.integration.spec.ts`, que custodia
 * lo mismo para el catálogo global de códigos de barras.
 */
describe("las tablas del sitio público sobreviven a purge_tenant (F11-SITE-LEAD-01)", () => {
  let prisma: PrismaService;
  let negocio: string;
  const stamp = Date.now();
  const EMAIL = `purga-${stamp}@example.com`;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    negocio = (await prisma.tenant.create({ data: { name: `Purga sitio ${stamp}` } })).id;
  });

  afterAll(async () => {
    await prisma.siteLead.deleteMany({ where: { email: EMAIL } });
    await prisma.siteEvent.deleteMany({ where: { section: `purga-${stamp}` } });
    await prisma.tenant.deleteMany({ where: { id: negocio } });
    await prisma.onModuleDestroy();
  });

  it("eliminar un negocio NO borra prospectos ni eventos del sitio", async () => {
    const prospecto = await prisma.siteLead.create({
      data: {
        name: "Quien escribió",
        email: EMAIL,
        country: "MX",
        locale: "es",
        route: "es-mx",
        planInterest: "pro",
        consentAt: new Date(),
        consentText: "Acepto el aviso de privacidad.",
      },
    });
    const evento = await prisma.siteEvent.create({
      data: { event: "form_submit", market: "mx", locale: "es", section: `purga-${stamp}` },
    });

    await prisma.tenant.update({
      where: { id: negocio },
      data: { suspendedAt: new Date(), suspendedReason: "fin del spec" },
    });
    await prisma.$queryRaw`SELECT purge_tenant(${negocio}::uuid)`;

    expect(await prisma.siteLead.findUnique({ where: { id: prospecto.id } })).not.toBeNull();
    expect(await prisma.siteEvent.findUnique({ where: { id: evento.id } })).not.toBeNull();
  });

  /**
   * La comprobación ESTRUCTURAL, que es la que de verdad cierra el hueco: el
   * test de arriba seguiría verde si alguien agregara `tenant_id` a la tabla
   * y el prospecto del spec no perteneciera a ese negocio.
   */
  it("ninguna de las dos tablas tiene una columna llamada tenant_id", async () => {
    const columnas = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'tenant_id'
         AND table_name IN ('site_leads', 'site_events')
    `;

    expect(columnas).toEqual([]);
  });

  /** Sin RLS: no hay tenant contra el cual aislar, y el backoffice no abre contexto. */
  it("ninguna de las dos tablas tiene RLS activado", async () => {
    const filas = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity
        FROM pg_class
       WHERE relname IN ('site_leads', 'site_events')
    `;

    expect(filas).toHaveLength(2);
    expect(filas.every((fila) => fila.relrowsecurity === false)).toBe(true);
  });
});
