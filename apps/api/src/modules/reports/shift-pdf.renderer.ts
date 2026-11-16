import {
  type Currency,
  currencyName,
  formatAmount,
  type Locale,
  localeToBcp47,
} from "@sellpoint/shared";
import { fecha, GRIS, type PdfTenant, type Translate } from "../medical-clinic/medical-pdf-blocks";

export interface PdfShiftCloseInput {
  tenant: PdfTenant & { currency: Currency };
  shift: {
    folio: string;
    status: string;
    warehouseName: string;
    openedBy: string;
    openedAt: Date;
    closedBy: string | null;
    closedAt: Date | null;
    salesCount: number;
    openingCash: string;
    totals: { method: string; total: string; count: number }[];
    cashExpenses: { total: string; count: number };
    calculatedCash: string | null;
    declaredCash: string | null;
    cashDifference: string | null;
    closingNote: string | null;
  };
  sales: {
    folio: string;
    createdAt: Date;
    seller: string;
    paymentMethod: string;
    status: string;
    total: string;
  }[];
  expenses: { folio: string; description: string; createdBy: string; total: string }[];
  locale: Locale;
}

/**
 * El cierre de turno en papel CARTA (Carlos, 2026-11-16): «con su header y
 * abajo el detalle», y «sólo para control interno» — no va a la impresora de
 * tickets.
 *
 * Arriba, el negocio, el folio y el arqueo tal como lo ve la pantalla del
 * cierre: fondo, lo cobrado por forma de pago, los gastos del cajón, el
 * efectivo esperado, el contado y la diferencia. Abajo, las ventas del turno
 * —las canceladas marcadas y tachadas: su dinero no está en el cajón— y los
 * gastos que salieron del cajón. Un turno todavía abierto lleva marca de agua
 * y no inventa el arqueo que aún no existe.
 *
 * Importes sin símbolo y «Moneda: …» al pie, como los demás papeles.
 */
