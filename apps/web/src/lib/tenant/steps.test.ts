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
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
    sellWithoutStock: false,
    usesLocations: false,
    country: null,
    ...overrides,
  };
}

describe("primerPasoIncompleto (matriz de tenants)", () => {
  it("sin country/legalName/taxId/address: paso 1 (datos del negocio)", () => {
    expect(primerPasoIncompleto(tenant())).toBe(1);
  });

  it("con legalName pero sin country/taxId: sigue en paso 1 (todos los campos son requeridos)", () => {
    expect(primerPasoIncompleto(tenant({ legalName: "Acme SA de CV" }))).toBe(1);
  });

  it("con legalName y taxId pero sin country/address: sigue en paso 1", () => {
    expect(
      primerPasoIncompleto(tenant({ legalName: "Acme SA de CV", taxId: "ACM010101AAA" })),
    ).toBe(1);
  });

  // Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2): `country` es un
  // requerido MÁS del paso 1, no un sustituto de los otros tres — con los
  // otros tres completos pero sin país, el piso sigue siendo 1.
  it("con legalName+taxId+address pero sin country: sigue en paso 1", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
        }),
      ),
    ).toBe(1);
  });

  // Consecuencia deliberada del cambio ad-hoc: un tenant que YA había
  // pasado el paso 1 ANTES de que existiera `country` (los otros tres
  // completos, `country` en NULL) vuelve a caer en el paso 1 hasta elegirlo.
  it("tenant preexistente con legalName+taxId+address pero country=NULL (creado antes del campo país): vuelve al paso 1", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
        }),
      ),
    ).toBe(1);
  });

  /**
   * El wizard de 3 pasos (Carlos, 2026-08-25): negocio → almacén → tema.
   * `templateChoice` quedó como columna muerta y NO participa del piso.
   */
  const negocioCompleto = {
    country: "MX",
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
  };

  it("con el negocio completo y SIN almacén: paso 2", () => {
    expect(primerPasoIncompleto(tenant(negocioCompleto), { hasWarehouse: false })).toBe(2);
  });

  it("con negocio y almacén: el piso es 3 (el tema, último paso)", () => {
    expect(primerPasoIncompleto(tenant(negocioCompleto), { hasWarehouse: true })).toBe(3);
  });

  it("templateChoice NO participa: con negocio completo y sin almacén sigue siendo 2", () => {
    expect(
      primerPasoIncompleto(tenant({ ...negocioCompleto, templateChoice: "custom" }), {
        hasWarehouse: false,
      }),
    ).toBe(2);
  });

  it("tenant ya onboarded: el piso sigue siendo 3 (el gate ya no monta el wizard en este caso)", () => {
    expect(
      primerPasoIncompleto(tenant({ ...negocioCompleto, onboarded: true }), {
        hasWarehouse: true,
      }),
    ).toBe(3);
  });
});
