import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import { useCreateDocument, useDocuments } from "@/lib/inventory/hooks";
import type { DocumentStatus, InventoryDocumentType } from "@/lib/inventory/types";
import { WarehouseSelect } from "./warehouse-select";

interface DocumentListProps {
  type: InventoryDocumentType;
}

/** Cuánto esperar antes de buscar. Suficiente para tipear un folio de 6 dígitos. */
const DEBOUNCE_MS = 300;

/**
 * Las chips van en PLURAL y el badge de la fila en singular: una chip filtra
 * un CONJUNTO ("Anulados") y un badge nombra UN documento ("Anulado"). Reusar
 * la misma clave haría que uno de los dos sonara mal, y el plural es un dato,
 * no una regla que se pueda derivar.
 */
const CHIPS: { status: DocumentStatus | undefined; label: string }[] = [
  { status: undefined, label: "inventory.filter.active" },
  { status: "draft", label: "inventory.filter.drafts" },
  { status: "confirmed", label: "inventory.filter.confirmed" },
  { status: "canceled", label: "inventory.filter.canceled" },
];

/**
 * F3-DOC-08 — el listado de una serie.
 *
 * **El mismo componente sirve a Entradas, Salidas e Inventario**, cambiando
 * solo el `type`. No es ahorro de código: es la garantía de que las tres se
 * comporten igual, porque para quien las usa son la misma pantalla con otro
 * contenido.
 *
 * El botón de crear es lo que **toma el folio**: nace el borrador y la pantalla
 * navega a él. Por eso exige `inventory:movement` y no `:read` — quien audita
 * mira, no mueve.
 */
export function DocumentList({ type }: DocumentListProps) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const navigate = useNavigate();
  const canCreate = has("inventory:movement");

  const [folioInput, setFolioInput] = useState("");
  const [folio, setFolio] = useState("");
  const [status, setStatus] = useState<DocumentStatus | undefined>(undefined);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  // Debounce: buscar en cada tecla haría seis requests por un folio de seis
  // dígitos, y el usuario vería resultados parpadeando mientras escribe.
  useEffect(() => {
    const timer = setTimeout(() => setFolio(folioInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [folioInput]);

  const { data, isPending } = useDocuments({
    type,
    ...(folio !== "" && { folio }),
    ...(status !== undefined && { status }),
    ...(warehouseId !== null && { warehouseId }),
  });
  const createDocument = useCreateDocument();

  const filtrando = folio !== "" || status !== undefined || warehouseId !== null;
  const rows = data?.rows ?? [];

  async function crear() {
    if (warehouseId === null) {
      return;
    }
    const created = await createDocument.mutateAsync({ type, warehouseId });
    await navigate({ to: "/movements/documents/$documentId", params: { documentId: created.id } });
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-xl">{t(`inventory.documentType.${type}`)}</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => void crear()}
            disabled={warehouseId === null || createDocument.isPending}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {t("inventory.list.create")}
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("inventory.list.searchFolio")}</span>
          <input
            type="search"
            value={folioInput}
            onChange={(event) => setFolioInput(event.target.value)}
            placeholder={t("inventory.list.searchFolio")}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        {/* El `htmlFor` va contra el id que el select recibe: sin eso un lector
            de pantalla anuncia el desplegable sin decir qué elige. */}
        <div className="flex min-w-48 flex-col gap-1 text-sm">
          <label htmlFor="document-list-warehouse" className="text-muted-foreground">
            {t("inventory.warehouse.label")}
          </label>
          <WarehouseSelect
            id="document-list-warehouse"
            scoped
            value={warehouseId}
            onChange={setWarehouseId}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={status === chip.status}
            onClick={() => setStatus(chip.status)}
            className={`rounded-full border px-3 py-1 text-xs ${
              status === chip.status
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input text-muted-foreground"
            }`}
          >
            {t(chip.label)}
          </button>
        ))}
      </div>

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : rows.length === 0 ? (
        // Dos vacíos distintos: "todavía no hay" invita a crear el primero;
        // "no encontré nada" dice que el filtro es el problema, no el sistema.
        <p className="text-muted-foreground text-sm">
          {filtrando ? t("inventory.list.noResults") : t("inventory.list.empty")}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">{t("inventory.list.folio")}</th>
              <th className="py-2 font-medium">{t("inventory.list.status")}</th>
              <th className="py-2 font-medium">{t("inventory.warehouse.label")}</th>
              <th className="py-2 font-medium">{t("inventory.list.reason")}</th>
              <th className="py-2 font-medium">{t("inventory.list.date")}</th>
              <th className="py-2 font-medium">{t("inventory.list.lines")}</th>
              <th className="py-2 font-medium">{t("inventory.list.who")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-2 font-mono">
                  <a
                    href={`/movements/documents/${row.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      void navigate({
                        to: "/movements/documents/$documentId",
                        params: { documentId: row.id },
                      });
                    }}
                    className="underline underline-offset-2"
                  >
                    {row.folio}
                  </a>
                </td>
                <td className="py-2">{t(`inventory.status.${row.status}`)}</td>
                <td className="py-2">{row.warehouse.name}</td>
                <td className="py-2">
                  {row.reasonCode === null ? "—" : t(`inventory.reason.${row.reasonCode}`)}
                </td>
                <td className="py-2">{new Date(row.createdAt).toLocaleDateString()}</td>
                <td className="py-2">{row.lineCount}</td>
                <td className="py-2">
                  {row.createdBy === null
                    ? "—"
                    : `${row.createdBy.firstName} ${row.createdBy.lastNamePaternal}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
