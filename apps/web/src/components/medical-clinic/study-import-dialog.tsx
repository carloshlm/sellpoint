import { ImportDialog } from "@/components/common/import-dialog";
import type { StudyKind } from "@/lib/medical-clinic/api";
import {
  downloadStudyImportTemplate,
  readStudyImportFile,
  runStudyImport,
} from "@/lib/medical-clinic/import-api";

/**
 * Importar ESTUDIOS (Carlos, 2026-09-04): el diálogo genérico de la casa —el
 * mismo de servicios, productos y almacenes— con los endpoints y textos del
 * catálogo que toque. Acá solo vive lo que es del consultorio.
 */
export function StudyImportDialog({ kind, onClose }: { kind: StudyKind; onClose: () => void }) {
  return (
    <ImportDialog
      testIdPrefix={`${kind}-study-import`}
      i18nPrefix={`medicalClinic.studies.${kind}.import`}
      downloadTemplate={downloadStudyImportTemplate(kind)}
      run={runStudyImport(kind)}
      readFile={readStudyImportFile}
      invalidate={[["medical-clinic", "studies", kind]]}
      onClose={onClose}
    />
  );
}
