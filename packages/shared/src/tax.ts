import { z } from "zod";

/**
 * F4-TAX-02 — la aritmética del impuesto de venta, pura y en enteros.
 *
 * ── Por qué vive en `shared` ────────────────────────────────────────────
 *
 * La usan el API (que convierte `Prisma.Decimal` a centavos y de vuelta) y el
 * carrito del web (que ya suma centavos redondeados por línea). Si cada lado
 * dividiera por su cuenta, el cajero vería un total y el papel imprimiría
 * otro, con un centavo de diferencia que nadie puede explicar en el
 * mostrador. UNA función, probada una vez, usada dos veces.
 *
 * ── Por qué `bigint` ────────────────────────────────────────────────────
 *
 * La tasa se escala a diezmilésimas de por ciento (`TAX_RATE_SCALE = 4`:
 * 16% → 160000, 9.975% → 99750) y el importe va en centavos. Multiplicar
 * `MONEY_MAX` en centavos (10¹⁴) por la tasa escalada supera
 * `Number.MAX_SAFE_INTEGER` (≈ 9 × 10¹⁵): con `number` el redondeo sería
 * silencioso. Con `bigint` no hay pregunta; se devuelve `number` de centavos
 * porque ahí sí cabe.
 *
 * ── Dos modos, dos fórmulas ─────────────────────────────────────────────
 *
 * - `excluded` (Canadá, EE. UU.): el importe ES la base; cada componente se
 *   calcula sobre ella y se suma.
 * - `included` (México, la UE): el importe es el TOTAL; la base sale de
 *   dividir por (1 + Σ tasas) y el impuesto es la resta. Se reparte por
 *   componente en proporción a su tasa y el ÚLTIMO absorbe el residuo del
 *   redondeo, así `Σ byComponent` es EXACTAMENTE el impuesto: el papel cuadra
 *   siempre.
 *
 * Half-up en todos los cortes (medio centavo sube), que es lo que SAT y CRA
 * aceptan. Sin impuestos compuestos: ningún mercado objetivo los usa (el QST
 * dejó de serlo en 2013). Un documento entero (venta, cotización) no suma
 * renglones redondeados: `splitDocumentTax` calcula por tasa sobre la suma.
 */
export const TAX_MODES = ["included", "excluded"] as const;
export type TaxMode = (typeof TAX_MODES)[number];
export const taxModeSchema = z.enum(TAX_MODES);

/** Decimales de la tasa: 9.975 (QST) exige cuatro. */
export const TAX_RATE_SCALE = 4;
export const TAX_RATE_MAX = 100;
/** Tope duro de componentes por grupo: ningún mercado objetivo pasa de dos. */
export const MAX_TAX_COMPONENTS = 4;

/** Un componente del impuesto de un artículo: «GST 5%», «PST 7%», «IVA 16%». */
export interface TaxComponent {
  code: string;
  name: string;
  /** Porcentaje como texto decimal, hasta `TAX_RATE_SCALE` decimales. */
  rate: string;
}

export interface TaxSplit {
  netCents: number;
  taxCents: number;
  byComponent: { code: string; taxCents: number }[];
}

const RATE_DIVISOR = 10n ** BigInt(TAX_RATE_SCALE + 2); // 10⁶: porcentaje escalado → fracción

/**
 * La tasa a entero escalado: `"16"` → `160000n`, `"9.975"` → `99750n`.
 * Rechaza lo que no es una tasa: negativos, más de cuatro decimales, más de 100.
 */
export function rateToScaled(rate: string): bigint {
  const texto = rate.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(texto)) {
    throw new RangeError(
      `tax rate must be a decimal with up to ${TAX_RATE_SCALE} decimals: "${rate}"`,
    );
  }
  const [entero, fraccion = ""] = texto.split(".");
  const escalado = BigInt(`${entero}${fraccion.padEnd(TAX_RATE_SCALE, "0")}`);
  if (escalado > BigInt(TAX_RATE_MAX) * 10n ** BigInt(TAX_RATE_SCALE)) {
    throw new RangeError(`tax rate above ${TAX_RATE_MAX}%: "${rate}"`);
  }
  return escalado;
}

/** División entera con medio hacia arriba, para no negativos. */
function halfUp(numerador: bigint, denominador: bigint): bigint {
  return (numerador * 2n + denominador) / (denominador * 2n);
}

