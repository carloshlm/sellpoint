import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PosModule } from "../pos/pos.module";
import { ReceptionModule } from "../reception/reception.module";

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
  controllers: [],
  providers: [],
  exports: [],
})
export class MedicalClinicModule {}
