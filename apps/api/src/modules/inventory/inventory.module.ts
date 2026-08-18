import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DocumentsService } from "./documents.service";

/**
 * F3-CORE-02 — el módulo de la Fase 3.
 *
 * `PrismaService` es global (ver `PrismaModule`), así que solo se importa lo
 * que no lo es. `AuditModule` porque cada movimiento asentado deja rastro en
 * la MISMA transacción que lo escribe (F3-CORE-07).
 */
@Module({
  imports: [AuditModule],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class InventoryModule {}
