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

  // W4 (verify-report #357, revierte Deviation 6): el paso 3 es un
  // placeholder SIN dato real — no hay ninguna señal server-side que
  // distinga "recién llegó al paso 3" de "ya lo pasó", y no hace falta:
  // con negocio y plantilla completos, el piso YA es 4. `effectiveStep =
  // min(stepPedido, piso)` sigue mostrando el paso 3 cuando SE PIDE
  // explícitamente (`goToStep(3)` tras terminar el paso 2) — lo que cambia
  // es que el piso puro ya no "retiene" en 3 sin una escritura extra.
  it("con negocio y plantilla completos: el piso YA es 4 (paso 3 no tiene estado propio que retener)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "retail-basico",
        }),
      ),
    ).toBe(4);
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
});
