import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ListExpensesQuery } from "./dto/expense.dto";
import { ExpensesService } from "./expenses.service";

export interface ExpensesSummary {
  count: number;
  amount: string;
  discount: string;
  tax: string;
  total: string;
  byCategory: { categoryId: string; categoryName: string; count: number; total: string }[];
  byPaymentStatus: { pending: string; paid: string };
}

const CERO = new Prisma.Decimal(0);

/**
 * F9-EXP-08 — el resumen del rango: lo que se gastó, por categoría y por
 * estado de pago, con los MISMOS filtros del listado y en una consulta
 * aparte del paginado (`/expenses/summary`): el total no cambia al cambiar de
 * página. Solo gastos ACTIVOS: uno anulado es dinero que no salió.
 */
@Injectable()
export class ExpensesSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
  ) {}

  async summary(
    user: AuthUser,
    scope: UserScope,
    query: ListExpensesQuery,
  ): Promise<ExpensesSummary> {
    const where = { ...this.expenses.where(user, scope, query), status: "active" };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [totales, porCategoria, porEstado] = await Promise.all([
        tx.expense.aggregate({
          where,
          _count: true,
          _sum: { amount: true, discount: true, taxAmount: true, total: true },
        }),
        tx.expense.groupBy({
          by: ["categoryId"],
          where,
          _count: true,
          _sum: { total: true },
          orderBy: { _sum: { total: "desc" } },
        }),
        tx.expense.groupBy({ by: ["paymentStatus"], where, _sum: { total: true } }),
      ]);
      const categorias = await tx.expenseCategory.findMany({
        where: { tenantId: user.tenantId, id: { in: porCategoria.map((c) => c.categoryId) } },
        select: { id: true, name: true },
      });
      const nombre = new Map(categorias.map((c) => [c.id, c.name]));
      const estado = (s: string) =>
        (porEstado.find((e) => e.paymentStatus === s)?._sum.total ?? CERO).toString();
      return {
        count: totales._count,
        amount: (totales._sum.amount ?? CERO).toString(),
        discount: (totales._sum.discount ?? CERO).toString(),
        tax: (totales._sum.taxAmount ?? CERO).toString(),
        total: (totales._sum.total ?? CERO).toString(),
        byCategory: porCategoria.map((c) => ({
          categoryId: c.categoryId,
          categoryName: nombre.get(c.categoryId) ?? "",
          count: c._count,
          total: (c._sum.total ?? CERO).toString(),
        })),
        byPaymentStatus: { pending: estado("pending"), paid: estado("paid") },
      };
    });
  }

  /**
   * Las cuentas de caja/banco que el negocio ya escribió, de la más usada a
   * la menos (tope 50): alimenta el `<datalist>` del formulario para que
   * «BBVA», «bbva» y «Banco» converjan solas.
   */
  async accounts(user: AuthUser): Promise<string[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const filas = await tx.expense.groupBy({
        by: ["accountRef"],
        where: { tenantId: user.tenantId, accountRef: { not: null } },
        _count: true,
        orderBy: [{ _count: { accountRef: "desc" } }, { accountRef: "asc" }],
        take: 50,
      });
      return filas.map((f) => f.accountRef).filter((a): a is string => a !== null);
    });
  }
}
