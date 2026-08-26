import { ticketHeaderContact } from "./ticket-header";

/**
 * El fallback del encabezado (2026-08-26): el almacén manda; lo que no tenga
 * capturado cae al dato del negocio. Contraprueba mental: invertir el `??`
 * haría que un almacén CON dirección propia imprimiera la del negocio.
 */
describe("ticketHeaderContact", () => {
  const tenant = { address: "Av. Central 1", phone: "+525500000000" };

  it("el dato del almacén GANA cuando existe", () => {
    expect(
      ticketHeaderContact(tenant, { address: "Sucursal Norte 5", phone: "+525511111111" }),
    ).toEqual({ address: "Sucursal Norte 5", phone: "+525511111111" });
  });

  it("lo que el almacén no tiene cae al negocio, campo por campo", () => {
    expect(ticketHeaderContact(tenant, { address: "Sucursal Norte 5", phone: null })).toEqual({
      address: "Sucursal Norte 5",
      phone: "+525500000000",
    });
    expect(ticketHeaderContact(tenant, { address: null, phone: "+525511111111" })).toEqual({
      address: "Av. Central 1",
      phone: "+525511111111",
    });
  });

  it("sin dato en ninguno de los dos queda null (el renderer omite la línea)", () => {
    expect(
      ticketHeaderContact({ address: null, phone: null }, { address: null, phone: null }),
    ).toEqual({ address: null, phone: null });
  });
});
