import { ConflictException } from "@nestjs/common";
import { barcodeSearchForms, normalizeCode } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * F10-PRESCODE — los códigos de un negocio son UN solo espacio de nombres.
 *
 * Carlos (2026-11-23): «No puede repetirse con ningún otro código del negocio:
 * ni con el código interno de un producto, ni con el de otra presentación, ni
 * con un código de barras». La caja y las entradas buscan un código exacto en
 * los tres lugares; si «BOLSA10K» fuera a la vez el código de un producto y el
 * de la bolsa de otro, no habría forma de saber cuál traer.
 *
 * Cada tabla ya tiene su índice único (`products.sku`, `barcode` y `code` de
 * `product_presentations`), pero un índice no cruza tablas ni columnas. Lo
 * que cruza vive acá, y se revisa en los DOS sentidos: al poner el código de
 * una presentación y al poner un sku o un código de barras que pudiera chocar
 * con uno.
 *
 * Lo que NO se revisa a propósito es sku contra código de barras: Carga rápida
 * y el alta de producto usan el código de barras como sku, y eso es el mismo
 * producto, no un choque (verificado en producción el 2026-11-23: ningún sku
 * coincide con el código de barras de otro producto).
 */

type Tx = Prisma.TransactionClient;

/**
 * Quién tiene ya el código. `presentationId` lo deja fuera para que una
 * presentación pueda volver a guardar el suyo.
 */
type Dueno =
  | { kind: "product_sku"; product: string }
  | { kind: "presentation_code"; product: string; presentation: string }
  | { kind: "barcode"; product: string; presentation: string };

/**
 * Serializa los cambios de código de UN negocio.
 *
 * Revisar y después escribir deja una ventana: dos personas que guardan a la
 * vez «BOLSA10K», una como sku y otra como código de presentación, pasarían
 * las dos la revisión. El candado de asesoría dura lo que la transacción y
 * solo lo toman las escrituras que cambian un código, así que no frena nada
 * más del negocio.
 */
export async function lockCatalogCodes(tx: Tx, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-codes:${tenantId}`}::text, 0))`;
}

/**
 * Las escrituras con las que un código puede estar guardado como código de
 * barras: tal cual, y sus formas equivalentes de GTIN (un UPC-A y su EAN-13
 * con un cero delante son el mismo código para el lector).
 */
function formasDeCodigoDeBarras(codigo: string): string[] {
  return [...new Set([codigo, ...barcodeSearchForms(codigo)])];
}

/** El código interno de una presentación contra todo lo demás del negocio. */
export async function assertPresentationCodeFree(
  tx: Tx,
  tenantId: string,
  code: string,
  presentationId: string | null,
): Promise<void> {
  const otraPresentacion = presentationId === null ? {} : { id: { not: presentationId } };

  const producto = await tx.product.findFirst({
    where: { tenantId, sku: { equals: code, mode: "insensitive" } },
    select: { name: true },
  });
  if (producto !== null) {
    throw conflicto({ kind: "product_sku", product: producto.name }, "code");
  }

  const conCodigo = await tx.productPresentation.findFirst({
    where: { tenantId, code: { equals: code, mode: "insensitive" }, ...otraPresentacion },
    select: { name: true, product: { select: { name: true } } },
  });
  if (conCodigo !== null) {
    throw conflicto(
      { kind: "presentation_code", product: conCodigo.product.name, presentation: conCodigo.name },
      "code",
    );
  }

  const conBarras = await tx.productPresentation.findFirst({
    where: {
      tenantId,
      OR: [
        { barcode: { in: formasDeCodigoDeBarras(code) } },
        { barcode: { equals: code, mode: "insensitive" } },
      ],
      ...otraPresentacion,
    },
    select: { name: true, product: { select: { name: true } } },
  });
  if (conBarras !== null) {
    throw conflicto(
      { kind: "barcode", product: conBarras.product.name, presentation: conBarras.name },
      "code",
    );
  }
}

/** El sku de un producto contra los códigos internos de las presentaciones. */
export async function assertSkuFreeOfPresentationCodes(
  tx: Tx,
  tenantId: string,
  sku: string,
): Promise<void> {
  const dueno = await presentacionConCodigo(tx, tenantId, [sku], null);
  if (dueno !== null) {
    throw conflicto(dueno, "sku");
  }
}

/**
 * El código de barras de una presentación contra los códigos internos de las
 * presentaciones. La propia queda fuera: que una presentación tenga el mismo
 * número como código y como código de barras no confunde a nadie.
 */
export async function assertBarcodeFreeOfPresentationCodes(
  tx: Tx,
  tenantId: string,
  barcode: string,
  presentationId: string | null,
): Promise<void> {
  const dueno = await presentacionConCodigo(
    tx,
    tenantId,
    formasDeCodigoDeBarras(barcode),
    presentationId,
  );
  if (dueno !== null) {
    throw conflicto(dueno, "barcode");
  }
}

/**
 * Las presentaciones cuyo código interno es alguno de estos, por código. Para
 * quien revisa muchas líneas a la vez (Carga rápida) y reporta cada choque en
 * su renglón en lugar de cortar en el primero. Los códigos se guardan ya
 * normalizados, así que basta compararlos normalizados.
 */
export async function presentationCodesIn(
  tx: Tx,
  tenantId: string,
  codigos: string[],
): Promise<Map<string, { product: string; presentation: string }>> {
  const buscados = [...new Set(codigos.map(normalizeCode))];
  if (buscados.length === 0) {
    return new Map();
  }
  const filas = await tx.productPresentation.findMany({
    where: { tenantId, code: { in: buscados } },
    select: { code: true, name: true, product: { select: { name: true } } },
  });
  return new Map(
    filas.flatMap((fila) =>
      fila.code === null
        ? []
        : [[fila.code, { product: fila.product.name, presentation: fila.name }] as const],
    ),
  );
}

async function presentacionConCodigo(
  tx: Tx,
  tenantId: string,
  codigos: string[],
  presentationId: string | null,
): Promise<Dueno | null> {
  const encontrada = await tx.productPresentation.findFirst({
    where: {
      tenantId,
      OR: codigos.map((codigo) => ({ code: { equals: codigo, mode: "insensitive" as const } })),
      ...(presentationId === null ? {} : { id: { not: presentationId } }),
    },
    select: { name: true, product: { select: { name: true } } },
  });
  return encontrada === null
    ? null
    : {
        kind: "presentation_code",
        product: encontrada.product.name,
        presentation: encontrada.name,
      };
}

/** La clave de i18n de cada choque. */
export function codeTakenMessage(kind: Dueno["kind"]): string {
  return `products.code_taken_${kind}`;
}

function conflicto(dueno: Dueno, campo: "code" | "sku" | "barcode"): ConflictException {
  const message = codeTakenMessage(dueno.kind);
  const args =
    dueno.kind === "product_sku"
      ? { product: dueno.product }
      : { product: dueno.product, presentation: dueno.presentation };
  return new ConflictException({ message, args, errors: [{ key: campo, message, args }] });
}
