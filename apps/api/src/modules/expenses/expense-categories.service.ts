import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type CreateExpenseCategoryDto,
  categoryCodeFromName,
  type ListExpenseCategoriesQuery,
  type UpdateExpenseCategoryDto,
} from "./dto/expense-category.dto";

export interface ExpenseCategorySummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

type CategoryRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * F9-EXP-03 — las categorías de gasto (molde: `StudyCatalogService`). Todo
 * dentro de `withTenantContext`, `tenantId` en el WHERE además de la RLS, y
 * auditoría en la misma tx. Orden `sort_order, name`: las 18 de fábrica van
 * en su orden y una propia cabe entre dos.
 *
 * Borrar una categoría con gastos rebota por la FK (RESTRICT) → 409
 * `expenses.category_in_use`: se desactiva, y desactivada desaparece del
 * selector sin perder el historial que la nombra.
 */
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: ListExpenseCategoriesQuery,
  ): Promise<{ rows: ExpenseCategorySummary[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const texto = query.query?.trim();
    const where: Prisma.ExpenseCategoryWhereInput = {
      tenantId: user.tenantId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(texto
        ? {
            OR: [
              { code: { contains: texto, mode: "insensitive" as const } },
              { name: { contains: texto, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.expenseCategory.count({ where }),
        tx.expenseCategory.findMany({
          where,
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows: rows.map(toSummary), total, page, pageSize };
    });
  }

  async get(user: AuthUser, id: string): Promise<ExpenseCategorySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const fila = await tx.expenseCategory.findFirst({ where: { id, tenantId: user.tenantId } });
      if (fila === null) {
        throw new NotFoundException({ message: "expenses.category_not_found" });
      }
      return toSummary(fila);
    });
  }

  async create(
    user: AuthUser,
    input: CreateExpenseCategoryDto,
    meta: RequestMeta,
  ): Promise<ExpenseCategorySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let creado: CategoryRow;
      try {
        creado = await tx.expenseCategory.create({
          data: {
            tenantId: user.tenantId,
            code: input.code ?? categoryCodeFromName(input.name),
            name: input.name,
            // Sin orden explícito, al final de la lista: después de las 18.
            sortOrder: input.sortOrder ?? (await this.siguienteOrden(tx, user.tenantId)),
            createdBy: user.userId,
            updatedBy: user.userId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "expenses.category_code_taken" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.category.create",
        resourceType: "expense_category",
        resourceId: creado.id,
        after: { code: creado.code, name: creado.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado);
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateExpenseCategoryDto,
    meta: RequestMeta,
  ): Promise<ExpenseCategorySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await tx.expenseCategory.findFirst({ where: { id, tenantId: user.tenantId } });
      if (antes === null) {
        throw new NotFoundException({ message: "expenses.category_not_found" });
      }
      const data: Prisma.ExpenseCategoryUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updater: { connect: { id: user.userId } },
      };
      const despues = await tx.expenseCategory.update({ where: { id }, data });
      const { updater: _updater, ...cambios } = data;
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.category.update",
        resourceType: "expense_category",
        resourceId: id,
        before: { name: antes.name, isActive: antes.isActive, sortOrder: antes.sortOrder },
        after: cambios as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(despues);
    });
  }

  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await tx.expenseCategory.findFirst({ where: { id, tenantId: user.tenantId } });
      if (antes === null) {
        throw new NotFoundException({ message: "expenses.category_not_found" });
      }
      try {
        await tx.expenseCategory.delete({ where: { id } });
      } catch (error) {
        // RESTRICT desde `expenses`: una categoría con gastos no se borra, se
        // desactiva (el historial la sigue nombrando).
        if (isForeignKeyViolation(error)) {
          throw new ConflictException({ message: "expenses.category_in_use" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.category.delete",
        resourceType: "expense_category",
        resourceId: id,
        before: { code: antes.code, name: antes.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** El siguiente hueco de la lista: el mayor `sort_order` + 10. */
  private async siguienteOrden(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const ultimo = await tx.expenseCategory.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    });
    return (ultimo._max.sortOrder ?? -10) + 10;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

export function toSummary(row: CategoryRow): ExpenseCategorySummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
