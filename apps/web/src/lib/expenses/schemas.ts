import { isRealCalendarDate } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-EXP-12 — lo que valida el formulario de gasto ANTES de llamar al API,
 * espejo del DTO del server. Los importes llegan como texto del `MoneyField`
 * y se validan aparte (`moneyInputError`); aquí van los campos de texto y
 * las fechas. Los mensajes son claves i18n del namespace `expenses`.
 */
const fecha = (message: string) =>
  z
    .string()
    .trim()
    .refine((valor) => valor === "" || isRealCalendarDate(valor), { message });

/**
 * Las dos fechas en orden, del lado del navegador (Carlos, 2026-09-13). El
 * server es la fuente de verdad —valida lo mismo con el «hoy» del calendario
 * del NEGOCIO— pero esperar un viaje de red para saber que una fecha está al
 * revés es una espera que no hace falta.
 *
 * Recibe `hoy` en vez de calcularlo: la zona del navegador no es la del
 * negocio, y un schema que lee el reloj no se puede testear.
 */
export const expenseFormSchema = (hoy: string) =>
  camposDelGasto.superRefine((valores, ctx) => {
    if (valores.expenseDate !== "" && valores.expenseDate > hoy) {
      ctx.addIssue({
        code: "custom",
        path: ["expenseDate"],
        message: "expenses.form.errors.dateInFuture",
      });
    }
    // El MISMO día vale: una factura que se recibe y vence hoy es real.
    if (
      valores.dueDate !== "" &&
      valores.expenseDate !== "" &&
      valores.dueDate < valores.expenseDate
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "expenses.form.errors.dueBeforeExpense",
      });
    }
  });

const camposDelGasto = z.object({
  expenseDate: z
    .string()
    .trim()
    .min(1, "expenses.form.errors.required")
    .refine(isRealCalendarDate, { message: "expenses.form.errors.date" }),
  categoryId: z.string().min(1, "expenses.form.errors.required"),
  description: z.string().trim().min(1, "expenses.form.errors.required").max(300),
  beneficiary: z.string().trim().max(120),
  reference: z.string().trim().max(120),
  accountRef: z.string().trim().max(120),
  dueDate: fecha("expenses.form.errors.date"),
  notes: z.string().trim().max(2000),
});

export type ExpenseFormValues = z.infer<typeof camposDelGasto>;
