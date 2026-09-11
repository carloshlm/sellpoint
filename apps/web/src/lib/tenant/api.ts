import type { TaxMode } from "@sellpoint/shared";
import { api } from "@/lib/api";

/**
 * F1-WEB-ONBOARD-01: espejo EXACTO de `TenantBlock` (apps/api,
 * tenant.types.ts) — MISMO shape que `AuthUser.tenant` (auth.store.ts),
 * A1 del design. Gemelo estructural de `lib/rbac/api.ts`.
 *
 * `country` (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2): ISO 3166-1
 * alpha-2 o `null` en un tenant que todavía no pasó el paso 1 del wizard
 * con el campo país — `string`, no `CountryCode`, mismo criterio que el
 * backend (`tenant.types.ts`): es un pass-through de lo ya persistido, no
 * revalida contra el catálogo compartido.
 */
export interface TenantBlock {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  /** F1-ADDR: la dirección estructurada; `address` es la línea 1 (ver `@sellpoint/shared` address.ts). */
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
  /** F7-POS-05: el toggle "Vender sin existencias" de los ajustes del negocio. */
  sellWithoutStock: boolean;
  /**
   * El interruptor de UBICACIONES: muestra el campo "Ubicación" en la ficha
   * del producto y ordena la hoja del inventario por recorrido del almacén.
   * No lleva saldo por ubicación — eso vive en los lotes.
   */
  usesLocations: boolean;
  /** F4-POSVIS: si el vendedor ve existencias en el punto de venta (por defecto sí). */
  posShowsStock: boolean;
  /**
   * F9-PO-02: «Usar órdenes de compra» — pedido al proveedor, recepciones
   * parciales y la compra sobre lo recibido. Apagado, la compra es la factura.
   */
  usesPurchaseOrders: boolean;
  /**
   * F5-DASH-02: la meta mensual de ventas — string decimal («800000») o null.
   * El dashboard pinta contra ella la barra de «% alcanzado».
   */
  monthlySalesGoal: string | null;
  /** F4-TAX-16: ¿el precio de catálogo ya incluye el impuesto? Lo consulta el carrito. */
  taxMode: TaxMode;
  /** F9-COSTMODE-02: ¿el costo se captura con el impuesto adentro? */
  costTaxMode: TaxMode;
  /** F4-TAX-16: provincia o estado (ISO 3166-2 sin prefijo), solo CA y US. */
  region: string | null;
  /** F4-DISC: cuándo se configuró el PIN de descuentos (ISO) o null; el hash nunca viaja. */
  discountCodeSetAt: string | null;
  /** F4-DISC: tope del descuento por ticket, % del subtotal como string decimal («20») o null. */
  discountMaxPercent: string | null;
}

/** PATCH parcial — espejo de `update-tenant.dto.ts` (apps/api). */
export type UpdateTenantInput = Partial<
  Pick<
    TenantBlock,
    | "name"
    | "legalName"
    | "taxId"
    | "address"
    | "addressLine2"
    | "city"
    | "postalCode"
    | "phone"
    | "theme"
    | "timezone"
    | "currency"
    | "templateChoice"
    | "country"
    | "region"
    | "sellWithoutStock"
    | "usesLocations"
    | "posShowsStock"
    | "usesPurchaseOrders"
  >
> & {
  // En el PATCH la meta viaja como NÚMERO (el DTO del API valida positivo y
  // 2 decimales); en el TenantBlock vive como string decimal. Por eso no
  // entra al Pick de arriba.
  monthlySalesGoal?: number | null;
  /** F4-DISC: el PIN nuevo (4 a 8 dígitos) o null para quitarlo. */
  discountCode?: string | null;
  /** F4-DISC: el tope por ticket en %, o null para quitarlo. */
  discountMaxPercent?: number | null;
};

export async function getMyTenant(): Promise<TenantBlock> {
  const { data } = await api.get<TenantBlock>("/tenants/me");
  return data;
}

export async function updateMyTenant(input: UpdateTenantInput): Promise<TenantBlock> {
  const { data } = await api.patch<TenantBlock>("/tenants/me", input);
  return data;
}

// 200, no 201/204: transición de estado sobre un recurso existente (mismo
// criterio que `suspendUser`/`reactivateUser` en lib/rbac/api.ts).
export async function completeOnboarding(): Promise<TenantBlock> {
  const { data } = await api.post<TenantBlock>("/tenants/me/complete-onboarding");
  return data;
}
