import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";

// PermEpochService y CLOCK son globales (RedisModule / ClockModule) — no
// hace falta importarlos acá.
@Module({
  imports: [AuditModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
