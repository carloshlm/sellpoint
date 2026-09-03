import { medicalOrderKindSchema } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-CLINIC-14 — el cuerpo de una orden médica. Cada línea es de UN tipo y el
 * tipo tiene que coincidir con el de la orden (la base lo vuelve imposible de
 * otro modo; acá se rebota antes de intentarlo).
 */
const cantidad = z.coerce.number().positive();
const texto = (max: number) => z.string().trim().max(max);

const lineaReceta = z
  .object({
    productId: z.string().uuid(),
    presentationId: z.string().uuid().optional(),
    quantity: cantidad,
    dosage: texto(500).optional(),
  })
  .strict();
const lineaLaboratorio = z
  .object({ labStudyId: z.string().uuid(), quantity: cantidad.default(1) })
  .strict();
const lineaDiagnostico = z
  .object({ diagnosticStudyId: z.string().uuid(), quantity: cantidad.default(1) })
  .strict();

export const createOrderSchema = z
  .object({
    kind: medicalOrderKindSchema,
    indications: texto(2000).optional(),
    diagnosis: texto(500).optional(),
    lines: z
      .array(z.union([lineaReceta, lineaLaboratorio, lineaDiagnostico]))
      .min(1, { message: "medical_clinic.order_needs_lines" }),
  })
  .strict()
  .refine(
    (o) =>
      o.lines.every((l) =>
        o.kind === "prescription"
          ? "productId" in l
          : o.kind === "lab_order"
            ? "labStudyId" in l
            : "diagnosticStudyId" in l,
      ),
    { message: "medical_clinic.invalid_body" },
  );

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type PrescriptionLineDto = z.infer<typeof lineaReceta>;
