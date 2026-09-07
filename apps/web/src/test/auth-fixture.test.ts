import { describe, expect, it } from "vitest";
import { AUTH_USER_DEMO, buildAuthUser } from "./auth-fixture";

/**
 * F1-NAME-01 — la barrera del fixture. Los 58 archivos que lo usan NO fijan
 * estos defaults: cada uno nombra lo que le importa (y está bien que así sea),
 * así que un cambio de default no rompería ninguno. Este test es el único
 * lugar donde el contrato de la factory está escrito.
 */
describe("buildAuthUser (F1-NAME-01)", () => {
  it("por defecto es Ana Pérez, sin permisos, en español y en un negocio ya incorporado", () => {
    const user = buildAuthUser();
    expect(user).toMatchObject({
      firstName: "Ana",
      lastName: "Pérez",
      secondLastName: null,
      locale: "es",
      permissions: [],
    });
    // Sin onboarding pendiente: casi toda pantalla vive detrás del gate.
    expect(user.tenant.onboarded).toBe(true);
    expect(user.tenant.country).toBe("MX");
  });

  it("los overrides ganan, incluido el negocio entero", () => {
    const user = buildAuthUser({
      permissions: ["tenants:manage"],
      email: "beto@acme.mx",
      tenant: { ...AUTH_USER_DEMO.tenant, country: "CA", onboarded: false },
    });
    expect(user.permissions).toEqual(["tenants:manage"]);
    expect(user.email).toBe("beto@acme.mx");
    expect(user.tenant).toMatchObject({ country: "CA", onboarded: false });
    // Lo que no se nombra sigue siendo el default.
    expect(user.firstName).toBe("Ana");
  });

  it("cada llamada trae su propio negocio: un test no puede contaminar al de al lado", () => {
    const uno = buildAuthUser();
    const otro = buildAuthUser();
    expect(uno.tenant).not.toBe(otro.tenant);
    uno.tenant.name = "Otro negocio";
    expect(otro.tenant.name).toBe("Acme");
    expect(AUTH_USER_DEMO.tenant.name).toBe("Acme");
  });
});
