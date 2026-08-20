import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { type MovementDirection, type MovementReason, rejectsExpiredLots } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";

/** Lo que el usuario capturó, antes de resolverse contra el catálogo. */
export interface RawLine {
  productId: string;
  presentationId?: string | null;
  quantity?: number | Prisma.Decimal | null;
  unitCost?: number | Prisma.Decimal | null;
  lotCode?: string | null;
  expiresAt?: string | Date | null;
  location?: string | null;
  lotId?: string | null;
}

/** Un problema de una línea concreta, en la forma que el front pinta sobre la fila. */
export interface LineError {
  field: string;
  code: string;
  args?: Record<string, unknown>;
}

/** Lo que el ledger va a mover. Todo en unidad base, sin ambigüedad. */
export interface ResolvedLine {
  lineIndex: number;
  productId: string;
  sku: string;
  presentationId: string | null;
  /** SIEMPRE en la `base_unit` del producto. */
  quantityBase: Prisma.Decimal;
  /** Lo que el usuario tecleó, en la presentación que eligió. Para el kardex. */
  quantityInput: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  /** Compuesto que hay que expandir en sus componentes (F3-CORE-06). */
  expand: boolean;
  lotId?: string;
  location?: string;
  /** Solo en `preview`: el lote no existe todavía y se crearía al confirmar. */
  newLot?: boolean;
  /** Solo en `preview`: vacío si la línea está bien. */
  errors?: LineError[];
}

export interface ResolveOptions {
  direction: MovementDirection;
  reasonCode: MovementReason;
  /**
   * `strict` (default) tira el primer error: es lo que hace el **confirm**,
   * porque asentar la mitad de un movimiento sería peor que rechazarlo entero.
   *
   * `preview` no tira nada — junta los errores POR LÍNEA y **no crea lotes**.
   * Es lo que usa el detalle del borrador: quien cargó 80 líneas necesita ver
   * las cinco que están mal de una vez, y mirar la previa no puede dejar lotes
   * fantasma en la base.
   *
   * Que las dos formas compartan ESTA función es lo que garantiza que lo
   * previsualizado y lo asentado se validen igual.
   */
  mode?: "strict" | "preview";
}

type ProductRow = {
  id: string;
  sku: string;
  isActive: boolean;
  isComposite: boolean;
  tracksLots: boolean;
};
type PresentationRow = {
  id: string;
  productId: string;
  name: string;
  factor: Prisma.Decimal;
  isActive: boolean;
  allowFractionalInput: boolean;
};

/** Los únicos motivos que pueden sacar un compuesto: se arma y se consume. */
const COMPOSITE_EXIT_REASONS = new Set<MovementReason>(["consumption", "expired"]);

/**
 * F3-CORE-04 — de lo que el usuario capturó a lo que el ledger va a mover.
 *
 * **La misma función alimenta la VISTA PREVIA del borrador y el CONFIRM.** No
 * es una optimización: si fueran dos, lo previsualizado y lo asentado podrían
 * validarse distinto y el usuario terminaría confirmando algo que no vio.
 *
 * Toda la aritmética va en `Prisma.Decimal` y nunca en `number`. Con floats,
 * `0.1 + 0.2` da `0.30000000000000004`: un saldo se corrompe de a poquito y
 * nadie se entera hasta que el inventario físico no cuadra.
 *
 * Carga productos y presentaciones en UNA query cada uno, no una por línea: un
 * movimiento de 500 líneas haría 1000 viajes a la base.
 */
