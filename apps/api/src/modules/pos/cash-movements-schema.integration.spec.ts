import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

type Movimiento = Prisma.CashMovementUncheckedCreateInput;

/**
 * Integration (Postgres real) — F10-CASHMOV-01: la tabla `cash_movements`,
 * las entradas y los retiros de efectivo de un turno.
 *
 * Lo que fija la BASE por su cuenta, aunque el service se equivoque:
 *  - el importe es positivo (el tipo dice la dirección, no el signo);
 *  - el motivo corresponde al tipo: «Fondo para cambio» solo entra; «A la caja
 *    fuerte», «Depósito al banco» y «Retiro del dueño» solo salen; «Otro», los
 *    dos;
 *  - «Otro» exige una nota que no esté en blanco;
 *  - un movimiento anulado tiene quién, cuándo y por qué, y uno activo no
 *    tiene ninguno de los tres;
 *  - el turno no se borra si tiene movimientos (FK RESTRICT);
 *  - un negocio de pruebas con movimientos se sigue purgando entero con
 *    `purge_tenant()`, la misma búsqueda por `tenant_id` del teardown.
 *
 * Cada rechazo se compara con el NOMBRE de su CHECK: un `toThrow()` a secas
 * seguiría en verde si el CHECK desapareciera y otro rebotara la fila.
 */
