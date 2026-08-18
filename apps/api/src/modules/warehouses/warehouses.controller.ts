import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
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
