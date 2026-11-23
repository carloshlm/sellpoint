import { type Currency, formatMoney, isDiscountCode, parseMoneyInput } from "@sellpoint/shared";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MoneyField } from "@/components/form/money-field";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RowAction } from "@/components/ui/row-action";
import { SuccessNotice } from "@/components/ui/success-notice";
import { formatBusinessTime } from "@/lib/inventory/format-date";
import { moneyInputError } from "@/lib/money";
import type { CashMovement, CashMovementReason, CashMovementType } from "@/lib/pos/api";
import { useCancelCashMovement, useCashMovements, useCreateCashMovement } from "@/lib/pos/hooks";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Los motivos de cada tipo, en el orden en que se ofrecen. Son los que acepta
 * la base (CHECK de `cash_movements`): «Fondo para cambio» solo entra; la caja
 * fuerte, el banco y el dueño solo sacan; «Otro» va con los dos y pide nota.
 *
 * Viven aquí y no en `lib/pos/api.ts` porque son lo que la PANTALLA ofrece, y
 * porque las pruebas de las rutas reemplazan ese módulo entero con su mock.
 */
const REASONS: Record<CashMovementType, readonly CashMovementReason[]> = {
  in: ["change_fund", "other"],
  out: ["safe", "bank_deposit", "owner", "other"],
};

const TYPES: readonly CashMovementType[] = ["in", "out"];

/** El largo de la columna `note` (VARCHAR(300)): más que eso, la base lo rechaza. */
const NOTE_MAX = 300;

/** El motivo de una anulación, como el de una venta: decirlo antes del clic. */
const CANCEL_REASON_MIN = 3;

/** ¿El negocio tiene código de autorización? Lo define el administrador en Mi perfil. */
const useCodigoConfigurado = () => useAuthStore((s) => s.user?.tenant.discountCodeSetAt != null);

/**
 * F10-CASHMOV-04 — «Efectivo»: las entradas y los retiros del turno.
 *
 * Hasta ahora del cajón solo salían gastos, así que el efectivo que el cajero
 * se lleva a la caja fuerte aparecía como FALTANTE al cerrar. Aquí se registra
 * en el momento, sin salir de la venta, y abajo se ven los movimientos del
 * turno con «Anular».
 *
 * Un movimiento no es un gasto: no toca la utilidad ni el reporte de Gastos.
 * Lo registra quien tiene el turno abierto, en su propio turno. El retiro, y
 * la anulación de una entrada, piden el código del negocio si existe: las dos
 * cosas bajan el efectivo esperado. Las reglas las cuida el API; la pantalla
 * solo evita mandar lo que ya sabe que va a rebotar y dice con sus palabras
 * lo que el API rechaza.
 *
 * Se monta solo cuando está abierto: los movimientos se piden al abrir, no
 * en cada carga de la pantalla de venta.
 */
export function CashMovementDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog open onClose={onClose} title={t("pos.cashMovement.title")}>
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">{t("pos.cashMovement.intro")}</p>
        <CashMovementForm onClose={onClose} />
        <MovementList />
      </div>
    </Dialog>
  );
}

function CashMovementForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const codigoConfigurado = useCodigoConfigurado();
  const registrar = useCreateCashMovement();

  // El retiro va de entrada: es lo que el cajero viene a registrar casi
  // siempre (el efectivo que se lleva a la caja fuerte).
  const [tipo, setTipo] = useState<CashMovementType>("out");
  const [motivo, setMotivo] = useState<CashMovementReason>("safe");
  const [importe, setImporte] = useState("");
  const [nota, setNota] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState<CashMovementType | null>(null);

  const cambiarTipo = (nuevo: CashMovementType) => {
    setTipo(nuevo);
    // El motivo que no existe en el otro tipo cambia al primero de su lista;
    // «Otro» existe en los dos y se queda con su nota.
    if (!REASONS[nuevo].includes(motivo)) {
      setMotivo(REASONS[nuevo][0] as CashMovementReason);
    }
    setError(null);
  };

  // Un importe como los demás de la app: mal escrito avisa; en cero o
  // negativo no es un movimiento.
  const errorFormato = moneyInputError(importe);
  const monto = errorFormato === null ? parseMoneyInput(importe) : null;
  const importeValido = monto !== null && monto > 0;
  const errorImporte =
    errorFormato !== null
      ? t(errorFormato)
      : monto !== null && monto <= 0
        ? t("pos.cashMovement.amountPositive")
        : undefined;

  const notaLimpia = nota.trim();
  const conOtro = motivo === "other";
  const faltaNota = conOtro && notaLimpia === "";

  // El código: solo en un retiro y solo si el negocio lo tiene. Es el mismo
  // del descuento, con su misma etiqueta, ayuda y validación.
  const pideCodigo = tipo === "out" && codigoConfigurado;
  const codigoValido = !pideCodigo || isDiscountCode(codigo);
  const errorCodigo =
    pideCodigo && importeValido && !codigoValido ? t("pos.discount.codeInvalid") : undefined;

  const bloquea = !importeValido || faltaNota || !codigoValido || registrar.isPending;

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    if (bloquea || monto === null) {
      return;
    }
    setError(null);
    setRegistrado(null);
    registrar.mutate(
      {
        type: tipo,
        reason: motivo,
        amount: monto,
        ...(notaLimpia !== "" && { note: notaLimpia }),
        // Lo que no se pidió no viaja: una entrada nunca manda código.
        ...(pideCodigo && { code: codigo }),
      },
      {
        onSuccess: () => {
          setImporte("");
          setNota("");
          setCodigo("");
          setRegistrado(tipo);
        },
        onError: (e) => setError(e.message || t("pos.cashMovement.failed")),
      },
    );
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {registrado !== null && (
        <SuccessNotice testId="cash-movement-created">
          {t(registrado === "in" ? "pos.cashMovement.createdIn" : "pos.cashMovement.createdOut")}
        </SuccessNotice>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t("pos.cashMovement.typeLabel")}</legend>
        <div className="flex gap-2">
          {TYPES.map((valor) => (
            <Button
              key={valor}
              type="button"
              variant={valor === tipo ? "default" : "outline"}
              aria-pressed={valor === tipo}
              className="flex-1"
              onClick={() => cambiarTipo(valor)}
            >
              {t(`pos.cashMovement.type.${valor}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label={t("pos.cashMovement.amount")}
          value={importe}
          onChange={(valor) => {
            setImporte(valor);
            setRegistrado(null);
          }}
          error={errorImporte}
        />
        <SelectField
          label={t("pos.cashMovement.reason")}
          value={motivo}
          onChange={(event) => setMotivo(event.target.value as CashMovementReason)}
          options={REASONS[tipo].map((valor) => ({
            value: valor,
            label: t(`pos.cashMovement.reasons.${valor}`),
          }))}
        />
      </div>

      <TextField
        label={t(conOtro ? "pos.cashMovement.note" : "pos.cashMovement.noteOptional")}
        value={nota}
        onChange={(event) => setNota(event.target.value)}
        maxLength={NOTE_MAX}
        hint={conOtro ? t("pos.cashMovement.noteRequired") : undefined}
      />

      {pideCodigo && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("pos.discount.code")}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={codigo}
            onChange={(event) => setCodigo(event.target.value.replace(/\D/g, ""))}
            error={errorCodigo}
            hint={t("pos.discount.codeHint")}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={bloquea}>
          {registrar.isPending
            ? t("common.form.submitting")
            : t(tipo === "in" ? "pos.cashMovement.submitIn" : "pos.cashMovement.submitOut")}
        </Button>
        {/* «Cerrar» y no «Cancelar»: registrar no cierra el diálogo, para que
            el movimiento se vea en la lista de abajo. */}
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.dialog.close")}
        </Button>
      </div>
    </form>
  );
}

/** Los movimientos del turno, del más nuevo al más viejo, como los manda el API. */
function MovementList() {
  const { t } = useTranslation();
  const titleId = useId();
  const { data, isPending, isError } = useCashMovements();
  const movimientos = data?.movements ?? [];

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t pt-4">
      <h3 id={titleId} className="font-medium">
        {t("pos.cashMovement.listTitle")}
      </h3>
      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : isError ? (
        <p className="text-destructive text-sm">{t("pos.cashMovement.loadFailed")}</p>
      ) : movimientos.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("pos.cashMovement.empty")}</p>
      ) : (
        <ul aria-label={t("pos.cashMovement.listTitle")} className="flex flex-col divide-y">
          {movimientos.map((movimiento) => (
            <MovementRow key={movimiento.id} movimiento={movimiento} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MovementRow({ movimiento }: { movimiento: CashMovement }) {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const timeZone = useAuthStore((s) => s.user?.tenant?.timezone);
  const codigoConfigurado = useCodigoConfigurado();
  const anular = useCancelCashMovement();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const anulado = movimiento.status === "canceled";
  const entrada = movimiento.type === "in";
  // El signo a la vista, como los gastos del cierre: lo que entra suma, lo
  // que sale resta.
  const monto = formatMoney(Number(movimiento.amount), currency, locale);
  const importe = `${entrada ? "+" : "−"}${monto}`;
  // Anular una ENTRADA baja el esperado, igual que un retiro: pide el código
  // si el negocio lo tiene. Anular un retiro lo sube y nunca lo pide.
  const pideCodigo = entrada && codigoConfigurado;

  const abrirAnulacion = () => {
    setMotivo("");
    setCodigo("");
    setError(null);
    setAnulando(true);
  };

  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={entrada ? "success" : "default"}>
              {t(`pos.cashMovement.type.${movimiento.type}`)}
            </Badge>
            <span className="font-medium">
              {t(`pos.cashMovement.reasons.${movimiento.reason}`)}
            </span>
            {anulado && <Badge variant="destructive">{t("pos.cashMovement.canceled")}</Badge>}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatBusinessTime(movimiento.createdAt, i18n.language, timeZone)}
            {" · "}
            {t("pos.cashMovement.by", { name: movimiento.createdBy.name })}
          </p>
          {movimiento.note !== null && movimiento.note !== "" && (
            <p className="break-words text-muted-foreground text-xs">{movimiento.note}</p>
          )}
          {anulado && (
            <p className="break-words text-destructive text-xs">
              {t("pos.cashMovement.canceledBy", {
                name: movimiento.canceledBy?.name ?? "",
                reason: movimiento.cancelReason ?? "",
              })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "font-medium tabular-nums",
              anulado && "text-muted-foreground line-through",
            )}
          >
            {importe}
          </span>
          {/* Un movimiento anulado ya no se anula: el API lo rechaza y el
              botón mentiría. */}
          {!anulado && (
            <RowAction intent="delete" onClick={abrirAnulacion}>
              {t("pos.cashMovement.cancel")}
            </RowAction>
          )}
        </div>
      </div>

      {anulando && (
        <ConfirmDialog
          title={t(entrada ? "pos.cashMovement.cancelTitleIn" : "pos.cashMovement.cancelTitleOut", {
            amount: monto,
          })}
          body={t("pos.cashMovement.cancelBody")}
          confirmLabel={t("pos.cashMovement.cancelConfirm")}
          cancelLabel={t("common.form.cancel")}
          busy={anular.isPending}
          confirmDisabled={
            motivo.trim().length < CANCEL_REASON_MIN || (pideCodigo && !isDiscountCode(codigo))
          }
          {...(error !== null && { error })}
          onCancel={() => setAnulando(false)}
          onConfirm={() => {
            setError(null);
            anular.mutate(
              {
                id: movimiento.id,
                reason: motivo.trim(),
                ...(pideCodigo && { code: codigo }),
              },
              {
                onSuccess: () => setAnulando(false),
                onError: (e) => setError(e.message || t("pos.cashMovement.cancelFailed")),
              },
            );
          }}
        >
          <TextField
            label={t("pos.cashMovement.cancelReason")}
            value={motivo}
            placeholder={t("pos.cashMovement.cancelReasonPlaceholder")}
            onChange={(event) => setMotivo(event.target.value)}
          />
          {pideCodigo && (
            <TextField
              label={t("pos.discount.code")}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={codigo}
              onChange={(event) => setCodigo(event.target.value.replace(/\D/g, ""))}
              error={
                codigo !== "" && !isDiscountCode(codigo) ? t("pos.discount.codeInvalid") : undefined
              }
              hint={t("pos.discount.codeHint")}
            />
          )}
        </ConfirmDialog>
      )}
    </li>
  );
}
