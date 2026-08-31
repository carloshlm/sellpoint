import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * "No pudimos confirmar tu sesión" — el estado que ANTES era un login.
 *
 * Cuando el arranque falla por algo temporal (el límite de volumen tras
 * recargar rápido, un 5xx, la red), la cookie de refresh sigue siendo válida:
 * lo único que pasó es que ahora no se pudo preguntar. Mandar a /login ahí es
 * mentirle al usuario —su sesión no expiró— y hacerle perder lo que
 * estuviera haciendo.
 *
 * Recargar es la acción correcta y la única que hace falta: el bootstrap
 * corre una vez por carga de página, así que un reload reintenta limpio.
 */
export function SessionUnavailable() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      data-testid="session-unavailable"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="font-medium text-lg">{t("common.session.unavailableTitle")}</p>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("common.session.unavailableBody")}
      </p>
      <Button type="button" onClick={() => window.location.reload()}>
        {t("common.session.retry")}
      </Button>
    </div>
  );
}
