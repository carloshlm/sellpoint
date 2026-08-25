import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemePicker } from "@/components/theme/theme-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import { applyTheme } from "@/lib/theme/apply-theme";
import { resolveTheme, type ThemeId } from "@/lib/theme/themes";
import type { AuthUser } from "@/stores/auth.store";

/**
 * El tema desde Mi perfil (Carlos, 2026-08-26) — la promesa que el wizard
 * hace en su paso 3 («podrás cambiarlo cuando quieras desde Mi perfil»).
 *
 * OPTIMISTA como el selector de idioma: el clic re-pinta la app AL MOMENTO
 * y el PATCH viaja detrás. Si el servidor lo rechaza, el tema REVIERTE al
 * que estaba — la pantalla nunca queda mintiendo un tema que no se guardó.
 * El resync del hook trae el tenant fresco y la suscripción global
 * (tenant-theme-sync) no lo pisa: solo reacciona si el valor CAMBIÓ.
 *
 * Con `tenants:manage` solamente: el tema es del NEGOCIO, no de la persona
 * — mismo criterio que la tarjeta de Datos del negocio.
 */
function ThemePreference({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const updateTenant = useUpdateMyTenant();
  const [error, setError] = useState<string | null>(null);
  // El valor optimista vive acá: el store se pone al día con el resync.
  const [selected, setSelected] = useState<ThemeId>(resolveTheme(user.tenant.theme));

  if (!user.permissions.includes("tenants:manage")) {
    return null;
  }

  function handleChange(theme: ThemeId) {
    const previous = selected;
    setError(null);
    setSelected(theme);
    applyTheme(theme);
    updateTenant.mutate(
      { theme },
      {
        onError: (apiError: ApiError) => {
          setSelected(previous);
          applyTheme(previous);

          setError(apiError.statusCode === 0 ? t("common.errors.network") : apiError.message);
        },
      },
    );
  }

  return (
    <Card data-testid="theme-preference">
      <CardHeader>
        <CardTitle>{t("common.theme.title")}</CardTitle>
        <CardDescription>{t("common.theme.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p
            role="alert"
            data-testid="theme-preference-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}
        <ThemePicker value={selected} onChange={handleChange} disabled={updateTenant.isPending} />
      </CardContent>
    </Card>
  );
}

export { ThemePreference };
