import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { InventoryDocumentType } from "@sellpoint/shared";
import { type Currency, shortName } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  buildDocumentDefinition,
  type PdfDocumentInput,
  type PdfRow,
} from "./document-pdf.renderer";

/**
 * Las fuentes estándar de PDF (Helvetica y familia) vienen dentro de todo
 * visor: no hay que embeber archivos ni sumar megas a la imagen de Docker. El
 * documento es una tabla de datos, no una pieza de diseño.
 */
const FONTS = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

type PdfDocumentSource = {
  type: string;
  status: string;
  lines: {
    lineNo: number;
    productId: string;
    quantity: Prisma.Decimal | null;
    theoretical: Prisma.Decimal | null;
    counted: Prisma.Decimal | null;
    unitCost: Prisma.Decimal | null;
    lotCode: string | null;
    expiresAt: Date | null;
    location: string | null;
    product: { sku: string; name: string; baseUnit: string };
    presentation: { name: string; factor: Prisma.Decimal } | null;
  }[];
  movements: {
    productId: string;
    direction: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal | null;
    location: string | null;
    product: { sku: string; name: string; baseUnit: string };
    presentation: { name: string; factor: Prisma.Decimal } | null;
    lot: { lotCode: string; expiresAt: Date | null } | null;
  }[];
};

/**
 * Las filas que se imprimen.
 *
 * Una ENTRADA o SALIDA confirmada se arma con sus `stock_movements` —lo que
 * realmente pasó, incluida la partición FEFO en varios lotes—. Un CONTEO no
 * (Carlos, 2026-09-02): asienta dos movimientos por línea (salida del teórico
 * y entrada de lo contado) y ninguno sabe qué se contó; su papel son sus
 * líneas, con el teórico que se vio al capturar y lo contado, siempre.
 */
/** La cubeta de un conteo: producto, lote y ubicación, como las agrupa la aprobación. */
const cubeta = (productId: string, lotCode: string | null, location: string | null) =>
  `${productId}|${lotCode ?? ""}|${(location ?? "").trim()}`;

/**
 * Lo que un conteo CONFIRMADO movió en cada cubeta: entradas menos salidas.
 * Vacío en un borrador o un anulado, que no movieron nada.
 */
function netoDelConteo(document: PdfDocumentSource): Map<string, Prisma.Decimal> {
  const neto = new Map<string, Prisma.Decimal>();
  if (document.type !== "physical_count" || document.status !== "confirmed") {
    return neto;
  }
  for (const m of document.movements) {
    const clave = cubeta(m.productId, m.lot?.lotCode ?? null, m.location);
    const cantidad = m.direction === "entry" ? m.quantity : m.quantity.negated();
    neto.set(clave, (neto.get(clave) ?? new Prisma.Decimal(0)).plus(cantidad));
  }
  return neto;
}

/**
 * El teórico de una línea de conteo en el papel (Carlos, 2026-11-01).
 *
 * En un conteo confirmado es el que se APLICÓ: lo contado menos lo que el
 * conteo movió en su cubeta. Es exacto aunque el lote se haya corregido en
 * pantalla después de subir la planilla, y arregla también los conteos ya
 * confirmados: el Queso Oaxaca de Carlos decía 448.8 (el total del producto)
 * en la fila de sus 33 kg sin lote, con una diferencia de −415.8 que nunca
 * pasó. Sin contado (omitida) o sin confirmar, el teórico que se vio al
 * capturar la fila (`quantity`; `theoretical` es la columna dedicada).
 */
function teoricoDeConteo(
  document: PdfDocumentSource,
  l: PdfDocumentSource["lines"][number],
  netoPorCubeta: Map<string, Prisma.Decimal>,
): string | null {
  if (document.status === "confirmed" && l.counted !== null) {
    const movido = netoPorCubeta.get(cubeta(l.productId, l.lotCode, l.location));
    return new Prisma.Decimal(l.counted.toString())
      .minus(movido ?? new Prisma.Decimal(0))
      .toString();
  }
  return (l.theoretical ?? l.quantity)?.toString() ?? null;
}

