import type { TenantBlock } from "@/lib/tenant/api";

/**
 * F4-TAX-01 — el bloque del negocio de los fixtures de test: un negocio
 * mexicano ya incorporado, con los interruptores en su valor de fábrica.
 *
 * Antes cada test armaba el literal completo a mano (63 archivos): cada campo
 * nuevo de `TenantBlock` costaba 63 ediciones idénticas. Ahora un campo nuevo
 * es una línea acá, y cada test solo escribe lo que le importa.
 */
export const TENANT_DEMO: TenantBlock = {
  id: "tenant-1",
  name: "Acme",
  legalName: null,
  taxId: null,
  address: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  phone: null,
  theme: null,
  timezone: "America/Mexico_City",
  currency: "MXN",
  templateChoice: null,
  onboarded: true,
  country: "MX",
  sellWithoutStock: false,
  usesLocations: false,
  posShowsStock: true,
  usesPurchaseOrders: false,
  monthlySalesGoal: null,
  discountCodeSetAt: null,
  discountMaxPercent: null,
  taxMode: "included",
  region: null,
};

export function buildTenantBlock(overrides: Partial<TenantBlock> = {}): TenantBlock {
  return { ...TENANT_DEMO, ...overrides };
}
