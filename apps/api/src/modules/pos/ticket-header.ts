import { formatAddress } from "@sellpoint/shared";

/**
 * El contacto que encabeza el ticket (Carlos, 2026-08-26): la dirección y el
 * teléfono del ALMACÉN de la operación, con fallback al dato del negocio —
 * un negocio de un solo local no captura nada dos veces y el ticket nunca
 * sale pelón.
 *
 * F1-ADDR-07: la dirección es un BLOQUE (calle, línea 2, ciudad, región y
 * código postal) y sale de acá YA FORMATEADA en el orden de su país
 * (`formatAddress`). El fallback de la dirección es por bloque entero —el
 * del almacén si tiene calle, si no el del negocio— y nunca campo por campo:
 * la calle de la sucursal con la ciudad de la matriz es una dirección que no
 * existe. El teléfono sí cae campo por campo, como siempre. Con solo la
 * línea 1, `formatAddress` devuelve la línea 1 tal cual: el ticket de un
 * negocio que no completó nada imprime exactamente lo que imprimía ayer.
 *
 * Función pura y separada del renderer a propósito: el fallback es una regla
 * de negocio y se prueba acá; el renderer se queda tonto y solo pinta lo que
 * recibe. `??` basta porque la DB guarda null, nunca cadena vacía (los DTOs
 * hacen trim y los servicios persisten `?? null`).
 */
export interface TicketHeaderSource {
  address: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface TicketHeaderContact {
  address: string | null;
  phone: string | null;
}

export function ticketHeaderContact(
  tenant: TicketHeaderSource,
  warehouse: TicketHeaderSource,
  country: string | null,
): TicketHeaderContact {
  const bloque = warehouse.address !== null ? warehouse : tenant;
  const address = formatAddress(
    {
      line1: bloque.address,
      line2: bloque.addressLine2,
      city: bloque.city,
      region: bloque.region,
      postalCode: bloque.postalCode,
    },
    country,
  );
  return {
    address: address === "" ? null : address,
    phone: warehouse.phone ?? tenant.phone,
  };
}
