import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import type { InventoryDocumentType } from "@sellpoint/shared";
import {
  parseSpreadsheet,
  type SpreadsheetFormat,
  serializeSpreadsheet,
} from "../../common/spreadsheet/spreadsheet";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { DocumentsService } from "./documents.service";

/** 5 MB de contenido REAL (en base64 pesa ~33% más — se mide decodificado). */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Las columnas de cada tipo. Se escriben en español porque es COPY: lo lee una
 * persona en Excel, no una máquina (LEY de idioma: lo que lee una persona va
 * en su idioma, los identificadores en inglés).
 */
const COLUMNS: Record<InventoryDocumentType, string[]> = {
  entry: ["sku", "presentacion", "cantidad", "costo_unitario", "lote", "caducidad", "ubicacion"],
  // Una salida no tiene precio de compra.
  exit: ["sku", "presentacion", "cantidad", "lote", "caducidad", "ubicacion"],
  physical_count: ["sku", "lote", "caducidad", "ubicacion", "contado"],
};

const EXAMPLE: Record<InventoryDocumentType, string[]> = {
  entry: ["PAR-500", "Caja ×12", "3", "15.50", "st10", "2026-07-01", "A-3"],
  exit: ["PAR-500", "Caja ×12", "1", "st10", "2026-07-01", "A-3"],
  physical_count: ["PAR-500", "st10", "2026-07-01", "A-3", "9"],
};

export interface ImportedRow {
  row: number;
  productId: string | null;
  sku: string;
  presentationId: string | null;
  quantity: number | null;
  unitCost: number | null;
  lotCode: string | null;
  expiresAt: string | null;
  location: string | null;
  counted: number | null;
  error: string | null;
}

/**
 * F3-DOC-05 — cargar las líneas de un borrador desde una planilla.
 *
 * ── La decisión que define esta clase ───────────────────────────────────
 *
 * **Las filas con error igual entran como líneas**, con su problema anotado.
 * El import de productos de F2 hace lo contrario (rechaza el archivo o pide
 * `skipErrors`), y acá no sirve: el destino es un BORRADOR, que existe
 * justamente para corregirse en pantalla. Devolverle a alguien un archivo de
 * 200 filas porque tres tienen el sku mal escrito lo obliga a editar en Excel
 * y volver a subir, cuando podría arreglarlo en la fila que ya está viendo.
 */
@Injectable()
export class DocumentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  /** La plantilla vacía con una fila de ejemplo, para que se entienda el formato. */
  async template(
    type: InventoryDocumentType,
    format: SpreadsheetFormat,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const file = await serializeSpreadsheet([COLUMNS[type], EXAMPLE[type]], format);
    return { ...file, filename: `plantilla-${type}.${format}` };
  }

  async importLines(
    user: AuthUser,
    documentId: string,
    input: { file: string; format: SpreadsheetFormat; mode: "replace" | "append" },
  ): Promise<{ imported: number; withErrors: number; rows: ImportedRow[] }> {
    // Se mide el contenido REAL: en base64 un archivo pesa ~33% más y el
    // límite terminaría siendo otro del que dice ser.
    const bytes =
      input.format === "xlsx"
        ? Buffer.from(input.file, "base64").byteLength
        : Buffer.byteLength(input.file, "utf8");
    if (bytes > MAX_IMPORT_BYTES) {
      throw new PayloadTooLargeException({ message: "inventory.count_file_too_large" });
    }

    let rows: string[][];
    try {
      rows = await parseSpreadsheet(input.file, input.format);
    } catch {
      throw new BadRequestException({ message: "inventory.import_unreadable" });
    }
    if (rows.length < 2) {
      throw new BadRequestException({ message: "inventory.import_empty" });
    }

    const header = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const document = await this.documents.assertDraft(tx, user.tenantId, documentId);

      const skus = [...new Set(body.map((r) => (r[idx("sku")] ?? "").trim()).filter(Boolean))];
      const productos = await tx.product.findMany({
        where: { tenantId: user.tenantId, sku: { in: skus } },
        select: { id: true, sku: true },
      });
      const porSku = new Map(productos.map((p) => [p.sku.toLowerCase(), p.id]));

      const presentaciones = await tx.productPresentation.findMany({
        where: { tenantId: user.tenantId, productId: { in: [...porSku.values()] } },
        select: { id: true, productId: true, name: true },
      });

      const num = (raw: string | undefined): number | null => {
        const value = (raw ?? "").trim().replace(",", ".");
        if (value === "") {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const texto = (raw: string | undefined): string | null => {
        const value = (raw ?? "").trim();
        return value === "" ? null : value;
      };

      const parsed: ImportedRow[] = body.map((raw, index) => {
        // +2: la fila 1 es el encabezado y Excel cuenta desde 1 — el número
        // que se reporta tiene que ser el que la persona ve en su pantalla.
        const row = index + 2;
        const sku = (raw[idx("sku")] ?? "").trim();
        const productId = porSku.get(sku.toLowerCase()) ?? null;
        const nombrePresentacion = texto(raw[idx("presentacion")]);
        const presentationId =
          productId === null || nombrePresentacion === null
            ? null
            : (presentaciones.find(
                (p) =>
                  p.productId === productId &&
                  p.name.toLowerCase() === nombrePresentacion.toLowerCase(),
              )?.id ?? null);

        return {
          row,
          productId,
          sku,
          presentationId,
          quantity: num(raw[idx("cantidad")]),
          unitCost: num(raw[idx("costo_unitario")]),
          lotCode: texto(raw[idx("lote")]),
          expiresAt: texto(raw[idx("caducidad")]),
          location: texto(raw[idx("ubicacion")]),
          counted: num(raw[idx("contado")]),
          error:
            productId === null
              ? "inventory.product_not_found"
              : nombrePresentacion !== null && presentationId === null
                ? "inventory.presentation_invalid"
                : null,
        };
      });

      if (input.mode === "replace") {
        await tx.inventoryDocumentLine.deleteMany({ where: { documentId } });
      }
      const desde = await tx.inventoryDocumentLine.aggregate({
        where: { documentId },
        _max: { lineNo: true },
      });

      // Solo las filas que resolvieron producto se pueden guardar: una línea
      // sin `product_id` no cabe en la tabla. Las demás vuelven en la respuesta
      // marcadas, para que la pantalla las muestre y el usuario las corrija.
      const guardables = parsed.filter((r) => r.productId !== null);
      let lineNo = desde._max.lineNo ?? 0;
      await tx.inventoryDocumentLine.createMany({
        data: guardables.map((r) => ({
          tenantId: user.tenantId,
          documentId,
          lineNo: ++lineNo,
          productId: r.productId as string,
          presentationId: r.presentationId,
          quantity: document.type === "physical_count" ? null : r.quantity,
          unitCost: r.unitCost,
          lotCode: r.lotCode,
          expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
          location: r.location,
          counted: r.counted,
        })),
      });

      return {
        imported: guardables.length,
        withErrors: parsed.filter((r) => r.error !== null).length,
        rows: parsed,
      };
    });
  }
}
