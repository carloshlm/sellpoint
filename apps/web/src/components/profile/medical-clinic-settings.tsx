import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import type { MedicalClinicSettings as Settings } from "@/lib/medical-clinic/api";
import {
  useMedicalClinicSettings,
  useUpdateMedicalClinicSettings,
} from "@/lib/medical-clinic/hooks";
import type { AuthUser } from "@/stores/auth.store";

const CASILLAS: (keyof Settings)[] = [
  "sellsMedications",
  "sellsLabStudies",
  "sellsDiagnosticStudies",
];

/**
 * F9-CLINIC-WEB-21 — «Configuración Consultorio Médico» en Mi perfil.
 *
 * Como las demás tarjetas del perfil, decide sola si existe: solo con el
 * módulo activo y `tenants:manage` (es configuración del NEGOCIO, la misma
 * llave que «Datos del negocio»). Guardar manda SOLO lo que cambió.
 */
export function MedicalClinicSettings({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const visible =
    user.subscription.modules.includes("medical_clinic") &&
    user.permissions.includes("tenants:manage");
  const { data, isError } = useMedicalClinicSettings(visible);
  const update = useUpdateMedicalClinicSettings();
  const [valores, setValores] = useState<Settings | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data !== undefined) {
      setValores(data);
    }
  }, [data]);

  if (!visible) {
    return null;
  }

  const cambios = () => {
    if (data === undefined || valores === null) return {};
    return Object.fromEntries(
      CASILLAS.filter((k) => valores[k] !== data[k]).map((k) => [k, valores[k]]),
    ) as Partial<Settings>;
  };

  return (
    <Card data-testid="medical-clinic-settings">
      <CardHeader>
        <CardTitle>{t("medicalClinic.settings.title")}</CardTitle>
        <CardDescription>{t("medicalClinic.settings.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError && (
          <p role="alert" className="text-destructive text-sm">
            {t("medicalClinic.settings.loadFailed")}
          </p>
        )}
        {valores !== null && (
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setGuardado(false);
              const diff = cambios();
              if (Object.keys(diff).length === 0) return;
              update.mutate(diff, {
                onSuccess: () => setGuardado(true),
                onError: (apiError: ApiError) => setError(apiError.message),
              });
            }}
          >
            {CASILLAS.map((casilla) => (
              <div key={casilla} className="flex items-center gap-3">
                <Checkbox
                  id={`clinic-${casilla}`}
                  aria-label={t(`medicalClinic.settings.${casilla}`)}
                  checked={valores[casilla]}
                  disabled={update.isPending}
                  onCheckedChange={(checked) =>
                    setValores((previo) =>
                      previo === null ? previo : { ...previo, [casilla]: checked === true },
                    )
                  }
                />
                <Label htmlFor={`clinic-${casilla}`}>
                  {t(`medicalClinic.settings.${casilla}`)}
                </Label>
              </div>
            ))}
            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
              >
                {error}
              </p>
            )}
            {guardado && <SuccessNotice>{t("medicalClinic.settings.saved")}</SuccessNotice>}
            <div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.form.submitting") : t("medicalClinic.settings.save")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
