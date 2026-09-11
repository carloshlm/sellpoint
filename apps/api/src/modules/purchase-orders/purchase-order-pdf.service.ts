import { ConflictException, Injectable } from "@nestjs/common";
import type { Currency, Locale } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { FONTS } from "../medical-clinic/medical-pdf-blocks";
import { buildPurchaseOrderDefinition } from "./purchase-order-pdf.renderer";
import { PurchaseOrdersService } from "./purchase-orders.service";

/**
 * F9-PO-06 — la orden en PDF, la que se manda al proveedor. Un BORRADOR no
 * se manda: cambia con cada tecla y todavía no es un compromiso.
 */
@Injectable()
export class PurchaseOrderPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  async build(
    user: AuthUser,
    orderId: string,
    t: (key: string) => string,
  ): Promise<{ body: Buffer; filename: string }> {
    const { definition, folio } = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.orders.buscar(tx, user.tenantId, orderId);
      if (orden.status === "draft") {
        throw new ConflictException({ message: "purchase_orders.draft_has_no_document" });
      }
      const [tenant, proveedor] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
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
            timezone: true,
          },
        }),
        tx.supplier.findUniqueOrThrow({
          where: { id: orden.supplierId },
          select: { name: true, taxId: true },
        }),
      ]);
      const fecha = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
      return {
        folio: orden.folio,
        definition: buildPurchaseOrderDefinition(
          {
            tenant: {
              ...tenant,
              currency: tenant.currency as Currency,
              showBusinessName: true,
              showAddress: true,
              showPhone: true,
            },
            order: {
              folio: orden.folio,
              status: orden.status,
              supplierName: proveedor.name,
              supplierTaxId: proveedor.taxId,
              warehouseName: orden.warehouse.name,
              orderDate: fecha(orden.orderDate) as string,
              expectedDate: fecha(orden.expectedDate),
              supplierReference: orden.supplierReference,
              paymentTerms: orden.paymentTerms,
              taxMode: orden.taxMode,
              subtotal: orden.subtotal.toString(),
              discount: orden.discount.toString(),
              taxTotal: orden.taxTotal.toString(),
              total: orden.total.toString(),
              notes: orden.notes,
            },
            lines: orden.lines.map((l) => ({
              lineNo: l.lineNo,
              sku: l.product.sku,
              description: l.description,
              presentationName: l.presentation?.name ?? null,
              quantityOrdered: l.quantityOrdered.toString(),
              unitCost: l.unitCost?.toString() ?? null,
              discount: l.discount.toString(),
              taxAmount: l.taxAmount.toString(),
              lineTotal: l.lineTotal.toString(),
            })),
            taxes: orden.taxes.map((tax) => ({
              code: tax.code,
              name: tax.name,
              rate: tax.rate.toString(),
              base: tax.base.toString(),
              amount: tax.amount.toString(),
            })),
            locale: user.locale as Locale,
          },
          t,
        ),
      };
    });

    const pdf = this.printer.createPdfKitDocument(definition as unknown as TDocumentDefinitions);
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    });
    return { body, filename: `${folio}.pdf` };
  }
}
