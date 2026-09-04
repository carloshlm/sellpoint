import { Injectable } from "@nestjs/common";
import {
  DEFAULT_RECEPTION_SETTINGS,
  normalizeCustomerLabel,
  type ReceptionSettings,
} from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateReceptionSettingsDto } from "./dto/settings.dto";

/**
 * F9-RECEP-17 — cómo llama el negocio a su «cliente» y qué entradas del menú
 * de Recepción muestra.
 *
 * `get` no crea la fila: sin ella valen los defaults de `shared`, que son
 * los mismos que las columnas. `update` hace upsert y NORMALIZA la palabra
 * con la función compartida (una, Capitalizada) — el web la previsualiza con
 * esa misma función, así que lo que el admin ve al escribir es lo que queda.
 */
@Injectable()
export class ReceptionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(user: AuthUser): Promise<ReceptionSettings> {
    return this.prisma.withTenantContext(user.tenantId, (tx) => this.leer(tx, user.tenantId));
  }

  async leer(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
  ): Promise<ReceptionSettings> {
    const fila = await tx.receptionSettings.findUnique({ where: { tenantId } });
    return fila === null ? { ...DEFAULT_RECEPTION_SETTINGS } : toView(fila);
  }

  async update(
    user: AuthUser,
    input: UpdateReceptionSettingsDto,
    meta: RequestMeta,
  ): Promise<ReceptionSettings> {
    // `null` es «vuelve a la de fábrica» y se guarda como NULL; solo una
    // palabra presente se normaliza.
    const cambios = {
      ...input,
      ...(typeof input.customerLabel === "string" && {
        customerLabel: normalizeCustomerLabel(input.customerLabel, user.locale),
      }),
    };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await this.leer(tx, user.tenantId);
      const fila = await tx.receptionSettings.upsert({
        where: { tenantId: user.tenantId },
        create: { tenantId: user.tenantId, ...cambios, updatedBy: user.userId },
        update: { ...cambios, updatedBy: user.userId },
      });
      const despues = toView(fila);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.settings.update",
        resourceType: "reception_settings",
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

function toView(fila: ReceptionSettings): ReceptionSettings {
  return {
    customerLabel: fila.customerLabel,
    showCustomers: fila.showCustomers,
    showTurns: fila.showTurns,
  };
}
