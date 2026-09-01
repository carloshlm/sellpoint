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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CatalogRecordsService } from "./catalog-records.service";
import { CatalogRecordsImportService } from "./catalog-records-import.service";
import { type ImportRecordsDto, importRecordsSchema } from "./dto/import-records.dto";
import {
  type CreateRecordDto,
  createRecordSchema,
  type UpdateRecordDto,
  updateRecordSchema,
} from "./dto/upsert-record.dto";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F2-CAT-05/06. Cargar registros es operación diaria (`catalogs:write`, que
 * Manager sí tiene); leerlos, `catalogs:read`. Definir la estructura sigue
 * siendo `catalogs:manage` y vive en el controller de campos.
 *
 * `GET /catalogs/:id/records` sirve dos cosas con la misma ruta: la tabla del
 * subcatálogo y, con `?query=`, el picker de un lookup que apunta acá.
 */
@ApiTags("catalogs")
@Controller("catalogs/:catalogId/records")
export class CatalogRecordsController {
  constructor(
    private readonly recordsService: CatalogRecordsService,
    private readonly importService: CatalogRecordsImportService,
  ) {}

  /**
   * Importar por Excel (Carlos, 2026-09-01) — para cualquier subcatálogo, con
   * el mismo contrato que productos, servicios y almacenes: la plantilla trae
   * lo ya dado de alta y el match es por código.
   */
  @Get("import/template")
  @RequirePermissions("catalogs:write")
  async importTemplate(
    @Param("catalogId") catalogId: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const { body, contentType, filename } = await this.importService.template(user, catalogId);
    response
      .setHeader("Content-Type", contentType)
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .send(body);
  }

  @Post("import")
  @HttpCode(200)
  @RequirePermissions("catalogs:write")
  import(
    @Param("catalogId") catalogId: string,
    @Body(new ZodValidationPipe(importRecordsSchema, "catalogs.invalid_body"))
    dto: ImportRecordsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.importService.run(
      user,
      catalogId,
      dto.content,
      {
        dryRun: dto.dryRun,
        skipErrors: dto.skipErrors,
        locale: getLocale(request as Request & RequestWithLocale),
      },
      metaFrom(request),
    );
  }

  @Get()
  @RequirePermissions("catalogs:read")
  list(
    @Param("catalogId") catalogId: string,
    @Query("query") query: string | undefined,
    @CurrentUser() user: AuthUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    // Con `query` responde opciones {id, code, display} listas para el picker;
    // sin él, la PÁGINA de filas para la tabla. Un `page` basura cae al
    // default en el service, no a un 500.
    if (query !== undefined) {
      return this.recordsService.options(user, catalogId, query);
    }
    const parsedPage = Number(page);
    const parsedSize = Number(pageSize);
    return this.recordsService.list(user, catalogId, {
      ...(Number.isFinite(parsedPage) ? { page: Math.floor(parsedPage) } : {}),
      ...(Number.isFinite(parsedSize) ? { pageSize: Math.floor(parsedSize) } : {}),
    });
  }

  @Get("options")
  @RequirePermissions("catalogs:read")
  options(
    @Param("catalogId") catalogId: string,
    @Query("query") query: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recordsService.options(user, catalogId, query);
  }

  @Post()
  @RequirePermissions("catalogs:write")
  create(
    @Param("catalogId") catalogId: string,
    @Body(new ZodValidationPipe(createRecordSchema, "catalogs.invalid_body")) dto: CreateRecordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.recordsService.create(user, catalogId, dto, metaFrom(request));
  }

  @Patch(":recordId")
  @RequirePermissions("catalogs:write")
  update(
    @Param("catalogId") catalogId: string,
    @Param("recordId") recordId: string,
    @Body(new ZodValidationPipe(updateRecordSchema, "catalogs.invalid_body")) dto: UpdateRecordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.recordsService.update(user, catalogId, recordId, dto, metaFrom(request));
  }

  // El mismo guard que archivar: referenciado por lookup -> 409
  // catalogs.record_referenced. Ver el docblock de `remove` en el service.
  @Delete(":recordId")
  @HttpCode(204)
  @RequirePermissions("catalogs:write")
  remove(
    @Param("catalogId") catalogId: string,
    @Param("recordId") recordId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.recordsService.remove(user, catalogId, recordId, metaFrom(request));
  }
}
