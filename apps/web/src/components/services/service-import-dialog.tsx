import { useTranslation } from "react-i18next";
import { ImportDialog } from "@/components/common/import-dialog";
import {
  downloadServiceImportTemplate,
  readServiceImportFile,
  runServiceImport,
} from "@/lib/services/import-api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Importar SERVICIOS (Carlos, 2026-09-01): el diálogo genérico de la casa con
 * los endpoints y textos de servicios. Nació como copia del de productos;
 * cuando almacenes y subcatálogos pidieron el suyo, la copia se volvió el
 * `ImportDialog` común y esto quedó en lo único que es de servicios.
 */
function ServiceImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const costTaxMode = useAuthStore((state) => state.user?.tenant?.costTaxMode ?? "excluded");
  return (
    <ImportDialog
      testIdPrefix="service-import"
      i18nPrefix="services.import"
      note={t(
        costTaxMode === "included"
          ? "services.import.costBasisIncluded"
          : "services.import.costBasisExcluded",
      )}
      downloadTemplate={downloadServiceImportTemplate}
      run={runServiceImport}
      readFile={readServiceImportFile}
      invalidate={[["services"]]}
      onClose={onClose}
    />
  );
}

export { ServiceImportDialog };
