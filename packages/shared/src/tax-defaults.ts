import type { TaxMode } from "./tax";

/**
 * F4-TAX-03 — lo que se siembra por país (y por provincia o estado) cuando un
 * negocio termina su onboarding, y lo que reciben los negocios que ya
 * existían. Hechos verificados el 2026-09-06; ver IMPLEMENTACION.md F4-TAX.
 *
 * ── Los nombres van en el vocabulario fiscal del PAÍS, no del locale ─────
 *
 * «IVA 16%», «TVA 20 %», «MwSt 19 %», «HST 13%». Es lo que el recibo tiene
 * que decir en ese mercado; un cliente canadiense que lee «Impuesto 13%» no
 * reconoce su HST. Los CÓDIGOS, en cambio, son identificadores: estables, en
 * inglés, y son lo que viaja en la planilla de importación.
 *
 * ── Dos modos ────────────────────────────────────────────────────────────
 *
 * México, la UE y Latinoamérica exhiben precio FINAL al consumidor por ley:
 * el impuesto ya está dentro (`included`). Canadá y EE. UU. exhiben el precio
 * sin impuesto y lo suman al cobrar (`excluded`).
 *
 * ── Provincia y estado ───────────────────────────────────────────────────
 *
 * En Canadá la tasa depende de la provincia (HST único, o GST + provincial);
 * en EE. UU. del estado Y de la localidad. Se siembra lo que se sabe: la
 * provincia completa, y en EE. UU. la tasa ESTATAL como punto de partida que
 * el negocio ajusta a su tasa combinada (lo mismo hacen Square y Clover en
 * su tier básico). Sin región: solo lo federal.
 *
 * México: el 8% de la región fronteriza es un estímulo por municipio,
 * vigente hasta el 31/12/2026; se siembra el 16% como default y el `VAT8`
 * queda activo para que cambiarlo sea un clic.
 */
export interface SeedTaxRate {
  code: string;
  name: string;
  rate: string;
}

export interface SeedTaxGroup {
  code: string;
  name: string;
  isDefault: boolean;
  rates: SeedTaxRate[];
}

export interface TaxDefaults {
  mode: TaxMode;
  groups: SeedTaxGroup[];
}

export const CA_REGIONS = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;
export type CaRegion = (typeof CA_REGIONS)[number];

export const US_REGIONS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;
export type UsRegion = (typeof US_REGIONS)[number];

/**
 * F4-TAX-18 — el nombre oficial de cada provincia y estado, en inglés: son
 * nombres propios y así los conoce quien vende ahí. El wizard y la tarjeta
 * de impuestos los muestran en vez del código.
 */
export const CA_REGION_NAMES: Record<CaRegion, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

export const US_REGION_NAMES: Record<UsRegion, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** La tasa ESTATAL de venta (2026), sin la local: el punto de partida. */
export const US_STATE_BASE_RATE: Record<UsRegion, string> = {
  AL: "4",
  AK: "0",
  AZ: "5.6",
  AR: "6.5",
  CA: "7.25",
  CO: "2.9",
  CT: "6.35",
  DE: "0",
  DC: "6",
  FL: "6",
  GA: "4",
  HI: "4",
  ID: "6",
  IL: "6.25",
  IN: "7",
  IA: "6",
  KS: "6.5",
  KY: "6",
  LA: "5",
  ME: "5.5",
  MD: "6",
  MA: "6.25",
  MI: "6",
  MN: "6.875",
  MS: "7",
  MO: "4.225",
  MT: "0",
  NE: "5.5",
  NV: "6.85",
  NH: "0",
  NJ: "6.625",
  NM: "4.875",
  NY: "4",
  NC: "4.75",
  ND: "5",
  OH: "5.75",
  OK: "4.5",
  OR: "0",
  PA: "6",
  RI: "7",
  SC: "6",
  SD: "4.2",
  TN: "7",
  TX: "6.25",
  UT: "6.1",
  VT: "6",
  VA: "5.3",
  WA: "6.5",
  WV: "6",
  WI: "5",
  WY: "4",
};

/** Provincias con HST único (federal + provincial en una sola tasa). */
const CA_HST: Partial<Record<CaRegion, string>> = {
  ON: "13",
  NS: "14",
  NB: "15",
  NL: "15",
  PE: "15",
};
/** Provincias con GST + impuesto provincial aparte, con el nombre que usa cada una. */
const CA_PROVINCIAL: Partial<Record<CaRegion, { code: string; rate: string }>> = {
  BC: { code: "PST", rate: "7" },
  MB: { code: "RST", rate: "7" },
  SK: { code: "PST", rate: "6" },
  QC: { code: "QST", rate: "9.975" },
};
const GST: SeedTaxRate = { code: "GST", name: "GST 5%", rate: "5" };

