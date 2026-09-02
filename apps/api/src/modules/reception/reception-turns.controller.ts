import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import {
  type CreateTurnDto,
  createTurnSchema,
  type ListTurnsQuery,
  listTurnsQuerySchema,
} from "./dto/turns.dto";
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
  constructor(private readonly turns: TurnsService) {}

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
