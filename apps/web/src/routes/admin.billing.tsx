import { localCalendarDate, scaledInteger } from "@sellpoint/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { TenantDetailDialog } from "@/components/billing/tenant-detail-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ROW_ACTIONS_CELL, RowActionsHead } from "@/components/ui/row-action";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import {
  getAdminTenants,
  getPaymentQuote,
  type PaymentQuote,
  recordPayment,
} from "@/lib/billing/api";
import { formatCalendarDay, formatDeadline, formatInstant } from "@/lib/billing/dates";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/billing")({
  component: AdminBillingPage,
});

function AdminBillingPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <AdminBilling />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F7-WEB-10 — el backoffice del dueño: la tabla de todos los negocios con su
 * plan, y el modal "Registrar pago" (LA operación semanal). El flag del
 * front solo decide si esta pantalla se pinta; la verdad son las cuatro
 * llaves del PlatformAdminGuard en cada request del server.
 *
 * Se ve como los demás listados (Carlos, 2026-10-22): título de página, los
 * filtros y la tabla directa, no una tarjeta con otra tabla adentro.
 */
function AdminBilling() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [pagando, setPagando] = useState<{
    tenantId: string;
    tenantName: string;
    planCode: string | null;
    /** La zona del NEGOCIO: es su calendario el que decide qué día es hoy. */
    timezone: string;
    charges: { planCode: string; monthly: string; yearly: string; currency: string }[];
  } | null>(null);
  const [viendo, setViendo] = useState<{ tenantId: string; tenantName: string } | null>(null);
  // El ciclo elegido decide qué cargo se muestra y se propone.
  const [ciclo, setCiclo] = useState<"monthly" | "yearly">("monthly");
  // El filtro de moneda: con clientes en tres mercados, la tabla completa
  // mezcla números que no se suman entre sí.
  const [moneda, setMoneda] = useState("");
  // El plan del cobro: el vigente del negocio, o el que se elija. De él
  // depende el precio, así que el autocálculo lo sigue.
  const [planPago, setPlanPago] = useState("");
  // Los dos lados de la cuenta, controlados: escribir uno completa el otro.
  const [recibido, setRecibido] = useState("");
  const [descuento, setDescuento] = useState("0");
  const [error, setError] = useState<string | null>(null);
  // El día del pago, controlado: la cotización depende de él (desde free el
  // período arranca ese día, y el cupón vale según la fecha).
  const [fechaPago, setFechaPago] = useState("");
  // «Cubre hasta» (Carlos, 2026-11-14). Vacío hasta que llega la cotización;
  // distinto del automático es un ACUERDO con su precio y su motivo.
  const [hasta, setHasta] = useState("");
  const [precioAcordado, setPrecioAcordado] = useState("");
  // El admin tocó «Cubre hasta». Separado de la fecha: mientras se teclea, el
  // campo pasa por vacío y eso no deshace el acuerdo ni su precio.
  const [acuerdoAbierto, setAcuerdoAbierto] = useState(false);
  const acuerdoAbiertoRef = useRef(acuerdoAbierto);
  acuerdoAbiertoRef.current = acuerdoAbierto;
  // El diálogo de la última cotización aplicada: abrirlo de nuevo rehace todo.
  const pagandoAplicado = useRef<typeof pagando>(null);

  const { data } = useQuery({
    queryKey: ["admin", "billing", "tenants"],
    queryFn: getAdminTenants,
    enabled: user?.isPlatformAdmin === true,
  });

  /**
   * «Debe pagar» y «Cubre del … al …» los dice el API, con la MISMA cuenta
   * que va a exigir al registrar (Carlos, 2026-11-14: la pantalla armaba el
   * precio con su propia copia y proponía 499 donde el API pedía 650).
   *
   * Si el negocio no tiene suscripción, `planPago` es el del desplegable —el
   * único que hay— y la cotización sale igual.
   */
  const { data: cotizacion, error: errorCotizacion } = useQuery<PaymentQuote, ApiError>({
    queryKey: ["admin", "billing", "quote", pagando?.tenantId, ciclo, planPago, fechaPago],
    queryFn: () =>
      getPaymentQuote(pagando?.tenantId ?? "", {
        billingCycle: ciclo,
        planCode: planPago || undefined,
        paidAt: fechaPago,
      }),
    enabled: pagando !== null && fechaPago !== "",
  });

  /**
   * Cada cotización nueva —otro ciclo, otro plan, otra fecha— rehace la cuenta
   * automática. Un ACUERDO se respeta: su fecha y su precio los escribió el
   * admin y no dependen de esas tres cosas. Abrir el diálogo de nuevo sí
   * empieza de cero.
   */
  useEffect(() => {
    if (!cotizacion || !pagando) {
      return;
    }
    const reabierto = pagandoAplicado.current !== pagando;
    pagandoAplicado.current = pagando;
    if (acuerdoAbiertoRef.current && !reabierto) {
      return;
    }
    setAcuerdoAbierto(false);
    setHasta(cotizacion.periodEnd);
    setPrecioAcordado("");
    setRecibido(cotizacion.net);
    setDescuento("0");
  }, [cotizacion, pagando]);

  /** Un «Cubre hasta» distinto del automático es un acuerdo. */
  const acuerdo = cotizacion !== undefined && acuerdoAbierto && hasta !== cotizacion.periodEnd;

  /** Contra qué cuadra la cuenta: el precio acordado o el de la cotización. */
  const cargoVigente = (): string | undefined =>
    acuerdo ? precioAcordado || "0" : cotizacion?.net;

  /** Volver a la fecha y al precio automáticos. */
  const sinAcuerdo = () => {
    if (!cotizacion) {
      return;
    }
    setAcuerdoAbierto(false);
    setHasta(cotizacion.periodEnd);
    setPrecioAcordado("");
    setRecibido(cotizacion.net);
    setDescuento("0");
  };

  /**
   * Qué día es «hoy» para el NEGOCIO que se está cobrando.
   *
   * Con el día UTC, después de las 18:00 de México el formulario proponía
   * MAÑANA y el server lo rechazaba por futuro; con el del navegador fallaba
   * al revés si el negocio estaba en una zona más atrasada. El calendario que
   * manda es el del negocio (Carlos, 2026-09-04).
   */
  const hoyDelNegocio = localCalendarDate(pagando?.timezone ?? "UTC", new Date());

  /**
   * El otro lado de la cuenta. `recibido + descuento = cargo`, así que
   * escribir uno DETERMINA el otro y teclearlo dos veces sería pedirle al
   * dueño que haga la resta a mano.
   *
   * La aritmética va en CENTAVOS (`scaledInteger`) y no en flotantes: 499.10
   * menos 0.10 en IEEE-754 no da 499 exacto, y este número termina siendo
   * comparado por igualdad en el server.
   *
   * Nunca baja de cero: si alguien captura más de lo que se debe, el
   * complemento es 0 y el server rechaza el desajuste — que es exactamente
   * lo que tiene que pasar con un monto que no cuadra.
   */
  const complemento = (valor: string, cargo: string | undefined): string => {
    if (cargo === undefined) {
      return "";
    }
    const centavos = Math.max(0, scaledInteger(cargo, 2) - scaledInteger(valor || "0", 2));
    return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
  };

  const registrar = useMutation({
    mutationFn: ({
      tenantId,
      input,
    }: {
      tenantId: string;
      input: Parameters<typeof recordPayment>[1];
    }) => recordPayment(tenantId, input),
    onSuccess: () => {
      setPagando(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing", "tenants"] });
      // El pago movió el período: la próxima cotización de ese negocio es otra.
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing", "quote"] });
    },
    onError: (e: ApiError) => setError(e.message),
  });

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  // El dueño de la plataforma ve la fecha DE CADA NEGOCIO en la zona de ese
  // negocio: es su fecha de cobro, no la de quien mira la tabla.
  const vence = (iso: string | null, timeZone: string | null) =>
    formatDeadline(iso, timeZone ?? undefined, i18n.language);
  const fecha = (iso: string | null, timeZone: string | null) =>
    formatInstant(iso, timeZone ?? undefined, i18n.language);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6" data-testid="admin-billing">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("common.billing.admin.title")}</h1>
        </header>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="filtro-moneda">{t("common.billing.admin.filterCurrency")}</Label>
            {/* Las monedas que EXISTEN en la tabla, no un catálogo fijo:
                ofrecer un filtro vacío es ofrecer un callejón sin salida. */}
            <select
              id="filtro-moneda"
              value={moneda}
              onChange={(event) => setMoneda(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t("common.billing.admin.allCurrencies")}</option>
              {[...new Set((data?.tenants ?? []).map((fila) => fila.currency))]
                .sort()
                .map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-muted-foreground text-sm">
            {Object.entries(data?.mrrByCurrency ?? {})
              .filter(([currency]) => moneda === "" || currency === moneda)
              .map(([currency, amount]) => `MRR ${currency}: $${amount}`)
              .join(" · ") || t("common.billing.admin.noMrr")}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.billing.admin.tenant")}</TableHead>
              <TableHead>{t("common.billing.admin.country")}</TableHead>
              <TableHead>{t("common.billing.admin.currency")}</TableHead>
              <TableHead>{t("common.billing.admin.plan")}</TableHead>
              <TableHead>{t("common.billing.admin.status")}</TableHead>
              <TableHead>{t("common.billing.admin.dueAt")}</TableHead>
              <TableHead>{t("common.billing.admin.lastPayment")}</TableHead>
              <RowActionsHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.tenants ?? [])
              .filter((fila) => moneda === "" || fila.currency === moneda)
              .map((fila) => (
                <TableRow key={fila.tenantId}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-2 hover:underline"
                      onClick={() =>
                        setViendo({ tenantId: fila.tenantId, tenantName: fila.tenantName })
                      }
                    >
                      {fila.tenantName}
                    </button>
                  </TableCell>
                  <TableCell>{fila.country ?? "—"}</TableCell>
                  <TableCell>{fila.currency}</TableCell>
                  <TableCell>{fila.planName}</TableCell>
                  <TableCell>{t(`common.billing.me.status.${fila.status}`)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {vence(fila.dueAt, fila.timezone)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fecha(fila.lastPaymentAt, fila.timezone)}
                  </TableCell>
                  <TableCell className={ROW_ACTIONS_CELL}>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setViendo({ tenantId: fila.tenantId, tenantName: fila.tenantName })
                        }
                      >
                        {t("common.billing.admin.detail")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          // Sin suscripción no hay plan vigente: se propone el
                          // primer plan vendible para que el formulario arranque
                          // con una cuenta ya cuadrada.
                          const inicial =
                            fila.status === "none"
                              ? (fila.charges[0]?.planCode ?? "")
                              : fila.planCode;
                          setPagando({
                            tenantId: fila.tenantId,
                            tenantName: fila.tenantName,
                            planCode: fila.status === "none" ? null : fila.planCode,
                            timezone: fila.timezone,
                            charges: fila.charges,
                          });
                          setCiclo("monthly");
                          setPlanPago(inicial);
                          setFechaPago(localCalendarDate(fila.timezone, new Date()));
                          // La cuenta la llena la cotización en cuanto llega.
                          setHasta("");
                          setPrecioAcordado("");
                          setRecibido("");
                          setDescuento("0");
                        }}
                      >
                        {t("common.billing.admin.recordPayment")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <TenantDetailDialog
        tenantId={viendo?.tenantId ?? null}
        tenantName={viendo?.tenantName ?? ""}
        onClose={() => setViendo(null)}
      />

      <Dialog
        open={pagando !== null}
        onClose={() => setPagando(null)}
        title={t("common.billing.admin.paymentTitle", { tenant: pagando?.tenantName ?? "" })}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pagando) {
              return;
            }
            const form = new FormData(event.currentTarget);
            registrar.mutate({
              tenantId: pagando.tenantId,
              input: {
                billingCycle: form.get("cycle") as "monthly" | "yearly",
                method: form.get("method") as "transfer" | "cash" | "card" | "other" | "courtesy",
                // El DÍA tal cual: el server lo ancla al mediodía de la zona
                // del negocio. Armar un instante aquí lo corría de día.
                paidAt: fechaPago,
                // Igual al vigente = "mantener": no se manda nada.
                planCode: planPago === pagando.planCode ? undefined : planPago || undefined,
                amountReceived: recibido || "0",
                discountAmount: descuento || "0",
                // Solo con acuerdo: igual a la automática no hay nada que decir.
                ...(acuerdo ? { periodEnd: hasta, agreedPrice: precioAcordado || "0" } : {}),
                notes: (form.get("notes") as string) || undefined,
              },
            });
          }}
        >
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {/* Sin cotización no hay cuenta que cuadrar: el porqué, a la vista. */}
          {errorCotizacion ? (
            <p className="text-destructive text-sm" role="alert">
              {errorCotizacion.message}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-cycle">{t("common.billing.admin.cycle")}</Label>
              <select
                id="pay-cycle"
                name="cycle"
                value={ciclo}
                onChange={(event) => {
                  // Cambiar de ciclo cambia el precio y la fecha: la cotización
                  // nueva rehace la cuenta entera.
                  setCiclo(event.target.value as "monthly" | "yearly");
                }}
                className="w-full rounded-md border p-2 text-sm"
              >
                <option value="monthly">{t("common.billing.plans.monthly")}</option>
                <option value="yearly">{t("common.billing.plans.yearly")}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pay-method">{t("common.billing.admin.method")}</Label>
              <select
                id="pay-method"
                name="method"
                className="w-full rounded-md border p-2 text-sm"
              >
                {["transfer", "cash", "card", "other", "courtesy"].map((m) => (
                  <option key={m} value={m}>
                    {t(`common.billing.me.method.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pay-date">{t("common.billing.admin.paidAt")}</Label>
              {/* `max` corta el error de dedo en el propio calendario; el
                  server lo rechaza igual (422 paid_at_in_future) porque una
                  validación de navegador no es una regla de negocio. */}
              <input
                id="pay-date"
                name="paidAt"
                type="date"
                required
                max={hoyDelNegocio}
                value={fechaPago}
                onChange={(event) => setFechaPago(event.target.value)}
                className="w-full rounded-md border p-2 text-sm"
              />
              <span className="text-muted-foreground text-xs">
                {t("common.billing.admin.paidAtHint")}
              </span>
            </div>
            <div>
              <Label htmlFor="pay-plan">{t("common.billing.admin.planCode")}</Label>
              {/*
                Solo los planes que ESE negocio puede pagar (los que tienen
                precio en su mercado), y "mantener el actual" únicamente si
                tiene uno: a un negocio sin suscripción no se le puede
                mantener nada, y el server exige el plan.
              */}
              <select
                id="pay-plan"
                name="planCode"
                value={planPago}
                onChange={(event) => {
                  // Otro plan, otro precio: la cotización nueva rehace la cuenta.
                  setPlanPago(event.target.value);
                }}
                className="w-full rounded-md border p-2 text-sm"
              >
                {pagando?.planCode === null ? null : (
                  <option value={pagando?.planCode ?? ""}>
                    {t("common.billing.admin.keepPlan")}
                  </option>
                )}
                {(pagando?.charges ?? [])
                  .filter((c) => c.planCode !== pagando?.planCode)
                  .map((c) => (
                    <option key={c.planCode} value={c.planCode}>
                      {c.planCode}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {/*
            «Cubre hasta» (Carlos, 2026-11-14): llega con la fecha automática.
            Cambiarla es un ACUERDO: aparece el precio acordado y el motivo se
            vuelve obligatorio. El botón deshace el acuerdo sin adivinar la
            fecha de vuelta.
          */}
          {cotizacion ? (
            <div>
              <Label htmlFor="pay-covers">{t("common.billing.admin.coversUntil")}</Label>
              <input
                id="pay-covers"
                type="date"
                required
                value={hasta}
                onChange={(event) => {
                  const valor = event.target.value;
                  setHasta(valor);
                  if (valor === cotizacion.periodEnd) {
                    sinAcuerdo();
                    return;
                  }
                  if (!acuerdoAbierto) {
                    // El acuerdo arranca con el precio de lista a la vista:
                    // se corrige el número, no se teclea desde cero.
                    setAcuerdoAbierto(true);
                    setPrecioAcordado(cotizacion.net);
                    setRecibido(cotizacion.net);
                    setDescuento("0");
                  }
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
              <span className="text-muted-foreground text-xs">
                {t("common.billing.admin.coversHint", {
                  start: formatCalendarDay(cotizacion.periodStart, i18n.language),
                })}
              </span>
              {acuerdo ? (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={sinAcuerdo}>
                    {t("common.billing.admin.useAutomaticEnd", {
                      date: formatCalendarDay(cotizacion.periodEnd, i18n.language),
                    })}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {/*
            El cargo a la vista: cuadrar la cuenta sin ver el número sería
            pedirle al dueño que saque calculadora. Con acuerdo, el de lista
            queda de referencia y el precio se escribe abajo.
          */}
          {cotizacion ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="expected-charge">
              {t(
                acuerdo ? "common.billing.admin.listPrice" : "common.billing.admin.expectedCharge",
                { amount: `${cotizacion.net} ${cotizacion.currency}` },
              )}
            </p>
          ) : null}
          {acuerdo ? (
            <div>
              <Label htmlFor="pay-agreed">{t("common.billing.admin.agreedPrice")}</Label>
              <input
                id="pay-agreed"
                inputMode="decimal"
                required
                value={precioAcordado}
                onChange={(event) => {
                  setPrecioAcordado(event.target.value);
                  setRecibido(event.target.value);
                  setDescuento("0");
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">{t("common.billing.admin.amountReceivedRequired")}</Label>
              <input
                id="pay-amount"
                name="amountReceived"
                inputMode="decimal"
                required
                value={recibido}
                onChange={(event) => {
                  setRecibido(event.target.value);
                  setDescuento(complemento(event.target.value, cargoVigente()));
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pay-discount">{t("common.billing.admin.discountAmount")}</Label>
              <input
                id="pay-discount"
                name="discountAmount"
                inputMode="decimal"
                value={descuento}
                onChange={(event) => {
                  setDescuento(event.target.value);
                  setRecibido(complemento(event.target.value, cargoVigente()));
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {t(acuerdo ? "common.billing.admin.mustMatchAgreed" : "common.billing.admin.mustMatch")}
          </p>
          <div>
            {/* Con acuerdo, las notas son el MOTIVO: queda en la bitácora. */}
            <Label htmlFor="pay-notes">
              {t(acuerdo ? "common.billing.admin.agreementReason" : "common.billing.admin.notes")}
            </Label>
            <input
              id="pay-notes"
              name="notes"
              required={acuerdo}
              className="w-full rounded-md border p-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={registrar.isPending}>
            {t("common.billing.admin.confirmPayment")}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
