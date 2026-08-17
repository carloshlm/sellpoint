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
import { CompositionService } from "./composition.service";
import { type ImportProductsDto, importProductsSchema } from "./dto/import-products.dto";
import {
  type ReplaceCompositionDto,
  replaceCompositionSchema,
} from "./dto/replace-composition.dto";
import {
  type CreatePresentationDto,
  createPresentationSchema,
  type UpdatePresentationDto,
  updatePresentationSchema,
} from "./dto/upsert-presentation.dto";
import {
  type CreateProductDto,
  createProductSchema,
  listProductsQuerySchema,
  type UpdateProductDto,
  updateProductSchema,
} from "./dto/upsert-product.dto";
import { ImportService } from "./import.service";
import { PresentationsService } from "./presentations.service";
import { ProductsService } from "./products.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F2-PROD / F2-PRESENT / F2-BOM. Leer es `products:read` (lo tiene hasta
 * POS_Seller, que necesita ver el catálogo para vender); escribir cualquier
 * cosa —producto, presentación o composición— es `products:manage`.
 */
@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly presentationsService: PresentationsService,
    private readonly compositionService: CompositionService,
    private readonly importService: ImportService,
  ) {}

  /**
   * F2-IMPORT-01. `?format=xlsx` devuelve la planilla de Excel; por omisión,
   * CSV con BOM (Excel lo abre nativo y respeta los acentos). Las columnas
   * salen de los campos vigentes del catálogo y las filas, de los productos ya
   * dados de alta: descargar, editar y volver a subir es el camino principal.
   */
  @Get("import/template")
  @RequirePermissions("products:manage")
  async template(
    @Query("format") rawFormat: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const format = rawFormat === "xlsx" ? "xlsx" : "csv";
    const { body, contentType, filename } = await this.importService.template(user, format);
    response
      .setHeader("Content-Type", contentType)
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .send(body);
  }

  /**
   * F2-IMPORT-02/03. `dryRun` devuelve el reporte sin escribir nada; sin él,
   * importa. El contenido viaja como texto en JSON y no como multipart: evita
   * una dependencia de parseo de formularios por un endpoint que se usa poco.
   */
  @Post("import")
  @HttpCode(200)
  @RequirePermissions("products:manage")
  import(
    @Body(new ZodValidationPipe(importProductsSchema, "products.invalid_body"))
    dto: ImportProductsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.importService.run(
      user,
      dto.content,
      {
        format: dto.format,
        dryRun: dto.dryRun,
        skipErrors: dto.skipErrors,
        // El dry-run responde 200, así que su reporte NO pasa por el filtro de
        // excepciones: el locale tiene que llegar hasta el service para que los
        // errores por fila salgan traducidos igual que los demás.
        locale: getLocale(request as Request & RequestWithLocale),
      },
      metaFrom(request),
    );
  }

  @Get()
  @RequirePermissions("products:read")
  list(@Query() rawQuery: Record<string, string>, @CurrentUser() user: AuthUser) {
    const query = listProductsQuerySchema.parse(rawQuery);
    // Filtros por campo personalizado: `?attr.laboratorio=<id>`. Se leen de la
    // query cruda para no fijar en el código qué campos existen — el tenant
    // los inventa (LEY de genericidad).
    const attributeFilters = Object.fromEntries(
      Object.entries(rawQuery)
        .filter(([key]) => key.startsWith("attr."))
        .map(([key, value]) => [key.slice("attr.".length), value]),
    );
    return this.productsService.list(user, query, attributeFilters);
  }

  @Get(":id")
  @RequirePermissions("products:read")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.productsService.findOne(user, id);
  }

  @Post()
  @RequirePermissions("products:manage")
  create(
    @Body(new ZodValidationPipe(createProductSchema, "products.invalid_body"))
    dto: CreateProductDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.productsService.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("products:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema, "products.invalid_body"))
    dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.productsService.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("products:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.productsService.remove(user, id, metaFrom(request));
  }

  @Get(":id/presentations")
  @RequirePermissions("products:read")
  listPresentations(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.presentationsService.list(user, id);
  }

  @Post(":id/presentations")
  @RequirePermissions("products:manage")
  createPresentation(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPresentationSchema, "products.invalid_body"))
    dto: CreatePresentationDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.presentationsService.create(user, id, dto, metaFrom(request));
  }

  @Patch(":id/presentations/:presentationId")
  @RequirePermissions("products:manage")
  updatePresentation(
    @Param("id") id: string,
    @Param("presentationId") presentationId: string,
    @Body(new ZodValidationPipe(updatePresentationSchema, "products.invalid_body"))
    dto: UpdatePresentationDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.presentationsService.update(user, id, presentationId, dto, metaFrom(request));
  }

  /**
   * Borrado REAL, no baja lógica: solo pasa si nadie usó la presentación. La
   * predeterminada, la última y (desde F3/F4) una ya usada devuelven 409 — para
   * esas el camino es desactivar.
   */
  @Delete(":id/presentations/:presentationId")
  @HttpCode(204)
  @RequirePermissions("products:manage")
  async removePresentation(
    @Param("id") id: string,
    @Param("presentationId") presentationId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    await this.presentationsService.remove(user, id, presentationId, metaFrom(request));
  }

  @Get(":id/composition")
  @RequirePermissions("products:read")
  getComposition(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.compositionService.get(user, id);
  }

  @Post(":id/composition")
  @HttpCode(200)
  @RequirePermissions("products:manage")
  replaceComposition(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceCompositionSchema, "products.invalid_body"))
    dto: ReplaceCompositionDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.compositionService.replace(user, id, dto, metaFrom(request));
  }

  @Get(":id/availability")
  @RequirePermissions("products:read")
  availability(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.compositionService.availability(user, id);
  }

  @Get(":id/cost-estimate")
  @RequirePermissions("products:read")
  costEstimate(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.compositionService.costEstimate(user, id);
  }
}
