import { dirname, join } from "node:path/posix";
import ts from "typescript";

/**
 * LO QUE UNA CAPTURA BUSCA EN LA PANTALLA, leído del código con el
 * compilador de TypeScript (sin correrlo): los textos de `getByText`,
 * `getByRole(…, { name })`, `getByLabel`, `filter({ hasText })`,
 * `selectOption({ label })`…, los `data-testid` y los ids de los selectores, y
 * las URL de `waitForURL`. Un texto que viaja por una función (`card(page,
 * "Cambiar contraseña")`) se sigue hasta el literal que lo escribe.
 *
 * Así la prueba del CI sabe, sin levantar nada, que una captura espera un
 * texto que la pantalla ya no muestra (pasó con `pos:view`).
 *
 * OJO: usa la API del compilador del `typescript` ~6 de este paquete. El 7
 * (el de la raíz del repo) es nativo y no trae API de JavaScript
 * (`ts.createSourceFile` no existe): no se sube este paquete al 7 sin
 * cambiar cómo se lee el código.
 */

/** Un archivo del registro: `path` relativo a `apps/manual/src` (`screens/team.ts`). */
export interface SourceText {
  path: string;
  source: string;
}

export interface Finding {
  /** `text`: se lee en pantalla. `code`: un id o `data-testid` del código del web. `url`: una regex de `waitForURL`. */
  kind: "text" | "code" | "url";
  value: string;
  /** Si la captura lo busca completo (`exact: true`) o como parte de algo más largo. */
  exact: boolean;
  /** Las banderas de la regex, en las URL. */
  flags: string;
  file: string;
  line: number;
  /** La captura en cuyo objeto está escrito el literal; `null` si está en una función. */
  screen: string | null;
}

export interface ScreenFacts {
  id: string;
  file: string;
  line: number;
  /** Lo que busca la captura: en su objeto y en las funciones que usa. */
  findings: Finding[];
}

type PositionKind = Finding["kind"] | "selector";
interface Position {
  kind: PositionKind;
  exact: boolean;
}

type FunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

interface Helper {
  file: string;
  node: FunctionNode;
  params: (string | null)[];
  /** Qué parámetros llegan a una posición que busca algo, y cómo. */
  positions: Map<number, Position[]>;
}

interface ParsedFile {
  path: string;
  source: ts.SourceFile;
  helpers: Map<string, Helper>;
  imports: Map<string, { file: string; name: string }>;
}

type Value =
  | { type: "literal"; text: string; node: ts.Node; partial: boolean }
  | { type: "regex"; source: string; flags: string; node: ts.Node }
  | { type: "param"; helper: Helper; index: number };

interface RawFinding extends Omit<Finding, "line" | "screen"> {
  start: number;
  node: ts.Node;
}

/** Los métodos de Playwright cuyo primer argumento es un texto de la pantalla. */
const TEXT_FIRST = new Set([
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByTitle",
  "getByAltText",
]);
/** Atributos de un selector CSS que llevan texto de la pantalla. */
const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt"]);
/** Atributos de un selector CSS que llevan un nombre del código del web. */
const CODE_ATTRIBUTES = new Set(["id", "for", "name", "data-testid", "data-slot"]);

const isFunctionNode = (node: ts.Node): node is FunctionNode =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;

/** El valor de `key` en un objeto literal (`{ name: "x" }` o `{ name }`). */
function property(node: ts.Expression | undefined, key: string): ts.Expression | null {
  if (!node || !ts.isObjectLiteralExpression(unwrap(node))) return null;
  for (const member of (unwrap(node) as ts.ObjectLiteralExpression).properties) {
    if (ts.isPropertyAssignment(member) && member.name.getText() === key) {
      return member.initializer;
    }
    if (ts.isShorthandPropertyAssignment(member) && member.name.text === key) return member.name;
  }
  return null;
}

const isExact = (options: ts.Expression | undefined) =>
  property(options, "exact")?.kind === ts.SyntaxKind.TrueKeyword;

