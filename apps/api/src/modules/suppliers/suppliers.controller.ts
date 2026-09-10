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
  type CreateSupplierDto,
  createSupplierSchema,
  type ListSuppliersQuery,
  listSuppliersQuerySchema,
  type UpdateSupplierDto,
  updateSupplierSchema,
} from "./dto/upsert-supplier.dto";
import { SuppliersService } from "./suppliers.service";

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
  constructor(private readonly suppliers: SuppliersService) {}

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
