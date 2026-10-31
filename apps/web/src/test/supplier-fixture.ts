import type { Supplier } from "@/lib/suppliers/api";

/**
 * El proveedor de los fixtures de test: solo el código y el nombre, sin
 * contacto, dirección ni contactos adicionales, activo.
 *
 * Mismo molde que `warehouse-fixture.ts`: un campo nuevo de `Supplier` es una
 * línea acá y no una edición idéntica en cada test que arma uno.
 */
export const SUPPLIER_DEMO: Supplier = {
  id: "s1",
  code: "PROV-001",
  name: "Distribuidora Norte",
  taxId: null,
  contactName: null,
  jobTitle: null,
  phone: null,
  email: null,
  address: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  notes: null,
  attributes: {},
  contacts: [],
  isActive: true,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
};

export function buildSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return { ...SUPPLIER_DEMO, ...overrides };
}
