import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paginator } from "@/components/ui/paginator";
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
import type { Service } from "@/lib/services/api";
import {
  useCreateService,
  useRemoveService,
  useServices,
  useUpdateService,
} from "@/lib/services/hooks";
import { useWarehouses } from "@/lib/warehouses/hooks";

export const Route = createFileRoute("/catalog/services")({
  component: ServicesPage,
});

/** F3-SVC-04 — catálogo de Servicios (CU-CAT-08). */
function ServicesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="services:read">
            <ServicesContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function ServicesContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("services:manage");

  const [query, setQuery] = useState("");
  const [pagina, setPagina] = useState(1);
  // Cualquier filtro vuelve a la página 1 (ver el docblock del Paginator).
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dep ES el filtro
  useEffect(() => {
    setPagina(1);
  }, [query]);
  const { data, isPending } = useServices({ query: query.trim() || undefined, page: pagina });
  const services = data?.rows;
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateService = useUpdateService();
  const removeService = useRemoveService();
  const { data: warehouses } = useWarehouses();

  function cerrarForm() {
    setCreating(false);
    setEditing(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("services.page.title")}</h1>
        {canManage && !creating && !editing && (
          <Button
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            {t("services.add")}
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          data-testid="services-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {error}
        </p>
      )}

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t(editing ? "services.form.editTitle" : "services.form.createTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* `key` fuerza un form nuevo al cambiar de fila: sin ella React
                reconcilia la misma instancia y arrastra los valores anteriores. */}
            <ServiceForm
              key={editing?.id ?? "create"}
              service={editing ?? undefined}
              warehouses={warehouses ?? []}
              onDone={cerrarForm}
              onError={setError}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="service-search">{t("services.search")}</Label>
        <Input
          id="service-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("services.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : (services ?? []).length === 0 ? (
        <p data-testid="services-empty" className="text-muted-foreground text-sm">
          {t("services.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2">{t("services.form.code")}</TableHead>
                <TableHead className="px-2">{t("services.form.name")}</TableHead>
                <TableHead className="px-2">{t("services.form.cost")}</TableHead>
                <TableHead className="px-2">{t("services.form.price")}</TableHead>
                <TableHead className="px-2">{t("services.warehouses.column")}</TableHead>
                <TableHead className="px-2">{t("services.status")}</TableHead>
                {canManage && <TableHead className="px-2" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(services ?? []).map((service) => (
                <TableRow key={service.id} data-testid={`service-${service.id}`}>
                  <TableCell className="px-2 font-mono">{service.code}</TableCell>
                  <TableCell className="px-2 font-medium">{service.name}</TableCell>
                  <TableCell className="px-2">{service.cost ?? "—"}</TableCell>
                  <TableCell className="px-2">{service.price ?? "—"}</TableCell>
                  <TableCell className="px-2">
                    {t("services.warehouses.count", {
                      count: service.warehouseIds.length,
                      total: (warehouses ?? []).length,
                    })}
                  </TableCell>
                  <TableCell className="px-2">
                    <Badge variant={service.isActive ? "success" : "default"}>
                      {t(service.isActive ? "services.active" : "services.inactive")}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="px-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setCreating(false);
                          setEditing(service);
                        }}
                      >
                        {t("common.form.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          updateService.mutate(
                            { id: service.id, input: { isActive: !service.isActive } },
                            { onError: (apiError: ApiError) => setError(apiError.message) },
                          );
                        }}
                      >
                        {t(service.isActive ? "services.deactivate" : "services.reactivate")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setDeleting(service);
                        }}
                      >
                        {t("common.form.delete")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Solo el borrado pide confirmación: es lo único sin vuelta atrás de
          esta pantalla. Desactivar se deshace con un clic. */}
      {deleting && (
        <ConfirmDialog
          title={t("services.delete.title", { name: deleting.name })}
          body={t("services.delete.body")}
          confirmLabel={t("services.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={removeService.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            removeService.mutate(deleting.id, {
              onError: (apiError: ApiError) => setError(apiError.message),
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

/** Alta y edición en el mismo form, discriminado por la prop `service`. */
function ServiceForm({
  service,
  warehouses,
  onDone,
  onError,
}: {
  service?: Service;
  /** Los almacenes del tenant. El checklist ES la disponibilidad del servicio. */
  warehouses: { id: string; name: string }[];
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(service?.code ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [cost, setCost] = useState(service?.cost ?? "");
  const [price, setPrice] = useState(service?.price ?? "");
  // F3-SVC-08. En el ALTA nacen todos marcados: sin almacenes el servicio no
  // se vende en ningún lado (semántica explícita), así que el caso común —un
  // negocio chico con un servicio general— no tiene que gestionar nada.
  // Desmarcar es RESTRINGIR.
  const [warehouseIds, setWarehouseIds] = useState<string[]>(
    service?.warehouseIds ?? warehouses.map((w) => w.id),
  );
  const todosMarcados = warehouses.length > 0 && warehouseIds.length === warehouses.length;

  function toggleAlmacen(id: string, checked: boolean) {
    setWarehouseIds((previos) =>
      checked ? [...previos, id] : previos.filter((actual) => actual !== id),
    );
  }

  const createService = useCreateService();
  const updateService = useUpdateService();
  const isSubmitting = createService.isPending || updateService.isPending;

  /** "" es "sin importe" (null), no cero: un servicio puede no tener costo. */
  const importe = (value: string): number | undefined =>
    value.trim() === "" ? undefined : Number(value);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const handlers = {
      onSuccess: () => onDone(),
      onError: (apiError: ApiError) => onError(apiError.message),
    };

    if (service) {
      updateService.mutate(
        {
          id: service.id,
          input: {
            code,
            name,
            description: description.trim() === "" ? null : description,
            cost: importe(cost) ?? null,
            price: importe(price) ?? null,
            warehouseIds,
          },
        },
        handlers,
      );
      return;
    }

    createService.mutate(
      {
        code,
        name,
        warehouseIds,
        ...(description.trim() === "" ? {} : { description }),
        ...(importe(cost) === undefined ? {} : { cost: importe(cost) }),
        ...(importe(price) === undefined ? {} : { price: importe(price) }),
      },
      handlers,
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("services.form.code")}
          hint={t("services.form.codeHint")}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <TextField
          label={t("services.form.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <TextField
        label={t("services.form.description")}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("services.form.cost")}
          type="number"
          step="0.01"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
        <TextField
          label={t("services.form.price")}
          type="number"
          step="0.01"
          hint={t("services.form.priceHint")}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      <fieldset className="flex flex-col gap-2" data-testid="service-warehouses">
        <div className="flex items-center justify-between gap-2">
          <legend className="font-medium text-sm">{t("services.warehouses.legend")}</legend>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setWarehouseIds(todosMarcados ? [] : warehouses.map((warehouse) => warehouse.id))
            }
          >
            {t(todosMarcados ? "services.warehouses.clearAll" : "services.warehouses.selectAll")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t("services.warehouses.hint")}</p>
        <div className="flex flex-col gap-2">
          {warehouses.map((warehouse) => {
            const inputId = `service-warehouse-${warehouse.id}`;
            return (
              <div key={warehouse.id} className="flex items-center gap-2">
                <Checkbox
                  id={inputId}
                  data-testid={inputId}
                  checked={warehouseIds.includes(warehouse.id)}
                  onCheckedChange={(next) => toggleAlmacen(warehouse.id, next === true)}
                />
                <Label htmlFor={inputId}>{warehouse.name}</Label>
              </div>
            );
          })}
        </div>
        {/*
          Cero almacenes es un estado VÁLIDO —un servicio en preparación— pero
          NO uno silencioso: quien desmarca todo tiene que saber que acaba de
          dejarlo fuera del punto de venta.
        */}
        {warehouseIds.length === 0 && (
          <p className="text-muted-foreground text-xs" data-testid="service-warehouses-empty-hint">
            {t("services.warehouses.emptyHint")}
          </p>
        )}
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !code.trim() || !name.trim()}>
          {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
