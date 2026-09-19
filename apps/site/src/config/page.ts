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
 * En Canadá la promesa se apoya en lotes, caducidades y varios almacenes (§1):
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
  "spreadsheet",
  "trialEnd",
  "payment",
  "changePlan",
  "data",
  "languages",
];

/**
 * Las ocho comunes, más las que SOLO van en un mercado (§11): en Estados
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
  mx: { barcode: "7501055300013", lines: [28, 24.9, 189], total: 241.9 },
  us: { barcode: "036000291452", lines: [3.98, 4.49, 12.99], total: 21.46 },
  ca: { barcode: "055000123457", lines: [4.58, 4.99, 14.99], total: 24.56 },
};

export function mockTotal(market: MarketId): number {
  return MOCK_SALE[market].total;
}
