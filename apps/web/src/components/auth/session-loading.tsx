import { useTranslation } from "react-i18next";

/**
 * Estado de carga NEUTRO mientras el bootstrap de sesión decide si la cookie
 * de refresh sigue viva. Presentacional puro: sin él, un usuario logueado
 * vería un flash de /login en cada reload. Solo tokens de marca — el spinner
 * hereda el color primario del tenant.
 */
function SessionLoading() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh items-center justify-center bg-background"
    >
      <span
        className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <span className="sr-only">{t("common.session.loading")}</span>
    </div>
  );
}

export { SessionLoading };
