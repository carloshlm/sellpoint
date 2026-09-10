import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ExpenseCategoriesController } from "./expense-categories.controller";
import { ExpenseCategoriesService } from "./expense-categories.service";

/**
 * F9-EXP — Gastos: egresos operativos que no tocan inventario. Incluido desde
 * Basic (`MODULE_MIN_PLAN`); sin el módulo, sus controllers responden 402.
 * El POS lee la tabla `expenses` por su cuenta para el arqueo (F9-EXP-09):
 * no importa este módulo, para no cerrar un ciclo con él.
 */
@Module({
  imports: [AuditModule],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService],
  exports: [ExpenseCategoriesService],
})
export class ExpensesModule {}
