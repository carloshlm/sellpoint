import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CostModule } from "../cost/cost.module";
import { ProductsModule } from "../products/products.module";
import { ConfirmService } from "./confirm.service";
import { CountTemplateService } from "./count-template.service";
import { DocumentImportService } from "./document-import.service";
import { DocumentLinesService } from "./document-lines.service";
import { DocumentPdfService } from "./document-pdf.service";
import { DocumentSpreadsheetService } from "./document-spreadsheet";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { InventoryExportService } from "./inventory-export.service";
import { KardexController } from "./kardex.controller";
import { KardexService } from "./kardex.service";
import { LotsController } from "./lots.controller";
import { LotsService } from "./lots.service";
import { StockLedgerService } from "./stock-ledger.service";
import { TransfersController } from "./transfers.controller";
import { TransfersService } from "./transfers.service";

/**
 * F3-CORE-02 — el módulo de la Fase 3.
 *
 * `PrismaService` es global (ver `PrismaModule`), así que solo se importa lo
 * que no lo es. `AuditModule` porque cada movimiento asentado deja rastro en
 * la MISMA transacción que lo escribe (F3-CORE-07). `CostModule` porque
 * «Próximos a vencer» dice cuánto vale lo que vence (F10-KPI-09); no cierra
 * ningún ciclo: el costeo no depende de nadie.
 */
@Module({
  imports: [AuditModule, CostModule, ProductsModule],
  controllers: [DocumentsController, LotsController, TransfersController, KardexController],
  providers: [
    DocumentsService,
    DocumentLinesService,
    DocumentImportService,
    StockLedgerService,
    ConfirmService,
    InventoryExportService,
    DocumentPdfService,
    DocumentSpreadsheetService,
    LotsService,
    TransfersService,
    CountTemplateService,
    KardexService,
  ],
  exports: [
    DocumentsService,
    DocumentLinesService,
    DocumentImportService,
    StockLedgerService,
    ConfirmService,
    DocumentPdfService,
    LotsService,
    TransfersService,
    CountTemplateService,
    KardexService,
  ],
})
export class InventoryModule {}
