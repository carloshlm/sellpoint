import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthUser } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-10 (presentacional): los datos del usuario tal como están en el
 * store. Read-only por ahora — editar nombre/email no está en Fase 1; el
 * único dato mutable de este perfil es el idioma, que vive en su propio
 * bloque de Preferencias.
 */
function ProfileDetails({ user }: { user: AuthUser }) {
  const { t } = useTranslation();

  const rows = [
    { label: t("common.profile.details.name"), value: user.firstName },
    { label: t("common.profile.details.email"), value: user.email },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("common.profile.details.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2" data-testid="profile-details">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="text-sm font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export { ProfileDetails };
