import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CheckPlanLimit } from "../billing/decorators/check-plan-limit.decorator";
import {
  type CreateWarehouseDto,
  createWarehouseSchema,
  type UpdateWarehouseDto,
  updateWarehouseSchema,
} from "./dto/upsert-warehouse.dto";
import { WarehousesService } from "./warehouses.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

@ApiTags("warehouses")
@Controller("warehouses")
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  /**
   * `?scoped=true` acota a los almacenes ACTIVOS dentro del alcance del
   * usuario — es lo que consumen los selectores de la Fase 3, para que un
   * Manager no pueda ni siquiera elegir un almacén que no administra.
   *
   * Sin el flag, el comportamiento de F2 queda intacto: la pantalla de
   * administración de almacenes los lista todos.
   */
  @Get()
  @RequirePermissions("warehouses:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query("scoped") scoped?: string,
  ) {
    return scoped === "true"
      ? this.warehousesService.listScoped(user, scope)
      : this.warehousesService.list(user);
  }

  @CheckPlanLimit("warehouses")
  @Post()
  @RequirePermissions("warehouses:manage")
  create(
    @Body(new ZodValidationPipe(createWarehouseSchema, "warehouses.invalid_body"))
    dto: CreateWarehouseDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.warehousesService.create(user, dto, metaFrom(request));
  }

  // Solo un almacén que nunca operó (409 warehouses.has_history si no) —
  // ver el docblock de `WarehousesService.remove`.
  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("warehouses:manage")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.warehousesService.remove(user, id, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("warehouses:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema, "warehouses.invalid_body"))
    dto: UpdateWarehouseDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.warehousesService.update(user, id, dto, metaFrom(request));
  }
}
