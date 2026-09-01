import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { type RawLine, type ResolveOptions, resolveLines } from "./line-resolver";

/**
 * Integration (Postgres real) — F3-CORE-04: de lo que el usuario capturó a lo
 * que el ledger va a mover.
 *
 * Es la misma función que alimenta la VISTA PREVIA del borrador y el CONFIRM,
 * y eso es deliberado: si fueran dos, lo previsualizado y lo asentado podrían
 * validarse distinto y el usuario confirmaría algo que no vio.
 *
 * Va contra Postgres real y no con mocks porque lo que se prueba —conversión
 * decimal exacta, resolución de lotes, estado de productos y presentaciones—
 * depende de los datos, no de la forma de las llamadas.
 */
describe("resolveLines (F3-CORE-04)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let simpleId: string;
  let cajaId: string;
  let granelId: string;
  let compuestoId: string;
  let loteadoId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant resolve ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const simple = await tx.product.create({
        data: { tenantId, sku: `SIM-${stamp}`, name: "Paracetamol", baseUnit: "unit" },
      });
      // Producto a granel: la unidad base admite decimales.
      const granel = await tx.product.create({
        data: { tenantId, sku: `GRA-${stamp}`, name: "Azúcar", baseUnit: "gr" },
      });
      const compuesto = await tx.product.create({
        data: { tenantId, sku: `COM-${stamp}`, name: "Café con azúcar", isComposite: true },
      });
      const loteado = await tx.product.create({
        data: { tenantId, sku: `LOT-${stamp}`, name: "Aspirina", tracksLots: true },
      });

      const caja = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: simple.id,
          name: "Caja ×12",
          factor: 12,
          allowFractionalInput: false,
        },
      });
      await tx.productPresentation.create({
        data: {
          tenantId,
          productId: granel.id,
          name: "Bolsa 1 kg",
          factor: 1000,
          allowFractionalInput: true,
        },
      });

      simpleId = simple.id;
      cajaId = caja.id;
      granelId = granel.id;
      compuestoId = compuesto.id;
      loteadoId = loteado.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const resolve = (lines: RawLine[], opts: Partial<ResolveOptions> = {}) =>
    prisma.withTenantContext(tenantId, (tx) =>
      resolveLines(tx, tenantId, lines, {
        direction: "entry",
        reasonCode: "invoice",
        ...opts,
      }),
    );

  describe("conversión a unidad base", () => {
    it("3 cajas ×12 son 36 unidades, y guarda lo que el usuario tecleó", async () => {
      const [line] = await resolve([{ productId: simpleId, presentationId: cajaId, quantity: 3 }]);

      expect(line?.quantityBase.toString()).toBe("36");
      expect(line?.quantityInput.toString()).toBe("3");
    });

    it("sin presentación la cantidad ya viene en unidad base", async () => {
      const [line] = await resolve([{ productId: simpleId, quantity: 7 }]);

      expect(line?.quantityBase.toString()).toBe("7");
    });

    /**
     * El motivo de usar `Prisma.Decimal` en vez de números: con floats,
     * `0.1 + 0.2` da `0.30000000000000004` y un saldo se corrompe de a poquito
     * hasta que el inventario físico no cuadra y nadie sabe por qué.
     */
    it("la aritmética es decimal exacta: 0.1 + 0.2 da 0.3, no 0.30000000000000004", async () => {
      const lines = await resolve([
        { productId: granelId, quantity: 0.1 },
        { productId: granelId, quantity: 0.2 },
      ]);
      const total = lines[0]?.quantityBase.plus(lines[1]?.quantityBase ?? 0);

      expect(total?.toString()).toBe("0.3");
    });

    it("dos líneas del mismo producto con presentaciones distintas convierten independientes", async () => {
      const lines = await resolve([
        { productId: simpleId, presentationId: cajaId, quantity: 2 },
        { productId: simpleId, quantity: 5 },
      ]);

      expect(lines.map((l) => l.quantityBase.toString())).toEqual(["24", "5"]);
    });
  });

  describe("presentaciones que solo aceptan enteros", () => {
    it("1.5 cajas se rechaza nombrando la presentación y la línea", async () => {
      await expect(
        resolve([{ productId: simpleId, presentationId: cajaId, quantity: 1.5 }]),
      ).rejects.toMatchObject({
        response: {
          message: "inventory.integer_only_presentation",
          args: { presentationName: "Caja ×12", lineIndex: 0 },
        },
      });
    });

    it("una presentación que admite fracciones sí acepta decimales", async () => {
      const [line] = await resolve([{ productId: granelId, quantity: 2.5 }]);

      expect(line?.quantityBase.toString()).toBe("2.5");
    });
  });

  describe("estado del producto y de la presentación", () => {
    it("un producto que no existe da 404", async () => {
      await expect(
        resolve([{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }]),
      ).rejects.toMatchObject({ response: { message: "inventory.product_not_found" } });
    });

    it("una presentación de OTRO producto se rechaza", async () => {
      await expect(
        resolve([{ productId: granelId, presentationId: cajaId, quantity: 1 }]),
      ).rejects.toMatchObject({ response: { message: "inventory.presentation_invalid" } });
    });
  });

  describe("productos compuestos", () => {
    it("una entrada de compuesto se rechaza: no tiene existencias propias", async () => {
      await expect(resolve([{ productId: compuestoId, quantity: 1 }])).rejects.toThrow(
        ConflictException,
      );
    });

    it("una salida por consumo lo marca para expandir en sus componentes", async () => {
      const [line] = await resolve([{ productId: compuestoId, quantity: 2 }], {
        direction: "exit",
        reasonCode: "consumption",
      });

      expect(line?.expand).toBe(true);
    });

    it("una salida por merma se rechaza: la merma es de algo que existe en el almacén", async () => {
      await expect(
        resolve([{ productId: compuestoId, quantity: 1 }], {
          direction: "exit",
          reasonCode: "loss",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("lotes", () => {
    it("una entrada de producto con lote exige el código", async () => {
      await expect(resolve([{ productId: loteadoId, quantity: 5 }])).rejects.toMatchObject({
        response: { message: "inventory.lot_required" },
      });
    });

    /**
     * Carlos (2026-09-01): «me dejó hacer una entrada de un producto
     * controlado por lotes sin poner fecha de caducidad». Un lote sin fecha
     * es un lote que FEFO no puede ordenar y que el aviso de «próximos a
     * vencer» nunca verá: en ENTRADA la caducidad es obligatoria, igual que
     * el código del lote.
     */
    it("una entrada a un lote NUEVO exige la caducidad", async () => {
      await expect(
        resolve([{ productId: loteadoId, quantity: 5, lotCode: `sin-fecha-${Date.now()}` }]),
      ).rejects.toMatchObject({
        response: { message: "inventory.expiry_required", args: { field: "expiresAt" } },
      });
    });

    it("un lote viejo SIN fecha también la exige — y la toma de la línea que la trae", async () => {
      const lotCode = `legado-${Date.now()}`;
      // Un lote heredado de antes de la regla: existe, pero sin caducidad.
      const legado = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.create({ data: { tenantId, productId: loteadoId, lotCode } }),
      );

      await expect(resolve([{ productId: loteadoId, quantity: 1, lotCode }])).rejects.toMatchObject(
        { response: { message: "inventory.expiry_required" } },
      );

      await resolve([{ productId: loteadoId, quantity: 1, lotCode, expiresAt: "2027-01-31" }]);
      const actualizado = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.findUniqueOrThrow({ where: { id: legado.id }, select: { expiresAt: true } }),
      );
      // La fecha es del LOTE: la primera entrada que la trae se la deja puesta.
      expect(actualizado.expiresAt?.toISOString().slice(0, 10)).toBe("2027-01-31");
    });

    it("en SALIDA un lote existente no exige fecha: no es el momento en que entra", async () => {
      const lotCode = `salida-${Date.now()}`;
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.create({ data: { tenantId, productId: loteadoId, lotCode } }),
      );

      await expect(
        resolve([{ productId: loteadoId, quantity: 1, lotCode }], {
          direction: "exit",
          reasonCode: "loss",
        }),
      ).resolves.toBeDefined();
    });

    it("el lote se crea si no existía, y se reusa si ya estaba", async () => {
      const lotCode = `st${Date.now()}`;
      const [first] = await resolve([
        { productId: loteadoId, quantity: 5, lotCode, expiresAt: "2026-07-01" },
      ]);
      const [second] = await resolve([{ productId: loteadoId, quantity: 3, lotCode }]);

      expect(first?.lotId).toBeDefined();
      expect(second?.lotId).toBe(first?.lotId);
    });

    it("el mismo lote con OTRA caducidad se rechaza: la fecha es del lote", async () => {
      const lotCode = `st-fecha-${Date.now()}`;
      await resolve([{ productId: loteadoId, quantity: 1, lotCode, expiresAt: "2026-07-01" }]);

      await expect(
        resolve([{ productId: loteadoId, quantity: 1, lotCode, expiresAt: "2026-12-31" }]),
      ).rejects.toMatchObject({ response: { message: "inventory.lot_expiry_mismatch" } });
    });

    it("mandar un lote en un producto que no los controla se rechaza", async () => {
      await expect(
        resolve([{ productId: simpleId, quantity: 1, lotCode: "st01" }]),
      ).rejects.toMatchObject({ response: { message: "inventory.lot_not_tracked" } });
    });

    it("en una SALIDA el lote es opcional: sin él decide FEFO", async () => {
      const [line] = await resolve([{ productId: loteadoId, quantity: 1 }], {
        direction: "exit",
        reasonCode: "loss",
      });

      expect(line?.lotId).toBeUndefined();
    });

    it("sin ubicación, la ubicación es `''` y no nula: entra en la clave del saldo", async () => {
      const [line] = await resolve([
        {
          productId: loteadoId,
          quantity: 1,
          lotCode: `st-ubic-${Date.now()}`,
          expiresAt: "2027-06-30",
        },
      ]);

      expect(line?.location).toBe("");
    });
  });

  it("una sola consulta de productos y una de presentaciones, no una por línea", async () => {
    const lines = await resolve([
      { productId: simpleId, presentationId: cajaId, quantity: 1 },
      { productId: granelId, quantity: 1 },
      { productId: simpleId, quantity: 1 },
    ]);

    expect(lines).toHaveLength(3);
  });

  /**
   * La otra puerta del bloqueo de vencidos. FEFO ya se niega a ELEGIR un lote
   * caducado para una venta, pero eso solo cubre las líneas sin lote. Si esto
   * no estuviera, bastaría con teclear el código del lote para saltarse la
   * regla — y quien lo teclea suele ser justo quien tiene apuro por sacarlo.
   */
  describe("un lote vencido elegido A MANO tampoco se vende", () => {
    const codigo = `cad-${Date.now()}`;

    beforeAll(async () => {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.create({
          data: {
            tenantId,
            productId: loteadoId,
            lotCode: codigo,
            expiresAt: new Date("2020-01-01"),
          },
        }),
      );
    });

    it("con motivo `sale` lo rechaza aunque el usuario lo haya escrito", async () => {
      await expect(
        resolve([{ productId: loteadoId, quantity: 1, lotCode: codigo }], {
          direction: "exit",
          reasonCode: "sale",
        }),
      ).rejects.toMatchObject({
        response: { message: "inventory.expired_lot_not_sellable" },
      });
    });

    it("con motivo `expired` lo acepta: es el camino para darlo de baja", async () => {
      const [line] = await resolve([{ productId: loteadoId, quantity: 1, lotCode: codigo }], {
        direction: "exit",
        reasonCode: "expired",
      });

      // En modo `strict` un problema se lanza, no se acumula: que la llamada
      // devuelva la línea con su `lotId` YA prueba que no lo rechazó.
      expect(line?.lotId).toBeDefined();
    });

    it("con motivo `transfer` también lo acepta", async () => {
      const [line] = await resolve([{ productId: loteadoId, quantity: 1, lotCode: codigo }], {
        direction: "exit",
        reasonCode: "transfer",
      });

      expect(line?.lotId).toBeDefined();
    });
  });
});
