import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateSettingsDto } from "./dto/settings.dto";

export interface MedicalClinicSettingsView {
  sellsMedications: boolean;
  sellsLabStudies: boolean;
  sellsDiagnosticStudies: boolean;
}

/**
 * Sin fila, el consultorio vende solo medicamentos (Carlos, 2026-09-03: la
 * mayoría no vende estudios). Es el MISMO default que la columna de la base,
 * para que «nunca configuré» y «configuré y no toqué nada» sean lo mismo.
 */
export const DEFAULT_SETTINGS: MedicalClinicSettingsView = {
  sellsMedications: true,
  sellsLabStudies: false,
  sellsDiagnosticStudies: false,
};

/**
 * F9-CLINIC-22 — qué vende el consultorio. Decide si una orden médica crea
 * cotización (F9-CLINIC-23). `get` no crea la fila; `update` hace upsert.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(user: AuthUser): Promise<MedicalClinicSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, (tx) => this.leer(tx, user.tenantId));
  }

  /** La lectura dentro de una transacción ajena (la orden la usa en la suya). */
  async leer(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
  ): Promise<MedicalClinicSettingsView> {
    const fila = await tx.medicalClinicSettings.findUnique({ where: { tenantId } });
    return fila === null ? { ...DEFAULT_SETTINGS } : toView(fila);
  }

  async update(
    user: AuthUser,
    input: UpdateSettingsDto,
    meta: RequestMeta,
  ): Promise<MedicalClinicSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await this.leer(tx, user.tenantId);
      const fila = await tx.medicalClinicSettings.upsert({
        where: { tenantId: user.tenantId },
        create: { tenantId: user.tenantId, ...input, updatedBy: user.userId },
        update: { ...input, updatedBy: user.userId },
      });
      const despues = toView(fila);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "medical_clinic.settings.update",
        resourceType: "medical_clinic_settings",
        resourceId: user.tenantId,
        before: { ...antes },
        after: { ...despues },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return despues;
    });
  }
}

function toView(fila: MedicalClinicSettingsView): MedicalClinicSettingsView {
  return {
    sellsMedications: fila.sellsMedications,
    sellsLabStudies: fila.sellsLabStudies,
    sellsDiagnosticStudies: fila.sellsDiagnosticStudies,
  };
}
