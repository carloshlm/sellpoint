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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { DiagnosticStudiesService } from "./diagnostic-studies.service";
import {
  type CreateStudyDto,
  createStudySchema,
  type ListStudiesQuery,
  listStudiesQuerySchema,
  type UpdateStudyDto,
  updateStudySchema,
} from "./dto/upsert-study.dto";

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
  constructor(private readonly studies: DiagnosticStudiesService) {}

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
