import { footerMessageSchema, ticketLogoPresetSchema } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F4-TICKETCFG-04 — lo que se cambia con un PUT: los toggles, el pie y el
 * logotipo cuando es «ninguno» o un preset. Una imagen propia NO entra por
 * aquí: va por `PUT logo` con sus bytes, y `custom` solo lo pone el API.
 */
export const updateTicketSettingsSchema = z
  .object({
    showBusinessName: z.boolean().optional(),
    showTaxId: z.boolean().optional(),
    showAddress: z.boolean().optional(),
    showPhone: z.boolean().optional(),
    showWarehouse: z.boolean().optional(),
    /** `null` vuelve al mensaje de fábrica del idioma. */
    footerMessage: footerMessageSchema.nullable().optional(),
    logo: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("none") }),
        z.object({ kind: z.literal("preset"), preset: ticketLogoPresetSchema }),
      ])
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "tenants.empty_update" });

export type UpdateTicketSettingsDto = z.infer<typeof updateTicketSettingsSchema>;

/** La imagen propia, en base64 dentro del JSON (patrón de las importaciones). */
export const uploadTicketLogoSchema = z.object({ content: z.string().min(1) }).strict();

export type UploadTicketLogoDto = z.infer<typeof uploadTicketLogoSchema>;
