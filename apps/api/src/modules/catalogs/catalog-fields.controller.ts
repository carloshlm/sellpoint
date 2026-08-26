import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CatalogFieldsService } from "./catalog-fields.service";
import { type CreateFieldDto, createFieldSchema } from "./dto/create-field.dto";
import { type UpdateFieldDto, updateFieldSchema } from "./dto/update-field.dto";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

// La confirmación viaja como QUERY PARAM y no en el body: un DELETE con body
// es legal pero frágil —hay proxies y clientes HTTP que lo descartan, y desde
// axios se escribe `{ data: {...} }`, que es fácil de olvidar—. `?confirm=true`
// es explícito, imposible de perder en el camino y trivial de mandar.
const confirmQuerySchema = z
  .object({ confirm: z.enum(["true", "false"]).optional() })
  .transform((query) => query.confirm === "true");

/**
 * F2-CAT-03. Leer la estructura es `catalogs:read` (el form dinámico la
 * necesita para renderizarse); tocarla es `catalogs:manage`, solo Admin.
 */
@ApiTags("catalogs")
@Controller("catalogs/:catalogId/fields")
export class CatalogFieldsController {
  constructor(private readonly fieldsService: CatalogFieldsService) {}

  @Get()
  @RequirePermissions("catalogs:read")
  list(@Param("catalogId") catalogId: string, @CurrentUser() user: AuthUser) {
    return this.fieldsService.list(user, catalogId);
  }

  @Post()
  @RequirePermissions("catalogs:manage")
  create(
    @Param("catalogId") catalogId: string,
    @Body(new ZodValidationPipe(createFieldSchema, "catalogs.invalid_body")) dto: CreateFieldDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.fieldsService.create(user, catalogId, dto, metaFrom(request));
  }

  @Patch(":fieldId")
  @RequirePermissions("catalogs:manage")
  update(
    @Param("catalogId") catalogId: string,
    @Param("fieldId") fieldId: string,
    @Body(new ZodValidationPipe(updateFieldSchema, "catalogs.invalid_body")) dto: UpdateFieldDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.fieldsService.update(user, catalogId, fieldId, dto, metaFrom(request));
  }

  @Delete(":fieldId")
  @RequirePermissions("catalogs:manage")
  async remove(
    @Param("catalogId") catalogId: string,
    @Param("fieldId") fieldId: string,
    @Query(new ZodValidationPipe(confirmQuerySchema, "catalogs.invalid_query")) confirm: boolean,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const result = await this.fieldsService.remove(
      user,
      catalogId,
      fieldId,
      confirm,
      metaFrom(request),
    );

    if ("requiresConfirmation" in result) {
      // 409 con el CONTEO: es exactamente lo que la UI necesita para escribir
      // "N registros tienen este campo; se ocultará, no se borra".
      throw new ConflictException({
        message: "catalogs.field_has_data",
        requiresConfirmation: true,
        recordCount: result.recordCount,
      });
    }

    return result;
  }
}
