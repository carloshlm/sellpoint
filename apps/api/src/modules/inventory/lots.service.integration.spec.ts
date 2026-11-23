import { ConfigService } from "@nestjs/config";
import ExcelJS from "exceljs";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { WeightedCostService } from "../cost/weighted-cost.service";
import { InventoryExportService } from "./inventory-export.service";
import type { KardexService } from "./kardex.service";
import { LotsService } from "./lots.service";

/**
 * Integration (Postgres REAL) — F10-KPI-09: cuánto vale lo que vence.
 *
 * «14 piezas vencen en 6 días» no mueve a nadie; «$4,300 vencen este mes»,
 * sí. Cada fila de `listExpiring` gana su costo promedio ponderado y su valor
 * (cantidad × ese costo), con el MISMO `WeightedCostService` con que el panel
 * valora el inventario.
 *
 * Es dinero, así que viaja solo con `reports:read`, como `inventoryValue`:
 * sin el permiso los dos campos ni siquiera existen en la fila. La pantalla
 * de «Próximos a vencer» es de `inventory:read`, y quien solo opera el
 * almacén ve la misma lista de siempre.
 *
 * Integración y no unit con dobles: el costo sale de una consulta al libro
 * mayor y un mock solo probaría que escribí lo que pensé.
 */
