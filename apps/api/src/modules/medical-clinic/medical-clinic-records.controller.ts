import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import {
  type CreateRecordDto,
  createRecordSchema,
  type ListRecordsQuery,
  listRecordsQuerySchema,
} from "./dto/records.dto";
import { MedicalLetterPdfService } from "./medical-letter-pdf.service";
import { RecordsService } from "./records.service";
import { SectionsService } from "./sections.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-CLINIC-10/11/12 — la historia clínica. TODO con `medical_clinic:attend`:
 * `:read` mira catálogos, nunca un expediente (la recepcionista no lee).
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic/records")
export class MedicalClinicRecordsController {
  constructor(
    private readonly records: RecordsService,
    private readonly sections: SectionsService,
    private readonly letters: MedicalLetterPdfService,
    private readonly i18n: I18nService,
  ) {}

  @Post()
  @RequirePermissions("medical_clinic:attend")
  create(
    @Body(new ZodValidationPipe(createRecordSchema, "medical_clinic.invalid_body"))
    dto: CreateRecordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.records.create(user, dto, metaFrom(request));
  }

  @Get()
  @RequirePermissions("medical_clinic:attend")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listRecordsQuerySchema, "medical_clinic.invalid_query"))
    query: ListRecordsQuery,
  ) {
    return this.records.list(user, query);
  }

  @Get(":id")
  @RequirePermissions("medical_clinic:attend")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.records.detail(user, id);
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermissions("medical_clinic:attend")
  close(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.records.close(user, id, metaFrom(request));
  }

  @Get(":id/sections/:key")
  @RequirePermissions("medical_clinic:attend")
  getSection(@Param("id") id: string, @Param("key") key: string, @CurrentUser() user: AuthUser) {
    return this.sections.get(user, id, key);
  }

  /** El cuerpo se valida contra el schema de la clave, no con un pipe fijo. */
  @Put(":id/sections/:key")
  @RequirePermissions("medical_clinic:attend")
  saveSection(
    @Param("id") id: string,
    @Param("key") key: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.sections.save(user, id, key, body, metaFrom(request));
  }

  /**
   * F9-CLINIC-DOC-05 — la carta (nota de referencia o solicitud de
   * interconsulta) de un ítem de la sección, por índice. Se LEE: sin el
   * candado del expediente, porque el paciente vuelve por su hoja cuando la
   * consulta ya venció. Binario: el front lo baja con `responseType: 'blob'`.
   */
  @Get(":id/sections/:key/items/:index/document")
  @RequirePermissions("medical_clinic:attend")
  async letter(
    @Param("id") id: string,
    @Param("key") key: string,
    @Param(
      "index",
      new ZodValidationPipe(z.coerce.number().int().min(0), "medical_clinic.invalid_query"),
    )
    index: number,
    @CurrentUser() user: AuthUser,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.letters.render(user, id, key, index, (k) =>
      this.i18n.translate(k, { lang: locale }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }
}
