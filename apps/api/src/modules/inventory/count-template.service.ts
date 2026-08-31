import { Injectable } from "@nestjs/common";
import { type SpreadsheetFormat, serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertActiveWarehouse, assertWarehouseInScope } from "./warehouse-scope.helpers";

/**
 * Las columnas de la plantilla de conteo. En español porque es COPY: lo lee
 * una persona en Excel (LEY de idioma — lo que lee una máquina va en inglés).
 *
 * `nombre` y `unidad` están de más para el sistema y son imprescindibles para
 * quien cuenta: sin ellas, contar es adivinar a qué corresponde un SKU. La
 * importación lee por NOMBRE de columna e ignora las que no conoce, así que
 * agregarlas no rompe el round-trip.
 */
const COLUMNAS = [
  "sku",
  "nombre",
  "unidad",
  "lote",
  "caducidad",
  "ubicacion",
  "teorico",
  "contado",
] as const;

/**
 * F3-COUNT-01 — la plantilla de inventario físico, con el teórico ya puesto.
 *
 * **Una sola plantilla para todo**, que es exactamente el Excel del cliente de
 * Carlos: los productos con `tracks_lots` ocupan una fila por (lote,
 * ubicación); los demás una fila con esas columnas vacías. Partirla en dos
 * archivos obligaría a quien cuenta a saber de antemano qué producto maneja
 * lote — que es justo lo que viene a averiguar contando.
 *
 * El teórico se escribe en el archivo para que quien cuenta pueda comparar en
 * el momento, pero **no es el que se usa al aprobar**: ahí se relee fresco. Un
 * conteo puede tardar horas, y el saldo puede moverse mientras tanto.
 */
@Injectable()
export class CountTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    user: AuthUser,
    scope: UserScope,
    warehouseId: string,
    format: SpreadsheetFormat,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    assertWarehouseInScope(scope, warehouseId);

    const filas = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);

      // El orden por recorrido solo tiene sentido si el negocio usa
      // ubicaciones: para quien no las llena, ordenar por una columna vacía
      // sería barajar la hoja sin motivo. `tenants` no lleva RLS.
      const { usesLocations } = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { usesLocations: true },
      });

      // Un compuesto NO tiene existencias propias: se arma al consumirlo, así
      // que contarlo no significa nada.
      const productos = await tx.product.findMany({
        where: { tenantId: user.tenantId, isActive: true, isComposite: false },
        // Quien USA ubicaciones cuenta por RECORRIDO del almacén: una hoja de
        // 300 líneas en cualquier otro orden obliga a cruzarlo en zigzag.
        // `nulls: "last"` deja al final los que no tienen ubicación — son los
        // que hay que buscar, y ponerlos primero castigaría a quien sí ordenó
        // su catálogo (Carlos, 2026-08-30).
        //
        // Quien no las usa cuenta por NOMBRE, no por SKU (Carlos, 2026-08-31):
        // el que camina el almacén con la hoja en la mano lee "Aceite de oliva
        // 1L", no "ACT-0091". Ordenar por un código que nadie tiene memorizado
        // es ordenar para la máquina. Y el nombre manda también DENTRO de cada
        // ubicación, por lo mismo.
        orderBy: usesLocations
          ? [{ location: { sort: "asc", nulls: "last" } }, { name: "asc" }]
          : { name: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          baseUnit: true,
          tracksLots: true,
          location: true,
        },
      });
      const productIds = productos.map((p) => p.id);

      const [saldos, porLote] = await Promise.all([
        tx.stockByWarehouse.findMany({
          where: { warehouseId, productId: { in: productIds } },
          select: { productId: true, quantity: true },
        }),
        tx.stockLot.findMany({
          where: { warehouseId, quantity: { gt: 0 }, lot: { productId: { in: productIds } } },
          select: {
            location: true,
            quantity: true,
            lot: { select: { productId: true, lotCode: true, expiresAt: true } },
          },
          // El MISMO orden que FEFO: lo que vence antes va primero, así el
          // recorrido del estante coincide con el del papel.
          orderBy: [
            { lot: { expiresAt: "asc" } },
            { lot: { lotCode: "asc" } },
            { location: "asc" },
          ],
        }),
      ]);

      const saldoPorProducto = new Map(saldos.map((s) => [s.productId, s.quantity.toString()]));
      const lotesPorProducto = new Map<string, typeof porLote>();
      for (const fila of porLote) {
        const actual = lotesPorProducto.get(fila.lot.productId) ?? [];
        actual.push(fila);
        lotesPorProducto.set(fila.lot.productId, actual);
      }

      const cuerpo: string[][] = [];
      for (const producto of productos) {
        const lotes = lotesPorProducto.get(producto.id) ?? [];

        // Con lotes pero sin ninguno cargado sale igual, con la fila vacía: es
        // la única forma de dar de alta el PRIMER lote desde la planilla.
        if (!producto.tracksLots || lotes.length === 0) {
          cuerpo.push([
            producto.sku,
            producto.name,
            producto.baseUnit,
            "",
            "",
            "",
            producto.tracksLots ? "0" : (saldoPorProducto.get(producto.id) ?? "0"),
            "",
          ]);
          continue;
        }

        for (const fila of lotes) {
          cuerpo.push([
            producto.sku,
            producto.name,
            producto.baseUnit,
            fila.lot.lotCode,
            fila.lot.expiresAt?.toISOString().slice(0, 10) ?? "",
            fila.location,
            fila.quantity.toString(),
            "",
          ]);
        }
      }

      return cuerpo;
    });

    const file = await serializeSpreadsheet([[...COLUMNAS], ...filas], format);
    return { ...file, filename: `conteo-fisico.${format}` };
  }
}
