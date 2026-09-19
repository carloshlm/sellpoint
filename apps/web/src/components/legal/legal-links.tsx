import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { legalLinks, localeFromI18n } from "@/lib/legal/terms";

/** Los dos consentimientos del alta: los términos y el aviso de privacidad. */
export type LegalConsent = "terms" | "privacy";

interface LegalConsentFieldsProps {
  terms: boolean;
  privacy: boolean;
  onChange: (consent: LegalConsent, checked: boolean) => void;
  /** Clave i18n del error de cada casilla, si la tiene. */
  errors?: Partial<Record<LegalConsent, string>>;
}

/**
 * F11-SITE-LEGAL-02/03 — las DOS casillas de lo legal, cada una con su enlace:
 * «Acepto los Términos y condiciones» y «Confirmo que leí y acepto el Aviso de
 * privacidad».
 *
 * ── Por qué dos y no una (Carlos, 2026-09-19) ───────────────────────────
 * SellPointy se vende en México, Estados Unidos y Canadá, y son dos actos
 * distintos: los términos son un contrato que se ACEPTA; el aviso de
 * privacidad es un documento que se reconoce LEÍDO. Una sola casilla para los
 * dos es el consentimiento «en paquete» que las leyes de privacidad —la de
 * Quebec, la más estricta de las tres— piden evitar.
 *
 * Vive suelto y sin estado porque lo comparten el registro (que lo maneja con
 * react-hook-form) y el diálogo de quien ya tiene cuenta (con un `useState`):
 * son el MISMO texto, y dos copias serían dos textos que un día dirán cosas
 * distintas.
 *
 * ── Por qué tres claves por casilla y no una ────────────────────────────
 * Cada frase lleva un enlace EN MEDIO, así que se parte en prefijo, enlace y
 * cierre. Es menos bonito que una sola clave con marcado adentro, pero deja
 * el texto traducible sin meter HTML en los JSON.
 *
 * Los enlaces abren en pestaña nueva con `rel="noopener"`: quien está
 * llenando el registro no puede perder lo que ya escribió por leer un texto
 * legal, y una pestaña abierta con `target="_blank"` sin `noopener` le da a la
 * página destino una referencia a la nuestra.
 */
export function LegalConsentFields({ terms, privacy, onChange, errors }: LegalConsentFieldsProps) {
  const { t, i18n } = useTranslation();
  const links = legalLinks(localeFromI18n(i18n.language));

  const claseEnlace = "font-medium text-primary underline underline-offset-4 hover:no-underline";
  const casillas: { consent: LegalConsent; checked: boolean; href: string }[] = [
    { consent: "terms", checked: terms, href: links.terms },
    { consent: "privacy", checked: privacy, href: links.privacy },
  ];

  return (
    <div className="flex flex-col gap-3">
      {casillas.map(({ consent, checked, href }) => {
        const id = `accept-${consent}`;
        const error = errors?.[consent];
        return (
          <div key={consent} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={checked}
                onCheckedChange={(value) => onChange(consent, value === true)}
              />
              <Label htmlFor={id} className="text-sm font-normal leading-snug">
                {/* Un solo hijo: `Label` es flex con separación, y suelta cada
                    pedazo de la frase —texto, enlace, punto— como una pieza
                    aparte. Dentro del <span> vuelve a ser una oración. */}
                <span>
                  {t(`auth.legal.${consent}.prefix`)}
                  <a href={href} target="_blank" rel="noopener" className={claseEnlace}>
                    {t(`auth.legal.${consent}.link`)}
                  </a>
                  {t(`auth.legal.${consent}.suffix`)}
                </span>
              </Label>
            </div>
            {error && <p className="text-sm text-destructive">{t(error)}</p>}
          </div>
        );
      })}
    </div>
  );
}
