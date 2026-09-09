import type { TaxMode } from "@sellpoint/shared";
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
  /** F1-ADDR-03: la dirección estructurada; `address` es la línea 1. */
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  theme: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  onboarded: boolean;
  country: string | null;
  // F7-POS-05: el toggle "Vender sin existencias" — el front lo pinta en los
  // ajustes del negocio (editable con plan con control; fijo en Basic/Free).
  sellWithoutStock: boolean;
  // El interruptor de UBICACIONES: la ficha del producto muestra "Ubicación"
  // y la hoja del inventario se ordena por recorrido del almacén.
  usesLocations: boolean;
  /** F4-POSVIS: si el vendedor ve existencias en el punto de venta. */
  posShowsStock: boolean;
  // F5-DASH-02: la meta mensual de ventas, como string decimal («800000») o
  // null. String y no number: es un Decimal de Prisma y el JSON del resto del
  // sistema ya serializa el dinero así.
  monthlySalesGoal: string | null;
  /**
   * F4-TAX-16: ¿el precio de catálogo ya incluye el impuesto? El carrito lo
   * consulta para calcular con la MISMA aritmética que el servidor.
   */
  taxMode: TaxMode;
  /** F4-TAX-16: provincia o estado (ISO 3166-2 sin prefijo), solo CA y US. */
  region: string | null;
  /**
   * F4-DISC: cuándo se configuró el PIN de descuentos (ISO) o null si no hay.
   * El hash JAMÁS viaja: el cliente solo necesita saber si existe.
   */
  discountCodeSetAt: string | null;
  /** F4-DISC: tope del descuento por ticket en % del subtotal («20») o null. */
  discountMaxPercent: string | null;
}

/** Select de Prisma que alimenta `toTenantBlock` — un solo lugar para los 3 consumidores. */
export const TENANT_SELECT = {
  id: true,
  name: true,
  legalName: true,
  taxId: true,
  address: true,
  addressLine2: true,
  city: true,
  postalCode: true,
  phone: true,
  theme: true,
  timezone: true,
  currency: true,
  templateChoice: true,
  onboarded: true,
  country: true,
  sellWithoutStock: true,
  usesLocations: true,
  posShowsStock: true,
  monthlySalesGoal: true,
  taxMode: true,
  region: true,
  discountCodeSetAt: true,
  discountMaxPercent: true,
} as const;

export type TenantRow = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  /** F1-ADDR-03: la dirección estructurada; `address` es la línea 1. */
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  theme: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  onboarded: boolean;
  country: string | null;
  sellWithoutStock: boolean;
  usesLocations: boolean;
  /** F4-POSVIS: si el vendedor ve existencias en el punto de venta. */
  posShowsStock: boolean;
  monthlySalesGoal: { toString(): string } | null;
  taxMode: string;
  region: string | null;
  discountCodeSetAt: Date | null;
  discountMaxPercent: { toString(): string } | null;
};

/** Función pura: fila de Prisma → `TenantBlock`. Testeable sin DB. */
export function toTenantBlock(row: TenantRow): TenantBlock {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    taxId: row.taxId,
    address: row.address,
    addressLine2: row.addressLine2,
    city: row.city,
    postalCode: row.postalCode,
    phone: row.phone,
    theme: row.theme,
    timezone: row.timezone,
    currency: row.currency,
    templateChoice: row.templateChoice,
    onboarded: row.onboarded,
    country: row.country,
    sellWithoutStock: row.sellWithoutStock,
    usesLocations: row.usesLocations,
    posShowsStock: row.posShowsStock,
    monthlySalesGoal: row.monthlySalesGoal?.toString() ?? null,
    taxMode: row.taxMode as TaxMode,
    region: row.region,
    discountCodeSetAt: row.discountCodeSetAt?.toISOString() ?? null,
    discountMaxPercent: row.discountMaxPercent?.toString() ?? null,
  };
}
