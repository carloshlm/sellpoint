import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { ReportsService } from "./reports.service";

/**
 * F5-CORE-03 — la puerta de `reports:read`.
 *
 * El permiso vive en producción desde la migración `20260821180000` y hasta
 * hoy NINGÚN endpoint lo exigía: lo delató `permissions-catalog.spec.ts`
 * buscando huérfanos. Un permiso sin puerta no se puede ejercer ni probar, y
 * este controller es la primera.
 *
 * **Sin `UserScope` en el catálogo, a propósito.** El alcance por almacén
 * acota DATOS de almacén y acá no hay ninguno: la lista de reportes es la
 * misma para todo el tenant. Los endpoints que sí traen datos —`/reports/stock`
 * (F5-STK-01), `/reports/sales` (F5-SALES-01)— lo reciben y lo aplican; pedirlo
 * acá sería un parámetro decorativo que insinúa un filtrado que no ocurre.
 */
@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @RequirePermissions("reports:read")
  catalog() {
    return this.reportsService.catalog();
  }
}
