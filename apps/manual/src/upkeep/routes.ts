import ts from "typescript";

/** Una ruta del web y el archivo que la dibuja. */
export interface WebRoute {
  /** Como la escribe `routeTree.gen.ts`: `/expenses/`, `/expenses/$expenseId`. */
  fullPath: string;
  /** Relativo a `apps/web/src`, sin extensión: `routes/expenses.index`. */
  module: string | null;
}

const parse = (source: string, kind = ts.ScriptKind.TS) =>
  ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, kind);

const propertyName = (name: ts.PropertyName | undefined): string | null =>
  name && (ts.isStringLiteral(name) || ts.isIdentifier(name)) ? name.text : null;

function findInterface(nodes: readonly ts.Node[], name: string): ts.InterfaceDeclaration | null {
  for (const node of nodes) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) return node;
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
      const inner = findInterface(node.body.statements, name);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * Lee `apps/web/src/routeTree.gen.ts`, el árbol que genera TanStack Router y
 * que está versionado: las rutas salen de `FileRoutesByFullPath` y el archivo
 * de cada una, de `FileRoutesByPath` (su `preLoaderRoute` es el import del
 * archivo de la ruta).
 */
export function parseRouteTree(source: string): WebRoute[] {
  const file = parse(source);
  const byFullPath = findInterface(file.statements, "FileRoutesByFullPath");
  if (!byFullPath) {
    throw new Error(
      "routeTree.gen.ts ya no tiene la interfaz FileRoutesByFullPath: ¿cambió el formato de TanStack Router?",
    );
  }
  const imports = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, statement.moduleSpecifier.text.replace(/^\.\//, ""));
    }
  }
  const modules = new Map<string, string>();
  for (const member of findInterface(file.statements, "FileRoutesByPath")?.members ?? []) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isTypeLiteralNode(member.type)) {
      continue;
    }
    let fullPath: string | null = null;
    let module: string | null = null;
    for (const field of member.type.members) {
      if (!ts.isPropertySignature(field) || !field.type) continue;
      const name = propertyName(field.name);
      if (
        name === "fullPath" &&
        ts.isLiteralTypeNode(field.type) &&
        ts.isStringLiteral(field.type.literal)
      ) {
        fullPath = field.type.literal.text;
      }
      if (
        name === "preLoaderRoute" &&
        ts.isTypeQueryNode(field.type) &&
        ts.isIdentifier(field.type.exprName)
      ) {
        module = imports.get(field.type.exprName.text) ?? null;
      }
    }
    if (fullPath !== null && module !== null) modules.set(fullPath, module);
  }
  return byFullPath.members.flatMap((member) => {
    const fullPath = propertyName(member.name);
    return fullPath === null ? [] : [{ fullPath, module: modules.get(fullPath) ?? null }];
  });
}

/** Sin query ni ancla, y sin la diagonal final (salvo la raíz). */
function normalize(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

const segments = (path: string) => normalize(path).split("/").filter(Boolean);

/**
 * La ruta del web a la que lleva un `path` de captura, o `null` si no existe.
 * Un segmento `$param` acepta cualquier valor; si dos rutas empatan, gana la
 * que tiene más segmentos fijos (`/expenses/new` antes que `/expenses/$id`).
 */
export function matchRoute(path: string, fullPaths: readonly string[]): string | null {
  const wanted = segments(path);
  let best: { route: string; fixed: number } | null = null;
  for (const route of fullPaths) {
    const parts = segments(route);
    if (parts.length !== wanted.length) continue;
    let fixed = 0;
    const fits = parts.every((part, index) => {
      if (part.startsWith("$")) return true;
      fixed += 1;
      return part === wanted[index];
    });
    if (fits && (!best || fixed > best.fixed)) best = { route, fixed };
  }
  return best?.route ?? null;
}

/** Un id de ejemplo para probar una regex de `waitForURL` contra una ruta con `$param`. */
const SAMPLE_ID = "0f0e0d0c-0b0a-4000-8000-000000000001";

/**
 * Las rutas con `$param` a las que lleva un `waitForURL(/…/)`: una captura
 * que abre el detalle desde el listado declara `path` del listado, pero lo
 * que retrata es el detalle.
 */
export function routesReachedBy(
  patterns: readonly (string | RegExp)[],
  fullPaths: readonly string[],
): string[] {
  const regexes = patterns.map((pattern) =>
    typeof pattern === "string" ? new RegExp(pattern) : pattern,
  );
  return fullPaths.filter((route) => {
    if (!route.includes("$")) return false;
    const sample = `/${segments(route)
      .map((part) => (part.startsWith("$") ? SAMPLE_ID : part))
      .join("/")}`;
    return regexes.some((regex) => regex.test(sample));
  });
}

/** Las rutas que están más arriba que `route` (sin la raíz), de la más corta a la más larga. */
export function parentRoutes(route: string, fullPaths: readonly string[]): string[] {
  const parts = segments(route);
  return fullPaths
    .map((candidate) => ({ candidate, own: segments(candidate) }))
    .filter(
      ({ own }) =>
        own.length > 0 &&
        own.length < parts.length &&
        own.every((part, index) => part === parts[index]),
    )
    .sort((a, b) => a.own.length - b.own.length)
    .map(({ candidate }) => candidate);
}

/**
 * Los features de plan que cierran una ruta: el `feature` de cada
 * `<FeatureGate>` de su archivo. Solo los literales: un feature calculado no
 * se puede leer sin correr el código.
 */
export function featureGates(tsxSource: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === "FeatureGate"
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "feature") continue;
        const value = attribute.initializer;
        if (value && ts.isStringLiteral(value)) found.add(value.text);
        if (value && ts.isJsxExpression(value) && value.expression) {
          const expression = value.expression;
          if (ts.isStringLiteralLike(expression)) found.add(expression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(tsxSource, ts.ScriptKind.TSX));
  return [...found];
}
