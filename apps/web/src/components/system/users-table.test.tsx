import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { UserDetail } from "@/lib/rbac/api";
import { UsersTable } from "./users-table";

/**
 * D6 del design: react-table headless, `getFilteredRowModel` +
 * `getPaginationRowModel`. Todo client-side — `GET /users` trae el tenant
 * entero, así que filtrar/paginar acá es exacto y sin latencia (decisión del
 * proposal: server-side "cuando duela").
 */

function makeUser(overrides: Partial<UserDetail>): UserDetail {
  return {
    id: overrides.id ?? "u",
    email: overrides.email ?? "user@acme.mx",
    firstName: overrides.firstName ?? "Nombre",
    lastNamePaternal: overrides.lastNamePaternal ?? "Apellido",
    lastNameMaternal: overrides.lastNameMaternal ?? null,
    status: overrides.status ?? "active",
    locale: overrides.locale ?? "es",
    defaultWarehouseId: null,
    roles: overrides.roles ?? [{ id: "r1", name: "Cajero" }],
  };
}

function renderTable(
  users: UserDetail[],
  canManage = false,
  overrides: Partial<{
    actorId: string;
    onEdit: (user: UserDetail) => void;
    onSuspend: (user: UserDetail) => void;
    onReactivate: (user: UserDetail) => void;
    onResendInvitation: (user: UserDetail) => void;
    onResetPassword: (user: UserDetail) => void;
  }> = {},
) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <UsersTable
        users={users}
        canManage={canManage}
        actorId={overrides.actorId ?? "actor"}
        onEdit={overrides.onEdit ?? vi.fn()}
        onSuspend={overrides.onSuspend ?? vi.fn()}
        onReactivate={overrides.onReactivate ?? vi.fn()}
        onResendInvitation={overrides.onResendInvitation ?? vi.fn()}
        onResetPassword={overrides.onResetPassword ?? vi.fn()}
      />
    </I18nextProvider>,
  );
}

describe("UsersTable", () => {
  it("busca por nombre o email y filtra sin pedir datos nuevos", async () => {
    const user = userEvent.setup();
    renderTable([
      makeUser({ id: "1", firstName: "Ana", lastNamePaternal: "García", email: "ana@acme.mx" }),
      makeUser({ id: "2", firstName: "Beto", lastNamePaternal: "López", email: "beto@acme.mx" }),
    ]);

    expect(screen.getByText("Ana García")).toBeInTheDocument();
    expect(screen.getByText("Beto López")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Buscar por nombre o correo"), "beto");

    expect(screen.queryByText("Ana García")).not.toBeInTheDocument();
    expect(screen.getByText("Beto López")).toBeInTheDocument();
  });

  it("filtra también por email, no solo por nombre", async () => {
    const user = userEvent.setup();
    renderTable([
      makeUser({ id: "1", firstName: "Ana", lastNamePaternal: "García", email: "ana@acme.mx" }),
      makeUser({ id: "2", firstName: "Beto", lastNamePaternal: "López", email: "beto@acme.mx" }),
    ]);

    await user.type(screen.getByLabelText("Buscar por nombre o correo"), "beto@acme.mx");

    expect(screen.queryByText("Ana García")).not.toBeInTheDocument();
    expect(screen.getByText("Beto López")).toBeInTheDocument();
  });

  it("pagina client-side: 12 usuarios muestran 10 y el resto en la página 2", async () => {
    const user = userEvent.setup();
    const users = Array.from({ length: 12 }, (_, i) =>
      makeUser({ id: `${i}`, firstName: `User${i}`, email: `user${i}@acme.mx` }),
    );
    renderTable(users);

    expect(screen.getAllByRole("row")).toHaveLength(11); // 10 filas + header
    expect(screen.getByText("User9 Apellido")).toBeInTheDocument();
    expect(screen.queryByText("User10 Apellido")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("User10 Apellido")).toBeInTheDocument();
    expect(screen.queryByText("User0 Apellido")).not.toBeInTheDocument();
  });

  it("badges por estado: cada status se muestra traducido", () => {
    renderTable([
      makeUser({ id: "1", status: "invited", firstName: "I" }),
      makeUser({ id: "2", status: "active", firstName: "A" }),
      makeUser({ id: "3", status: "suspended", firstName: "S" }),
    ]);

    const rows = screen.getAllByRole("row").slice(1); // sin header
    expect(within(rows[0] as HTMLElement).getByText("Invitado")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Activo")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Suspendido")).toBeInTheDocument();
  });

  it("sin canManage no hay columna de acciones; con canManage sí (el layout ya la contempla)", () => {
    const users = [makeUser({ id: "1" })];
    const { unmount } = renderTable(users, false);
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    unmount();

    renderTable(users, true);
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
  });

  it("con canManage, el menú ⋮ de cada fila tiene 'Editar' y llama onEdit con ese usuario (F1-WEB-USERS-04)", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const ana = makeUser({ id: "1", firstName: "Ana", lastNamePaternal: "García" });
    renderTable([ana], true, { onEdit });

    await user.click(screen.getByRole("button", { name: "Acciones" }));
    await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

    expect(onEdit).toHaveBeenCalledWith(ana);
  });

  it("sin resultados muestra el vacío explicado", async () => {
    const user = userEvent.setup();
    renderTable([makeUser({ id: "1", firstName: "Ana", email: "ana@acme.mx" })]);

    await user.type(screen.getByLabelText("Buscar por nombre o correo"), "zzz-no-existe");

    expect(screen.getByText("No hay usuarios que coincidan con la búsqueda.")).toBeInTheDocument();
  });
});
