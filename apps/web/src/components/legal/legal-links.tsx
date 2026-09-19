import { useTranslation } from "react-i18next";
import { legalLinks, localeFromI18n } from "@/lib/legal/terms";

/**
 * F11-SITE-LEGAL-02/03 — «Acepto los Términos y el Aviso de privacidad», con
 * sus dos enlaces.
 *
 * Vive suelto porque lo comparten la casilla del registro y el diálogo de
 * quien ya tiene cuenta: son el MISMO texto, y dos copias serían dos textos
 * que un día dirán cosas distintas.
 *
 * ── Por qué cuatro claves y no una ──────────────────────────────────────
 * La frase lleva dos enlaces EN MEDIO, así que se parte en prefijo, enlace,
 * separador y enlace. Es menos bonito que una sola clave con marcado adentro,
 * pero deja el texto traducible sin meter HTML en los JSON — y el orden de las
 * cuatro piezas funciona igual en español que en inglés.
 *
 * Los enlaces abren en pestaña nueva con `rel="noopener"`: quien está
 * llenando el registro no puede perder lo que ya escribió por leer un texto
 * legal, y una pestaña abierta con `target="_blank"` sin `noopener` le da a la
 * página destino una referencia a la nuestra.
 */
export function LegalAcceptanceText() {
  const { t, i18n } = useTranslation();
  const { terms, privacy } = legalLinks(localeFromI18n(i18n.language));

  const claseEnlace = "font-medium text-primary underline underline-offset-4 hover:no-underline";

  return (
    <>
      {t("auth.legal.acceptPrefix")}
      <a href={terms} target="_blank" rel="noopener" className={claseEnlace}>
        {t("auth.legal.termsLink")}
      </a>
      {t("auth.legal.acceptSeparator")}
      <a href={privacy} target="_blank" rel="noopener" className={claseEnlace}>
        {t("auth.legal.privacyLink")}
      </a>
    </>
  );
}
