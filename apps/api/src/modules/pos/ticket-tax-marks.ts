/**
 * F4-TAXMARK-01 — la marca de impuesto por línea del ticket.
 *
 * El *Input Tax Credit Information (GST/HST) Regulations* de la CRA pide que,
 * cuando un mismo ticket mezcla artículos con distinto tratamiento fiscal, se
 * indique el estatus de cada línea. La convención en todo Canadá es una letra
 * tras el importe y una leyenda al pie.
 *
 * La letra es de APARICIÓN (A, B, C…) y no de las iniciales del componente
 * (H, G, GP), a propósito: en México los grupos de fábrica —IVA 16%, 8% y 0%—
 * comparten el componente `VAT`, y unas iniciales darían «V, V2, V3». Con la
 * letra de aparición, la leyenda dice el NOMBRE del grupo («A = IVA 16%»,
 * «B = IVA 0%») en el vocabulario fiscal del negocio, en cualquier país.
 *
 * La regla de «solo cuando se mezclan» vive aquí: con menos de dos grupos no
 * hay marcas y el papel sale byte a byte como siempre (la ley de F4-TAX-12).
 */
export interface TaxMark {
  /** El código del grupo (`sale_items.tax_group_code`), la llave de la fila. */
  code: string;
  /** La letra que se imprime tras el importe. */
  mark: string;
  /** Lo que dice la leyenda: el nombre del grupo, que ya trae la tasa. */
  label: string;
}

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function taxMarksFor(groups: { code: string; name: string }[]): TaxMark[] {
  const vistos = new Set<string>();
  const distintos = groups.filter((g) => {
    if (vistos.has(g.code)) {
      return false;
    }
    vistos.add(g.code);
    return true;
  });
  if (distintos.length < 2) {
    return [];
  }
  return distintos.map((g, i) => ({
    code: g.code,
    mark: LETRAS[i] ?? String(i + 1),
    label: g.name,
  }));
}

/** Los grupos distintos que las líneas traen, en orden de aparición y sin los nulos. */
export function distinctTaxGroupCodes(lines: { taxGroupCode: string | null }[]): string[] {
  const codigos: string[] = [];
  for (const line of lines) {
    if (line.taxGroupCode !== null && !codigos.includes(line.taxGroupCode)) {
      codigos.push(line.taxGroupCode);
    }
  }
  return codigos;
}
