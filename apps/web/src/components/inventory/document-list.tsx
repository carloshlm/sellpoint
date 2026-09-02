import { effectiveDocumentDate, localeToBcp47 } from "@sellpoint/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Paginator } from "@/components/ui/paginator";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { resolveUiLocale } from "@/lib/accept-language";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { useCreateDocument, useDocuments } from "@/lib/inventory/hooks";
import type { DocumentStatus, InventoryDocumentType } from "@/lib/inventory/types";
import { useAuthStore } from "@/stores/auth.store";
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
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const navigate = useNavigate();
  const canCreate = has("inventory:movement");
  // La zona del NEGOCIO: la misma con la que el API corta el rango.
  const timeZone = useAuthStore((s) => s.user?.tenant?.timezone);
  const locale = localeToBcp47(resolveUiLocale(i18n));

  const [folioInput, setFolioInput] = useState("");
  const [folio, setFolio] = useState("");
  const [status, setStatus] = useState<DocumentStatus | undefined>(undefined);
  // F3-HOME-04: arranca en null y es `WarehouseSelect` quien avisa cuál elegir
  // —el asignado del usuario, o el único si hay uno solo—. La decisión vive
  // ahí porque ahí está la lista de opciones: preseleccionar acá, sin saber si
  // el asignado está disponible, ofrecería un almacén que el API rechaza.
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  /**
   * Sin rango al abrir, a diferencia del Kardex y a propósito: este listado se
   * abre para encontrar el documento que se acaba de crear, y un rango por
   * defecto escondería los borradores viejos que alguien dejó a medias — que
   * es justo lo que hay que ver.
   */
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [pagina, setPagina] = useState(1);

  /**
   * Cualquier filtro VUELVE a la página 1, y el reset vive acá y no en cada
   * `onChange`: quedarse en la página 3 de un filtro que ahora tiene una sola
   * página muestra una tabla vacía que parece un bug — y un filtro nuevo que
   * alguien agregue mañana solo tiene que sumarse a estas deps.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros; `type` cambia de pantalla y también resetea
  useEffect(() => {
    setPagina(1);
  }, [type, folio, status, warehouseId, rango.from, rango.to]);

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
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page: pagina,
  });
  const createDocument = useCreateDocument();
  const [createError, setCreateError] = useState<string | null>(null);

  // El rango CUENTA como filtro: si no, una búsqueda vacía por fechas diría
  // «todavía no hay documentos» en vez de «no hay en este rango», y el usuario
  // creería que perdió su trabajo.
  const filtrando =
    folio !== "" ||
    status !== undefined ||
    warehouseId !== null ||
    rango.from !== "" ||
    rango.to !== "";
  const rows = data?.rows ?? [];

  async function crear() {
    if (warehouseId === null) {
      return;
    }
    setCreateError(null);
    try {
      const created = await createDocument.mutateAsync({ type, warehouseId });
      await navigate({
        to: "/movements/documents/$documentId",
        params: { documentId: created.id },
      });
    } catch (error) {
      // Carlos (2026-09-01): el 409 de «ya hay un inventario abierto» se
      // perdía y el botón parecía muerto. El mensaje del API ya viene
      // traducido y con el folio que estorba.
      setCreateError((error as ApiError).message || t("inventory.list.createFailed"));
    }
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

      {createError !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {createError}
        </p>
      )}

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

        <DateRangeFilter id="document-list" from={rango.from} to={rango.to} onChange={setRango} />
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
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="px-2 py-2 font-medium">{t("inventory.list.folio")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.list.status")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.warehouse.label")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.list.reason")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.list.date")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.list.lines")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.list.who")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b last:border-0 ${TABLE_ROW_HOVER}`}>
                  <td className="px-2 py-2 font-mono">
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
                  <td className="px-2 py-2">
                    {/* El semáforo de estados de todos los listados (Carlos,
                        2026-08-25): ámbar el borrador, verde lo confirmado,
                        rojo lo anulado. */}
                    <Badge
                      variant={
                        row.status === "draft"
                          ? "warning"
                          : row.status === "confirmed"
                            ? "success"
                            : "destructive"
                      }
                    >
                      {t(`inventory.status.${row.status}`)}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">{row.warehouse.name}</td>
                  <td className="px-2 py-2">
                    {row.reasonCode === null ? "—" : t(`inventory.reason.${row.reasonCode}`)}
                  </td>
                  {/* La fecha del ESTADO (Carlos, 2026-09-02): apertura en borrador,
                      asiento en confirmado, cancelación en cancelado — la misma
                      que filtra Desde/Hasta. El title cuenta las dos. */}
                  <td
                    className="px-2 py-2"
                    title={
                      row.status === "draft"
                        ? undefined
                        : [
                            t("inventory.document.openedAt", {
                              date: formatBusinessDate(row.createdAt, locale, timeZone),
                            }),
                            t(
                              row.status === "canceled"
                                ? "inventory.document.canceledAt"
                                : "inventory.document.postedAt",
                              {
                                date: formatBusinessDate(
                                  effectiveDocumentDate(row),
                                  locale,
                                  timeZone,
                                ),
                              },
                            ),
                          ].join(" · ")
                    }
                  >
                    {formatBusinessDate(effectiveDocumentDate(row), locale, timeZone)}
                  </td>
                  <td className="px-2 py-2">{row.lineCount}</td>
                  <td className="px-2 py-2">
                    {row.createdBy === null
                      ? "—"
                      : `${row.createdBy.firstName} ${row.createdBy.lastNamePaternal}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </section>
  );
}
