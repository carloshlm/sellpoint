import { api } from "@/lib/api";

/** Espejo de `KardexService`. Los decimales viajan como string. */
export interface KardexRow {
  id: string;
  createdAt: string;
  direction: "entry" | "exit";
  reasonCode: string;
  reasonNote: string | null;
  reference: string | null;
  quantity: string;
  unitCost: string | null;
  location: string | null;
  /** El saldo que QUEDÓ en ese almacén después de esta línea. */
  balanceAfter: string;
  document: { id: string; folio: string; type: string; status: string };
  warehouse: { id: string; name: string };
  linkedWarehouse: { id: string; name: string } | null;
  presentation: {
    id: string;
    name: string;
    factor: string;
    quantityInPresentation: string;
  } | null;
  lot: { id: string; lotCode: string; expiresAt: string | null } | null;
  parentProduct: { id: string; sku: string; name: string } | null;
  createdBy: { id: string; name: string };
}

export interface KardexPage {
  rows: KardexRow[];
  total: number;
  page: number;
  pageSize: number;
  isComposite: boolean;
}

export interface StockLotRow {
  lotId: string;
  lotCode: string;
  expiresAt: string | null;
  location: string;
  quantity: string;
  /**
   * YA venció (estrictamente antes de hoy). Distinto de `expiringSoon`: son
   * excluyentes, y el vencido es el que FEFO despacha PRIMERO.
   */
  expired: boolean;
  expiringSoon: boolean;
}

export interface StockRow {
  warehouseId: string;
  name: string;
  quantity: string;
  /** `null` si nunca se movió nada en ese almacén — distinto de cero. */
  updatedAt: string | null;
  lots?: StockLotRow[];
}

export interface StockSummary {
  isComposite: boolean;
  rows: StockRow[];
  total: string;
  stockMin: string;
  belowMin: boolean;
  baseUnit: string;
  availability?: {
    units: number;
    limitingComponent: { productId: string; sku: string; name: string } | null;
  };
}

export interface InTransitRow {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  quantity: string;
  transfers: number;
}

export interface KardexParams {
  warehouseId?: string;
  from?: string;
  to?: string;
  direction?: "entry" | "exit";
  reasonCode?: string;
  page?: number;
  pageSize?: number;
}

export async function getKardex(productId: string, params: KardexParams): Promise<KardexPage> {
  const { data } = await api.get<KardexPage>(`/products/${productId}/kardex`, { params });
  return data;
}

export async function getStock(productId: string): Promise<StockSummary> {
  const { data } = await api.get<StockSummary>(`/products/${productId}/stock`);
  return data;
}

export async function getInTransit(productId: string): Promise<{ rows: InTransitRow[] }> {
  const { data } = await api.get<{ rows: InTransitRow[] }>("/inventory/in-transit", {
    params: { productId },
  });
  return data;
}

/**
 * Corregir un lote mal cargado. Cambiar `expiresAt` REORDENA el FEFO de todo
 * el stock de ese lote — por eso el API lo audita con before/after y la
 * pantalla lo advierte antes de mandar.
 */
export async function updateLot(
  productId: string,
  lotId: string,
  input: { lotCode?: string; expiresAt?: string | null },
): Promise<{ id: string; lotCode: string; expiresAt: string | null }> {
  const { data } = await api.patch<{ id: string; lotCode: string; expiresAt: string | null }>(
    `/products/${productId}/lots/${lotId}`,
    input,
  );
  return data;
}
