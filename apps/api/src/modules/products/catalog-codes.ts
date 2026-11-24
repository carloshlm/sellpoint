import { ConflictException } from "@nestjs/common";
import { barcodeSearchForms } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * F10-PRESCODE — los códigos de un negocio son UN solo espacio de nombres.
 *
 * Carlos (2026-11-23): «No puede repetirse con ningún otro código del negocio:
 * ni con el código interno de un producto, ni con el de otra presentación, ni
 * con un código de barras». Y el 2026-11-24, para el código interno del
 * producto: «debemos evitar que el Codigo Interno sea igual al código de
 * barras o código interno de otro producto». La caja y las entradas buscan un
 * código exacto en los tres lugares; si «BOLSA10K» fuera a la vez el código de
 * un producto y el de la bolsa de otro, no habría forma de saber cuál traer.
 *
 * Cada tabla ya tiene su índice único (`products.sku`, `barcode` y `code` de
 * `product_presentations`), pero un índice no cruza tablas ni columnas. Lo
 * que cruza vive acá, y se revisa en los DOS sentidos. Qué se compara contra
 * qué, según el código que se está guardando:
 *
 * | Se guarda                    | No puede ser…                                          |
 * |------------------------------|--------------------------------------------------------|
 * | código de una presentación   | un sku (también el de su producto), el código o el     |
 * |                              | código de barras de OTRA presentación                  |
 * | sku de un producto           | el código de una presentación, el código de barras de  |
 * |                              | OTRO producto                                          |
 * | código de barras             | el código de OTRA presentación, el sku de OTRO producto|
 *
 * Lo que queda permitido a propósito es que un producto use su PROPIO código
 * de barras como sku: Carga rápida y el alta lo hacen así, y los dos llevan al
 * mismo producto (Carlos lo confirmó el 2026-11-24). Las repeticiones dentro
 * de la misma columna (sku contra sku, código de barras contra código de
 * barras) las rechaza su índice, con su mensaje de siempre.
 *
 * Todo se compara sin mayúsculas y con las escrituras equivalentes de un
 * código de barras (un UPC-A y su EAN-13 con un cero delante son el mismo
 * código para el lector).
 */

type Tx = Prisma.TransactionClient;

/** Quién tiene ya el código: es lo que nombra el aviso. */
type Dueno =
  | { kind: "product_sku"; product: string }
  | { kind: "presentation_code"; product: string; presentation: string }
  | { kind: "barcode"; product: string; presentation: string };

/** Qué se está guardando, y de quién es: lo propio nunca choca consigo. */
export type CodigoQueSeGuarda = {
  como: "code" | "sku" | "barcode";
  productId: string | null;
  presentationId: string | null;
};

/** Todo lo que el negocio ya tiene con alguno de los códigos buscados. */
export type Duenos = {
  skus: { clave: string; productId: string; product: string }[];
  codigos: Ocupante[];
  barras: Ocupante[];
};

type Ocupante = {
  clave: string;
  presentationId: string;
  productId: string;
  product: string;
  presentation: string;
};

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
 * Las claves con las que un código puede estar guardado: en mayúsculas, tal
 * cual y en sus escrituras equivalentes de código de barras.
 */
function clavesDe(codigo: string): string[] {
  return [...new Set([codigo, ...barcodeSearchForms(codigo)].map((c) => c.trim().toUpperCase()))];
}

/**
 * Lo que el negocio ya tiene con alguno de estos códigos, en tres consultas.
 * Para quien revisa muchas líneas a la vez (Carga rápida, la importación) y
 * reporta cada choque en su renglón en lugar de cortar en el primero.
 */
