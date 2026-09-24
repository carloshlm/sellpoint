import ts from "typescript";

/**
 * Lee el valor de una constante hecha solo de literales (objetos, arreglos,
 * cadenas, números), como `PLAN_LINES` o `PLAN_RANK` de `packages/shared`. Se
 * lee el código en vez de importarlo: `apps/manual` no depende del paquete
 * compartido y así la prueba no necesita compilarlo antes.
 */
export function readConstLiteral(source: string, name: string): unknown {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer ? evaluate(declaration.initializer) : undefined;
      }
    }
  }
  throw new Error(`No encontré la constante ${name}.`);
}

function evaluate(node: ts.Expression): unknown {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return evaluate(node.expression);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate);
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
        value[key.text] = evaluate(property.initializer);
      }
    }
    return value;
  }
  return undefined;
}

export interface PlanTable {
  /** `free: 0, basic: 1…`, de `PLAN_RANK`. */
  rank: Record<string, number>;
  /** El plan mínimo de cada feature de `PLAN_LINES`. */
  minPlanOf: Record<string, string>;
}

/** La escalera de planes, leída de `plan-showcase.ts` y `plan-modules.ts` del paquete compartido. */
export function readPlanTable(showcaseSource: string, planModulesSource: string): PlanTable {
  const lines = readConstLiteral(showcaseSource, "PLAN_LINES") as {
    key: string;
    kind: string;
    minPlan: string;
  }[];
  const minPlanOf: Record<string, string> = {};
  for (const line of lines) {
    if (line.kind === "feature") minPlanOf[line.key] = line.minPlan;
  }
  return {
    rank: readConstLiteral(planModulesSource, "PLAN_RANK") as Record<string, number>,
    minPlanOf,
  };
}

/** La marca del índice → el plan que promete. Sin marca: todos los planes. */
const MARK_PLANS: Record<string, string> = {
  "Desde Basic": "basic",
  "Desde Pro": "pro",
  "En Plus": "plus",
};

const planOfMark = (mark: string | null): string =>
  mark === null ? "free" : (MARK_PLANS[mark.replace(/\s*\(.*\)$/, "")] ?? "free");

/**
 * El feature que un capítulo muestra sin prometerlo: el de plan más alto que
 * su marca no cubre, o `null` si la marca los cubre todos. Un feature que la
 * lista de planes no conoce también se devuelve, con `minPlan: null`.
 */
export function planGap(
  mark: string | null,
  features: readonly string[],
  plans: PlanTable,
): { feature: string; minPlan: string | null } | null {
  const covered = plans.rank[planOfMark(mark)] ?? 0;
  let gap: { feature: string; minPlan: string | null; rank: number } | null = null;
  for (const feature of features) {
    const minPlan = plans.minPlanOf[feature] ?? null;
    const rank = minPlan === null ? Number.POSITIVE_INFINITY : (plans.rank[minPlan] ?? 0);
    if (rank > covered && (!gap || rank > gap.rank)) gap = { feature, minPlan, rank };
  }
  return gap && { feature: gap.feature, minPlan: gap.minPlan };
}
