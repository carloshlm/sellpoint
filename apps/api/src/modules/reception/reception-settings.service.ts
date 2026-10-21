import { BadRequestException, Injectable } from "@nestjs/common";
import {
  DEFAULT_RECEPTION_SETTINGS,
  normalizeCustomerLabel,
  type ReceptionSettings,
  type TurnService,
} from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateReceptionSettingsDto } from "./dto/settings.dto";

/**
 * F9-RECEP-17 — cómo llama el negocio a su «cliente» y qué entradas del menú
 * de Recepción muestra. F9-RECEP-25 — y qué servicios generan un turno al
 * venderse en la caja (`reception_turn_services`, ley 31).
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
    const turnServices = await this.serviciosQueGeneranTurno(tx, tenantId);
    return fila === null
      ? { ...DEFAULT_RECEPTION_SETTINGS, turnServices }
      : toView(fila, turnServices);
  }

  /**
   * F9-RECEP-32 — con nombre, código y precio: la tarjeta pinta la lista sin
   * pedir el catálogo, que puede tener miles. Solo los ACTIVOS: uno inactivo
   * no se puede vender, y al guardar la lista se cae. Por nombre, que es como
   * se buscan; el id desempata (`createMany` les da a todos el mismo
   * `created_at`).
   */
  private async serviciosQueGeneranTurno(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
  ): Promise<TurnService[]> {
    const filas = await tx.receptionTurnService.findMany({
      where: { tenantId, service: { isActive: true } },
      select: { service: { select: { id: true, code: true, name: true, price: true } } },
      orderBy: [{ service: { name: "asc" } }, { serviceId: "asc" }],
    });
    return filas.map(({ service }) => ({
      id: service.id,
      code: service.code,
      name: service.name,
      price: service.price?.toString() ?? null,
    }));
  }

  async update(
    user: AuthUser,
    input: UpdateReceptionSettingsDto,
    meta: RequestMeta,
  ): Promise<ReceptionSettings> {
    // `null` es «vuelve a la de fábrica» y se guarda como NULL; solo una
    // palabra presente se normaliza. Los servicios no son una columna de la
    // fila: viven en su propia tabla y se reemplazan aparte.
    const { turnServiceIds, ...deLaFila } = input;
    const cambios = {
      ...deLaFila,
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
      if (turnServiceIds !== undefined) {
        await this.reemplazarServicios(tx, user.tenantId, turnServiceIds);
      }
      const despues = toView(fila, await this.serviciosQueGeneranTurno(tx, user.tenantId));
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.settings.update",
        resourceType: "reception_settings",
        resourceId: user.tenantId,
        before: paraAuditoria(antes),
        after: paraAuditoria(despues),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return despues;
    });
  }

  /**
   * F9-RECEP-25 — deja EXACTAMENTE estos servicios marcados. Cada uno tiene
   * que ser un servicio ACTIVO de este negocio: la consulta corre con la RLS
   * del tenant, así que un id de otro negocio simplemente no aparece — y un
   * FK no la mira, por eso se valida aquí y no se deja a la base.
   */
  private async reemplazarServicios(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length > 0) {
      const validos = await tx.service.count({
        where: { tenantId, id: { in: ids }, isActive: true },
      });
      if (validos !== ids.length) {
        throw new BadRequestException({ message: "reception.turn_service_invalid" });
      }
    }
    await tx.receptionTurnService.deleteMany({
      where: { tenantId, serviceId: { notIn: ids } },
    });
    await tx.receptionTurnService.createMany({
      data: ids.map((serviceId) => ({ tenantId, serviceId })),
      skipDuplicates: true,
    });
  }
}

/**
 * La auditoría guarda JSON: los servicios van como objetos planos (una
 * `interface` no tiene firma de índice y el tipo JSON de Prisma no la acepta).
 */
function paraAuditoria(settings: ReceptionSettings) {
  return { ...settings, turnServices: settings.turnServices.map((s) => ({ ...s })) };
}

function toView(
  fila: Omit<ReceptionSettings, "turnServices">,
  turnServices: TurnService[],
): ReceptionSettings {
  return {
    customerLabel: fila.customerLabel,
    showCustomers: fila.showCustomers,
    showTurns: fila.showTurns,
    turnServices,
  };
}
