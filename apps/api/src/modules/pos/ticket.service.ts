import { Injectable, NotFoundException } from "@nestjs/common";
import type { Currency } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { TicketSettingsService } from "../tenants/ticket-settings.service";
import {
  buildTicketDefinition,
  type TicketInput,
  type TicketRow,
  type TicketWidth,
} from "./ticket.renderer";
import { ticketHeaderContact } from "./ticket-header";

/**
 * Las Type1 que trae pdfkit: sin archivos de fuente que empaquetar en la
 * imagen. Mismo criterio que `DocumentPdfService` — un ticket no necesita
 * tipografía de marca.
 */
const FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

/**
 * F4-TICKET-01 — el binario del ticket.
 *
 * Separado del renderer por el mismo motivo que en F3: la plantilla es una
 * función PURA que se testea leyendo qué dice el papel, y acá vive lo que no
 * se puede testear así — el printer, los bytes y la consulta.
 */
/**
 * Qué dice el renglón (F4-CONCEPT-07).
 *
 * La `description` de la cotización gana: es lo que decía el papel que el
 * cliente se llevó, aunque el producto haya cambiado de nombre después. La
 * venta no la tiene y cae al nombre vigente del catálogo… salvo el concepto,
 * que no tiene catálogo: su texto vive en la fila (`concept_description`).
 */
export function descripcionDeFila(
  line: { description?: string; conceptDescription?: string | null },
  producto: { name: string } | undefined,
  servicio: { name: string } | undefined,
): string {
  return line.description ?? line.conceptDescription ?? producto?.name ?? servicio?.name ?? "";
}