export async function resolveLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lines: RawLine[],
  options: ResolveOptions,
): Promise<ResolvedLine[]> {
  const preview = options.mode === "preview";
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const presentationIds = [
    ...new Set(lines.map((l) => l.presentationId).filter((id): id is string => Boolean(id))),
  ];

  const [products, presentations] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true, sku: true, isActive: true, isComposite: true, tracksLots: true },
    }),
    presentationIds.length > 0
      ? tx.productPresentation.findMany({
          where: { id: { in: presentationIds }, tenantId },
          select: {
            id: true,
            productId: true,
            name: true,
            factor: true,
            isActive: true,
            allowFractionalInput: true,
          },
        })
      : Promise.resolve([] as PresentationRow[]),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const presentationById = new Map(presentations.map((p) => [p.id, p]));
  const resolved: ResolvedLine[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    if (!preview) {
      resolved.push(
        await resolveOne(
          tx,
          tenantId,
          line,
          lineIndex,
          options,
          productById,
          presentationById,
          false,
        ),
      );
      continue;
    }
    try {
      resolved.push(
        await resolveOne(
          tx,
          tenantId,
          line,
          lineIndex,
          options,
          productById,
          presentationById,
          true,
        ),
      );
    } catch (error) {
      // En previa un problema NO corta: se anota sobre su fila y las demás se
      // siguen resolviendo.
      resolved.push(toErrorLine(line, lineIndex, error));
    }
  }

  return resolved;
}

/** Convierte una excepción de Nest en el error de fila que pinta el front. */
function toErrorLine(line: RawLine, lineIndex: number, error: unknown): ResolvedLine {
  const response = (error as { response?: { message?: string; args?: Record<string, unknown> } })
    ?.response;
  return {
    lineIndex,
    productId: line.productId,
    sku: "",
    presentationId: line.presentationId ?? null,
    quantityBase: new Prisma.Decimal(0),
    quantityInput: new Prisma.Decimal((line.quantity ?? 0).toString()),
    unitCost: null,
    expand: false,
    errors: [
      {
        field: (response?.args?.field as string) ?? "quantity",
        code: response?.message ?? "inventory.invalid_body",
        args: response?.args,
      },
    ],
  };
}

async function resolveOne(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: RawLine,
  lineIndex: number,
  options: ResolveOptions,
  productById: Map<string, ProductRow>,
  presentationById: Map<string, PresentationRow>,
  preview: boolean,
): Promise<ResolvedLine> {
  const product = productById.get(line.productId);
  if (product === undefined) {
    throw new NotFoundException({
      message: "inventory.product_not_found",
      args: { lineIndex, field: "productId" },
    });
  }
  if (!product.isActive) {
    throw new UnprocessableEntityException({
      message: "inventory.product_inactive",
      args: { sku: product.sku, lineIndex, field: "productId" },
    });
  }

  // Un compuesto NUNCA tiene saldo propio: se arma al consumirlo. Solo las
  // salidas por consumo o caducidad lo expanden en sus componentes.
  const expand =
    product.isComposite &&
    options.direction === "exit" &&
    COMPOSITE_EXIT_REASONS.has(options.reasonCode);
  if (product.isComposite && !expand) {
    throw new ConflictException({
      message: "inventory.composite_has_no_stock",
      args: { sku: product.sku, lineIndex, field: "productId" },
    });
  }

  // Una cantidad ausente es un estado válido del BORRADOR, pero no de un
  // asiento: acá es donde deja de serlo.
  if (line.quantity === undefined || line.quantity === null) {
    throw new UnprocessableEntityException({
      message: "inventory.quantity_must_be_positive",
      args: { lineIndex, field: "quantity" },
    });
  }

  const quantityInput = new Prisma.Decimal(line.quantity.toString());
  let quantityBase = quantityInput;
  let presentationId: string | null = null;

  if (line.presentationId) {
    const presentation = presentationById.get(line.presentationId);
    if (
      presentation === undefined ||
      presentation.productId !== product.id ||
      !presentation.isActive
    ) {
      throw new UnprocessableEntityException({
        message: "inventory.presentation_invalid",
        args: { lineIndex, field: "presentationId" },
      });
    }
    if (!presentation.allowFractionalInput && !quantityInput.isInteger()) {
      throw new UnprocessableEntityException({
        message: "inventory.integer_only_presentation",
        args: { presentationName: presentation.name, lineIndex, field: "quantity" },
      });
    }
    presentationId = presentation.id;
    quantityBase = quantityInput.mul(new Prisma.Decimal(presentation.factor.toString()));
  }

  const lot = await resolveLot(tx, tenantId, product, line, options, lineIndex, preview);

  return {
    lineIndex,
    productId: product.id,
    sku: product.sku,
    presentationId,
    quantityBase,
    quantityInput,
    unitCost:
      line.unitCost === undefined || line.unitCost === null
        ? null
        : new Prisma.Decimal(line.unitCost.toString()),
    expand,
    ...lot,
    ...(preview ? { errors: [] } : {}),
  };
}

