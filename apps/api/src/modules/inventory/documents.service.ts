import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { FOLIO_PREFIXES, type InventoryDocumentType } from "@sellpoint/shared";
import { type InventoryDocument, Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ListDocumentsQueryDto, UpdateDocumentDto } from "./dto/document.dto";
import { nextFolio } from "./folio";
import { resolveLines } from "./line-resolver";
import { assertActiveWarehouse, assertWarehouseInScope } from "./warehouse-scope.helpers";

export interface CreateDraftInput {
  type: InventoryDocumentType;
  warehouseId: string;
}

/**
 * F3-DOC-03 — el ciclo de vida del documento: `draft → confirmed | canceled`.
 *
 * Quién lo CONFIRMA no vive acá: cada tipo valida distinto (una entrada por
 * factura exige costo unitario, una salida exige stock, un conteo exige
 * `inventory:manage`), así que el `confirm` es de F3-ENTRY-01, F3-EXIT-01 y
 * F3-COUNT-03. Lo que sí es común —y por eso está acá— es el sellado en sí:
 * `markConfirmed`.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea el encabezado vacío con su folio y lo devuelve para que la pantalla
   * navegue a él.
   *
   * ── Por qué una transacción CORTA y propia ───────────────────────────────
   *
   * `nextFolio` toma el lock de la fila `(tenant, serie)` y no lo suelta hasta
   * el COMMIT. Si el folio se pidiera dentro de la transacción del ledger, ese
   * lock quedaría tomado durante TODO el posteo —resolver líneas, bloquear
   * saldos, insertar movimientos— y cualquier otra persona creando un
   * documento de la misma serie esperaría todo eso. Acá la transacción hace
   * dos INSERT y termina: el lock dura milisegundos.
   *
   * Es también lo que permite retomar un movimiento por su folio: el número
   * existe desde el primer momento, no desde que se confirma.
   */
  async createDraft(
    user: AuthUser,
    input: CreateDraftInput,
    scope?: UserScope,
  ): Promise<InventoryDocument> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      if (scope !== undefined) {
        assertWarehouseInScope(scope, input.warehouseId);
      }
      // Un borrador contra un almacén desactivado no se podría confirmar
      // nunca: mejor frenarlo antes de que alguien cargue 80 líneas.
      await assertActiveWarehouse(tx, user.tenantId, input.warehouseId);

      const folio = await nextFolio(tx, user.tenantId, input.type, FOLIO_PREFIXES[input.type]);

      return tx.inventoryDocument.create({
        data: {
          tenantId: user.tenantId,
          folio,
          type: input.type,
          warehouseId: input.warehouseId,
          createdBy: user.userId,
        },
      });
    });
  }

  /**
   * Sella el documento. Lo llama cada `confirm` DENTRO de su transacción, con
   * los movimientos ya insertados.
   *
   * ── El lock lógico ───────────────────────────────────────────────────────
   *
   * `UPDATE … WHERE id = ? AND status = 'draft'` y exigir que haya afectado
   * una fila. La alternativa —leer el estado y después actualizar— deja una
   * ventana entre las dos consultas: dos personas confirmando el mismo
   * borrador desde dos pantallas leerían `draft` las dos y el saldo se sumaría
   * dos veces. Acá la condición viaja DENTRO del UPDATE, así que Postgres la
   * evalúa sobre la fila ya bloqueada.
   *
   * El trigger de F3-DOC-02 es la red de atrás: si esto fallara, un UPDATE
   * sobre un documento ya confirmado revienta con 42501.
   */
  async markConfirmed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
    userId: string,
  ): Promise<InventoryDocument> {
    const [confirmed] = await tx.$queryRaw<InventoryDocument[]>`
      UPDATE inventory_documents
      SET status = 'confirmed', confirmed_by = ${userId}::uuid, confirmed_at = now(), updated_at = now()
      WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'draft'
      RETURNING id, folio, type, status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt"`;

    if (confirmed === undefined) {
      // O no existe, o alguien lo cerró primero. Las dos son 409 para el
      // usuario: "esto ya no es un borrador", y la pantalla se refresca.
      throw new ConflictException({ message: "inventory.document_not_draft" });
    }

    return confirmed;
  }

  /**
   * Anula un borrador. **El folio se queda con él**: la serie no pierde
   * números y quien audita puede explicar cada uno. Anular un confirmado no
   * existe — eso se corrige registrando otro movimiento.
   */
  async cancel(user: AuthUser, documentId: string, reason?: string): Promise<InventoryDocument> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      // Verifica pertenencia Y estado. El update de abajo va sin `tenantId`
      // porque esta línea ya probó que el documento es de este tenant, dentro
      // de la misma transacción.
      await this.assertDraft(tx, user.tenantId, documentId);

      return tx.inventoryDocument.update({
        where: { id: documentId },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          canceledAt: new Date(),
          cancelReason: reason ?? null,
        },
      });
    });
  }

  /**
   * Edita la cabecera del borrador: motivo, referencia, nota, autorizador.
   *
   * Es autoguardado, igual que las líneas — cada cambio en el formulario cae
   * acá. Por eso NO valida las reglas del motivo: elegir «Factura» y todavía no
   * haber escrito el número es un estado normal mientras se carga. Lo que
   * valida duro es el confirm.
   */
  async updateHeader(
    user: AuthUser,
    documentId: string,
    dto: UpdateDocumentDto,
  ): Promise<InventoryDocument> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const document = await this.assertDraft(tx, user.tenantId, documentId);

      // El destino se valida ACÁ aunque el resto de la cabecera no: un almacén
      // igual al origen o inexistente no es un estado "a medio llenar", es
      // imposible — y la base lo rechaza con un CHECK o una FK, que sin este
      // guard llegan al usuario como un 500 sin explicación.
      if (dto.linkedWarehouseId !== undefined && dto.linkedWarehouseId !== null) {
        if (dto.linkedWarehouseId === document.warehouseId) {
          throw new UnprocessableEntityException({
            message: "inventory.transfer_same_warehouse",
            args: { field: "linkedWarehouseId" },
          });
        }
        await assertActiveWarehouse(tx, user.tenantId, dto.linkedWarehouseId);
      }

      return tx.inventoryDocument.update({
        where: { id: documentId },
        data: {
          ...(dto.reasonCode !== undefined && { reasonCode: dto.reasonCode }),
          ...(dto.reference !== undefined && { reference: dto.reference ?? null }),
          ...(dto.reasonNote !== undefined && { reasonNote: dto.reasonNote ?? null }),
          ...(dto.authorizedBy !== undefined && { authorizedBy: dto.authorizedBy ?? null }),
          ...(dto.linkedWarehouseId !== undefined && {
            linkedWarehouseId: dto.linkedWarehouseId ?? null,
          }),
        },
      });
    });
  }

  /**
   * El listado de una serie. Los tres menús (Entradas, Salidas, Inventario)
   * son el MISMO componente con distinto `type`, por eso el filtro es
   * obligatorio.
   *
   * La búsqueda por folio es PARCIAL y sin distinguir mayúsculas: se busca por
   * el número que trae el papel en la mano, y quien lo dicta por teléfono dice
   * "cuarenta y dos", no "ENT-000042".
   */
  async list(user: AuthUser, query: ListDocumentsQueryDto, scope: UserScope) {
    const where: Prisma.InventoryDocumentWhereInput = {
      tenantId: user.tenantId,
      type: query.type,
      // Sin filtro explícito no se muestran los anulados: crear un borrador es
      // barato y va a haber anulados vacíos que no tienen por qué ensuciar la
      // vista de todos los días.
      status: query.status ?? { in: ["draft", "confirmed"] },
      ...(query.warehouseId !== undefined && { warehouseId: query.warehouseId }),
      ...(query.createdBy !== undefined && { createdBy: query.createdBy }),
      ...(query.folio !== undefined && {
        folio: { contains: query.folio, mode: "insensitive" as const },
      }),
      ...((query.from !== undefined || query.to !== undefined) && {
        createdAt: {
          ...(query.from !== undefined && { gte: new Date(query.from) }),
          ...(query.to !== undefined && { lte: new Date(`${query.to}T23:59:59.999Z`) }),
        },
      }),
      // El alcance del usuario: un Manager no ve documentos de un almacén que
      // no administra.
      ...(scope.warehouseIds !== "all" && { warehouseId: { in: scope.warehouseIds } }),
    };

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.inventoryDocument.count({ where }),
        tx.inventoryDocument.findMany({
          where,
          // Orden TOTAL: `created_at` solo puede empatar entre dos documentos
          // creados en el mismo instante, y el folio los desempata.
          orderBy: [{ createdAt: "desc" }, { folio: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            warehouse: { select: { id: true, name: true } },
            creator: { select: { id: true, firstName: true, lastNamePaternal: true } },
            _count: { select: { lines: true } },
          },
        }),
      ]);

      return {
        rows: rows.map((d) => ({
          id: d.id,
          folio: d.folio,
          type: d.type,
          status: d.status,
          warehouse: d.warehouse,
          reasonCode: d.reasonCode,
          reference: d.reference,
          lineCount: d._count.lines,
          createdAt: d.createdAt,
          createdBy: d.creator,
          confirmedAt: d.confirmedAt,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /**
   * **El detalle ES la vista previa.** No hay endpoint aparte: resuelve las
   * líneas del borrador contra el saldo del momento y devuelve qué pasaría,
   * sin escribir nada.
   *
   * Usa la MISMA `resolveLines` que el confirm (en modo `preview`), y esa es
   * toda la garantía de que lo que se ve sea lo que se asienta.
   */
  async detail(user: AuthUser, documentId: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const document = await tx.inventoryDocument.findFirst({
        where: { id: documentId, tenantId: user.tenantId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          warehouse: { select: { id: true, name: true } },
        },
      });
      if (document === null) {
        throw new NotFoundException({ message: "inventory.document_not_found" });
      }

      const direction = document.type === "exit" ? "exit" : "entry";
      const resolved = await resolveLines(
        tx,
        user.tenantId,
        document.lines.map((l) => ({
          productId: l.productId,
          presentationId: l.presentationId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lotCode: l.lotCode,
          expiresAt: l.expiresAt,
          location: l.location,
        })),
        { direction, reasonCode: document.reasonCode ?? "adjustment", mode: "preview" },
      );

      // El saldo actual de los productos involucrados, en UNA query.
      const productIds = [...new Set(document.lines.map((l) => l.productId))];
      const [saldos, catalogo] = await Promise.all([
        productIds.length === 0
          ? Promise.resolve([])
          : tx.stockByWarehouse.findMany({
              where: { productId: { in: productIds }, warehouseId: document.warehouseId },
              select: { productId: true, quantity: true },
            }),
        // El catálogo de lo que YA está en el documento: la pantalla necesita
        // la unidad base y el factor para decir "3 Caja = 36 unidad", y el
        // listado de presentaciones para poder cambiarla. Va acá y no en una
        // query por fila: un documento de 80 líneas haría 80 viajes desde el
        // navegador para pintar una frase.
        productIds.length === 0
          ? Promise.resolve([])
          : tx.product.findMany({
              where: { id: { in: productIds }, tenantId: user.tenantId },
              select: {
                id: true,
                sku: true,
                name: true,
                baseUnit: true,
                isComposite: true,
                presentations: {
                  where: { isActive: true },
                  orderBy: { factor: "asc" },
                  select: {
                    id: true,
                    name: true,
                    factor: true,
                    allowFractionalInput: true,
                    isPurchasable: true,
                    isSellable: true,
                  },
                },
              },
            }),
      ]);
      const saldoPorProducto = new Map(
        saldos.map((s) => [s.productId, new Prisma.Decimal(s.quantity.toString())]),
      );

      const signo = direction === "entry" ? 1 : -1;
      // Acumulado por producto: dos líneas del mismo producto tienen que
      // mostrar el efecto ENCADENADO, no las dos partiendo del mismo saldo.
      const acumulado = new Map<string, Prisma.Decimal>();

      const rows = document.lines.map((line, index) => {
        const res = resolved[index];
        const antes =
          acumulado.get(line.productId) ??
          saldoPorProducto.get(line.productId) ??
          new Prisma.Decimal(0);
        const delta = (res?.quantityBase ?? new Prisma.Decimal(0)).mul(signo);
        const despues = antes.plus(delta);
        acumulado.set(line.productId, despues);

        const errors = [...(res?.errors ?? [])];
        // La previa de una SALIDA avisa antes de confirmar; el rechazo duro lo
        // hace el ledger, con la fila ya bloqueada.
        if (direction === "exit" && despues.lessThan(0) && errors.length === 0) {
          errors.push({
            field: "quantity",
            code: "inventory.insufficient_stock",
            args: { available: antes.toString(), requested: delta.abs().toString() },
          });
        }

        return {
          lineNo: line.lineNo,
          productId: line.productId,
          sku: res?.sku ?? "",
          presentationId: line.presentationId,
          quantityInput: line.quantity?.toString() ?? null,
          quantityBase: res?.quantityBase.toString() ?? null,
          unitCost: line.unitCost?.toString() ?? null,
          lotCode: line.lotCode,
          expiresAt: line.expiresAt,
          location: line.location,
          newLot: res?.newLot ?? false,
          available: antes.toString(),
          stockBefore: antes.toString(),
          stockAfter: despues.toString(),
          errors,
        };
      });

      return {
        ...document,
        rows,
        products: catalogo.map((p) => ({
          ...p,
          // `factor` sale como string decimal, igual que toda cantidad del
          // API: mandarlo como number lo redondearía en el JSON.
          presentations: p.presentations.map((pr) => ({
            ...pr,
            factor: pr.factor.toString(),
          })),
        })),
        summary: {
          lines: rows.length,
          products: productIds.length,
          newLots: rows.filter((r) => r.newLot).length,
          errors: rows.filter((r) => r.errors.length > 0).length,
        },
      };
    });
  }

  /**
   * Guarda para todo lo que solo se puede hacer sobre un borrador (agregar
   * líneas, importar un Excel, editar la cabecera). Devuelve el documento para
   * que el llamador no lo relea.
   */
  async assertDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
  ): Promise<InventoryDocument> {
    // `tenantId` en el WHERE **además** de la RLS, que es el molde del resto de
    // los services (ver `warehouses.service.ts`). No es redundancia: la RLS de
    // estas tablas llega recién en F3-DB-04, y un test de este archivo probó
    // que sin este filtro un usuario de otro tenant podía anular el documento
    // ajeno. Aunque estuviera puesta, apoyarse en UNA sola barrera para el
    // aislamiento es exactamente lo que no queremos.
    const document = await tx.inventoryDocument.findFirst({
      where: { id: documentId, tenantId },
    });

    if (document === null) {
      throw new NotFoundException({ message: "inventory.document_not_found" });
    }
    if (document.status !== "draft") {
      throw new ConflictException({ message: "inventory.document_not_draft" });
    }

    return document;
  }
}
