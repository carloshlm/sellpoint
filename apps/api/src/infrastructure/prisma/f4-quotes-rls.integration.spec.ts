import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F4-DB-02: aislamiento por
 * tenant de `quotes`/`quote_lines` y las invariantes que la base defiende.
 *
 * Canarios de COMPORTAMIENTO más el estructural, por la misma razón que en
 * F4-DB-01: una policy que existe no es una policy que filtra (lección del
 * checklist de cierre de F3).
 */
describe("RLS y guardas de la cotización (F4-DB-02)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let usuarioAId: string;
  let almacenAId: string;
  let productoAId: string;
  let servicioAId: string;
  let cotizacionAId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant COT A ${stamp}` } }),
      prisma.tenant.create({ data: { name: `Tenant COT B ${stamp}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    await prisma.withTenantContext(tenantAId, async (tx) => {
      const usuario = await tx.user.create({
        data: {
          tenantId: tenantAId,
          email: `cot-${stamp}@example.com`,
          passwordHash: "x",
          firstName: "Recep",
          lastNamePaternal: "Ción",
        },
      });
      const almacen = await tx.warehouse.create({
        data: {
          tenantId: tenantAId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central COT ${stamp}`,
        },
      });
      const producto = await tx.product.create({
        data: { tenantId: tenantAId, sku: `COT-${stamp}`, name: "Jarabe" },
      });
      const servicio = await tx.service.create({
        data: { tenantId: tenantAId, code: `SC-${stamp}`, name: "Consulta" },
      });
      const cotizacion = await tx.quote.create({
        data: {
          tenantId: tenantAId,
          folio: `COT-${stamp}`,
          warehouseId: almacen.id,
          total: "265.00",
          createdBy: usuario.id,
        },
      });
      await tx.quoteLine.create({
        data: {
          tenantId: tenantAId,
          quoteId: cotizacion.id,
          lineNo: 1,
          productId: producto.id,
          description: "Jarabe",
          quantity: "1",
          unitPrice: "15.00",
          lineTotal: "15.00",
        },
      });

      usuarioAId = usuario.id;
      almacenAId = almacen.id;
      productoAId = producto.id;
      servicioAId = servicio.id;
      cotizacionAId = cotizacion.id;
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

  describe("los canarios de COMPORTAMIENTO", () => {
    for (const tabla of ["quotes", "quote_lines"]) {
      it(`${tabla}: ve sus filas con su contexto y CERO con el de otro tenant`, async () => {
        expect(await contar(tabla, tenantAId)).toBeGreaterThanOrEqual(1);
        expect(await contar(tabla, tenantBId)).toBe(0);
      });

      it(`${tabla}: sin set_config no devuelve filas`, async () => {
        expect(await contar(tabla)).toBe(0);
      });
    }

    it("escribir una cotización con el tenant de otro es rechazado (WITH CHECK)", async () => {
      await expect(
        prisma.withTenantContext(tenantBId, (tx) =>
          tx.quote.create({
            data: {
              tenantId: tenantAId,
              folio: `INTRUSA-${Date.now()}`,
              warehouseId: almacenAId,
              total: "1.00",
              createdBy: usuarioAId,
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it("las dos tablas tienen la policy tenant_isolation con ENABLE y FORCE", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY['quotes','quote_lines'])
       ORDER BY c.relname`;

    expect(rows.map((r) => r.relname)).toEqual(["quote_lines", "quotes"]);
    for (const row of rows) {
      expect({
        tabla: row.relname,
        enable: row.relrowsecurity,
        force: row.relforcerowsecurity,
        policies: Number(row.policies),
      }).toEqual({ tabla: row.relname, enable: true, force: true, policies: 1 });
    }
  });

  /**
   * **Cotizar no mueve stock, y eso es estructural.** No basta con que el
   * service no escriba movimientos: la tabla no tiene por dónde referenciarlos.
   */
  it("una cotización no puede referenciar el ledger ni un documento de inventario", async () => {
    const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('quotes', 'quote_lines')`;
    const nombres = columnas.map((c) => c.column_name);

    expect(nombres).not.toContain("stock_movement_id");
    expect(nombres).not.toContain("document_id");
    expect(nombres).not.toContain("inventory_document_id");

    // Y ninguna FK sale hacia el ledger.
    const fks = await prisma.$queryRaw<{ referenced: string }[]>`
      SELECT ccu.table_name AS referenced
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name IN ('quotes', 'quote_lines')`;
    const destinos = [...new Set(fks.map((f) => f.referenced))];

    expect(destinos).not.toContain("stock_movements");
    expect(destinos).not.toContain("inventory_documents");
    expect(destinos).not.toContain("stock_by_warehouse");
  });

  /**
   * Sin vigencia por diseño: los precios son de REFERENCIA y el POS los
   * recalcula al cargarla, así que no hay promesa que pueda vencer.
   */
  it("no tiene vigencia ni estado `expired`: la decisión se ve en el schema", async () => {
    const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'quotes'`;
    expect(columnas.map((c) => c.column_name)).not.toContain("valid_until");

    const estados = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'QuoteStatus' ORDER BY e.enumsortorder`;
    expect(estados.map((e) => e.enumlabel)).toEqual(["open", "loaded", "canceled"]);
  });

  describe("una línea es un producto O un servicio", () => {
    const linea = (extra: Record<string, unknown>) => ({
      tenantId: tenantAId,
      quoteId: cotizacionAId,
      description: "X",
      quantity: "1",
      unitPrice: "10.00",
      lineTotal: "10.00",
      ...extra,
    });

    it("con NINGUNA referencia se rechaza", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.quoteLine.create({ data: linea({ lineNo: 80 }) as never }),
        ),
      ).rejects.toThrow();
    });

    it("con LAS DOS se rechaza", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.quoteLine.create({
            data: linea({ lineNo: 81, productId: productoAId, serviceId: servicioAId }) as never,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  /**
   * **Esta prueba nació al revés y el CHECK me corrigió.**
   *
   * La escribí afirmando que borrar un servicio COTIZADO debía permitirse (una
   * cotización es un papel, no una venta) con las FKs en SET NULL. Falló: al
   * anular la referencia, la línea queda con CERO y viola su propio CHECK de
   * «exactamente uno». Las dos reglas no podían convivir.
   *
   * Se conservó el CHECK fuerte y las FKs pasaron a RESTRICT. El costo, dicho
   * sin adornos: un ítem cotizado ya no se BORRA — se DESACTIVA, que es el
   * camino que el catálogo ya ofrece y que su diálogo de borrado nombra. Se
   * prefirió un error ruidoso con salida conocida antes que una línea vacía,
   * que sería silenciosa y saldría impresa en el papel del cliente.
   */
  it("un servicio cotizado no se puede borrar: se desactiva (FK RESTRICT)", async () => {
    const servicio = await prisma.withTenantContext(tenantAId, async (tx) => {
      const creado = await tx.service.create({
        data: { tenantId: tenantAId, code: `DEL-${Date.now()}`, name: "Temporal" },
      });
      await tx.quoteLine.create({
        data: {
          tenantId: tenantAId,
          quoteId: cotizacionAId,
          lineNo: 82,
          serviceId: creado.id,
          description: "Servicio temporal",
          quantity: "1",
          unitPrice: "50.00",
          lineTotal: "50.00",
        },
      });
      return creado;
    });

    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.service.delete({ where: { id: servicio.id } }),
      ),
    ).rejects.toThrow();

    // Desactivarlo sí: es la salida que el producto ya ofrece.
    const desactivado = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.service.update({ where: { id: servicio.id }, data: { isActive: false } }),
    );
    expect(desactivado.isActive).toBe(false);
  });

  it("una cotización cargada no puede quedar sin su marca de tiempo (CHECK de estado)", async () => {
    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.quote.update({ where: { id: cotizacionAId }, data: { status: "loaded" } }),
      ),
    ).rejects.toThrow();
  });
});