describe("modelo de datos de las entradas y retiros de efectivo (F10-CASHMOV-01)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let usuarioA: string;
  let turnoA: string;
  const stamp = Date.now();

  /** Transacción con el rol real de la app: sin bypass de RLS ni superusuario. */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  /** Un movimiento mínimo válido (un retiro a la caja fuerte); `extra` pisa lo que el caso quiera romper. */
  const movimiento = (extra: Partial<Movimiento> = {}): Movimiento => ({
    tenantId: tenantA,
    cashboxSessionId: turnoA,
    type: "out",
    reason: "safe",
    amount: "2000.00",
    createdBy: usuarioA,
    ...extra,
  });

  const crear = (extra: Partial<Movimiento> = {}) =>
    prisma.withTenantContext(tenantA, (tx) => tx.cashMovement.create({ data: movimiento(extra) }));

  /** Los sellos completos de una anulación hecha por `usuario`. */
  const sellos = (usuario: string) => ({
    status: "canceled" as const,
    canceledAt: new Date(),
    canceledBy: usuario,
    cancelReason: "Se capturó dos veces",
  });

  /** Un negocio con su usuario, su sucursal y un turno abierto. */
  const sembrarNegocio = async (nombre: string, sufijo: string) => {
    const tenantId = (await prisma.tenant.create({ data: { name: `${nombre} ${stamp}` } })).id;
    return prisma.withTenantContext(tenantId, async (tx) => {
      const usuario = await tx.user.create({
        data: {
          tenantId,
          email: `cashmov-${stamp}-${sufijo}@example.com`,
          firstName: "Ana",
          lastName: "Pérez",
        },
      });
      const almacen = await tx.warehouse.create({
        data: { tenantId, code: "CEN", name: "Central" },
      });
      const turno = await tx.cashboxSession.create({
        data: {
          folio: `TUR-${randomUUID().slice(0, 8)}`,
          tenantId,
          warehouseId: almacen.id,
          openedBy: usuario.id,
        },
      });
      return { tenantId, usuario: usuario.id, turno: turno.id };
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    const a = await sembrarNegocio("CashMov A", "a");
    tenantA = a.tenantId;
    usuarioA = a.usuario;
    turnoA = a.turno;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("lo que sí entra", () => {
    it("un movimiento mínimo nace activo, sin autorización y sin sellos de anulación", async () => {
      const creado = await crear();
      expect(creado).toMatchObject({
        type: "out",
        reason: "safe",
        note: null,
        authorized: false,
        status: "active",
        canceledAt: null,
        canceledBy: null,
        cancelReason: null,
      });
      expect(creado.amount.toFixed(2)).toBe("2000.00");
      expect(creado.createdAt).toBeInstanceOf(Date);
    });

    it.each([
      ["in", "change_fund", null],
      ["in", "other", "Cambio que trajo el dueño"],
      ["out", "safe", null],
      ["out", "bank_deposit", null],
      ["out", "owner", null],
      ["out", "other", "Pago del garrafón"],
    ] as const)("%s con motivo %s entra", async (type, reason, note) => {
      const creado = await crear({ type, reason, note, amount: "150.50", authorized: true });
      expect(creado).toMatchObject({ type, reason, note, authorized: true });
      expect(creado.amount.toFixed(2)).toBe("150.50");
    });

    it("un movimiento activo se anula con quién, cuándo y por qué, y la fila se queda", async () => {
      const creado = await crear();
      const anulado = await prisma.withTenantContext(tenantA, (tx) =>
        tx.cashMovement.update({ where: { id: creado.id }, data: sellos(usuarioA) }),
      );
      expect(anulado).toMatchObject({
        id: creado.id,
        status: "canceled",
        canceledBy: usuarioA,
        cancelReason: "Se capturó dos veces",
      });
      expect(anulado.canceledAt).toBeInstanceOf(Date);
    });
  });

  describe("el importe es positivo", () => {
    it.each(["0", "-100.00"])("un importe de %s rebota", async (amount) => {
      await expect(crear({ amount })).rejects.toThrow(/cash_movements_amount_check/);
    });
  });

  describe("el motivo corresponde al tipo", () => {
    it.each([
      ["in", "safe"],
      ["in", "bank_deposit"],
      ["in", "owner"],
      ["out", "change_fund"],
    ] as const)("%s con motivo %s rebota", async (type, reason) => {
      await expect(crear({ type, reason })).rejects.toThrow(/cash_movements_reason_matches_type/);
    });
  });

  describe("«Otro» exige nota", () => {
    it.each([
      ["in", null],
      ["out", null],
      ["out", ""],
      ["in", "   "],
    ] as const)("%s con motivo other y nota %p rebota", async (type, note) => {
      await expect(crear({ type, reason: "other", note })).rejects.toThrow(
        /cash_movements_other_needs_note/,
      );
    });
  });

  describe("la anulación es coherente", () => {
    it.each<[string, (usuario: string) => Partial<Movimiento>]>([
      ["anulado sin ningún sello", () => ({ status: "canceled" })],
      ["anulado sin motivo", (u) => ({ ...sellos(u), cancelReason: null })],
      ["anulado sin quién", (u) => ({ ...sellos(u), canceledBy: null })],
      ["anulado sin cuándo", (u) => ({ ...sellos(u), canceledAt: null })],
      ["anulado con un motivo en blanco", (u) => ({ ...sellos(u), cancelReason: "   " })],
      ["activo con fecha de anulación", () => ({ canceledAt: new Date() })],
      ["activo con quién anuló", (u) => ({ canceledBy: u })],
      ["activo con motivo de anulación", () => ({ cancelReason: "No debería estar" })],
    ])("%s rebota", async (_caso, extra) => {
      await expect(crear(extra(usuarioA))).rejects.toThrow(/cash_movements_canceled_coherent/);
    });

    it("anular sin motivo rebota también en un UPDATE", async () => {
      const creado = await crear();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.cashMovement.update({
            where: { id: creado.id },
            data: { ...sellos(usuarioA), cancelReason: null },
          }),
        ),
      ).rejects.toThrow(/cash_movements_canceled_coherent/);
    });
  });

  describe("el turno y sus movimientos", () => {
    it("un turno con movimientos no se borra (FK RESTRICT)", async () => {
      await crear();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.cashboxSession.delete({ where: { id: turnoA } }),
        ),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("hay un índice por (tenant_id, cashbox_session_id)", async () => {
      const indices = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'cash_movements'
           AND indexname = 'cash_movements_tenant_id_cashbox_session_id_idx'`;
      expect(indices).toHaveLength(1);
      expect(indices[0]?.indexdef).toContain("(tenant_id, cashbox_session_id)");
    });
  });

  /**
   * La purga (skill sellpoint-delete-tenant): `purge_tenant()` y el teardown
   * de las pruebas borran por la columna `tenant_id` de toda tabla BASE, con
   * las FK apagadas. Esta tabla tiene que estar en esa búsqueda, y un negocio
   * de pruebas con movimientos tiene que irse entero.
   */
  describe("la purga de un negocio de pruebas", () => {
    it("cash_movements es una tabla BASE con tenant_id: la encuentran la purga y el teardown", async () => {
      const filas = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT c.table_name::text AS table_name FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
          AND t.table_type = 'BASE TABLE' AND c.table_name = 'cash_movements'`;
      expect(filas).toEqual([{ table_name: "cash_movements" }]);
    });

    it("un negocio desactivado con movimientos activos y anulados se purga entero", async () => {
      const p = await sembrarNegocio("CashMov Purga", "p");
      await prisma.withTenantContext(p.tenantId, async (tx) => {
        const base = {
          tenantId: p.tenantId,
          cashboxSessionId: p.turno,
          createdBy: p.usuario,
        };
        await tx.cashMovement.create({
          data: { ...base, type: "in", reason: "change_fund", amount: "500.00" },
        });
        await tx.cashMovement.create({
          data: {
            ...base,
            type: "out",
            reason: "owner",
            amount: "300.00",
            ...sellos(p.usuario),
          },
        });
      });
      await prisma.tenant.update({
        where: { id: p.tenantId },
        data: { suspendedAt: new Date("2026-08-01T00:00:00Z"), suspendedReason: "Pruebas" },
      });

      await asAppRole((tx) => tx.$queryRaw`SELECT purge_tenant(${p.tenantId}::uuid)`);

      expect(await prisma.tenant.findUnique({ where: { id: p.tenantId } })).toBeNull();
      const quedan = await prisma.withTenantContext(p.tenantId, (tx) =>
        Promise.all([
          tx.cashMovement.count({ where: { tenantId: p.tenantId } }),
          tx.cashboxSession.count({ where: { tenantId: p.tenantId } }),
        ]),
      );
      expect(quedan).toEqual([0, 0]);
      // Los movimientos del negocio que sigue vivo no se tocan.
      const deA = await prisma.withTenantContext(tenantA, (tx) =>
        tx.cashMovement.count({ where: { tenantId: tenantA } }),
      );
      expect(deA).toBeGreaterThan(0);
    });
  });
});
