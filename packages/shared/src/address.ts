import { CA_REGION_NAMES, CA_REGIONS, US_REGION_NAMES, US_REGIONS } from "./tax-defaults";

/**
 * F1-ADDR-02 — la dirección de un negocio, por país.
 *
 * Carlos presentó SellPointy a un cliente en Canadá y le dijeron que ahí se
 * piden City, Postal Code y Address 2; Carlos creía que «eso no existe en
 * México». Es al revés: México pide lo mismo y suma la colonia, y el SAT no
 * factura sin código postal desde CFDI 4.0. Los tres países piden LO MISMO
 * —línea de calle, segunda línea, ciudad, región y código postal— y solo
 * cambian la etiqueta, el orden y la regla del código postal. Es la misma
 * situación que el nombre de persona (`names.ts`) y el impuesto
 * (`tax-defaults.ts`), y la misma arquitectura: campos universales en la base,
 * etiqueta local en la pantalla, y un catálogo por país que decide qué se pide.
 *
 * ── La fuente ───────────────────────────────────────────────────────────
 *
 * Los 26 formatos están copiados del catálogo de Google (libaddressinput, el
 * de Chrome, Shopify y Stripe), consultado el 2026-09-08 en
 * `https://www.gstatic.com/chrome/autofill/libaddressinput/chromium-i18n/ssl-address/data/<CC>`:
 * `fmt` (el orden), `require` (qué es obligatorio), `zip` (la regla del código
 * postal), `zipex` (un ejemplo para el mensaje de error) y los `*_name_type`.
 * Belice y Bolivia no tienen formato allí y quedan con el genérico de hoy;
 * donde Google no dice `require` aplica su valor por omisión, `AC` (calle y
 * ciudad). Argentina y Perú tienen códigos postales raros (CPA `C1070AAM`,
 * `LIMA 23`): se respeta la fuente, y el ejemplo del país acompaña al error.
 *
 * ── Lo que este archivo decide por encima de la fuente ──────────────────
 *
 * 1. **La región se pide con select SOLO en México, Canadá y Estados Unidos.**
 *    La columna `region` admite códigos de ocho caracteres (ISO 3166-2 sin el
 *    país), nunca nombres; los catálogos de subdivisiones de los otros 23
 *    países quedaron pospuestos, así que ahí la región no se pide ni se exige
 *    aunque Google la traiga (España e Italia). `fmt` la conserva por si un
 *    día se habilita: `formatAddress` omite lo que no tiene valor.
 * 2. **Cómo se imprime la región:** por CÓDIGO en Estados Unidos y Canadá
 *    («Austin, TX 78701», «Toronto ON M5V 3L9»: el estándar de USPS y de
 *    Canada Post) y por NOMBRE en México, donde `CMX` no le dice nada a nadie.
 * 3. **La línea 2 siempre existe.** En México, Brasil y Colombia es la colonia
 *    o el barrio (`%D` en Google); en el resto es el interior, departamento o
 *    unidad, opcional, y Google no la dibuja pero el mundo la usa.
 * 4. **Canadá y Estados Unidos tienen dueño fiscal.** Sus regiones viven en
 *    `tax-defaults.ts` (de ahí salen las tasas) y este archivo las reutiliza;
 *    la de México es postal y vive acá. `addressAsksRegion` (dirección) y
 *    `needsRegion` (impuestos) son preguntas distintas a propósito.
 */

