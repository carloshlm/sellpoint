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
 * Cerrar turno llega en F4-CASHBOX-02. El DTO NO se adelanta acá: escribirlo
 * ahora sería fijar la forma del arqueo sin haber escrito su transacción.
 */
