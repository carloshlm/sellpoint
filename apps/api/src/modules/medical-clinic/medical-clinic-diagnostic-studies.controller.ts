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
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { DiagnosticStudiesService } from "./diagnostic-studies.service";
import { type ImportStudiesDto, importStudiesSchema } from "./dto/import-studies.dto";
import {
  type CreateStudyDto,
  createStudySchema,
  type ListStudiesQuery,
  listStudiesQuerySchema,
  type UpdateStudyDto,
  updateStudySchema,
} from "./dto/upsert-study.dto";
import { DiagnosticStudyImportService } from "./study-import.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-CLINIC-08 — el catálogo de estudios diagnósticos. `@RequiresModule("medical_clinic")` a nivel de CLASE: sin el módulo,
 * el controller entero responde 402, también las lecturas. `:read` mira,
 * `:manage` administra.
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic/diagnostic-studies")
export class MedicalClinicDiagnosticStudiesController {
  constructor(
    private readonly studies: DiagnosticStudiesService,
    private readonly importService: DiagnosticStudyImportService,
  ) {}

  /** La plantilla trae los estudios ya dados de alta — editar y resubir. */
  @Get("import/template")
  @RequirePermissions("medical_clinic:manage")
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
  @RequirePermissions("medical_clinic:manage")
  import(
    @Body(new ZodValidationPipe(importStudiesSchema, "medical_clinic.invalid_body"))
    dto: ImportStudiesDto,
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
  @RequirePermissions("medical_clinic:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listStudiesQuerySchema, "medical_clinic.invalid_query"))
    query: ListStudiesQuery,
  ) {
    return this.studies.list(user, query);
  }

  @Get(":id")
  @RequirePermissions("medical_clinic:read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.studies.get(user, id);
  }

  @Post()
  @RequirePermissions("medical_clinic:manage")
  create(
    @Body(new ZodValidationPipe(createStudySchema, "medical_clinic.invalid_body"))
    dto: CreateStudyDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.studies.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("medical_clinic:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStudySchema, "medical_clinic.invalid_body"))
    dto: UpdateStudyDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.studies.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("medical_clinic:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.studies.remove(user, id, metaFrom(request));
  }
}
