import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { Warehouse } from "@/lib/warehouses/api";
import { useCreateWarehouse, useUpdateWarehouse, useWarehouses } from "@/lib/warehouses/hooks";

export const Route = createFileRoute("/warehouses")({
  component: WarehousesPage,
});

/** F2-WH-02/03 — lista y alta/edición de almacenes. */
function WarehousesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="warehouses:read">
            <WarehousesContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function WarehousesContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("warehouses:manage");
  const { data: warehouses, isPending } = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [creating, setCreating] = useState(false);
  const updateWarehouse = useUpdateWarehouse();
  const [error, setError] = useState<string | null>(null);

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("warehouses.page.title")}</h1>
        {canManage && !creating && !editing && (
          <Button onClick={() => setCreating(true)}>{t("warehouses.add")}</Button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          data-testid="warehouses-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("warehouses.page.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WarehouseForm
              key={editing?.id ?? "create"}
              warehouse={editing ?? undefined}
              onDone={() => {
                setEditing(null);
                setCreating(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      {(warehouses ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="warehouses-empty">
          {t("warehouses.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("warehouses.form.name")}</TableHead>
              <TableHead>{t("warehouses.form.address")}</TableHead>
              <TableHead>{t("warehouses.status")}</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(warehouses ?? []).map((warehouse) => (
              <TableRow key={warehouse.id} data-testid={`warehouse-${warehouse.id}`}>
                <TableCell className="font-medium">{warehouse.name}</TableCell>
                <TableCell>{warehouse.address ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={warehouse.isActive ? "success" : "default"}>
                    {warehouse.isActive ? t("warehouses.active") : t("warehouses.inactive")}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCreating(false);
                        setEditing(warehouse);
                      }}
                    >
                      {t("common.form.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        updateWarehouse.mutate(
                          { id: warehouse.id, input: { isActive: !warehouse.isActive } },
                          { onError: (apiError: ApiError) => setError(apiError.message) },
                        );
                      }}
                    >
                      {warehouse.isActive ? t("warehouses.deactivate") : t("warehouses.reactivate")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function WarehouseForm({ warehouse, onDone }: { warehouse?: Warehouse; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(warehouse?.name ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const isSubmitting = createWarehouse.isPending || updateWarehouse.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const onError = (apiError: ApiError) => setError(apiError.message);

        if (warehouse) {
          updateWarehouse.mutate(
            { id: warehouse.id, input: { name, address: address || null } },
            { onSuccess: onDone, onError },
          );
          return;
        }
        createWarehouse.mutate(
          { name, ...(address ? { address } : {}) },
          { onSuccess: onDone, onError },
        );
      }}
    >
      {error && (
        <p
          role="alert"
          data-testid="warehouse-form-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <TextField
        label={t("warehouses.form.name")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {/* Texto libre y opcional: los formatos postales difieren entre los 26
          mercados (MERCADOS.md § 4). */}
      <TextField
        label={t("warehouses.form.address")}
        hint={t("warehouses.form.addressHint")}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
