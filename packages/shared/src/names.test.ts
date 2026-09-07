import { describe, expect, it } from "vitest";
import { fullName, shortName } from "./names";

/**
 * F1-NAME-02 — el nombre de una persona se arma en UN solo lugar. Antes había
 * cuatro reimplementaciones en el API y seis en el web, más el patrón de dos
 * campos repetido quince veces: cada una podía derivar por su cuenta.
 *
 * Los casos de abajo son EXACTAMENTE lo que hacían esas copias. Si alguno
 * cambia, cambia lo que sale impreso en un ticket o guardado en un snapshot.
 */
describe("fullName (F1-NAME-02)", () => {
  it("une nombre y los dos apellidos con un espacio", () => {
    expect(
      fullName({ firstName: "Ana", lastNamePaternal: "Pérez", lastNameMaternal: "Luna" }),
    ).toBe("Ana Pérez Luna");
  });

  it("sin segundo apellido no deja espacio de más: da igual null que cadena vacía", () => {
    expect(fullName({ firstName: "Ana", lastNamePaternal: "Pérez", lastNameMaternal: null })).toBe(
      "Ana Pérez",
    );
    expect(fullName({ firstName: "Ana", lastNamePaternal: "Pérez", lastNameMaternal: "" })).toBe(
      "Ana Pérez",
    );
    // El campo puede no venir en el objeto (los `select` de dos campos).
    expect(fullName({ firstName: "Ana", lastNamePaternal: "Pérez" })).toBe("Ana Pérez");
  });

  it("NUNCA trunca: el límite de la columna es del que guarda, no del nombre", () => {
    const largo = fullName({
      firstName: "A".repeat(150),
      lastNamePaternal: "B".repeat(150),
      lastNameMaternal: null,
    });
    expect(largo).toHaveLength(301);
  });
});

describe("shortName (F1-NAME-02)", () => {
  it("es nombre y PRIMER apellido: lo que cabe en un ticket o una firma", () => {
    expect(
      shortName({ firstName: "Ana", lastNamePaternal: "Pérez", lastNameMaternal: "Luna" }),
    ).toBe("Ana Pérez");
  });

  it("ignora el segundo apellido aunque exista — esa es toda su razón de ser", () => {
    const persona = { firstName: "Ana", lastNamePaternal: "Pérez", lastNameMaternal: "Luna" };
    expect(shortName(persona)).not.toContain("Luna");
    expect(shortName(persona)).not.toBe(fullName(persona));
  });

  it("un campo vacío no deja espacios sueltos (lo que hacía el `.trim()` de antes)", () => {
    expect(shortName({ firstName: "Ana", lastNamePaternal: "" })).toBe("Ana");
    expect(shortName({ firstName: "", lastNamePaternal: "Pérez" })).toBe("Pérez");
  });
});
