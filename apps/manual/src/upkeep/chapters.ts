/**
 * Lo que se revisa de un capítulo sin generar nada: su bloque inicial, las
 * capturas que cita y el copy. Lo usa la prueba del CI (`manual.test.ts`).
 */

/** Quién usa el capítulo: las mismas palabras que la tabla del índice. */
export const WHO = ["todos", "cajero", "dueño"] as const;

/** Las marcas de plan del índice y del sitio. Sin marca, el capítulo es de todos los planes. */
export const PLAN_MARKS = ["Desde Basic", "Desde Pro", "En Plus"] as const;

/** Una marca, y opcionalmente una aclaración: «En Plus (personalizados)». */
const PLAN_PATTERN = new RegExp(`^(?:${PLAN_MARKS.join("|")})(?: \\([^()]+\\))?$`);

const KEYS = ["title", "who", "plan"];

export interface FrontMatter {
  title: string;
  who: string;
  plan: string | null;
}

/**
 * El bloque `--- title/who/plan ---` con que abre cada capítulo. Se lee igual
 * que en `pdf.ts`, pero en vez de detenerse en el primer error devuelve todos
 * los problemas, para que la prueba los liste juntos.
 */
export function readFrontMatter(source: string): {
  meta: FrontMatter | null;
  problems: string[];
} {
  const block = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!block) {
    return {
      meta: null,
      problems: ["falta el bloque --- al inicio, con title, who y, si aplica, plan"],
    };
  }
  const values: Record<string, string> = {};
  const problems: string[] = [];
  const unknown: string[] = [];
  for (const line of (block[1] as string).split("\n")) {
    if (line.trim() === "") continue;
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (!pair) {
      unknown.push(`renglón que no se entiende: «${line}»`);
      continue;
    }
    const [, key, value] = pair as unknown as [string, string, string];
    if (!KEYS.includes(key)) {
      unknown.push(`clave desconocida «${key}»: solo van title, who y plan`);
      continue;
    }
    if (value.trim() !== "") values[key] = value.trim();
  }
  if (!values.title) problems.push("falta title");
  if (!values.who) {
    problems.push("falta who: todos, cajero o dueño");
  } else if (!(WHO as readonly string[]).includes(values.who)) {
    problems.push(`who dice «${values.who}»: debe ser todos, cajero o dueño`);
  }
  if (values.plan !== undefined && !PLAN_PATTERN.test(values.plan)) {
    problems.push(
      `plan dice «${values.plan}»: debe ser ${PLAN_MARKS.slice(0, -1).join(", ")} o ${PLAN_MARKS.at(-1)}, con una aclaración entre paréntesis si hace falta`,
    );
  }
  problems.push(...unknown);
  return {
    meta: { title: values.title ?? "", who: values.who ?? "", plan: values.plan ?? null },
    problems,
  };
}

export interface CitedImage {
  /** El id del registro de pantallas, o `null` si la imagen no es `screen:<id>`. */
  screen: string | null;
  href: string;
  line: number;
}

/** Cada imagen de Markdown del capítulo. En el manual solo se citan capturas: `![pie](screen:id)`. */
export function citedImages(source: string): CitedImage[] {
  const images: CitedImage[] = [];
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1] as string;
      images.push({
        screen: href.startsWith("screen:") ? href.slice("screen:".length) : null,
        href,
        line: index + 1,
      });
    }
  });
  return images;
}

// ── El copy ──────────────────────────────────────────────────────────────

/**
 * Las raíces de los verbos que usa un manual, para armar su voseo: el
 * imperativo (tocá, poné, escribí), el presente (tocás, tenés, escribís) y el
 * imperativo con el pronombre pegado (guardalo, fijate, escribinos). Fuera
 * quedan los que chocan con el español neutro: estar (está), dar, ver, ser.
 */
