import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { CreateStudyDto, ListStudiesQuery, UpdateStudyDto } from "./dto/upsert-study.dto";

/** Lo que sale al cliente. El dinero viaja como texto decimal, como en todo el API. */
export interface StudySummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  cost: string | null;
  price: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type StudyWhere = {
  tenantId: string;
  isActive?: boolean;
  OR?: {
    code?: { contains: string; mode: "insensitive" };
    name?: { contains: string; mode: "insensitive" };
  }[];
};

/**
 * La forma MÍNIMA de los dos delegates de Prisma que la base usa. Los
 * delegates reales tienen firmas genéricas que no caben en una unión; el
 * service concreto los presenta con esta forma.
 */
export interface StudyDelegate {
  count(args: { where: StudyWhere }): Promise<number>;
  findMany(args: {
    where: StudyWhere;
    orderBy: { name: "asc" }[] | ({ name: "asc" } | { id: "asc" })[];
    skip: number;
    take: number;
  }): Promise<StudyRow[]>;
  findFirst(args: { where: { id: string; tenantId: string } }): Promise<StudyRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<StudyRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StudyRow>;
  delete(args: { where: { id: string } }): Promise<StudyRow>;
}

export interface StudyCatalogConfig {
  /** `lab_study` | `diagnostic_study`: prefijo de auditoría y `resourceType`. */
  resource: string;
  notFoundKey: string;
  delegate(tx: Prisma.TransactionClient): StudyDelegate;
}

/**
 * F9-CLINIC-07/08 — la base de los dos catálogos de estudios.
 *
 * Una clase parametrizada por delegate y no un `if kind`: los dos catálogos
 * son idénticos hoy y divergen por naturaleza mañana; el día que laboratorio
 * gane «tipo de muestra», la subclase lo agrega sin tocar a gabinete.
 *
 * Mismo molde que `services.service.ts`: todo dentro de `withTenantContext`,
 * `tenantId` en el WHERE además de la RLS, y auditoría en la misma tx. Sin
 * `service_warehouses`: el catálogo es del negocio, no de un almacén.
 */
export abstract class StudyCatalogService {
  protected abstract readonly config: StudyCatalogConfig;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly auditService: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: ListStudiesQuery,
  ): Promise<{ rows: StudySummary[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const texto = query.query?.trim();
    const where: StudyWhere = {
      tenantId: user.tenantId,
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(texto
        ? {
            OR: [
              { code: { contains: texto, mode: "insensitive" as const } },
              { name: { contains: texto, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const modelo = this.config.delegate(tx);
      const [total, rows] = await Promise.all([
        modelo.count({ where }),
        modelo.findMany({
          where,
          // Por nombre, como se busca en un catálogo; desempate por id.
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows: rows.map(toSummary), total, page, pageSize };
    });
  }

  async get(user: AuthUser, id: string): Promise<StudySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const fila = await this.config
        .delegate(tx)
        .findFirst({ where: { id, tenantId: user.tenantId } });
      if (fila === null) {
        throw new NotFoundException({ message: this.config.notFoundKey });
      }
      return toSummary(fila);
    });
  }

  async create(user: AuthUser, input: CreateStudyDto, meta: RequestMeta): Promise<StudySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let creado: StudyRow;
      try {
        creado = await this.config.delegate(tx).create({
          data: {
            tenantId: user.tenantId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            cost: input.cost === undefined ? null : new Prisma.Decimal(input.cost),
            price: input.price === undefined ? null : new Prisma.Decimal(input.price),
            createdBy: user.userId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "medical_clinic.code_taken" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: `medical_clinic.${this.config.resource}.create`,
        resourceType: this.config.resource,
        resourceId: creado.id,
        after: { ...toSummary(creado) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado);
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateStudyDto,
    meta: RequestMeta,
  ): Promise<StudySummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const modelo = this.config.delegate(tx);
      const antes = await modelo.findFirst({ where: { id, tenantId: user.tenantId } });
      if (antes === null) {
        throw new NotFoundException({ message: this.config.notFoundKey });
      }
      // Solo lo que viene; `null` limpia; ausente no se toca.
      const data: Record<string, unknown> = {};
      if (input.code !== undefined) data.code = input.code;
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.cost !== undefined)
        data.cost = input.cost === null ? null : new Prisma.Decimal(input.cost);
      if (input.price !== undefined)
        data.price = input.price === null ? null : new Prisma.Decimal(input.price);
      if (input.isActive !== undefined) data.isActive = input.isActive;

      let despues: StudyRow;
      try {
        despues = await modelo.update({ where: { id }, data });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "medical_clinic.code_taken" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: `medical_clinic.${this.config.resource}.update`,
        resourceType: this.config.resource,
        resourceId: id,
        before: { ...toSummary(antes) },
        after: { ...toSummary(despues) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(despues);
    });
  }

  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const modelo = this.config.delegate(tx);
      const antes = await modelo.findFirst({ where: { id, tenantId: user.tenantId } });
      if (antes === null) {
        throw new NotFoundException({ message: this.config.notFoundKey });
      }
      try {
        await modelo.delete({ where: { id } });
      } catch (error) {
        // RESTRICT desde las líneas de orden: un estudio que ya se recetó no
        // se borra, se desactiva (el papel lo sigue nombrando).
        if (isForeignKeyViolation(error)) {
          throw new ConflictException({ message: "medical_clinic.study_in_use" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: `medical_clinic.${this.config.resource}.delete`,
        resourceType: this.config.resource,
        resourceId: id,
        before: { ...toSummary(antes) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }
}

export function toSummary(row: StudyRow): StudySummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    cost: row.cost === null ? null : row.cost.toString(),
    price: row.price === null ? null : row.price.toString(),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function codigoDe(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    (error instanceof Error && error.name === "PrismaClientKnownRequestError")
    ? (error as { code?: string }).code
    : undefined;
}
export const isUniqueViolation = (error: unknown): boolean => codigoDe(error) === "P2002";
export const isForeignKeyViolation = (error: unknown): boolean => codigoDe(error) === "P2003";
