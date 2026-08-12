import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

/**
 * f1-auth AD-10: `audit_logs` tiene RLS con tenant_id NOT NULL — SIEMPRE se
 * llama DENTRO de `withTenantContext` (o de la tx de `provision()` que abre
 * su propio contexto), nunca con el cliente base. `record()` recibe el
 * `tx` en vez de tener su propia conexión a propósito: así no puede
 * escaparse de la transacción de dominio que lo dispara.
 *
 * Eventos SIN tenant (ej. login fallido con email inexistente) NO pasan por
 * acá — van solo al log estructurado de pino (AD-10, fuera de U2/login).
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        before: entry.before,
        after: entry.after,
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  }
}