/** IVA estándar de los países curados que exhiben precio final (fuera de MX/CA/US). */
const VAT_BY_COUNTRY: Record<string, { label: string; rate: string }> = {
  PT: { label: "IVA", rate: "23" },
  ES: { label: "IVA", rate: "21" },
  FR: { label: "TVA", rate: "20" },
  IT: { label: "IVA", rate: "22" },
  DE: { label: "MwSt", rate: "19" },
  GB: { label: "VAT", rate: "20" },
  BZ: { label: "GST", rate: "12.5" },
  CR: { label: "IVA", rate: "13" },
  SV: { label: "IVA", rate: "13" },
  GT: { label: "IVA", rate: "12" },
  HN: { label: "ISV", rate: "15" },
  NI: { label: "IVA", rate: "15" },
  PA: { label: "ITBMS", rate: "7" },
  AR: { label: "IVA", rate: "21" },
  BO: { label: "IVA", rate: "13" },
  CL: { label: "IVA", rate: "19" },
  CO: { label: "IVA", rate: "19" },
  EC: { label: "IVA", rate: "15" },
  PY: { label: "IVA", rate: "10" },
  PE: { label: "IGV", rate: "18" },
  UY: { label: "IVA", rate: "22" },
  VE: { label: "IVA", rate: "16" },
};

const pct = (rate: string) => `${rate}%`;
const vatCode = (rate: string) => `VAT${rate.replace(".", "_")}`;

function grupoIva(label: string, rate: string, isDefault: boolean): SeedTaxGroup {
  return {
    code: vatCode(rate),
    name: `${label} ${pct(rate)}`,
    isDefault,
    rates: [{ code: "VAT", name: `${label} ${pct(rate)}`, rate }],
  };
}
const exento = (name: string): SeedTaxGroup => ({
  code: "EXEMPT",
  name,
  isDefault: false,
  rates: [],
});
const sinImpuesto = (name: string, isDefault = true): SeedTaxGroup => ({
  code: "NO_TAX",
  name,
  isDefault,
  rates: [],
});

function mexico(): TaxDefaults {
  return {
    mode: "included",
    groups: [
      grupoIva("IVA", "16", true),
      {
        code: "VAT8",
        name: "IVA 8% frontera",
        isDefault: false,
        rates: [{ code: "VAT", name: "IVA 8%", rate: "8" }],
      },
      {
        code: "VAT0",
        name: "IVA 0%",
        isDefault: false,
        rates: [{ code: "VAT", name: "IVA 0%", rate: "0" }],
      },
      exento("Exento"),
    ],
  };
}

function canada(region: string | null | undefined): TaxDefaults {
  const zero = (code: string): SeedTaxGroup => ({
    code: "ZERO",
    name: "Zero-rated 0%",
    isDefault: false,
    rates: [{ code, name: `${code} 0%`, rate: "0" }],
  });
  const hst = region !== null && region !== undefined ? CA_HST[region as CaRegion] : undefined;
  if (hst !== undefined) {
    return {
      mode: "excluded",
      groups: [
        {
          code: "HST",
          name: `HST ${pct(hst)}`,
          isDefault: true,
          rates: [{ code: "HST", name: `HST ${pct(hst)}`, rate: hst }],
        },
        zero("HST"),
        exento("Exempt"),
      ],
    };
  }
  const provincial =
    region !== null && region !== undefined ? CA_PROVINCIAL[region as CaRegion] : undefined;
  const soloGst: SeedTaxGroup = {
    code: "GST_ONLY",
    name: "GST 5%",
    isDefault: provincial === undefined,
    rates: [GST],
  };
  if (provincial !== undefined) {
    const prov: SeedTaxRate = {
      code: provincial.code,
      name: `${provincial.code} ${pct(provincial.rate)}`,
      rate: provincial.rate,
    };
    return {
      mode: "excluded",
      groups: [
        { code: "GST_PST", name: `GST 5% + ${prov.name}`, isDefault: true, rates: [GST, prov] },
        soloGst,
        zero("GST"),
        exento("Exempt"),
      ],
    };
  }
  // Alberta y los territorios (solo GST), o sin provincia todavía: lo federal.
  return { mode: "excluded", groups: [soloGst, zero("GST"), exento("Exempt")] };
}

function estadosUnidos(region: string | null | undefined): TaxDefaults {
  const base =
    region !== null && region !== undefined ? US_STATE_BASE_RATE[region as UsRegion] : undefined;
  const tasa = base ?? "0";
  const cobra = Number(tasa) > 0;
  return {
    mode: "excluded",
    groups: [
      {
        code: "SALES_TAX",
        name: `Sales tax ${pct(tasa)}`,
        isDefault: cobra,
        rates: [{ code: "SALES_TAX", name: `Sales tax ${pct(tasa)}`, rate: tasa }],
      },
      sinImpuesto("No tax", !cobra),
    ],
  };
}

