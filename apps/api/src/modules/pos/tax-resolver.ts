import type { TaxComponent, TaxMode } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import type { GrupoResuelto } from "./totals";

/**
 * F4-TAX-07 — el contexto fiscal de un documento: el modo del negocio, su
 * grupo default y los grupos que sus líneas nombran.
 *
 * `resolverGrupos` NO filtra por `is_active`: un grupo desactivado que un
 * artículo todavía usa sigue siendo su impuesto (desactivar solo lo esconde
 * del selector). Lo que sí exige es que el grupo sea DEL negocio: un id ajeno
 * simplemente no aparece y la línea cae al default.
 */
export interface ContextoFiscal {
  mode: TaxMode;
  porDefecto: GrupoResuelto | null;
  grupos: Map<string, GrupoResuelto>;
}

type FilaGrupo = {
  id: string;
  code: string;
  name: string;
  rates: { code: string; name: string; rate: Prisma.Decimal; sortOrder: number }[];
};

const aGrupo = (fila: FilaGrupo): GrupoResuelto => ({
  id: fila.id,
  code: fila.code,
  name: fila.name,
  rates: [...fila.rates]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({ code: r.code, name: r.name, rate: r.rate.toString() })),
});

const SELECT_GRUPO = {
  id: true,
  code: true,
  name: true,
  rates: { select: { code: true, name: true, rate: true, sortOrder: true } },
} as const;

export async function resolverGrupos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, GrupoResuelto>> {
  const unicos = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (unicos.length === 0) return new Map();
  const filas = await tx.taxGroup.findMany({
    where: { tenantId, id: { in: unicos } },
    select: SELECT_GRUPO,
  });
  return new Map(filas.map((f) => [f.id, aGrupo(f)]));
}

export async function grupoPorDefecto(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<GrupoResuelto | null> {
  const fila = await tx.taxGroup.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: SELECT_GRUPO,
  });
  return fila === null ? null : aGrupo(fila);
}

export async function contextoFiscal(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: readonly (string | null | undefined)[],
): Promise<ContextoFiscal> {
  const [tenant, porDefecto, grupos] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxMode: true } }),
    grupoPorDefecto(tx, tenantId),
    resolverGrupos(tx, tenantId, ids),
  ]);
  return { mode: tenant.taxMode as TaxMode, porDefecto, grupos };
}

/** El grupo de una línea de CATÁLOGO: el suyo, o el default del negocio. Sin default: sin impuesto. */
export function grupoDe(
  ctx: ContextoFiscal,
  taxGroupId: string | null | undefined,
): GrupoResuelto | null {
  if (taxGroupId !== null && taxGroupId !== undefined) {
    const propio = ctx.grupos.get(taxGroupId);
    if (propio !== undefined) return propio;
  }
  return ctx.porDefecto;
}

/**
 * El grupo CONGELADO de una línea cotizada, reconstruido desde su snapshot
 * (`tax_group_code` + `tax_rates`). Es lo que cobra un concepto: nunca el
 * catálogo de hoy ni el default de la caja.
 */
export function grupoCongelado(
  taxGroupCode: string | null,
  taxRates: unknown,
): GrupoResuelto | null {
  if (taxGroupCode === null) return null;
  const rates = Array.isArray(taxRates)
    ? (taxRates as TaxComponent[]).filter(
        (r) =>
          typeof r?.code === "string" && typeof r?.name === "string" && typeof r?.rate === "string",
      )
    : [];
  return { id: "", code: taxGroupCode, name: taxGroupCode, rates };
}

/** El impuesto VIGENTE de un ítem de catálogo, en el contrato del buscador (F4-TAX-16). */
export function impuestoDeItem(
  ctx: ContextoFiscal,
  taxGroupId: string | null | undefined,
): { groupCode: string | null; components: TaxComponent[] } {
  const grupo = grupoDe(ctx, taxGroupId);
  return { groupCode: grupo?.code ?? null, components: snapshotDeTasas(grupo) };
}

/** Lo que se guarda en `quote_lines.tax_rates`: los componentes tal cual se cotizaron. */
export function snapshotDeTasas(grupo: GrupoResuelto | null): TaxComponent[] {
  return grupo === null
    ? []
    : grupo.rates.map((r) => ({ code: r.code, name: r.name, rate: r.rate }));
}

/** El mismo snapshot, en el tipo que Prisma acepta para una columna JSONB. */
export function taxRatesJson(grupo: GrupoResuelto | null): Prisma.InputJsonArray {
  return snapshotDeTasas(grupo) as unknown as Prisma.InputJsonArray;
}
