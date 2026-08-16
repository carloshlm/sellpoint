import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useCreateWarehouse, useWarehouses } from "@/lib/warehouses/hooks";

interface StepWarehouseProps {
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: () => void;
}

/**
 * F2-ONBOARD-03, paso 3 — ahora crea un almacén REAL.
 *
 * En F1 era un placeholder informativo porque la tabla `warehouses` no
 * existía. Con F2-DB-07 existe, así que el paso hace lo que su título dice.
 *
 * Consecuencia en la derivación del paso (`lib/tenant/steps.ts`): el piso del
 * wizard pasa a depender de "¿existe al menos un almacén?" en vez de saltar
 * de 2 a 4. Un tenant que ya terminó el onboarding en Fase 1 y no tiene
 * almacén vuelve a caer acá — deliberado: sin almacén no puede haber stock.
 */
function StepWarehouse({ isSubmitting, formError, onSubmit }: StepWarehouseProps) {
  const { t } = useTranslation();
  const { data: warehouses } = useWarehouses();
  const createWarehouse = useCreateWarehouse();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existing = warehouses ?? [];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Si ya hay uno (por ejemplo al volver atrás en el wizard), no se crea
    // otro: se avanza.
    if (existing.length > 0 && !name.trim()) {
      onSubmit();
      return;
    }

    createWarehouse.mutate(
      { name },
      {
        onSuccess: () => onSubmit(),
        onError: (apiError: ApiError) => setError(apiError.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="step-warehouse">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step3.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step3.subtitle")}</p>
      </div>

      {(formError || error) && (
        <p
          role="alert"
          data-testid="step-warehouse-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError ?? error}
        </p>
      )}

      {existing.length > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="step-warehouse-existing">
          {t("onboarding.step3.existing", { name: existing[0]?.name })}
        </p>
      ) : (
        <TextField
          label={t("onboarding.step3.name")}
          hint={t("onboarding.step3.nameHint")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      )}

      <div>
        <Button
          type="submit"
          disabled={
            isSubmitting || createWarehouse.isPending || (existing.length === 0 && !name.trim())
          }
        >
          {isSubmitting || createWarehouse.isPending
            ? t("common.form.submitting")
            : t("onboarding.step3.continue")}
        </Button>
      </div>
    </form>
  );
}

export { StepWarehouse };
