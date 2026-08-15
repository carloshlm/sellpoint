/**
 * F1-WEB-ONBOARD (design A1): shape de tenant compartido entre `GET /me`
 * (users.service.ts), `POST /auth/login` (auth.service.ts) y `GET/PATCH
 * /tenants/me` (tenant-profile.service.ts). UN solo tipo, UN solo mapper —
 * evita la divergencia de shapes entre los DOS emisores del store de auth
 * documentada en el discovery "El store de auth se llena por DOS emisores
 * con shapes divergentes" (login vs /me).
 */
export interface TenantBlock {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  // F1-WEB-ONBOARD-03 (apply-progress Deviation 6): NO es dato real de
  // almacén (F2, D2) — es la única señal server-side de que el paso 3
  // (placeholder) del wizard ya se recorrió. Ver `lib/tenant/steps.ts` (web).
  warehouseStepSeen: boolean;
  onboarded: boolean;
}

/** Select de Prisma que alimenta `toTenantBlock` — un solo lugar para los 3 consumidores. */
export const TENANT_SELECT = {
  id: true,
  name: true,
  legalName: true,
  taxId: true,
  address: true,
  timezone: true,
  currency: true,
  templateChoice: true,
  warehouseStepSeen: true,
  onboarded: true,
} as const;

export type TenantRow = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  warehouseStepSeen: boolean;
  onboarded: boolean;
};

/** Función pura: fila de Prisma → `TenantBlock`. Testeable sin DB. */
export function toTenantBlock(row: TenantRow): TenantBlock {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    taxId: row.taxId,
    address: row.address,
    timezone: row.timezone,
    currency: row.currency,
    templateChoice: row.templateChoice,
    warehouseStepSeen: row.warehouseStepSeen,
    onboarded: row.onboarded,
  };
}
