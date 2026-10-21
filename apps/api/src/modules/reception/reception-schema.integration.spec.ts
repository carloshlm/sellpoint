import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-RECEP-02/03: el modelo de datos de
 * Recepción.
 *
 * Lo que fija:
 *  - `customers` y `reception_turns` llevan la RLS canónica desde el minuto
 *    cero (con el rol REAL de la app, sin bypass);
 *  - el UNIQUE (tenant, día del negocio, número) y los CHECKs de coherencia
 *    (un turno atendido sin hora no puede existir ni por bug);
 *  - «Eliminar» un cliente deja el turno vivo con `customer_id` NULL y el
 *    nombre en el snapshot.
 */
describe("modelo de datos de Recepción (F9-RECEP-02/03)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  const stamp = Date.now();
  const hoy = new Date("2026-09-02");

  /** Transacción con el rol REAL de la app (sin bypass de RLS). */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Recep A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Recep B ${stamp}` } })).id;
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.customer.create({
          data: { tenantId, firstName: "Ana", lastName: "Pérez", phone: "+525512345678" },
        }),
      );
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("customers (F9-RECEP-02)", () => {
    it("RLS: sin contexto de tenant, cero filas con el rol real de la app", async () => {
      const filas = await asAppRole((tx) => tx.customer.findMany());
      expect(filas).toHaveLength(0);
    });

    it("RLS: el contexto del tenant A no ve al cliente del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.customer.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(filas.map((f) => f.tenantId)).toEqual([tenantA]);
    });

    it("un teléfono que no es E.164 rebota en el CHECK", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.customer.create({
            data: {
              tenantId: tenantA,
              firstName: "Luis",
              lastName: "Gómez",
              phone: "5512345678",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("nadie nace mañana: una fecha futura rebota en el CHECK", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.customer.create({
            data: {
              tenantId: tenantA,
              firstName: "Luis",
              lastName: "Gómez",
              birthDate: new Date("2099-01-01"),
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("reception_turns (F9-RECEP-03)", () => {
    it("dos turnos con el mismo (tenant, día, número) rebotan en el UNIQUE", async () => {
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.receptionTurn.create({ data: { tenantId: tenantA, businessDate: hoy, number: 1 } }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.receptionTurn.create({ data: { tenantId: tenantA, businessDate: hoy, number: 1 } }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("el mismo número en OTRO negocio sí existe: la serie es por tenant", async () => {
      await expect(
        prisma.withTenantContext(tenantB, (tx) =>
          tx.receptionTurn.create({ data: { tenantId: tenantB, businessDate: hoy, number: 1 } }),
        ),
      ).resolves.toMatchObject({ number: 1 });
    });

    it("atendido sin hora de atención viola el CHECK de coherencia", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.receptionTurn.create({
            data: { tenantId: tenantA, businessDate: hoy, number: 2, status: "attended" },
          }),
        ),
      ).rejects.toThrow();
    });

    it("un estado fuera del catálogo rebota", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.receptionTurn.create({
            data: { tenantId: tenantA, businessDate: hoy, number: 3, status: "done" },
          }),
        ),
      ).rejects.toThrow();
    });

    it("borrar al cliente deja el turno vivo: customer_id NULL y el nombre en el snapshot", async () => {
      const turno = await prisma.withTenantContext(tenantA, async (tx) => {
        const cliente = await tx.customer.create({
          data: { tenantId: tenantA, firstName: "Rosa", lastName: "Luna" },
        });
        const creado = await tx.receptionTurn.create({
          data: {
            tenantId: tenantA,
            businessDate: hoy,
            number: 4,
            customerId: cliente.id,
            customerName: "Rosa Luna",
          },
        });
        await tx.customer.delete({ where: { id: cliente.id } });
        return tx.receptionTurn.findUniqueOrThrow({ where: { id: creado.id } });
      });
      expect(turno.customerId).toBeNull();
      expect(turno.customerName).toBe("Rosa Luna");
    });

    it("RLS: el contexto del tenant A no ve los turnos del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB}::text, true)`;
        return tx.receptionTurn.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(filas.every((f) => f.tenantId === tenantB)).toBe(true);
      expect(filas).toHaveLength(1);
    });
  });

  /**
   * F9-RECEP-22 — la venta de un servicio genera el turno. Los servicios que
   * lo hacen viven en `reception_turn_services`, con la RLS canónica; y la
   * venta guarda lo que el módulo le devolvió en `sales.annotations`.
   */
  describe("reception_turn_services y sales.annotations (F9-RECEP-22)", () => {
    const servicioDe = (tenantId: string, code: string) =>
      prisma.withTenantContext(tenantId, (tx) =>
        tx.service.create({ data: { tenantId, code, name: "Consulta médica" } }),
      );

    beforeAll(async () => {
      for (const tenantId of [tenantA, tenantB]) {
        const servicio = await servicioDe(tenantId, `CONS-${stamp}`);
        await prisma.withTenantContext(tenantId, (tx) =>
          tx.receptionTurnService.create({ data: { tenantId, serviceId: servicio.id } }),
        );
      }
    });

    it("RLS: sin contexto de tenant, cero filas con el rol real de la app", async () => {
      const filas = await asAppRole((tx) => tx.receptionTurnService.findMany());
      expect(filas).toHaveLength(0);
    });

    it("RLS: el contexto del tenant A no ve los servicios marcados del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.receptionTurnService.findMany({
          where: { tenantId: { in: [tenantA, tenantB] } },
        });
      });
      expect(filas.map((f) => f.tenantId)).toEqual([tenantA]);
    });

    it("borrar el servicio lo quita de la lista (CASCADE)", async () => {
      const servicio = await servicioDe(tenantA, `TEMP-${stamp}`);
      const quedan = await prisma.withTenantContext(tenantA, async (tx) => {
        await tx.receptionTurnService.create({
          data: { tenantId: tenantA, serviceId: servicio.id },
        });
        await tx.service.delete({ where: { id: servicio.id } });
        return tx.receptionTurnService.count({ where: { serviceId: servicio.id } });
      });
      expect(quedan).toBe(0);
    });

    it("`sales.annotations` nace en `[]` y su CHECK solo acepta un arreglo", async () => {
      const [columna] = await prisma.$queryRaw<{ column_default: string }[]>`
        SELECT column_default FROM information_schema.columns
        WHERE table_name = 'sales' AND column_name = 'annotations'`;
      expect(columna?.column_default).toContain("'[]'");
      const [check] = await prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'sales_annotations_is_array'`;
      expect(check?.def).toContain("jsonb_typeof(annotations) = 'array'");
    });
  });
});
