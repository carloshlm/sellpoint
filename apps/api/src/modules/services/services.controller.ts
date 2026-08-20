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
import {
  type CreateServiceDto,
  createServiceSchema,
  type ListServicesQuery,
  listServicesQuerySchema,
  type UpdateServiceDto,
  updateServiceSchema,
} from "./dto/upsert-service.dto";
import { ServicesService } from "./services.service";

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
  constructor(private readonly servicesService: ServicesService) {}

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
