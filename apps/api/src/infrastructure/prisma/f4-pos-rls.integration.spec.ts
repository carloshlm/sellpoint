import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F4-DB-01: aislamiento por
 * tenant de las tres tablas del punto de venta, y las invariantes que la BASE
 * defiende por su cuenta.
 *
 * **Los canarios son de COMPORTAMIENTO, no de catálogo.** La lección del
 * checklist de cierre de F3 (2026-08-20): `product_lots` y `stock_lots` solo
 * tenían el test estructural de `pg_class` — la policy EXISTÍA, pero nadie
 * probaba que filtrara, y una policy que existe no es una policy que filtra.
 * La contraprueba de aquel día (borrarla) no habría tirado ni un test. Acá van
 * los cuatro canónicos más el estructural, que sigue haciendo falta porque el
 * FORCE solo se ve mirando el catálogo: la app conecta como `sellpoint_app`,
 * que no es owner, y a un no-owner la RLS se le aplica con FORCE o sin él.
 */
describe("RLS y guardas del punto de venta (F4-DB-01)", () => {
  const TABLAS = ["cashbox_sessions", "sales", "sale_items"] as const;

  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let usuarioAId: string;
  let almacenAId: string;
  let sesionAId: string;
  let ventaAId: string;
  let productoAId: string;
  let servicioAId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant POS A ${stamp}` } }),
      prisma.tenant.create({ data: { name: `Tenant POS B ${stamp}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    await prisma.withTenantContext(tenantAId, async (tx) => {
      const usuario = await tx.user.create({
        data: {
          tenantId: tenantAId,
          email: `pos-${stamp}@example.com`,
          passwordHash: "x",
          firstName: "Ana",
          lastNamePaternal: "Pérez",
        },
      });
      const almacen = await tx.warehouse.create({
        data: { tenantId: tenantAId, name: `Central POS ${stamp}` },
      });
      const producto = await tx.product.create({
        data: { tenantId: tenantAId, sku: `POS-${stamp}`, name: "Paracetamol" },
      });
      const servicio = await tx.service.create({
        data: { tenantId: tenantAId, code: `SVC-${stamp}`, name: "Consulta" },
      });
      const sesion = await tx.cashboxSession.create({
        data: { tenantId: tenantAId, warehouseId: almacen.id, openedBy: usuario.id },
      });
      const venta = await tx.sale.create({
        data: {
          tenantId: tenantAId,
          folio: `VTA-${stamp}`,
          warehouseId: almacen.id,
          cashboxSessionId: sesion.id,
          paymentMethod: "cash",
          subtotal: "100.00",
          total: "100.00",
          createdBy: usuario.id,
        },
      });
      await tx.saleItem.create({
        data: {
          tenantId: tenantAId,
          saleId: venta.id,
          lineNo: 1,
          productId: producto.id,
          quantity: "2",
          unitPrice: "50.00",
          lineTotal: "100.00",
        },
      });

      usuarioAId = usuario.id;
      almacenAId = almacen.id;
      productoAId = producto.id;
      servicioAId = servicio.id;
      sesionAId = sesion.id;
      ventaAId = venta.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function contar(tabla: string, tenantId?: string): Promise<number> {
    const query = (client: { $queryRawUnsafe: <T>(sql: string) => Promise<T> }) =>
      client
        .$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "${tabla}"`)
        .then((rows) => Number(rows[0]?.count ?? -1));

    return tenantId
      ? prisma.withTenantContext(tenantId, (tx) =>
          query(tx as unknown as { $queryRawUnsafe: <T>(sql: string) => Promise<T> }),
        )
      : query(prisma);
  }

  describe("los cuatro canarios de COMPORTAMIENTO", () => {
    for (const tabla of TABLAS) {
      it(`${tabla}: ve sus filas con su contexto y CERO con el de otro tenant`, async () => {
        expect(await contar(tabla, tenantAId)).toBeGreaterThanOrEqual(1);
        expect(await contar(tabla, tenantBId)).toBe(0);
      });

      it(`${tabla}: sin set_config no devuelve filas`, async () => {
        expect(await contar(tabla)).toBe(0);
      });
    }

    it("escribir un turno con el tenant de otro es rechazado (canario del WITH CHECK)", async () => {
      await expect(
        prisma.withTenantContext(tenantBId, (tx) =>
          tx.cashboxSession.create({
            data: { tenantId: tenantAId, warehouseId: almacenAId, openedBy: usuarioAId },
          }),
        ),
      ).rejects.toThrow();
    });

    it("la venta de otro tenant es invisible, no solo inaccesible", async () => {
      const encontrada = await prisma.withTenantContext(tenantBId, (tx) =>
        tx.sale.findUnique({ where: { id: ventaAId } }),
      );

      expect(encontrada).toBeNull();
    });
  });

  it("las tres tablas tienen la policy tenant_isolation con ENABLE y FORCE", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY(ARRAY['cashbox_sessions','sales','sale_items'])
       ORDER BY c.relname`;

    expect(rows.map((r) => r.relname)).toEqual(["cashbox_sessions", "sale_items", "sales"]);
    for (const row of rows) {
      expect({ tabla: row.relname, enable: row.relrowsecurity }).toEqual({
        tabla: row.relname,
        enable: true,
      });
      expect({ tabla: row.relname, force: row.relforcerowsecurity }).toEqual({
        tabla: row.relname,
        force: true,
      });
      expect({ tabla: row.relname, policies: Number(row.policies) }).toEqual({
        tabla: row.relname,
        policies: 1,
      });
    }
  });

  /**
   * El CHECK que justifica la tabla: una línea sin producto ni servicio no es
   * una línea incompleta, es una IMPOSIBLE. Va en la base porque con dos
   * columnas nullable el primer bug de un mapper la escribe.
   */
  describe("una línea es un producto O un servicio, nunca los dos ni ninguno", () => {
    const linea = (extra: Record<string, unknown>) => ({
      tenantId: tenantAId,
      saleId: ventaAId,
      quantity: "1",
      unitPrice: "10.00",
      lineTotal: "10.00",
      ...extra,
    });

    it("con NINGUNA referencia se rechaza", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.saleItem.create({ data: linea({ lineNo: 90 }) as never }),
        ),
      ).rejects.toThrow();
    });

    it("con LAS DOS se rechaza", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.saleItem.create({
            data: linea({ lineNo: 91, productId: productoAId, serviceId: servicioAId }) as never,
          }),
        ),
      ).rejects.toThrow();
    });

    it("con una sola pasa: un servicio también es una línea válida", async () => {
      const creada = await prisma.withTenantContext(tenantAId, (tx) =>
        tx.saleItem.create({ data: linea({ lineNo: 92, serviceId: servicioAId }) as never }),
      );

      expect(creada.serviceId).toBe(servicioAId);
      expect(creada.productId).toBeNull();
    });

    it("un servicio no se vende «por caja»: la presentación es de productos", async () => {
      const presentacion = await prisma.withTenantContext(tenantAId, (tx) =>
        tx.productPresentation.create({
          data: {
            tenantId: tenantAId,
            productId: productoAId,
            name: "Caja",
            factor: "12",
            allowFractionalInput: false,
          },
        }),
      );

      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.saleItem.create({
            data: linea({
              lineNo: 93,
              serviceId: servicioAId,
              presentationId: presentacion.id,
            }) as never,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  /**
   * La invariante del módulo. Es un UNIQUE PARCIAL y no un guard del service
   * porque dos pestañas abriendo turno a la vez pasan cualquier chequeo que
   * lea antes de escribir.
   */
  describe("un solo turno abierto por usuario", () => {
    it("abrir un segundo turno con uno vivo choca contra la base", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.cashboxSession.create({
            data: { tenantId: tenantAId, warehouseId: almacenAId, openedBy: usuarioAId },
          }),
        ),
      ).rejects.toThrow();
    });

    it("cerrado el anterior, se puede abrir otro: un turno viejo no encierra a nadie", async () => {
      await prisma.withTenantContext(tenantAId, (tx) =>
        tx.cashboxSession.update({
          where: { id: sesionAId },
          data: { status: "closed", closedBy: usuarioAId, closedAt: new Date() },
        }),
      );

      const nuevo = await prisma.withTenantContext(tenantAId, (tx) =>
        tx.cashboxSession.create({
          data: { tenantId: tenantAId, warehouseId: almacenAId, openedBy: usuarioAId },
        }),
      );

      expect(nuevo.status).toBe("open");
    });
  });

  /**
   * La deuda que `services.remove` arrastraba con un `TODO(F4)` desde F3: la
   * base lo hace IMPOSIBLE; el 409 amable (`services.has_sales`) llega en
   * F4-SALE-01.
   */
  it("un servicio ya vendido no se puede borrar (FK RESTRICT)", async () => {
    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.service.delete({ where: { id: servicioAId } }),
      ),
    ).rejects.toThrow();
  });
});