export function splitLineTax(input: {
  amountCents: number;
  mode: TaxMode;
  components: readonly TaxComponent[];
}): TaxSplit {
  const { amountCents, mode, components } = input;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`amountCents must be a non-negative integer: ${amountCents}`);
  }
  if (components.length > MAX_TAX_COMPONENTS) {
    throw new RangeError(`at most ${MAX_TAX_COMPONENTS} tax components per line`);
  }
  const tasas = components.map((c) => rateToScaled(c.rate));
  const total = tasas.reduce((acc, r) => acc + r, 0n);
  const importe = BigInt(amountCents);

  if (components.length === 0 || total === 0n) {
    return {
      netCents: amountCents,
      taxCents: 0,
      byComponent: components.map((c) => ({ code: c.code, taxCents: 0 })),
    };
  }

  if (mode === "excluded") {
    const porComponente = tasas.map((r) => halfUp(importe * r, RATE_DIVISOR));
    const impuesto = porComponente.reduce((acc, t) => acc + t, 0n);
    return {
      netCents: amountCents,
      taxCents: Number(impuesto),
      byComponent: components.map((c, i) => ({ code: c.code, taxCents: Number(porComponente[i]) })),
    };
  }

  // included: base = importe / (1 + Σ tasas), impuesto = importe − base.
  const base = halfUp(importe * RATE_DIVISOR, RATE_DIVISOR + total);
  const impuesto = importe - base;
  const porComponente: bigint[] = [];
  let repartido = 0n;
  tasas.forEach((r, i) => {
    // El último se lleva lo que falta: la suma cuadra por construcción.
    const parte = i === tasas.length - 1 ? impuesto - repartido : halfUp(impuesto * r, total);
    porComponente.push(parte);
    repartido += parte;
  });
  return {
    netCents: Number(base),
    taxCents: Number(impuesto),
    byComponent: components.map((c, i) => ({ code: c.code, taxCents: Number(porComponente[i]) })),
  };
}

export interface DocumentTaxLine {
  amountCents: number;
  components: readonly TaxComponent[];
}

export interface DocumentTaxSplit {
  lines: { netCents: number; taxCents: number }[];
  netCents: number;
  taxCents: number;
  byComponent: { code: string; name: string; rate: string; netCents: number; taxCents: number }[];
}

/**
 * El impuesto de un documento entero (Carlos, 2026-11-01): por TASA, sobre la
 * suma de los renglones que la comparten, y repartido después entre ellos.
 *
 * Redondear cada renglón por su lado acumulaba hasta medio centavo por
 * renglón: el ticket VTA-000109 decía «IVA 16% $15.18» donde la cuenta a mano,
 * 110 − 110/1.16, da $15.17, y en una venta larga la diferencia crece. Ahora:
 *
 * 1. Los renglones se juntan por su lista de componentes (código y tasa), sin
 *    importar cómo se llame el grupo ni si la tasa dice «16» o «16.00».
 * 2. `splitLineTax` corre UNA vez sobre la suma de cada conjunto: un solo
 *    redondeo por tasa.
 * 3. Ese impuesto se reparte entre los renglones del conjunto en proporción a
 *    su importe, en centavos exactos (fracción mayor primero; empate, el
 *    primero), así `Σ por renglón ≡ Σ por componente` sigue cuadrando.
 *
 * Los componentes se acumulan por código Y tasa (el IVA 0% y el 16% comparten
 * `VAT`), en el orden en que aparecen.
 */
export function splitDocumentTax(input: {
  lines: readonly DocumentTaxLine[];
  mode: TaxMode;
}): DocumentTaxSplit {
  const { lines, mode } = input;
  const claveDe = (c: TaxComponent) => `${c.code}|${rateToScaled(c.rate)}`;
  const conjuntos = new Map<string, { components: readonly TaxComponent[]; indices: number[] }>();
  lines.forEach((linea, i) => {
    if (!Number.isSafeInteger(linea.amountCents) || linea.amountCents < 0) {
      throw new RangeError(`amountCents must be a non-negative integer: ${linea.amountCents}`);
    }
    const firma = linea.components.map(claveDe).join(",");
    const conjunto = conjuntos.get(firma) ?? { components: linea.components, indices: [] };
    conjunto.indices.push(i);
    conjuntos.set(firma, conjunto);
  });

  const porLinea = lines.map((l) => ({ netCents: l.amountCents, taxCents: 0 }));
  const componentes = new Map<string, DocumentTaxSplit["byComponent"][number]>();
  for (const { components, indices } of conjuntos.values()) {
    const importes = indices.map((i) => lines[i]?.amountCents ?? 0);
    const split = splitLineTax({
      amountCents: importes.reduce((acc, a) => acc + a, 0),
      mode,
      components,
    });
    const partes = repartirCentavos(split.taxCents, importes);
    indices.forEach((i, k) => {
      const importe = importes[k] ?? 0;
      const impuesto = partes[k] ?? 0;
      porLinea[i] = {
        netCents: mode === "included" ? importe - impuesto : importe,
        taxCents: impuesto,
      };
    });
    components.forEach((c, j) => {
      const clave = claveDe(c);
      const acumulado = componentes.get(clave) ?? {
        code: c.code,
        name: c.name,
        rate: c.rate,
        netCents: 0,
        taxCents: 0,
      };
      acumulado.netCents += split.netCents;
      acumulado.taxCents += split.byComponent[j]?.taxCents ?? 0;
      componentes.set(clave, acumulado);
    });
  }

  return {
    lines: porLinea,
    netCents: porLinea.reduce((acc, l) => acc + l.netCents, 0),
    taxCents: porLinea.reduce((acc, l) => acc + l.taxCents, 0),
    byComponent: [...componentes.values()],
  };
}

