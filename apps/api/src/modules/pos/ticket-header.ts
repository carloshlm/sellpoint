/**
 * El contacto que encabeza el ticket (Carlos, 2026-08-26): la dirección y el
 * teléfono del ALMACÉN de la operación, con fallback al dato del negocio —
 * un negocio de un solo local no captura nada dos veces y el ticket nunca
 * sale pelón.
 *
 * Función pura y separada del renderer a propósito: el fallback es una regla
 * de negocio y se prueba acá; el renderer se queda tonto y solo pinta lo que
 * recibe. `??` basta porque la DB guarda null, nunca cadena vacía (los DTOs
 * hacen trim y los servicios persisten `?? null`).
 */
export interface TicketHeaderContact {
  address: string | null;
  phone: string | null;
}

export function ticketHeaderContact(
  tenant: TicketHeaderContact,
  warehouse: TicketHeaderContact,
): TicketHeaderContact {
  return {
    address: warehouse.address ?? tenant.address,
    phone: warehouse.phone ?? tenant.phone,
  };
}
