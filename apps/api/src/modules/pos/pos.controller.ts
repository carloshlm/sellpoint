import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
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
import { CashboxService } from "./cashbox.service";
import { type CreateSaleDto, createSaleSchema } from "./dto/create-sale.dto";
import {
  type CancelSaleDto,
  cancelSaleSchema,
  type ListSalesQuery,
  listSalesQuerySchema,
} from "./dto/list-sales.dto";
import { type LookupQuery, lookupQuerySchema } from "./dto/lookup.dto";
import {
  type CloseSessionDto,
  closeSessionSchema,
  type OpenSessionDto,
  openSessionSchema,
} from "./dto/open-session.dto";
import {
  type CancelQuoteDto,
  type CreateQuoteDto,
  cancelQuoteSchema,
  createQuoteSchema,
  type ListQuotesQuery,
  listQuotesQuerySchema,
} from "./dto/quote.dto";
import { LookupService } from "./lookup.service";
import { QuotesService } from "./quotes.service";
import { SalesService } from "./sales.service";
import type { TicketWidth } from "./ticket.renderer";
import { TicketService } from "./ticket.service";

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
    private readonly lookup: LookupService,
    private readonly quotes: QuotesService,
    private readonly tickets: TicketService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * El ancho del papel. 58 mm es la térmica de mostrador; 80 mm la de
   * mesa. Cualquier otra cosa cae a 58 en vez de reventar: un ticket angosto
   * se lee, un 500 en la caja no.
   */
  private static ancho(value: string | undefined): TicketWidth {
    return value === "80mm" ? "80mm" : "58mm";
  }

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
   * Los totales del turno abierto, para que la pantalla de cierre muestre
   * contra qué se está contando ANTES de escribir el arqueo.
   */
  @Get("session/totals")
  @RequirePermissions("pos:sell")
  async totals(@CurrentUser() user: AuthUser) {
    const sesion = await this.cashbox.current(user);
    return { totals: sesion === null ? [] : await this.cashbox.totals(user, sesion.id) };
  }

  /** Cierra el turno con su arqueo. La diferencia se registra, no bloquea. */
  @Post("session/close")
  @HttpCode(200)
  @RequirePermissions("pos:sell")
  closeSession(
    @Body(new ZodValidationPipe(closeSessionSchema, "pos.invalid_body"))
    dto: CloseSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cashbox.close(user, dto);
  }

  /**
   * F4-CART-01 — el buscador del carrito.
   *
   * `pos:sell` y turno abierto: lo que devuelve es "qué puedo vender AHORA
   * desde acá", una pregunta que sin turno no tiene sujeto. El 409 es el mismo
   * que el del cobro a propósito — la pantalla ya sabe qué hacer con él.
   */
  @Get("lookup")
  @RequirePermissions("pos:sell")
  search(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(lookupQuerySchema, "pos.invalid_query"))
    query: LookupQuery,
  ) {
    return this.lookup.search(user, scope, query);
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
    // La genera el CLIENTE al abrir el modal de cobro. Es OPCIONAL: sin ella
    // el comportamiento es el de siempre, y con ella un doble tap devuelve la
    // MISMA venta (200) en vez de cobrar dos veces.
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.sales.create(user, dto, idempotencyKey?.trim() || undefined);
  }

  /**
   * F4-TICKET-01 — el ticket de la venta.
   *
   * `pos:view` y no `pos:sell`: **reimprimir es leer**. Quien audita una venta
   * tiene que poder sacar su papel sin poder hacer una nueva.
   *
   * Binario y no base64 en JSON, igual que el PDF de F3: el front lo baja con
   * axios `responseType: 'blob'` porque un `<a href>` plano iría sin el Bearer.
   */
  @Get("sales/:id/ticket")
  @RequirePermissions("pos:view")
  async saleTicket(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("width") width: string | undefined,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.tickets.saleTicket(user, id, PosController.ancho(width), (key) =>
      this.i18n.translate(key, { lang: locale }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  /** El papel con el que el cliente vuelve. `pos:quote`. */
  @Get("quotes/:id/ticket")
  @RequirePermissions("pos:quote")
  async quoteTicket(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("width") width: string | undefined,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.tickets.quoteTicket(user, id, PosController.ancho(width), (key) =>
      this.i18n.translate(key, { lang: locale }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  /**
   * El historial. `pos:view` y no `pos:sell`: un auditor lee las ventas sin
   * poder hacer ninguna.
   */
  @Get("sales")
  @RequirePermissions("pos:view")
  listSales(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSalesQuerySchema, "pos.invalid_query"))
    query: ListSalesQuery,
  ) {
    return this.sales.list(user, query);
  }

  @Get("sales/:id")
  @RequirePermissions("pos:view")
  saleDetail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.sales.detail(user, id);
  }

  // ── Cotización (F4-QUOTE) ────────────────────────────────────────────
  //
  // `pos:quote` y SIN turno: cotizar es responder "¿cuánto me sale?", y eso
  // pasa en el mostrador, por teléfono o caminando por el pasillo. Exigir caja
  // abierta para contestar una pregunta sería burocracia pura.

  @Post("quotes")
  @RequirePermissions("pos:quote")
  createQuote(
    @Body(new ZodValidationPipe(createQuoteSchema, "pos.invalid_body"))
    dto: CreateQuoteDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
  ) {
    return this.quotes.create(user, scope, dto);
  }

  @Get("quotes")
  @RequirePermissions("pos:quote")
  listQuotes(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listQuotesQuerySchema, "pos.invalid_query"))
    query: ListQuotesQuery,
  ) {
    return this.quotes.list(user, query);
  }

  /**
   * F4-QUOTE-02 — la cotización lista para cobrar.
   *
   * `pos:sell` y no `pos:quote`: acá ya no se cotiza, se prepara un cobro. Y
   * exige turno, porque la disponibilidad se resuelve contra el almacén de
   * ESE turno — que puede no ser el de la cotización.
   *
   * Va ANTES de `quotes/:id` a propósito: Nest resuelve por orden de
   * declaración, y `:id` capturaría el literal `folio` como si fuera un uuid.
   */
  @Get("quotes/folio/:folio/for-sale")
  @RequirePermissions("pos:sell")
  quoteForSale(@Param("folio") folio: string, @CurrentUser() user: AuthUser) {
    return this.quotes.forSale(user, folio);
  }

  @Get("quotes/:id")
  @RequirePermissions("pos:quote")
  quoteDetail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.quotes.detail(user, id);
  }

  @Post("quotes/:id/cancel")
  @HttpCode(200)
  @RequirePermissions("pos:quote")
  cancelQuote(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelQuoteSchema, "pos.invalid_body"))
    dto: CancelQuoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.quotes.cancel(user, id, dto);
  }

  /**
   * Anular. `pos:cancel` — que NO está en `POS_SELLER_CODES`: deshacer una
   * operación asentada es decisión de gestión, no de mostrador.
   */
  @Post("sales/:id/cancel")
  @HttpCode(200)
  @RequirePermissions("pos:cancel")
  cancelSale(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelSaleSchema, "pos.invalid_body"))
    dto: CancelSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.cancel(user, id, dto);
  }
}
