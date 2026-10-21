import {
  customerLabelSchema,
  normalizeCustomerLabel,
  type ReceptionSettings as Settings,
} from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Money } from "@/components/common/money";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import {
  useReceptionEntity,
  useReceptionSettings,
  useUpdateReceptionSettings,
} from "@/lib/reception/settings";
import { useActiveServiceOptions } from "@/lib/services/hooks";
import type { AuthUser } from "@/stores/auth.store";

interface Formulario {
  personalizar: boolean;
  palabra: string;
  showCustomers: boolean;
  showTurns: boolean;
  /** F9-RECEP-28 — los servicios que generan turno al venderse. */
  turnServiceIds: string[];
}

const desdeSettings = (s: Settings): Formulario => ({
  personalizar: s.customerLabel !== null,
  palabra: s.customerLabel ?? "",
  showCustomers: s.showCustomers,
  showTurns: s.showTurns,
  turnServiceIds: s.turnServiceIds,
});

/** Mismos elementos, sin importar el orden: la lista es un conjunto. */
const mismoConjunto = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * F9-RECEP-18 — «Configuración Recepción» en Mi perfil.
 *
 * Como las demás tarjetas del perfil, decide sola si existe: módulo activo
 * y `tenants:manage`. La palabra es UNA, sin espacios (los que se teclean
 * desaparecen), y se previsualiza ya Capitalizada con la MISMA función que
 * usa el API — lo que el admin ve es lo que queda. Guardar manda SOLO lo
 * que cambió; desmarcar «Personalizar» manda `null`: vuelve a la de fábrica.
 *
 * F9-RECEP-28 — y qué servicios generan un turno al VENDERSE en la caja (ley
 * 31). Solo se ofrecen los ACTIVOS; si cambió, se manda la lista COMPLETA
 * (el API la reemplaza). Sin permiso para leer servicios, la sección no
 * aparece: no hay de dónde elegir.
 */
