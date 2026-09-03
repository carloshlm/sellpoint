import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import type { TicketWidth } from "../pos/ticket.renderer";
import {
  type CreateTurnDto,
  createTurnSchema,
  type ListTurnsQuery,
  listTurnsQuerySchema,
} from "./dto/turns.dto";
import { TurnTicketService } from "./turn-ticket.service";
import { TurnsService } from "./turns.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-RECEP-08 — los turnos. Mismo criterio que los clientes: el módulo
 * apaga el controller entero (402), el permiso gatea cada acción.
 */
@ApiTags("reception")
@RequiresModule("reception")
@Controller("reception/turns")
export class ReceptionTurnsController {
  constructor(
    private readonly turns: TurnsService,
    private readonly tickets: TurnTicketService,
    private readonly i18n: I18nService,
  ) {}

  /** 58 mm es la térmica de mostrador; cualquier otra cosa cae a 58 en vez de reventar. */
  private static ancho(value: string | undefined): TicketWidth {
    return value === "80mm" ? "80mm" : "58mm";
  }

  @Get()
  @RequirePermissions("reception:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listTurnsQuerySchema, "reception.invalid_query"))
    query: ListTurnsQuery,
  ) {
    return this.turns.list(user, query);
  }

  @Post()
  @RequirePermissions("reception:manage")
  create(
    @Body(new ZodValidationPipe(createTurnSchema, "reception.invalid_body"))
    dto: CreateTurnDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.turns.create(user, dto, metaFrom(request));
  }

  /**
   * El papel del turno (Carlos, 2026-09-02): PDF térmico como el ticket de
   * venta. `reception:read`: reimprimir es leer.
   */
  @Get(":id/ticket")
  @RequirePermissions("reception:read")
  async ticket(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Query("width") width: string | undefined,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.tickets.turnTicket(
      user,
      id,
      ReceptionTurnsController.ancho(width),
      (key) => this.i18n.translate(key, { lang: locale }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  @Post(":id/attend")
  @HttpCode(200)
  @RequirePermissions("reception:manage")
  attend(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.turns.attend(user, id, metaFrom(request));
  }

  @Post(":id/wait")
  @HttpCode(200)
  @RequirePermissions("reception:manage")
  wait(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.turns.wait(user, id, metaFrom(request));
  }
}
