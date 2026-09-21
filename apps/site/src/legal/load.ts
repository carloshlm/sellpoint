// F11-SITE-LEGAL-01 — el texto legal se LEE de `SITIO-WEB-LEGAL.md` al
// construir. Una sola fuente: llenar un hueco o corregir una cláusula en ese
// documento actualiza las cinco rutas, y el sitio nunca dice algo distinto de
// lo que Carlos aprobó ahí.
//
// El documento trae también lo que NO se publica —el análisis, las notas a
// Carlos, las marcas 🔴 de las cláusulas de más riesgo—. Aquí se corta cada
// tramo por sus encabezados y se limpia.
import { marked } from "marked";
// Como TEXTO y por Vite (`?raw`): así lo encuentra igual en las pruebas que en
// la construcción, donde este módulo se empaqueta y cambia de carpeta.
import source from "../../../../SITIO-WEB-LEGAL.md?raw";
import type { LegalDoc } from "../config/legal";
import type { Language } from "../config/markets";

/** Dónde empieza y dónde termina cada documento, por sus encabezados. */
const BOUNDS: Record<Language, Record<LegalDoc, [start: string, end: string]>> = {
  es: {
    privacy: ["## AVISO DE PRIVACIDAD", "## TÉRMINOS Y CONDICIONES"],
    terms: ["## TÉRMINOS Y CONDICIONES", "# ENGLISH"],
  },
  en: {
    privacy: ["## PRIVACY NOTICE", "## TERMS AND CONDITIONS"],
    terms: ["## TERMS AND CONDITIONS", "# FRANÇAIS"],
  },
  fr: {
    privacy: ["## POLITIQUE DE CONFIDENTIALITÉ", "## CONDITIONS GÉNÉRALES"],
    terms: ["## CONDITIONS GÉNÉRALES", "## Lo que cada ley exige"],
  },
};

export interface LegalSection {
  /** `p1`…`p11`, `t1`…`t18` y `a1`…`a11` (el anexo de consultorio): el ancla, igual en los tres idiomas. */
  id: string;
  title: string;
}

export interface LegalDocument {
  title: string;
  /** La línea de «Última actualización», ya como HTML. */
  updated: string;
  sections: LegalSection[];
  html: string;
}

/** Los huecos `[[…]]` que solo Carlos puede llenar. Con uno solo, no se publica. */
export function findHoles(text: string): string[] {
  return text.match(/\[\[[^\]]*\]\]/g) ?? [];
}

/** «AVISO DE PRIVACIDAD» → «Aviso de privacidad». */
function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

export function loadLegalDocument(language: Language, doc: LegalDoc): LegalDocument {
  const [startMark, endMark] = BOUNDS[language][doc];
  const start = source.indexOf(`\n${startMark}`);
  const end = source.indexOf(`\n${endMark}`, start + 1);
  if (start < 0 || end < 0) {
    throw new Error(`SITIO-WEB-LEGAL.md ya no trae el tramo «${startMark}» → «${endMark}».`);
  }
  const lines = source
    .slice(start + 1, end)
    .split("\n")
    // Los separadores `---` del documento son de edición, no del texto legal.
    .filter((line) => line.trim() !== "---");

  const title = sentenceCase((lines.shift() ?? "").replace(/^##\s*/, ""));
  const sections: LegalSection[] = [];
  let updated = "";
  const body = lines
    .map((line) => {
      // `### P5. 🔴 El catálogo compartido` → un <h2 id="p5"> sin la numeración
      // interna ni la marca de riesgo, que son para quien edita.
      const heading = line.match(/^###\s+([PTA])(\d+)\.\s*(?:🔴\s*)?(.+)$/u);
      if (heading) {
        const id = `${(heading[1] as string).toLowerCase()}${heading[2]}`;
        const text = (heading[3] as string).trim();
        sections.push({ id, title: text });
        return `<h2 id="${id}">${marked.parseInline(text)}</h2>`;
      }
      // El inglés y el francés van compactos: `**P2. What we collect.** texto…`
      // en el mismo párrafo. Se parte en encabezado y texto.
      const inline = line.match(/^\*\*([PTA])(\d+)\.\s*(?:🔴\s*)?(.+?)\.?\*\*\s*(.*)$/u);
      if (inline) {
        const id = `${(inline[1] as string).toLowerCase()}${inline[2]}`;
        const text = (inline[3] as string).trim();
        sections.push({ id, title: text });
        return `<h2 id="${id}">${marked.parseInline(text)}</h2>\n\n${inline[4] ?? ""}`;
      }
      return line.replace(/🔴\s*/gu, "");
    })
    .filter((line) => {
      // La primera línea en cursiva es la fecha: va aparte, bajo el título.
      if (updated === "" && /^\*[^*].*\*$/.test(line.trim())) {
        updated = marked.parseInline(line.trim().slice(1, -1)) as string;
        return false;
      }
      return true;
    })
    .join("\n");

  return { title, updated, sections, html: marked.parse(body) as string };
}
