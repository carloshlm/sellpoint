import type { ReceptionSettings } from "@sellpoint/shared";
import { api } from "@/lib/api";

/**
 * F9-RECEP-18 — el cliente HTTP de la configuración de Recepción, en su
 * propio archivo: los tests de las pantallas del módulo mockean
 * `lib/reception/api` con una lista cerrada de funciones, y meter estas ahí
 * los rompería uno por uno. Además así el hook (`settings.ts`) se puede
 * probar mockeando SOLO la red.
 */
export type { ReceptionSettings };

export type UpdateReceptionSettingsInput = Partial<ReceptionSettings>;

export async function getReceptionSettings(): Promise<ReceptionSettings> {
  const { data } = await api.get<ReceptionSettings>("/reception/settings");
  return data;
}

export async function updateReceptionSettings(
  input: UpdateReceptionSettingsInput,
): Promise<ReceptionSettings> {
  const { data } = await api.put<ReceptionSettings>("/reception/settings", input);
  return data;
}
