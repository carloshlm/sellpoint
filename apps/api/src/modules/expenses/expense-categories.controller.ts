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
import {
  type CreateExpenseCategoryDto,
  createExpenseCategorySchema,
  type ListExpenseCategoriesQuery,
  listExpenseCategoriesQuerySchema,
  type UpdateExpenseCategoryDto,
  updateExpenseCategorySchema,
} from "./dto/expense-category.dto";
import { ExpenseCategoriesService } from "./expense-categories.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-EXP-03 — las categorías de gasto. `@RequiresModule("expenses")` a nivel
 * de CLASE: sin el módulo (un Free), el controller entero responde 402,
 * también las lecturas. `expenses:read` mira, `expenses:manage` administra.
 */
@ApiTags("expenses")
@RequiresModule("expenses")
@Controller("expenses/categories")
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions("expenses:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listExpenseCategoriesQuerySchema, "expenses.invalid_query"))
    query: ListExpenseCategoriesQuery,
  ) {
    return this.categories.list(user, query);
  }

  @Get(":id")
  @RequirePermissions("expenses:read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.categories.get(user, id);
  }

  @Post()
  @RequirePermissions("expenses:manage")
  create(
    @Body(new ZodValidationPipe(createExpenseCategorySchema, "expenses.invalid_body"))
    dto: CreateExpenseCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.categories.create(user, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("expenses:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpenseCategorySchema, "expenses.invalid_body"))
    dto: UpdateExpenseCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.categories.update(user, id, dto, metaFrom(request));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("expenses:manage")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.categories.remove(user, id, metaFrom(request));
  }
}
