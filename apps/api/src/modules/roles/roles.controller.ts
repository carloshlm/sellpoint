import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { type CreateRoleDto, createRoleSchema } from "./dto/create-role.dto";
import { type UpdateRoleDto, updateRoleSchema } from "./dto/update-role.dto";
import { RolesService } from "./roles.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

// F1-RBAC-04. Todos los endpoints exigen `roles:manage`/`roles:read`
// (PermissionsGuard global, F1-RBAC-01) además del JwtAuthGuard secure by
// default (f1-auth AD-8) — ningún endpoint acá lleva @Public().
@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions("roles:manage")
  create(
    @Body(new ZodValidationPipe(createRoleSchema, "roles.invalid_body")) dto: CreateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.rolesService.create(user, dto, metaFrom(request));
  }

  @Get()
  @RequirePermissions("roles:read")
  list(@CurrentUser() user: AuthUser) {
    return this.rolesService.list(user);
  }

  @Patch(":id")
  @RequirePermissions("roles:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRoleSchema, "roles.invalid_body")) dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.rolesService.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("roles:manage")
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.rolesService.remove(user, id, metaFrom(request));
  }
}
