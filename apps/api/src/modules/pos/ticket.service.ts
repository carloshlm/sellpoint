import { Injectable, NotFoundException } from "@nestjs/common";
import type { Currency, TaxMode } from "@sellpoint/shared";
import { shortName } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { Prisma } from "../../generated/prisma/client";
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
import { distinctTaxGroupCodes, type TaxMark, taxMarksFor } from "./ticket-tax-marks";

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
          taxes: { orderBy: { sortOrder: "asc" } },
          warehouse: {
            select: {
              name: true,
              address: true,
              addressLine2: true,
              city: true,
              region: true,
              postalCode: true,
              phone: true,
            },
          },
          seller: { select: { firstName: true, lastName: true } },
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
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          country: true,
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

      const rows = await this.filasDe(
        tx,
        user.tenantId,
        venta.items,
        lotePorProducto,
        venta.taxMode as TaxMode,
      );
      // Qué se imprime y el logotipo, en la MISMA transacción (F4-TICKETCFG-05).
      const { settings, logo } = await this.ticketSettings.leer(tx, user.tenantId);

      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          taxId: tenant.taxId,
          country: tenant.country,
        },
        // El contacto del ALMACÉN con fallback al negocio (2026-08-26): la
        // regla vive en ticketHeaderContact, el renderer solo pinta.
        header: ticketHeaderContact(tenant, venta.warehouse, tenant.country),
        kind: "sale" as const,
        folio: venta.folio,
        barcode: venta.barcode,
        createdAt: venta.createdAt,
        sellerName: shortName(venta.seller),
        warehouseName: venta.warehouse.name,
        rows,
        subtotal: venta.subtotal.toString(),
        discount: venta.discount.toString(),
        total: venta.total.toString(),
        // F4-TAX-13: el desglose viene del snapshot de la venta, nunca del
        // catálogo de hoy: el papel reimpreso dice lo que dijo aquel día.
        taxMode: venta.taxMode as TaxMode,
        taxBase: venta.total.minus(venta.taxTotal).toString(),
        taxes: venta.taxes.map((x) => ({
          name: x.name,
          rate: x.rate.toString(),
          amount: x.amount.toString(),
        })),
        taxMarks: await this.marcasDe(tx, user.tenantId, venta.items, venta.taxes),
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
          taxes: { orderBy: { sortOrder: "asc" } },
          warehouse: {
            select: {
              name: true,
              address: true,
              addressLine2: true,
              city: true,
              region: true,
              postalCode: true,
              phone: true,
            },
          },
          author: { select: { firstName: true, lastName: true } },
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
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          country: true,
          phone: true,
          currency: true,
        },
      });

      // Una cotización NO tiene lotes: no movió stock, así que no hay reparto
      // FEFO que contar.
      const rows = await this.filasDe(
        tx,
        user.tenantId,
        cotizacion.lines,
        new Map(),
        cotizacion.taxMode as TaxMode,
      );
      const { settings, logo } = await this.ticketSettings.leer(tx, user.tenantId);

      return {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          taxId: tenant.taxId,
          country: tenant.country,
        },
        header: ticketHeaderContact(tenant, cotizacion.warehouse, tenant.country),
        kind: "quote" as const,
        folio: cotizacion.folio,
        createdAt: cotizacion.createdAt,
        sellerName: shortName(cotizacion.author),
        warehouseName: cotizacion.warehouse.name,
        rows,
        subtotal: cotizacion.total.toString(),
        discount: "0",
        total: cotizacion.total.toString(),
        taxMode: cotizacion.taxMode as TaxMode,
        taxBase: cotizacion.total.minus(cotizacion.taxTotal).toString(),
        taxes: cotizacion.taxes.map((x) => ({
          name: x.name,
          rate: x.rate.toString(),
          amount: x.amount.toString(),
        })),
        taxMarks: await this.marcasDe(tx, user.tenantId, cotizacion.lines, cotizacion.taxes),
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
      /** F4-TAX-13: en `excluded` la fila se imprime SIN el impuesto (CRA). */
      taxAmount: { toString(): string };
      /** F4-TAXMARK: el grupo de la línea (snapshot); la llave de su letra. */
      taxGroupCode: string | null;
      description?: string;
      /** F4-CONCEPT-07: el texto del concepto vive en la fila de la venta. */
      conceptDescription?: string | null;
    }[],
    lotePorProducto: Map<string, string | null>,
    mode: TaxMode,
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

    // La presentación vendida, para que la fila diga «1 Bolsa 10Kg (10.000
    // kilogramos)» y no la cantidad en bolsas con la unidad de kilos.
    const presentationIds = lines
      .map((l) => l.presentationId)
      .filter((id): id is string => id !== null);
    const presentaciones =
      presentationIds.length === 0
        ? []
        : await tx.productPresentation.findMany({
            where: { id: { in: presentationIds }, tenantId },
            select: { id: true, name: true, factor: true },
          });
    const presentacionPorId = new Map(presentaciones.map((p) => [p.id, p]));

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
      const presentacion =
        line.presentationId === null ? undefined : presentacionPorId.get(line.presentationId);

      return {
        // La `description` de la cotización gana: es lo que decía el papel que
        // el cliente se llevó, aunque el producto haya cambiado de nombre
        // después. La venta no la tiene y cae al nombre vigente.
        description: descripcionDeFila(line, producto, servicio),
        quantity: line.quantity.toString(),
        // Un servicio no sale del anaquel: sin unidad base.
        baseUnit: producto?.baseUnit ?? null,
        presentation:
          presentacion === undefined
            ? null
            : { name: presentacion.name, factor: presentacion.factor.toString() },
        unitPrice: line.unitPrice.toString(),
        // La fila imprime precio × cantidad A PRECIO DE LISTA (Carlos,
        // 2026-09-09): `line_total` ya trae restada la parte prorrateada del
        // descuento del ticket, y pintarlo hacía que las líneas sumaran el
        // total final y abajo apareciera «Descuento» otra vez. El descuento
        // sale UNA vez, en el pie. El recibo canadiense sigue a precio NETO
        // y el mexicano a precio final (LFPC): eso lo decide `unit_price`,
        // no esta resta. Misma aritmética que `armarTotales` (bruto).
        lineTotal: new Prisma.Decimal(line.unitPrice.toString())
          .times(new Prisma.Decimal(line.quantity.toString()))
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toString(),
        lotCode: line.productId === null ? null : (lotePorProducto.get(line.productId) ?? null),
        taxGroupCode: line.taxGroupCode,
      };
    });
  }

  /**
   * F4-TAXMARK-02 — las marcas de impuesto del ticket. Solo cuando las líneas
   * traen dos o más grupos distintos y hay impuestos: con uno no se consulta
   * nada y el papel no cambia. El nombre del grupo se lee del catálogo
   * VIGENTE, como el nombre del producto en la fila (deriva aceptada: un
   * grupo renombrado reimprime la leyenda nueva); un código que ya no existe
   * entra con su código como nombre: la marca no desaparece porque el grupo
   * se borró.
   */
  private async marcasDe(
    tx: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
    tenantId: string,
    lines: { taxGroupCode: string | null }[],
    taxes: unknown[],
  ): Promise<TaxMark[]> {
    const codigos = distinctTaxGroupCodes(lines);
    if (taxes.length === 0 || codigos.length < 2) {
      return [];
    }
    const grupos = await tx.taxGroup.findMany({
      where: { tenantId, code: { in: codigos } },
      select: { code: true, name: true },
    });
    const nombre = new Map(grupos.map((g) => [g.code, g.name]));
    return taxMarksFor(codigos.map((code) => ({ code, name: nombre.get(code) ?? code })));
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
