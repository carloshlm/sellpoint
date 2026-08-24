import { Module } from "@nestjs/common";
import { WeightedCostService } from "./weighted-cost.service";

/**
 * El costo promedio ponderado es TRANSVERSAL: lo consumen el BOM (F5-COST-02)
 * y la valorización del reporte de stock (F5-STK-03).
 *
 * Vive en su propio módulo y no dentro de inventario justamente por eso:
 * `InventoryModule` ya importa `ProductsModule`, así que colgar el costeo de
 * ahí haría que productos dependiera de inventario y cerraría un ciclo. Sin
 * dependencias propias —solo Prisma, que es global— no puede crear ninguno.
 */
@Module({
  providers: [WeightedCostService],
  exports: [WeightedCostService],
})
export class CostModule {}
