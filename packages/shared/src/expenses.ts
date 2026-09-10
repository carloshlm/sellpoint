import { z } from "zod";

/**
 * F9-EXP-01 — los contratos de Gastos.
 *
 * Dos hechos ORTOGONALES por gasto: si existe (`status`) y si ya se pagó
 * (`payment_status`). Un gasto anulado puede haber estado pagado; uno
 * pendiente puede anularse. Mezclarlos en un solo estado obligaría a
 * inventar «pagado_anulado» y a razonar con cuatro valores donde hay dos
 * preguntas.
 */
export const EXPENSE_STATUSES = ["active", "canceled"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);

export const EXPENSE_PAYMENT_STATUSES = ["pending", "paid"] as const;
export type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];
export const expensePaymentStatusSchema = z.enum(EXPENSE_PAYMENT_STATUSES);

export interface ExpenseCategorySeed {
  /** Clave estable en `snake_case`: es lo que identifica la categoría, no el nombre. */
  code: string;
  name: { es: string; en: string };
}

/**
 * Las 18 categorías con las que nace todo negocio (Carlos, 2026-09-10), en
 * este orden y con `sort_order = índice × 10` para que quepa una propia entre
 * dos. Se siembran en `provision()` (negocios nuevos) y por backfill en la
 * migración `f9_expense_categories` (los que ya existían), en el idioma del
 * negocio. La barrera `expense-categories-seed.spec.ts` exige que el SQL y
 * esta lista digan EXACTAMENTE lo mismo.
 */
export const EXPENSE_CATEGORY_SEED: readonly ExpenseCategorySeed[] = [
  { code: "rent", name: { es: "Renta", en: "Rent" } },
  { code: "electricity", name: { es: "Luz", en: "Electricity" } },
  { code: "water", name: { es: "Agua", en: "Water" } },
  { code: "internet", name: { es: "Internet", en: "Internet" } },
  { code: "phone", name: { es: "Teléfono", en: "Phone" } },
  { code: "cleaning", name: { es: "Limpieza", en: "Cleaning" } },
  { code: "stationery", name: { es: "Papelería", en: "Stationery" } },
  { code: "maintenance", name: { es: "Mantenimiento", en: "Maintenance" } },
  { code: "repairs", name: { es: "Reparaciones", en: "Repairs" } },
  { code: "advertising", name: { es: "Publicidad", en: "Advertising" } },
  { code: "transport", name: { es: "Transporte", en: "Transport" } },
  { code: "fuel", name: { es: "Combustible", en: "Fuel" } },
  { code: "bank_fees", name: { es: "Comisiones bancarias", en: "Bank fees" } },
  {
    code: "professional_services",
    name: { es: "Servicios profesionales", en: "Professional services" },
  },
  { code: "software", name: { es: "Software y suscripciones", en: "Software and subscriptions" } },
  { code: "insurance", name: { es: "Seguros", en: "Insurance" } },
  { code: "payroll", name: { es: "Nómina", en: "Payroll" } },
  { code: "other", name: { es: "Otros", en: "Other" } },
] as const;

/** El `sort_order` de una categoría sembrada: su lugar en la lista × 10. */
export function expenseCategorySortOrder(index: number): number {
  return index * 10;
}
