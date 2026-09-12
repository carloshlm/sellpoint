import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paginator } from "@/components/ui/paginator";
import { RowAction } from "@/components/ui/row-action";
import { SuccessNotice } from "@/components/ui/success-notice";
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
import type { Supplier } from "@/lib/suppliers/api";
import { useRemoveSupplier, useSuppliers, useUpdateSupplier } from "@/lib/suppliers/hooks";

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * F9-SUPPL-08 — el listado de proveedores (molde: clientes de Recepción,
 * componente `Table`). Alfabético, con buscador y paginado del API; activo o
 * inactivo con `Badge`. Borrar uno con compras o gastos rebota con 409: el
 * aviso se pinta y ofrece DESACTIVARLO ahí mismo, que es la salida real.
 */
export function SuppliersList() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("suppliers:manage") && canWrite;

  const [query, setQuery] = useState("");
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dep ES el filtro
  useEffect(() => {
    setPagina(1);
  }, [query]);
  const { data, isPending } = useSuppliers({ query: query.trim() || undefined, page: pagina });
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  // El nombre del que se acaba de borrar: el éxito tiene que VERSE (Carlos, 2026-09-12).
  const [deleted, setDeleted] = useState<string | null>(null);
  // El 409 recuerda a QUIÉN no se pudo borrar, para ofrecer desactivarlo.
  const [enUso, setEnUso] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const removeSupplier = useRemoveSupplier();
  const updateSupplier = useUpdateSupplier();

  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("suppliers.list.title")}</h1>
        {canManage && (
          <Link to="/suppliers/new" className={BOTON_PRIMARIO}>
            {t("suppliers.list.new")}
          </Link>
        )}
      </div>

      {deleted !== null && (
        <SuccessNotice testId="supplier-deleted">
          {t("suppliers.list.delete.done", { name: deleted })}
        </SuccessNotice>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          <span>{error}</span>
          {enUso?.isActive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={updateSupplier.isPending}
              onClick={() => {
                updateSupplier.mutate(
                  { id: enUso.id, input: { isActive: false } },
                  {
                    onSuccess: () => {
                      setError(null);
                      setEnUso(null);
                    },
                    onError: (apiError: ApiError) => setError(apiError.message),
                  },
                );
              }}
            >
              {t("suppliers.list.deactivate")}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="supplier-search">{t("suppliers.list.search")}</Label>
        <Input
          id="supplier-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("suppliers.list.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="suppliers-empty" className="text-muted-foreground text-sm">
          {t("suppliers.list.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("suppliers.list.columns.name")}</TableHead>
              <TableHead className="px-2">{t("suppliers.list.columns.taxId")}</TableHead>
              <TableHead className="px-2">{t("suppliers.list.columns.contact")}</TableHead>
              <TableHead className="px-2">{t("suppliers.list.columns.phone")}</TableHead>
              <TableHead className="px-2">{t("suppliers.list.columns.email")}</TableHead>
              <TableHead className="px-2">{t("suppliers.list.columns.status")}</TableHead>
              {canManage && <TableHead className="px-2" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((supplier) => (
              <TableRow key={supplier.id} data-testid={`supplier-${supplier.id}`}>
                <TableCell className="px-2 font-medium">{supplier.name}</TableCell>
                <TableCell className="px-2 font-mono">{supplier.taxId ?? "—"}</TableCell>
                <TableCell className="px-2">{supplier.contactName ?? "—"}</TableCell>
                <TableCell className="px-2 tabular-nums">{supplier.phone ?? "—"}</TableCell>
                <TableCell className="px-2">{supplier.email ?? "—"}</TableCell>
                <TableCell className="px-2">
                  <Badge variant={supplier.isActive ? "success" : "default"}>
                    {supplier.isActive
                      ? t("suppliers.list.status.active")
                      : t("suppliers.list.status.inactive")}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="px-2 text-right whitespace-nowrap">
                    <Link
                      to="/suppliers/$supplierId"
                      params={{ supplierId: supplier.id }}
                      className="inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline"
                    >
                      {t("common.actions.edit")}
                    </Link>
                    <RowAction
                      intent="delete"
                      onClick={() => {
                        setError(null);
                        setEnUso(null);
                        setDeleted(null);
                        setDeleting(supplier);
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
          title={t("suppliers.list.delete.title", { name: deleting.name })}
          body={t("suppliers.list.delete.body")}
          confirmLabel={t("suppliers.list.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={removeSupplier.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const objetivo = deleting;
            removeSupplier.mutate(objetivo.id, {
              onSuccess: () => setDeleted(objetivo.name),
              onError: (apiError: ApiError) => {
                setError(apiError.message);
                if (apiError.statusCode === 409) setEnUso(objetivo);
              },
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </div>
  );
}
