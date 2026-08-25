import { Injectable } from "@nestjs/common";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import type { SpreadsheetFormat } from "../../common/spreadsheet/spreadsheet";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { KardexService } from "./kardex.service";
import { LotsService } from "./lots.service";

/**
 * F5-EXP — vencimientos y tránsito en Excel.
 *
 * ── Por qué viven en `inventory` y no en `reports` ──────────────────────
 *
 * Porque el permiso es `inventory:read`: son la MISMA lectura de su pantalla
 * en otro formato, y exigir `reports:read` para bajar lo que ya se está
 * viendo sería una puerta sobre una puerta abierta (criterio «reimprimir es
 * leer» de F4-UI-03). Colgarlos del módulo de reportes con el permiso de
 * inventario habría sido una rareza que el próximo lector tendría que
 * descifrar.
 */
@Injectable()
export class InventoryExportService {
  constructor(
    private readonly lots: LotsService,
    private readonly kardex: KardexService,
  ) {}

  /**
   * F5-EXP-01 — los lotes por vencer.
   *
   * La UBICACIÓN es columna (directiva de Carlos, 2026-08-24): quien va a
   * retirar la mercancía que se echa a perder necesita saber a qué estante ir,
   * y el dato ya viaja en la consulta de la pantalla.
   *
   * Los YA VENCIDOS salen con días en NEGATIVO, no escondidos: son los que más
   * urge sacar del almacén.
   */
  async expiring(
    user: AuthUser,
    scope: UserScope,
    options: { days: number; warehouseId?: string },
    format: SpreadsheetFormat,
  ) {
    const filas = await this.lots.listExpiring(user, scope, options);

    return exportWithLimit({
      count: async () => filas.length,
      rows: async () =>
        filas.map((fila) => [
          fila.name,
          fila.sku,
          fila.lot.lotCode,
          fila.lot.expiresAt.toISOString().slice(0, 10),
          String(fila.daysLeft),
          fila.warehouse.name,
          fila.location,
          fila.quantity,
        ]),
      header: [
        "Producto",
        "SKU",
        "Lote",
        "Caduca",
        "Días restantes",
        "Almacén",
        "Ubicación",
        "Cantidad",
      ],
      format,
      sheetName: "Vencimientos",
      filenameBase: "vencimientos",
    });
  }

  /**
   * F5-EXP-02 — lo que salió y todavía no llegó.
   *
   * Usa `inTransitDetail` y no `inTransit`: el archivo se baja para RASTREAR,
   * así que necesita cada partida con su origen, su destino y su folio. El
   * agregado de la pantalla no sirve para eso — ver el docblock del servicio.
   *
   * **Sin columna de ubicación**, a diferencia de vencimientos: un traspaso
   * guarda el lote pero NO una ubicación (`TransferLine` no la tiene), porque
   * la decide el destino al recibir. Exportar una columna que la base no
   * guarda sería inventarla.
   */
  async inTransit(
    user: AuthUser,
    scope: UserScope,
    options: { productId?: string; originWarehouseId?: string },
    format: SpreadsheetFormat,
  ) {
    const filas = await this.kardex.inTransitDetail(user, scope, options);

    return exportWithLimit({
      count: async () => filas.length,
      rows: async () =>
        filas.map((fila) => [
          fila.name,
          fila.sku,
          fila.lotCode ?? "",
          fila.origin,
          fila.destination,
          fila.quantity,
          fila.folio ?? "",
          fila.sentAt.toISOString().slice(0, 10),
        ]),
      header: ["Producto", "SKU", "Lote", "Origen", "Destino", "Cantidad", "Folio", "Salió"],
      format,
      sheetName: "En tránsito",
      filenameBase: "en-transito",
    });
  }
}
