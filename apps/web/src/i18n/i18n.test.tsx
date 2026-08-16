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
 * IDIOMA DE LA PRIMERA VISITA (decisión de Carlos, 2026-08-16).
 *
 * Las pantallas públicas arrancan en INGLÉS aunque la mayoría de los clientes
 * sean de México. Es una decisión de producto, no un descuido: por eso el
 * detector NO mira `navigator`. Si lo mirara, un navegador en español vería
 * español y la decisión sería letra muerta.
 */
describe("idioma inicial de la app (instancia con detector)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("arranca en inglés cuando todavía nadie eligió idioma", () => {
    const i18n = createI18n({ withDetector: true });

    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("respeta la elección previa de la persona por encima del arranque en inglés", () => {
    localStorage.setItem("sellpoint.locale", "es");

    const i18n = createI18n({ withDetector: true });

    expect(i18n.resolvedLanguage).toBe("es");
  });

  it("ignora el idioma del navegador: uno en español sigue viendo inglés", () => {
    Object.defineProperty(window.navigator, "languages", {
      value: ["es-MX", "es"],
      configurable: true,
    });
    Object.defineProperty(window.navigator, "language", {
      value: "es-MX",
      configurable: true,
    });

    const i18n = createI18n({ withDetector: true });

    expect(i18n.resolvedLanguage).toBe("en");
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

// Presente de indicativo voseante. Solo formas que NO existen en tuteo: "estás"
// y "vas" quedan fuera a propósito porque son idénticas en ambos registros.
const VOSEO_PRESENTE = [
  "sos",
  "podés",
  "tenés",
  "querés",
  "necesitás",
  "sabés",
  "debés",
  "hacés",
  "ponés",
  "venís",
  "salís",
  "decís",
  "elegís",
  "escribís",
  "seguís",
  "pedís",
  "abrís",
  "recibís",
  "subís",
  "vivís",
  "imprimís",
  "preferís",
];

// Imperativo afirmativo voseante (vocal final tónica). El acento es lo que los
// distingue del tuteo: "revisá" vs "revisa", "creá" vs "crea".
//
// Compromiso conocido: las formas en -í ("pedí", "seguí", "definí", "abrí"…)
// coinciden con el pretérito de primera persona del español estándar ("yo
// pedí"). Se aceptan igual porque la primera persona no aparece en copy de
// UI —que habla de "tú" o en tercera— y preferimos un falso positivo (que se
// resuelve reescribiendo la frase) antes que dejar pasar voseo real.
const VOSEO_IMPERATIVO = [
  "activá",
  "agregá",
  "andá",
  "abrí",
  "buscá",
  "cambiá",
  "cerrá",
  "completá",
  "confirmá",
  "configurá",
  "contactá",
  "creá",
  "definí",
  "dejá",
  "descargá",
  "editá",
  "elegí",
  "eliminá",
  "empezá",
  "entrá",
  "enviá",
  "esperá",
  "filtrá",
  "generá",
  "guardá",
  "hacé",
  "ignorá",
  "imprimí",
  "iniciá",
  "ingresá",
  "instalá",
  "intentá",
  "llená",
  "marcá",
  "mirá",
  "ordená",
  "pagá",
  "pedí",
  "poné",
  "probá",
  "publicá",
  "quitá",
  "recargá",
  "registrá",
  "reintentá",
  "repetí",
  "restablecé",
  "revisá",
  "sacá",
  "seguí",
  "seleccioná",
  "subí",
  "sumá",
  "tené",
  "tocá",
  "tomá",
  "usá",
  "vendé",
  "vení",
  "verificá",
  "volvé",
  "actualizá",
  "escribí",
];

// Imperativo + pronombre enclítico: el acento se pierde al pegarse el pronombre
// ("fijate", "contanos"), así que estas formas no las caza el patrón de arriba.
const VOSEO_ENCLITICO = [
  "abrilo",
  "abrila",
  "acordate",
  "andate",
  "avisame",
  "avisanos",
  "ayudame",
  "ayudanos",
  "contame",
  "contanos",
  "decime",
  "decinos",
  "dejame",
  "dejanos",
  "enviame",
  "envianos",
  "escribime",
  "escribinos",
  "fijate",
  "logueate",
  "mandame",
  "mandanos",
  "mostrame",
  "mostranos",
  "pedile",
  "pedime",
  "pedinos",
  "quedate",
  "registrate",
  "seguinos",
  "sumate",
  "suscribite",
];

// Pronombre y muletilla rioplatense.
const VOSEO_PRONOMBRE = ["vos", "dale"];

const FORMAS_VOSEANTES = new RegExp(
  `(?<!${LETRA})(${[
    ...VOSEO_PRESENTE,
    ...VOSEO_IMPERATIVO,
    ...VOSEO_ENCLITICO,
    ...VOSEO_PRONOMBRE,
  ].join("|")})(?!${LETRA})`,
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

/**
 * El guardián también se prueba. Sin esto, un patrón roto (como el `\b` que
 * falla tras vocal acentuada) dejaría pasar todo mientras la suite sigue en
 * verde: exactamente el modo de falla que este archivo existe para evitar.
 */
describe("el detector de voseo funciona (guardián del guardián)", () => {
  const DEBE_DETECTAR = [
    ["presente", "No tenés permiso para ver esta sección."],
    ["presente sin tuteo equivalente", "Vos sos el administrador."],
    ["presente en -ís", "Si no recibís el correo, revisa tu carpeta de spam."],
    ["imperativo", "Elegí un país de la lista."],
    ["imperativo tras acento (el caso del \\b)", "Revisá tu correo."],
    ["imperativo nuevo", "Entrá con tu cuenta y definí una contraseña."],
    ["enclítico", "¿Necesitas otra moneda? Escribinos y la habilitamos."],
    ["enclítico sin acento", "Fijate que el total incluya impuestos."],
    ["muletilla", "Dale, continuemos."],
    ["mayúscula inicial", "Probá de nuevo más tarde."],
  ] as const;

  it.each(DEBE_DETECTAR)("detecta voseo (%s)", (_caso, texto) => {
    expect(texto.match(FORMAS_VOSEANTES)).not.toBeNull();
  });

  const NO_DEBE_DETECTAR = [
    ["tuteo equivalente", "No tienes permiso para ver esta sección."],
    ["imperativos de tú", "Elige un país, revisa tu correo e intenta de nuevo."],
    ["formas idénticas en ambos registros", "Estás a un paso: ya vas por la mitad."],
    ["palabras agudas comunes", "El café está aquí, así que también sirve."],
    ["verbos de tú sin acento", "El sistema crea, usa y paga la suscripción."],
    ["voseo como subcadena de otra palabra", "Nosotros usamos el valor previo."],
    ["'vos' dentro de palabra", "Convoso no es una palabra, pero no debe saltar."],
  ] as const;

  it.each(NO_DEBE_DETECTAR)("no marca español neutro (%s)", (_caso, texto) => {
    expect(texto.match(FORMAS_VOSEANTES)).toBeNull();
  });
});

describe("voz de la UI — español neutro, nunca voseo (LEY)", () => {
  const ES_DIRS = [join(__dirname, "es"), join(__dirname, "../../../api/src/i18n/es")] as const;

  const todasLasCadenas = ES_DIRS.flatMap((dir) => loadJsonFiles(dir));

  // UN test, no uno por cadena: recorre todo y reporta TODAS las violaciones
  // juntas. Un `it.each` sobre ~345 cadenas infla la suite y obliga a leer los
  // fallos de a uno; acá el mensaje trae la lista completa de una vez.
  it("ninguna cadena en español usa voseo", () => {
    expect(todasLasCadenas.length).toBeGreaterThan(0);

    const violaciones = todasLasCadenas
      .map(({ file, key, value }) => ({ file, key, value, match: value.match(FORMAS_VOSEANTES) }))
      .filter((entry) => entry.match !== null)
      .map(({ file, key, value, match }) => `  · "${match?.[0]}" en ${file} [${key}]: "${value}"`);

    expect(
      violaciones,
      `${violaciones.length} forma(s) voseante(s) en el copy en español:\n${violaciones.join("\n")}\n` +
        `LEY (MERCADOS.md §3): el copy en español se escribe en neutro, ` +
        `conjugado en "tú" (tienes, puedes, elige), nunca en voseo.`,
    ).toEqual([]);
  });
});
