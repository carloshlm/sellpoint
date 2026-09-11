import { ConflictException, Injectable } from "@nestjs/common";
import type { Currency, Locale } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { FONTS } from "../medical-clinic/medical-pdf-blocks";
import { buildPurchaseDefinition } from "./purchase-pdf.renderer";
import { PurchasesService } from "./purchases.service";

/**
 * F9-PURCH-09 — el papel de la compra, en PDF.
 *
 * Un BORRADOR no tiene papel: lo que se archiva junto a la factura del
 * proveedor es un documento sellado, y un borrador cambia con cada tecla.
 */
@Injectable()
export class PurchasePdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
  ) {}

  async build(
    user: AuthUser,
    purchaseId: string,
    t: (key: string) => string,
  ): Promise<{ body: Buffer; filename: string }> {
    const { definition, folio } = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const compra = await this.purchases.buscar(tx, user.tenantId, purchaseId);
      if (compra.status === "draft") {
        throw new ConflictException({ message: "purchases.draft_has_no_document" });
      }
      const [tenant, proveedor, entrada] = await Promise.all([
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
          where: { id: compra.supplierId },
          select: { name: true, taxId: true },
        }),
        this.purchases.entradaViva(tx, user.tenantId, purchaseId),
      ]);

      const fecha = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
      return {
        folio: compra.folio,
        definition: buildPurchaseDefinition(
          {
            // El papel de la compra SIEMPRE identifica al negocio: no es un
            // ticket de mostrador con interruptores, es un documento que se
            // archiva junto a la factura del proveedor.
            tenant: {
              ...tenant,
              currency: tenant.currency as Currency,
              showBusinessName: true,
              showAddress: true,
              showPhone: true,
            },
            purchase: {
              folio: compra.folio,
              status: compra.status,
              supplierName: proveedor.name,
              supplierTaxId: proveedor.taxId,
              warehouseName: compra.warehouse.name,
              purchaseDate: fecha(compra.purchaseDate) as string,
              receivedDate: fecha(compra.receivedDate),
              supplierInvoice: compra.supplierInvoice,
              taxMode: compra.taxMode,
              subtotal: compra.subtotal.toString(),
              discount: compra.discount.toString(),
              taxTotal: compra.taxTotal.toString(),
              extraChargesTotal: compra.extraChargesTotal.toString(),
              total: compra.total.toString(),
              declaredTotal: compra.declaredTotal?.toString() ?? null,
              notes: compra.notes,
              entryFolio: entrada?.folio ?? null,
              orderFolio: compra.purchaseOrder?.folio ?? null,
              receiptFolios: compra.receipts.map((r) => r.folio),
            },
            lines: compra.lines.map((l) => ({
              lineNo: l.lineNo,
              sku: l.product.sku,
              description: l.description,
              presentationName: l.presentation?.name ?? null,
              quantity: l.quantity?.toString() ?? null,
              unitCost: l.unitCost?.toString() ?? null,
              discount: l.discount.toString(),
              taxAmount: l.taxAmount.toString(),
              lineTotal: l.lineTotal.toString(),
              lotCode: l.lotCode,
              expiresAt: fecha(l.expiresAt),
              orderedUnitCost: l.purchaseOrderLine?.unitCost?.toString() ?? null,
            })),
            charges: compra.charges.map((c) => ({
              description: c.description,
              amount: c.amount.toString(),
              taxAmount: c.taxAmount.toString(),
              lineTotal: c.lineTotal.toString(),
            })),
            taxes: compra.taxes.map((tax) => ({
              code: tax.code,
              name: tax.name,
              rate: tax.rate.toString(),
              base: tax.base.toString(),
              amount: tax.amount.toString(),
            })),
            // El idioma de quien PIDIÓ el papel, no el del negocio: dos
            // personas del mismo equipo pueden leerlo en idiomas distintos.
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
