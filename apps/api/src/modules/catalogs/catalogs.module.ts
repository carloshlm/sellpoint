import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CatalogsController } from "./catalogs.controller";
import { CatalogsService } from "./catalogs.service";

// F2-CAT: el motor de catálogos. Exporta el service porque los módulos de
// campos y registros (F2-CAT-03/05) resuelven el catálogo por él.
@Module({
  imports: [AuditModule],
  controllers: [CatalogsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
