import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LegalConsentFields } from "@/components/legal/legal-links";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAcceptTerms, useLogout } from "@/lib/auth/hooks";
import { termsEnabled } from "@/lib/legal/terms";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F11-SITE-LEGAL-03 — la pared para quien creó su cuenta ANTES de que los
 * términos existieran.
 *
 * ── Por qué una pared y no un aviso ─────────────────────────────────────
 * Un banner que se puede ignorar no es una aceptación: es un banner. Si de
 * verdad hace falta que alguien acepte para seguir usando el producto, el
 * diálogo no se cierra con Escape, ni con un clic afuera, ni con una X — y el
 * foco no se escapa detrás (ver el modo `dismissible={false}` del `Dialog`).
 *
 * ── La salida que SÍ existe ─────────────────────────────────────────────
 * Cerrar sesión. Nadie queda encerrado en una pantalla sin alternativa: quien
 * no quiera aceptar se va, y eso también es una respuesta válida.
 *
 * ── Dormido no existe ───────────────────────────────────────────────────
 * Con `CURRENT_TERMS_VERSION` en `null` este componente devuelve `null` antes
 * de mirar nada más. Y aunque un API viejo mandara `mustAcceptTerms: true`, el
 * front no pintaría un diálogo que enlaza a unos textos sin publicar: las DOS
 * condiciones tienen que darse.
 */
export function TermsGate() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const navigate = useNavigate();
  const aceptar = useAcceptTerms();
  const logout = useLogout();
  const [error, setError] = useState(false);
  // Las mismas dos casillas del registro: sin las DOS, «Acepto» no se prende.
  const [consent, setConsent] = useState({ terms: false, privacy: false });

  const abierto = termsEnabled() && user?.mustAcceptTerms === true;

  const onAceptar = () => {
    setError(false);
    aceptar.mutate(undefined, {
      // El store es la ÚNICA fuente del diálogo: apagar la bandera acá lo
      // cierra sin esperar a un `GET /me`. El próximo bootstrap traerá lo
      // mismo del servidor, que ya quedó sellado.
      onSuccess: () => {
        if (user) {
          setUser({ ...user, mustAcceptTerms: false });
        }
      },
      onError: () => setError(true),
    });
  };

  const onCerrarSesion = () => {
    // Igual que el menú del header: pase lo que pase con la red, la sesión
    // local se limpia y se sale. Nadie queda atrapado detrás de la pared.
    logout.mutate(undefined, {
      onSettled: () => {
        clearAuth();
        void navigate({ to: "/login", replace: true });
      },
    });
  };

  if (!abierto) {
    return null;
  }

  return (
    <Dialog
      open
      dismissible={false}
      // `onClose` no lo dispara nadie en modo obligatorio; el contrato del
      // componente lo pide igual.
      onClose={() => undefined}
      title={t("auth.legal.gate.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("auth.legal.gate.body")}</p>
        <LegalConsentFields
          terms={consent.terms}
          privacy={consent.privacy}
          onChange={(which, checked) => setConsent((actual) => ({ ...actual, [which]: checked }))}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t("auth.legal.gate.error")}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCerrarSesion} disabled={aceptar.isPending}>
            {t("auth.legal.gate.logout")}
          </Button>
          <Button
            onClick={onAceptar}
            disabled={aceptar.isPending || !consent.terms || !consent.privacy}
          >
            {aceptar.isPending ? t("auth.legal.gate.accepting") : t("auth.legal.gate.accept")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
