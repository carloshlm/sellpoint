import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import { ReceptionItemGate } from "@/components/reception/reception-item-gate";
import { TurnNumberDialog } from "@/components/reception/turn-number-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paginator } from "@/components/ui/paginator";
import { RowAction } from "@/components/ui/row-action";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import type { Customer, Turn } from "@/lib/reception/api";
import { useCreateTurn, useCustomers, useRemoveCustomer } from "@/lib/reception/hooks";
import { useReceptionEntity } from "@/lib/reception/settings";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/reception/customers/")({
  component: CustomersPage,
});

/** F9-RECEP-11 — «Registro de cliente», primer módulo vertical. */
function CustomersPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reception:read">
            <ReceptionItemGate item="customers">
              <CustomersContent />
            </ReceptionItemGate>
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const nombreCompleto = (
  c: Pick<Customer, "firstName" | "lastNamePaternal" | "lastNameMaternal">,
) => [c.firstName, c.lastNamePaternal, c.lastNameMaternal].filter(Boolean).join(" ");

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

function CustomersContent() {
  const { t, i18n } = useTranslation();
  const entidad = useReceptionEntity();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("reception:manage") && canWrite;
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const locale = i18n.language === "en" ? "en-US" : "es-MX";

  const [query, setQuery] = useState("");
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dep ES el filtro
  useEffect(() => {
    setPagina(1);
  }, [query]);
  const { data, isPending } = useCustomers({ query: query.trim() || undefined, page: pagina });
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [turno, setTurno] = useState<Turn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const removeCustomer = useRemoveCustomer();
  const createTurn = useCreateTurn();

  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("reception.customers.title", entidad.vars)}</h1>
        {canManage && (
          <Link to="/reception/customers/new" className={BOTON_PRIMARIO}>
            {t("reception.customers.new")}
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="customer-search">{t("reception.customers.search", entidad.vars)}</Label>
        <Input
          id="customer-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("reception.customers.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="customers-empty" className="text-muted-foreground text-sm">
          {t("reception.customers.empty", entidad.vars)}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("reception.customers.columns.name")}</TableHead>
              <TableHead className="px-2">{t("reception.customers.columns.phone")}</TableHead>
              <TableHead className="px-2">{t("reception.customers.columns.email")}</TableHead>
              <TableHead className="px-2">{t("reception.customers.columns.age")}</TableHead>
              <TableHead className="px-2">{t("reception.customers.columns.createdAt")}</TableHead>
              {canManage && <TableHead className="px-2" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((customer) => (
              <TableRow key={customer.id} data-testid={`customer-${customer.id}`}>
                <TableCell className="px-2 font-medium">{nombreCompleto(customer)}</TableCell>
                <TableCell className="px-2 tabular-nums">{customer.phone ?? "—"}</TableCell>
                <TableCell className="px-2">{customer.email ?? "—"}</TableCell>
                <TableCell className="px-2">
                  {customer.age === null
                    ? "—"
                    : t("reception.customers.years", { count: customer.age })}
                </TableCell>
                <TableCell className="px-2 whitespace-nowrap">
                  {formatBusinessDate(customer.createdAt, locale, timeZone)}
                </TableCell>
                {canManage && (
                  <TableCell className="px-2 text-right whitespace-nowrap">
                    {/* Si el negocio apagó los turnos en su configuración, no
                        se generan desde ningún lado: tampoco desde la fila. */}
                    {entidad.settings.showTurns && (
                      <RowAction
                        intent="view"
                        disabled={createTurn.isPending}
                        onClick={() => {
                          setError(null);
                          createTurn.mutate(
                            { customerId: customer.id },
                            {
                              onSuccess: setTurno,
                              onError: (apiError: ApiError) => setError(apiError.message),
                            },
                          );
                        }}
                      >
                        {t("reception.customers.issueTurn")}
                      </RowAction>
                    )}
                    <Link
                      to="/reception/customers/$customerId"
                      params={{ customerId: customer.id }}
                      className="inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline"
                    >
                      {t("common.actions.edit")}
                    </Link>
                    <RowAction
                      intent="delete"
                      onClick={() => {
                        setError(null);
                        setDeleting(customer);
                      }}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Solo el borrado pide confirmación: es lo único sin vuelta atrás. */}
      {deleting && (
        <ConfirmDialog
          title={t("reception.customers.delete.title", { name: nombreCompleto(deleting) })}
          body={t("reception.customers.delete.body", entidad.vars)}
          confirmLabel={t("reception.customers.delete.confirm", entidad.vars)}
          cancelLabel={t("common.form.cancel")}
          busy={removeCustomer.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            removeCustomer.mutate(deleting.id, {
              onError: (apiError: ApiError) => setError(apiError.message),
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
      {turno && <TurnNumberDialog turn={turno} onClose={() => setTurno(null)} />}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </div>
  );
}
