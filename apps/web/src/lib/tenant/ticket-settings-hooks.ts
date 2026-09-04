import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  getTicketSettings,
  removeTicketLogo,
  type TicketSettingsView,
  type UpdateTicketSettingsInput,
  updateTicketSettings,
  uploadTicketLogo,
} from "./ticket-settings-api";

export const TICKET_SETTINGS_KEY = ["tenant", "ticket-settings"] as const;

/**
 * F4-TICKETCFG-08 — la configuración del ticket en el web. Cada mutación
 * escribe la caché con lo que devolvió el API: la vista previa del logotipo
 * es el PNG que QUEDÓ (gris, pequeño), no el archivo que se subió.
 */
export function useTicketSettings(enabled: boolean) {
  return useQuery<TicketSettingsView, ApiError>({
    queryKey: TICKET_SETTINGS_KEY,
    queryFn: getTicketSettings,
    enabled,
  });
}

function useEscribeCache() {
  const queryClient = useQueryClient();
  return (data: TicketSettingsView) => queryClient.setQueryData(TICKET_SETTINGS_KEY, data);
}

export function useUpdateTicketSettings() {
  const escribe = useEscribeCache();
  return useMutation<TicketSettingsView, ApiError, UpdateTicketSettingsInput>({
    // Envuelta a propósito: react-query pasa un segundo argumento (su
    // contexto) que el cliente HTTP no tiene por qué ver.
    mutationFn: (input) => updateTicketSettings(input),
    onSuccess: escribe,
  });
}

export function useUploadTicketLogo() {
  const escribe = useEscribeCache();
  return useMutation<TicketSettingsView, ApiError, string>({
    mutationFn: (contentBase64) => uploadTicketLogo(contentBase64),
    onSuccess: escribe,
  });
}

export function useRemoveTicketLogo() {
  const escribe = useEscribeCache();
  return useMutation<TicketSettingsView, ApiError, void>({
    mutationFn: () => removeTicketLogo(),
    onSuccess: escribe,
  });
}
