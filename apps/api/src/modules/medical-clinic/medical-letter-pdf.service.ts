import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ageFromBirthDate,
  LETTER_SECTION_KEYS,
  medicalRecordSectionKeySchema,
  shortName,
} from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { TicketSettingsService } from "../tenants/ticket-settings.service";
import {
  buildMedicalLetterDefinition,
  type MedicalLetterKind,
} from "./medical-letter-pdf.renderer";
import { direccionEnLinea, FONTS, renderizar, type Translate } from "./medical-pdf-blocks";

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * F9-CLINIC-DOC-05 — arma y renderiza la carta de un ítem de Referencias o
 * Interconsultas, por índice (la lista es pequeña y se imprime justo después
 * de guardarse). Es LECTURA: no mira el candado del expediente, porque el
 * caso más común es el paciente que vuelve al día siguiente por su hoja de
 * referencia cuando la consulta ya venció.
 */
@Injectable()
export class MedicalLetterPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketSettings: TicketSettingsService,
  ) {}

  async render(
    user: AuthUser,
    recordId: string,
    key: string,
    index: number,
    t: Translate,
  ): Promise<{ body: Buffer; filename: string }> {
    const clave = medicalRecordSectionKeySchema.safeParse(key);
    if (!clave.success) {
      throw new BadRequestException({ message: "medical_clinic.section_unknown" });
    }
    if (!(LETTER_SECTION_KEYS as readonly string[]).includes(clave.data)) {
      throw new UnprocessableEntityException({ message: "medical_clinic.document_not_available" });
    }
    const kind: MedicalLetterKind = clave.data === "referrals" ? "referral" : "interconsultation";

    const input = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const record = await tx.medicalClinicRecord.findFirst({
        where: { id: recordId, tenantId: user.tenantId },
        include: {
          doctor: { select: { firstName: true, lastName: true } },
          sections: { where: { sectionKey: clave.data }, select: { data: true } },
        },
      });
      if (record === null) {
        throw new NotFoundException({ message: "medical_clinic.record_not_found" });
      }
      const data = record.sections[0]?.data;
      const items =
        data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)
          ? ((data as Record<string, unknown>).items as Record<string, unknown>[])
          : [];
      const item = items[index];
      if (item === undefined) {
        throw new NotFoundException({ message: "medical_clinic.document_not_found" });
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
      const consulta = record.consultationDate.toISOString().slice(0, 10);
      const nacimiento = record.patientBirthDate?.toISOString().slice(0, 10) ?? null;
      const { settings } = await this.ticketSettings.leer(tx, user.tenantId);
      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          address: direccionEnLinea(tenant),
          phone: tenant.phone,
          timezone: tenant.timezone,
          showBusinessName: settings.showBusinessName,
          showAddress: settings.showAddress,
          showPhone: settings.showPhone,
        },
        record: {
          folio: record.folio,
          consultationDate: consulta,
          patientName: record.patientName,
          age: nacimiento === null ? null : ageFromBirthDate(nacimiento, consulta),
          sex: record.patientSex,
          doctorName: shortName(record.doctor),
        },
        letter: {
          kind,
          number: index + 1,
          priority: item.priority === "urgent" ? ("urgent" as const) : ("routine" as const),
          facility: texto(item.facility),
          service: texto(item.service) ?? "",
          doctorName: texto(item.doctorName),
          reason: texto(item.reason) ?? "",
          clinicalSummary: texto(item.clinicalSummary),
          diagnosis: texto(item.diagnosis),
          icd10Code: texto(item.icd10Code),
          treatment: texto(item.treatment),
        },
        locale: user.locale,
      };
    });

    const body = await renderizar(this.printer, buildMedicalLetterDefinition(input, t));
    const serie = kind === "referral" ? "REF" : "INT";
    return { body, filename: `${input.record.folio}-${serie}-${index + 1}.pdf` };
  }
}
