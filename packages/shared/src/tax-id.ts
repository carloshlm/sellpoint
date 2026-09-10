import { TAX_CURATED_COUNTRIES } from "./tax-defaults";

type TaxCuratedCountry = (typeof TAX_CURATED_COUNTRIES)[number];

/**
 * F1-TAXID — el registro fiscal del negocio, por país.
 *
 * MERCADOS.md §2 (2026-08-16) dejó la validación de formato «fuera de alcance
 * hasta que haya clientes reales que lo pidan»; el cliente real llegó con un
 * ticket en la mano el 2026-09-10 («GST/HST No.: CAN67843554», «RFC:
 * CINCO8507223N4»). Mismo molde que el código postal de F1-ADDR:
 *
 * - se NORMALIZA antes de validar (mayúsculas, sin separadores de más, y la
 *   forma canónica del país), para que la regla nunca rechace a un negocio
 *   real por una minúscula, un punto o un guion;
 * - solo hay patrón donde hay una fuente oficial; Nicaragua, Panamá y Belice
 *   quedan sin patrón (formatos variables o sin fuente a la mano) y aceptan
 *   cualquier texto: inventar una regla ahí sería peor que no tenerla;
 * - vacío nunca es inválido (que sea obligatorio lo decide el formulario), y
 *   sin país o sin patrón todo vale — la ley de `isPostalCode`;
 * - el dígito verificador (F1-TAXID-04) solo donde el país lo define con un
 *   algoritmo público: CUIT, RUT y CNPJ. El RFC no: la homoclave no se puede
 *   verificar sin el algoritmo del SAT sobre el nombre completo.
 */
export interface TaxIdFormat {
  /** Sobre el texto ya normalizado. */
  pattern: RegExp;
  /** En forma canónica: normalizarlo no lo cambia y cumple su patrón. */
  example: string;
  /**
   * Recompone la forma canónica desde el texto COMPACTO (sin espacios, puntos,
   * guiones ni barras). `null` si la forma no es la esperada: entonces se
   * valida el compacto tal cual y el patrón decide.
   */
  canonical?: (compact: string) => string | null;
  /** F1-TAXID-04: el dígito verificador, sobre la forma canónica. */
  checkDigit?: (canonical: string) => boolean;
}

/** Módulo 11 con pesos fijos sobre los dígitos dados (CUIT y CNPJ). */
const modulo11 = (digitos: string, pesos: number[]): number =>
  [...digitos].reduce((suma, d, i) => suma + Number(d) * (pesos[i] as number), 0) % 11;

/** AFIP: pesos 5-4-3-2-7-6-5-4-3-2 sobre los 10 primeros; 11 − resto (11 → 0, 10 → 9). */
const cuitValido = (canonical: string): boolean => {
  const d = canonical.replace(/-/g, "");
  const resto = modulo11(d.slice(0, 10), [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]);
  const esperado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return Number(d[10]) === esperado;
};

