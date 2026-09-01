import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ServicesController } from "./services.controller";
import { ServicesService } from "./services.service";
import { ServicesImportService } from "./services-import.service";

@Module({
  imports: [AuditModule],
  controllers: [ServicesController],
  providers: [ServicesService, ServicesImportService],
  exports: [ServicesService],
})
export class ServicesModule {}
