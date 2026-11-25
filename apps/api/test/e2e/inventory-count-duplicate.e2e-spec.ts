import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant } from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-BULK-09 — en un inventario físico, cada producto se cuenta en UN renglón.
 *
 * Cada renglón SIN lote se cuadra contra el teórico COMPLETO del producto. Con
 * dos renglones del mismo producto, el confirm sacaba ese teórico dos veces:
 * con existencias, rebotaba por «no hay suficiente existencia»; con un teórico
 * en cero o negativo, dejaba el saldo en `c1 + c2 − teórico`. La previa
 * encadenaba los dos renglones y tampoco lo decía.
 *
 * Además, la hoja del conteo aceptaba una columna «presentacion» cuyo factor
 * nunca se aplicaba: «3» con «Bolsa 10 Kg» se contaba como 3 kilogramos.
 */
describe("Inventario físico: un producto, un renglón (F10-BULK-09)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Un negocio con cuatro productos en un almacén: Jabón con 40, Galletas en
   * −3 (vendidas sin existencias), Suero con dos lotes (20 en A-1 y 9 en B-2)
   * y Queso Oaxaca en kilogramos, con su presentación «Kilogramo» y una
   * «Bolsa 10 Kg».
   */
  async function escenario() {
    const { token, tenantId } = await registerTenant(app, "count-dup");
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const stamp = randomUUID().slice(0, 6).toUpperCase();
      const warehouse = await tx.warehouse.create({
        data: {
          tenantId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central ${stamp}`,
        },
      });
      const [jabon, galletas, suero, queso] = await Promise.all([
        tx.product.create({ data: { tenantId, sku: `JAB-${stamp}`, name: "Jabón" } }),
        tx.product.create({ data: { tenantId, sku: `GAL-${stamp}`, name: "Galletas" } }),
        tx.product.create({
          data: { tenantId, sku: `SUE-${stamp}`, name: "Suero", tracksLots: true },
        }),
        tx.product.create({
          data: { tenantId, sku: `QUE-${stamp}`, name: "Queso Oaxaca", baseUnit: "kg" },
        }),
      ]);
      const [kilogramo] = await Promise.all([
        tx.productPresentation.create({
          data: {
            tenantId,
            productId: queso.id,
            name: "Kilogramo",
            factor: 1,
            allowFractionalInput: true,
            isDefaultSale: true,
          },
        }),
        tx.productPresentation.create({
          data: {
            tenantId,
            productId: queso.id,
            name: "Bolsa 10 Kg",
            factor: 10,
            allowFractionalInput: false,
          },
        }),
      ]);
      const [lotA, lotB] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: suero.id,
            lotCode: "BBB-SEP",
            expiresAt: new Date("2040-09-30"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: suero.id,
            lotCode: "ZZZ-JUL",
            expiresAt: new Date("2040-07-01"),
          },
        }),
      ]);
      await tx.stockLot.createMany({
        data: [
          { tenantId, lotId: lotA.id, warehouseId: warehouse.id, location: "A-1", quantity: 20 },
          { tenantId, lotId: lotB.id, warehouseId: warehouse.id, location: "B-2", quantity: 9 },
        ],
      });
      await tx.stockByWarehouse.createMany({
        data: [
          { tenantId, productId: jabon.id, warehouseId: warehouse.id, quantity: 40 },
          { tenantId, productId: galletas.id, warehouseId: warehouse.id, quantity: -3 },
          { tenantId, productId: suero.id, warehouseId: warehouse.id, quantity: 29 },
          { tenantId, productId: queso.id, warehouseId: warehouse.id, quantity: 2.5 },
        ],
      });
      return {
        warehouseId: warehouse.id,
        jabon,
        galletas,
        suero,
        queso,
        kilogramoId: kilogramo.id,
      };
    });
    return { token, tenantId, ...datos };
  }

  async function nuevoConteo(token: string, warehouseId: string): Promise<string> {
    const creado = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set("Authorization", bearer(token))
      .send({ type: "physical_count", warehouseId })
      .expect(201);
    return (creado.body as { id: string }).id;
  }

  const subir = (token: string, id: string, csv: string) =>
    request(app.getHttpServer())
      .post(`/inventory/documents/${id}/lines/import`)
      .set("Authorization", bearer(token))
      .send({ file: csv, format: "csv", mode: "replace" })
      .expect(200);

  async function conteo(token: string, warehouseId: string, filas: string[]): Promise<string> {
    const id = await nuevoConteo(token, warehouseId);
    await subir(token, id, ["sku,lote,caducidad,ubicacion,contado", ...filas].join("\n"));
    return id;
  }

  type Fila = {
    lineNo: number;
    presentationId: string | null;
    counted: string | null;
    errors: { field: string; code: string; args?: Record<string, unknown> }[];
  };

  async function previa(token: string, id: string): Promise<Fila[]> {
    const res = await request(app.getHttpServer())
      .get(`/inventory/documents/${id}`)
      .set("Authorization", bearer(token))
      .expect(200);
    return (res.body as { rows: Fila[] }).rows;
  }

  const aprobar = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/inventory/documents/${id}/confirm`)
      .set("Authorization", bearer(token))
      .send({});

  async function saldo(tenantId: string, productId: string, warehouseId: string): Promise<string> {
    const fila = await prisma.withTenantContext(tenantId, (tx) =>
      tx.stockByWarehouse.findFirstOrThrow({
        where: { productId, warehouseId },
        select: { quantity: true },
      }),
    );
    return fila.quantity.toString();
  }

  async function movimientosDe(tenantId: string, documentId: string): Promise<number> {
    return prisma.withTenantContext(tenantId, (tx) =>
      tx.stockMovement.count({ where: { documentId } }),
    );
  }

  describe("dos renglones sin lote del mismo producto", () => {
    it("la previa marca el segundo renglón con el nombre del producto", async () => {
      const { token, warehouseId, galletas } = await escenario();
      const id = await conteo(token, warehouseId, [`${galletas.sku},,,,5`, `${galletas.sku},,,,3`]);

      const filas = await previa(token, id);

      expect(filas[0]?.errors).toEqual([]);
      expect(filas[1]?.errors).toEqual([
        {
          field: "counted",
          code: "inventory.count_duplicate_product",
          args: { lineNo: 1, product: "Galletas" },
        },
      ]);
    });

    /**
     * El saldo malo. Antes de F10-BULK-09 este conteo se confirmaba (201) y
     * dejaba las Galletas en 11 = 5 + 3 − (−3): cada renglón devolvía el
     * negativo a cero por su cuenta y sumaba su contado encima del otro.
     */
    it("con el teórico en −3, el confirm rechaza el documento y el saldo no se mueve", async () => {
      const { token, tenantId, warehouseId, galletas } = await escenario();
      const id = await conteo(token, warehouseId, [`${galletas.sku},,,,5`, `${galletas.sku},,,,3`]);

      const res = await aprobar(token, id).expect(422);

      expect((res.body as { message: string }).message).toBe(
        "Cuenta «Galletas» en un solo renglón. Usa «Contar por presentaciones» para sumar empaques y sueltos.",
      );
      expect(await saldo(tenantId, galletas.id, warehouseId)).toBe("-3");
      expect(await movimientosDe(tenantId, id)).toBe(0);
    });

    /**
     * Con existencias, el confirm sacaba 40 + 40 de un saldo de 40 y
     * rebotaba con «no hay suficiente existencia», que no dice qué corregir.
     */
    it("con el teórico en 40, el rechazo nombra el renglón repetido, no las existencias", async () => {
      const { token, tenantId, warehouseId, jabon } = await escenario();
      const id = await conteo(token, warehouseId, [`${jabon.sku},,,,30`, `${jabon.sku},,,,15`]);

      const res = await aprobar(token, id).expect(422);

      expect((res.body as { message: string }).message).toBe(
        "Cuenta «Jabón» en un solo renglón. Usa «Contar por presentaciones» para sumar empaques y sueltos.",
      );
      expect(await saldo(tenantId, jabon.id, warehouseId)).toBe("40");
    });
  });

  describe("lo que ya funcionaba sigue igual", () => {
    it("un renglón por producto: la previa no marca nada y el saldo queda en lo contado", async () => {
      const { token, tenantId, warehouseId, jabon, galletas } = await escenario();
      const id = await conteo(token, warehouseId, [`${jabon.sku},,,,35`, `${galletas.sku},,,,12`]);

      const filas = await previa(token, id);
      expect(filas.map((f) => f.errors)).toEqual([[], []]);

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, jabon.id, warehouseId)).toBe("35");
      expect(await saldo(tenantId, galletas.id, warehouseId)).toBe("12");
    });

    it("con lotes, dos filas del mismo producto en lotes distintos se cuentan cada una", async () => {
      const { token, tenantId, warehouseId, suero } = await escenario();
      const id = await conteo(token, warehouseId, [
        `${suero.sku},BBB-SEP,2040-09-30,A-1,18`,
        `${suero.sku},ZZZ-JUL,2040-07-01,B-2,9`,
      ]);

      const filas = await previa(token, id);
      expect(filas.map((f) => f.errors)).toEqual([[], []]);

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, suero.id, warehouseId)).toBe("27");
    });

    it("con lotes, la fila que repite lote y ubicación conserva su mensaje", async () => {
      const { token, tenantId, warehouseId, suero } = await escenario();
      const id = await conteo(token, warehouseId, [
        `${suero.sku},BBB-SEP,2040-09-30,A-1,20`,
        `${suero.sku},BBB-SEP,2040-09-30,A-1,21`,
      ]);

      const filas = await previa(token, id);
      expect(filas[0]?.errors).toEqual([]);
      expect(filas[1]?.errors).toEqual([
        { field: "lotCode", code: "inventory.count_duplicate_row", args: { lineNo: 1 } },
      ]);

      const res = await aprobar(token, id).expect(422);
      expect((res.body as { message: string }).message).toBe(
        "Esta fila repite el lote y la ubicación de la fila 1: deja una sola.",
      );
      expect(await saldo(tenantId, suero.id, warehouseId)).toBe("29");
    });
  });

  /**
   * Lo que encontró el verificador (2026-11-25): en un producto con lotes, dos
   * filas sin lote ya decían «falta indicar el lote»; la regla nueva les sumaba
   * «Cuenta … en un solo renglón», que sugiere otro arreglo. Se conserva el
   * mensaje de siempre.
   */
  it("con lotes, las filas sin lote solo dicen que falta el lote, como antes", async () => {
    const { token, warehouseId, suero } = await escenario();
    const id = await conteo(token, warehouseId, [
      `${suero.sku},BBB-SEP,2040-09-30,A-1,18`,
      `${suero.sku},,,,5`,
      `${suero.sku},,,,6`,
    ]);

    const filas = await previa(token, id);

    expect(filas.map((f) => f.errors.map((e) => e.code))).toEqual([
      [],
      ["inventory.lot_required"],
      ["inventory.lot_required"],
    ]);
  });

  describe("la presentación en la hoja del conteo", () => {
    const encabezado = "sku,presentacion,lote,caducidad,ubicacion,contado";

    it("una presentación de empaque se marca en su fila y la línea queda sin contado", async () => {
      const { token, warehouseId, queso } = await escenario();
      const id = await nuevoConteo(token, warehouseId);

      const res = await subir(token, id, [encabezado, `${queso.sku},Bolsa 10 Kg,,,,3`].join("\n"));
      const body = res.body as {
        withErrors: number;
        rows: { error: string | null; errorArgs?: Record<string, string> }[];
      };

      expect(body.withErrors).toBe(1);
      expect(body.rows[0]?.error).toBe("inventory.count_presentation_not_base");
      expect(body.rows[0]?.errorArgs).toEqual({ unit: "kilogramos" });

      // Ni el 3 ni la bolsa entran: «3 bolsas» contadas como 3 kilogramos era
      // justo el saldo equivocado. La fila espera su contado en kilogramos.
      const filas = await previa(token, id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.presentationId).toBeNull();
      expect(filas[0]?.counted).toBeNull();
      expect(filas[0]?.errors.map((e) => e.code)).toEqual(["inventory.count_required"]);
    });

    it("la presentación de la unidad base o vacía sigue funcionando", async () => {
      const { token, tenantId, warehouseId, queso, jabon, kilogramoId } = await escenario();
      const id = await nuevoConteo(token, warehouseId);

      const res = await subir(
        token,
        id,
        [encabezado, `${queso.sku},Kilogramo,,,,3.1`, `${jabon.sku},,,,,40`].join("\n"),
      );
      const body = res.body as { withErrors: number; rows: { error: string | null }[] };
      expect(body.withErrors).toBe(0);

      const filas = await previa(token, id);
      expect(filas.map((f) => [f.presentationId, f.counted, f.errors])).toEqual([
        [kilogramoId, "3.1", []],
        [null, "40", []],
      ]);

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, queso.id, warehouseId)).toBe("3.1");
      expect(await saldo(tenantId, jabon.id, warehouseId)).toBe("40");
    });
  });
});
