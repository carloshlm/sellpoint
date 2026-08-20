import { type MovementReason, REASON_RULES } from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type HeaderValues,
  headerErrors,
  REASONS_WITH_AUTHORIZATION,
  selectableReasons,
} from "@/lib/inventory/entry-schema";
import { useUpdateDocumentHeader } from "@/lib/inventory/hooks";
import type { DocumentDetail } from "@/lib/inventory/types";
import { useUsers } from "@/lib/rbac/hooks";
import { useWarehouses } from "@/lib/warehouses/hooks";
import { WarehouseSelect } from "./warehouse-select";

const DEBOUNCE_MS = 400;

interface DocumentHeaderFormProps {
  document: DocumentDetail;
}

/**
 * F3-ENTRY-02 — la cabecera reactiva del documento.
 *
 * **El motivo manda.** Elegirlo cambia qué campos se piden, y esa regla NO
 * vive acá: sale de `REASON_RULES` (`@sellpoint/shared`), la misma tabla que
 * aplica el `superRefine` del API. Duplicarla en el componente sería garantizar
 * que un día el formulario pida un campo que el servidor no exige — o que
 * calle uno que sí.
 *
 * El motivo se guarda al instante (es un cambio deliberado, de un clic); los
 * textos van con debounce, por lo mismo que las cantidades: sin él, escribir
 * "F-8891" haría seis requests.
 */
export function DocumentHeaderForm({ document }: DocumentHeaderFormProps) {
  const { t } = useTranslation();
  const guardar = useUpdateDocumentHeader(document.id);
  const reasons = selectableReasons(document.type);

  // Un documento de traspaso no tiene cabecera EDITABLE: la tiene DERIVADA.
  // Ver `CabeceraDeTraspaso` para por qué esto no es una comodidad sino un
  // guardarraíl contra la pérdida del vínculo.
  if (document.transferId !== null) {
    return <CabeceraDeTraspaso document={document} />;
  }

  const rules = document.reasonCode === null ? null : REASON_RULES[document.reasonCode];
  const muestraAutoriza =
    document.reasonCode !== null && REASONS_WITH_AUTHORIZATION.includes(document.reasonCode);

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-md border border-input p-4">
      <Campo htmlFor="document-reason" label={t("inventory.document.reason")}>
        <select
          id="document-reason"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={document.reasonCode ?? ""}
          onChange={(event) => {
            guardar.mutate({ reasonCode: event.target.value as MovementReason });
          }}
        >
          <option value="" disabled>
            {t("inventory.document.reasonPlaceholder")}
          </option>
          {reasons.map((reason) => (
            <option key={reason} value={reason}>
              {t(`inventory.reason.${reason}`)}
            </option>
          ))}
        </select>
      </Campo>

      {rules?.requiresReference && (
        <TextoAutoguardado
          document={document}
          field="reference"
          // El consumo pide el ÁREA, no un "número de referencia": reusar la
          // etiqueta genérica dejaría a quien registra un consumo de limpieza
          // buscando qué número inventar.
          label={t(
            document.reasonCode === "consumption"
              ? "inventory.document.referenceConsumption"
              : "inventory.document.reference",
          )}
          placeholder={t(
            document.reasonCode === "consumption"
              ? "inventory.document.referenceConsumptionPlaceholder"
              : "inventory.document.referencePlaceholder",
          )}
        />
      )}

      {rules?.requiresNote && (
        <TextoAutoguardado
          document={document}
          field="reasonNote"
          label={t("inventory.document.note")}
          placeholder={t("inventory.document.notePlaceholder")}
        />
      )}

      {muestraAutoriza && <AutorizaSelect document={document} />}

      {rules?.requiresLinkedWarehouse && <DestinoSelect document={document} />}
    </div>
  );
}

/**
 * La cabecera de un documento que NACIÓ de un traspaso: se muestra, no se pide.
 *
 * **Por qué no basta con agregar "Traspaso" al desplegable.** El `<select>`
 * recibía `value="transfer"`, que no figura entre `SELECTABLE_ENTRY_REASONS`
 * —y no figura a propósito: nadie debe poder convertir una entrada común en
 * traspaso sin que exista el traspaso—. Un `<select>` controlado cuyo `value`
 * no está entre sus opciones cae a la primera, así que la recepción se
 * anunciaba como "Factura de compra". Peor todavía: quien intentara corregir
 * lo que veía solo podía elegir `adjustment` o `customer_return`, y ese PATCH
 * suelta el `linked_warehouse_id` y **rompe el vínculo con el traspaso**.
 *
 * Entonces la regla no es cosmética: mientras haya `transfer_id`, el motivo y
 * el otro almacén son datos DERIVADOS, y un dato derivado no es un campo. El
 * API lo rechaza igual (`inventory.transfer_header_locked`) — esto de acá solo
 * evita ofrecer lo que allá se niega.
 *
 * **El otro almacén cambia de nombre según el lado.** En la ENTRADA es de
 * DONDE VINO la mercancía; en la salida es a DÓNDE VA. Llamarlo "destino" en
 * los dos casos —como se hacía— le decía a quien recibía en Almacén Sur que su
 * destino era Almacén Central.
 */
