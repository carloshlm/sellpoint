import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { I18nService } from "nestjs-i18n";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresFeature } from "../billing/decorators/requires-feature.decorator";
import { ConfirmService } from "./confirm.service";
import { CountTemplateService } from "./count-template.service";
import { DocumentImportService } from "./document-import.service";
import { DocumentLinesService } from "./document-lines.service";
import { DocumentPdfService } from "./document-pdf.service";
import { DocumentsService } from "./documents.service";
import {
  type CancelDocumentDto,
  type CreateDocumentDto,
  cancelDocumentSchema,
  createDocumentSchema,
  type DocumentTemplateQueryDto,
  documentTemplateQuerySchema,
  type ImportDocumentLinesDto,
  importDocumentLinesSchema,
  type ListDocumentsQueryDto,
  listDocumentsQuerySchema,
  type ReplaceDocumentLinesDto,
  replaceDocumentLinesSchema,
  type UpdateDocumentDto,
  type UpsertDocumentLineDto,
  updateDocumentSchema,
  upsertDocumentLineSchema,
} from "./dto/document.dto";

/**
 * F3-DOC-04/06 — el documento de inventario y sus líneas.
 *
 * Crear el borrador es `inventory:movement` y no `:read`: es el acto que toma
 * un folio de la serie. Leer el detalle sí es `:read`, porque el listado y la
 * consulta los usa cualquiera que audite.
 */
@ApiTags("inventory")
@RequiresFeature("movements")
@Controller("inventory/documents")
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly lines: DocumentLinesService,
    private readonly imports: DocumentImportService,
    private readonly confirmService: ConfirmService,
    private readonly pdfService: DocumentPdfService,
    private readonly i18n: I18nService,
    private readonly countTemplate: CountTemplateService,
  ) {}

  /**
   * La plantilla vacía, con las columnas del tipo y una fila de ejemplo. Va
   * ANTES de `:id` en el orden de rutas: si estuviera después, Nest tomaría
   * "template" como un id.
   */
  @Get("template")
  @RequirePermissions("inventory:movement")
  async template(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(documentTemplateQuerySchema, "inventory.invalid_body"))
    query: DocumentTemplateQueryDto,
    @Res() response: Response,
  ) {
    // Con `warehouseId` y tipo conteo, la plantilla sale POBLADA con el
    // teórico de ese almacén. Sin él —o para los otros tipos— es la vacía con
    // su fila de ejemplo.
    const file =
      query.type === "physical_count" && query.warehouseId !== undefined
        ? await this.countTemplate.build(user, scope, query.warehouseId, query.format)
        : await this.imports.template(query.type, query.format);
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  /**
   * Crea el borrador con su folio y devuelve el id para que la pantalla
   * navegue a él. Es el botón «Crear entrada» de los tres listados.
   */
  @Post()
  @RequirePermissions("inventory:movement")
  create(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Body(new ZodValidationPipe(createDocumentSchema, "inventory.invalid_body"))
    dto: CreateDocumentDto,
  ) {
    return this.documents.createDraft(user, dto, scope);
  }

  /**
   * El listado de una serie. Los tres menús son el mismo componente con
   * distinto `type`, así que el filtro es obligatorio.
   */
  @Get()
  @RequirePermissions("inventory:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listDocumentsQuerySchema, "inventory.invalid_body"))
    query: ListDocumentsQueryDto,
  ) {
    return this.documents.list(user, query, scope);
  }

  @Get(":id")
  @RequirePermissions("inventory:read")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.detail(user, id);
  }

  /**
   * El PDF firmable. Binario y no base64 en JSON: el front lo baja con axios
   * `responseType: 'blob'` porque un `<a href>` plano iría sin el Bearer.
   */
  @Get(":id/pdf")
  @RequirePermissions("inventory:read")
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.pdfService.render(user, id, (key) =>
      this.i18n.translate(key, { lang: locale }),
    );

    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  /** Autoguardado de la cabecera: motivo, referencia, nota, autorizador. */
  @Patch(":id")
  @RequirePermissions("inventory:movement")
  updateHeader(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema, "inventory.invalid_body"))
    dto: UpdateDocumentDto,
  ) {
    return this.documents.updateHeader(user, id, dto);
  }

  /**
   * Sella el documento: escribe los movimientos, mueve el stock y lo deja
   * confirmado. No lleva body — todo está en el borrador.
   */
  @Post(":id/confirm")
  @RequirePermissions("inventory:movement")
  confirm(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
  ) {
    return this.confirmService.confirm(user, id, scope);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("inventory:movement")
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelDocumentSchema, "inventory.invalid_body"))
    dto: CancelDocumentDto,
  ) {
    return this.documents.cancel(user, id, dto.reason);
  }

  @Post(":id/lines")
  @RequirePermissions("inventory:movement")
  addLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(upsertDocumentLineSchema, "inventory.invalid_body"))
    dto: UpsertDocumentLineDto,
  ) {
    return this.lines.add(user, id, dto);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermissions("inventory:movement")
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(upsertDocumentLineSchema.partial(), "inventory.invalid_body"))
    dto: Partial<UpsertDocumentLineDto>,
  ) {
    return this.lines.update(user, id, lineId, dto);
  }

  @Delete(":id/lines/:lineId")
  @HttpCode(204)
  @RequirePermissions("inventory:movement")
  async removeLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    await this.lines.remove(user, id, lineId);
  }

  /**
   * Carga las líneas desde un Excel o CSV. Las filas con error **igual entran**
   * marcadas: el destino es un borrador, que existe para corregirse en
   * pantalla en vez de obligar a editar el archivo y volver a subirlo.
   */
  @Post(":id/lines/import")
  @HttpCode(200)
  @RequirePermissions("inventory:movement")
  importLines(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(importDocumentLinesSchema, "inventory.invalid_body"))
    dto: ImportDocumentLinesDto,
  ) {
    return this.imports.importLines(user, id, dto);
  }

  /** Reemplazo masivo: el pegado desde una planilla. */
  @Put(":id/lines")
  @HttpCode(200)
  @RequirePermissions("inventory:movement")
  replaceLines(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceDocumentLinesSchema, "inventory.invalid_body"))
    dto: ReplaceDocumentLinesDto,
  ) {
    return this.lines.replace(user, id, dto);
  }
}
