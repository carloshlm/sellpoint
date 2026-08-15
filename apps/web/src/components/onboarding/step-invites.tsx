import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { RoleSummary } from "@/lib/rbac/api";
import {
  type InviteRowValues,
  type InvitesStepValues,
  invitesStepSchema,
} from "@/lib/tenant/schemas";

export interface InviteRowResult {
  status: "success" | "error";
  message?: string;
}

interface StepInvitesProps {
  roles: RoleSummary[];
  /** W1 (patrón de `system.users.tsx`): true si `GET /roles` falló. */
  rolesUnavailable?: boolean;
  isSubmitting: boolean;
  /**
   * F1-WEB-ONBOARD-04 (D5, design A6): un `POST /users` por fila
   * (`Promise.allSettled` en el container) — se reporta éxito/error por
   * fila, sin bloquear a las demás. Las filas ya exitosas quedan
   * deshabilitadas y NO se reenvían si el usuario reintenta.
   *
   * W3 (verify-report #357): indexado por `field.id` de `useFieldArray`
   * (estable ante `remove`/`append`), NUNCA por posición del array — borrar
   * una fila corre los índices y desplaza el resultado de la fila siguiente
   * a la posición equivocada.
   */
  rowResults?: Record<string, InviteRowResult>;
  /**
   * F1-WEB-ONBOARD-05: error de `POST /tenants/me/complete-onboarding`
   * (network u otro 5xx) al cerrar el wizard desde "Enviar invitaciones" u
   * "Omitir" — las filas mismas ya se resolvieron OK, esto es el paso
   * siguiente fallando.
   */
  finishError?: string;
  /** W3: cada fila viaja con SU `field.id` — la clave estable de `rowResults`. */
  onSubmit: (rows: (InviteRowValues & { id: string })[]) => void;
  /** D6 (#347): "Omitir" avanza SIN validar ni requerir filas completas. */
  onSkip: () => void;
}

function emptyRow(): InviteRowValues {
  return { email: "", firstName: "", lastNamePaternal: "", roleId: "" };
}

/**
 * F1-WEB-ONBOARD-04, paso 4 (CU-AUTH-02, skippable D6). Filas dinámicas
 * email+nombre+rol (D5): reusa las mismas reglas obligatorias que
 * `userFormSchema` (lib/rbac/schemas.ts) vía `invitesStepSchema`
 * (lib/tenant/schemas.ts) — "sin relajar el DTO". El submit real (`POST
 * /users` por fila) lo hace el container (`routes/onboarding.tsx`); acá
 * solo se emiten `onSubmit(rows)`/`onSkip()`.
 */
function StepInvites({
  roles,
  rolesUnavailable = false,
  isSubmitting,
  rowResults = {},
  finishError,
  onSubmit,
  onSkip,
}: StepInvitesProps) {
  const { t } = useTranslation();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvitesStepValues>({
    resolver: zodResolver(invitesStepSchema),
    defaultValues: { rows: [emptyRow()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });

  // W3: `fields` y `values.rows` viajan en el MISMO orden (ambos derivan del
  // mismo campo de array) — zipear por posición acá es seguro porque es
  // instantáneo (no sobrevive a un remove/append entre medio); lo que NUNCA
  // debe viajar por posición es el resultado GUARDADO en `rowResults`.
  const submit = handleSubmit((values) => {
    const rows = values.rows.flatMap((row, index) => {
      const field = fields[index];
      return field ? [{ id: field.id, ...row }] : [];
    });
    onSubmit(rows);
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="step-invites">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step4.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step4.subtitle")}</p>
      </div>
      {rolesUnavailable && (
        <p role="alert" className="text-xs text-destructive">
          {t("onboarding.step4.rolesUnavailable")}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {fields.map((field, index) => {
          const result = rowResults[field.id];
          const rowDone = result?.status === "success";
          const rowErrors = errors.rows?.[index];
          return (
            <div
              key={field.id}
              className="flex flex-col gap-3 rounded-md border p-3"
              data-testid={`invite-row-${index}`}
              data-field-id={field.id}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t("onboarding.step4.email")}
                  type="email"
                  disabled={rowDone}
                  error={rowErrors?.email?.message ? t(rowErrors.email.message) : undefined}
                  {...register(`rows.${index}.email` as const)}
                />
                <TextField
                  label={t("onboarding.step4.firstName")}
                  disabled={rowDone}
                  error={rowErrors?.firstName?.message ? t(rowErrors.firstName.message) : undefined}
                  {...register(`rows.${index}.firstName` as const)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t("onboarding.step4.lastNamePaternal")}
                  disabled={rowDone}
                  error={
                    rowErrors?.lastNamePaternal?.message
                      ? t(rowErrors.lastNamePaternal.message)
                      : undefined
                  }
                  {...register(`rows.${index}.lastNamePaternal` as const)}
                />
                <SelectField
                  label={t("onboarding.step4.role")}
                  disabled={rowDone}
                  error={rowErrors?.roleId?.message ? t(rowErrors.roleId.message) : undefined}
                  options={[
                    { value: "", label: t("onboarding.step4.roleSelectPlaceholder") },
                    ...roles.map((role) => ({ value: role.id, label: role.name })),
                  ]}
                  {...register(`rows.${index}.roleId` as const)}
                />
              </div>
              {result?.status === "success" && (
                <p data-testid={`invite-row-${index}-success`} className="text-xs text-success">
                  {t("onboarding.step4.rowSuccess")}
                </p>
              )}
              {result?.status === "error" && (
                <p
                  role="alert"
                  data-testid={`invite-row-${index}-error`}
                  className="text-xs text-destructive"
                >
                  {result.message ?? t("onboarding.step4.rowError")}
                </p>
              )}
              {fields.length > 1 && !rowDone && (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
                    {t("onboarding.step4.removeRow")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <Button type="button" variant="outline" onClick={() => append(emptyRow())}>
          {t("onboarding.step4.addRow")}
        </Button>
      </div>
      {finishError && (
        <p role="alert" className="text-xs text-destructive">
          {finishError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("common.form.submitting") : t("onboarding.step4.sendInvites")}
        </Button>
        <Button type="button" variant="outline" onClick={() => onSkip()} disabled={isSubmitting}>
          {t("onboarding.step4.skip")}
        </Button>
      </div>
    </form>
  );
}

export { StepInvites };