export interface AddressParts {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export const ADDRESS_FIELDS = ["line1", "line2", "city", "region", "postalCode"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export interface AddressFormat {
  /** Qué es la línea 2: la colonia o barrio, o el interior/unidad opcional. */
  line2: "unit" | "neighborhood";
  /** Cómo se llama la región, o `null` si en esta versión no se pide. */
  region: "state" | "province" | null;
  /** Cómo se imprime la región en el ticket. */
  regionDisplay: "code" | "name";
  /** Cómo se llama el código postal en la etiqueta. */
  postalCode: "zip" | "postalCode";
  /** La regla del código postal, ya anclada; `null` cuando el país no la tiene. */
  postalCodePattern: RegExp | null;
  /** Un ejemplo real del país para el mensaje de error. */
  postalCodeExample: string | null;
  /** Lo que un negocio NUEVO debe capturar en el wizard. */
  required: readonly AddressField[];
  /** El orden de impresión, en la notación de Google (`%A` calle, `%D` línea 2, `%C` ciudad, `%S` región, `%Z` CP, `%n` renglón). */
  fmt: string;
}

/** El formato de hoy para todo el mundo no curado: solo la calle obligatoria y sin regla de CP. */
export const GENERIC_ADDRESS_FORMAT: AddressFormat = {
  line2: "unit",
  region: null,
  regionDisplay: "code",
  postalCode: "postalCode",
  postalCodePattern: null,
  postalCodeExample: null,
  required: ["line1"],
  // Google no dibuja el CP en su formato por omisión; acá sí hay dónde
  // escribirlo (sin regla), porque un negocio de un país no curado también
  // tiene código postal.
  fmt: "%A%n%D%n%C%n%Z",
};

/** Los 26 países curados (`TAX_CURATED_COUNTRIES`), generados desde el catálogo de Google. */
export const ADDRESS_FORMATS: Readonly<Record<string, AddressFormat>> = {
  MX: {
    line2: "neighborhood",
    region: "state",
    regionDisplay: "name",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "02860",
    required: ["line1", "city", "region", "postalCode"],
    fmt: "%A%n%D%n%Z %C, %S",
  },
  US: {
    line2: "unit",
    region: "state",
    regionDisplay: "code",
    postalCode: "zip",
    postalCodePattern: /^(?:(\d{5})(?:[ -](\d{4}))?)$/,
    postalCodeExample: "95014",
    required: ["line1", "city", "region", "postalCode"],
    fmt: "%A%n%D%n%C, %S %Z",
  },
  CA: {
    line2: "unit",
    region: "province",
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d)$/,
    postalCodeExample: "H3Z 2Y7",
    required: ["line1", "city", "region", "postalCode"],
    fmt: "%A%n%D%n%C %S %Z",
  },
  PT: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{4}-\d{3})$/,
    postalCodeExample: "2725-079",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%Z %C",
  },
  ES: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "28039",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%Z %C %S",
  },
  FR: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{2} ?\d{3})$/,
    postalCodeExample: "33380",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%Z %C",
  },
  IT: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "00144",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%Z %C %S",
  },
  DE: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "26133",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%Z %C",
  },
  GB: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern:
      /^(?:GIR ?0AA|(?:(?:AB|AL|B|BA|BB|BD|BF|BH|BL|BN|BR|BS|BT|BX|CA|CB|CF|CH|CM|CO|CR|CT|CV|CW|DA|DD|DE|DG|DH|DL|DN|DT|DY|E|EC|EH|EN|EX|FK|FY|G|GL|GY|GU|HA|HD|HG|HP|HR|HS|HU|HX|IG|IM|IP|IV|JE|KA|KT|KW|KY|L|LA|LD|LE|LL|LN|LS|LU|M|ME|MK|ML|N|NE|NG|NN|NP|NR|NW|OL|OX|PA|PE|PH|PL|PO|PR|RG|RH|RM|S|SA|SE|SG|SK|SL|SM|SN|SO|SP|SR|SS|ST|SW|SY|TA|TD|TF|TN|TQ|TR|TS|TW|UB|W|WA|WC|WD|WF|WN|WR|WS|WV|YO|ZE)(?:\d[\dA-Z]? ?\d[ABD-HJLN-UW-Z]{2}))|BFPO ?\d{1,4})$/,
    postalCodeExample: "EC1Y 8SY",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%C%n%Z",
  },
  BZ: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: null,
    postalCodeExample: null,
    required: ["line1"],
    fmt: "%A%n%D%n%C",
  },
  CR: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{4,5}|\d{3}-\d{4})$/,
    postalCodeExample: "1000",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%S, %C%n%Z",
  },
  SV: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:[1-3][1-7][0-2]\d)$/,
    postalCodeExample: "1101",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z-%C%n%S",
  },
  GT: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "09001",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z- %C",
  },
  HN: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "31301",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%C, %S%n%Z",
  },
  NI: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "52000",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z%n%C, %S",
  },
  PA: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: null,
    postalCodeExample: null,
    required: ["line1", "city"],
    fmt: "%A%n%D%n%C%n%S",
  },
  AR: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:[A-HJ-NP-Z]\d{4}[A-Z]{3})$/,
    postalCodeExample: "C1070AAM",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z %C%n%S",
  },
  BO: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: null,
    postalCodeExample: null,
    required: ["line1"],
    fmt: "%A%n%D%n%C",
  },
  BR: {
    line2: "neighborhood",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5}-?\d{3})$/,
    postalCodeExample: "40301-110",
    required: ["line1", "city", "postalCode"],
    fmt: "%A%n%D%n%C-%S%n%Z",
  },
  CL: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{7})$/,
    postalCodeExample: "8340457",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z %C%n%S",
  },
  CO: {
    line2: "neighborhood",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{6})$/,
    postalCodeExample: "111221",
    required: ["line1"],
    fmt: "%A%n%D%n%C, %S, %Z",
  },
  EC: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{6})$/,
    postalCodeExample: "090105",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z%n%C",
  },
  PY: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{6})$/,
    postalCodeExample: "001001",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z %C",
  },
  PE: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:(?:LIMA \d{1,2}|CALLAO 0?\d)|[0-2]\d{4})$/,
    postalCodeExample: "LIMA 23",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%C %Z%n%S",
  },
  UY: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{5})$/,
    postalCodeExample: "11600",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%Z %C %S",
  },
  VE: {
    line2: "unit",
    region: null,
    regionDisplay: "code",
    postalCode: "postalCode",
    postalCodePattern: /^(?:\d{4})$/,
    postalCodeExample: "1010",
    required: ["line1", "city"],
    fmt: "%A%n%D%n%C %Z, %S",
  },
};

