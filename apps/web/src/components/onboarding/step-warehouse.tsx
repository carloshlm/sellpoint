import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useCreateWarehouse, useUpdateWarehouse, useWarehouses } from "@/lib/warehouses/hooks";

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
  const updateWarehouse = useUpdateWarehouse();
  const [error, setError] = useState<string | null>(null);

  const existing = warehouses ?? [];
  const actual = existing[0];

  // F3-HOME-03: el tenant NACE con su almacén (`provision()` lo crea), así que
  // este paso pasó de CREAR a RENOMBRAR. El input arranca con el nombre actual
  // y solo se manda un PATCH si cambió — un negocio de distribución escribe
  // "CEDIS" acá y sigue. El caso "no hay ninguno" queda como red por si un
  // tenant viejo llega sin él.
  const [name, setName] = useState(actual?.name ?? "");
  const nameRef = useRef(false);
  useEffect(() => {
    if (nameRef.current || actual === undefined) {
      return;
    }
    nameRef.current = true;
    setName(actual.name);
  }, [actual]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const nuevo = name.trim();

    if (actual !== undefined) {
      if (nuevo === "" || nuevo === actual.name) {
        onSubmit();
        return;
      }
      updateWarehouse.mutate(
        { id: actual.id, input: { name: nuevo } },
        {
          onSuccess: () => onSubmit(),
          onError: (apiError: ApiError) => setError(apiError.message),
        },
      );
      return;
    }

    createWarehouse.mutate(
      { name: nuevo },
      {
        onSuccess: () => onSubmit(),
        onError: (apiError: ApiError) => setError(apiError.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="step-warehouse">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step2.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step2.subtitle")}</p>
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

      <TextField
        label={t("onboarding.step2.name")}
        hint={t("onboarding.step2.nameHint")}
        value={name}
        onChange={(event) => setName(event.target.value)}
        data-testid="step-warehouse-name"
      />

      <div>
        <Button
          type="submit"
          disabled={
            isSubmitting || createWarehouse.isPending || updateWarehouse.isPending || !name.trim()
          }
        >
          {isSubmitting || createWarehouse.isPending || updateWarehouse.isPending
            ? t("common.form.submitting")
            : t("onboarding.step2.continue")}
        </Button>
      </div>
    </form>
  );
}

export { StepWarehouse };
