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

export const expenseFormSchema = z.object({
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

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;
