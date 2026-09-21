// Lo que la página decide POR MERCADO y que no es texto: qué plan respalda
// cada promesa, en qué orden van los beneficios, qué preguntas lleva cada
// versión y qué se vende en la caja dibujada (SITIO-WEB-CONTENIDO.md §4 a §11).
import type { MarketId, Route } from "./markets";

/** El plan desde el que una promesa es verdad. Sin entrada = todos los planes. */
export type PlanTag = "fromPro" | "onPlus";

export const FEATURE_IDS = ["sell", "track", "buy", "decide"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

/** Controlar existencias y registrar compras nacen en Pro (PLANES-Y-FUNCIONALIDADES.md). */
export const FEATURE_PLANS: Partial<Record<FeatureId, PlanTag>> = {
  track: "fromPro",
  buy: "fromPro",
};

export const BENEFIT_IDS = ["fast", "catalog", "shift", "stock", "expiry", "pocket"] as const;
export type BenefitId = (typeof BENEFIT_IDS)[number];

/** Existencias es de Pro; lotes y caducidades, de Plus. El que compra Basic
 *  creyendo que controla caducidades es un cliente que se va enojado. */
export const BENEFIT_PLANS: Partial<Record<BenefitId, PlanTag>> = {
  stock: "fromPro",
  expiry: "onPlus",
};

const MASTER_BENEFITS: BenefitId[] = [...BENEFIT_IDS];

/**
 * En Canadá la promesa se apoya en lotes, caducidades y varias sucursales (§1):
 * ahí las caducidades suben al segundo lugar (§7.5). `/fr-ca/` sigue el orden
 * exacto de su texto aprobado (§8.3).
 */
export const BENEFIT_ORDER: Record<Route, BenefitId[]> = {
  "es-mx": MASTER_BENEFITS,
  "en-us": MASTER_BENEFITS,
  "es-us": MASTER_BENEFITS,
  "en-ca": ["fast", "expiry", "catalog", "shift", "stock", "pocket"],
  "fr-ca": ["fast", "expiry", "stock", "catalog", "shift", "pocket"],
};

export const FAQ_IDS = [
  "install",
  "scanner",
  "printer",
  "spreadsheet",
  "trialEnd",
  "payment",
  "changePlan",
  "data",
  "languages",
  "staffLanguage",
  "salesTax",
  "canadaTax",
] as const;
export type FaqId = (typeof FAQ_IDS)[number];

const COMMON_FAQ: FaqId[] = [
  "install",
  "scanner",
  "printer",
  "spreadsheet",
  "trialEnd",
  "payment",
  "changePlan",
  "data",
  "languages",
];

/**
 * Las nueve comunes, más las que SOLO van en un mercado (§11): en Estados
 * Unidos, el idioma del personal y la tasa estatal; en Canadá, los impuestos
 * de la provincia. En México no va ninguna de impuestos: el IVA se configura
 * solo y nadie lo pregunta.
 */
export const FAQ_ORDER: Record<Route, FaqId[]> = {
  "es-mx": COMMON_FAQ,
  "en-us": [...COMMON_FAQ, "staffLanguage", "salesTax"],
  "es-us": [...COMMON_FAQ, "staffLanguage", "salesTax"],
  "en-ca": [...COMMON_FAQ, "canadaTax"],
  "fr-ca": [...COMMON_FAQ, "canadaTax"],
};

/**
 * Los idiomas del sitio que la APLICACIÓN todavía no habla. En ellos la
 * sección de planes lo dice a la vista (CONTENIDO §8.4): prometer francés en
 * la portada y entregar inglés adentro es la queja más fácil de evitar. El
 * día que el francés entre a la aplicación, se quita de aquí.
 */
export const APP_MISSING_LANGUAGES: readonly string[] = ["fr"];

/** Los mercados donde «Consultorios» aparece entre los giros, como enlace (§4.4). */
export const CLINICS_MARKETS: readonly MarketId[] = ["mx"];

/** El valor de `?plan=` con el que el formulario abre en «Algo a la medida» (LEAD-07). */
export const CUSTOM_PLAN_PARAM = "custom";

/**
 * La venta de la caja dibujada del hero. Los NOMBRES de los productos son
 * texto y viven en los idiomas; aquí va lo que es del país: el código de
 * barras (México usa el prefijo 750; Estados Unidos y Canadá, UPC) y los
 * importes. `test/sections.test.ts` comprueba que el total sea la suma.
 */
export const MOCK_SALE: Record<MarketId, { barcode: string; lines: number[]; total: number }> = {
  mx: { barcode: "7501055300013", lines: [28, 52.5, 161.4], total: 241.9 },
  us: { barcode: "036000291452", lines: [3.98, 4.49, 12.99], total: 21.46 },
  ca: { barcode: "055000123457", lines: [4.58, 4.99, 14.99], total: 24.56 },
};

/**
 * Cuántas piezas lleva cada renglón de la caja («2 piezas», «250 g», «1 pieza»).
 * El segundo se vende POR PESO (queso mozzarella): aquí cuenta como UNA venta,
 * y su importe es el de esa porción — 250 g en México y Canadá, 8 oz en Estados
 * Unidos. A $52.50 los 250 g salen $210 el kilo: un precio que un tendero cree.
 */
export const MOCK_SALE_QUANTITIES: readonly number[] = [2, 1, 1];

/**
 * El panel dibujado («Tu panel»). Como en la caja, aquí va lo que es del PAÍS
 * —los importes, en su moneda— y los textos viven en los idiomas. Los «más
 * vendidos» son los MISMOS tres productos de la caja del hero, al mismo
 * precio: `units` es cuántos se vendieron hoy, en el orden de la caja.
 * `test/sections.test.ts` comprueba que los números cuadren entre sí.
 */
export const MOCK_DASHBOARD: Record<
  MarketId,
  {
    today: number;
    month: number;
    goalPercent: number;
    profit: number;
    tickets: number;
    units: number[];
  }
> = {
  mx: {
    today: 8420.5,
    month: 184350,
    goalPercent: 78,
    profit: 61240,
    tickets: 96,
    units: [64, 31, 9],
  },
  us: {
    today: 1284.5,
    month: 28940,
    goalPercent: 78,
    profit: 9610,
    tickets: 74,
    units: [58, 27, 8],
  },
  ca: {
    today: 1412.75,
    month: 31480,
    goalPercent: 78,
    profit: 10390,
    tickets: 71,
    units: [55, 26, 8],
  },
};

/**
 * La FORMA de las gráficas, igual en todos los mercados: proporciones de 0 a
 * 100, sin moneda. El mes va por día; el día, por hora de las 8 a las 21.
 */
export const DASHBOARD_TREND = {
  current: [38, 44, 41, 52, 61, 74, 58, 47, 55, 63, 71, 86, 92, 69, 60, 72, 81, 95, 88],
  previous: [
    34, 36, 40, 43, 50, 62, 55, 41, 44, 52, 57, 66, 73, 60, 49, 55, 61, 70, 76, 64, 58, 63, 69, 78,
    84, 71, 62, 66, 73, 80,
  ],
} as const;
export const DASHBOARD_HOURLY: readonly number[] = [
  18, 34, 52, 61, 78, 96, 84, 57, 49, 63, 82, 100, 71, 38,
];

/** El ticket promedio de hoy, a centavos. */
export function mockAverageTicket(market: MarketId): number {
  const { today, tickets } = MOCK_DASHBOARD[market];
  return Math.round((today / tickets) * 100) / 100;
}

/**
 * El renglón de la caja que se vende POR PESO (el queso) y cuánto pesa cada
 * venta, en la unidad con la que ese mercado lleva la cuenta: los 250 g del
 * hero son 0.25 kg, y las 8 oz de Estados Unidos, media libra.
 */
export const MOCK_WEIGHED_LINE = 1;
export const MOCK_SALE_WEIGHT: Record<MarketId, { perSale: number; unit: "kg" | "lb" }> = {
  mx: { perSale: 0.25, unit: "kg" },
  us: { perSale: 0.5, unit: "lb" },
  ca: { perSale: 0.25, unit: "kg" },
};

/**
 * Los más vendidos de hoy: cantidad e importe, al precio de la caja del hero.
 * Lo que se vende por peso lleva además `weight`: «31 unidades» de queso no le
 * dice nada a quien lo despacha por kilo; «7.75 kg», sí.
 *
 * Van de mayor a menor IMPORTE, como en el panel real (F5-DASH-18): «más
 * vendido» es el que más dinero vende. `line` dice de qué renglón de la caja
 * del hero es cada uno, porque el orden ya no es el de la caja.
 */
export function mockTopSellers(market: MarketId): {
  line: number;
  units: number;
  amount: number;
  weight?: { value: number; unit: "kg" | "lb" };
}[] {
  const sale = MOCK_SALE[market];
  const { perSale, unit } = MOCK_SALE_WEIGHT[market];
  return MOCK_DASHBOARD[market].units
    .map((units, line) => {
      const unitPrice = (sale.lines[line] ?? 0) / (MOCK_SALE_QUANTITIES[line] ?? 1);
      return {
        line,
        units,
        amount: Math.round(unitPrice * units * 100) / 100,
        ...(line === MOCK_WEIGHED_LINE ? { weight: { value: units * perSale, unit } } : {}),
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export function mockTotal(market: MarketId): number {
  return MOCK_SALE[market].total;
}
