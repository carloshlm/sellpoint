import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { isTaxId, normalizeTaxId } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type {
  CreateSupplierDto,
  ListSuppliersQuery,
  UpdateSupplierDto,
} from "./dto/upsert-supplier.dto";

/** Lo que sale al cliente: el espejo plano de la fila. */
export interface SupplierSummary {
  id: string;
  /** F9-SUPPCAT-03: la llave visible, única por negocio, en mayúsculas. */
  code: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type SupplierRow = {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * F9-SUPPL-03 — el catálogo de proveedores. Core: lo usan Compras y Gastos.
 *
 * Mismo molde que `customers.service.ts`: todo dentro de `withTenantContext`,
 * `tenantId` en el WHERE además de la RLS, y auditoría en la misma tx.
 *
 * El registro fiscal se normaliza y valida contra el PAÍS del negocio (molde:
 * `TenantProfileService#conRegistroFiscalValidado`): sin país, todo vale; un
 * RFC mal formado en México es 422. Duplicado NO bloquea (el formulario avisa).
 *
 * Borrar un proveedor con compras o gastos rebota por la FK (RESTRICT) y se
 * traduce a 409 `suppliers.in_use`: la salida es desactivarlo, no borrarlo.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: ListSuppliersQuery,
  ): Promise<{ rows: SupplierSummary[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const texto = query.query?.trim();
    const where: Prisma.SupplierWhereInput = {
      tenantId: user.tenantId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(texto
        ? {
            OR: [
              { code: { contains: texto, mode: "insensitive" as const } },
              { name: { contains: texto, mode: "insensitive" as const } },
              { taxId: { contains: texto, mode: "insensitive" as const } },
              { contactName: { contains: texto, mode: "insensitive" as const } },
              { phone: { contains: texto, mode: "insensitive" as const } },
              { email: { contains: texto, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.supplier.count({ where }),
        tx.supplier.findMany({
          where,
          // Se elige de un catálogo: alfabético. Desempate por id para que
          // dos nombres iguales no salgan en dos páginas o en ninguna.
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows: rows.map(toSummary), total, page, pageSize };
    });
  }

  async get(user: AuthUser, id: string): Promise<SupplierSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const fila = await tx.supplier.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!fila) {
        throw new NotFoundException({ message: "suppliers.not_found" });
      }
      return toSummary(fila);
    });
  }

  async create(
    user: AuthUser,
    input: CreateSupplierDto,
    meta: RequestMeta,
  ): Promise<SupplierSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const taxId = await this.registroFiscalValidado(tx, user.tenantId, input.taxId);
      // El código lo trae la persona o lo pone el sistema (`PROV-NNN`); si lo
      // trae, se comprueba ANTES del insert para que el 409 diga qué chocó.
      const code = input.code ?? (await this.nextCode(tx, user.tenantId));
      if (input.code !== undefined) {
        await this.assertCodeFree(tx, user.tenantId, code);
      }
      const creado = await tx.supplier.create({
        data: {
          tenantId: user.tenantId,
          code,
          name: input.name,
          taxId,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          createdBy: user.userId,
          updatedBy: user.userId,
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "supplier.created",
        resourceType: "supplier",
        resourceId: creado.id,
        after: { code: creado.code, name: creado.name, taxId: creado.taxId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado);
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateSupplierDto,
    meta: RequestMeta,
  ): Promise<SupplierSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.supplier.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!actual) {
        throw new NotFoundException({ message: "suppliers.not_found" });
      }
      if (input.code !== undefined && input.code !== actual.code) {
        await this.assertCodeFree(tx, user.tenantId, input.code);
      }
      const data: Prisma.SupplierUpdateInput = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.taxId !== undefined
          ? { taxId: await this.registroFiscalValidado(tx, user.tenantId, input.taxId) }
          : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updater: { connect: { id: user.userId } },
      };
      const actualizado = await tx.supplier.update({ where: { id }, data });
      const { updater: _updater, ...cambios } = data;
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "supplier.updated",
        resourceType: "supplier",
        resourceId: id,
        before: {
          code: actual.code,
          name: actual.name,
          taxId: actual.taxId,
          isActive: actual.isActive,
        },
        after: cambios as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(actualizado);
    });
  }

  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.supplier.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!actual) {
        throw new NotFoundException({ message: "suppliers.not_found" });
      }
      try {
        await tx.supplier.delete({ where: { id } });
      } catch (error) {
        // Una compra o un gasto lo referencian (FK RESTRICT): no se borra, se
        // desactiva. El P2003 crudo saldría como 500 sin decir nada.
        if (isForeignKeyViolation(error)) {
          throw new ConflictException({ message: "suppliers.in_use" });
        }
        throw error;
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "supplier.deleted",
        resourceType: "supplier",
        resourceId: id,
        before: { name: actual.name, taxId: actual.taxId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string,
  ): Promise<void> {
    const repetido = await tx.supplier.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (repetido !== null) {
      throw new ConflictException({ message: "suppliers.code_taken" });
    }
  }

  /**
   * El siguiente código de la serie `PROV-NNN` del negocio (F9-SUPPCAT-03,
   * molde `WarehousesService#nextCode`). Se mira el MAYOR número ya usado y
   * no la cantidad de proveedores: si alguien borró el PROV-002, contar daría
   * otra vez PROV-002 y chocaría con el índice único de un PROV-003 que sí
   * existe. Los códigos capturados a mano que no siguen el patrón no cuentan
   * para la serie — son de la persona, no del sistema.
   */
  private async nextCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const [fila] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(substring(code FROM '^PROV-(\\d+)$')::int) AS max
        FROM suppliers
       WHERE tenant_id = ${tenantId}::uuid
         AND code ~ '^PROV-\\d+$'`;
    const siguiente = (fila?.max ?? 0) + 1;
    return `PROV-${String(siguiente).padStart(3, "0")}`;
  }

  /**
   * El registro fiscal, normalizado a la forma canónica de su país y validado
   * contra su patrón. `null`/vacío limpia el campo; sin país del negocio,
   * solo se recorta y se pone en mayúsculas (no se toca lo que no se entiende).
   */
  private async registroFiscalValidado(
    tx: Prisma.TransactionClient,
    tenantId: string,
    raw: string | null | undefined,
  ): Promise<string | null> {
    if (raw === undefined || raw === null || raw.trim() === "") {
      return null;
    }
    const { country } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { country: true },
    });
    const taxId = normalizeTaxId(country, raw);
    if (!isTaxId(country, taxId)) {
      throw new UnprocessableEntityException({ message: "suppliers.invalid_tax_id" });
    }
    return taxId;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function toSummary(row: SupplierRow): SupplierSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    taxId: row.taxId,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