/**
 * Reparte `totalCents` en proporción a `pesos`, en centavos exactos: la parte
 * entera de cada uno y después los centavos que sobran, uno por uno, a las
 * fracciones más grandes (empate: el primero). En `bigint`, como el resto del
 * archivo: comparar fracciones en coma flotante puede desempatar al revés.
 */
function repartirCentavos(totalCents: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((acc, p) => acc + BigInt(p), 0n);
  if (totalCents === 0 || suma === 0n) return pesos.map(() => 0);
  const total = BigInt(totalCents);
  const partes = pesos.map((p) => (total * BigInt(p)) / suma);
  let sobrante = total - partes.reduce((acc, p) => acc + p, 0n);
  const porFraccion = pesos
    .map((p, i) => ({ i, fraccion: (total * BigInt(p)) % suma }))
    .sort((a, b) => (a.fraccion === b.fraccion ? a.i - b.i : a.fraccion > b.fraccion ? -1 : 1));
  for (const { i } of porFraccion) {
    if (sobrante <= 0n) break;
    partes[i] = (partes[i] ?? 0n) + 1n;
    sobrante -= 1n;
  }
  return partes.map(Number);
}

/**
 * F9-COSTMODE-01 — el costo unitario en su base NETA y en su base BRUTA.
 *
 * El costo se GUARDA como se captura, en la base del negocio
 * (`tenants.cost_tax_mode`): lo que dice la factura antes de IVA/GST
 * (`excluded`) o lo que se pagó en mostrador (`included`). El NETO se
 * materializa solo donde se computa dinero — la compra, la entrada al
 * confirmar y la venta — y sale de AQUÍ, sobre la misma `splitLineTax` que
 * reparte el impuesto de una venta: una sola aritmética, un solo redondeo.
 *
 * Con `excluded` el número no se toca. Con `included` el neto es la base de
 * `splitLineTax` en modo `included` (importe ÷ (1 + Σ tasas), half-up) y el
 * bruto es el neto más el impuesto que `excluded` le sumaría. Sin
 * componentes (exento, `NO_TAX`) las dos devuelven el mismo importe.
 */
export function netUnitCostCents(
  amountCents: number,
  components: readonly TaxComponent[],
  mode: TaxMode,
): number {
  if (mode === "excluded") return amountCents;
  return splitLineTax({ amountCents, mode: "included", components }).netCents;
}

export function grossUnitCostCents(
  amountCents: number,
  components: readonly TaxComponent[],
  mode: TaxMode,
): number {
  if (mode === "excluded") return amountCents;
  return amountCents + splitLineTax({ amountCents, mode: "excluded", components }).taxCents;
}

/**
 * La etiqueta de un impuesto en los totales de una compra o una orden de
 * compra (pantalla y PDF): el nombre y, entre paréntesis, la tasa, SOLO si el
 * nombre no la dice ya. Los grupos sembrados se llaman «IVA 16%» o «GST 5%»,
 * y pegarles «(16%)» repetía el dato; un impuesto que el negocio creó con el
 * nombre «IVA» sí necesita la tasa al lado.
 *
 * `rate` llega como el decimal del API («16.0000»): se compara como número,
 * así que los ceros de más, un espacio antes del «%» o la coma decimal
 * («9,975 %») no hacen parecer distinta la misma tasa. La tasa tiene que
 * aparecer entera: «GST 18%» no dice «8%».
 */
export function taxLineLabel(name: string, rate: string): string {
  const tasa = Number(rate);
  if (!Number.isFinite(tasa)) return name;
  const texto = String(tasa);
  const compacto = name.replace(/\s+/g, "").replace(/(\d),(\d)/g, "$1.$2");
  const escapado = texto.replace(".", "\\.");
  const yaLaDice = new RegExp(`(^|[^\\d.])${escapado}%`).test(compacto);
  return yaLaDice ? name : `${name} (${texto}%)`;
}
