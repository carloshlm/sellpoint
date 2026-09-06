import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { resyncSession } from "@/lib/auth/session-resync";
import {
  deleteTaxGroup,
  getTaxSettings,
  type TaxSettingsView,
  type UpdateTaxSettingsInput,
  updateTaxSettings,
} from "./tax-api";

export const TAX_SETTINGS_KEY = ["tenant", "taxes"] as const;

/**
 * F4-TAX-14 — los impuestos del negocio en el web. Cada mutación escribe la
 * caché con lo que devolvió el API, y cambiar el MODO refresca la sesión:
 * `AuthUser.tenant.taxMode` es lo que el carrito consulta para calcular.
 */
export function useTaxSettings(enabled = true) {
  return useQuery<TaxSettingsView, ApiError>({
    queryKey: TAX_SETTINGS_KEY,
    queryFn: getTaxSettings,
    enabled,
  });
}

function useEscribeCache() {
  const queryClient = useQueryClient();
  return (data: TaxSettingsView) => queryClient.setQueryData(TAX_SETTINGS_KEY, data);
}

export function useUpdateTaxSettings() {
  const escribe = useEscribeCache();
  return useMutation<TaxSettingsView, ApiError, UpdateTaxSettingsInput>({
    mutationFn: (input) => updateTaxSettings(input),
    onSuccess: async (data, input) => {
      escribe(data);
      if (input.mode !== undefined || input.region !== undefined) {
        await resyncSession();
      }
    },
  });
}

export function useDeleteTaxGroup() {
  const escribe = useEscribeCache();
  return useMutation<TaxSettingsView, ApiError, string>({
    mutationFn: (code) => deleteTaxGroup(code),
    onSuccess: escribe,
  });
}