describe("LotsService.listExpiring — cuánto vale lo que vence (F10-KPI-09)", () => {
  let prisma: PrismaService;
  let lots: LotsService;
  let exportaciones: InventoryExportService;
  let tenantId: string;
  let userId: string;
  let warehouseId: string;
  let documentId: string;
  let costeadoId: string;
  let sinCompraId: string;
  let stamp: number;

  const SCOPE = { warehouseIds: "all" as const };
  const dueno = (): AuthUser => ({
    userId,
    tenantId,
    permissions: ["inventory:read", "reports:read"],
    locale: "es",
  });
  const almacenista = (): AuthUser => ({
    userId,
    tenantId,
    permissions: ["inventory:read"],
    locale: "es",
  });

  /** Una fecha a N días de hoy, como la guarda la columna DATE. */
  function enDias(dias: number): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + dias);
    return d;
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    lots = new LotsService(prisma, new AuditService(), new WeightedCostService(prisma));
    exportaciones = new InventoryExportService(lots, {} as KardexService);

    stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant vence ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: `vence-${stamp}@example.com`,
          passwordHash: "x",
          firstName: "Ana",
          lastName: "Pérez",
        },
      });
      userId = user.id;

      const warehouse = await tx.warehouse.create({
        data: {
          tenantId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central vence ${stamp}`,
        },
      });
      warehouseId = warehouse.id;

      const costeado = await tx.product.create({
        data: { tenantId, sku: `VC-${stamp}`, name: "Suero costeado", tracksLots: true },
      });
      costeadoId = costeado.id;
      const sinCompra = await tx.product.create({
        data: { tenantId, sku: `VS-${stamp}`, name: "Muestra sin compra", tracksLots: true },
      });
      sinCompraId = sinCompra.id;

      // Las existencias que vencen: 3 del costeado en 10 días y 2 del que
      // nunca se compró en 5.
      for (const [productId, lotCode, dias, quantity] of [
        [costeadoId, "C-10", 10, 3],
        [sinCompraId, "S-5", 5, 2],
      ] as const) {
        const lot = await tx.productLot.create({
          data: { tenantId, productId, lotCode, expiresAt: enDias(dias) },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId, location: "A-1", quantity },
        });
      }

      // Todo movimiento cuelga de un documento: lo exige el CHECK
      // `stock_movements_document_xor_sale`. Uno alcanza; aquí se prueba el
      // valor, no el papeleo.
      const document = await tx.inventoryDocument.create({
        data: {
          tenantId,
          folio: `ENT-${String(stamp).slice(-6)}`,
          type: "entry",
          status: "confirmed",
          warehouseId,
          reasonCode: "invoice",
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: new Date(),
        },
      });
      documentId = document.id;
    });

    // Dos compras a distinto costo: 10 a $5.00 y 20 a $9.01.
    // Ponderado: (50 + 180.20) / 30 = 7.67333…  El promedio SIMPLE daría
    // 7.005 → «7.01»: justo el error que la primera prueba existe para cazar.
    for (const [quantity, unitCost] of [
      ["10", "5.00"],
      ["20", "9.01"],
    ] as const) {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.create({
          data: {
            tenantId,
            documentId,
            productId: costeadoId,
            warehouseId,
            direction: "entry",
            reasonCode: "invoice",
            quantity,
            unitCost,
            createdBy: userId,
          },
        }),
      );
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const filaDe = <T extends { productId: string }>(filas: T[], productId: string): T => {
    const fila = filas.find((f) => f.productId === productId);
    if (fila === undefined) {
      throw new Error(`sin fila para ${productId}`);
    }
    return fila;
  };

  it("dos compras a distinto costo dan el promedio PONDERADO y el valor de la fila", async () => {
    const filas = await lots.listExpiring(dueno(), SCOPE, { days: 30 });

    const fila = filaDe(filas, costeadoId);
    // El valor multiplica el costo ENTERO (7.67333… × 3 = 23.02), no el de la
    // celda redondeada (7.67 × 3 = 23.01): el mismo criterio con que el panel
    // suma el valor del inventario.
    expect({ unitCost: fila.unitCost, value: fila.value }).toEqual({
      unitCost: "7.67",
      value: "23.02",
    });
  });

  it("un producto que nunca se compró con costo da `null`, no un cero", async () => {
    const filas = await lots.listExpiring(dueno(), SCOPE, { days: 30 });

    const fila = filaDe(filas, sinCompraId);
    expect(fila).toHaveProperty("unitCost", null);
    expect(fila).toHaveProperty("value", null);
  });

  /**
   * ⚠ La contraprueba del dinero: sin `reports:read`, la fila es EXACTAMENTE
   * la de antes de F10-KPI-09. Ni el campo con `null`: un `null` dice «no sé
   * cuánto costó», y aquí la respuesta es «no te toca saberlo».
   */
  it("sin `reports:read` la fila no trae costo ni valor: es la misma de siempre", async () => {
    const filas = await lots.listExpiring(almacenista(), SCOPE, { days: 30 });

    expect(Array.isArray(filas)).toBe(true);
    const fila = filaDe(filas, costeadoId);
    expect(fila).not.toHaveProperty("unitCost");
    expect(fila).not.toHaveProperty("value");
    expect(fila).toEqual({
      productId: costeadoId,
      sku: `VC-${stamp}`,
      name: "Suero costeado",
      lot: { id: expect.any(String), lotCode: "C-10", expiresAt: enDias(10) },
      warehouse: { id: warehouseId, name: `Central vence ${stamp}` },
      location: "A-1",
      quantity: "3",
      daysLeft: 10,
      expired: false,
    });
  });

  describe("el Excel de vencimientos", () => {
    async function hoja(user: AuthUser): Promise<ExcelJS.Worksheet> {
      const { body } = await exportaciones.expiring(user, SCOPE, { days: 30 }, "xlsx");
      const workbook = new ExcelJS.Workbook();
      type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(body as unknown as XlsxInput);
      const sheet = workbook.worksheets[0];
      if (sheet === undefined) {
        throw new Error("sin hoja");
      }
      return sheet;
    }

    const encabezados = (sheet: ExcelJS.Worksheet) =>
      (sheet.getRow(1).values as unknown[]).slice(1).map(String);

    const LAS_DE_SIEMPRE = [
      "Producto",
      "SKU",
      "Lote",
      "Caduca",
      "Días restantes",
      "Sucursal",
      "Ubicación",
      "Cantidad",
    ];

    it("con `reports:read` gana «Costo promedio» y «Valor» AL FINAL, como números", async () => {
      const sheet = await hoja(dueno());

      expect(encabezados(sheet)).toEqual([...LAS_DE_SIEMPRE, "Costo promedio", "Valor"]);
      const filas = new Map<string, ExcelJS.Row>();
      sheet.eachRow((row, numero) => {
        if (numero > 1) {
          filas.set(String(row.getCell(1).value), row);
        }
      });
      const costeado = filas.get("Suero costeado");
      expect(costeado?.getCell(9).value).toBe(7.67);
      expect(costeado?.getCell(10).value).toBe(23.02);
      // Sin costo, la celda queda vacía: un 0 se sumaría en el Excel y mentiría.
      const sinCompra = filas.get("Muestra sin compra");
      expect([sinCompra?.getCell(9).value, sinCompra?.getCell(10).value]).toEqual(["", ""]);
    });

    it("sin `reports:read` las columnas son las de siempre, en el mismo orden", async () => {
      const sheet = await hoja(almacenista());

      expect(encabezados(sheet)).toEqual(LAS_DE_SIEMPRE);
    });
  });
});
