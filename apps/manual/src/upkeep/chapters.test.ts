import { describe, expect, it } from "vitest";
import { citedImages, copyProblems, readFrontMatter } from "./chapters.js";

describe("readFrontMatter", () => {
  it("lee title, who y plan del bloque inicial", () => {
    const { meta, problems } = readFrontMatter(
      "---\ntitle: Gastos\nwho: dueño\nplan: Desde Basic\n---\n\nTexto.\n",
    );
    expect(problems).toEqual([]);
    expect(meta).toEqual({ title: "Gastos", who: "dueño", plan: "Desde Basic" });
  });

  it("sin plan, el capítulo es de todos los planes", () => {
    const { meta, problems } = readFrontMatter("---\ntitle: El panel\nwho: todos\n---\n\nTexto.\n");
    expect(problems).toEqual([]);
    expect(meta?.plan).toBeNull();
  });

  it("acepta una aclaración entre paréntesis después de la marca del plan", () => {
    const { meta, problems } = readFrontMatter(
      "---\ntitle: Roles\nwho: dueño\nplan: En Plus (personalizados)\n---\n\nTexto.\n",
    );
    expect(problems).toEqual([]);
    expect(meta?.plan).toBe("En Plus (personalizados)");
  });

  it("señala el bloque que falta", () => {
    const { meta, problems } = readFrontMatter("# Gastos\n\nTexto.\n");
    expect(meta).toBeNull();
    expect(problems).toEqual(["falta el bloque --- al inicio, con title, who y, si aplica, plan"]);
  });

  it("señala un title vacío y un who fuera de la lista", () => {
    const { problems } = readFrontMatter("---\ntitle:\nwho: gerente\n---\n\nTexto.\n");
    expect(problems).toEqual(["falta title", "who dice «gerente»: debe ser todos, cajero o dueño"]);
  });

  it("señala un plan que no es una marca del índice", () => {
    const { problems } = readFrontMatter("---\ntitle: Compras\nwho: dueño\nplan: Pro\n---\n\n");
    expect(problems).toEqual([
      "plan dice «Pro»: debe ser Desde Basic, Desde Pro o En Plus, con una aclaración entre paréntesis si hace falta",
    ]);
  });

  it("señala una clave desconocida, que el PDF ignoraría sin avisar", () => {
    const { problems } = readFrontMatter(
      "---\ntitle: Compras\nwho: dueño\nplna: Desde Pro\n---\n\n",
    );
    expect(problems).toEqual(["clave desconocida «plna»: solo van title, who y plan"]);
  });
});

describe("citedImages", () => {
  it("devuelve cada captura citada con su línea", () => {
    const source = [
      "---",
      "title: Gastos",
      "who: dueño",
      "---",
      "",
      "El listado:",
      "",
      "![El listado de gastos](screen:expenses-list)",
      "",
      "Y el detalle ![Un gasto](screen:expense-pending) en la misma línea.",
    ].join("\n");
    expect(citedImages(source)).toEqual([
      { screen: "expenses-list", href: "screen:expenses-list", line: 8 },
      { screen: "expense-pending", href: "screen:expense-pending", line: 10 },
    ]);
  });

  it("marca las imágenes que no son capturas del registro", () => {
    expect(citedImages("Texto\n![Una foto](foto.png)\n")).toEqual([
      { screen: null, href: "foto.png", line: 2 },
    ]);
  });
});

describe("copyProblems", () => {
  it("encuentra «asentar» en cualquier forma", () => {
    const source =
      "Se asienta la entrada.\nQueda asentado.\nAsentar el gasto.\nUn asiento contable.";
    expect(copyProblems(source).map((p) => [p.line, p.word, p.rule])).toEqual([
      [1, "asienta", "asentar"],
      [2, "asentado", "asentar"],
      [3, "Asentar", "asentar"],
      [4, "asiento", "asentar"],
    ]);
  });

  it("no confunde palabras que solo se parecen a «asentar»", () => {
    expect(copyProblems("Para presentar al ausente, ya sentado.")).toEqual([]);
  });

  it("encuentra el voseo, también con el pronombre pegado", () => {
    const source = [
      "Tenés que entrar, podés salir, querés ver, sabés cuál.",
      "Elegí, hacé, mirá, fijate, andá, poné, escribí y tocá.",
      "Guardalo y escribinos, vos sos el dueño.",
    ].join("\n");
    expect(copyProblems(source).map((p) => [p.line, p.word])).toEqual([
      [1, "Tenés"],
      [1, "podés"],
      [1, "querés"],
      [1, "sabés"],
      [2, "Elegí"],
      [2, "hacé"],
      [2, "mirá"],
      [2, "fijate"],
      [2, "andá"],
      [2, "poné"],
      [2, "escribí"],
      [2, "tocá"],
      [3, "Guardalo"],
      [3, "escribinos"],
      [3, "vos"],
      [3, "sos"],
    ]);
    expect(new Set(copyProblems(source).map((p) => p.rule))).toEqual(new Set(["voseo"]));
  });

  it("deja pasar el español neutro con «tú»", () => {
    const source = [
      "Tienes que entrar, puedes salir, quieres ver, sabes cuál.",
      "Elige, haz, mira, fíjate, anda, pon, escribe y toca.",
      "Guárdalo y escríbenos: tú eres el dueño. Está aquí, más abajo, también.",
      "Después podrás verlo; la sucursal está abierta y el cajero toca el botón.",
    ].join("\n");
    expect(copyProblems(source)).toEqual([]);
  });
});
