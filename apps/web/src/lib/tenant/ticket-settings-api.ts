import type { TicketLogoPreset, TicketSettings } from "@sellpoint/shared";
import { api } from "@/lib/api";

/**
 * F4-TICKETCFG-08 — el cliente HTTP de la configuración del ticket, en su
 * propio archivo: los tests que mockean `lib/tenant/api` con una lista
 * cerrada no se enteran de estas funciones, y la tarjeta se prueba mockeando
 * SOLO la red.
 */
export interface TicketSettingsView extends TicketSettings {
  /** La vista previa del logotipo propio: el PNG que la térmica va a imprimir. */
  logoDataUrl: string | null;
}

export interface UpdateTicketSettingsInput {
  showBusinessName?: boolean;
  showTaxId?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  showWarehouse?: boolean;
  footerMessage?: string | null;
  logo?: { kind: "none" } | { kind: "preset"; preset: TicketLogoPreset };
}

export async function getTicketSettings(): Promise<TicketSettingsView> {
  const { data } = await api.get<TicketSettingsView>("/tenants/me/ticket-settings");
  return data;
}

export async function updateTicketSettings(
  input: UpdateTicketSettingsInput,
): Promise<TicketSettingsView> {
  const { data } = await api.put<TicketSettingsView>("/tenants/me/ticket-settings", input);
  return data;
}

/** La imagen viaja en base64 dentro del JSON, como las importaciones. */
export async function uploadTicketLogo(contentBase64: string): Promise<TicketSettingsView> {
  const { data } = await api.put<TicketSettingsView>("/tenants/me/ticket-settings/logo", {
    content: contentBase64,
  });
  return data;
}

export async function removeTicketLogo(): Promise<TicketSettingsView> {
  const { data } = await api.delete<TicketSettingsView>("/tenants/me/ticket-settings/logo");
  return data;
}

/** Un archivo del `<input type="file">` a base64 puro (sin el prefijo data:). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
