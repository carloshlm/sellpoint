import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * F1-WEB-ONBOARD-03, paso 3 (CU-AUTH-02). Placeholder de almacén — el CRUD
 * real (nombre, dirección, etc.) es F2 (D2, #347), acá SOLO hay un mensaje
 * informativo y "Continuar". Sin formulario, sin datos de almacén.
 *
 * El container (`routes/onboarding.tsx`) persiste `warehouseStepSeen: true`
 * vía `PATCH /tenants/me` en el `onSubmit` — NO es dato real de almacén, es
 * la única señal server-side de que este paso ya se recorrió (apply-progress
 * Deviation 6). Ese PATCH es el único "rastro" que deja este paso; el resto
 * (nombre/dirección de almacén) sigue fuera de alcance.
 */
interface StepWarehouseProps {
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: () => void;
}

function StepWarehouse({ isSubmitting, formError, onSubmit }: StepWarehouseProps) {
  const { t } = useTranslation();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="step-warehouse">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step3.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step3.subtitle")}</p>
      </div>
      {formError && (
        <p
          role="alert"
          data-testid="step-warehouse-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("common.form.submitting") : t("onboarding.step3.continue")}
        </Button>
      </div>
    </form>
  );
}

export { StepWarehouse };
