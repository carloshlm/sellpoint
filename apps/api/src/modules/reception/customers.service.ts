import { Injectable, NotFoundException } from "@nestjs/common";
import { ageFromBirthDate, localCalendarDate } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type {
  CreateCustomerDto,
  ListCustomersQuery,
  UpdateCustomerDto,
} from "./dto/upsert-customer.dto";

/** Lo que sale al cliente. La fecha va como `YYYY-MM-DD`; la edad, calculada. */
export interface CustomerSummary {
  id: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  birthDate: string | null;
  /** Años cumplidos HOY en el calendario del negocio; null sin fecha. */
  age: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type CustomerRow = {
  id: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  birthDate: Date | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * F9-RECEP-06 — el registro de clientes de Recepción.
 *
 * Mismo molde que `services.service.ts`: todo dentro de `withTenantContext`,
 * `tenantId` en el WHERE además de la RLS, y auditoría en la misma tx.
 *
 * La edad la calcula el API y no el navegador: con el DÍA DEL NEGOCIO
 * (`tenant.timezone`), para que el número sea el mismo en la pantalla, en un
 * export y en un reporte futuro — y no dependa del reloj de quien mira.
 *
 * «Eliminar» borra de verdad (Carlos, 2026-09-02): la palabra del botón hace
 * lo que promete. El historial de turnos no pierde a la persona porque cada
 * turno guarda el snapshot del nombre y su FK queda en NULL.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCustomersQuery,
  ): Promise<{ rows: CustomerSummary[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const texto = query.query?.trim();
    const where: Prisma.CustomerWhereInput = {
      tenantId: user.tenantId,
      ...(texto
        ? {
            OR: [
              { firstName: { contains: texto, mode: "insensitive" as const } },
              { lastNamePaternal: { contains: texto, mode: "insensitive" as const } },
              { lastNameMaternal: { contains: texto, mode: "insensitive" as const } },
              { phone: { contains: texto, mode: "insensitive" as const } },
              { email: { contains: texto, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const hoy = await this.diaDelNegocio(user.tenantId);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({
          where,
          // Del más reciente al más viejo (Carlos, 2026-09-02). Desempate por
          // id: dos altas en el mismo instante no pueden salir en dos páginas
          // o en ninguna.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows: rows.map((row) => toSummary(row, hoy)), total, page, pageSize };
    });
  }

  async create(
    user: AuthUser,
    input: CreateCustomerDto,
    meta: RequestMeta,
  ): Promise<CustomerSummary> {
    const hoy = await this.diaDelNegocio(user.tenantId);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const creado = await tx.customer.create({
        data: {
          tenantId: user.tenantId,
          firstName: input.firstName,
          lastNamePaternal: input.lastNamePaternal,
          lastNameMaternal: input.lastNameMaternal ?? null,
          // Un `YYYY-MM-DD` se parsea en UTC: justo lo que una columna DATE
          // necesita para guardar ese día y no el anterior.
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
          createdBy: user.userId,
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.customer.create",
        resourceType: "customer",
        resourceId: creado.id,
        after: { firstName: creado.firstName, lastNamePaternal: creado.lastNamePaternal },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado, hoy);
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateCustomerDto,
    meta: RequestMeta,
  ): Promise<CustomerSummary> {
    const hoy = await this.diaDelNegocio(user.tenantId);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.customer.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!actual) {
        throw new NotFoundException({ message: "reception.customer_not_found" });
      }
      const data: Prisma.CustomerUpdateInput = {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastNamePaternal !== undefined
          ? { lastNamePaternal: input.lastNamePaternal }
          : {}),
        ...(input.lastNameMaternal !== undefined
          ? { lastNameMaternal: input.lastNameMaternal }
          : {}),
        ...(input.birthDate !== undefined
          ? { birthDate: input.birthDate === null ? null : new Date(input.birthDate) }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const actualizado = await tx.customer.update({ where: { id }, data });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.customer.update",
        resourceType: "customer",
        resourceId: id,
        before: { firstName: actual.firstName, lastNamePaternal: actual.lastNamePaternal },
        after: data as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(actualizado, hoy);
    });
  }

  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.customer.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!actual) {
        throw new NotFoundException({ message: "reception.customer_not_found" });
      }
      await tx.customer.delete({ where: { id } });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.customer.delete",
        resourceType: "customer",
        resourceId: id,
        before: {
          firstName: actual.firstName,
          lastNamePaternal: actual.lastNamePaternal,
          lastNameMaternal: actual.lastNameMaternal,
          phone: actual.phone,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** El día de HOY en el calendario del negocio: la única base válida para una edad. */
  private async diaDelNegocio(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return localCalendarDate(tenant?.timezone ?? "UTC", new Date());
  }
}

function toSummary(row: CustomerRow, hoy: string): CustomerSummary {
  const birthDate = row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal,
    lastNameMaternal: row.lastNameMaternal,
    birthDate,
    age: birthDate ? ageFromBirthDate(birthDate, hoy) : null,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