/** SII: pesos cíclicos 2..7 de derecha a izquierda; 11 − resto (11 → 0, 10 → K). */
const rutValido = (canonical: string): boolean => {
  const [cuerpo, dv] = canonical.split("-") as [string, string];
  let suma = 0;
  let peso = 2;
  for (const c of [...cuerpo].reverse()) {
    suma += Number(c) * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === esperado;
};

/** Receita Federal: dos verificadores, cada uno módulo 11 (resto < 2 → 0, si no 11 − resto). */
const cnpjValido = (canonical: string): boolean => {
  const d = canonical.replace(/[./-]/g, "");
  const dv = (base: string, pesos: number[]) => {
    const resto = modulo11(base, pesos);
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(d[12]) === dv1 && Number(d[13]) === dv2;
};

const con = (re: RegExp, arma: (m: RegExpMatchArray) => string) => (compact: string) => {
  const m = compact.match(re);
  return m === null ? null : arma(m);
};

export const TAX_ID_FORMATS: Partial<Record<TaxCuratedCountry, TaxIdFormat>> = {
  // SAT: 12 posiciones la persona moral (3 letras), 13 la física (4); la Ñ y
  // el & son válidos en el nombre. Sin dígito verificable: ver el docblock.
  MX: { pattern: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, example: "ABC010101AB1" },
  // CRA: el Business Number (9 dígitos) y, si está registrado para GST/HST,
  // su cuenta `RT0001`. Un pequeño proveedor puede no tener la cuenta.
  CA: {
    pattern: /^\d{9}( RT\d{4})?$/,
    example: "123456789 RT0001",
    canonical: con(/^(\d{9})(RT\d{4})?$/, (m) => (m[2] ? `${m[1]} ${m[2]}` : (m[1] as string))),
  },
  // IRS: Employer Identification Number, `12-3456789`.
  US: {
    pattern: /^\d{2}-\d{7}$/,
    example: "12-3456789",
    canonical: con(/^(\d{2})(\d{7})$/, (m) => `${m[1]}-${m[2]}`),
  },
  // Autoridade Tributária: NIF de 9 dígitos.
  PT: { pattern: /^\d{9}$/, example: "123456789" },
  // AEAT: CIF (letra + 7 dígitos + control), DNI (8 dígitos + letra) o NIE.
  ES: { pattern: /^([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])$/, example: "B12345678" },
  // INSEE: SIREN (9) o SIRET (14 = SIREN + 5).
  FR: { pattern: /^\d{9}(\d{5})?$/, example: "123456789" },
  // Agenzia delle Entrate: Partita IVA de 11 dígitos.
  IT: { pattern: /^\d{11}$/, example: "12345678901" },
  // BZSt: USt-IdNr, `DE` + 9 dígitos.
  DE: { pattern: /^DE\d{9}$/, example: "DE123456789" },
  // HMRC: VAT (`GB` + 9 o 12 dígitos) o Companies House (8 dígitos, o 2 letras + 6).
  GB: { pattern: /^(GB\d{9}(\d{3})?|[A-Z]{2}\d{6}|\d{8})$/, example: "GB123456789" },
  // AFIP: CUIT `dd-dddddddd-d`, 11 dígitos con verificador módulo 11.
  AR: {
    pattern: /^\d{2}-\d{8}-\d$/,
    example: "20-12345678-6",
    canonical: con(/^(\d{2})(\d{8})(\d)$/, (m) => `${m[1]}-${m[2]}-${m[3]}`),
    checkDigit: cuitValido,
  },
  // Receita Federal: CNPJ `dd.ddd.ddd/dddd-dd`, 14 dígitos con dos verificadores.
  BR: {
    pattern: /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/,
    example: "11.222.333/0001-81",
    canonical: con(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      (m) => `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`,
    ),
    checkDigit: cnpjValido,
  },
  // SII: RUT sin puntos y con guion, verificador módulo 11 (`K` = 10).
  CL: {
    pattern: /^\d{7,8}-[\dK]$/,
    example: "76123456-0",
    canonical: con(/^(\d{7,8})([\dK])$/, (m) => `${m[1]}-${m[2]}`),
    checkDigit: rutValido,
  },
  // DIAN: NIT de 9 dígitos, con o sin el dígito de verificación.
  CO: {
    pattern: /^\d{9,10}(-\d)?$/,
    example: "900123456-7",
    canonical: con(/^(\d{9})(\d)$/, (m) => `${m[1]}-${m[2]}`),
  },
  // SRI: RUC de 13 dígitos (cédula o RUC de sociedad + `001`).
  EC: { pattern: /^\d{13}$/, example: "1790012345001" },
  // SUNAT: RUC de 11 dígitos que empieza en 10, 15, 17 o 20.
  PE: { pattern: /^(10|15|17|20)\d{9}$/, example: "20123456789" },
  // DGI: RUT de 12 dígitos.
  UY: { pattern: /^\d{12}$/, example: "211234560012" },
  // SENIAT: RIF, letra del tipo + 8 dígitos + verificador.
  VE: {
    pattern: /^[JGVEPC]-\d{8}-\d$/,
    example: "J-12345678-9",
    canonical: con(/^([JGVEPC])(\d{8})(\d)$/, (m) => `${m[1]}-${m[2]}-${m[3]}`),
  },
  // SET: RUC de 6 a 8 dígitos + verificador.
  PY: {
    pattern: /^\d{6,8}-\d$/,
    example: "80012345-6",
    canonical: con(/^(\d{6,8})(\d)$/, (m) => `${m[1]}-${m[2]}`),
  },
  // SAT Guatemala: NIT hasta 8 dígitos + verificador (`K` incluido).
  GT: {
    pattern: /^\d{1,8}-[\dK]$/,
    example: "1234567-8",
    canonical: con(/^(\d{1,8})([\dK])$/, (m) => `${m[1]}-${m[2]}`),
  },
  // Registro Nacional: cédula jurídica `d-ddd-dddddd`.
  CR: {
    pattern: /^\d-\d{3}-\d{6}$/,
    example: "3-101-123456",
    canonical: con(/^(\d)(\d{3})(\d{6})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`),
  },
  // Ministerio de Hacienda: NIT `dddd-dddddd-ddd-d`.
  SV: {
    pattern: /^\d{4}-\d{6}-\d{3}-\d$/,
    example: "0614-010190-101-1",
    canonical: con(/^(\d{4})(\d{6})(\d{3})(\d)$/, (m) => `${m[1]}-${m[2]}-${m[3]}-${m[4]}`),
  },
  // SAR: RTN `dddd-dddd-dddddd`, 14 dígitos.
  HN: {
    pattern: /^\d{4}-\d{4}-\d{6}$/,
    example: "0801-1990-123456",
    canonical: con(/^(\d{4})(\d{4})(\d{6})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`),
  },
  // SIN: NIT numérico, de 7 a 12 dígitos.
  BO: { pattern: /^\d{7,12}$/, example: "1234567012" },
  // NI, PA y BZ: sin patrón hasta tener la fuente oficial (formatos
  // variables: el RUC panameño lleva folio, tomo y DV; el TIN beliceño no
  // tiene un formato publicado). Aceptan cualquier texto.
};

function formatOf(country: string | null | undefined): TaxIdFormat | null {
  if (!country || !(TAX_CURATED_COUNTRIES as readonly string[]).includes(country)) {
    return null;
  }
  return TAX_ID_FORMATS[country as TaxCuratedCountry] ?? null;
}

/**
 * El registro fiscal como se GUARDA: recortado, en mayúsculas y, donde el
 * país tiene forma canónica, con sus separadores en su lugar (`123456789rt0001`
 * → `123456789 RT0001`, `20123456786` → `20-12345678-6`). Sin patrón, solo
 * recorte y mayúsculas: no se toca lo que no se entiende.
 */
export function normalizeTaxId(country: string | null | undefined, raw: string): string {
  const texto = raw.trim().replace(/\s+/g, " ").toUpperCase();
  const format = formatOf(country);
  if (format === null) {
    return texto;
  }
  const compact = texto.replace(/[\s.\-/]/g, "");
  return format.canonical?.(compact) ?? compact;
}

/** ¿Cumple la regla de su país? Vacío nunca es inválido; sin país o sin patrón, todo vale. */
export function isTaxId(country: string | null | undefined, value: string): boolean {
  const normalizado = normalizeTaxId(country, value);
  if (normalizado === "") {
    return true;
  }
  const format = formatOf(country);
  if (format === null) {
    return true;
  }
  return format.pattern.test(normalizado) && (format.checkDigit?.(normalizado) ?? true);
}

/** El ejemplo que enseña el formato en el campo; `null` donde no hay patrón. */
export function taxIdExample(country: string | null | undefined): string | null {
  return formatOf(country)?.example ?? null;
}
