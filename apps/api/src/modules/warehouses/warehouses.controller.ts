import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
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

  @Get()
  @RequirePermissions("warehouses:read")
  list(@CurrentUser() user: AuthUser) {
    return this.warehousesService.list(user);
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
