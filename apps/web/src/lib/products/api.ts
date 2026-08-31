import { api } from "@/lib/api";

/** Espejo de los DTO de `apps/api/src/modules/products` (F2-PROD/PRESENT/BOM). */
export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  isActive: boolean;
  attributes: Record<string, unknown>;
  /** Precio de la presentación predeterminada, ya como string decimal. */
  price: string | null;
}

export interface Presentation {
  id: string;
  productId: string;
  name: string;
  factor: string;
  isPurchasable: boolean;
  isSellable: boolean;
  isDefaultSale: boolean;
  allowFractionalInput: boolean;
  barcode: string | null;
  price: string | null;
  cost: string | null;
  isActive: boolean;
}

export interface ProductDetail extends Omit<ProductListItem, "price"> {
  stockMin: string;
  location: string | null;
  presentations: Presentation[];
  /** Opt-in al control de lote y caducidad (F3-LOTS-01). */
  tracksLots?: boolean;
  /**
   * Si hay existencias asignadas a lotes. Lo calcula el servidor para que el
   * formulario sepa deshabilitar el checkbox ANTES de que el usuario lo
   * intente: el 409 después sería explicar tarde algo que la pantalla podía
   * decir de entrada.
   */
  hasLotStock?: boolean;
}

export interface CompositionLine {
  id: string;
  componentProductId: string;
  quantity: string;
  wastePercentage: string;
  notes: string | null;
  component: { id: string; sku: string; name: string; baseUnit: string };
}

export interface Availability {
  units: number;
  limitedBy: { productId: string; sku: string; name: string } | null;
}

export interface CostEstimate {
  total: string;
  lines: { productId: string; sku: string; name: string; quantity: string; cost: string }[];
}

export interface ProductPage {
  total: number;
  page: number;
  pageSize: number;
  items: ProductListItem[];
}

export interface ListProductsParams {
  query?: string;
  composite?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listProducts(params: ListProductsParams = {}): Promise<ProductPage> {
  const { data } = await api.get<ProductPage>("/products", {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.composite !== undefined ? { composite: String(params.composite) } : {}),
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    },
  });
  return data;
}

export async function getProduct(id: string): Promise<ProductDetail> {
  const { data } = await api.get<ProductDetail>(`/products/${id}`);
  return data;
}

export interface UpsertProductInput {
  sku?: string;
  name?: string;
  baseUnit?: string;
  stockMin?: number;
  location?: string | null;
  isComposite?: boolean;
  tracksLots?: boolean;
  attributes?: Record<string, unknown>;
  price?: number | null;
  cost?: number | null;
  isActive?: boolean;
}

export async function createProduct(input: UpsertProductInput): Promise<ProductDetail> {
  const { data } = await api.post<ProductDetail>("/products", input);
  return data;
}

export async function updateProduct(id: string, input: UpsertProductInput): Promise<ProductDetail> {
  const { data } = await api.patch<ProductDetail>(`/products/${id}`, input);
  return data;
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/products/${id}`);
}

export interface UpsertPresentationInput {
  name?: string;
  factor?: number;
  isPurchasable?: boolean;
  isSellable?: boolean;
  isDefaultSale?: boolean;
  allowFractionalInput?: boolean;
  barcode?: string | null;
  price?: number | null;
  cost?: number | null;
  isActive?: boolean;
}

export async function listPresentations(productId: string): Promise<Presentation[]> {
  const { data } = await api.get<Presentation[]>(`/products/${productId}/presentations`);
  return data;
}

export async function createPresentation(
  productId: string,
  input: UpsertPresentationInput,
): Promise<Presentation> {
  const { data } = await api.post<Presentation>(`/products/${productId}/presentations`, input);
  return data;
}

export async function updatePresentation(
  productId: string,
  presentationId: string,
  input: UpsertPresentationInput,
): Promise<Presentation> {
  const { data } = await api.patch<Presentation>(
    `/products/${productId}/presentations/${presentationId}`,
    input,
  );
  return data;
}

export async function deletePresentation(productId: string, presentationId: string): Promise<void> {
  await api.delete(`/products/${productId}/presentations/${presentationId}`);
}

export interface CompositionInput {
  lines: {
    componentId: string;
    quantity: number;
    wastePercentage: number;
    notes?: string;
  }[];
}

export async function getComposition(productId: string): Promise<CompositionLine[]> {
  const { data } = await api.get<CompositionLine[]>(`/products/${productId}/composition`);
  return data;
}

export async function replaceComposition(
  productId: string,
  input: CompositionInput,
): Promise<CompositionLine[]> {
  const { data } = await api.post<CompositionLine[]>(`/products/${productId}/composition`, input);
  return data;
}

export async function getAvailability(productId: string): Promise<Availability> {
  const { data } = await api.get<Availability>(`/products/${productId}/availability`);
  return data;
}

export async function getCostEstimate(productId: string): Promise<CostEstimate> {
  const { data } = await api.get<CostEstimate>(`/products/${productId}/cost-estimate`);
  return data;
}
