import { Injectable, NotFoundException } from "@nestjs/common";
import { ageFromBirthDate, shortName } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { TicketSettingsService } from "../tenants/ticket-settings.service";
import { buildMedicalOrderDefinition } from "./medical-order-pdf.renderer";
import { direccionEnLinea, FONTS, renderizar, type Translate } from "./medical-pdf-blocks";

/** F9-CLINIC-24 — arma y renderiza el documento carta de una orden. */
@Injectable()
export class MedicalOrderPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketSettings: TicketSettingsService,
  ) {}

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
          record: { include: { doctor: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (orden === null) {
        throw new NotFoundException({ message: "medical_clinic.order_not_found" });
      }
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: {
          name: true,
          legalName: true,
          address: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          country: true,
          phone: true,
          timezone: true,
        },
      });
      const consulta = orden.record.consultationDate.toISOString().slice(0, 10);
      const nacimiento = orden.record.patientBirthDate?.toISOString().slice(0, 10) ?? null;
      const { settings } = await this.ticketSettings.leer(tx, user.tenantId);
      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          // F1-ADDR-07: la dirección en una línea, en el orden de su país; con
          // solo la línea 1 es idéntica a la de siempre.
          address: direccionEnLinea(tenant),
          phone: tenant.phone,
          timezone: tenant.timezone,
          showBusinessName: settings.showBusinessName,
          showAddress: settings.showAddress,
          showPhone: settings.showPhone,
        },
        record: {
          folio: orden.record.folio,
          consultationDate: consulta,
          patientName: orden.record.patientName,
          age: nacimiento === null ? null : ageFromBirthDate(nacimiento, consulta),
          sex: orden.record.patientSex,
          doctorName: shortName(orden.record.doctor),
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

    const body = await renderizar(this.printer, buildMedicalOrderDefinition(input, t));
    return { body, filename: `${input.order.folio}.pdf` };
  }
}
