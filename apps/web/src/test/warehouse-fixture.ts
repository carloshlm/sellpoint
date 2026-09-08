import type { Warehouse } from "@/lib/warehouses/api";

/**
 * F1-ADDR-01 — el almacén de los fixtures de test: el «Central» con el que
 * nace un negocio, sin dirección ni teléfono, activo y sin nada que impida
 * desactivarlo.
 *
 * Antes cada test armaba el literal completo a mano (14 archivos): cada campo
 * nuevo de `Warehouse` costaba 14 ediciones idénticas. Ahora un campo nuevo es
 * una línea acá, y cada test solo escribe lo que le importa. Mismo molde que
 * `tenant-fixture.ts`.
 */
export const WAREHOUSE_DEMO: Warehouse = {
  id: "w1",
  code: "ALM-001",
  name: "Central",
  address: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  phone: null,
  email: null,
  attributes: {},
  isActive: true,
  deactivationBlockedBy: null,
};

export function buildWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return { ...WAREHOUSE_DEMO, ...overrides };
}
