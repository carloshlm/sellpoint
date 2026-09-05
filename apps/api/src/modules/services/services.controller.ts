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
import { type ImportServicesDto, importServicesSchema } from "./dto/import-services.dto";
import {
  type CreateServiceDto,
  createServiceSchema,
  type ListServicesQuery,
  listServicesQuerySchema,
  type UpdateServiceDto,
  updateServiceSchema,
} from "./dto/upsert-service.dto";
import { ServicesService } from "./services.service";
import { ServicesImportService } from "./services-import.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F3-SVC-03. Un servicio NO mueve inventario, pero SÍ tiene almacenes
 * (F3-SVC-07): el catálogo es maestro del tenant y cada servicio declara en
 * qué almacenes se ofrece. Esa lista viaja en el create/update — vive en el
 * form, no en una pantalla aparte, así que servicio y asociaciones se escriben
 * en una sola transacción.
 */
@ApiTags("services")
@Controller("services")
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly importService: ServicesImportService,
  ) {}

  /** La plantilla trae los servicios ya dados de alta — editar y resubir. */
  @Get("import/template")
  @RequirePermissions("services:manage")
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
  @RequirePermissions("services:manage")
  import(
    @Body(new ZodValidationPipe(importServicesSchema, "services.invalid_body"))
    dto: ImportServicesDto,
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

  @Get()
  @RequirePermissions("services:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listServicesQuerySchema, "services.invalid_query"))
    query: ListServicesQuery,
  ) {
    return this.servicesService.list(user, query);
  }

  @Post()
  @RequirePermissions("services:manage")
  create(
    @Body(new ZodValidationPipe(createServiceSchema, "services.invalid_body"))
    dto: CreateServiceDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.servicesService.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("services:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateServiceSchema, "services.invalid_body"))
    dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.servicesService.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("services:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.servicesService.remove(user, id, metaFrom(request));
  }
}