function topLevelHelpers(path: string, source: ts.SourceFile): Map<string, Helper> {
  const helpers = new Map<string, Helper>();
  const add = (name: string, node: FunctionNode) => {
    helpers.set(name, {
      file: path,
      node,
      params: node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null)),
      positions: new Map(),
    });
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer && unwrap(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && initializer && isFunctionNode(initializer)) {
        add(declaration.name.text, initializer);
      }
    }
  }
  return helpers;
}

function importsOf(path: string, source: ts.SourceFile) {
  const imports = new Map<string, { file: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!specifier.startsWith(".") || !bindings || !ts.isNamedImports(bindings)) continue;
    const file = join(dirname(path), specifier).replace(/\.js$/, ".ts");
    for (const element of bindings.elements) {
      imports.set(element.name.text, {
        file,
        name: (element.propertyName ?? element.name).getText(),
      });
    }
  }
  return imports;
}

/** Los textos e ids que un selector CSS de `page.locator(…)` pide que existan. */
function selectorParts(selector: string): { kind: "text" | "code"; value: string }[] {
  const trimmed = selector.trim();
  if (/^(xpath=|\/\/|\.\.)/.test(trimmed)) return [];
  const parts: { kind: "text" | "code"; value: string }[] = [];
  const attribute = /\[\s*([\w-]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\]\s'"]+))\s*\]/g;
  for (const match of trimmed.matchAll(attribute)) {
    const name = match[1] as string;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (TEXT_ATTRIBUTES.has(name)) parts.push({ kind: "text", value });
    if (CODE_ATTRIBUTES.has(name)) parts.push({ kind: "code", value });
  }
  for (const match of trimmed.replace(/\[[^\]]*\]/g, "").matchAll(/#([A-Za-z_][\w-]*)/g)) {
    parts.push({ kind: "code", value: match[1] as string });
  }
  return parts;
}

function forEachCall(node: ts.Node, visit: (call: ts.CallExpression) => void): void {
  if (ts.isCallExpression(node)) visit(node);
  ts.forEachChild(node, (child) => forEachCall(child, visit));
}

export function analyzeScreens(files: readonly SourceText[]): {
  findings: Finding[];
  screens: ScreenFacts[];
} {
  const parsed = new Map<string, ParsedFile>();
  for (const { path, source } of files) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    parsed.set(path, {
      path,
      source: file,
      helpers: topLevelHelpers(path, file),
      imports: importsOf(path, file),
    });
  }
  const helperByNode = new Map<ts.Node, Helper>();
  for (const file of parsed.values()) {
    for (const helper of file.helpers.values()) helperByNode.set(helper.node, helper);
  }

  const resolveHelper = (file: string, name: string): Helper | null => {
    const own = parsed.get(file);
    const local = own?.helpers.get(name);
    if (local) return local;
    const imported = own?.imports.get(name);
    return imported ? (parsed.get(imported.file)?.helpers.get(imported.name) ?? null) : null;
  };

  /** Dónde busca algo una llamada: cada expresión y en qué posición. */
  const positionsOf = (call: ts.CallExpression, file: string) => {
    const found: { expression: ts.Expression; position: Position }[] = [];
    const at = (
      expression: ts.Expression | null | undefined,
      kind: PositionKind,
      exact: boolean,
    ) => {
      if (expression) found.push({ expression, position: { kind, exact } });
    };
    const [first, second] = call.arguments;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      if (TEXT_FIRST.has(method)) at(first, "text", isExact(second));
      if (method === "getByRole") at(property(second, "name"), "text", isExact(second));
      if (method === "getByTestId") at(first, "code", true);
      if (method === "waitForURL") at(first, "url", true);
      if (method === "selectOption") at(property(first, "label"), "text", true);
      if (method === "filter") {
        at(property(first, "hasText"), "text", false);
        at(property(first, "hasNotText"), "text", false);
      }
      if (method === "locator") {
        at(first, "selector", true);
        at(property(second, "hasText"), "text", false);
        at(property(second, "hasNotText"), "text", false);
      }
    } else if (ts.isIdentifier(callee)) {
      const helper = resolveHelper(file, callee.text);
      for (const [index, positions] of helper?.positions ?? []) {
        for (const position of positions) at(call.arguments[index], position.kind, position.exact);
      }
    }
    return found;
  };

  /** A qué literales, regex o parámetros se reduce una expresión. */
  const evaluate = (node: ts.Expression, file: string, depth = 0): Value[] => {
    if (depth > 8) return [];
    const expression = unwrap(node);
    if (ts.isStringLiteralLike(expression)) {
      return [{ type: "literal", text: expression.text, node: expression, partial: false }];
    }
    if (ts.isRegularExpressionLiteral(expression)) {
      const text = expression.text;
      const end = text.lastIndexOf("/");
      return [
        {
          type: "regex",
          source: text.slice(1, end),
          flags: text.slice(end + 1),
          node: expression,
        },
      ];
    }
    if (ts.isTemplateExpression(expression)) {
      return [expression.head, ...expression.templateSpans.map((span) => span.literal)]
        .filter((part) => part.text.trim() !== "")
        .map((part) => ({ type: "literal", text: part.text.trim(), node: part, partial: true }));
    }
    if (ts.isConditionalExpression(expression)) {
      return [
        ...evaluate(expression.whenTrue, file, depth + 1),
        ...evaluate(expression.whenFalse, file, depth + 1),
      ];
    }
    if (ts.isIdentifier(expression)) return resolveIdentifier(expression, file, depth);
    return [];
  };

  const constantIn = (statements: readonly ts.Statement[], name: string): ts.Expression | null => {
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          return declaration.initializer;
        }
      }
    }
    return null;
  };

  const resolveIdentifier = (identifier: ts.Identifier, file: string, depth: number): Value[] => {
    const name = identifier.text;
    for (let node: ts.Node | undefined = identifier.parent; node; node = node.parent) {
      if (isFunctionNode(node)) {
        const index = node.parameters.findIndex(
          (p) => ts.isIdentifier(p.name) && p.name.text === name,
        );
        if (index >= 0) {
          const helper = helperByNode.get(node);
          return helper ? [{ type: "param", helper, index }] : [];
        }
      }
      if (ts.isBlock(node) || ts.isSourceFile(node)) {
        const initializer = constantIn(node.statements, name);
        if (initializer) return evaluate(initializer, file, depth + 1);
      }
      if (
        ts.isForOfStatement(node) &&
        ts.isVariableDeclarationList(node.initializer) &&
        node.initializer.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)
      ) {
        const items = unwrap(node.expression);
        return ts.isArrayLiteralExpression(items)
          ? items.elements.flatMap((item) => evaluate(item, file, depth + 1))
          : [];
      }
    }
    const imported = parsed.get(file)?.imports.get(name);
    const target = imported && parsed.get(imported.file);
    const initializer = target && constantIn(target.source.statements, imported.name);
    return initializer && target ? evaluate(initializer, target.path, depth + 1) : [];
  };

  // Qué parámetros de cada función llegan a una posición que busca algo: se
  // repite hasta que nada cambia, porque una función puede pasarle su
  // parámetro a otra (`cardHeader` → `card` → `getByText`).
  let changed = true;
  while (changed) {
    changed = false;
    for (const helper of helperByNode.values()) {
      forEachCall(helper.node, (call) => {
        for (const { expression, position } of positionsOf(call, helper.file)) {
          for (const value of evaluate(expression, helper.file)) {
            if (value.type !== "param") continue;
            const known = value.helper.positions.get(value.index) ?? [];
            if (known.some((p) => p.kind === position.kind && p.exact === position.exact)) continue;
            value.helper.positions.set(value.index, [...known, position]);
            changed = true;
          }
        }
      });
    }
  }

  const raw: RawFinding[] = [];
  const seen = new Set<string>();
  const emit = (finding: RawFinding) => {
    const key = `${finding.file}:${finding.start}:${finding.kind}:${finding.value}:${finding.exact}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push(finding);
  };
  for (const file of parsed.values()) {
    forEachCall(file.source, (call) => {
      for (const { expression, position } of positionsOf(call, file.path)) {
        for (const value of evaluate(expression, file.path)) {
          if (value.type === "param") continue;
          const origin = value.node.getSourceFile().fileName;
          const base = { flags: "", file: origin, start: value.node.getStart(), node: value.node };
          if (value.type === "regex") {
            if (position.kind === "url") {
              emit({ ...base, kind: "url", value: value.source, exact: true, flags: value.flags });
            }
          } else if (position.kind === "selector") {
            for (const part of selectorParts(value.text)) {
              emit({ ...base, kind: part.kind, value: part.value, exact: true });
            }
          } else if (position.kind === "text") {
            emit({
              ...base,
              kind: "text",
              value: value.text,
              exact: position.exact && !value.partial,
            });
          } else if (position.kind === "code") {
            emit({ ...base, kind: "code", value: value.text, exact: true });
          }
        }
      }
    });
  }

  const lineOf = (finding: RawFinding) =>
    finding.node.getSourceFile().getLineAndCharacterOfPosition(finding.start).line + 1;
  const findings = new Map<RawFinding, Finding>(
    raw.map((finding) => [
      finding,
      {
        kind: finding.kind,
        value: finding.value,
        exact: finding.exact,
        flags: finding.flags,
        file: finding.file,
        line: lineOf(finding),
        screen: null,
      },
    ]),
  );

  const screens: ScreenFacts[] = [];
  for (const file of parsed.values()) {
    const visit = (node: ts.Node) => {
      const id = ts.isObjectLiteralExpression(node) ? screenId(node) : null;
      if (id !== null) {
        const ranges = [
          { file: file.path, pos: node.pos, end: node.end },
          ...helpersUsedBy(node, file.path).map((helper) => ({
            file: helper.file,
            pos: helper.node.pos,
            end: helper.node.end,
          })),
        ];
        const inside = (finding: RawFinding, range: (typeof ranges)[number]) =>
          finding.file === range.file && finding.start >= range.pos && finding.start < range.end;
        const own = raw.filter((finding) => inside(finding, ranges[0] as (typeof ranges)[number]));
        for (const finding of own) (findings.get(finding) as Finding).screen = id;
        screens.push({
          id,
          file: file.path,
          line: file.source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          findings: raw
            .filter((finding) => ranges.some((range) => inside(finding, range)))
            .map((finding) => findings.get(finding) as Finding),
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(file.source);
  }

  /** Las funciones que usa un nodo, y las que usan ellas: llamadas o pasadas por nombre (`prepare: waitForCharts`). */
  function helpersUsedBy(root: ts.Node, file: string): Helper[] {
    const used = new Set<Helper>();
    const pending: { node: ts.Node; file: string }[] = [{ node: root, file }];
    while (pending.length > 0) {
      const { node: start, file: where } = pending.pop() as { node: ts.Node; file: string };
      const walk = (node: ts.Node) => {
        if (ts.isIdentifier(node) && isReference(node)) {
          const helper = resolveHelper(where, node.text);
          if (helper && !used.has(helper)) {
            used.add(helper);
            pending.push({ node: helper.node, file: helper.file });
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(start);
    }
    return [...used];
  }

  return { findings: [...findings.values()], screens };
}

/** El id de un objeto del registro (`{ id: "…", chapter: …, … }`), o `null` si no es una captura. */
function screenId(node: ts.ObjectLiteralExpression): string | null {
  const id = property(node, "id");
  const hasChapter = node.properties.some((member) => member.name?.getText() === "chapter");
  return id && ts.isStringLiteralLike(id) && hasChapter ? id.text : null;
}

/** Un identificador que nombra un valor, no una propiedad ni una declaración. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (
    (ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}
