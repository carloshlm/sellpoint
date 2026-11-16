import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShiftCloseDefinition, type PdfShiftCloseInput } from "./shift-pdf.renderer";

/**
 * Las llaves de verdad, de su archivo (`pdf.…` de `pdf.json`, el teléfono del
 * encabezado de `medical_clinic.json`): una que falte sale tal cual y la
 * prueba la ve.
 */
const t = (key: string): string => {
  const [archivo, ...ruta] = key.split(".");
  const raiz = JSON.parse(
    readFileSync(join(__dirname, `../../i18n/es/${archivo}.json`), "utf8"),
  ) as Record<string, unknown>;
  const valor = ruta.reduce<unknown>(
    (nodo, parte) => (nodo as Record<string, unknown> | undefined)?.[parte],
    raiz,
  );
  return typeof valor === "string" ? valor : key;
};

const base: PdfShiftCloseInput = {
  tenant: {
    name: "Abarrotes La Esquina",
    legalName: null,
    address: "Av. Juárez 10, Centro",
    phone: "5512345678",
    timezone: "America/Mexico_City",
    showBusinessName: true,
    showAddress: true,
    showPhone: true,
    currency: "MXN",
  },
  shift: {
    folio: "TUR-000042",
    status: "closed",
    warehouseName: "Almacén Central",
    openedBy: "Carlos Cinco",
    openedAt: new Date("2026-10-30T20:00:00.000Z"),
    closedBy: "Carlos Cinco",
    closedAt: new Date("2026-10-31T03:30:00.000Z"),
    salesCount: 3,
    openingCash: "1000",
    totals: [
      { method: "cash", total: "21", count: 1 },
      { method: "card", total: "992", count: 1 },
      { method: "transfer", total: "0", count: 0 },
    ],
    cashExpenses: { total: "50", count: 1 },
    calculatedCash: "971",
    declaredCash: "71",
    cashDifference: "-900",
    closingNote: "Faltó un billete",
  },
  sales: [
    {
      folio: "VTA-000069",
      createdAt: new Date("2026-10-30T21:15:00.000Z"),
      seller: "Carlos Cinco",
      paymentMethod: "cash",
      status: "completed",
      total: "21",
    },
    {
      folio: "VTA-000070",
      createdAt: new Date("2026-10-30T22:00:00.000Z"),
      seller: "Carlos Cinco",
      paymentMethod: "card",
      status: "completed",
      total: "992",
    },
    {
      folio: "VTA-000071",
      createdAt: new Date("2026-10-30T22:10:00.000Z"),
      seller: "Carlos Cinco",
      paymentMethod: "cash",
      status: "canceled",
      total: "300",
    },
  ],
  expenses: [
    {
      folio: "GAS-000007",
      description: "Garrafón de agua",
      createdBy: "Carlos Cinco",
      total: "50",
    },
  ],
  locale: "es",
};

const texto = (input: PdfShiftCloseInput) => JSON.stringify(buildShiftCloseDefinition(input, t));

/**
 * Carlos (2026-11-16): el cierre de turno «con su header y abajo el detalle»,
 * en PDF carta, para control interno.
 */
describe("el PDF del cierre de turno", () => {
  it("es carta y lleva el negocio, el folio y quién y cuándo abrió y cerró", () => {
    const definicion = buildShiftCloseDefinition(base, t);
    expect(definicion.pageSize).toBe("LETTER");
    const todo = texto(base);
    for (const pedazo of [
      "Abarrotes La Esquina",
      "Cierre de turno TUR-000042",
      "Almacén Central",
      "Carlos Cinco",
      "30/10/26",
    ]) {
      expect(todo).toContain(pedazo);
    }
    // Ninguna llave sin traducir.
    expect(todo).not.toMatch(/"[a-z_]+\.[a-zA-Z_.]+:?/);
  });

  it("el encabezado es el nombre del negocio; la razón social, si es otra, va debajo", () => {
    const definicion = buildShiftCloseDefinition(
      { ...base, tenant: { ...base.tenant, legalName: "Ana Pérez" } },
      t,
    );
    const encabezado = JSON.stringify(definicion.content[0]);
    expect(encabezado.indexOf("Abarrotes La Esquina")).toBeLessThan(
      encabezado.indexOf("Ana Pérez"),
    );
  });

  it("el arqueo: fondo, cobrado por forma de pago, gastos, esperado, contado y diferencia", () => {
    const todo = texto(base);
    for (const pedazo of [
      "Fondo inicial",
      "1,000.00",
      "Efectivo (1)",
      "21.00",
      "Tarjeta (1)",
      "992.00",
      "Gastos en efectivo (1)",
      "-50.00",
      "Efectivo esperado",
      "971.00",
      "Efectivo contado",
      "71.00",
      "-900.00",
      "Faltó un billete",
    ]) {
      expect(todo).toContain(pedazo);
    }
  });

  it("un turno que cuadró lo dice con palabras", () => {
    const todo = texto({
      ...base,
      shift: { ...base.shift, declaredCash: "971", cashDifference: "0" },
    });
    expect(todo).toContain("Cuadró");
  });

  it("abajo van las ventas, con las canceladas marcadas, y los gastos del cajón", () => {
    const todo = texto(base);
    for (const pedazo of ["Ventas del turno", "VTA-000069", "VTA-000071", "Cancelada"]) {
      expect(todo).toContain(pedazo);
    }
    expect(todo).toContain("Gastos del cajón");
    expect(todo).toContain("Garrafón de agua");
    expect(texto({ ...base, expenses: [] })).not.toContain("Gastos del cajón");
  });

  it("un turno abierto lleva marca de agua y no inventa el arqueo", () => {
    const abierto = buildShiftCloseDefinition(
      {
        ...base,
        shift: {
          ...base.shift,
          status: "open",
          closedBy: null,
          closedAt: null,
          calculatedCash: null,
          declaredCash: null,
          cashDifference: null,
        },
      },
      t,
    );
    expect(abierto.watermark).toMatchObject({ text: "TURNO ABIERTO" });
    expect(JSON.stringify(abierto)).not.toContain("Efectivo contado");
  });
});
