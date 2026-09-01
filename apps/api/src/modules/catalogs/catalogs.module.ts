import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CatalogFieldsController } from "./catalog-fields.controller";
import { CatalogFieldsService } from "./catalog-fields.service";
import { CatalogRecordsController } from "./catalog-records.controller";
import { CatalogRecordsService } from "./catalog-records.service";
import { CatalogRecordsImportService } from "./catalog-records-import.service";
import { CatalogsController } from "./catalogs.controller";
import { CatalogsService } from "./catalogs.service";

// F2-CAT: el motor de catálogos. Exporta el service porque los módulos de
// campos y registros (F2-CAT-03/05) resuelven el catálogo por él.
@Module({
  imports: [AuditModule],
  controllers: [CatalogsController, CatalogFieldsController, CatalogRecordsController],
  providers: [
    CatalogsService,
    CatalogFieldsService,
    CatalogRecordsService,
    CatalogRecordsImportService,
  ],
  exports: [CatalogsService, CatalogFieldsService, CatalogRecordsService],
})
export class CatalogsModule {}
