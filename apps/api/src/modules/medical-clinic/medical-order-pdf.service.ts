import { Injectable, NotFoundException } from "@nestjs/common";
import { ageFromBirthDate } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { buildMedicalOrderDefinition, type Translate } from "./medical-order-pdf.renderer";

/** Las fuentes estándar del visor, como en el PDF de inventario. */
const FONTS = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

/** F9-CLINIC-24 — arma y renderiza el documento carta de una orden. */
@Injectable()
export class MedicalOrderPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(private readonly prisma: PrismaService) {}

  async render(
    user: AuthUser,
    orderId: string,
    t: Translate,
  ): Promise<{ body: Buffer; filename: string }> {
    const input = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await tx.medicalClinicOrder.findFirst({
        where: { id: orderId, tenantId: user.tenantId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          record: { include: { doctor: { select: { firstName: true, lastNamePaternal: true } } } },
        },
      });
      if (orden === null) {
        throw new NotFoundException({ message: "medical_clinic.order_not_found" });
      }
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { name: true, legalName: true, address: true, phone: true, timezone: true },
      });
      const consulta = orden.record.consultationDate.toISOString().slice(0, 10);
      const nacimiento = orden.record.patientBirthDate?.toISOString().slice(0, 10) ?? null;
      return {
        tenant,
        record: {
          folio: orden.record.folio,
          consultationDate: consulta,
          patientName: orden.record.patientName,
          age: nacimiento === null ? null : ageFromBirthDate(nacimiento, consulta),
          sex: orden.record.patientSex,
          doctorName:
            `${orden.record.doctor.firstName} ${orden.record.doctor.lastNamePaternal}`.trim(),
        },
        order: {
          kind: orden.kind as "prescription" | "lab_order" | "diagnostic_order",
          folio: orden.folio,
          createdAt: orden.createdAt,
          diagnosis: orden.diagnosis,
          indications: orden.indications,
          lines: orden.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity.toString(),
            dosage: l.dosage,
          })),
        },
        locale: user.locale,
      };
    });

    const definition = buildMedicalOrderDefinition(input, t) as unknown as TDocumentDefinitions;
    const pdf = this.printer.createPdfKitDocument(definition);
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    });
    return { body, filename: `${input.order.folio}.pdf` };
  }
}
