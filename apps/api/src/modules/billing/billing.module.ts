import { Module } from "@nestjs/common";
import { RedisModule } from "../../infrastructure/redis/redis.module";
import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../mail/mail.module";
import { BillingService } from "./billing.service";
import { EntitlementsService } from "./entitlements.service";
import { SalesPlanGate } from "./sales-plan.gate";

/**
 * F7-CORE — el motor de suscripciones y cobro manual.
 *
 * Exporta los dos servicios porque los consumen de fuera: el
 * SubscriptionGuard y el gate del POS resuelven entitlements (F7-GUARD /
 * F7-POS), y el backoffice del dueño opera BillingService (F7-ADMIN). Los
 * controllers llegan con esos módulos.
 */
@Module({
  imports: [RedisModule, AuditModule, MailModule],
  providers: [EntitlementsService, BillingService, SalesPlanGate],
  exports: [EntitlementsService, BillingService, SalesPlanGate],
})
export class BillingModule {}
