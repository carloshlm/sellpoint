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
 * F10-BULK-11 — el desglose de un renglón del inventario físico se guarda con
 * él, y el contado SALE de ese desglose.
 *
 * El conteo sigue en unidad base (decisión del 2026-08-31). El desglose es la
 * cuenta que lo explica: «2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g» son 12.6
 * kilogramos. El API valida cada renglón del desglose y calcula el contado; el
 * que mande el cliente junto con un desglose no gana.
 */
describe("Inventario físico: contar por presentaciones (F10-BULK-11)", () => {
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
   * Un almacén con Queso Oaxaca en kilogramos (2.5 kg), con su «Kilogramo» de
   * siempre, una «Bolsa 1 Kg» y una «Bolsa 10 Kg» que solo admiten enteros, y
   * una «Bolsa vieja» ya desactivada. Jabón en piezas (40), y Suero con «Caja
   * con 12» y dos lotes: 20 en A-1 y 9 en B-2.
   */
  async function escenario() {
    const { token, tenantId } = await registerTenant(app, "count-breakdown");
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const stamp = randomUUID().slice(0, 6).toUpperCase();
      const warehouse = await tx.warehouse.create({
        data: {
          tenantId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central ${stamp}`,
        },
      });
      const [queso, jabon, suero] = await Promise.all([
        tx.product.create({
          data: { tenantId, sku: `QUE-${stamp}`, name: "Queso Oaxaca", baseUnit: "kg" },
        }),
        tx.product.create({ data: { tenantId, sku: `JAB-${stamp}`, name: "Jabón" } }),
        tx.product.create({
          data: { tenantId, sku: `SUE-${stamp}`, name: "Suero", tracksLots: true },
        }),
      ]);
      const presentacion = (
        productId: string,
        name: string,
        factor: number,
        extra: { allowFractionalInput?: boolean; isActive?: boolean } = {},
      ) =>
        tx.productPresentation.create({
          data: {
            tenantId,
            productId,
            name,
            factor,
            allowFractionalInput: extra.allowFractionalInput ?? false,
            isActive: extra.isActive ?? true,
          },
        });
      const kilogramo = await presentacion(queso.id, "Kilogramo", 1, {
        allowFractionalInput: true,
      });
      const bolsa1 = await presentacion(queso.id, "Bolsa 1 Kg", 1);
      const bolsa10 = await presentacion(queso.id, "Bolsa 10 Kg", 10);
      const bolsaVieja = await presentacion(queso.id, "Bolsa vieja", 5, { isActive: false });
      const caja = await presentacion(suero.id, "Caja con 12", 12);
      const [lotA, lotB] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: suero.id,
            lotCode: "AAA-SEP",
            expiresAt: new Date("2040-09-30"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: suero.id,
            lotCode: "BBB-JUL",
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
          { tenantId, productId: queso.id, warehouseId: warehouse.id, quantity: 2.5 },
          { tenantId, productId: jabon.id, warehouseId: warehouse.id, quantity: 40 },
          { tenantId, productId: suero.id, warehouseId: warehouse.id, quantity: 29 },
        ],
      });
      return {
        warehouseId: warehouse.id,
        queso,
        jabon,
        suero,
        kilogramoId: kilogramo.id,
        bolsa1Id: bolsa1.id,
        bolsa10Id: bolsa10.id,
        bolsaViejaId: bolsaVieja.id,
        cajaId: caja.id,
      };
    });
    return { token, tenantId, ...datos };
  }

  type Desglose = { presentationId: string | null; quantity: string; presentationName?: string }[];

  type Fila = {
    id: string;
    lineNo: number;
    lotCode: string | null;
    counted: string | null;
    difference: string | null;
    countBreakdown: Desglose | null;
    errors: { field: string; code: string }[];
  };

  async function conteo(token: string, warehouseId: string, filas: string[]): Promise<string> {
    const creado = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set("Authorization", bearer(token))
      .send({ type: "physical_count", warehouseId })
      .expect(201);
    const id = (creado.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/inventory/documents/${id}/lines/import`)
      .set("Authorization", bearer(token))
      .send({
        file: ["sku,lote,caducidad,ubicacion,contado", ...filas].join("\n"),
        format: "csv",
        mode: "replace",
      })
      .expect(200);
    return id;
  }

  async function detalle(token: string, id: string): Promise<{ status: string; rows: Fila[] }> {
    const res = await request(app.getHttpServer())
      .get(`/inventory/documents/${id}`)
      .set("Authorization", bearer(token))
      .expect(200);
    return res.body as { status: string; rows: Fila[] };
  }

  const corregir = (token: string, id: string, lineId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/inventory/documents/${id}/lines/${lineId}`)
      .set("Authorization", bearer(token))
      .send(body);

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

  /** La única línea del conteo de un solo producto, sin contado todavía. */
  async function lineaDe(token: string, id: string): Promise<Fila> {
    const { rows } = await detalle(token, id);
    expect(rows).toHaveLength(1);
    return rows[0] as Fila;
  }

  describe("el desglose calcula el contado", () => {
    it("2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g: contado 12.6 y el saldo queda en 12.6 al confirmar", async () => {
      const { token, tenantId, warehouseId, queso, bolsa1Id, bolsa10Id } = await escenario();
      const id = await conteo(token, warehouseId, [`${queso.sku},,,,`]);
      const linea = await lineaDe(token, id);

      const res = await corregir(token, id, linea.id, {
        countBreakdown: [
          { presentationId: bolsa1Id, quantity: "2" },
          { presentationId: bolsa10Id, quantity: "1" },
          { presentationId: null, quantity: "0.600" },
        ],
      }).expect(200);

      const guardada = res.body as { counted: string; countBreakdown: Desglose };
      expect(guardada.counted).toBe("12.6");
      expect(guardada.countBreakdown).toEqual([
        { presentationId: bolsa1Id, quantity: "2" },
        { presentationId: bolsa10Id, quantity: "1" },
        { presentationId: null, quantity: "0.6" },
      ]);

      // La previa lo dice con el nombre de cada presentación.
      const previa = await lineaDe(token, id);
      expect(previa.counted).toBe("12.6");
      expect(previa.difference).toBe("10.1");
      expect(previa.errors).toEqual([]);
      expect(previa.countBreakdown).toEqual([
        { presentationId: bolsa1Id, quantity: "2", presentationName: "Bolsa 1 Kg" },
        { presentationId: bolsa10Id, quantity: "1", presentationName: "Bolsa 10 Kg" },
        { presentationId: null, quantity: "0.6", presentationName: null },
      ]);

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, queso.id, warehouseId)).toBe("12.6");

      // El conteo confirmado sigue diciendo cómo se contó.
      const confirmado = await detalle(token, id);
      expect(confirmado.status).toBe("confirmed");
      expect(confirmado.rows[0]?.countBreakdown).toEqual(previa.countBreakdown);
    });

    it("un contado que manda el cliente junto con el desglose no gana", async () => {
      const { token, warehouseId, queso, bolsa10Id } = await escenario();
      const id = await conteo(token, warehouseId, [`${queso.sku},,,,`]);
      const linea = await lineaDe(token, id);

      const res = await corregir(token, id, linea.id, {
        counted: 99,
        countBreakdown: [{ presentationId: bolsa10Id, quantity: "3" }],
      }).expect(200);

      expect((res.body as { counted: string }).counted).toBe("30");
    });

    it("el desglose puede llevar ceros y la presentación base: suma lo que dice", async () => {
      const { token, warehouseId, queso, kilogramoId, bolsa10Id } = await escenario();
      const id = await conteo(token, warehouseId, [`${queso.sku},,,,`]);
      const linea = await lineaDe(token, id);

      const res = await corregir(token, id, linea.id, {
        countBreakdown: [
          { presentationId: bolsa10Id, quantity: "0" },
          { presentationId: kilogramoId, quantity: "1.25" },
        ],
      }).expect(200);

      expect((res.body as { counted: string }).counted).toBe("1.25");
    });

    it("escribir el contado a mano después del desglose lo borra: ya no lo explica", async () => {
      const { token, warehouseId, queso, bolsa10Id } = await escenario();
      const id = await conteo(token, warehouseId, [`${queso.sku},,,,`]);
      const linea = await lineaDe(token, id);
      await corregir(token, id, linea.id, {
        countBreakdown: [{ presentationId: bolsa10Id, quantity: "1" }],
      }).expect(200);

      const res = await corregir(token, id, linea.id, { counted: 4 }).expect(200);

      expect(res.body).toMatchObject({ counted: "4", countBreakdown: null });
      expect((await lineaDe(token, id)).countBreakdown).toBeNull();
    });

    it("con lotes, cada renglón (lote y ubicación) lleva su propio desglose", async () => {
      const { token, tenantId, warehouseId, suero, cajaId } = await escenario();
      const id = await conteo(token, warehouseId, [
        `${suero.sku},AAA-SEP,2040-09-30,A-1,`,
        `${suero.sku},BBB-JUL,2040-07-01,B-2,9`,
      ]);
      const { rows } = await detalle(token, id);
      const loteA = rows.find((r) => r.lotCode === "AAA-SEP") as Fila;

      await corregir(token, id, loteA.id, {
        countBreakdown: [
          { presentationId: cajaId, quantity: "1" },
          { presentationId: null, quantity: "6" },
        ],
      }).expect(200);

      const previa = await detalle(token, id);
      expect(previa.rows.map((r) => [r.lotCode, r.counted, r.countBreakdown?.length ?? 0])).toEqual(
        [
          ["AAA-SEP", "18", 2],
          ["BBB-JUL", "9", 0],
        ],
      );

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, suero.id, warehouseId)).toBe("27");
    });
  });

  describe("un desglose inválido se rechaza y la línea queda como estaba", () => {
    type Escenario = Awaited<ReturnType<typeof escenario>>;

    /** Manda el desglose que arma `cuerpo` sobre el conteo del queso y espera el rechazo. */
    async function rechazo(
      cuerpo: (e: Escenario) => Record<string, unknown>,
      status: number,
      mensaje: string,
    ) {
      const e = await escenario();
      const id = await conteo(e.token, e.warehouseId, [`${e.queso.sku},,,,`]);
      const linea = await lineaDe(e.token, id);

      const res = await corregir(e.token, id, linea.id, cuerpo(e)).expect(status);

      expect((res.body as { message: string }).message).toBe(mensaje);
      const despues = await lineaDe(e.token, id);
      expect(despues.counted).toBeNull();
      expect(despues.countBreakdown).toBeNull();
    }

    const AJENA = "Una presentación del desglose no es de «Queso Oaxaca» o ya no está activa.";
    const FILAS = "El desglose lleva de 1 a 50 renglones.";
    const CANTIDAD = "Cada cantidad del desglose es un número de cero o más.";

    it("una presentación de otro producto", async () => {
      await rechazo(
        (e) => ({ countBreakdown: [{ presentationId: e.cajaId, quantity: "1" }] }),
        422,
        AJENA,
      );
    });

    it("una presentación desactivada", async () => {
      await rechazo(
        (e) => ({ countBreakdown: [{ presentationId: e.bolsaViejaId, quantity: "1" }] }),
        422,
        AJENA,
      );
    });

    it("medio empaque en una presentación de «Solo enteros»", async () => {
      await rechazo(
        (e) => ({ countBreakdown: [{ presentationId: e.bolsa10Id, quantity: "1.5" }] }),
        422,
        "La presentación «Bolsa 10 Kg» solo acepta cantidades enteras.",
      );
    });

    it("una cantidad negativa", async () => {
      await rechazo(
        () => ({ countBreakdown: [{ presentationId: null, quantity: "-1" }] }),
        400,
        CANTIDAD,
      );
    });

    it("una cantidad que no es un número", async () => {
      await rechazo(
        () => ({ countBreakdown: [{ presentationId: null, quantity: "dos" }] }),
        400,
        CANTIDAD,
      );
    });

    it("más renglones de los que admite", async () => {
      await rechazo(
        () => ({
          countBreakdown: Array.from({ length: 51 }, () => ({
            presentationId: null,
            quantity: "1",
          })),
        }),
        400,
        FILAS,
      );
    });

    it("un desglose vacío", async () => {
      await rechazo(() => ({ countBreakdown: [] }), 400, FILAS);
    });

    it("en una entrada de mercancía, que no es un conteo", async () => {
      const { token, warehouseId, queso, bolsa10Id } = await escenario();
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "entry", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      const linea = await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines`)
        .set("Authorization", bearer(token))
        .send({ productId: queso.id, quantity: 1 })
        .expect(201);

      const res = await corregir(token, id, (linea.body as { id: string }).id, {
        countBreakdown: [{ presentationId: bolsa10Id, quantity: "1" }],
      }).expect(422);

      expect((res.body as { message: string }).message).toBe(
        "El desglose por presentaciones solo va en un inventario físico.",
      );
    });
  });

  /**
   * Lo que encontró el verificador (2026-11-25): agregar otra vez un renglón
   * que ya existe SUMA en vez de crear uno, y esa rama descartaba el desglose
   * con 201. Ahora el desglose se aplica (o se rechaza) igual que en un
   * renglón nuevo.
   */
  describe("agregar un renglón que ya existe con un desglose", () => {
    const agregar = (token: string, id: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines`)
        .set("Authorization", bearer(token))
        .send(body);

    it("en un conteo, el desglose se aplica al renglón que ya estaba", async () => {
      const { token, warehouseId, queso, kilogramoId, bolsa10Id } = await escenario();
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "physical_count", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await agregar(token, id, { productId: queso.id, presentationId: kilogramoId }).expect(201);

      const res = await agregar(token, id, {
        productId: queso.id,
        presentationId: kilogramoId,
        countBreakdown: [{ presentationId: bolsa10Id, quantity: "1" }],
      }).expect(201);

      expect(res.body).toMatchObject({ counted: "10" });
      const linea = await lineaDe(token, id);
      expect(linea.counted).toBe("10");
      expect(linea.countBreakdown).toEqual([
        expect.objectContaining({ presentationId: bolsa10Id, quantity: "1" }),
      ]);
    });

    it("en una entrada, el desglose se rechaza igual que en un renglón nuevo", async () => {
      const { token, warehouseId, queso, kilogramoId, bolsa10Id } = await escenario();
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "entry", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await agregar(token, id, {
        productId: queso.id,
        presentationId: kilogramoId,
        quantity: 1,
      }).expect(201);

      const res = await agregar(token, id, {
        productId: queso.id,
        presentationId: kilogramoId,
        quantity: 1,
        countBreakdown: [{ presentationId: bolsa10Id, quantity: "1" }],
      }).expect(422);

      expect((res.body as { message: string }).message).toBe(
        "El desglose por presentaciones solo va en un inventario físico.",
      );
    });
  });

  describe("un renglón sin desglose funciona como hoy", () => {
    it("el contado tecleado se guarda tal cual, sin desglose, y el saldo queda en él", async () => {
      const { token, tenantId, warehouseId, jabon } = await escenario();
      const id = await conteo(token, warehouseId, [`${jabon.sku},,,,`]);
      const linea = await lineaDe(token, id);

      const res = await corregir(token, id, linea.id, { counted: 37 }).expect(200);
      expect(res.body).toMatchObject({ counted: "37", countBreakdown: null });

      const previa = await lineaDe(token, id);
      expect(previa).toMatchObject({ counted: "37", difference: "-3", countBreakdown: null });

      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, jabon.id, warehouseId)).toBe("37");
    });

    it("el contado de la hoja sigue entrando sin desglose", async () => {
      const { token, tenantId, warehouseId, jabon } = await escenario();
      const id = await conteo(token, warehouseId, [`${jabon.sku},,,,35`]);

      expect(await lineaDe(token, id)).toMatchObject({ counted: "35", countBreakdown: null });
      await aprobar(token, id).expect(201);
      expect(await saldo(tenantId, jabon.id, warehouseId)).toBe("35");
    });
  });
});
