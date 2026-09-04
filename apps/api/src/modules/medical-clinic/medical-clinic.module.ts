import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PosModule } from "../pos/pos.module";
import { ReceptionModule } from "../reception/reception.module";
import { DiagnosticStudiesService } from "./diagnostic-studies.service";
import { LabStudiesService } from "./lab-studies.service";
import { MedicalClinicDashboardController } from "./medical-clinic-dashboard.controller";
import { MedicalClinicDashboardService } from "./medical-clinic-dashboard.service";
import { MedicalClinicDiagnosticStudiesController } from "./medical-clinic-diagnostic-studies.controller";
import { MedicalClinicLabStudiesController } from "./medical-clinic-lab-studies.controller";
import { MedicalClinicOrdersController } from "./medical-clinic-orders.controller";
import { MedicalClinicPatientsController } from "./medical-clinic-patients.controller";
import { MedicalClinicRecordsController } from "./medical-clinic-records.controller";
import { MedicalClinicSettingsController } from "./medical-clinic-settings.controller";
import { MedicalOrderPdfService } from "./medical-order-pdf.service";
import { MedicalOrdersService } from "./medical-orders.service";
import { PatientsService } from "./patients.service";
import { RecordsService } from "./records.service";
import { SectionsService } from "./sections.service";
import { SettingsService } from "./settings.service";
import { StockSearchService } from "./stock-search.service";
import { DiagnosticStudyImportService, LabStudyImportService } from "./study-import.service";

/**
 * F9-CLINIC — Consultorio Médico, el segundo módulo vertical: catálogos de
 * estudios, la historia clínica (un expediente por visita) y las órdenes
 * médicas que se cobran en caja como cotizaciones. Se activa por negocio
 * desde el backoffice; sin el módulo, sus controllers responden 402.
 *
 * Importa Recepción (el paciente es `customers`, el turno es de Recepción) y
 * el POS (la orden crea su cotización con la MISMA resolución de precios y
 * busca medicamentos con el MISMO buscador): no duplica nada de los dos.
 */
@Module({
  imports: [AuditModule, ReceptionModule, PosModule],
  controllers: [
    MedicalClinicLabStudiesController,
    MedicalClinicDiagnosticStudiesController,
    MedicalClinicSettingsController,
    MedicalClinicPatientsController,
    MedicalClinicRecordsController,
    MedicalClinicOrdersController,
    MedicalClinicDashboardController,
  ],
  providers: [
    MedicalClinicDashboardService,
    LabStudiesService,
    DiagnosticStudiesService,
    LabStudyImportService,
    DiagnosticStudyImportService,
    SettingsService,
    PatientsService,
    StockSearchService,
    RecordsService,
    SectionsService,
    MedicalOrdersService,
    MedicalOrderPdfService,
  ],
  exports: [SettingsService],
})
export class MedicalClinicModule {}
