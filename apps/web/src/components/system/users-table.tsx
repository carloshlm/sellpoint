import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserDetail } from "@/lib/rbac/api";

const PAGE_SIZE = 10;

function fullName(user: UserDetail): string {
  return [user.firstName, user.lastNamePaternal, user.lastNameMaternal].filter(Boolean).join(" ");
}

const STATUS_VARIANT: Record<UserDetail["status"], "warning" | "success" | "destructive"> = {
  invited: "warning",
  active: "success",
  suspended: "destructive",
};

function StatusBadge({ status }: { status: UserDetail["status"] }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`users.table.status.${status}`)}</Badge>;
}

/**
 * D6 del design: react-table HEADLESS sobre la lista completa que ya trajo
 * `GET /users` — sin requests nuevas al buscar o paginar, `getFilteredRowModel`
 * + `getPaginationRowModel` resuelven todo en cliente.
 *
 * `canManage` viaja como PROP (D1): decide si se reserva la columna
 * "Acciones". Batch 2 (F1-WEB-USERS-03) la llena con "Editar"; suspender/
 * reactivar/reenviar/reset viven en el menú `⋮` de WU5 (Batch 3) — ese menú
 * probablemente absorba este botón junto a las demás acciones.
 * Presentacional puro: sin queries ni store, testeable con solo props.
 */
function UsersTable({
  users,
  canManage,
  onEdit,
}: {
  users: UserDetail[];
  canManage: boolean;
  onEdit: (user: UserDetail) => void;
}) {
  const { t } = useTranslation();
  const [globalFilter, setGlobalFilter] = React.useState("");

  const columns = React.useMemo<LegacyColumnDef<UserDetail>[]>(() => {
    const base: LegacyColumnDef<UserDetail>[] = [
      {
        id: "name",
        header: t("users.table.columns.name"),
        accessorFn: fullName,
        cell: ({ row }) => fullName(row.original),
      },
      {
        id: "email",
        header: t("users.table.columns.email"),
        accessorKey: "email",
      },
      {
        id: "roles",
        header: t("users.table.columns.roles"),
        accessorFn: (user) => user.roles.map((role) => role.name).join(", "),
      },
      {
        id: "status",
        header: t("users.table.columns.status"),
        accessorKey: "status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ];

    if (canManage) {
      base.push({
        id: "actions",
        header: t("users.table.columns.actions"),
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(row.original)}>
            {t("users.table.editAction")}
          </Button>
        ),
      });
    }

    return base;
  }, [canManage, onEdit, t]);

  const table = useLegacyTable({
    data: users,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const search = String(filterValue).trim().toLowerCase();
      if (!search) return true;
      const user = row.original as UserDetail;
      return (
        fullName(user).toLowerCase().includes(search) || user.email.toLowerCase().includes(search)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm">
        <Input
          aria-label={t("users.table.searchLabel")}
          placeholder={t("users.table.searchPlaceholder")}
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
        />
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("users.table.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {t("users.table.pagination.pageOf", {
              page: table.getState().pagination.pageIndex + 1,
              total: table.getPageCount(),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {t("users.table.pagination.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {t("users.table.pagination.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { UsersTable };
