import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CatalogsService } from "./catalogs.service";
import { type CreateCatalogDto, createCatalogSchema } from "./dto/create-catalog.dto";
import { type UpdateCatalogDto, updateCatalogSchema } from "./dto/update-catalog.dto";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F2-CAT-02. Asimetría deliberada de permisos: LEER catálogos es parte de la
 * operación diaria (`catalogs:read`, lo tiene hasta Viewer), pero crear o
 * modificar la ESTRUCTURA es `catalogs:manage` — solo Admin, porque
 * cambia la forma de los datos de todo el negocio.
 *
 * No hay DELETE a propósito: archivar es `PATCH { isActive: false }`. Borrar
 * un catálogo se llevaría sus registros y los lookups que apuntan a ellos.
 */
@ApiTags("catalogs")
@Controller("catalogs")
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Get()
  @RequirePermissions("catalogs:read")
  list(@CurrentUser() user: AuthUser) {
    return this.catalogsService.list(user);
  }

  @Post()
  @RequirePermissions("catalogs:manage")
  create(
    @Body(new ZodValidationPipe(createCatalogSchema, "catalogs.invalid_body"))
    dto: CreateCatalogDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.catalogsService.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("catalogs:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCatalogSchema, "catalogs.invalid_body"))
    dto: UpdateCatalogDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.catalogsService.update(user, id, dto, metaFrom(request));
  }
}
