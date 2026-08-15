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
   * ÍNDICE de fila, sin bloquear a las demás. Las filas ya exitosas quedan
   * deshabilitadas y NO se reenvían si el usuario reintenta.
   */
  rowResults?: Record<number, InviteRowResult>;
  onSubmit: (rows: InviteRowValues[]) => void;
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

  const submit = handleSubmit((values) => onSubmit(values.rows));

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
          const result = rowResults[index];
          const rowDone = result?.status === "success";
          const rowErrors = errors.rows?.[index];
          return (
            <div
              key={field.id}
              className="flex flex-col gap-3 rounded-md border p-3"
              data-testid={`invite-row-${index}`}
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
