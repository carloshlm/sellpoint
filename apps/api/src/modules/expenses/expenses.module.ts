import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ExpenseCategoriesController } from "./expense-categories.controller";
import { ExpenseCategoriesService } from "./expense-categories.service";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { ExpensesExportService } from "./expenses-export.service";
import { ExpensesSummaryService } from "./expenses-summary.service";

/**
 * F9-EXP — Gastos: egresos operativos que no tocan inventario. Incluido desde
 * Basic (`MODULE_MIN_PLAN`); sin el módulo, sus controllers responden 402.
 * El POS lee la tabla `expenses` por su cuenta para el arqueo (F9-EXP-09):
 * no importa este módulo, para no cerrar un ciclo con él.
 *
 * El orden de `controllers` importa: `expenses/categories` se registra ANTES
 * que `expenses/:id`, o «categories» caería en el `:id`.
 */
@Module({
  imports: [AuditModule],
  controllers: [ExpenseCategoriesController, ExpensesController],
  providers: [
    ExpenseCategoriesService,
    ExpensesService,
    ExpensesSummaryService,
    ExpensesExportService,
  ],
  exports: [ExpenseCategoriesService, ExpensesService],
})
export class ExpensesModule {}
