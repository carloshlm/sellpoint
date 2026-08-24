import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FOLIO_PREFIXES, INVENTORY_DOCUMENT_TYPES } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { InventoryDocumentType } from "../../generated/prisma/enums";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { WeightedCostService } from "../cost/weighted-cost.service";
import { CompositionService } from "../products/composition.service";
import { DocumentsService } from "./documents.service";

/**
 * Integration (Postgres real) — F3-DOC-03: el ciclo de vida del documento.
 *
 * `createDraft` es la puerta por la que entra todo movimiento: crea el
 * encabezado vacío con su folio y devuelve el id sobre el que se cargarán las
 * líneas. `markConfirmed` es la que lo sella, y su lock lógico es lo que evita
 * que dos personas confirmando el mismo borrador dupliquen el saldo.
 */
describe("DocumentsService — ciclo de vida (F3-DOC-03)", () => {
  let prisma: PrismaService;
  let service: DocumentsService;
  let user: AuthUser;
  let warehouseId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    // `AuditService` no se usa en el camino de `availability` (solo lee), así
    // que no hace falta una instancia real para este spec. `WeightedCostService`
    // (F5-COST-02) sí se construye de verdad porque es barato —solo Prisma— y
    // un `null` ahí explotaría el día que `availability` empiece a costear.
    service = new DocumentsService(
      prisma,
      new CompositionService(prisma, null as never, new WeightedCostService(prisma)),
    );

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant docs ${stamp}` } });
    await prisma.withTenantContext(tenant.id, async (tx) => {
      const [created, warehouse] = await Promise.all([
        tx.user.create({
          data: {
            tenantId: tenant.id,
            email: `docs-${stamp}@example.com`,
            firstName: "Quien",
            lastNamePaternal: "Carga",
          },
        }),
        tx.warehouse.create({ data: { tenantId: tenant.id, name: `Central ${stamp}` } }),
      ]);
      warehouseId = warehouse.id;
      user = { userId: created.id, tenantId: tenant.id } as AuthUser;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("el contrato con el enum de la base", () => {
    /**
     * El molde de `UNITS` vs la tabla `units`: si alguien agrega un tipo al
     * enum de Prisma y se olvida del prefijo en shared, los folios saldrían
     * `undefined-000001`. Este test lo caza en CI.
     */
    it("los tipos de shared y los del enum de Prisma son los mismos", () => {
      expect([...INVENTORY_DOCUMENT_TYPES].sort()).toEqual(
        Object.values(InventoryDocumentType).sort(),
      );
    });
  });

  describe("createDraft", () => {
    it("nace en borrador, vacío y con el primer folio de su serie", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });

      expect(draft.folio).toBe("ENT-000001");
      expect(draft.status).toBe("draft");
      expect(draft.reasonCode).toBeNull();
    });

    it("dos del mismo tipo avanzan la serie", async () => {
      const first = await service.createDraft(user, { type: "exit", warehouseId });
      const second = await service.createDraft(user, { type: "exit", warehouseId });

      expect([first.folio, second.folio]).toEqual(["SAL-000001", "SAL-000002"]);
    });

    it("cada tipo lleva su propia cuenta", async () => {
      const count = await service.createDraft(user, { type: "physical_count", warehouseId });

      expect(count.folio).toBe(`${FOLIO_PREFIXES.physical_count}-000001`);
    });
  });

  describe("markConfirmed", () => {
    it("sella el borrador y deja constancia de quién y cuándo", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      await prisma.withTenantContext(user.tenantId, (tx) =>
        tx.inventoryDocument.update({
          where: { id: draft.id },
          data: { reasonCode: "invoice" },
        }),
      );

      const confirmed = await prisma.withTenantContext(user.tenantId, (tx) =>
        service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
      );

      expect(confirmed.status).toBe("confirmed");
      expect(confirmed.confirmedBy).toBe(user.userId);
      expect(confirmed.confirmedAt).not.toBeNull();
    });

    /**
     * EL test de esta tarea. Dos personas confirmando el mismo borrador desde
     * dos pantallas: si las dos pasaran, el stock se sumaría dos veces. El
     * `UPDATE … WHERE status='draft'` con `rowCount = 1` lo resuelve sin un
     * SELECT previo, que tendría una ventana de carrera entre leer y escribir.
     */
    it("dos confirmaciones simultáneas: una pasa y la otra da 409", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      await prisma.withTenantContext(user.tenantId, (tx) =>
        tx.inventoryDocument.update({
          where: { id: draft.id },
          data: { reasonCode: "invoice" },
        }),
      );

      const intentos = await Promise.allSettled([
        prisma.withTenantContext(user.tenantId, (tx) =>
          service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
        ),
        prisma.withTenantContext(user.tenantId, (tx) =>
          service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
        ),
      ]);

      const ok = intentos.filter((r) => r.status === "fulfilled");
      const fallidos = intentos.filter((r) => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(fallidos).toHaveLength(1);
      expect((fallidos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    });

    it("confirmar uno ya confirmado da 409 `inventory.document_not_draft`", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      await prisma.withTenantContext(user.tenantId, (tx) =>
        tx.inventoryDocument.update({ where: { id: draft.id }, data: { reasonCode: "invoice" } }),
      );
      await prisma.withTenantContext(user.tenantId, (tx) =>
        service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
      );

      await expect(
        prisma.withTenantContext(user.tenantId, (tx) =>
          service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
        ),
      ).rejects.toMatchObject({ response: { message: "inventory.document_not_draft" } });
    });
  });

  describe("cancel", () => {
    it("anular un borrador lo deja anulado CON su folio: la serie no pierde números", async () => {
      const draft = await service.createDraft(user, { type: "exit", warehouseId });

      const canceled = await service.cancel(user, draft.id, "Me equivoqué de almacén");

      expect(canceled.status).toBe("canceled");
      expect(canceled.folio).toBe(draft.folio);
      expect(canceled.cancelReason).toBe("Me equivoqué de almacén");
    });

    it("no se anula un confirmado: eso se corrige con otro movimiento", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      await prisma.withTenantContext(user.tenantId, (tx) =>
        tx.inventoryDocument.update({ where: { id: draft.id }, data: { reasonCode: "invoice" } }),
      );
      await prisma.withTenantContext(user.tenantId, (tx) =>
        service.markConfirmed(tx, user.tenantId, draft.id, user.userId),
      );

      await expect(service.cancel(user, draft.id, "ya no lo quiero")).rejects.toThrow(
        ConflictException,
      );
    });

    it("un documento de otro tenant no existe para este (404)", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      const ajeno = {
        ...user,
        tenantId: (await prisma.tenant.create({ data: { name: `X ${Date.now()}` } })).id,
      };

      await expect(service.cancel(ajeno, draft.id, "no deberías poder")).rejects.toThrow();
    });
  });

  /**
   * F3-ENTRY-02 — la pantalla necesita decir "3 Caja = 36 unidad", y para eso
   * hace falta el nombre de la unidad base y el factor de la presentación.
   *
   * Va en el DETALLE y no en una query aparte del front: si cada fila fuera a
   * buscar las presentaciones de su producto, un documento de 80 líneas haría
   * 80 viajes desde el navegador. Acá sale en UNA query junto con lo demás.
   */
  describe("el catálogo de lo que ya está en el documento (F3-ENTRY-02)", () => {
    it("devuelve `products` con la unidad base y las presentaciones de cada producto", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });
      const { productId, presentationId } = await prisma.withTenantContext(
        user.tenantId,
        async (tx) => {
          const product = await tx.product.create({
            data: {
              tenantId: user.tenantId,
              sku: `EQ-${Date.now()}`,
              name: "Paracetamol 500mg",
              baseUnit: "unit",
            },
          });
          const presentation = await tx.productPresentation.create({
            data: {
              tenantId: user.tenantId,
              productId: product.id,
              name: "Caja",
              factor: 12,
              allowFractionalInput: false,
            },
          });
          await tx.inventoryDocumentLine.create({
            data: {
              tenantId: user.tenantId,
              documentId: draft.id,
              lineNo: 1,
              productId: product.id,
              presentationId: presentation.id,
              quantity: 3,
            },
          });
          return { productId: product.id, presentationId: presentation.id };
        },
      );

      const detail = await service.detail(user, draft.id);

      expect(detail.products).toEqual([
        expect.objectContaining({
          id: productId,
          sku: expect.any(String),
          name: "Paracetamol 500mg",
          baseUnit: "unit",
          isComposite: false,
          presentations: [
            expect.objectContaining({
              id: presentationId,
              name: "Caja",
              factor: "12",
              allowFractionalInput: false,
            }),
          ],
        }),
      ]);
    });

    /**
     * Un documento vacío no puede reventar la pantalla: es el estado en que
     * nace TODO borrador.
     */
    it("un borrador sin líneas devuelve el catálogo vacío, no undefined", async () => {
      const draft = await service.createDraft(user, { type: "entry", warehouseId });

      const detail = await service.detail(user, draft.id);

      expect(detail.products).toEqual([]);
    });
  });

  /**
   * F3-EXIT-02 — el reparto FEFO en la VISTA PREVIA.
   *
   * Sale del MISMO `allocateFefo` que usa el confirm, y esa es toda la garantía
   * de que lo que el usuario ve antes de confirmar sea de donde realmente va a
   * salir la mercancía. Si fueran dos repartos, podrían elegir lotes distintos
   * y la previa mentiría justo en el dato por el que existe.
   */
  describe("el reparto FEFO de la previa (F3-EXIT-02)", () => {
    async function salidaConLotes(pedido: number) {
      const doc = await service.createDraft(user, { type: "exit", warehouseId });
      const productId = await prisma.withTenantContext(user.tenantId, async (tx) => {
        const product = await tx.product.create({
          data: {
            tenantId: user.tenantId,
            sku: `FEFO-${Date.now()}-${pedido}`,
            name: "Con caducidad",
            tracksLots: true,
          },
        });
        const [st30, st10] = await Promise.all([
          tx.productLot.create({
            data: {
              tenantId: user.tenantId,
              productId: product.id,
              lotCode: "st30",
              expiresAt: new Date("2026-09-30"),
            },
          }),
          tx.productLot.create({
            data: {
              tenantId: user.tenantId,
              productId: product.id,
              lotCode: "st10",
              expiresAt: new Date("2026-07-01"),
            },
          }),
        ]);
        await tx.stockLot.createMany({
          data: [
            { tenantId: user.tenantId, lotId: st30.id, warehouseId, quantity: 4 },
            { tenantId: user.tenantId, lotId: st10.id, warehouseId, quantity: 2 },
          ],
        });
        await tx.stockByWarehouse.create({
          data: { tenantId: user.tenantId, productId: product.id, warehouseId, quantity: 6 },
        });
        await tx.inventoryDocumentLine.create({
          data: {
            tenantId: user.tenantId,
            documentId: doc.id,
            lineNo: 1,
            productId: product.id,
            quantity: pedido,
          },
        });
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { reasonCode: "loss", reasonNote: "previa" },
        });
        return product.id;
      });
      return { documentId: doc.id, productId };
    }

    it("dice de qué lote saldría, el que vence primero", async () => {
      const { documentId } = await salidaConLotes(1);

      const detail = await service.detail(user, documentId);

      expect(detail.rows[0]?.lotPlan).toEqual([
        expect.objectContaining({ lotCode: "st10", quantity: "1" }),
      ]);
    });

    it("si el primero no alcanza, muestra el reparto ENTRE lotes", async () => {
      const { documentId } = await salidaConLotes(5);

      const detail = await service.detail(user, documentId);

      // st10 tiene 2 y vence antes; los 3 restantes salen de st30.
      expect(detail.rows[0]?.lotPlan).toEqual([
        expect.objectContaining({ lotCode: "st10", quantity: "2" }),
        expect.objectContaining({ lotCode: "st30", quantity: "3" }),
      ]);
    });

    it("la caducidad viaja: es el dato por el que alguien querría forzar otro lote", async () => {
      const { documentId } = await salidaConLotes(1);

      const detail = await service.detail(user, documentId);

      expect(detail.rows[0]?.lotPlan?.[0]?.expiresAt).toEqual(new Date("2026-07-01"));
    });

    /** Una ENTRADA no reparte: el lote lo elige quien carga la mercancía. */
    it("una entrada no trae reparto", async () => {
      const doc = await service.createDraft(user, { type: "entry", warehouseId });

      const detail = await service.detail(user, doc.id);

      expect(detail.rows).toEqual([]);
    });
  });

  /**
   * F3-EXIT-02 — el techo de un producto COMPUESTO, por almacén.
   *
   * Un compuesto no tiene saldo propio: se arma al consumirlo. Su "disponible"
   * son las unidades ARMABLES con lo que hay de sus componentes.
   *
   * Y tiene que ser **de este almacén**. `CompositionService.availability`
   * suma todos (`groupBy` por producto, sin filtro), que es correcto para la
   * ficha del producto pero MENTIRÍA como techo de una línea: diría que se
   * pueden armar 10 cuando los componentes están en otra bodega.
   */
  describe("el techo de un compuesto en la previa (F3-EXIT-02)", () => {
    it("cuenta solo los componentes de ESTE almacén, no los de todos", async () => {
      const doc = await service.createDraft(user, { type: "exit", warehouseId });
      const stamp = Date.now();

      await prisma.withTenantContext(user.tenantId, async (tx) => {
        const otro = await tx.warehouse.create({
          data: { tenantId: user.tenantId, name: `Lejos ${stamp}` },
        });
        const harina = await tx.product.create({
          data: { tenantId: user.tenantId, sku: `HAR-${stamp}`, name: "Harina" },
        });
        const pan = await tx.product.create({
          data: { tenantId: user.tenantId, sku: `PAN-${stamp}`, name: "Pan", isComposite: true },
        });
        await tx.productComposition.create({
          data: {
            tenantId: user.tenantId,
            parentProductId: pan.id,
            componentProductId: harina.id,
            quantity: 2,
          },
        });
        // 6 de harina acá (=> 3 panes) y 100 en la otra bodega (irrelevantes).
        await tx.stockByWarehouse.createMany({
          data: [
            { tenantId: user.tenantId, productId: harina.id, warehouseId, quantity: 6 },
            { tenantId: user.tenantId, productId: harina.id, warehouseId: otro.id, quantity: 100 },
          ],
        });
        await tx.inventoryDocumentLine.create({
          data: {
            tenantId: user.tenantId,
            documentId: doc.id,
            lineNo: 1,
            productId: pan.id,
            quantity: 1,
          },
        });
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { reasonCode: "consumption", reference: "cocina" },
        });
      });

      const detail = await service.detail(user, doc.id);
      const pan = detail.products.find((p) => p.isComposite);

      // 3, no 53: los 100 de la otra bodega no se pueden armar acá.
      expect(pan?.availableUnits).toBe(3);
    });

    /** Un producto simple no tiene techo que calcular: su saldo ya lo dice. */
    it("un producto simple no trae `availableUnits`", async () => {
      const doc = await service.createDraft(user, { type: "exit", warehouseId });
      await prisma.withTenantContext(user.tenantId, async (tx) => {
        const simple = await tx.product.create({
          data: { tenantId: user.tenantId, sku: `SIM-${Date.now()}`, name: "Simple" },
        });
        await tx.inventoryDocumentLine.create({
          data: {
            tenantId: user.tenantId,
            documentId: doc.id,
            lineNo: 1,
            productId: simple.id,
            quantity: 1,
          },
        });
      });

      const detail = await service.detail(user, doc.id);

      expect(detail.products[0]?.availableUnits).toBeNull();
    });
  });
});
