import { z } from "zod";

/**
 * Abrir turno. El almacén es OPCIONAL: si no viene, se usa el **asignado** del
 * usuario (`users.default_warehouse_id`, F3-HOME).
 *
 * Que sea opcional no es comodidad — es la cadena de F3-HOME funcionando:
 * `usuario.asignado → turno → venta → ledger`. Un cajero que siempre vende en
 * la misma sucursal no debería tener que elegirla cada mañana; uno que rota
 * entre dos manda el que corresponda, dentro de su alcance.
 */
export const openSessionSchema = z
  .object({
    warehouseId: z.string().uuid({ message: "pos.warehouse_invalid" }).optional(),
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
