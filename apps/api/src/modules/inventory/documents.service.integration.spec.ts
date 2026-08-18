import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FOLIO_PREFIXES, INVENTORY_DOCUMENT_TYPES } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { InventoryDocumentType } from "../../generated/prisma/enums";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
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
    service = new DocumentsService(prisma);

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
});
