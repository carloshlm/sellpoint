import { describe, expect, it } from "vitest";
import { parseManualIndex } from "./manual-index.js";

const README = `# Manual de usuario

| Pieza | Dónde vive | Estado |
|---|---|---|
| Textos, un archivo por capítulo | \`docs/manual/es/\` | 28 de 38 |

## El índice

| # | Capítulo | Archivo | Quién | Plan |
|---|---|---|---|---|
| — | Portada y «Cómo leer este manual» | \`00-read-me.md\` | todos | — |
| | **Parte 1 — Primeros pasos** | | | |
| 2 | Entrar, salir y tu contraseña | \`01-start/02-sign-in.md\` | todos | — |
| | **Parte 4 — Inventario** | | | Desde Pro |
| 33 | Roles: los de fábrica y los personalizados | \`07-team/33-roles.md\` | dueño | En Plus (personalizados) |

Unas 60 a 80 páginas.

| Otra | tabla |
|---|---|
| \`no-es-capitulo.md\` | nada |
`;

describe("parseManualIndex", () => {
  it("lee cada capítulo de la tabla del índice con su título, quién, plan y línea", () => {
    expect(parseManualIndex(README)).toEqual([
      {
        file: "00-read-me.md",
        title: "Portada y «Cómo leer este manual»",
        who: "todos",
        plan: null,
        line: 11,
      },
      {
        file: "01-start/02-sign-in.md",
        title: "Entrar, salir y tu contraseña",
        who: "todos",
        plan: null,
        line: 13,
      },
      {
        file: "07-team/33-roles.md",
        title: "Roles: los de fábrica y los personalizados",
        who: "dueño",
        plan: "En Plus (personalizados)",
        line: 15,
      },
    ]);
  });

  it("dice qué pasa si no encuentra la tabla", () => {
    expect(() => parseManualIndex("# Sin índice\n")).toThrow(/No encontré la tabla del índice/);
  });
});