export function buildShiftCloseDefinition(input: PdfShiftCloseInput, t: Translate) {
  const { tenant, shift, sales, expenses, locale } = input;
  const k = (sufijo: string) => t(`pdf.shiftClose.${sufijo}`);
  const dinero = (valor: string) => formatAmount(Number(valor), locale);
  const cuando = (valor: Date) => fecha(valor, locale, tenant.timezone);
  const abierto = shift.status === "open";

  const persona = (nombre: string, instante: Date | null) =>
    instante === null ? nombre : `${nombre} · ${cuando(instante)}`;
  const datos: [string, string][] = [
    [k("warehouse"), shift.warehouseName],
    [k("openedBy"), persona(shift.openedBy, shift.openedAt)],
    [
      k("closedBy"),
      shift.closedBy === null ? k("inProgress") : persona(shift.closedBy, shift.closedAt),
    ],
    [k("sales"), String(shift.salesCount)],
  ];

  const diferencia = () => {
    if (shift.cashDifference === null) {
      return "";
    }
    const valor = Number(shift.cashDifference);
    if (valor === 0) {
      return k("balanced");
    }
    return valor < 0 ? `-${dinero(String(-valor))}` : `+${dinero(shift.cashDifference)}`;
  };
  const importes: [string, string][] = [
    [k("openingCash"), dinero(shift.openingCash)],
    ...shift.totals.map(
      (total) =>
        [`${k(`method.${total.method}`)} (${total.count})`, dinero(total.total)] as [
          string,
          string,
        ],
    ),
    [
      `${k("cashExpenses")} (${shift.cashExpenses.count})`,
      Number(shift.cashExpenses.total) > 0 ? `-${dinero(shift.cashExpenses.total)}` : dinero("0"),
    ],
    // El arqueo solo existe al cerrar: abierto, no hay esperado ni contado.
    ...(abierto || shift.calculatedCash === null
      ? []
      : ([
          [k("expectedCash"), dinero(shift.calculatedCash)],
          [k("declaredCash"), shift.declaredCash === null ? "" : dinero(shift.declaredCash)],
          [k("difference"), diferencia()],
        ] as [string, string][])),
  ];

  const tablaVentas =
    sales.length === 0
      ? { text: k("noSales"), style: "gris" }
      : {
          table: {
            headerRows: 1,
            widths: ["auto", "auto", "*", "auto", "auto", "auto"],
            body: [
              [k("folio"), k("dateTime"), k("seller"), k("payment"), k("status"), k("total")].map(
                (texto) => ({ text: texto, bold: true }),
              ),
              ...sales.map((venta) => {
                const cancelada = venta.status === "canceled";
                const marca = cancelada ? { decoration: "lineThrough", color: GRIS } : {};
                return [
                  { text: venta.folio, ...marca },
                  { text: cuando(venta.createdAt), ...marca },
                  { text: venta.seller, ...marca },
                  { text: k(`method.${venta.paymentMethod}`), ...marca },
                  { text: cancelada ? k("canceled") : "", color: GRIS },
                  { text: dinero(venta.total), alignment: "right", ...marca },
                ];
              }),
            ],
          },
          layout: "lightHorizontalLines",
          fontSize: 8,
        };

  // El NOMBRE del negocio y no su razón social: es un papel interno, y el
  // dueño persona física saldría con su nombre propio donde se busca la
  // tienda. La razón social, si es otra, va debajo (como en el ticket).
  const encabezado = [
    { text: tenant.name, bold: true, fontSize: 13 },
    ...(tenant.legalName !== null && tenant.legalName !== tenant.name
      ? [{ text: tenant.legalName, fontSize: 9, color: GRIS }]
      : []),
    ...(tenant.address === null ? [] : [{ text: tenant.address, fontSize: 9, color: GRIS }]),
    ...(tenant.phone === null
      ? []
      : [{ text: `${t("medical_clinic.pdf.phone")}: ${tenant.phone}`, fontSize: 9, color: GRIS }]),
  ];

  return {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 60],
    ...(abierto && {
      watermark: { text: k("openWatermark"), color: "red", opacity: 0.15, bold: true },
    }),
    content: [
      encabezado,
      { text: `${k("title")} ${shift.folio}`, style: "titulo", margin: [0, 10, 0, 8] },
      {
        columns: [
          {
            width: "50%",
            stack: datos.map(([etiqueta, valor]) => ({
              text: [{ text: `${etiqueta}: `, bold: true }, valor],
              margin: [0, 0, 0, 2],
            })),
          },
          {
            width: "50%",
            table: {
              widths: ["*", "auto"],
              body: importes.map(([etiqueta, valor]) => [
                { text: etiqueta },
                { text: valor, alignment: "right" },
              ]),
            },
            layout: "lightHorizontalLines",
          },
        ],
        columnGap: 20,
        margin: [0, 0, 0, 8],
      },
      ...(shift.closingNote === null || shift.closingNote === ""
        ? []
        : [{ text: [{ text: `${k("note")}: `, bold: true }, shift.closingNote], fontSize: 9 }]),
      { text: k("salesTitle"), style: "seccion" },
      tablaVentas,
      ...(expenses.length === 0
        ? []
        : [
            { text: k("expensesTitle"), style: "seccion" },
            {
              table: {
                headerRows: 1,
                widths: ["auto", "*", "auto", "auto"],
                body: [
                  [k("folio"), k("concept"), k("createdBy"), k("amount")].map((texto) => ({
                    text: texto,
                    bold: true,
                  })),
                  ...expenses.map((gasto) => [
                    gasto.folio,
                    gasto.description,
                    gasto.createdBy,
                    { text: dinero(gasto.total), alignment: "right" },
                  ]),
                ],
              },
              layout: "lightHorizontalLines",
              fontSize: 8,
            },
          ]),
      {
        text: `${t("pdf.currency")}: ${currencyName(tenant.currency, locale)} (${tenant.currency})`,
        style: "gris",
        margin: [0, 12, 0, 0],
      },
    ],
    styles: {
      titulo: { fontSize: 14, bold: true },
      seccion: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      gris: { fontSize: 8, color: GRIS },
    },
    defaultStyle: { fontSize: 9 },
    language: localeToBcp47(locale),
  };
}
