import { ticketHeaderContact } from "./ticket-header";

const SIN_DIRECCION = {
  address: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
};

/**
 * El encabezado del ticket (2026-08-26, F1-ADDR-07): el ALMACÉN manda y lo que
 * no tenga cae al negocio. El teléfono sigue campo por campo; la dirección es
 * un BLOQUE entero (la calle del almacén con la ciudad del negocio sería una
 * dirección que no existe) y sale ya formateada en el orden de su país.
 */
describe("ticketHeaderContact", () => {
  const tenant = {
    ...SIN_DIRECCION,
    address: "Av. Central 1",
    city: "Toluca",
    region: "MEX",
    postalCode: "50000",
    phone: "+525500000000",
  };

  it("el dato del almacén GANA cuando existe, y el bloque sale entero", () => {
    expect(
      ticketHeaderContact(
        tenant,
        { ...SIN_DIRECCION, address: "Sucursal Norte 5", phone: "+525511111111" },
        "MX",
      ),
    ).toEqual({ address: "Sucursal Norte 5", phone: "+525511111111" });
  });

  it("el teléfono cae al negocio campo por campo; la dirección, por BLOQUE", () => {
    expect(
      ticketHeaderContact(
        tenant,
        { ...SIN_DIRECCION, address: "Sucursal Norte 5", phone: null },
        "MX",
      ),
    ).toEqual({ address: "Sucursal Norte 5", phone: "+525500000000" });
    // El almacén tiene ciudad pero no calle: esa ciudad huérfana NO se mezcla
    // con la calle del negocio — se imprime el bloque del negocio entero.
    expect(
      ticketHeaderContact(
        tenant,
        { ...SIN_DIRECCION, city: "Monterrey", phone: "+525511111111" },
        "MX",
      ),
    ).toEqual({
      address: "Av. Central 1, 50000 Toluca, Estado de México",
      phone: "+525511111111",
    });
  });

  it("la dirección completa se imprime en el orden de su país", () => {
    const canadiense = {
      ...SIN_DIRECCION,
      address: "123 Main St",
      addressLine2: "Unit 4",
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 3L9",
      phone: null,
    };
    expect(ticketHeaderContact(canadiense, { ...SIN_DIRECCION, phone: null }, "CA")).toEqual({
      address: "123 Main St, Unit 4, Toronto ON M5V 3L9",
      phone: null,
    });
  });

  it("la contraprueba: un negocio con solo texto libre imprime exactamente lo de siempre", () => {
    const viejo = { ...SIN_DIRECCION, address: "Calle 5 manzana 5, CDMX", phone: null };
    expect(ticketHeaderContact(viejo, { ...SIN_DIRECCION, phone: null }, "MX")).toEqual({
      address: "Calle 5 manzana 5, CDMX",
      phone: null,
    });
    expect(ticketHeaderContact(viejo, { ...SIN_DIRECCION, phone: null }, null)).toEqual({
      address: "Calle 5 manzana 5, CDMX",
      phone: null,
    });
  });

  it("sin dato en ninguno de los dos queda null (el renderer omite la línea)", () => {
    expect(
      ticketHeaderContact(
        { ...SIN_DIRECCION, phone: null },
        { ...SIN_DIRECCION, phone: null },
        "MX",
      ),
    ).toEqual({ address: null, phone: null });
  });
});
