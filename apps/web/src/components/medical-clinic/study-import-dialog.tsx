import { useTranslation } from "react-i18next";
import { ImportDialog } from "@/components/common/import-dialog";
import type { StudyKind } from "@/lib/medical-clinic/api";
import {
  downloadStudyImportTemplate,
  readStudyImportFile,
  runStudyImport,
} from "@/lib/medical-clinic/import-api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Importar ESTUDIOS (Carlos, 2026-09-04): el diálogo genérico de la casa —el
 * mismo de servicios, productos y almacenes— con los endpoints y textos del
 * catálogo que toque. Acá solo vive lo que es del consultorio.
 */
export function StudyImportDialog({ kind, onClose }: { kind: StudyKind; onClose: () => void }) {
  const { t } = useTranslation();
  const costTaxMode = useAuthStore((state) => state.user?.tenant?.costTaxMode ?? "excluded");
  return (
    <ImportDialog
      testIdPrefix={`${kind}-study-import`}
      i18nPrefix={`medicalClinic.studies.${kind}.import`}
      note={t(
        `medicalClinic.studies.${kind}.import.${
          costTaxMode === "included" ? "costBasisIncluded" : "costBasisExcluded"
        }`,
      )}
      downloadTemplate={downloadStudyImportTemplate(kind)}
      run={runStudyImport(kind)}
      readFile={readStudyImportFile}
      invalidate={[["medical-clinic", "studies", kind]]}
      onClose={onClose}
    />
  );
}
