import {
  type Currency,
  currencyName,
  formatAmount,
  formatQuantity,
  type Locale,
  localeToBcp47,
  taxIdLabel,
} from "@sellpoint/shared";
import {
  encabezadoNegocio,
  GRIS,
  type PdfTenant,
  type Translate,
} from "../medical-clinic/medical-pdf-blocks";

export interface PdfPurchaseOrderLine {
  lineNo: number;
  sku: string;
  description: string;
  presentationName: string | null;
  quantityOrdered: string;
  unitCost: string | null;
  discount: string;
  taxAmount: string;
  lineTotal: string;
}

export interface PdfPurchaseOrderInput {
  tenant: PdfTenant & { country: string | null; currency: Currency };
  order: {
    folio: string;
    status: string;
    supplierName: string;
    supplierTaxId: string | null;
    warehouseName: string;
    orderDate: string;
    expectedDate: string | null;
    supplierReference: string | null;
    paymentTerms: string | null;
    taxMode: string;
    subtotal: string;
    discount: string;
    taxTotal: string;
    total: string;
    notes: string | null;
  };
  lines: PdfPurchaseOrderLine[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  locale: Locale;
}

/**
 * F9-PO-06 — el PAPEL de la orden: el que se manda al proveedor.
 *
 * Es un COMPROMISO, no una factura: los impuestos y el total van marcados
 * como ESTIMADOS, y el pie pide lo que la práctica de Estados Unidos y
 * Canadá exige y la de México agradece — que el número de orden venga en la
 * factura y en la remisión («no PO, no pay»). Sin ese número, cuentas por
 * pagar no sabe contra qué cotejar lo que llega.
 *
 * Importes sin símbolo y «Moneda: …» al pie, como todos los papeles del
 * sistema. Cerrada o anulada llevan marca de agua: el proveedor que reciba
 * una copia vieja tiene que ver que ya no está viva.
 */
export function buildPurchaseOrderDefinition(input: PdfPurchaseOrderInput, t: Translate) {
  const { tenant, order, lines, taxes, locale } = input;
  const bcp47 = localeToBcp47(locale);
  const dinero = (valor: string) => formatAmount(Number(valor), locale);
  const etiquetaFiscal = taxIdLabel(tenant.country) ?? t("pdf.purchaseOrder.taxId");
  const marcaDeAgua =
    order.status === "canceled"
      ? t("pdf.purchaseOrder.canceled")
      : order.status === "closed"
        ? t("pdf.purchaseOrder.closed")
        : null;

  const encabezadoTabla = [
    "#",
    t("pdf.sku"),
    t("pdf.product"),
    t("pdf.presentation"),
    t("pdf.quantity"),
    t("pdf.purchaseOrder.unitCost"),
    t("pdf.purchaseOrder.discount"),
    t("pdf.purchaseOrder.tax"),
    t("pdf.purchaseOrder.amount"),
  ];
  const cuerpo = lines.map((line) => [
    String(line.lineNo),
    line.sku,
    line.description,
    line.presentationName ?? "",
    formatQuantity(line.quantityOrdered, ""),
    line.unitCost === null ? "" : dinero(line.unitCost),
    Number(line.discount) > 0 ? `-${dinero(line.discount)}` : "",
    dinero(line.taxAmount),
    dinero(line.lineTotal),
  ]);

  const totales: [string, string][] = [
    [t("pdf.purchaseOrder.subtotal"), dinero(order.subtotal)],
    ...(Number(order.discount) > 0
      ? ([[t("pdf.purchaseOrder.discount"), `-${dinero(order.discount)}`]] as [string, string][])
      : []),
    ...taxes.map(
      (tax) =>
        [
          `${tax.name} (${tax.rate}%) · ${t("pdf.purchaseOrder.estimated")}`,
          dinero(tax.amount),
        ] as [string, string],
    ),
    [t("pdf.purchaseOrder.total"), dinero(order.total)],
  ];

  return {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 60],
    ...(marcaDeAgua !== null && {
      watermark: { text: marcaDeAgua, color: "red", opacity: 0.2, bold: true },
    }),
    content: [
      encabezadoNegocio(tenant, t),
      {
        text: `${t("pdf.purchaseOrder.title")} ${order.folio}`,
        style: "titulo",
        margin: [0, 10, 0, 6],
      },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: t("pdf.purchaseOrder.supplier"), style: "etiqueta" },
              { text: order.supplierName },
              ...(order.supplierTaxId !== null
                ? [{ text: `${etiquetaFiscal}: ${order.supplierTaxId}`, style: "gris" }]
                : []),
              ...(order.supplierReference !== null
                ? [{ text: `${t("pdf.purchaseOrder.reference")}: ${order.supplierReference}` }]
                : []),
            ],
          },
          {
            width: "50%",
            stack: [
              { text: `${t("pdf.purchaseOrder.date")}: ${order.orderDate}` },
              ...(order.expectedDate !== null
                ? [{ text: `${t("pdf.purchaseOrder.expectedDate")}: ${order.expectedDate}` }]
                : []),
              { text: `${t("pdf.purchaseOrder.shipTo")}: ${order.warehouseName}` },
              ...(order.paymentTerms !== null
                ? [{ text: `${t("pdf.purchaseOrder.terms")}: ${order.paymentTerms}` }]
                : []),
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: [14, "auto", "*", "auto", "auto", "auto", "auto", "auto", "auto"],
          body: [encabezadoTabla, ...cuerpo],
        },
        layout: "lightHorizontalLines",
        fontSize: 8,
      },
      {
        table: {
          widths: ["*", "auto"],
          body: totales.map(([etiqueta, valor]) => [
            { text: etiqueta, alignment: "right" },
            { text: valor, alignment: "right" },
          ]),
        },
        layout: "noBorders",
        margin: [0, 10, 0, 0],
        fontSize: 9,
      },
      ...(order.notes !== null
        ? [
            {
              text: `${t("pdf.purchaseOrder.notes")}: ${order.notes}`,
              margin: [0, 10, 0, 0] as [number, number, number, number],
              fontSize: 9,
            },
          ]
        : []),
      // El pie que hace que la factura del proveedor se pueda cotejar. El
      // `{folio}` se interpola acá y no en i18n: `t` de este papel no recibe args.
      {
        text: t("pdf.purchaseOrder.footer").replace("{folio}", order.folio),
        bold: true,
        margin: [0, 14, 0, 0],
        fontSize: 9,
      },
      {
        text: `${t("pdf.currency")}: ${currencyName(tenant.currency, locale)} (${tenant.currency})`,
        style: "gris",
        margin: [0, 10, 0, 0],
      },
      {
        text: t(
          order.taxMode === "included"
            ? "pdf.purchaseOrder.taxIncluded"
            : "pdf.purchaseOrder.taxExcluded",
        ),
        style: "gris",
      },
    ],
    styles: {
      titulo: { fontSize: 14, bold: true },
      etiqueta: { fontSize: 9, bold: true },
      gris: { fontSize: 8, color: GRIS },
    },
    defaultStyle: { fontSize: 10 },
    language: bcp47,
  };
}
