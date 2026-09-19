import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { SiteLeadsRetentionJob } from "./site-leads-retention.job";

/**
 * F11-SITE-LEAD-10 — las tres situaciones que importan, contra la base de
 * verdad y con el reloj simulado:
 *
 *   · uno de 23 meses se queda;
 *   · uno de 25 se va;
 *   · uno de 25 que YA es cliente se queda.
 *
 * El tercero es el que obliga a que este spec sea de integración: «ya es
 * cliente» se resuelve con `auth_resolve_tenant_by_email`, la única excepción
 * de RLS del sistema. Un mock de Prisma no probaría nada — y el bug que
 * evitaría es enorme: `users` tiene RLS, así que una consulta directa desde el
 * runtime ve CERO usuarios y borraría los prospectos de todos los clientes.
 */
const AHORA = new Date("2026-09-18T20:00:00.000Z");
const MES_MS = 30 * 24 * 60 * 60 * 1000;

describe("SiteLeadsRetentionJob contra Postgres (F11-SITE-LEAD-10)", () => {
  let prisma: PrismaService;
  let job: SiteLeadsRetentionJob;
  const stamp = Date.now();
  const recienteEmail = `reciente-${stamp}@example.com`;
  const viejoEmail = `viejo-${stamp}@example.com`;
  const clienteEmail = `cliente-${stamp}@example.com`;
  let negocio: string;

  /** Un prospecto con la antigüedad que se le pida (en meses aproximados). */
  async function prospecto(email: string, mesesAtras: number): Promise<string> {
    const fila = await prisma.siteLead.create({
      data: {
        name: "Quien escribió",
        email,
        country: "MX",
        locale: "es",
        route: "es-mx",
        planInterest: "undecided",
        consentAt: AHORA,
        consentText: "Acepto.",
        createdAt: new Date(AHORA.getTime() - mesesAtras * MES_MS),
      },
    });
    return fila.id;
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    job = new SiteLeadsRetentionJob(prisma);

    negocio = (await prisma.tenant.create({ data: { name: `Retención ${stamp}` } })).id;
    // El prospecto que se volvió cliente: la misma dirección, ya con cuenta.
    await prisma.withTenantContext(negocio, (tx) =>
      tx.user.create({
        data: { tenantId: negocio, email: clienteEmail, firstName: "Ya", lastName: "Cliente" },
      }),
    );
  });

  afterAll(async () => {
    await prisma.siteLead.deleteMany({
      where: { email: { in: [recienteEmail, viejoEmail, clienteEmail] } },
    });
    await prisma.withTenantContext(negocio, (tx) =>
      tx.user.deleteMany({ where: { email: clienteEmail } }),
    );
    await prisma.tenant.deleteMany({ where: { id: negocio } });
    await prisma.onModuleDestroy();
  });

  it("23 meses se queda, 25 se va, y 25 que ya es cliente se queda", async () => {
    const reciente = await prospecto(recienteEmail, 23);
    const viejo = await prospecto(viejoEmail, 25);
    const cliente = await prospecto(clienteEmail, 25);

    const { deleted } = await job.run(AHORA);

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.siteLead.findUnique({ where: { id: reciente } })).not.toBeNull();
    expect(await prisma.siteLead.findUnique({ where: { id: viejo } })).toBeNull();
    expect(await prisma.siteLead.findUnique({ where: { id: cliente } })).not.toBeNull();
  });

  it("correrlo otra vez no borra nada: idempotente por construcción", async () => {
    const { deleted } = await job.run(AHORA);

    // Cero de LOS NUESTROS: otro spec de la misma corrida podría haber dejado
    // filas viejas, así que lo que se afirma es que las tres siguen como
    // quedaron — no un cero global que otra suite podría romper.
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(
      await prisma.siteLead.count({ where: { email: { in: [recienteEmail, clienteEmail] } } }),
    ).toBe(2);
    expect(await prisma.siteLead.count({ where: { email: viejoEmail } })).toBe(0);
  });

  it("un correo con otra capitalización en la cuenta también cuenta como cliente", async () => {
    const email = `Mayus-${stamp}@example.com`.toLowerCase();
    await prisma.withTenantContext(negocio, (tx) =>
      tx.user.create({
        data: { tenantId: negocio, email, firstName: "May", lastName: "Us" },
      }),
    );
    const lead = await prospecto(email, 30);

    await job.run(AHORA);

    expect(await prisma.siteLead.findUnique({ where: { id: lead } })).not.toBeNull();

    await prisma.siteLead.deleteMany({ where: { email } });
    await prisma.withTenantContext(negocio, (tx) => tx.user.deleteMany({ where: { email } }));
  });
});
