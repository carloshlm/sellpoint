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
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
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

  it("con country+legalName+taxId+address, sin templateChoice: paso 2 (campos del catálogo)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          country: "MX",
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
        }),
      ),
    ).toBe(2);
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
          templateChoice: "custom",
        }),
      ),
    ).toBe(1);
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
          country: "MX",
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "custom",
        }),
      ),
    ).toBe(4);
  });

  it("tenant ya onboarded: el piso sigue siendo 4 (el gate ya no monta el wizard en este caso)", () => {
    expect(
      primerPasoIncompleto(
        tenant({
          country: "MX",
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          templateChoice: "custom",
          onboarded: true,
        }),
      ),
    ).toBe(4);
  });
});
