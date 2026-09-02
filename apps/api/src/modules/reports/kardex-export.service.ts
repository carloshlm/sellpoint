import { Injectable } from "@nestjs/common";
import { type Locale, quantityDecimals, unitName } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import type { SpreadsheetFormat } from "../../common/spreadsheet/spreadsheet";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { KardexService } from "../inventory/kardex.service";
import type { KardexExportFilters } from "./dto/kardex-export.dto";

/** El tope por página del propio kardex: pedir más lo recorta en silencio. */
const PAGE_SIZE = 200;

/** Traduce una clave en el idioma de quien pidió el archivo. */
export type Translate = (key: string) => string;

/**
 * Cómo se pinta una cantidad en el Excel (Carlos, 2026-09-02).
 *
 * Un producto que solo acepta enteros no lleva decimales: «10», no «10.0000».
 * Uno continuo lleva dos («2.50», con el .00 incluido) y, si el registro trae
 * más precisión, hasta los cuatro que guarda la base («1.2345»). Aritmética
 * de texto, como `formatQuantity`: el valor viene de un `numeric(14,4)` y
 * pasarlo por coma flotante puede correr un dígito.
 */
export function formatExportQuantity(value: string, integersOnly: boolean): string {
  const texto = value.trim();
  const negativo = texto.startsWith("-");
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [entero = "0", fraccion = ""] = sinSigno.split(".");
  const significativa = fraccion.replace(/0+$/, "");

  let cuerpo: string;
  if (integersOnly && significativa === "") {
    cuerpo = entero;
  } else if (significativa.length <= 2) {
    cuerpo = `${entero}.${significativa.padEnd(2, "0")}`;
  } else {
    cuerpo = `${entero}.${significativa.slice(0, 4)}`;
  }
  return negativo ? `-${cuerpo}` : cuerpo;
}

/**
 * F5-KDX-01 — el kardex en Excel.
 *
 * ── Por qué REUSA `kardex.service.list` y no consulta por su cuenta ──────
 *
 * Porque el `balanceAfter` es lo único que justifica que el kardex exista, y
 * lo calcula una window function sobre el orden total de los movimientos
 * (`created_at DESC, seq DESC`). Una segunda implementación daría los mismos
 * números hasta el día que no, y ese día nadie sabría a cuál creerle.
 *
 * Reusar el servicio trae de arriba, gratis, todo lo que ya sabe: el rango en
 * días del calendario del negocio, el alcance por almacén y el 404 del
 * producto ajeno.
 *
 * ── El archivo habla el idioma del usuario (Carlos, 2026-09-02) ──────────
 *
 * Salía «physical_count» y «adjustment»: identificadores de máquina en un
 * archivo que lee una persona. Tipo, movimiento y motivo se traducen con el
 * `t` del idioma de quien pidió el archivo, y se agregan la unidad y si el
 * producto solo acepta enteros — que es lo que decide cómo se pintan la
 * cantidad y el saldo.
 */
@Injectable()
export class KardexExportService {
  constructor(
    private readonly kardex: KardexService,
    private readonly prisma: PrismaService,
  ) {}

  async build(
    user: AuthUser,
    scope: UserScope,
    productId: string,
    query: KardexExportFilters,
    format: SpreadsheetFormat,
    locale: Locale,
    t: Translate,
  ) {
    // La primera página se pide ANTES del tope: es la que dice cuántas filas
    // hay en total, y de paso valida el producto y el alcance —así el 404 y el
    // 403 llegan antes que cualquier archivo a medio armar—.
    const primera = await this.kardex.list(user, scope, productId, {
      ...query,
      page: 1,
      pageSize: PAGE_SIZE,
    });

    // La unidad es del PRODUCTO, no del movimiento: una sola consulta.
    const producto = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.product.findUniqueOrThrow({ where: { id: productId }, select: { baseUnit: true } }),
    );
    const soloEnteros = quantityDecimals(producto.baseUnit) === 0;
    const unidad = unitName(producto.baseUnit, locale);
    const k = (key: string) => t(`inventory.kardexExport.${key}`);

    return exportWithLimit({
      count: async () => primera.total,
      rows: async () => {
        const filas = [...primera.rows];
        // Las páginas siguientes solo si hacen falta: la mayoría de los
        // productos cabe en una.
        for (let page = 2; filas.length < primera.total; page += 1) {
          const siguiente = await this.kardex.list(user, scope, productId, {
            ...query,
            page,
            pageSize: PAGE_SIZE,
          });
          if (siguiente.rows.length === 0) {
            break;
          }
          filas.push(...siguiente.rows);
        }

        return filas.map((fila) => [
          // Solo la fecha y la hora, sin zona: el Excel se lee, no se parsea.
          fila.createdAt.toISOString().slice(0, 16).replace("T", " "),
          fila.document.folio,
          k(`type.${fila.document.type}`),
          t(`pdf.type.${fila.direction}`),
          t(`pdf.reason.${fila.reasonCode}`),
          // Lote y ubicación (decisión 5 de la revisión pre-F5): el papel no
          // puede contar menos que la pantalla, que ya los muestra.
          fila.lot?.lotCode ?? "",
          fila.location ?? "",
          fila.warehouse.name,
          unidad,
          k(soloEnteros ? "yes" : "no"),
          // El signo va en la CANTIDAD y no en una columna aparte: así una
          // suma de la columna en Excel da el saldo, que es lo primero que
          // alguien intenta hacer con este archivo.
          formatExportQuantity(
            fila.direction === "entry" ? fila.quantity : `-${fila.quantity}`,
            soloEnteros,
          ),
          formatExportQuantity(fila.balanceAfter, soloEnteros),
          fila.unitCost ?? "",
          fila.createdBy.name,
        ]);
      },
      header: [
        k("date"),
        k("folio"),
        k("typeHeader"),
        k("movement"),
        k("reason"),
        k("lot"),
        k("location"),
        k("warehouse"),
        k("unit"),
        k("integersOnly"),
        k("quantity"),
        k("balance"),
        k("unitCost"),
        k("user"),
      ],
      format,
      sheetName: "Kardex",
      filenameBase: "kardex",
    });
  }
}
