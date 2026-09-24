import { nombreLegalAparte, ticketHeaderContact } from "./ticket-header";

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

/**
 * F10-MANFIX-14 — el nombre legal va junto al RFC solo cuando dice algo que
 * el nombre del negocio no dijo ya: «Abarrotes La Esquina» arriba y «Ana
 * Pérez» abajo. Si falta, o es el mismo nombre escrito de otra forma, el
 * ticket lo dice UNA vez.
 */
describe("nombreLegalAparte (F10-MANFIX-14)", () => {
  it("un nombre legal distinto del negocio se imprime junto al RFC", () => {
    expect(nombreLegalAparte("Abarrotes La Esquina", "Ana Pérez")).toBe("Ana Pérez");
  });

  it("sin nombre legal, o en blanco, no hay nada que agregar", () => {
    expect(nombreLegalAparte("Abarrotes La Esquina", null)).toBeNull();
    expect(nombreLegalAparte("Abarrotes La Esquina", "   ")).toBeNull();
  });

  it("el mismo nombre con otras mayúsculas, acentos o espacios sale una sola vez", () => {
    expect(nombreLegalAparte("Abarrotes La Esquina", "Abarrotes La Esquina")).toBeNull();
    expect(nombreLegalAparte("Abarrotes La Esquina", "ABARROTES  LA ESQUINA ")).toBeNull();
    expect(nombreLegalAparte("Farmacia Pérez", "FARMACIA PEREZ")).toBeNull();
  });

  it("se imprime tal como se capturó, sin los espacios de las orillas", () => {
    expect(nombreLegalAparte("Mi Negocio", "  DISTRIBUIDORA DEL NORTE S.A. DE C.V. ")).toBe(
      "DISTRIBUIDORA DEL NORTE S.A. DE C.V.",
    );
  });
});