/**
 * El formato de un país. `null`, desconocido o en minúsculas → el genérico:
 * mismo criterio que `resolveTaxDefaults` y `resolveNameFormat`, la caja del
 * código no se normaliza porque `tenants.country` ya viaja en mayúsculas.
 */
export function resolveAddressFormat(country: string | null | undefined): AddressFormat {
  if (!country) {
    return GENERIC_ADDRESS_FORMAT;
  }
  return ADDRESS_FORMATS[country] ?? GENERIC_ADDRESS_FORMAT;
}

/** ¿La dirección de este país pide región? (Postal, no fiscal: ver `needsRegion`.) */
export function addressAsksRegion(country: string | null | undefined): boolean {
  return resolveAddressFormat(country).region !== null;
}

/**
 * Los 32 estados de México, ISO 3166-2:MX sin el prefijo del país — el mismo
 * criterio que `CA_REGIONS` y `US_REGIONS`, y lo que cabe en `region VARCHAR(8)`.
 * Nombres oficiales tal como los trae el catálogo de Google.
 */
export const MX_REGIONS = [
  "AGU",
  "BCN",
  "BCS",
  "CAM",
  "CHP",
  "CHH",
  "CMX",
  "COA",
  "COL",
  "DUR",
  "MEX",
  "GUA",
  "GRO",
  "HID",
  "JAL",
  "MIC",
  "MOR",
  "NAY",
  "NLE",
  "OAX",
  "PUE",
  "QUE",
  "ROO",
  "SLP",
  "SIN",
  "SON",
  "TAB",
  "TAM",
  "TLA",
  "VER",
  "YUC",
  "ZAC",
] as const;
export type MxRegion = (typeof MX_REGIONS)[number];

export const MX_REGION_NAMES: Record<MxRegion, string> = {
  AGU: "Aguascalientes",
  BCN: "Baja California",
  BCS: "Baja California Sur",
  CAM: "Campeche",
  CHP: "Chiapas",
  CHH: "Chihuahua",
  CMX: "Ciudad de México",
  COA: "Coahuila de Zaragoza",
  COL: "Colima",
  DUR: "Durango",
  MEX: "Estado de México",
  GUA: "Guanajuato",
  GRO: "Guerrero",
  HID: "Hidalgo",
  JAL: "Jalisco",
  MIC: "Michoacán",
  MOR: "Morelos",
  NAY: "Nayarit",
  NLE: "Nuevo León",
  OAX: "Oaxaca",
  PUE: "Puebla",
  QUE: "Querétaro",
  ROO: "Quintana Roo",
  SLP: "San Luis Potosí",
  SIN: "Sinaloa",
  SON: "Sonora",
  TAB: "Tabasco",
  TAM: "Tamaulipas",
  TLA: "Tlaxcala",
  VER: "Veracruz",
  YUC: "Yucatán",
  ZAC: "Zacatecas",
};

