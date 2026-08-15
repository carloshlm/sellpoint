import type { TenantBlock } from "./api";
import { primerPasoIncompleto } from "./steps";

/**
 * F1-WEB-ONBOARD-01 (design A3): función PURA, sin React — el paso del
 * wizard se DERIVA de los datos del tenant, nunca de estado en memoria ni de
 * localStorage. `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`
 * vive en el container (`routes/onboarding.tsx`), acá solo la derivación.
 */
function tenant(overrides: Partial<TenantBlock> = {}): TenantBlock {
  return {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    warehouseStepSeen: false,
    onboarded: false,
    ...overrides,
  };
}

describe("primerPasoIncompleto (matriz de tenants)", () => {
  it("sin legalName/taxId/address: paso 1 (datos del negocio)", () => {
    expect(primerPasoIncompleto(tenant())).toBe(1);
  });

  it("con legalName pero sin taxId: sigue en paso 1 (todos los campos son requeridos)", () => {
    expect(primerPasoIncompleto(tenant({ legalName: "Acme SA de CV" }))).toBe(1);
  });

  it("con legalName y taxId pero sin address: sigue en paso 1", () => {
    expect(
      primerPasoIncompleto(tenant({ legalName: "Acme SA de CV", taxId: "ACM010101AAA" })),
    ).toBe(1);
  });

  it("con legalName+taxId+address, sin templateChoice: paso 2 (plantilla)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
        }),
      ),
    ).toBe(2);
  });

  // F1-WEB-ONBOARD-02: con negocio y plantilla completos, el piso retoma en
  // el paso 3 (almacén) al recargar — YA NO salta directo a 4. El paso 2
  // completo (`templateChoice` persistido) es una señal real; saltarlo
  // ocultaría el paso 3 apenas se implemente (F1-WEB-ONBOARD-03).
  it("con negocio y plantilla completos: paso 3 (retoma en almacén, no salta)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "retail-basico",
        }),
      ),
    ).toBe(3);
  });

  it("tenant ya onboarded: el piso sigue siendo 4 (el gate ya no monta el wizard en este caso)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "retail-basico",
          onboarded: true,
        }),
      ),
    ).toBe(4);
  });

  // F1-WEB-ONBOARD-03 (apply-progress Deviation 6): `warehouseStepSeen` es
  // la única señal server-side del paso 3 — sin ella, "retoma en 3" del test
  // anterior sería el TECHO para siempre (ni Continuar en el paso 3 podría
  // avanzar, con o sin recarga).
  it("con negocio, plantilla y warehouseStepSeen=true: paso 4 (avanza, ya no retoma en 3)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "retail-basico",
          warehouseStepSeen: true,
        }),
      ),
    ).toBe(4);
  });
});
