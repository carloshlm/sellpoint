import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F2-DB-04 a F2-DB-08: la mesa
 * de productos y todo lo que le cuelga.
 *
 * Se testean las invariantes que Prisma no expresa (CHECKs, índices parciales,
 * extensiones) y las decisiones de borrado (CASCADE vs RESTRICT), que son las
 * que definen qué se puede romper desde el API.
 */
describe("products y satélites — invariantes de schema (F2-DB-04..08)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenant = await prisma.tenant.create({ data: { name: `Tenant products ${Date.now()}` } });
    const other = await prisma.tenant.create({ data: { name: `Tenant otro ${Date.now()}` } });
    tenantId = tenant.id;
    otherTenantId = other.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function createProduct(
    ownerTenantId: string,
    sku: string,
    data: { baseUnit?: string; isComposite?: boolean } = {},
  ) {
    return prisma.withTenantContext(ownerTenantId, (tx) =>
      tx.product.create({
        data: { tenantId: ownerTenantId, sku, name: `Producto ${sku}`, ...data },
      }),
    );
  }

  describe("F2-DB-04 — products", () => {
    it("el SKU es único por tenant: repetirlo en otro tenant es válido", async () => {
      const sku = `SKU-${Date.now()}`;
      await createProduct(tenantId, sku);
      // Mismo SKU, OTRO tenant: permitido — cada negocio numera como quiere.
      await createProduct(otherTenantId, sku);

      await expect(createProduct(tenantId, sku)).rejects.toThrow();
    });

    it("`base_unit` solo acepta unidades del catálogo maestro (FK a units)", async () => {
      await expect(
        createProduct(tenantId, `SKU-unit-${Date.now()}`, { baseUnit: "xyz" }),
      ).rejects.toThrow();
    });

    it("la extensión pg_trgm y sus índices están instalados (búsqueda de F2-PROD-02)", async () => {
      const [extension] = await prisma.$queryRaw<
        { extname: string }[]
      >`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
      const indexes = await prisma.$queryRaw<
        { indexname: string }[]
      >`SELECT indexname FROM pg_indexes
        WHERE tablename = 'products' AND indexname IN ('products_sku_idx', 'products_name_idx')`;

      expect(extension?.extname).toBe("pg_trgm");
      expect(indexes).toHaveLength(2);
    });
  });

  describe("F2-DB-05 — product_presentations", () => {
    function createPresentation(
      productId: string,
      data: { name: string; factor: number; barcode?: string | null },
    ) {
      return prisma.withTenantContext(tenantId, (tx) =>
        tx.productPresentation.create({
          data: { tenantId, productId, allowFractionalInput: false, ...data },
        }),
      );
    }

    it("un factor <= 0 es rechazado (corrompería el stock convertido en silencio)", async () => {
      const product = await createProduct(tenantId, `SKU-factor-${Date.now()}`);

      await expect(createPresentation(product.id, { name: "Cero", factor: 0 })).rejects.toThrow();
      await expect(
        createPresentation(product.id, { name: "Negativo", factor: -1 }),
      ).rejects.toThrow();
    });

    it("el barcode es único por tenant, pero varios NULL conviven (índice parcial)", async () => {
      const product = await createProduct(tenantId, `SKU-barcode-${Date.now()}`);
      const barcode = `750${Date.now()}`;

      await createPresentation(product.id, { name: "Caja", factor: 10, barcode });
      // Dos presentaciones SIN barcode: el índice parcial las ignora.
      await createPresentation(product.id, { name: "Granel", factor: 1, barcode: null });
      await createPresentation(product.id, { name: "Media", factor: 5, barcode: null });

      const other = await createProduct(tenantId, `SKU-barcode-2-${Date.now()}`);
      await expect(
        createPresentation(other.id, { name: "Repetida", factor: 2, barcode }),
      ).rejects.toThrow();
    });

    it("borrar el producto arrastra sus presentaciones (CASCADE)", async () => {
      const product = await createProduct(tenantId, `SKU-cascade-${Date.now()}`);
      await createPresentation(product.id, { name: "Unidad", factor: 1 });

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.delete({ where: { id: product.id } }),
      );

      const left = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productPresentation.findMany({ where: { productId: product.id } }),
      );
      expect(left).toHaveLength(0);
    });
  });

  describe("F2-DB-06 — product_compositions", () => {
    it("un producto no puede ser componente de sí mismo (CHECK de ciclo directo)", async () => {
      const product = await createProduct(tenantId, `SKU-self-${Date.now()}`, {
        isComposite: true,
      });

      await expect(
        prisma.withTenantContext(tenantId, (tx) =>
          tx.productComposition.create({
            data: {
              tenantId,
              parentProductId: product.id,
              componentProductId: product.id,
              quantity: 1,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("cantidad <= 0 y merma fuera de 0-100 son rechazadas", async () => {
      const parent = await createProduct(tenantId, `SKU-parent-${Date.now()}`, {
        isComposite: true,
      });
      const component = await createProduct(tenantId, `SKU-comp-${Date.now()}`);
      const base = { tenantId, parentProductId: parent.id, componentProductId: component.id };

      await expect(
        prisma.withTenantContext(tenantId, (tx) =>
          tx.productComposition.create({ data: { ...base, quantity: 0 } }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantId, (tx) =>
          tx.productComposition.create({ data: { ...base, quantity: 1, wastePercentage: 101 } }),
        ),
      ).rejects.toThrow();
    });

    it("borrar un producto que es COMPONENTE de otro está bloqueado (RESTRICT)", async () => {
      const parent = await createProduct(tenantId, `SKU-parent-r-${Date.now()}`, {
        isComposite: true,
      });
      const component = await createProduct(tenantId, `SKU-comp-r-${Date.now()}`);
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productComposition.create({
          data: {
            tenantId,
            parentProductId: parent.id,
            componentProductId: component.id,
            quantity: 20,
          },
        }),
      );

      await expect(
        prisma.withTenantContext(tenantId, (tx) =>
          tx.product.delete({ where: { id: component.id } }),
        ),
      ).rejects.toThrow();

      // Pero borrar el COMPUESTO sí se puede: su composición se va con él.
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.delete({ where: { id: parent.id } }),
      );
      const left = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productComposition.findMany({ where: { parentProductId: parent.id } }),
      );
      expect(left).toHaveLength(0);
    });
  });
});