@Injectable()
export class TicketService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketSettings: TicketSettingsService,
  ) {}

  async saleTicket(
    user: AuthUser,
    saleId: string,
    width: TicketWidth,
    t: (key: string) => string,
  ): Promise<{ body: Buffer; filename: string }> {
    const input = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const venta = await tx.sale.findFirst({
        where: { id: saleId, tenantId: user.tenantId },
        include: {
          items: { orderBy: { lineNo: "asc" } },
          warehouse: { select: { name: true, address: true, phone: true } },
          seller: { select: { firstName: true, lastNamePaternal: true } },
        },
      });
      if (venta === null) {
        throw new NotFoundException({ message: "pos.sale_not_found" });
      }

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          address: true,
          phone: true,
          currency: true,
        },
      });

      // ── El LOTE que salió, del ledger ─────────────────────────────────
      //
      // De `stock_movements` y no de la línea: el reparto FEFO lo hizo el
      // servidor y la línea no lo sabe. Es el mismo criterio que usa la
      // anulación — los movimientos son lo que REALMENTE pasó.
      const movimientos = await tx.stockMovement.findMany({
        where: { saleId, tenantId: user.tenantId, lotId: { not: null } },
        select: { productId: true, lot: { select: { lotCode: true } } },
      });
      const lotePorProducto = new Map(
        movimientos.filter((m) => m.lot !== null).map((m) => [m.productId, m.lot?.lotCode ?? null]),
      );

      const rows = await this.filasDe(tx, user.tenantId, venta.items, lotePorProducto);
      // Qué se imprime y el logotipo, en la MISMA transacción (F4-TICKETCFG-05).
      const { settings, logo } = await this.ticketSettings.leer(tx, user.tenantId);

      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          taxId: tenant.taxId,
        },
        // El contacto del ALMACÉN con fallback al negocio (2026-08-26): la
        // regla vive en ticketHeaderContact, el renderer solo pinta.
        header: ticketHeaderContact(tenant, venta.warehouse),
        kind: "sale" as const,
        folio: venta.folio,
        barcode: venta.barcode,
        createdAt: venta.createdAt,
        sellerName: `${venta.seller.firstName} ${venta.seller.lastNamePaternal}`.trim(),
        warehouseName: venta.warehouse.name,
        rows,
        subtotal: venta.subtotal.toString(),
        discount: venta.discount.toString(),
        total: venta.total.toString(),
        paymentMethod: venta.paymentMethod,
        // El recibido y el vuelto los sabe la PANTALLA, no la base: el sistema
        // registra qué se cobró, no con qué billete se pagó. Se dejan en null
        // y el ticket omite las dos líneas.
        received: null,
        change: null,
        note: null,
        currency: tenant.currency as Currency,
        locale: user.locale,
        width,
        settings,
        logo,
      } satisfies TicketInput;
    });

    return { body: await this.aBinario(input, t), filename: `${input.folio}.pdf` };
  }

  async quoteTicket(
    user: AuthUser,
    quoteId: string,
    width: TicketWidth,
    t: (key: string) => string,
  ): Promise<{ body: Buffer; filename: string }> {
    const input = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const cotizacion = await tx.quote.findFirst({
        where: { id: quoteId, tenantId: user.tenantId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          warehouse: { select: { name: true, address: true, phone: true } },
          author: { select: { firstName: true, lastNamePaternal: true } },
        },
      });
      if (cotizacion === null) {
        throw new NotFoundException({ message: "pos.quote_not_found" });
      }

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          address: true,
          phone: true,
          currency: true,
        },
      });

      // Una cotización NO tiene lotes: no movió stock, así que no hay reparto
      // FEFO que contar.
      const rows = await this.filasDe(tx, user.tenantId, cotizacion.lines, new Map());
      const { settings, logo } = await this.ticketSettings.leer(tx, user.tenantId);

      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          taxId: tenant.taxId,
        },
        header: ticketHeaderContact(tenant, cotizacion.warehouse),
        kind: "quote" as const,
        folio: cotizacion.folio,
        createdAt: cotizacion.createdAt,
        sellerName: `${cotizacion.author.firstName} ${cotizacion.author.lastNamePaternal}`.trim(),
        warehouseName: cotizacion.warehouse.name,
        rows,
        subtotal: cotizacion.total.toString(),
        discount: "0",
        total: cotizacion.total.toString(),
        paymentMethod: null,
        received: null,
        change: null,
        note: cotizacion.note,
        currency: tenant.currency as Currency,
        locale: user.locale,
        width,
        settings,
        logo,
      } satisfies TicketInput;
    });

    return { body: await this.aBinario(input, t), filename: `${input.folio}.pdf` };
  }

  /**
   * Las líneas → filas del ticket.
   *
   * Sirve a la venta y a la cotización porque `sale_items` y `quote_lines`
   * tienen el MISMO shape a propósito (ver `QuoteLine`): es lo que hace que
   * imprimir las dos sea una función y no dos.
   */
  private async filasDe(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
    lines: {
      productId: string | null;
      serviceId: string | null;
      presentationId: string | null;
      quantity: { toString(): string };
      unitPrice: { toString(): string };
      lineTotal: { toString(): string };
      description?: string;
      /** F4-CONCEPT-07: el texto del concepto vive en la fila de la venta. */
      conceptDescription?: string | null;
    }[],
    lotePorProducto: Map<string, string | null>,
  ): Promise<TicketRow[]> {
    const productIds = lines.map((l) => l.productId).filter((id): id is string => id !== null);
    const productos =
      productIds.length === 0
        ? []
        : await tx.product.findMany({
            where: { id: { in: productIds }, tenantId },
            select: { id: true, name: true, baseUnit: true },
          });
    const porId = new Map(productos.map((p) => [p.id, p]));

    const serviceIds = lines.map((l) => l.serviceId).filter((id): id is string => id !== null);
    const servicios =
      serviceIds.length === 0
        ? []
        : await tx.service.findMany({
            where: { id: { in: serviceIds }, tenantId },
            select: { id: true, name: true },
          });
    const servicioPorId = new Map(servicios.map((s) => [s.id, s]));

    return lines.map((line) => {
      const producto = line.productId === null ? undefined : porId.get(line.productId);
      const servicio = line.serviceId === null ? undefined : servicioPorId.get(line.serviceId);

      return {
        // La `description` de la cotización gana: es lo que decía el papel que
        // el cliente se llevó, aunque el producto haya cambiado de nombre
        // después. La venta no la tiene y cae al nombre vigente.
        description: descripcionDeFila(line, producto, servicio),
        quantity: line.quantity.toString(),
        // Un servicio no sale del anaquel: sin unidad base.
        baseUnit: producto?.baseUnit ?? null,
        unitPrice: line.unitPrice.toString(),
        lineTotal: line.lineTotal.toString(),
        lotCode: line.productId === null ? null : (lotePorProducto.get(line.productId) ?? null),
      };
    });
  }

  private async aBinario(input: TicketInput, t: (key: string) => string): Promise<Buffer> {
    const definition = buildTicketDefinition(input, t) as unknown as TDocumentDefinitions;
    const pdf = this.printer.createPdfKitDocument(definition);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    });
  }
}
