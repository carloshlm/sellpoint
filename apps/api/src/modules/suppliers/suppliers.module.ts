import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";

/**
 * F9-SUPPL — el catálogo de proveedores. Core, sin módulo que lo encienda:
 * Compras (F9-PURCH) y Gastos (F9-EXP) lo importan para resolver la FK.
 */
@Module({
  imports: [AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