export function ReceptionSettings({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const visible =
    user.subscription.modules.includes("reception") && user.permissions.includes("tenants:manage");
  const { data, isError } = useReceptionSettings(visible);
  const puedeVerServicios = visible && user.permissions.includes("services:read");
  const { data: activos } = useActiveServiceOptions(puedeVerServicios);
  const entidad = useReceptionEntity();
  const update = useUpdateReceptionSettings();
  const [form, setForm] = useState<Formulario | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data !== undefined) {
      setForm(desdeSettings(data));
    }
  }, [data]);

  if (!visible) {
    return null;
  }

  const previsualizacion = form === null ? "" : normalizeCustomerLabel(form.palabra, user.locale);
  const palabraValida = customerLabelSchema.safeParse(previsualizacion).success;

  // La palabra que se pintaría en las casillas del menú: la que se está
  // escribiendo si es válida, si no la vigente.
  const enVivo =
    form?.personalizar && palabraValida
      ? { entity: previsualizacion, entityLower: previsualizacion.toLocaleLowerCase(user.locale) }
      : { entity: entidad.entity, entityLower: entidad.entityLower };

  const cambios = (): Partial<Settings> | null => {
    if (data === undefined || form === null) return {};
    const diff: Partial<Settings> = {};
    const palabraNueva = form.personalizar ? previsualizacion : null;
    if (form.personalizar && !palabraValida) return null;
    if (palabraNueva !== data.customerLabel) diff.customerLabel = palabraNueva;
    if (form.showCustomers !== data.showCustomers) diff.showCustomers = form.showCustomers;
    if (form.showTurns !== data.showTurns) diff.showTurns = form.showTurns;
    // Solo los ACTIVOS que están marcados, en el orden de la lista: uno que se
    // desactivó después de marcarlo se cae al guardar (el API lo rechazaría).
    if (activos !== undefined) {
      const elegidos = activos
        .filter((servicio) => form.turnServiceIds.includes(servicio.id))
        .map((servicio) => servicio.id);
      if (!mismoConjunto(elegidos, data.turnServiceIds)) diff.turnServiceIds = elegidos;
    }
    return diff;
  };

  const alternarServicio = (id: string, marcado: boolean) =>
    setForm((previo) =>
      previo === null
        ? previo
        : {
            ...previo,
            turnServiceIds: marcado
              ? [...previo.turnServiceIds.filter((x) => x !== id), id]
              : previo.turnServiceIds.filter((x) => x !== id),
          },
    );

  return (
    <Card data-testid="reception-settings">
      <CardHeader>
        <CardTitle>{t("reception.settings.title")}</CardTitle>
        <CardDescription>{t("reception.settings.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError && (
          <p role="alert" className="text-destructive text-sm">
            {t("reception.settings.loadFailed")}
          </p>
        )}
        {form !== null && (
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setGuardado(false);
              const diff = cambios();
              if (diff === null) {
                setError(t("reception.settings.labelInvalid"));
                return;
              }
              if (Object.keys(diff).length === 0) return;
              update.mutate(diff, {
                onSuccess: () => setGuardado(true),
                onError: (apiError: ApiError) => setError(apiError.message),
              });
            }}
          >
            <div className="flex items-center gap-3">
              <Checkbox
                id="reception-customize-label"
                aria-label={t("reception.settings.customizeLabel")}
                checked={form.personalizar}
                disabled={update.isPending}
                onCheckedChange={(checked) =>
                  setForm((previo) =>
                    previo === null ? previo : { ...previo, personalizar: checked === true },
                  )
                }
              />
              <Label htmlFor="reception-customize-label">
                {t("reception.settings.customizeLabel")}
              </Label>
            </div>
            {form.personalizar && (
              <TextField
                label={t("reception.settings.labelField")}
                value={form.palabra}
                maxLength={40}
                autoComplete="off"
                hint={t("reception.settings.labelHint", { preview: previsualizacion })}
                onChange={(event) =>
                  setForm((previo) =>
                    previo === null
                      ? previo
                      : // Una sola palabra: los espacios se van al teclearlos.
                        { ...previo, palabra: event.target.value.replace(/\s+/gu, "") },
                  )
                }
              />
            )}

            <p className="font-medium text-sm">{t("reception.settings.menuTitle")}</p>
            {(["showCustomers", "showTurns"] as const).map((casilla) => (
              <div key={casilla} className="flex items-center gap-3">
                <Checkbox
                  id={`reception-${casilla}`}
                  aria-label={t(`reception.settings.${casilla}`, enVivo)}
                  checked={form[casilla]}
                  disabled={update.isPending}
                  onCheckedChange={(checked) =>
                    setForm((previo) =>
                      previo === null ? previo : { ...previo, [casilla]: checked === true },
                    )
                  }
                />
                <Label htmlFor={`reception-${casilla}`}>
                  {t(`reception.settings.${casilla}`, enVivo)}
                </Label>
              </div>
            ))}

            {puedeVerServicios && activos !== undefined && (
              <div className="flex flex-col gap-2" data-testid="reception-turn-services">
                <p className="font-medium text-sm">{t("reception.settings.turnServicesTitle")}</p>
                <p className="text-muted-foreground text-xs">
                  {t("reception.settings.turnServicesHint")}
                </p>
                {activos.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("reception.settings.turnServicesEmpty")}
                  </p>
                ) : (
                  activos.map((servicio) => (
                    <div key={servicio.id} className="flex items-center gap-3">
                      <Checkbox
                        id={`reception-turn-service-${servicio.id}`}
                        aria-label={servicio.name}
                        checked={form.turnServiceIds.includes(servicio.id)}
                        disabled={update.isPending}
                        onCheckedChange={(checked) =>
                          alternarServicio(servicio.id, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`reception-turn-service-${servicio.id}`}
                        className="flex flex-1 items-baseline justify-between gap-3"
                      >
                        <span>{servicio.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          <Money value={servicio.price} />
                        </span>
                      </Label>
                    </div>
                  ))
                )}
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
              >
                {error}
              </p>
            )}
            {guardado && <SuccessNotice>{t("reception.settings.saved")}</SuccessNotice>}
            <div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.form.submitting") : t("reception.settings.save")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
