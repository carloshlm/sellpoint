import type { TaxMode } from "@sellpoint/shared";
import { api } from "@/lib/api";

/**
 * F4-TAX-14 — la configuración de impuestos del negocio, espejo de
 * `TaxSettingsView` del API. Leerla no exige `tenants:manage` (el selector
 * del catálogo la necesita); cambiarla sí.
 */
export interface TaxRateView {
  code: string;
  name: string;
  /** Porcentaje como texto decimal: «16», «9.975». */
  rate: string;
}

export interface TaxGroupView {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  usageCount: number;
  rates: TaxRateView[];
}

export interface TaxSettingsView {
  mode: TaxMode;
  country: string | null;
  region: string | null;
  needsRegion: boolean;
  hasSales: boolean;
  groups: TaxGroupView[];
}

export interface UpdateTaxGroupInput {
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  rates: TaxRateView[];
}

export interface UpdateTaxSettingsInput {
  mode?: TaxMode;
  region?: string | null;
  groups?: UpdateTaxGroupInput[];
}

export async function getTaxSettings(): Promise<TaxSettingsView> {
  const { data } = await api.get<TaxSettingsView>("/tenants/me/taxes");
  return data;
}

export async function updateTaxSettings(input: UpdateTaxSettingsInput): Promise<TaxSettingsView> {
  const { data } = await api.put<TaxSettingsView>("/tenants/me/taxes", input);
  return data;
}

export async function deleteTaxGroup(code: string): Promise<TaxSettingsView> {
  const { data } = await api.delete<TaxSettingsView>(`/tenants/me/taxes/groups/${code}`);
  return data;
}
