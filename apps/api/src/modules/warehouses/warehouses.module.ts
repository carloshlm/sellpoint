import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { WarehousesController } from "./warehouses.controller";
import { WarehousesService } from "./warehouses.service";
import { WarehousesImportService } from "./warehouses-import.service";

@Module({
  imports: [AuditModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehousesImportService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
