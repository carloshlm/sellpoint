import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import type { Env } from "../../config/env.schema";
import { Argon2Hasher } from "../../infrastructure/crypto/argon2.hasher";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { AuthorizationCodeService } from "./authorization-code.service";
import { CashMovementsService } from "./cash-movements.service";
import { CashboxService } from "./cashbox.service";
import type { CreateCashMovementDto } from "./dto/cash-movement.dto";

/**
 * Integration (Postgres y Redis reales) — F10-CASHMOV-02: registrar y anular
 * una entrada o un retiro de efectivo en el turno.
 *
 * Lo que fija:
 *  - el movimiento va al turno ABIERTO de quien lo registra, y nadie anula el
 *    de otro cajero;
 *  - un retiro pide el código de autorización del negocio, si lo tiene; el
 *    código es el del descuento y comparte su cuenta de intentos en Redis;
 *  - un retiro, o la anulación de una entrada, no puede dejar el esperado
 *    debajo de cero;
 *  - anular deja la fila y su rastro en `audit_logs`; nunca se borra;
 *  - un movimiento y un cierre al mismo tiempo: o entra antes y cuenta, o
 *    rebota. Lo ordena el `FOR UPDATE` sobre la fila del turno.
 */
describe("CashMovementsService (F10-CASHMOV-02)", () => {
  let prisma: PrismaService;
  let redis: Redis;
  let cashbox: CashboxService;
  let service: CashMovementsService;
  const hasher = new Argon2Hasher();
  const TODO = { warehouseIds: "all" as const };
  const META = { ip: "127.0.0.1", userAgent: "jest" };
  const stamp = Date.now();

  /** Un negocio en CDMX con su sucursal; con `codigo`, ya trae el código de autorización. */
  async function negocioNuevo(codigo?: string) {
    const tenantId = (
      await prisma.tenant.create({
        data: {
          name: `CashMovSvc ${stamp} ${randomUUID().slice(0, 6)}`,
          timezone: "America/Mexico_City",
          ...(codigo !== undefined && {
            discountCodeHash: await hasher.hash(codigo),
            discountCodeSetAt: new Date(),
          }),
        },
      })
    ).id;
    const almacenId = (
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({ data: { tenantId, code: "CEN", name: "Central" } }),
      )
    ).id;
    return { tenantId, almacenId };
  }

  /** Un cajero con su turno abierto: el fondo y las ventas en efectivo que se pidan. */
  async function cajeroConTurno(
    negocio: { tenantId: string; almacenId: string },
    opciones: { fondo?: number; ventasCash?: string[] } = {},
  ) {
    const { tenantId, almacenId } = negocio;
    const usuario = await prisma.withTenantContext(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId,
          email: `cajero-${randomUUID()}@example.com`,
          firstName: "Luis",
          lastName: "Cajero",
        },
      }),
    );
    const cajero: AuthUser = {
      userId: usuario.id,
      tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    };
    const turno = await cashbox.open(cajero, TODO, {
      warehouseId: almacenId,
      ...(opciones.fondo !== undefined && { openingCash: opciones.fondo }),
    });
    for (const total of opciones.ventasCash ?? []) {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.sale.create({
          data: {
            tenantId,
            folio: `VTA-${randomUUID().slice(0, 12)}`,
            warehouseId: almacenId,
            cashboxSessionId: turno.id,
            paymentMethod: "cash",
            subtotal: total,
            total,
            createdBy: usuario.id,
          },
        }),
      );
    }
    return { cajero, turno };
  }

  const retiro = (extra: Partial<CreateCashMovementDto> = {}): CreateCashMovementDto => ({
    type: "out",
    reason: "safe",
    amount: 100,
    ...extra,
  });
  const entrada = (extra: Partial<CreateCashMovementDto> = {}): CreateCashMovementDto => ({
    type: "in",
    reason: "change_fund",
    amount: 100,
    ...extra,
  });

  /** Los intentos fallidos del código que lleva Redis: la MISMA llave del descuento. */
  const intentos = async (cajero: AuthUser) =>
    Number((await redis.get(`pos:discount-attempts:${cajero.tenantId}:${cajero.userId}`)) ?? 0);

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    redis = new Redis(process.env.REDIS_URL as string);
    cashbox = new CashboxService(prisma);
    service = new CashMovementsService(
      prisma,
      cashbox,
      new AuthorizationCodeService(hasher, redis),
      new AuditService(),
    );
  });

  afterAll(async () => {
    await redis.quit();
    await prisma.onModuleDestroy();
  });

  describe("en el turno propio", () => {
    it("el cajero registra en SU turno abierto, y la fila tiene la forma del contrato", async () => {
      const negocio = await negocioNuevo();
      const { cajero, turno } = await cajeroConTurno(negocio, { fondo: 500 });

      const fila = await service.create(cajero, retiro({ amount: 200.5 }), META);

      expect(Object.keys(fila)).toEqual([
        "id",
        "type",
        "reason",
        "amount",
        "note",
        "authorized",
        "status",
        "createdAt",
        "createdBy",
        "canceledAt",
        "canceledBy",
        "cancelReason",
      ]);
      expect(fila).toMatchObject({
        type: "out",
        reason: "safe",
        amount: "200.5",
        note: null,
        authorized: false,
        status: "active",
        createdBy: { id: cajero.userId, name: "Luis Cajero" },
        canceledAt: null,
        canceledBy: null,
        cancelReason: null,
      });
      expect(new Date(fila.createdAt).toISOString()).toBe(fila.createdAt);
      const guardado = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.cashMovement.findUniqueOrThrow({ where: { id: fila.id } }),
      );
      expect(guardado.cashboxSessionId).toBe(turno.id);
    });

    it("el de otro cajero va a SU turno, y uno no anula el movimiento del otro", async () => {
      const negocio = await negocioNuevo();
      const ana = await cajeroConTurno(negocio, { fondo: 500 });
      const beto = await cajeroConTurno(negocio, { fondo: 500 });

      const deAna = await service.create(ana.cajero, retiro(), META);
      const deBeto = await service.create(beto.cajero, retiro({ amount: 50 }), META);

      expect((await service.list(ana.cajero)).movements.map((m) => m.id)).toEqual([deAna.id]);
      expect((await service.list(beto.cajero)).movements.map((m) => m.id)).toEqual([deBeto.id]);
      await expect(
        service.cancel(beto.cajero, deAna.id, { reason: "No es mío" }, META),
      ).rejects.toMatchObject({ status: 403, response: { message: "pos.cash_movement_not_own" } });
    });

    it("sin turno abierto no se registra ni se anula, y la lista viene vacía", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      const fila = await service.create(cajero, entrada(), META);
      await cashbox.close(cajero, { declaredCash: 600 });

      await expect(service.create(cajero, entrada(), META)).rejects.toMatchObject({
        status: 409,
        response: { message: "pos.no_session" },
      });
      await expect(
        service.cancel(cajero, fila.id, { reason: "Tarde" }, META),
      ).rejects.toMatchObject({ status: 409, response: { message: "pos.no_session" } });
      expect(await service.list(cajero)).toEqual({ movements: [] });
    });

    it("el movimiento de un turno ya cerrado no se anula, aunque haya otro turno abierto", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      const viejo = await service.create(cajero, retiro(), META);
      await cashbox.close(cajero, { declaredCash: 400 });
      await cashbox.open(cajero, TODO, { warehouseId: negocio.almacenId });

      await expect(
        service.cancel(cajero, viejo.id, { reason: "Tarde" }, META),
      ).rejects.toMatchObject({
        status: 409,
        response: { message: "pos.cash_movement_session_closed" },
      });
    });

    it("un movimiento que no existe es 404", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio);
      await expect(
        service.cancel(cajero, randomUUID(), { reason: "Nada" }, META),
      ).rejects.toMatchObject({
        status: 404,
        response: { message: "pos.cash_movement_not_found" },
      });
    });

    it("un motivo cruzado no se guarda: la base lo rebota aunque el DTO se saltara", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });

      await expect(service.create(cajero, retiro({ reason: "change_fund" }), META)).rejects.toThrow(
        /cash_movements_reason_matches_type/,
      );
      expect((await service.list(cajero)).movements).toEqual([]);
    });

    it("la lista va del más nuevo al más viejo, con los anulados y quién los anuló", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 1000 });
      const primero = await service.create(cajero, entrada({ amount: 10 }), META);
      const segundo = await service.create(cajero, retiro({ amount: 20 }), META);
      await service.cancel(cajero, primero.id, { reason: "Duplicado" }, META);
      const tercero = await service.create(
        cajero,
        retiro({ reason: "other", note: "Garrafón", amount: 30 }),
        META,
      );

      const { movements } = await service.list(cajero);

      expect(movements.map((m) => m.id)).toEqual([tercero.id, segundo.id, primero.id]);
      expect(movements[2]).toMatchObject({
        status: "canceled",
        canceledBy: { id: cajero.userId, name: "Luis Cajero" },
        cancelReason: "Duplicado",
      });
      expect(movements[0]).toMatchObject({ reason: "other", note: "Garrafón", amount: "30" });
    });
  });

  describe("el código de autorización", () => {
    it("un retiro sin código rebota cuando el negocio lo tiene, y no se guarda", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });

      await expect(service.create(cajero, retiro(), META)).rejects.toMatchObject({
        status: 422,
        response: { message: "pos.cash_movement_code_required" },
      });
      expect((await service.list(cajero)).movements).toEqual([]);
      expect(await intentos(cajero)).toBe(0);
    });

    it("con el código correcto el retiro pasa marcado como autorizado", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });

      const fila = await service.create(cajero, retiro({ code: "1234" }), META);

      expect(fila).toMatchObject({ authorized: true, status: "active" });
    });

    it("sin código en el negocio el retiro pasa sin autorización, y queda quién lo hizo", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });

      const fila = await service.create(cajero, retiro({ code: "1234" }), META);

      expect(fila).toMatchObject({ authorized: false, createdBy: { id: cajero.userId } });
    });

    it("una entrada no pide código ni lo cuenta: queda sin autorización aunque lo mande", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio);

      const sinCodigo = await service.create(cajero, entrada(), META);
      const conCodigoMalo = await service.create(cajero, entrada({ code: "9999" }), META);

      expect([sinCodigo.authorized, conCodigoMalo.authorized]).toEqual([false, false]);
      expect(await intentos(cajero)).toBe(0);
    });

    it("un código equivocado suma un intento en la llave del descuento; con el tope, bloquea", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });

      for (let i = 1; i <= 5; i += 1) {
        await expect(service.create(cajero, retiro({ code: "9999" }), META)).rejects.toMatchObject({
          status: 403,
          response: { message: "pos.discount_code_invalid" },
        });
        expect(await intentos(cajero)).toBe(i);
      }
      // El sexto, aunque sea el bueno, choca con el candado: es el mismo del descuento.
      await expect(service.create(cajero, retiro({ code: "1234" }), META)).rejects.toMatchObject({
        status: 429,
        response: { message: "pos.discount_code_locked" },
      });
      expect((await service.list(cajero)).movements).toEqual([]);
    });

    it("el acierto borra la cuenta de intentos, como en el descuento", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      await expect(service.create(cajero, retiro({ code: "0000" }), META)).rejects.toMatchObject({
        status: 403,
      });
      expect(await intentos(cajero)).toBe(1);

      await service.create(cajero, retiro({ code: "1234" }), META);

      expect(await intentos(cajero)).toBe(0);
    });

    it("anular una ENTRADA pide el código; anular un RETIRO nunca", async () => {
      const negocio = await negocioNuevo("1234");
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      const laEntrada = await service.create(cajero, entrada(), META);
      const elRetiro = await service.create(cajero, retiro({ code: "1234" }), META);

      await expect(
        service.cancel(cajero, laEntrada.id, { reason: "Duplicada" }, META),
      ).rejects.toMatchObject({
        status: 422,
        response: { message: "pos.cash_movement_code_required" },
      });
      await expect(
        service.cancel(cajero, laEntrada.id, { reason: "Duplicada", code: "9999" }, META),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await service.cancel(cajero, laEntrada.id, { reason: "Duplicada", code: "1234" }, META),
      ).toMatchObject({ status: "canceled" });
      expect(
        await service.cancel(cajero, elRetiro.id, { reason: "Se equivocó" }, META),
      ).toMatchObject({ status: "canceled" });
    });
  });

  describe("el cajón nunca queda debajo de cero", () => {
    it("un retiro mayor que el esperado rebota y dice cuánto hay; uno que lo deja en cero pasa", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 300, ventasCash: ["200.00"] });

      await expect(service.create(cajero, retiro({ amount: 500.01 }), META)).rejects.toMatchObject({
        status: 422,
        response: { message: "pos.cash_out_exceeds_drawer", args: { available: "$500.00" } },
      });
      expect((await service.list(cajero)).movements).toEqual([]);

      await service.create(cajero, retiro({ amount: 500 }), META);
      expect((await cashbox.totals(cajero, await turnoDe(cajero))).expectedCash).toBe("0");
    });

    it("anular una entrada que dejaría el esperado debajo de cero rebota", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio);
      const laEntrada = await service.create(cajero, entrada({ amount: 300 }), META);
      const elRetiro = await service.create(cajero, retiro({ amount: 300 }), META);

      await expect(
        service.cancel(cajero, laEntrada.id, { reason: "Duplicada" }, META),
      ).rejects.toMatchObject({
        status: 422,
        response: { message: "pos.cash_out_exceeds_drawer", args: { available: "$0.00" } },
      });

      // Primero se anula el retiro (sube el esperado) y entonces la entrada sí sale.
      await service.cancel(cajero, elRetiro.id, { reason: "No se hizo" }, META);
      await service.cancel(cajero, laEntrada.id, { reason: "Duplicada" }, META);
      expect((await cashbox.totals(cajero, await turnoDe(cajero))).expectedCash).toBe("0");
    });
  });

  describe("anular", () => {
    it("deja la fila con sus sellos, no la borra, y el alta y la anulación quedan en la bitácora", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      const fila = await service.create(cajero, retiro({ amount: 80 }), META);

      const anulada = await service.cancel(cajero, fila.id, { reason: "Se capturó mal" }, META);

      expect(anulada).toMatchObject({
        id: fila.id,
        status: "canceled",
        canceledBy: { id: cajero.userId, name: "Luis Cajero" },
        cancelReason: "Se capturó mal",
      });
      expect(anulada.canceledAt).not.toBeNull();
      const { guardada, bitacora } = await prisma.withTenantContext(
        negocio.tenantId,
        async (tx) => ({
          guardada: await tx.cashMovement.findUnique({ where: { id: fila.id } }),
          bitacora: await tx.auditLog.findMany({
            where: { tenantId: negocio.tenantId, resourceId: fila.id },
            orderBy: { createdAt: "asc" },
          }),
        }),
      );
      expect(guardada).toMatchObject({ status: "canceled", cancelReason: "Se capturó mal" });
      expect(bitacora.map((b) => [b.action, b.resourceType, b.userId, b.ip])).toEqual([
        ["pos.cash_movement.create", "cash_movement", cajero.userId, "127.0.0.1"],
        ["pos.cash_movement.cancel", "cash_movement", cajero.userId, "127.0.0.1"],
      ]);
      expect(bitacora[0]?.after).toMatchObject({ type: "out", reason: "safe", amount: "80" });
      expect(bitacora[1]?.after).toMatchObject({ status: "canceled", reason: "Se capturó mal" });
      // Y anulado no cuenta en el arqueo.
      expect((await cashbox.totals(cajero, await turnoDe(cajero))).cashOut).toBe("0");
    });

    it("anular dos veces rebota: ya está anulado", async () => {
      const negocio = await negocioNuevo();
      const { cajero } = await cajeroConTurno(negocio, { fondo: 500 });
      const fila = await service.create(cajero, retiro(), META);
      await service.cancel(cajero, fila.id, { reason: "Una vez" }, META);

      await expect(
        service.cancel(cajero, fila.id, { reason: "Dos veces" }, META),
      ).rejects.toMatchObject({
        status: 409,
        response: { message: "pos.cash_movement_already_canceled" },
      });
    });
  });

  /**
   * Un movimiento y un cierre al mismo tiempo. Una transacción aparte toma la
   * fila del turno con `FOR UPDATE` y la suelta cuando los dos ya esperan en
   * fila: el primero en formarse pasa primero. Postgres atiende la espera de
   * una fila en orden de llegada.
   */
  describe("concurrencia con el cierre", () => {
    /** Toma la fila del turno hasta que se llame a `soltar`. */
    async function tomarTurno(tenantId: string, turnoId: string) {
      let soltar = () => {};
      const suelta = new Promise<void>((resolve) => {
        soltar = resolve;
      });
      let pid = 0;
      const tomada = new Promise<void>((avisar) => {
        void prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, true)`;
            await tx.$queryRaw`SELECT id FROM cashbox_sessions WHERE id = ${turnoId}::uuid FOR UPDATE`;
            const [fila] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pid = fila?.pid ?? 0;
            avisar();
            await suelta;
          },
          { timeout: 20_000 },
        );
      });
      await tomada;
      return { pid, soltar };
    }

    /** Espera hasta que haya `n` conexiones esperando detrás de `pids` (directo o en fila). */
    async function esperarEnFila(pids: number[], n: number): Promise<number[]> {
      for (let vuelta = 0; vuelta < 200; vuelta += 1) {
        const filas = await prisma.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
           WHERE pid <> ALL(${pids}::int[])
             AND pg_blocking_pids(pid) && ${pids}::int[]`;
        if (filas.length >= n) return filas.map((f) => f.pid);
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("nadie se formó detrás del turno tomado");
    }

    it("si el movimiento llega primero, el cierre lo cuenta", async () => {
      const negocio = await negocioNuevo();
      const { cajero, turno } = await cajeroConTurno(negocio, { fondo: 1000 });
      const bloqueo = await tomarTurno(negocio.tenantId, turno.id);

      const movimiento = service.create(cajero, retiro({ amount: 400 }), META);
      const [primero] = await esperarEnFila([bloqueo.pid], 1);
      const cierre = cashbox.close(cajero, { declaredCash: 600 });
      await esperarEnFila([bloqueo.pid, primero as number], 1);
      bloqueo.soltar();

      const [fila, cerrado] = await Promise.all([movimiento, cierre]);
      expect(fila.status).toBe("active");
      expect(cerrado).toMatchObject({ cashOut: "400", expectedCash: "600" });
      expect(cerrado.session.cashDifference?.toString()).toBe("0");
    });

    it("si el cierre llega primero, el movimiento rebota y no queda nada", async () => {
      const negocio = await negocioNuevo();
      const { cajero, turno } = await cajeroConTurno(negocio, { fondo: 1000 });
      const bloqueo = await tomarTurno(negocio.tenantId, turno.id);

      const cierre = cashbox.close(cajero, { declaredCash: 1000 });
      const [primero] = await esperarEnFila([bloqueo.pid], 1);
      const movimiento = service.create(cajero, retiro({ amount: 400 }), META);
      await esperarEnFila([bloqueo.pid, primero as number], 1);
      bloqueo.soltar();

      const [cerrado, intento] = await Promise.allSettled([cierre, movimiento]);
      expect(cerrado.status).toBe("fulfilled");
      expect(cerrado.status === "fulfilled" && cerrado.value).toMatchObject({
        cashOut: "0",
        expectedCash: "1000",
      });
      expect(intento.status === "rejected" && intento.reason).toMatchObject({
        status: 409,
        response: { message: "pos.no_session" },
      });
      const quedan = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.cashMovement.count({ where: { cashboxSessionId: turno.id } }),
      );
      expect(quedan).toBe(0);
    });
  });

  /** El turno abierto del cajero, como lo lee el arqueo. */
  async function turnoDe(cajero: AuthUser) {
    const turno = await cashbox.current(cajero);
    if (turno === null) throw new Error("el cajero no tiene turno abierto");
    return turno;
  }
});
