import { describe, expect, it } from "vitest";
import {
  asksSecondSurname,
  fullName,
  type NameFormat,
  resolveNameFormat,
  shortName,
} from "./names";
import { TAX_CURATED_COUNTRIES } from "./tax-defaults";

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

/**
 * F1-NAME-03 — cuántos apellidos pide un país. `single` no significa «una
 * palabra», significa «un campo»: un argentino con dos apellidos y un
 * brasileño con cuatro se escriben ahí adentro sin problema, y la búsqueda por
 * `contains` los sigue encontrando.
 */
describe("resolveNameFormat (F1-NAME-03)", () => {
  it("dos apellidos en México, España y la mayoría de Hispanoamérica", () => {
    for (const pais of ["MX", "ES", "CL", "CO", "PE", "UY", "CR", "VE"]) {
      expect(resolveNameFormat(pais)).toBe("double");
    }
  });

  it("un apellido en el mundo anglosajón y europeo", () => {
    for (const pais of ["US", "CA", "GB", "FR", "DE", "IT", "BZ"]) {
      expect(resolveNameFormat(pais)).toBe("single");
    }
  });

  it("Argentina lleva UN apellido, no dos: el segundo es opt-in y el DNI tiene un campo único", () => {
    // CCyC art. 64: el hijo lleva el primer apellido de alguno de los cónyuges
    // y el del otro «se puede agregar» a pedido. Es lo contrario de España o
    // México, donde son dos casillas del registro civil.
    expect(resolveNameFormat("AR")).toBe("single");
  });

  it("Portugal y Brasil son compuestos: un campo, pero en plural", () => {
    expect(resolveNameFormat("PT")).toBe("compound");
    expect(resolveNameFormat("BR")).toBe("compound");
  });

  it("sin país, país desconocido o en minúscula: un apellido, que es lo que no ofende a nadie", () => {
    expect(resolveNameFormat(null)).toBe("single");
    expect(resolveNameFormat(undefined)).toBe("single");
    expect(resolveNameFormat("JP")).toBe("single");
    expect(resolveNameFormat("")).toBe("single");
    // Sin normalizar la caja, mismo criterio que `resolveTaxDefaults`.
    expect(resolveNameFormat("mx")).toBe("single");
  });

  it("solo `double` pide una casilla aparte; `single` y `compound` se distinguen en la etiqueta", () => {
    expect(asksSecondSurname("double")).toBe(true);
    expect(asksSecondSurname("single")).toBe(false);
    expect(asksSecondSurname("compound")).toBe(false);
  });

  /**
   * La red de seguridad: si mañana se agrega un país curado y nadie le da
   * formato, este test lo caza — no se descubre en producción con un
   * formulario que pide un apellido de más.
   */
  it("los 26 países curados tienen su formato decidido, uno por uno", () => {
    const esperado: Record<string, NameFormat> = {
      MX: "double",
      US: "single",
      CA: "single",
      PT: "compound",
      ES: "double",
      FR: "single",
      IT: "single",
      DE: "single",
      GB: "single",
      BZ: "single",
      CR: "double",
      SV: "double",
      GT: "double",
      HN: "double",
      NI: "double",
      PA: "double",
      AR: "single",
      BO: "double",
      BR: "compound",
      CL: "double",
      CO: "double",
      EC: "double",
      PY: "double",
      PE: "double",
      UY: "double",
      VE: "double",
    };
    expect(Object.keys(esperado).sort()).toEqual([...TAX_CURATED_COUNTRIES].sort());
    for (const [pais, formato] of Object.entries(esperado)) {
      expect(resolveNameFormat(pais)).toBe(formato);
    }
  });
});
