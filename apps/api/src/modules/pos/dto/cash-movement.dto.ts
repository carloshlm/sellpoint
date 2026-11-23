import { hasValidMoneyScale, isDiscountCode, MONEY_MAX } from "@sellpoint/shared";
import { z } from "zod";

/** F10-CASHMOV-02 — los dos sentidos del efectivo: entra al cajón o sale de él. */
export const CASH_MOVEMENT_TYPES = ["in", "out"] as const;
export type CashMovementTypeCode = (typeof CASH_MOVEMENT_TYPES)[number];

/** F10-CASHMOV-02 — los motivos, en el orden en que la pantalla los ofrece. */
export const CASH_MOVEMENT_REASONS = [
  "change_fund",
  "safe",
  "bank_deposit",
  "owner",
  "other",
] as const;
export type CashMovementReasonCode = (typeof CASH_MOVEMENT_REASONS)[number];

/**
 * Qué motivo va con qué tipo. «Fondo para cambio» solo entra; «A la caja
 * fuerte», «Depósito al banco» y «Retiro del dueño» solo salen; «Otro», los
 * dos. La base tiene el mismo CHECK (`cash_movements_reason_matches_type`):
 * esto es para responder 400 con un mensaje en vez de un 500.
 */
export const CASH_MOVEMENT_REASONS_BY_TYPE: Record<
  CashMovementTypeCode,
  readonly CashMovementReasonCode[]
> = {
  in: ["change_fund", "other"],
  out: ["safe", "bank_deposit", "owner", "other"],
};

/** El largo de la nota y del motivo de anulación (la nota es VARCHAR(300) en la base). */
export const CASH_MOVEMENT_TEXT_MAX = 300;

const IMPORTE_INVALIDO = { message: "pos.cash_movement_amount_invalid" } as const;

/**
 * F10-CASHMOV-02 — registrar una entrada o un retiro. El importe es un número
 * con hasta 2 decimales, mayor que cero y con el tope del fondo inicial. El
 * código es el de autorización del negocio, con la forma del descuento; si
 * hace falta o no lo decide el service, que sabe si el negocio lo tiene.
 */
export const createCashMovementSchema = z
  .object({
    type: z.enum(CASH_MOVEMENT_TYPES, { message: "pos.cash_movement_type_invalid" }),
    reason: z.enum(CASH_MOVEMENT_REASONS, { message: "pos.cash_movement_reason_invalid" }),
    amount: z
      .number(IMPORTE_INVALIDO)
      .positive(IMPORTE_INVALIDO)
      .max(MONEY_MAX, IMPORTE_INVALIDO)
      .refine(hasValidMoneyScale, IMPORTE_INVALIDO),
    note: z
      .string()
      .trim()
      .max(CASH_MOVEMENT_TEXT_MAX, { message: "pos.cash_movement_note_too_long" })
      .nullish(),
    code: z.string().refine(isDiscountCode, { message: "pos.discount_code_invalid" }).nullish(),
  })
  .strict()
  .refine((m) => CASH_MOVEMENT_REASONS_BY_TYPE[m.type].includes(m.reason), {
    message: "pos.cash_movement_reason_invalid",
    path: ["reason"],
  })
  .refine((m) => m.reason !== "other" || (m.note ?? "") !== "", {
    message: "pos.cash_movement_note_required",
    path: ["note"],
  });

export type CreateCashMovementDto = z.infer<typeof createCashMovementSchema>;

/** F10-CASHMOV-02 — anular: con motivo, siempre; con código, si el service lo pide. */
export const cancelCashMovementSchema = z
  .object({
    reason: z
      .string({ message: "pos.cash_movement_cancel_reason_required" })
      .trim()
      .min(1, { message: "pos.cash_movement_cancel_reason_required" })
      .max(CASH_MOVEMENT_TEXT_MAX, { message: "pos.cash_movement_cancel_reason_too_long" }),
    code: z.string().refine(isDiscountCode, { message: "pos.discount_code_invalid" }).nullish(),
  })
  .strict();

export type CancelCashMovementDto = z.infer<typeof cancelCashMovementSchema>;
