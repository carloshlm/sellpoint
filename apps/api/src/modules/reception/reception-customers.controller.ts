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
import { CustomersService } from "./customers.service";
import {
  type CreateCustomerDto,
  createCustomerSchema,
  type ListCustomersQuery,
  listCustomersQuerySchema,
  type UpdateCustomerDto,
  updateCustomerSchema,
} from "./dto/upsert-customer.dto";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-RECEP-08 — el registro de clientes. `@RequiresModule("reception")` a
 * nivel de CLASE: sin el módulo activo, el controller entero responde 402,
 * también las lecturas. El permiso decide si el ROL puede; el módulo, si el
 * NEGOCIO lo tiene.
 */
@ApiTags("reception")
@RequiresModule("reception")
@Controller("reception/customers")
export class ReceptionCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions("reception:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listCustomersQuerySchema, "reception.invalid_query"))
    query: ListCustomersQuery,
  ) {
    return this.customers.list(user, query);
  }

  @Post()
  @RequirePermissions("reception:manage")
  create(
    @Body(new ZodValidationPipe(createCustomerSchema, "reception.invalid_body"))
    dto: CreateCustomerDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.customers.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("reception:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema, "reception.invalid_body"))
    dto: UpdateCustomerDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.customers.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("reception:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.customers.remove(user, id, metaFrom(request));
  }
}
