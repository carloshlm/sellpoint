import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [AuditModule],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
