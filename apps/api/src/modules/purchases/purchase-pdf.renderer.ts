import {
  type Currency,
  currencyName,
  formatAmount,
  formatQuantity,
  type Locale,
  localeToBcp47,
  taxIdLabel,
  totalMismatch,
} from "@sellpoint/shared";
import {
  encabezadoNegocio,
  GRIS,
  type PdfTenant,
  type Translate,
} from "../medical-clinic/medical-pdf-blocks";

export interface PdfPurchaseLine {
  lineNo: number;
  sku: string;
  description: string;
  presentationName: string | null;
  quantity: string | null;
  unitCost: string | null;
  discount: string;
  taxAmount: string;
  lineTotal: string;
  lotCode: string | null;
  expiresAt: string | null;
}

export interface PdfPurchaseCharge {
  description: string;
  amount: string;
  taxAmount: string;
  lineTotal: string;
}

export interface PdfPurchaseInput {
  tenant: PdfTenant & { country: string | null; currency: Currency };
  purchase: {
    folio: string;
    status: string;
    supplierName: string;
    supplierTaxId: string | null;
    warehouseName: string;
    purchaseDate: string;
    receivedDate: string | null;
    supplierInvoice: string | null;
    taxMode: string;
    subtotal: string;
    discount: string;
    taxTotal: string;
    extraChargesTotal: string;
    total: string;
    declaredTotal: string | null;
    notes: string | null;
    /** El folio de la entrada de inventario que nació de esta compra, si existe. */
    entryFolio: string | null;
  };
  lines: PdfPurchaseLine[];
  charges: PdfPurchaseCharge[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  locale: Locale;
}

/**
 * F9-PURCH-09 — el PAPEL de la compra: lo que el negocio archiva junto a la
 * factura del proveedor.
 *
 * Los importes van SIN símbolo de moneda y con una línea «Moneda: …» al pie,
 * como el resto de los papeles del sistema: un «$» significa cosas distintas
 * en México y en Canadá, y el papel se archiva y se manda por correo.
 *
 * El DESCUADRE contra el total declarado se imprime cuando existe. No es una
 * advertencia decorativa: quien archiva el papel tiene que poder ver, meses
 * después, que lo capturado no coincidía con lo que decía la factura — y
 * cuánto. Nunca se ajustaron las líneas para taparlo.
 */
export function buildPurchaseDefinition(input: PdfPurchaseInput, t: Translate) {
  const { tenant, purchase, lines, charges, taxes, locale } = input;
  const bcp47 = localeToBcp47(locale);
  const dinero = (valor: string) => formatAmount(Number(valor), locale);
  const anulada = purchase.status === "canceled";
  const { mismatch, difference } = totalMismatch(purchase.declaredTotal, purchase.total);
  const etiquetaFiscal = taxIdLabel(tenant.country) ?? t("pdf.purchase.taxId");
  const conLotes = lines.some((l) => l.lotCode !== null);

  const encabezadoTabla = [
    "#",
    t("pdf.sku"),
    t("pdf.product"),
    t("pdf.presentation"),
    t("pdf.quantity"),
    t("pdf.purchase.unitCost"),
    t("pdf.purchase.discount"),
    t("pdf.purchase.tax"),
    t("pdf.purchase.amount"),
    ...(conLotes ? [t("pdf.lot"), t("pdf.purchase.expiresAt")] : []),
  ];

  const cuerpo = lines.map((line) => [
    String(line.lineNo),
    line.sku,
    line.description,
    line.presentationName ?? "",
    line.quantity === null ? "" : formatQuantity(line.quantity, ""),
    line.unitCost === null ? "" : dinero(line.unitCost),
    Number(line.discount) > 0 ? `-${dinero(line.discount)}` : "",
    dinero(line.taxAmount),
    dinero(line.lineTotal),
    ...(conLotes ? [line.lotCode ?? "", line.expiresAt ?? ""] : []),
  ]);

  const totales: [string, string][] = [
    [t("pdf.purchase.subtotal"), dinero(purchase.subtotal)],
    ...(Number(purchase.discount) > 0
      ? ([[t("pdf.purchase.discount"), `-${dinero(purchase.discount)}`]] as [string, string][])
      : []),
    ...taxes.map((tax) => [`${tax.name} (${tax.rate}%)`, dinero(tax.amount)] as [string, string]),
    ...(Number(purchase.extraChargesTotal) > 0
      ? ([[t("pdf.purchase.charges"), dinero(purchase.extraChargesTotal)]] as [string, string][])
      : []),
    [t("pdf.purchase.total"), dinero(purchase.total)],
    ...(purchase.declaredTotal !== null
      ? ([[t("pdf.purchase.declaredTotal"), dinero(purchase.declaredTotal)]] as [string, string][])
      : []),
  ];

  return {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 60],
    ...(anulada && {
      watermark: { text: t("pdf.purchase.canceled"), color: "red", opacity: 0.2, bold: true },
    }),
    content: [
      encabezadoNegocio(tenant, t),
      {
        text: `${t("pdf.purchase.title")} ${purchase.folio}`,
        style: "titulo",
        margin: [0, 10, 0, 6],
      },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: t("pdf.purchase.supplier"), style: "etiqueta" },
              { text: purchase.supplierName },
              ...(purchase.supplierTaxId !== null
                ? [{ text: `${etiquetaFiscal}: ${purchase.supplierTaxId}`, style: "gris" }]
                : []),
            ],
          },
          {
            width: "50%",
            stack: [
              { text: `${t("pdf.purchase.date")}: ${purchase.purchaseDate}` },
              ...(purchase.receivedDate !== null
                ? [{ text: `${t("pdf.purchase.receivedDate")}: ${purchase.receivedDate}` }]
                : []),
              ...(purchase.supplierInvoice !== null
                ? [{ text: `${t("pdf.purchase.invoice")}: ${purchase.supplierInvoice}` }]
                : []),
              { text: `${t("pdf.purchase.warehouse")}: ${purchase.warehouseName}` },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: conLotes
            ? [14, "auto", "*", "auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto"]
            : [14, "auto", "*", "auto", "auto", "auto", "auto", "auto", "auto"],
          body: [encabezadoTabla, ...cuerpo],
        },
        layout: "lightHorizontalLines",
        fontSize: 8,
      },
      ...(charges.length > 0
        ? [
            {
              text: t("pdf.purchase.chargesTitle"),
              style: "etiqueta",
              margin: [0, 10, 0, 4] as [number, number, number, number],
            },
            {
              table: {
                headerRows: 1,
                widths: ["*", "auto", "auto", "auto"],
                body: [
                  [
                    t("pdf.purchase.chargeDescription"),
                    t("pdf.purchase.amount"),
                    t("pdf.purchase.tax"),
                    t("pdf.purchase.total"),
                  ],
                  ...charges.map((charge) => [
                    charge.description,
                    dinero(charge.amount),
                    dinero(charge.taxAmount),
                    dinero(charge.lineTotal),
                  ]),
                ],
              },
              layout: "lightHorizontalLines",
              fontSize: 8,
            },
          ]
        : []),
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
      ...(mismatch
        ? [
            {
              text: `${t("pdf.purchase.mismatch")} ${dinero(difference ?? "0")}`,
              color: "red",
              margin: [0, 6, 0, 0] as [number, number, number, number],
              fontSize: 9,
            },
          ]
        : []),
      ...(purchase.notes !== null
        ? [
            {
              text: `${t("pdf.purchase.notes")}: ${purchase.notes}`,
              margin: [0, 10, 0, 0] as [number, number, number, number],
              fontSize: 9,
            },
          ]
        : []),
      ...(purchase.entryFolio !== null
        ? [
            {
              text: `${t("pdf.purchase.entry")}: ${purchase.entryFolio}`,
              style: "gris",
              margin: [0, 6, 0, 0] as [number, number, number, number],
            },
          ]
        : []),
      {
        text: `${t("pdf.currency")}: ${currencyName(tenant.currency, locale)} (${tenant.currency})`,
        style: "gris",
        margin: [0, 10, 0, 0],
      },
      {
        text: t(
          purchase.taxMode === "included" ? "pdf.purchase.taxIncluded" : "pdf.purchase.taxExcluded",
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
    // El idioma de quien pidió el papel decide cómo se leen las cifras.
    language: bcp47,
  };
}
