import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";
import { z } from "zod";

/**
 * Abrir turno. El almacén es OPCIONAL: si no viene, se usa el **asignado** del
 * usuario (`users.default_warehouse_id`, F3-HOME).
 *
 * Que sea opcional no es comodidad — es la cadena de F3-HOME funcionando:
 * `usuario.asignado → turno → venta → ledger`. Un cajero que siempre vende en
 * la misma sucursal no debería tener que elegirla cada mañana; uno que rota
 * entre dos manda el que corresponda, dentro de su alcance.
 *
 * F10-MANFIX-10 — el FONDO INICIAL, también opcional: sin él, el turno abre
 * con $0 y el arqueo espera lo de siempre. Es un importe como los demás (dos
 * decimales, el tope de la columna) y nunca negativo. Un número y no texto:
 * `z.coerce` convertiría un campo vacío en un fondo de $0 que nadie escribió.
 */
const FONDO_INVALIDO = { message: "pos.opening_cash_invalid" } as const;

export const openSessionSchema = z
  .object({
    warehouseId: z.string().uuid({ message: "pos.warehouse_invalid" }).optional(),
    openingCash: z
      .number(FONDO_INVALIDO)
      .min(0, FONDO_INVALIDO)
      .max(MONEY_MAX, FONDO_INVALIDO)
      .refine(hasValidMoneyScale, FONDO_INVALIDO)
      .optional(),
  })
  .strict();

export type OpenSessionDto = z.infer<typeof openSessionSchema>;

/**
 * El arqueo: lo que la persona CONTÓ en el cajón.
 *
 * Solo el efectivo. Tarjeta y transferencia no se cuentan a mano — los concilia
 * la terminal o el banco, y pedirle al cajero que "declare" lo que no puede
 * tocar sería teatro. Si algún día se concilian acá, van con su propio nombre
 * y su propia fuente, no como un número escrito a mano.
 *
 * La nota es opcional: quien cuadra al centavo no tiene nada que explicar.
 */
export const closeSessionSchema = z
  .object({
    declaredCash: z.coerce.number().min(0, { message: "pos.declared_cash_invalid" }),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type CloseSessionDto = z.infer<typeof closeSessionSchema>;