function CabeceraDeTraspaso({ document }: { document: DocumentDetail }) {
  const { t } = useTranslation();
  const almacenes = useWarehouses();

  const otro = (almacenes.data ?? []).find((w) => w.id === document.linkedWarehouseId);
  const esRecepcion = document.type === "entry";

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-md border border-input p-4">
      <Dato label={t("inventory.document.reason")} testId="transfer-reason">
        {t("inventory.reason.transfer")}
      </Dato>

      <Dato
        label={t(
          esRecepcion ? "inventory.document.originWarehouse" : "inventory.document.linkedWarehouse",
        )}
        testId="transfer-linked-warehouse"
      >
        {otro?.name ?? "—"}
      </Dato>

      <p className="w-full text-muted-foreground text-xs">
        {t(esRecepcion ? "inventory.document.receptionHint" : "inventory.document.transferHint")}
      </p>
    </div>
  );
}

/** Un valor que se lee. Mismo espaciado que `Campo`, sin control ni `<label>`. */
function Dato({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-52 flex-1 flex-col gap-1">
      <span className="font-medium text-sm">{label}</span>
      <span data-testid={testId} className="py-2 text-sm">
        {children}
      </span>
    </div>
  );
}

/**
 * El OTRO almacén del traspaso.
 *
 * `scoped={false}` a propósito: el alcance limita desde dónde MOVÉS, no hacia
 * dónde mandás. Quien administra la Bodega Norte tiene que poder despachar a
 * Central aunque Central no sea suya — si no, un traspaso solo sería posible
 * entre almacenes de un mismo responsable.
 *
 * El origen se excluye porque mandarse mercancía a sí mismo no existe: la base
 * lo rechaza con un CHECK, y un 500 después sería explicar tarde algo que la
 * pantalla no debió ofrecer.
 */
function DestinoSelect({ document }: { document: DocumentDetail }) {
  const { t } = useTranslation();
  const guardar = useUpdateDocumentHeader(document.id);

  return (
    <div className="flex min-w-52 flex-1 flex-col gap-1">
      <label htmlFor="document-linked-warehouse" className="font-medium text-sm">
        {t("inventory.document.linkedWarehouse")}
      </label>
      <WarehouseSelect
        id="document-linked-warehouse"
        value={document.linkedWarehouseId}
        onChange={(warehouseId) => guardar.mutate({ linkedWarehouseId: warehouseId })}
        scoped={false}
        excludeIds={[document.warehouse.id]}
      />
      <p className="text-muted-foreground text-xs">{t("inventory.document.transferHint")}</p>
    </div>
  );
}

/**
 * Quién firma el movimiento. Es OPCIONAL en el API (`authorizedBy` no lo exige
 * ningún motivo), así que acá se OFRECE y no se exige: en un ajuste o una
 * merma alguien suele tener que dar el visto bueno, pero un negocio de una
 * persona no tiene a quién pedírselo.
 */
function AutorizaSelect({ document }: { document: DocumentDetail }) {
  const { t } = useTranslation();
  const guardar = useUpdateDocumentHeader(document.id);
  const { data: users } = useUsers();

  return (
    <Campo htmlFor="document-authorized-by" label={t("inventory.document.authorizedBy")}>
      <select
        id="document-authorized-by"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={document.authorizedBy ?? ""}
        onChange={(event) => {
          guardar.mutate({ authorizedBy: event.target.value || null });
        }}
      >
        <option value="">{t("inventory.document.authorizedByNone")}</option>
        {(users ?? [])
          .filter((user) => user.status === "active")
          .map((user) => (
            <option key={user.id} value={user.id}>
              {user.firstName} {user.lastNamePaternal}
            </option>
          ))}
      </select>
    </Campo>
  );
}

/**
 * Un campo de texto de la cabecera, con el MISMO autoguardado que las
 * cantidades: debounce y sin disparar en el primer render.
 */
function TextoAutoguardado({
  document,
  field,
  label,
  placeholder,
}: {
  document: DocumentDetail;
  field: "reference" | "reasonNote";
  label: string;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const guardar = useUpdateDocumentHeader(document.id);
  const guardado = document[field] ?? "";
  const [value, setValue] = useState(guardado);

  useEffect(() => {
    if (value === guardado) {
      return;
    }
    const timer = setTimeout(() => {
      guardar.mutate({ [field]: value.trim() === "" ? null : value.trim() });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, guardado, field, guardar.mutate]);

  // El error se calcula sobre lo GUARDADO y no sobre lo tecleado: mientras
  // alguien escribe la nota no hay que gritarle que falta.
  const error = headerErrors(document.reasonCode, {
    [field]: guardado,
  } as HeaderValues).get(field);

  const id = `document-${field}`;

  return (
    <Campo htmlFor={id} label={label} error={error === undefined ? undefined : t(error)}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </Campo>
  );
}

function Campo({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-52 flex-1 flex-col gap-1">
      <label htmlFor={htmlFor} className="font-medium text-sm">
        {label}
      </label>
      {children}
      {error !== undefined && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
