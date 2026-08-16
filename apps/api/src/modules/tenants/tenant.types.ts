/**
 * F1-WEB-ONBOARD (design A1): shape de tenant compartido entre `GET /me`
 * (users.service.ts), `POST /auth/login` (auth.service.ts) y `GET/PATCH
 * /tenants/me` (tenant-profile.service.ts). UN solo tipo, UN solo mapper —
 * evita la divergencia de shapes entre los DOS emisores del store de auth
 * documentada en el discovery "El store de auth se llena por DOS emisores
 * con shapes divergentes" (login vs /me).
 *
 * `country` (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2): ISO 3166-1
 * alpha-2 o `null` en un tenant que todavía no pasó el paso 1 del wizard con
 * el campo país. Se guarda como `string` (no `CountryCode`) porque una fila
 * ya persistida podría no pasar la validación estricta si el catálogo
 * compartido cambia — el mapper es un pass-through, no revalida.
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
  onboarded: boolean;
  country: string | null;
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
  onboarded: true,
  country: true,
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
  onboarded: boolean;
  country: string | null;
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
    onboarded: row.onboarded,
    country: row.country,
  };
}