/**
 * Resuelve el lote de una línea, con dos reglas asimétricas a propósito:
 *
 *  · en ENTRADA el lote es obligatorio y se CREA si no existía — es el momento
 *    en que la partida entra al negocio;
 *  · en SALIDA es opcional: sin él decide FEFO (F3-CORE-08), que es el
 *    comportamiento que hereda el POS de F4 sin pedirle nada al cajero.
 */
async function resolveLot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  product: ProductRow,
  line: RawLine,
  options: ResolveOptions,
  lineIndex: number,
  preview: boolean,
): Promise<{ lotId?: string; location?: string; newLot?: boolean }> {
  const traeLote = Boolean(line.lotCode || line.lotId);

  if (!product.tracksLots) {
    if (traeLote) {
      throw new UnprocessableEntityException({
        message: "inventory.lot_not_tracked",
        args: { sku: product.sku, lineIndex, field: "lotCode" },
      });
    }
    return {};
  }

  if (!traeLote) {
    if (options.direction === "entry") {
      throw new UnprocessableEntityException({
        message: "inventory.lot_required",
        args: { sku: product.sku, lineIndex, field: "lotCode" },
      });
    }
    return {};
  }

  // `''` y no NULL: la ubicación entra en la clave primaria de `stock_lots`.
  const location = line.location?.trim() ?? "";

  if (line.lotId) {
    return { lotId: line.lotId, location };
  }

  const lotCode = (line.lotCode as string).trim();
  const existing = await tx.productLot.findFirst({
    where: { tenantId, productId: product.id, lotCode },
    select: { id: true, expiresAt: true },
  });

  if (existing !== null) {
    // La caducidad es del LOTE: si ya existe con otra fecha, una de las dos
    // está mal y adivinar cuál sería peor que preguntar.
    const pedida = line.expiresAt ? new Date(line.expiresAt).toISOString().slice(0, 10) : null;
    const guardada = existing.expiresAt?.toISOString().slice(0, 10) ?? null;
    if (pedida !== null && guardada !== null && pedida !== guardada) {
      throw new ConflictException({
        message: "inventory.lot_expiry_mismatch",
        args: { lotCode, lineIndex, field: "expiresAt" },
      });
    }
    // Elegir el lote a mano NO es una llave maestra. FEFO ya se niega a tomar
    // un vencido para una venta; si esto no estuviera, bastaría con teclear el
    // código del lote para saltarse la regla — y quien lo teclea suele ser
    // justo quien tiene apuro por sacarlo.
    //
    // Solo se mira acá, en el camino del `lotCode`: `lotId` no está en el DTO,
    // así que no hay forma de llegar por ese lado desde afuera.
    if (
      options.direction === "exit" &&
      rejectsExpiredLots(options.reasonCode) &&
      existing.expiresAt !== null
    ) {
      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      if (existing.expiresAt < hoy) {
        throw new UnprocessableEntityException({
          message: "inventory.expired_lot_not_sellable",
          args: {
            sku: product.sku,
            lotCode,
            expiresAt: existing.expiresAt.toISOString().slice(0, 10),
            lineIndex,
            field: "lotCode",
          },
        });
      }
    }

    return { lotId: existing.id, location };
  }

  // En previa NO se crea: mirar no puede dejar lotes fantasma en la base. Se
  // marca `newLot` para que la pantalla lo muestre como "se creará al
  // confirmar".
  if (preview) {
    return { location, newLot: true };
  }

  const created = await tx.productLot.create({
    data: {
      tenantId,
      productId: product.id,
      lotCode,
      expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
    },
    select: { id: true },
  });
  return { lotId: created.id, location };
}
