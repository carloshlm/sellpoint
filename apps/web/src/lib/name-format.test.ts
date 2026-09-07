import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { LAST_NAME_LABEL_KEY, nameFormatOf } from "./name-format";

/**
 * F1-NAME-08 — cuántas casillas de apellido pinta un formulario sale del país
 * del NEGOCIO, no del idioma de la pantalla ni del país de la persona.
 */
describe("el formato de nombre del negocio (F1-NAME-08)", () => {
  const conPais = (country: string | null) => {
    useAuthStore
      .getState()
      .setAuth("jwt", buildAuthUser({ tenant: buildTenantBlock({ country }) }));
  };

  beforeEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("México pide dos apellidos; Estados Unidos, uno; Brasil, uno en plural", () => {
    conPais("MX");
    expect(nameFormatOf()).toBe("double");
    conPais("US");
    expect(nameFormatOf()).toBe("single");
    conPais("BR");
    expect(nameFormatOf()).toBe("compound");
  });

  it("sin sesión y sin país del negocio: un apellido, que no le pide de más a nadie", () => {
    expect(nameFormatOf()).toBe("single");
    conPais(null);
    expect(nameFormatOf()).toBe("single");
  });

  it("cada formato tiene su etiqueta, y son claves LITERALES para poder grepearlas", () => {
    expect(LAST_NAME_LABEL_KEY).toEqual({
      single: "common.name.lastName.single",
      double: "common.name.lastName.double",
      compound: "common.name.lastName.compound",
    });
  });
});
