import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n } from "./index";

function WelcomeProbe() {
  const { t } = useTranslation();
  return <p data-testid="welcome-probe">{t("common.welcome")}</p>;
}

function MissingKeyProbe() {
  const { t } = useTranslation();
  return <p data-testid="missing-key-probe">{t("common.nope")}</p>;
}

describe("i18n wiring", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renderiza el texto en español por default (instancia sin detector)", () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <WelcomeProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("welcome-probe")).toHaveTextContent("Bienvenido a SellPoint");
  });

  it("cambia el texto renderizado tras changeLanguage('en')", async () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <WelcomeProbe />
      </I18nextProvider>,
    );

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(screen.getByTestId("welcome-probe")).toHaveTextContent("Welcome to SellPoint");
  });

  it("una clave inexistente no rompe: devuelve la clave (fallback default de i18next)", () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <MissingKeyProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("missing-key-probe")).toHaveTextContent("common.nope");
  });

  it("persiste el idioma elegido en localStorage cuando el detector está activo", async () => {
    const i18n = createI18n({ withDetector: true });

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(localStorage.getItem("sellpoint.locale")).toBe("en");
  });
});

/**
 * GUARDARRAÍL DE VOZ DE LA UI (LEY, Carlos, 2026-08-16).
 *
 * El producto es México-first y se vende a 26 mercados: el voseo rioplatense
 * ("podés", "elegí", "escribinos") suena extranjero en la mayoría de ellos,
 * así que el copy en español SIEMPRE se escribe en neutro (conjugación
 * "tú": "tienes", "puedes", "elige"). Ver MERCADOS.md §3 "Voz de la UI — LEY".
 *
 * Este test recorre TODAS las cadenas de `apps/web/src/i18n/es/*.json` y
 * `apps/api/src/i18n/es/*.json` (incluye los correos, que también son UI
 * para el usuario) y falla si alguna forma voseante se cuela. La convención
 * no depende de que alguien la recuerde en el review.
 */
// OJO: \b de JS solo reconoce [A-Za-z0-9_] como "carácter de palabra", así que
// falla en silencio después de una vocal acentuada (p. ej. "revisá\b" nunca
// matchea porque "á" no es \w). Casi todas las formas voseantes de esta lista
// terminan en vocal acentuada, así que usamos límites propios que sí
// reconocen letras acentuadas del español en vez de \b.
const LETRA = "[A-Za-zÁÉÍÓÚÑÜáéíóúñü]";
const FORMAS_VOSEANTES = new RegExp(
  `(?<!${LETRA})(podés|tenés|querés|necesitás|sabés|debés|hacés|ponés|venís|salís|elegí|revisá|ingresá|completá|seleccioná|agregá|guardá|probá|contactá|verificá|actualizá|volvé|mirá|creá|escribí|escribinos|escribime|andá|fijate|intentá|dale|vos)(?!${LETRA})`,
  "i",
);

function collectStringLeaves(
  value: unknown,
  keyPath: string,
  out: Array<{ key: string; value: string }>,
): void {
  if (typeof value === "string") {
    out.push({ key: keyPath, value });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectStringLeaves(childValue, keyPath ? `${keyPath}.${childKey}` : childKey, out);
    }
  }
}

function loadJsonFiles(dir: string): Array<{ file: string; key: string; value: string }> {
  const entries: Array<{ file: string; key: string; value: string }> = [];
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = join(dir, fileName);
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    const leaves: Array<{ key: string; value: string }> = [];
    collectStringLeaves(parsed, "", leaves);
    for (const leaf of leaves) {
      entries.push({ file: filePath, key: leaf.key, value: leaf.value });
    }
  }
  return entries;
}

describe("voz de la UI — español neutro, nunca voseo (LEY)", () => {
  const ES_DIRS = [join(__dirname, "es"), join(__dirname, "../../../api/src/i18n/es")] as const;

  const todasLasCadenas = ES_DIRS.flatMap((dir) => loadJsonFiles(dir));

  it("hay cadenas en español para revisar (el guardián no está vacío)", () => {
    expect(todasLasCadenas.length).toBeGreaterThan(0);
  });

  it.each(todasLasCadenas)("$file [$key] no usa voseo", ({ file, key, value }) => {
    const match = value.match(FORMAS_VOSEANTES);
    expect(
      match,
      `Forma voseante "${match?.[0]}" en ${file} [${key}]: "${value}". ` +
        `LEY (MERCADOS.md §3): el copy en español se escribe en neutro, ` +
        `conjugado en "tú" (tienes, puedes, elige), nunca en voseo.`,
    ).toBeNull();
  });
});