export async function codeOwnersIn(tx: Tx, tenantId: string, codigos: string[]): Promise<Duenos> {
  const claves = [...new Set(codigos.flatMap(clavesDe))];
  if (claves.length === 0) {
    return { skus: [], codigos: [], barras: [] };
  }

  const [skus, codigosDePresentacion, barras] = await Promise.all([
    tx.$queryRaw<{ clave: string; product_id: string; product: string }[]>`
      SELECT upper(p.sku) AS clave, p.id AS product_id, p.name AS product
        FROM products p
       WHERE p.tenant_id = ${tenantId}::uuid
         AND upper(p.sku) = ANY(${claves}::text[])`,
    tx.$queryRaw<OcupanteCrudo[]>`
      SELECT upper(pp.code) AS clave, pp.id AS presentation_id, pp.product_id,
             p.name AS product, pp.name AS presentation
        FROM product_presentations pp
        JOIN products p ON p.id = pp.product_id
       WHERE pp.tenant_id = ${tenantId}::uuid
         AND upper(pp.code) = ANY(${claves}::text[])`,
    tx.$queryRaw<OcupanteCrudo[]>`
      SELECT upper(pp.barcode) AS clave, pp.id AS presentation_id, pp.product_id,
             p.name AS product, pp.name AS presentation
        FROM product_presentations pp
        JOIN products p ON p.id = pp.product_id
       WHERE pp.tenant_id = ${tenantId}::uuid
         AND upper(pp.barcode) = ANY(${claves}::text[])`,
  ]);

  return {
    skus: skus.map((s) => ({ clave: s.clave, productId: s.product_id, product: s.product })),
    codigos: codigosDePresentacion.map(ocupante),
    barras: barras.map(ocupante),
  };
}

type OcupanteCrudo = {
  clave: string;
  presentation_id: string;
  product_id: string;
  product: string;
  presentation: string;
};

function ocupante(fila: OcupanteCrudo): Ocupante {
  return {
    clave: fila.clave,
    presentationId: fila.presentation_id,
    productId: fila.product_id,
    product: fila.product,
    presentation: fila.presentation,
  };
}

/**
 * El primer choque de `codigo` con lo que ya tiene el negocio, según la tabla
 * del encabezado, o `null` si está libre.
 */
export function firstCodeClash(
  duenos: Duenos,
  codigo: string,
  guardado: CodigoQueSeGuarda,
): Dueno | null {
  const claves = new Set(clavesDe(codigo));
  const deOtroProducto = (productId: string) => productId !== guardado.productId;
  const deOtraPresentacion = (o: Ocupante) => o.presentationId !== guardado.presentationId;

  const sku = duenos.skus.find(
    (s) =>
      claves.has(s.clave) &&
      // El código de una presentación tampoco puede ser el sku de SU producto:
      // la caja no sabría si traer el producto o esa presentación.
      (guardado.como === "code" || (guardado.como === "barcode" && deOtroProducto(s.productId))),
  );
  if (sku !== undefined) {
    return { kind: "product_sku", product: sku.product };
  }

  const conCodigo = duenos.codigos.find((o) => claves.has(o.clave) && deOtraPresentacion(o));
  if (conCodigo !== undefined) {
    return {
      kind: "presentation_code",
      product: conCodigo.product,
      presentation: conCodigo.presentation,
    };
  }

  const conBarras = duenos.barras.find(
    (o) =>
      claves.has(o.clave) &&
      ((guardado.como === "code" && deOtraPresentacion(o)) ||
        (guardado.como === "sku" && deOtroProducto(o.productId))),
  );
  if (conBarras !== undefined) {
    return { kind: "barcode", product: conBarras.product, presentation: conBarras.presentation };
  }
  return null;
}

/**
 * Revisa UN código y lanza el 409 con el nombre de quien ya lo tiene. El
 * campo del error es el del formulario: `code`, `sku` o `barcode`.
 */
export async function assertCodeFree(
  tx: Tx,
  tenantId: string,
  codigo: string,
  guardado: CodigoQueSeGuarda,
): Promise<void> {
  const dueno = firstCodeClash(await codeOwnersIn(tx, tenantId, [codigo]), codigo, guardado);
  if (dueno !== null) {
    throw conflicto(dueno, guardado.como);
  }
}

/** La clave de i18n de cada choque. */
export function codeTakenMessage(kind: Dueno["kind"]): string {
  return `products.code_taken_${kind}`;
}

/** Los argumentos del mensaje: el producto y, si la hay, la presentación. */
export function codeTakenArgs(dueno: Dueno): Record<string, string> {
  return dueno.kind === "product_sku"
    ? { product: dueno.product }
    : { product: dueno.product, presentation: dueno.presentation };
}

function conflicto(dueno: Dueno, campo: "code" | "sku" | "barcode"): ConflictException {
  const message = codeTakenMessage(dueno.kind);
  const args = codeTakenArgs(dueno);
  return new ConflictException({ message, args, errors: [{ key: campo, message, args }] });
}