/** Solo Canadá y Estados Unidos necesitan la provincia o el estado para sembrar bien. */
export function needsRegion(country: string | null | undefined): boolean {
  return country === "CA" || country === "US";
}

export function isRegionCode(country: string | null | undefined, region: string): boolean {
  if (country === "CA") return (CA_REGIONS as readonly string[]).includes(region);
  if (country === "US") return (US_REGIONS as readonly string[]).includes(region);
  return false;
}

/** El nombre de una región de CA/US; `undefined` si el país no las usa o el código es ajeno. */
export function regionName(country: string | null | undefined, region: string): string | undefined {
  if (country === "CA") return (CA_REGION_NAMES as Record<string, string>)[region];
  if (country === "US") return (US_REGION_NAMES as Record<string, string>)[region];
  return undefined;
}

export function resolveTaxDefaults(
  country: string | null | undefined,
  region?: string | null,
): TaxDefaults {
  if (country === "MX") return mexico();
  if (country === "CA") return canada(region);
  if (country === "US") return estadosUnidos(region);
  if (country === "BR") {
    // Brasil: ICMS/PIS/COFINS varían por estado y régimen; se siembra en cero
    // y el negocio configura lo suyo.
    return { mode: "included", groups: [sinImpuesto("Sem imposto"), exento("Isento")] };
  }
  const vat = country === null || country === undefined ? undefined : VAT_BY_COUNTRY[country];
  if (vat !== undefined) {
    return {
      mode: "included",
      groups: [
        grupoIva(vat.label, vat.rate, true),
        {
          code: "VAT0",
          name: `${vat.label} 0%`,
          isDefault: false,
          rates: [{ code: "VAT", name: `${vat.label} 0%`, rate: "0" }],
        },
        exento(country === "GB" ? "Exempt" : "Exento"),
      ],
    };
  }
  return { mode: "included", groups: [sinImpuesto("Sin impuesto 0%")] };
}

/** Los 26 países curados del onboarding, para el test de cobertura y el backfill. */
export const TAX_CURATED_COUNTRIES = [
  "MX",
  "US",
  "CA",
  "PT",
  "ES",
  "FR",
  "IT",
  "DE",
  "GB",
  "BZ",
  "CR",
  "SV",
  "GT",
  "HN",
  "NI",
  "PA",
  "AR",
  "BO",
  "BR",
  "CL",
  "CO",
  "EC",
  "PY",
  "PE",
  "UY",
  "VE",
] as const;

/**
 * F4-TAXMARK-04 — cómo se llama el registro fiscal en cada país curado.
 *
 * Nació en el web (`markets.ts`, decisión 6 del 2026-08-16: siglas EXACTAS
 * por país curado) y se MUDÓ aquí el 2026-09-10 porque el ticket también la
 * necesita: la CRA exige el número de registro GST/HST en todo ticket de $30
 * o más, y el papel lo imprimía pelado (Carlos: «¿este ticket es correcto en
 * Canadá?»). Una sola tabla para el wizard, Mi perfil y el ticket. No depende
 * del idioma: «RFC» es «RFC» también en inglés.
 *
 * Canadá dice «GST/HST No.» y no «BN»: es como la CRA llama a lo que va en el
 * recibo (el Business Number con su sufijo `RT0001`), y es lo que el dueño
 * reconoce como «su número de GST».
 */
export const TAX_ID_LABELS: Record<(typeof TAX_CURATED_COUNTRIES)[number], string> = {
  MX: "RFC",
  US: "EIN",
  CA: "GST/HST No.",
  PT: "NIF",
  ES: "NIF",
  FR: "SIREN/SIRET",
  IT: "Partita IVA",
  DE: "USt-IdNr",
  GB: "Company Number / VAT",
  BZ: "TIN",
  CR: "Cédula Jurídica",
  SV: "NIT",
  GT: "NIT",
  HN: "RTN",
  NI: "RUC",
  PA: "RUC",
  AR: "CUIT",
  BO: "NIT",
  BR: "CNPJ",
  CL: "RUT",
  CO: "NIT",
  EC: "RUC",
  PY: "RUC",
  PE: "RUC",
  UY: "RUT",
  VE: "RIF",
};

/** `null` sin país o para uno no curado: el que llama pone el genérico traducido. */
export function taxIdLabel(country: string | null | undefined): string | null {
  if (!country || !(TAX_CURATED_COUNTRIES as readonly string[]).includes(country)) {
    return null;
  }
  return TAX_ID_LABELS[country as (typeof TAX_CURATED_COUNTRIES)[number]];
}