export function pdfRowsFor(document: PdfDocumentSource): PdfRow[] {
  const esConteo = document.type === "physical_count";
  if (!esConteo && document.status === "confirmed" && document.movements.length > 0) {
    return document.movements.map((m, index) => ({
      lineNo: index + 1,
      sku: m.product.sku,
      name: m.product.name,
      presentationName: m.presentation?.name ?? null,
      // Lo que se TECLEÓ, reconstruido con el factor (Carlos, 2026-09-02): el
      // movimiento vive en unidad base, pero quien lee el papel contó cajas.
      quantityInput:
        m.presentation === null
          ? m.quantity.toString()
          : m.quantity.dividedBy(m.presentation.factor).toString(),
      quantityBase: m.quantity.toString(),
      baseUnit: m.product.baseUnit,
      unitCost: m.unitCost?.toString() ?? null,
      lotCode: m.lot?.lotCode ?? null,
      expiresAt: m.lot?.expiresAt ?? null,
      location: m.location,
      theoretical: null,
      counted: null,
    }));
  }
  const netoPorCubeta = netoDelConteo(document);
  return document.lines.map((l) => ({
    lineNo: l.lineNo,
    sku: l.product.sku,
    name: l.product.name,
    presentationName: l.presentation?.name ?? null,
    quantityInput: l.quantity?.toString() ?? null,
    quantityBase: l.quantity?.toString() ?? null,
    baseUnit: l.product.baseUnit,
    unitCost: l.unitCost?.toString() ?? null,
    lotCode: l.lotCode,
    expiresAt: l.expiresAt,
    location: l.location,
    theoretical: esConteo ? teoricoDeConteo(document, l, netoPorCubeta) : null,
    counted: l.counted?.toString() ?? null,
  }));
}

@Injectable()
export class DocumentPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * F3-DOC-07 — genera el PDF de un documento.
   *
   * Un documento CONFIRMADO se arma con sus `stock_movements` —lo que
   * realmente pasó, incluida la partición FEFO en varios lotes— y no con las
   * líneas capturadas. Un borrador no tiene movimientos, así que sale de sus
   * líneas y va marcado.
   */
  async render(
    user: AuthUser,
    documentId: string,
    t: (key: string) => string,
  ): Promise<{ body: Buffer; filename: string }> {
    const { input, folio } = await this.load(user, documentId);

    const definition = buildDocumentDefinition(input, t) as unknown as TDocumentDefinitions;
    const pdf = this.printer.createPdfKitDocument(definition);

    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    });

    return { body, filename: `${folio}.pdf` };
  }

  /**
   * Lo que dice el papel de un documento: el PDF y el Excel salen de AQUÍ
   * (Carlos, 2026-10-30), para que el archivo diga lo mismo que la hoja
   * firmada. `draftMessage` es la explicación del 409 de un borrador, que
   * nombra el formato que se pidió.
   */
  async load(
    user: AuthUser,
    documentId: string,
    draftMessage = "inventory.pdf_draft",
  ): Promise<{ input: PdfDocumentInput; folio: string }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const document = await tx.inventoryDocument.findFirst({
        where: { id: documentId, tenantId: user.tenantId },
        include: {
          warehouse: { select: { name: true } },
          linkedWarehouse: { select: { name: true } },
          creator: { select: { firstName: true, lastName: true } },
          authorizer: { select: { firstName: true, lastName: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: {
              product: { select: { sku: true, name: true, baseUnit: true } },
              presentation: { select: { name: true, factor: true } },
            },
          },
          movements: {
            orderBy: { seq: "asc" },
            include: {
              product: { select: { sku: true, name: true, baseUnit: true } },
              presentation: { select: { name: true, factor: true } },
              lot: { select: { lotCode: true, expiresAt: true } },
            },
          },
        },
      });
      if (document === null) {
        throw new NotFoundException({ message: "inventory.document_not_found" });
      }
      // Un borrador no tiene PDF (Carlos, 2026-09-02): lo que se imprime es lo
      // que pasó, y un borrador todavía no pasó. La marca de agua «BORRADOR» no
      // alcanzaba — el papel igual circulaba.
      if (document.status === "draft") {
        throw new ConflictException({ message: draftMessage });
      }

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { name: true, legalName: true, taxId: true, timezone: true, currency: true },
      });

      const nombre = (p: { firstName: string; lastName: string } | null) =>
        p === null ? null : shortName(p);

      const rows = pdfRowsFor(document);

      return {
        folio: document.folio,
        input: {
          tenant,
          document: {
            folio: document.folio,
            type: document.type as InventoryDocumentType,
            status: document.status,
            warehouseName: document.warehouse.name,
            linkedWarehouseName: document.linkedWarehouse?.name ?? null,
            reasonCode: document.reasonCode,
            reference: document.reference,
            reasonNote: document.reasonNote,
            createdAt: document.createdAt,
            confirmedAt: document.confirmedAt,
            canceledAt: document.canceledAt,
            createdByName: nombre(document.creator) ?? "",
            authorizedByName: nombre(document.authorizer),
          },
          rows,
          // El idioma de quien PIDIÓ el PDF, no el del tenant: dos personas del
          // mismo negocio pueden trabajar en idiomas distintos. La MONEDA sí es
          // del negocio: el costo se pagó en una sola, la lea quien la lea.
          locale: user.locale,
          currency: tenant.currency as Currency,
        },
      };
    });
  }
}
