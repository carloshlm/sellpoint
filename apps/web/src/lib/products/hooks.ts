import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type Availability,
  type CompositionInput,
  type CompositionLine,
  type CostEstimate,
  createPresentation,
  createProduct,
  deleteProduct,
  getAvailability,
  getComposition,
  getCostEstimate,
  getProduct,
  type ListProductsParams,
  listPresentations,
  listProducts,
  type Presentation,
  type ProductDetail,
  type ProductPage,
  replaceComposition,
  type UpsertPresentationInput,
  type UpsertProductInput,
  updatePresentation,
  updateProduct,
} from "./api";

export const PRODUCTS_QUERY_KEY = ["products"] as const;

export function productsQueryKey(params: ListProductsParams) {
  return ["products", "list", params] as const;
}

export function productQueryKey(id: string) {
  return ["products", id] as const;
}

export function useProducts(params: ListProductsParams) {
  return useQuery<ProductPage, ApiError>({
    queryKey: productsQueryKey(params),
    queryFn: () => listProducts(params),
    // El server pagina: sin esto la tabla parpadearía en cada cambio de página.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery<ProductDetail, ApiError>({
    queryKey: productQueryKey(id ?? ""),
    queryFn: () => getProduct(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation<ProductDetail, ApiError, UpsertProductInput>({
    mutationFn: createProduct,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation<ProductDetail, ApiError, { id: string; input: UpsertProductInput }>({
    mutationFn: ({ id, input }) => updateProduct(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteProduct,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}

export function usePresentations(productId: string | undefined) {
  return useQuery<Presentation[], ApiError>({
    queryKey: ["products", productId ?? "", "presentations"],
    queryFn: () => listPresentations(productId as string),
    enabled: Boolean(productId),
  });
}

export function useCreatePresentation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation<Presentation, ApiError, UpsertPresentationInput>({
    mutationFn: (input) => createPresentation(productId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdatePresentation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    Presentation,
    ApiError,
    { presentationId: string; input: UpsertPresentationInput }
  >({
    mutationFn: ({ presentationId, input }) => updatePresentation(productId, presentationId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useComposition(productId: string | undefined) {
  return useQuery<CompositionLine[], ApiError>({
    queryKey: ["products", productId ?? "", "composition"],
    queryFn: () => getComposition(productId as string),
    enabled: Boolean(productId),
  });
}

export function useReplaceComposition(productId: string) {
  const queryClient = useQueryClient();
  return useMutation<CompositionLine[], ApiError, CompositionInput>({
    mutationFn: (input) => replaceComposition(productId, input),
    onSuccess: () => {
      // También availability y cost-estimate: cambiar la composición cambia
      // los dos, y son justo lo que el usuario está mirando.
      void queryClient.invalidateQueries({ queryKey: ["products", productId] });
    },
  });
}

export function useAvailability(productId: string | undefined, enabled = true) {
  return useQuery<Availability, ApiError>({
    queryKey: ["products", productId ?? "", "availability"],
    queryFn: () => getAvailability(productId as string),
    enabled: Boolean(productId) && enabled,
  });
}

export function useCostEstimate(productId: string | undefined, enabled = true) {
  return useQuery<CostEstimate, ApiError>({
    queryKey: ["products", productId ?? "", "cost-estimate"],
    queryFn: () => getCostEstimate(productId as string),
    enabled: Boolean(productId) && enabled,
  });
}