/** ¿Es un código de región válido para la DIRECCIÓN de este país? (MX, CA, US.) */
export function isAddressRegionCode(country: string | null | undefined, region: string): boolean {
  if (country === "MX") return (MX_REGIONS as readonly string[]).includes(region);
  if (country === "CA") return (CA_REGIONS as readonly string[]).includes(region);
  if (country === "US") return (US_REGIONS as readonly string[]).includes(region);
  return false;
}

/** El nombre de una región de MX/CA/US; `undefined` si el país no las usa o el código es ajeno. */
export function addressRegionName(
  country: string | null | undefined,
  region: string,
): string | undefined {
  if (country === "MX") return (MX_REGION_NAMES as Record<string, string>)[region];
  if (country === "CA") return (CA_REGION_NAMES as Record<string, string>)[region];
  if (country === "US") return (US_REGION_NAMES as Record<string, string>)[region];
  return undefined;
}

/**
 * El código postal como se GUARDA: recortado, en mayúsculas (Canadá, Reino
 * Unido, Argentina y Perú llevan letras; en los demás es inocuo) y, en Canadá,
 * con el espacio canónico en medio: `m5v3l9` → `M5V 3L9`. Se normaliza ANTES
 * de validar para que la regla nunca rechace a un negocio real por una
 * minúscula o un espacio.
 */
export function normalizePostalCode(country: string | null | undefined, raw: string): string {
  const texto = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (country === "CA") {
    const compacto = texto.replace(/\s/g, "");
    return compacto.length === 6 ? `${compacto.slice(0, 3)} ${compacto.slice(3)}` : texto;
  }
  return texto;
}

/**
 * ¿El código postal cumple la regla de su país? Vacío nunca es inválido —que
 * sea obligatorio lo decide `required`, no el patrón—, y sin país o sin
 * patrón todo vale: la regla existe donde hay una fuente que la respalde.
 */
export function isPostalCode(country: string | null | undefined, value: string): boolean {
  const normalizado = normalizePostalCode(country, value);
  if (normalizado === "") {
    return true;
  }
  const pattern = resolveAddressFormat(country).postalCodePattern;
  return pattern === null ? true : pattern.test(normalizado);
}

/**
 * La dirección en UNA línea, en el orden de su país, para el ticket y los PDF.
 *
 * Recorre el `fmt` renglón por renglón: cada `%X` se cambia por su valor y los
 * separadores literales (`, `, ` `, `-`) solo se emiten entre dos valores
 * presentes, así que un hueco no deja una coma colgando. Los renglones se unen
 * con «, ». Con solo la línea 1 devuelve la línea 1 TAL CUAL: el ticket de un
 * negocio que no completó nada imprime hoy exactamente lo que imprimía ayer.
 */
export function formatAddress(parts: AddressParts, country: string | null | undefined): string {
  const format = resolveAddressFormat(country);
  const region =
    parts.region && format.regionDisplay === "name"
      ? (addressRegionName(country, parts.region) ?? parts.region)
      : parts.region;
  const valores: Record<string, string | null> = {
    A: parts.line1,
    D: parts.line2,
    C: parts.city,
    S: region,
    Z: parts.postalCode,
  };

  const renglones = format.fmt.split("%n").map((renglon) => {
    let salida = "";
    let separador = "";
    let algoEmitido = false;
    for (const pieza of renglon.split(/(%[ADCSZ])/).filter((p) => p !== "")) {
      if (!pieza.startsWith("%")) {
        if (algoEmitido) separador += pieza;
        continue;
      }
      const valor = valores[pieza.slice(1)]?.trim();
      if (!valor) {
        separador = "";
        continue;
      }
      salida += (algoEmitido ? separador : "") + valor;
      separador = "";
      algoEmitido = true;
    }
    return salida;
  });

  return renglones.filter((renglon) => renglon !== "").join(", ");
}
