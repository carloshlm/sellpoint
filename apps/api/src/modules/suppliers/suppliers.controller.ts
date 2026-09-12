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
import { type ImportSuppliersDto, importSuppliersSchema } from "./dto/import-suppliers.dto";
import {
  type CreateSupplierDto,
  createSupplierSchema,
  type ListSuppliersQuery,
  listSuppliersQuerySchema,
  type UpdateSupplierDto,
  updateSupplierSchema,
} from "./dto/upsert-supplier.dto";
import { SuppliersService } from "./suppliers.service";
import { SuppliersImportService } from "./suppliers-import.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-SUPPL-04 — el catálogo de proveedores. A diferencia de Recepción, NO
 * lleva `@RequiresModule`: proveedores es core (lo comparten Compras y
 * Gastos, y mañana la entrada de inventario). Un negocio sin ninguno de los
 * dos módulos simplemente no ve el enlace en el menú; el API responde igual.
 * El permiso (`suppliers:read|manage`) decide si el ROL puede.
 */
@ApiTags("suppliers")
@Controller("suppliers")
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly importService: SuppliersImportService,
  ) {}

  /**
   * Importar por Excel (Carlos, 2026-09-12) — mismo contrato que almacenes:
   * la plantilla trae lo ya dado de alta y el match es por código.
   * Va ANTES de las rutas con `:id`: `import/template` no es un identificador.
   */
  @Get("import/template")
  @RequirePermissions("suppliers:manage")
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
  @RequirePermissions("suppliers:manage")
  import(
    @Body(new ZodValidationPipe(importSuppliersSchema, "suppliers.invalid_body"))
    dto: ImportSuppliersDto,
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
  @RequirePermissions("suppliers:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSuppliersQuerySchema, "suppliers.invalid_query"))
    query: ListSuppliersQuery,
  ) {
    return this.suppliers.list(user, query);
  }

  @Get(":id")
  @RequirePermissions("suppliers:read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.suppliers.get(user, id);
  }

  @Post()
  @RequirePermissions("suppliers:manage")
  create(
    @Body(new ZodValidationPipe(createSupplierSchema, "suppliers.invalid_body"))
    dto: CreateSupplierDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.suppliers.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("suppliers:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema, "suppliers.invalid_body"))
    dto: UpdateSupplierDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.suppliers.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("suppliers:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.suppliers.remove(user, id, metaFrom(request));
  }
}
