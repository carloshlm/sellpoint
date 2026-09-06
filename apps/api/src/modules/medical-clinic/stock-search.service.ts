import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { LookupService } from "../pos/lookup.service";
import type { LookupProductItem } from "../pos/lookup.strategies";
import { hideStock } from "../pos/stock-visibility";
import type { StockSearchQuery } from "./dto/stock-search.dto";

/**
 * F9-CLINIC-13 — los medicamentos que el médico puede recetar: los del STOCK
 * de su almacén asignado, con el MISMO buscador del POS (`LookupService`,
 * que ya acepta `warehouseId` explícito sin caja abierta). El médico no
 * necesita `pos:sell`: este endpoint se gatea con `medical_clinic:attend`.
 * Solo productos: un servicio no se receta.
 */
@Injectable()
export class StockSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: LookupService,
  ) {}

  async search(user: AuthUser, scope: UserScope, query: StockSearchQuery) {
    const warehouseId = await this.almacenDelMedico(user);
    const resultado = await this.lookup.search(user, scope, {
      q: query.q,
      limit: query.limit,
      warehouseId,
    });
    const productos = resultado.items.filter((i): i is LookupProductItem => i.type === "product");
    // «Mostrar existencias al recetar» (Carlos, 2026-09-05): apagado, el dato
    // no viaja —misma regla que el punto de venta—. Es la configuración del
    // CONSULTORIO, no la del POS: un negocio puede querer una y no la otra.
    const ajustes = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.medicalClinicSettings.findUnique({
        where: { tenantId: user.tenantId },
        select: { showsStock: true },
      }),
    );
    return {
      warehouseId,
      items: ajustes?.showsStock === false ? hideStock(productos) : productos,
    };
  }

  /** El almacén asignado del médico; sin él no hay stock que mirar. */
  async almacenDelMedico(user: AuthUser): Promise<string> {
    const fila = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findFirst({
        where: { id: user.userId, tenantId: user.tenantId },
        select: { defaultWarehouseId: true },
      }),
    );
    if (fila?.defaultWarehouseId == null) {
      throw new NotFoundException({ message: "medical_clinic.no_default_warehouse" });
    }
    return fila.defaultWarehouseId;
  }
}
