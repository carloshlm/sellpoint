import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Guardar / Cancelar al pie de un formulario de sección; en solo lectura, solo «Volver». */
export function SectionFormActions({
  readOnly,
  busy,
  onCancel,
}: {
  readOnly: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        {t("common.form.cancel")}
      </Button>
      {readOnly ? null : (
        <Button type="submit" disabled={busy}>
          {t("common.form.save")}
        </Button>
      )}
    </div>
  );
}
