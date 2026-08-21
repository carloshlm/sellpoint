import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CashboxService } from "./cashbox.service";
import { type CreateSaleDto, createSaleSchema } from "./dto/create-sale.dto";
import { type OpenSessionDto, openSessionSchema } from "./dto/open-session.dto";
import { SalesService } from "./sales.service";

/**
 * F4-CASHBOX-01 — el turno de caja.
 *
 * `pos:sell` en los dos endpoints: consultar el turno es parte de vender. La
 * COTIZACIÓN, en cambio, no pasa por acá — `pos:quote` no exige turno porque
 * cotizar no toca dinero ni stock (decisión de Carlos, 2026-08-20).
 */
@ApiTags("pos")
@Controller("pos")
export class PosController {
  constructor(
    private readonly cashbox: CashboxService,
    private readonly sales: SalesService,
  ) {}

  /**
   * Devuelve `{ session: null }` y NO un 404 cuando no hay turno: "todavía no
   * abriste" es una respuesta legítima a la pregunta, no un error. La pantalla
   * la usa para decidir si muestra el carrito o la apertura.
   */
  @Get("session")
  @RequirePermissions("pos:sell")
  async current(@CurrentUser() user: AuthUser) {
    return { session: await this.cashbox.current(user) };
  }

  @Post("session")
  @RequirePermissions("pos:sell")
  open(
    @Body(new ZodValidationPipe(openSessionSchema, "pos.invalid_body"))
    dto: OpenSessionDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
  ) {
    return this.cashbox.open(user, scope, dto);
  }

  /**
   * El cobro. Exige turno abierto — sin él no hay almacén del que descontar, y
   * una venta suelta sería dinero que nadie cuadra al cerrar el día.
   */
  @Post("sales")
  @RequirePermissions("pos:sell")
  createSale(
    @Body(new ZodValidationPipe(createSaleSchema, "pos.invalid_body"))
    dto: CreateSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.create(user, dto);
  }
}
