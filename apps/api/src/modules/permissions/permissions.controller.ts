import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { PermissionsService } from "./permissions.service";

// F1-RBAC-05: protegido con `roles:read` — el único consumidor pensado es
// el editor de roles (RBAC-04), que ya exige ese permiso para leer /roles.
@ApiTags("permissions")
@Controller("permissions")
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions("roles:read")
  list() {
    return this.permissionsService.listGroupedByModule();
  }
}