const AR = [
  "acord",
  "activ",
  "agreg",
  "ajust",
  "and",
  "anot",
  "anul",
  "apag",
  "apret",
  "arrastr",
  "asign",
  "avis",
  "busc",
  "calcul",
  "cambi",
  "cancel",
  "captur",
  "carg",
  "cerr",
  "cobr",
  "comenz",
  "complet",
  "compr",
  "configur",
  "confirm",
  "conect",
  "consult",
  "cont",
  "control",
  "copi",
  "cre",
  "dej",
  "desactiv",
  "descarg",
  "edit",
  "elimin",
  "empez",
  "entr",
  "escane",
  "esper",
  "export",
  "fij",
  "filtr",
  "guard",
  "habilit",
  "import",
  "ingres",
  "instal",
  "invit",
  "llam",
  "llen",
  "marc",
  "mir",
  "mostr",
  "olvid",
  "orden",
  "pag",
  "peg",
  "pregunt",
  "presion",
  "prob",
  "record",
  "registr",
  "revis",
  "sac",
  "seleccion",
  "sent",
  "toc",
  "tom",
  "trabaj",
  "us",
  "verific",
];
const ER = [
  "aparec",
  "aprend",
  "conoc",
  "corr",
  "deb",
  "devolv",
  "encend",
  "entend",
  "escog",
  "establec",
  "hac",
  "le",
  "met",
  "mov",
  "ofrec",
  "perd",
  "pod",
  "pon",
  "prend",
  "quer",
  "reconoc",
  "resolv",
  "respond",
  "sab",
  "ten",
  "vend",
  "volv",
];
const IR = [
  "abr",
  "añad",
  "compart",
  "consegu",
  "dec",
  "defin",
  "divid",
  "eleg",
  "escrib",
  "imprim",
  "inclu",
  "ped",
  "permit",
  "recib",
  "repet",
  "sal",
  "segu",
  "sub",
  "ven",
  "viv",
];
const CLITICS = ["me", "te", "lo", "la", "le", "los", "las", "les", "nos"];
/** Formas armadas que en realidad son palabras del español neutro. */
const NOT_VOSEO = new Set(["tomate", "create", "tomás"]);

function voseoForms(): string[] {
  const forms = new Set<string>(["vos", "sos"]);
  for (const [stems, vowel, stressed] of [
    [AR, "a", "á"],
    [ER, "e", "é"],
    [IR, "i", "í"],
  ] as const) {
    for (const stem of stems) {
      forms.add(`${stem}${stressed}`);
      forms.add(`${stem}${stressed}s`);
      for (const clitic of CLITICS) forms.add(`${stem}${vowel}${clitic}`);
    }
  }
  return [...forms].filter((form) => !NOT_VOSEO.has(form));
}

const word = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "giu");

const RULES = [
  {
    rule: "asentar",
    pattern: /(?<![\p{L}\p{N}])(?:asent|asient)\p{L}*/giu,
    hint: "«asentar» es regional: «registrar» para la acción y «confirmado» para el estado",
  },
  {
    rule: "voseo",
    pattern: word(
      voseoForms()
        .sort((a, b) => b.length - a.length)
        .join("|"),
    ),
    hint: "voseo: el manual va en español neutro con «tú» (tienes, puedes, elige, escríbenos)",
  },
] as const;

export interface CopyProblem {
  line: number;
  word: string;
  rule: (typeof RULES)[number]["rule"];
  hint: string;
}

/** Lo que el copy de un capítulo no puede decir, con su línea. */
export function copyProblems(source: string): CopyProblem[] {
  const found: (CopyProblem & { column: number })[] = [];
  source.split("\n").forEach((text, index) => {
    for (const { rule, pattern, hint } of RULES) {
      for (const match of text.matchAll(pattern)) {
        found.push({ line: index + 1, column: match.index, word: match[0], rule, hint });
      }
    }
  });
  return found
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .map(({ column: _column, ...problem }) => problem);
}
