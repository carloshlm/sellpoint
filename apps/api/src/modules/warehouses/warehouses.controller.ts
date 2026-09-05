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
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CheckPlanLimit } from "../billing/decorators/check-plan-limit.decorator";
import { type ImportWarehousesDto, importWarehousesSchema } from "./dto/import-warehouses.dto";
import {
  type CreateWarehouseDto,
  createWarehouseSchema,
  type UpdateWarehouseDto,
  updateWarehouseSchema,
} from "./dto/upsert-warehouse.dto";
import { WarehousesService } from "./warehouses.service";
import { WarehousesImportService } from "./warehouses-import.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

@ApiTags("warehouses")
@Controller("warehouses")
export class WarehousesController {
  constructor(
    private readonly warehousesService: WarehousesService,
    private readonly importService: WarehousesImportService,
  ) {}

  /**
   * Importar por Excel (Carlos, 2026-09-01) — mismo contrato que productos y
   * servicios: la plantilla trae lo ya dado de alta y el match es por código.
   * Va ANTES de las rutas con `:id`: `import/template` no es un identificador.
   */
  @Get("import/template")
  @RequirePermissions("warehouses:manage")
  async importTemplate(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { body, contentType, filename } = await this.importService.template(
      user,
      getLocale(request as Request & RequestWithLocale),
    );
    response
      .setHeader("Content-Type", contentType)
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .send(body);
  }

  @Post("import")
  @HttpCode(200)
  @RequirePermissions("warehouses:manage")
  import(
    @Body(new ZodValidationPipe(importWarehousesSchema, "warehouses.invalid_body"))
    dto: ImportWarehousesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.importService.run(
      user,
      dto.content,
      {
        dryRun: dto.dryRun,
        skipErrors: dto.skipErrors,
        locale: getLocale(request as Request & RequestWithLocale),
      },
      metaFrom(request),
    );
  }

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
