import {
  Body,
  Controller,
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
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import {
  type CancelExpenseDto,
  type CreateExpenseDto,
  cancelExpenseSchema,
  createExpenseSchema,
  type ExportExpensesQuery,
  exportExpensesQuerySchema,
  type ListExpensesQuery,
  listExpensesQuerySchema,
  type PayExpenseDto,
  payExpenseSchema,
  type UpdateExpenseDto,
  updateExpenseSchema,
} from "./dto/expense.dto";
import { ExpensesService } from "./expenses.service";
import { ExpensesExportService } from "./expenses-export.service";
import { ExpensesSummaryService } from "./expenses-summary.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-EXP-07 — los gastos. `@RequiresModule("expenses")` a nivel de CLASE:
 * sin el módulo, 402 en todo, también las lecturas. `expenses:read` lee,
 * `:manage` registra, edita y paga, `:cancel` anula.
 *
 * Las rutas FIJAS (`summary`, `accounts`, `export`) van ANTES de `:id`: en
 * Nest gana la primera que matchea, y «summary» no es un id. Las categorías
 * (`expenses/categories`) viven en su propio controller, registrado antes
 * que este en `ExpensesModule` por la misma razón.
 */
@ApiTags("expenses")
@RequiresModule("expenses")
@Controller("expenses")
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly summary: ExpensesSummaryService,
    private readonly exporter: ExpensesExportService,
  ) {}

  @Get()
  @RequirePermissions("expenses:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listExpensesQuerySchema, "expenses.invalid_query"))
    query: ListExpensesQuery,
  ) {
    return this.expenses.list(user, scope, query);
  }

  @Get("summary")
  @RequirePermissions("expenses:read")
  summarize(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listExpensesQuerySchema, "expenses.invalid_query"))
    query: ListExpensesQuery,
  ) {
    return this.summary.summary(user, scope, query);
  }

  @Get("accounts")
  @RequirePermissions("expenses:read")
  accounts(@CurrentUser() user: AuthUser) {
    return this.summary.accounts(user);
  }

  @Get("export")
  @RequirePermissions("expenses:read")
  async exportFile(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(exportExpensesQuerySchema, "expenses.invalid_query"))
    query: ExportExpensesQuery,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const file = await this.exporter.build(
      user,
      scope,
      query,
      getLocale(request as Request & RequestWithLocale),
    );
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  @Get(":id")
  @RequirePermissions("expenses:read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.get(user, id);
  }

  @Post()
  @RequirePermissions("expenses:manage")
  create(
    @Body(new ZodValidationPipe(createExpenseSchema, "expenses.invalid_body"))
    dto: CreateExpenseDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.expenses.create(user, scope, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("expenses:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema, "expenses.invalid_body"))
    dto: UpdateExpenseDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.expenses.update(user, id, dto, metaFrom(request));
  }

  @Post(":id/pay")
  @HttpCode(200)
  @RequirePermissions("expenses:manage")
  pay(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(payExpenseSchema, "expenses.invalid_body"))
    dto: PayExpenseDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.expenses.pay(user, scope, id, dto, metaFrom(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("expenses:cancel")
  cancel(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelExpenseSchema, "expenses.invalid_body"))
    dto: CancelExpenseDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.expenses.cancel(user, id, dto, metaFrom(request));
  }
}
