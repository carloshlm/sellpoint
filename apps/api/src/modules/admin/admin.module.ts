import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { ReportsModule } from "../reports/reports.module";
import { UsersModule } from "../users/users.module";
import { AdminTenantsController } from "./admin-tenants.controller";
import { AdminTenantsService } from "./admin-tenants.service";

/**
 * F9-ADMIN — el expediente del negocio en el backoffice. Lo que es DINERO
 * (pagos, plan, módulos) sigue en `admin/billing`; acá viven los datos de
 * operación del negocio: resumen, usuarios, dashboard y reportes, reusando
 * los services de esos módulos con un actor sintético.
 */
@Module({
  imports: [AuditModule, BillingModule, UsersModule, ReportsModule],
  controllers: [AdminTenantsController],
  providers: [AdminTenantsService],
})
export class AdminModule {}
