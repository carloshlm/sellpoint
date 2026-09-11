import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { EntitlementsService } from "../../src/modules/billing/entitlements.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  BILLING_TEST_PASSWORD,
  bearer,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-PURCH-05..08 — las compras de punta a punta.
 *
 * Lo que fija:
 *  - sin el módulo (un Free), 402 en TODO, también las lecturas;
 *  - el folio correlativo `COM-` y el rango de fechas DATE con DATE;
 *  - las líneas en BLOQUE recomponen los impuestos sin acumularlos;
 *  - el `confirm` exige cantidad y costo NOMBRANDO la línea, y materializa
 *    `unit_cost_net`;
 *  - anular arrastra el borrador de entrada, y con la entrada confirmada es 409;
 *  - **el contrato del puente**: la cantidad viaja en la presentación
 *    capturada y el costo que pisa el catálogo es el NETO, en los dos modos
 *    fiscales.
 */
describe("Compras (F9-PURCH)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let sinModulo: TenantFixture;
  let compradorToken: string;
  let almacenId: string;
  let proveedorId: string;
  let productoId: string;
  let cajaId: string;
  let piezaId: string;
  let ivaId: string;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
  });

  /** Una compra nueva del negocio, con el proveedor y la fecha del papel. */
  const nuevaCompra = async (purchaseDate = "2026-09-11") =>
    (
      await api(negocio.token)
        .post("/purchases", { supplierId: proveedorId, purchaseDate })
        .expect(201)
    ).body as { id: string; folio: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    // El trial Plus incluye Compras (desde Pro): no hay nada que pactar.
    negocio = await registerTenant(app, "purch");
    await setTenantMarket(prisma, negocio.tenantId, "MX");

    const semilla = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const proveedor = await tx.supplier.create({
        data: { tenantId: negocio.tenantId, name: "Distribuidora Norte" },
      });
      const producto = await tx.product.create({
        data: {
          tenantId: negocio.tenantId,
          sku: `PUR-${randomUUID().slice(0, 8)}`,
          name: "Paracetamol 500 mg",
          location: "Pasillo 3",
          // Controla lotes: la compra los TRANSPORTA y la entrada los EXIGE
          // (ver el caso «un lote sobre un producto que no los controla»).
          tracksLots: true,
        },
      });
      const pieza = await tx.productPresentation.create({
        data: {
          tenantId: negocio.tenantId,
          productId: producto.id,
          name: "Pieza",
          factor: "1",
          allowFractionalInput: false,
        },
      });
      const caja = await tx.productPresentation.create({
        data: {
          tenantId: negocio.tenantId,
          productId: producto.id,
          name: "Caja ×12",
          factor: "12",
          allowFractionalInput: false,
        },
      });
      const grupo = await tx.taxGroup.create({
        data: { tenantId: negocio.tenantId, code: "IVA16", name: "IVA 16%", isDefault: false },
      });
      await tx.taxRate.create({
        data: {
          tenantId: negocio.tenantId,
          taxGroupId: grupo.id,
          code: "IVA",
          name: "IVA",
          rate: "16",
        },
      });
      return {
        almacenId: almacen.id,
        proveedorId: proveedor.id,
        productoId: producto.id,
        piezaId: pieza.id,
        cajaId: caja.id,
        ivaId: grupo.id,
      };
    });
    almacenId = semilla.almacenId;
    proveedorId = semilla.proveedorId;
    productoId = semilla.productoId;
    piezaId = semilla.piezaId;
    cajaId = semilla.cajaId;
    ivaId = semilla.ivaId;

    // Un comprador SIN `inventory:movement`: captura facturas, no acuña
    // entradas de inventario.
    const rol = await api(negocio.token)
      .post("/roles", {
        name: "Comprador",
        permissionCodes: ["purchases:read", "purchases:manage", "purchases:cancel"],
      })
      .expect(201);
    const email = `purch-comprador-${randomUUID()}@example.com`;
    await api(negocio.token)
      .post("/users", {
        email,
        firstName: "Coco",
        lastName: "Comprador",
        roleIds: [(rol.body as { id: string }).id],
      })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.filter((m) => m.to === email).at(-1)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: BILLING_TEST_PASSWORD })
      .expect(204);
    compradorToken = (
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ email, password: BILLING_TEST_PASSWORD })
          .expect(200)
      ).body as { accessToken: string }
    ).accessToken;

    // Un Free NO incluye Compras: el plan contratado se fija en la fila
    // (`free` no se contrata por el backoffice) y se limpia la caché.
    sinModulo = await registerTenant(app, "purch-free");
    await prisma.withTenantContext(sinModulo.tenantId, async (tx) => {
      const free = await tx.plan.findUniqueOrThrow({ where: { code: "free" } });
      await tx.tenantSubscription.update({
        where: { tenantId: sinModulo.tenantId },
        data: { planId: free.id },
      });
    });
    await app.get(EntitlementsService).invalidate(sinModulo.tenantId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("el borrador y el listado (F9-PURCH-05)", () => {
    it("sin el módulo, hasta leer las compras responde 402", async () => {
      await api(sinModulo.token).get("/purchases").expect(402);
      await api(sinModulo.token)
        .post("/purchases", { supplierId: proveedorId, purchaseDate: "2026-09-11" })
        .expect(402);
    });

    it("nace en borrador con folio correlativo, el almacén asignado y el modo `excluded`", async () => {
      const primera = await nuevaCompra();
      const segunda = await nuevaCompra();

      expect(primera.folio).toBe("COM-000001");
      expect(segunda.folio).toBe("COM-000002");
      const detalle = await api(negocio.token).get(`/purchases/${primera.id}`).expect(200);
      expect(detalle.body).toMatchObject({
        status: "draft",
        taxMode: "excluded",
        warehouseId: almacenId,
        supplierName: "Distribuidora Norte",
        total: "0",
        mismatch: false,
        entry: null,
      });
    });

    it("nace con el modo del NEGOCIO: capturando «con impuesto», la compra nueva nace included (F9-COSTMODE-04)", async () => {
      await api(negocio.token).put("/tenants/me/taxes", { costMode: "included" }).expect(200);
      try {
        const compra = await nuevaCompra();
        const detalle = await api(negocio.token).get(`/purchases/${compra.id}`).expect(200);
        expect(detalle.body).toMatchObject({ taxMode: "included" });
        // Sigue siendo POR documento: esta factura vino neta.
        await api(negocio.token)
          .patch(`/purchases/${compra.id}`, { taxMode: "excluded" })
          .expect(200);
      } finally {
        await api(negocio.token).put("/tenants/me/taxes", { costMode: "excluded" }).expect(200);
      }
    });

    it("el rango de fechas es DATE con DATE: la compra del 5 de enero aparece ese día", async () => {
      const deEnero = await nuevaCompra("2026-01-05");

      const delDia = await api(negocio.token)
        .get("/purchases?from=2026-01-05&to=2026-01-05")
        .expect(200);
      expect((delDia.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
        deEnero.id,
      ]);
      const otroDia = await api(negocio.token)
        .get("/purchases?from=2026-01-06&to=2026-01-06")
        .expect(200);
      expect((otroDia.body as { total: number }).total).toBe(0);
      await api(negocio.token).get("/purchases?from=2026-01-06&to=2026-01-05").expect(400);
    });

    it("el total declarado descuadra sin bloquear, y se ve en el detalle", async () => {
      const compra = await nuevaCompra();
      const conPapel = await api(negocio.token)
        .patch(`/purchases/${compra.id}`, { declaredTotal: 1160, supplierInvoice: "A-4471" })
        .expect(200);

      expect(conPapel.body).toMatchObject({
        declaredTotal: "1160",
        mismatch: true,
        difference: "1160",
      });
    });
  });

  describe("las líneas y los cargos en bloque (F9-PURCH-06)", () => {
    it("dos líneas suman el total y dejan UNA fila de impuesto por componente", async () => {
      const compra = await nuevaCompra();
      const conLineas = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 10,
              unitCost: 100,
              taxGroupId: ivaId,
            },
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 2,
              unitCost: 500,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);

      expect(conLineas.body).toMatchObject({
        subtotal: "2000",
        taxTotal: "320",
        total: "2320",
        lineCount: 2,
      });
      expect((conLineas.body as { taxes: unknown[] }).taxes).toHaveLength(1);

      // Guardar de nuevo NO acumula: los impuestos se borran y se recrean.
      const conUna = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 10,
              unitCost: 100,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      expect((conUna.body as { taxes: { amount: string }[] }).taxes).toHaveLength(1);
      expect(conUna.body).toMatchObject({ total: "1160", taxTotal: "160" });
    });

    it("una línea sin cantidad se guarda y suma cero; el lote se normaliza", async () => {
      const compra = await nuevaCompra();
      const guardada = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: productoId, presentationId: piezaId, lotCode: "st m 01" }],
        })
        .expect(200);

      const lineas = (guardada.body as { lines: { quantity: string | null; lotCode: string }[] })
        .lines;
      expect(lineas[0]).toMatchObject({ quantity: null, lotCode: "STM01" });
      expect(guardada.body).toMatchObject({ total: "0" });
    });

    it("una presentación que no es del producto rebota con 422", async () => {
      const otroProducto = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.product.create({
          data: { tenantId: negocio.tenantId, sku: `X-${randomUUID().slice(0, 8)}`, name: "Otro" },
        }),
      );
      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            { productId: otroProducto.id, presentationId: cajaId, quantity: 1, unitCost: 10 },
          ],
        })
        .expect(422);
    });

    it("un cargo suma al total con su impuesto y NO cambia el costo de las líneas", async () => {
      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 10,
              unitCost: 100,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      const conFlete = await api(negocio.token)
        .put(`/purchases/${compra.id}/charges`, {
          charges: [{ description: "Flete", amount: 200, taxGroupId: ivaId }],
        })
        .expect(200);

      expect(conFlete.body).toMatchObject({
        subtotal: "1000",
        extraChargesTotal: "232",
        taxTotal: "192",
        total: "1392",
      });
      // El costo de la línea no se movió: el landed cost está pospuesto.
      const linea = (conFlete.body as { lines: { lineTotal: string }[] }).lines[0];
      expect(linea?.lineTotal).toBe("1160");
    });
  });

  describe("confirmar, anular y la recepción (F9-PURCH-07)", () => {
    it("confirmar sin líneas, o con una línea sin costo, rebota NOMBRANDO la línea", async () => {
      const vacia = await nuevaCompra();
      await api(negocio.token).post(`/purchases/${vacia.id}/confirm`).expect(422);

      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: productoId, presentationId: piezaId, quantity: 3 }],
        })
        .expect(200);
      const rebote = await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(422);
      expect((rebote.body as { message: string }).message).toContain("lines.1.unitCost");
    });

    it("confirmar sella, materializa el costo NETO y congela las líneas", async () => {
      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 3,
              unitCost: 120,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      const sellada = await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);

      expect(sellada.body).toMatchObject({ status: "confirmed", total: "417.6" });
      // `excluded`: el costo neto es el capturado, sin el IVA que se suma.
      expect((sellada.body as { lines: { unitCostNet: string }[] }).lines[0]?.unitCostNet).toBe(
        "120",
      );
      // Y ya no se editan líneas ni cabecera de dinero.
      await api(negocio.token).put(`/purchases/${compra.id}/lines`, { lines: [] }).expect(409);
      await api(negocio.token).patch(`/purchases/${compra.id}`, { declaredTotal: 1 }).expect(409);
    });

    it("`included`: el costo neto sale del bruto, para que el catálogo no se infle", async () => {
      const compra = await nuevaCompra();
      await api(negocio.token)
        .patch(`/purchases/${compra.id}`, { taxMode: "included" })
        .expect(200);
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 3,
              unitCost: 139.2,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      const sellada = await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);

      expect(sellada.body).toMatchObject({ total: "417.6", taxTotal: "57.6" });
      // El MISMO costo que en `excluded`: el catálogo no puede quedar con dos
      // costos distintos según cómo el proveedor imprimió su factura.
      expect((sellada.body as { lines: { unitCostNet: string }[] }).lines[0]?.unitCostNet).toBe(
        "120",
      );
    });

    it("la recepción se anota DESPUÉS de confirmar, sin tocar el dinero", async () => {
      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: productoId, presentationId: piezaId, quantity: 1, unitCost: 50 }],
        })
        .expect(200);
      const antes = await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);

      const anotada = await api(negocio.token)
        .patch(`/purchases/${compra.id}/reception`, {
          receivedDate: "2026-09-10",
          supplierInvoice: "A-9001",
          notes: "Llegó incompleta: faltan 2 cajas",
        })
        .expect(200);
      expect(anotada.body).toMatchObject({
        receivedDate: "2026-09-10",
        supplierInvoice: "A-9001",
        total: (antes.body as { total: string }).total,
      });
    });

    it("anular dos veces es 409, y el Viewer no puede anular", async () => {
      const compra = await nuevaCompra();
      await api(compradorToken)
        .post(`/purchases/${compra.id}/cancel`, { reason: "no" })
        .expect(400);
      const anulada = await api(compradorToken)
        .post(`/purchases/${compra.id}/cancel`, { reason: "duplicada" })
        .expect(200);
      expect(anulada.body).toMatchObject({ status: "canceled", cancelReason: "duplicada" });
      await api(negocio.token)
        .post(`/purchases/${compra.id}/cancel`, { reason: "otra vez" })
        .expect(409);
    });
  });

  /** F9-PURCH-09 — el papel: un borrador no tiene documento; una confirmada sí. */
  describe("el papel de la compra (F9-PURCH-09)", () => {
    it("un borrador no tiene documento (409); una confirmada imprime folio y proveedor", async () => {
      const borrador = await nuevaCompra();
      await api(negocio.token).get(`/purchases/${borrador.id}/document`).expect(409);

      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 4,
              unitCost: 25,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      await api(negocio.token).patch(`/purchases/${compra.id}`, { declaredTotal: 120 }).expect(200);
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);

      const pdf = await request(app.getHttpServer())
        .get(`/purchases/${compra.id}/document`)
        .set("Authorization", bearer(negocio.token))
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers["content-type"]).toContain("application/pdf");
      const texto = textoDelPdf(pdf.body as Buffer);
      expect(texto).toContain("COM-");
      expect(texto).toContain("Distribuidora Norte");
      // El papel dice 120 y las líneas suman 116: el descuadre se IMPRIME.
      expect(texto).toContain("116.00");
      expect(texto.replace(/\s+/g, " ")).toMatch(/no coincide|not match/i);
    });
  });

  describe("el puente a la entrada (F9-PURCH-08)", () => {
    /** Una compra confirmada de 3 «Caja ×12» al costo dado, en el modo dado. */
    async function compraLista(unitCost: number, taxMode: "included" | "excluded", discount = 0) {
      const compra = await nuevaCompra();
      await api(negocio.token).patch(`/purchases/${compra.id}`, { taxMode }).expect(200);
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 3,
              unitCost,
              discount,
              taxGroupId: ivaId,
              lotCode: "L-2026",
              expiresAt: "2027-01-31",
            },
          ],
        })
        .expect(200);
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);
      return compra;
    }

    it("sobre un borrador no hay entrada que pedir (409); sin `inventory:movement`, 403", async () => {
      const borrador = await nuevaCompra();
      await api(negocio.token).post(`/purchases/${borrador.id}/entry-draft`).expect(409);

      const confirmada = await compraLista(120, "excluded");
      await api(compradorToken).post(`/purchases/${confirmada.id}/entry-draft`).expect(403);
    });

    it("dos llamadas devuelven la MISMA entrada; anulada, se puede pedir otra", async () => {
      const compra = await compraLista(120, "excluded");
      const primera = await api(negocio.token)
        .post(`/purchases/${compra.id}/entry-draft`)
        .expect(201);
      const segunda = await api(negocio.token)
        .post(`/purchases/${compra.id}/entry-draft`)
        .expect(201);
      expect((segunda.body as { id: string }).id).toBe((primera.body as { id: string }).id);

      await api(negocio.token)
        .post(`/inventory/documents/${(primera.body as { id: string }).id}/cancel`, {
          reason: "me equivoqué de almacén",
        })
        .expect(200);
      const tercera = await api(negocio.token)
        .post(`/purchases/${compra.id}/entry-draft`)
        .expect(201);
      expect((tercera.body as { id: string }).id).not.toBe((primera.body as { id: string }).id);
    });

    /**
     * ⚠ EL CONTRATO. Tres cajas de 12 a $120 la caja: la entrada tiene que
     * decir 3 (no 36) y $120 (no 1440 ni 139.20), y al confirmarse el costo
     * del catálogo tiene que quedar en 120.
     */
    it.each([
      ["excluded", 120],
      ["included", 139.2],
    ] as const)(
      "en `%s` la entrada recibe 3 cajas con el costo NETO y el catálogo queda en 120",
      async (taxMode, unitCost) => {
        const compra = await compraLista(unitCost, taxMode);
        const entrada = await api(negocio.token)
          .post(`/purchases/${compra.id}/entry-draft`)
          .expect(201);
        const entradaId = (entrada.body as { id: string }).id;

        const detalle = await api(negocio.token)
          .get(`/inventory/documents/${entradaId}`)
          .expect(200);
        const cuerpo = detalle.body as {
          reasonCode: string;
          reference: string;
          source: { module: string; ref: string };
          lines: {
            quantity: string;
            unitCost: string;
            presentationId: string;
            lotCode: string;
            location: string;
          }[];
        };
        expect(cuerpo.reasonCode).toBe("invoice");
        expect(cuerpo.source).toEqual({ module: "purchases", ref: compra.id });
        expect(cuerpo.lines[0]).toMatchObject({
          quantity: "3",
          unitCost: "120",
          presentationId: cajaId,
          lotCode: "L-2026",
          // La ubicación de referencia de la ficha, para cotejarla al recibir.
          location: "Pasillo 3",
        });

        await api(negocio.token).post(`/inventory/documents/${entradaId}/confirm`).expect(201);
        const presentacion = await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.productPresentation.findUniqueOrThrow({ where: { id: cajaId } }),
        );
        expect(presentacion.cost?.toString()).toBe("120");
      },
    );

    /**
     * F9-COSTMODE-05 — el negocio que captura «con impuesto»: la entrada ve el
     * BRUTO por unidad (lo que verá en su catálogo) y el neto EXACTO de la
     * compra viaja al lado, con el descuento de línea ya dentro.
     */
    it("capturando «con impuesto», la entrada recibe el bruto y el neto exacto de la compra; el descuento va dentro del neto", async () => {
      await api(negocio.token).put("/tenants/me/taxes", { costMode: "included" }).expect(200);
      try {
        const lineasDe = async (compraId: string) => {
          const entrada = await api(negocio.token)
            .post(`/purchases/${compraId}/entry-draft`)
            .expect(201);
          const lineas = await prisma.withTenantContext(negocio.tenantId, (tx) =>
            tx.inventoryDocumentLine.findMany({
              where: { documentId: (entrada.body as { id: string }).id },
              select: { unitCost: true, unitCostNet: true },
            }),
          );
          return lineas.map((l) => ({
            unitCost: l.unitCost?.toString(),
            unitCostNet: l.unitCostNet?.toString(),
          }));
        };

        // La factura vino con IVA adentro: 139.20 la caja → 120 netos.
        const conIva = await compraLista(139.2, "included");
        expect(await lineasDe(conIva.id)).toEqual([{ unitCost: "139.2", unitCostNet: "120" }]);

        // La factura vino neta aunque el negocio capture con IVA: el bruto se
        // reconstruye desde la propia línea, el neto no se toca.
        const neta = await compraLista(120, "excluded");
        expect(await lineasDe(neta.id)).toEqual([{ unitCost: "139.2", unitCostNet: "120" }]);

        // Con $30 de descuento en la línea (3 × 120 = 360 − 30 = 330 netos):
        // el neto de la entrada es el de la compra al centavo, 110, no 120.
        const conDescuento = await compraLista(120, "excluded", 30);
        const compra = await api(negocio.token).get(`/purchases/${conDescuento.id}`).expect(200);
        const netoDeLaCompra = (compra.body as { lines: { unitCostNet: string }[] }).lines[0]
          ?.unitCostNet;
        expect(netoDeLaCompra).toBe("110");
        expect(await lineasDe(conDescuento.id)).toEqual([
          { unitCost: "127.6", unitCostNet: "110" },
        ]);
      } finally {
        await api(negocio.token).put("/tenants/me/taxes", { costMode: "excluded" }).expect(200);
      }
    });

    it("editar el costo de una línea traída del puente rederiva el neto al confirmar (F9-COSTMODE-06)", async () => {
      await api(negocio.token).put("/tenants/me/taxes", { costMode: "included" }).expect(200);
      // El neto rederivado usa el grupo EFECTIVO del producto (no el de la
      // línea de la compra, que ya no existe en la entrada): la ficha lleva IVA.
      await api(negocio.token).patch(`/products/${productoId}`, { taxGroupId: ivaId }).expect(200);
      try {
        const compra = await compraLista(139.2, "included");
        const entrada = await api(negocio.token)
          .post(`/purchases/${compra.id}/entry-draft`)
          .expect(201);
        const entradaId = (entrada.body as { id: string }).id;
        const detalle = await api(negocio.token)
          .get(`/inventory/documents/${entradaId}`)
          .expect(200);
        const linea = (detalle.body as { rows: { id: string; unitCostNet: string }[] }).rows[0];
        expect(linea?.unitCostNet).toBe("120");

        // La caja resultó costar 232 con IVA: el neto viejo (120) no puede quedar.
        await api(negocio.token)
          .patch(`/inventory/documents/${entradaId}/lines/${linea?.id}`, { unitCost: 232 })
          .expect(200);
        await api(negocio.token).post(`/inventory/documents/${entradaId}/confirm`).expect(201);
        const movimientos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.stockMovement.findMany({
            where: { documentId: entradaId },
            select: { unitCost: true },
          }),
        );
        expect(movimientos.map((m) => m.unitCost?.toString())).toEqual(["200"]);
        const presentacion = await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.productPresentation.findUniqueOrThrow({ where: { id: cajaId } }),
        );
        expect(presentacion.cost?.toString()).toBe("232");
      } finally {
        await api(negocio.token).put("/tenants/me/taxes", { costMode: "excluded" }).expect(200);
        await api(negocio.token).patch(`/products/${productoId}`, { taxGroupId: null }).expect(200);
      }
    });

    it("anular la compra arrastra su borrador de entrada; con la entrada confirmada, 409", async () => {
      const conBorrador = await compraLista(120, "excluded");
      const entrada = await api(negocio.token)
        .post(`/purchases/${conBorrador.id}/entry-draft`)
        .expect(201);
      await api(negocio.token)
        .post(`/purchases/${conBorrador.id}/cancel`, { reason: "el proveedor la canceló" })
        .expect(200);
      const documento = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.inventoryDocument.findUniqueOrThrow({
          where: { id: (entrada.body as { id: string }).id },
        }),
      );
      expect(documento.status).toBe("canceled");

      const yaRecibida = await compraLista(120, "excluded");
      const suEntrada = await api(negocio.token)
        .post(`/purchases/${yaRecibida.id}/entry-draft`)
        .expect(201);
      await api(negocio.token)
        .post(`/inventory/documents/${(suEntrada.body as { id: string }).id}/confirm`)
        .expect(201);
      await api(negocio.token)
        .post(`/purchases/${yaRecibida.id}/cancel`, { reason: "tarde" })
        .expect(409);
    });
  });

  describe("el resumen del rango (F9-PURCH-13)", () => {
    /** Una compra del día dado, con una línea de `unitCost` y lo que dice el papel. */
    async function compraDelDia(purchaseDate: string, unitCost: number, declaredTotal: number) {
      const compra = await nuevaCompra(purchaseDate);
      await api(negocio.token).patch(`/purchases/${compra.id}`, { declaredTotal }).expect(200);
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 1,
              unitCost,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);
      return compra;
    }

    it("suma el FILTRO sin las anuladas y cuenta solo las que no cuadran", async () => {
      // $100 + IVA 16% = $116 (cuadra con el papel), y $200 + IVA = $232 declarado
      // en $250 (no cuadra). La tercera se anula: un papel anulado no se compró.
      await compraDelDia("2026-04-07", 100, 116);
      await compraDelDia("2026-04-07", 200, 250);
      const anulada = await compraDelDia("2026-04-07", 500, 580);
      await api(negocio.token)
        .post(`/purchases/${anulada.id}/cancel`, { reason: "pedido duplicado" })
        .expect(200);

      const delDia = await api(negocio.token)
        .get("/purchases?from=2026-04-07&to=2026-04-07")
        .expect(200);
      // `total` es el conteo del PAGINADO (las tres filas, anulada incluida:
      // sigue siendo un papel que se puede abrir); `summary` es el dinero.
      expect(delDia.body).toMatchObject({
        total: 3,
        summary: { count: 2, total: "348", mismatchCount: 1 },
      });

      // Filtrar justamente las anuladas deja el resumen en cero, no en error.
      const soloAnuladas = await api(negocio.token)
        .get("/purchases?from=2026-04-07&to=2026-04-07&status=canceled")
        .expect(200);
      expect(soloAnuladas.body).toMatchObject({
        total: 1,
        summary: { count: 0, total: "0", mismatchCount: 0 },
      });
    });
  });

  describe("el lote solo cabe donde se controla (Carlos, 2026-09-11)", () => {
    /** Un producto suelto del negocio, con o sin control por lote y sin presentaciones. */
    const producto = (tracksLots: boolean) =>
      prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.product.create({
          data: {
            tenantId: negocio.tenantId,
            sku: `L-${randomUUID().slice(0, 8)}`,
            name: tracksLots ? "Con lote" : "Sin lote",
            tracksLots,
          },
        }),
      );

    it("un lote en un producto que no se controla por lote rebota nombrando la línea", async () => {
      // La entrada lo rechazaría al confirmar (`inventory.lot_not_tracked`);
      // descubrirlo ahí, con la compra ya sellada, es descubrirlo tarde.
      const sinLote = await producto(false);
      const compra = await nuevaCompra();
      const rebote = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            { productId: productoId, presentationId: piezaId, quantity: 1, unitCost: 10 },
            { productId: sinLote.id, quantity: 1, unitCost: 10, lotCode: "ST1" },
          ],
        })
        .expect(422);
      expect((rebote.body as { message: string }).message).toContain("lines.2.lotCode");

      // Solo la caducidad también es «lote»: no hay caducidad sin lote.
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: sinLote.id, quantity: 1, unitCost: 10, expiresAt: "2027-01-31" }],
        })
        .expect(422);
      // Sin lote ni caducidad, el mismo producto entra sin problema.
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: sinLote.id, quantity: 1, unitCost: 10 }],
        })
        .expect(200);
    });

    it("si le apagan el control por lote después de confirmar, el puente no copia el lote", async () => {
      const conLote = await producto(true);
      const compra = await nuevaCompra();
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: conLote.id,
              quantity: 5,
              unitCost: 10,
              lotCode: "L-2026",
              expiresAt: "2027-01-31",
            },
          ],
        })
        .expect(200);
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.product.update({ where: { id: conLote.id }, data: { tracksLots: false } }),
      );

      const entrada = await api(negocio.token)
        .post(`/purchases/${compra.id}/entry-draft`)
        .expect(201);
      const entradaId = (entrada.body as { id: string }).id;
      const lineas = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.inventoryDocumentLine.findMany({ where: { documentId: entradaId } }),
      );
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        lotCode: null,
        expiresAt: null,
        unitCost: expect.anything(),
      });
      // Y la entrada se confirma: sin el lote de más, ya no hay nada que rechazar.
      await api(negocio.token).post(`/inventory/documents/${entradaId}/confirm`).expect(201);
    });
  });

  describe("fechas de hoy para atrás y la caducidad del lote conocido (Carlos, 2026-09-11)", () => {
    it("ni la factura ni la recepción pueden ser de mañana", async () => {
      await api(negocio.token)
        .post("/purchases", { supplierId: proveedorId, purchaseDate: "2031-01-01" })
        .expect(422);
      const compra = await nuevaCompra("2026-01-10");
      const rebote = await api(negocio.token)
        .patch(`/purchases/${compra.id}`, { receivedDate: "2031-01-01" })
        .expect(422);
      expect((rebote.body as { message: string }).message).toContain("receivedDate");
      // Ayer sí: el papel ya llegó.
      await api(negocio.token)
        .patch(`/purchases/${compra.id}`, { receivedDate: "2026-01-11" })
        .expect(200);

      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [{ productId: productoId, presentationId: piezaId, quantity: 1, unitCost: 10 }],
        })
        .expect(200);
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);
      await api(negocio.token)
        .patch(`/purchases/${compra.id}/reception`, { receivedDate: "2031-01-01" })
        .expect(422);
    });

    it("un lote que ya existe —aunque no tenga existencias— manda su caducidad", async () => {
      // Registrado a mano, SIN stock: es el caso del histórico que el stock
      // no ve y que dejaba capturar otra fecha.
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.productLot.create({
          data: {
            tenantId: negocio.tenantId,
            productId: productoId,
            lotCode: "HIST-01",
            expiresAt: new Date("2028-05-31"),
          },
        }),
      );
      const compra = await nuevaCompra();

      // Sin fecha: la hereda del lote.
      const heredada = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 1,
              unitCost: 10,
              lotCode: "hist-01",
            },
          ],
        })
        .expect(200);
      expect(
        (heredada.body as { lines: { lotCode: string; expiresAt: string | null }[] }).lines[0],
      ).toMatchObject({ lotCode: "HIST-01", expiresAt: "2028-05-31" });

      // Con OTRA fecha: rebota nombrando la línea. La caducidad es del lote.
      const rebote = await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 1,
              unitCost: 10,
              lotCode: "HIST-01",
              expiresAt: "2029-01-01",
            },
          ],
        })
        .expect(422);
      expect((rebote.body as { message: string }).message).toContain("lines.1.expiresAt");

      // Con LA MISMA fecha: pasa.
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: piezaId,
              quantity: 1,
              unitCost: 10,
              lotCode: "HIST-01",
              expiresAt: "2028-05-31",
            },
          ],
        })
        .expect(200);
    });
  });
});
