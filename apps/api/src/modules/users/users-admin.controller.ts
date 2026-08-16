import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { type CreateUserDto, createUserSchema } from "./dto/create-user.dto";
import {
  type ReplaceWarehouseScopeDto,
  replaceWarehouseScopeSchema,
} from "./dto/replace-warehouse-scope.dto";
import { type UpdateUserDto, updateUserSchema } from "./dto/update-user.dto";
import { UsersAdminService } from "./users-admin.service";
import { WarehouseScopeService } from "./warehouse-scope.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

// F1-RBAC-03. Distinto de `UsersController` (`PATCH /me`, self-service) —
// acá vive el CRUD administrativo, todo protegido por `users:manage`/
// `users:read` (PermissionsGuard global).
@ApiTags("users")
@Controller("users")
export class UsersAdminController {
  constructor(
    private readonly usersAdminService: UsersAdminService,
    private readonly warehouseScopeService: WarehouseScopeService,
  ) {}

  @Post()
  @RequirePermissions("users:manage")
  create(
    @Body(new ZodValidationPipe(createUserSchema, "users.invalid_body")) dto: CreateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersAdminService.create(user, dto, metaFrom(request));
  }

  @Get()
  @RequirePermissions("users:read")
  list(@CurrentUser() user: AuthUser) {
    return this.usersAdminService.list(user);
  }

  /**
   * F2-SCOPE-02 (CU-SYS-04). Lista VACÍA = sin restricción: el interceptor le
   * da todos los almacenes (default permisivo). No es "no ve nada".
   */
  @Get(":id/warehouse-scope")
  @RequirePermissions("users:manage")
  getWarehouseScope(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.warehouseScopeService.get(user, id);
  }

  @Put(":id/warehouse-scope")
  @RequirePermissions("users:manage")
  replaceWarehouseScope(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceWarehouseScopeSchema, "users.invalid_body"))
    dto: ReplaceWarehouseScopeDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.warehouseScopeService.replace(user, id, dto.warehouseIds, metaFrom(request));
  }

  @Get(":id")
  @RequirePermissions("users:read")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.usersAdminService.findOne(user, id);
  }

  @Patch(":id")
  @RequirePermissions("users:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema, "users.invalid_body")) dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersAdminService.update(user, id, dto, metaFrom(request));
  }

  // 200, no 201: es una transición de estado sobre un recurso existente, no
  // una creación (default de Nest para @Post sería 201).
  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermissions("users:manage")
  suspend(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.usersAdminService.suspend(user, id, metaFrom(request));
  }

  // Gap S1: re-emitir la invitación cuando el mail se pierde o vence.
  // `users:manage` (el mismo permiso que la creó) y 200 — igual que
  // suspend/reactivate, es una acción sobre un recurso existente.
  @Post(":id/resend-invitation")
  @HttpCode(200)
  @RequirePermissions("users:manage")
  resendInvitation(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersAdminService.resendInvitation(user, id, metaFrom(request));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @RequirePermissions("users:manage")
  reactivate(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.usersAdminService.reactivate(user, id, metaFrom(request));
  }
}
