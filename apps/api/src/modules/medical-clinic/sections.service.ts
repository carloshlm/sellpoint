import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  MEDICAL_RECORD_SECTION_SCHEMAS,
  medicalRecordLock,
  medicalRecordSectionKeySchema,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { diaDelNegocio } from "./business-day";
import type { SectionStatus } from "./records.service";

export interface SectionView {
  key: string;
  status: SectionStatus;
  data: Record<string, unknown>;
  updatedAt: string | null;
}

/**
 * F9-CLINIC-11 — guardar una sección de la historia clínica.
 *
 * La forma del JSON la fija el schema zod de shared por clave. Clave fuera
 * del catálogo → 400; clave del catálogo sin formulario todavía → 422 (no se
 * acepta `{}`: dejaría «Completado» una tarjeta que nadie capturó); expediente
 * cerrado → 409. Guardar sin datos BORRA la fila: el estado se deriva de que
 * exista, así que una fila vacía sería una mentira en pantalla.
 *
 * Datos Generales proyecta el sexo al encabezado en la MISMA transacción.
 */
@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(user: AuthUser, recordId: string, key: string): Promise<SectionView> {
    const clave = claveDelCatalogo(key);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.expediente(tx, user.tenantId, recordId);
      const fila = await tx.medicalClinicRecordSection.findFirst({
        where: { recordId, sectionKey: clave, tenantId: user.tenantId },
      });
      return fila === null
        ? { key: clave, status: "pending", data: {}, updatedAt: null }
        : {
            key: clave,
            status: "completed",
            data: (fila.data ?? {}) as Record<string, unknown>,
            updatedAt: fila.updatedAt.toISOString(),
          };
    });
  }

  async save(
    user: AuthUser,
    recordId: string,
    key: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<SectionView> {
    const clave = claveDelCatalogo(key);
    const schema = MEDICAL_RECORD_SECTION_SCHEMAS[clave];
    if (schema === undefined) {
      throw new UnprocessableEntityException({ message: "medical_clinic.section_not_available" });
    }
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: "medical_clinic.invalid_body",
        errors: parsed.error.issues.map((i) => ({ key: i.path.join("."), message: i.message })),
      });
    }
    // Sin claves vacías: lo que no se capturó no se guarda.
    const data = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== ""),
    ) as Record<string, unknown>;

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const expediente = await this.expediente(tx, user.tenantId, recordId);
      // Cerrada o de otro día: se lee, no se captura (F9-CLINIC-26).
      const candado = medicalRecordLock(
        { status: expediente.status, consultationDate: diaDe(expediente.consultationDate) },
        await diaDelNegocio(tx, user.tenantId),
      );
      if (candado !== null) {
        throw new ConflictException({ message: `medical_clinic.record_${candado}` });
      }

      let vista: SectionView;
      if (Object.keys(data).length === 0) {
        await tx.medicalClinicRecordSection.deleteMany({
          where: { recordId, sectionKey: clave },
        });
        vista = { key: clave, status: "pending", data: {}, updatedAt: null };
      } else {
        const fila = await tx.medicalClinicRecordSection.upsert({
          where: { recordId_sectionKey: { recordId, sectionKey: clave } },
          create: {
            tenantId: user.tenantId,
            recordId,
            sectionKey: clave,
            data: data as Prisma.InputJsonObject,
            updatedBy: user.userId,
          },
          update: { data: data as Prisma.InputJsonObject, updatedBy: user.userId },
        });
        vista = {
          key: clave,
          status: "completed",
          data,
          updatedAt: fila.updatedAt.toISOString(),
        };
      }

      // El encabezado lee columnas, no JSON: Datos Generales proyecta el sexo.
      if (clave === "general_data") {
        await tx.medicalClinicRecord.update({
          where: { id: recordId },
          data: { patientSex: typeof data.sex === "string" ? data.sex : null },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "medical_clinic.section.save",
        resourceType: "medical_record_section",
        resourceId: recordId,
        after: { sectionKey: clave, status: vista.status },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return vista;
    });
  }

  private async expediente(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
    id: string,
  ): Promise<{ id: string; status: string; consultationDate: Date }> {
    const fila = await tx.medicalClinicRecord.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, consultationDate: true },
    });
    if (fila === null) {
      throw new NotFoundException({ message: "medical_clinic.record_not_found" });
    }
    return fila;
  }
}

function claveDelCatalogo(key: string) {
  const r = medicalRecordSectionKeySchema.safeParse(key);
  if (!r.success) {
    throw new BadRequestException({ message: "medical_clinic.section_unknown" });
  }
  return r.data;
}

/** La columna DATE, como el `YYYY-MM-DD` que compara el candado. */
const diaDe = (d: Date): string => d.toISOString().slice(0, 10);
