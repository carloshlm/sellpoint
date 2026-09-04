import { z } from "zod";

/**
 * F4-TICKETCFG-01 — la configuración del ticket, compartida entre el API y el
 * web.
 *
 * El negocio decide qué de él se IMPRIME (toggles) y con qué logotipo: uno de
 * seis iconos de fábrica o una imagen propia. Los toggles no editan nada —
 * `tenants` y `warehouses` siguen siendo la única verdad de esos datos.
 *
 * Los seis iconos son trazos de lucide (licencia ISC), monocromos en negro
 * (`stroke="#000000"`, `fill="none"`): en el papel térmico no hay otro color.
 * pdfmake los pinta con su nodo `svg` —el mismo con el que dibuja el código
 * de barras— y el web los previsualiza con el MISMO string.
 */
export const TICKET_LOGO_PRESETS = [
  "food",
  "cafe",
  "pharmacy",
  "store",
  "clinic",
  "workshop",
] as const;
export type TicketLogoPreset = (typeof TICKET_LOGO_PRESETS)[number];

export const TICKET_LOGO_SVG: Record<TicketLogoPreset, string> = {
  food: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  cafe: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/></svg>',
  pharmacy:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
  store:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/></svg>',
  clinic:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></svg>',
  workshop:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>',
};

export type TicketLogo =
  | { kind: "none" }
  | { kind: "preset"; preset: TicketLogoPreset }
  | { kind: "custom" };

export interface TicketSettings {
  showBusinessName: boolean;
  showTaxId: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showWarehouse: boolean;
  /** El pie del ticket; `null` = el de fábrica del idioma («¡Gracias por tu compra!»). */
  footerMessage: string | null;
  logo: TicketLogo;
}

/** Sin fila: todo visible, mensaje de fábrica, sin logotipo. */
export const DEFAULT_TICKET_SETTINGS: TicketSettings = {
  showBusinessName: true,
  showTaxId: true,
  showAddress: true,
  showPhone: true,
  showWarehouse: true,
  footerMessage: null,
  logo: { kind: "none" },
};

/** Lo que se acepta subir: hasta 2 MB. Lo que se guarda: lo que sale del procesador. */
export const TICKET_LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024;
/** 58 mm a 203 dpi son 384 puntos; el papel de 80 mm lo escala pdfmake. */
export const TICKET_LOGO_MAX_WIDTH = 384;
/** Un logotipo más alto que esto le roba el papel al número del turno. */
export const TICKET_LOGO_MAX_HEIGHT = 160;
/** Lo que cabe en la fila: un PNG gris de paleta corta pesa mucho menos. */
export const TICKET_LOGO_MAX_STORED_BYTES = 64 * 1024;
export const TICKET_FOOTER_MAX = 160;

export const ticketLogoPresetSchema = z.enum(TICKET_LOGO_PRESETS);

/** Una línea: sin saltos, porque el pie del ticket es una sola. */
export const footerMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(TICKET_FOOTER_MAX)
  .refine((s) => !/[\r\n]/.test(s));

export const ticketLogoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("preset"), preset: ticketLogoPresetSchema }),
  z.object({ kind: z.literal("custom") }),
]);
