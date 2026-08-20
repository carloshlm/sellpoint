import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { UserDetail } from "@/lib/rbac/api";
import { UserRowActions } from "./user-row-actions";

/**
 * D9 del design: menú `⋮` sobre `radix-ui`'s DropdownMenu (roving focus real,
 * a diferencia del `UserMenu` ad-hoc del header). Reglas de visibilidad =
 * tabla de "Acciones de fila" del design — presentacional puro, sin queries.
 */

function makeUser(overrides: Partial<UserDetail>): UserDetail {
  return {
    id: overrides.id ?? "u1",
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

function renderActions(
  user: UserDetail,
  actorId = "me",
  callbacks: Partial<{
    onEdit: (user: UserDetail) => void;
    onSuspend: (user: UserDetail) => void;
    onReactivate: (user: UserDetail) => void;
    onResendInvitation: (user: UserDetail) => void;
    onResetPassword: (user: UserDetail) => void;
  }> = {},
) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <UserRowActions
        user={user}
        actorId={actorId}
        onEdit={callbacks.onEdit ?? vi.fn()}
        onSuspend={callbacks.onSuspend ?? vi.fn()}
        onReactivate={callbacks.onReactivate ?? vi.fn()}
        onResendInvitation={callbacks.onResendInvitation ?? vi.fn()}
        onResetPassword={callbacks.onResetPassword ?? vi.fn()}
      />
    </I18nextProvider>,
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Acciones" }));
  return user;
}

describe("UserRowActions", () => {
  it("la fila del propio actor NO ofrece 'Suspender'", async () => {
    renderActions(makeUser({ id: "me", status: "active" }), "me");
    await openMenu();

    expect(await screen.findByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Suspender" })).not.toBeInTheDocument();
  });

  it("un usuario activo distinto del actor SÍ ofrece 'Suspender' y 'Restablecer contraseña', pero no 'Reactivar' ni 'Reenviar invitación'", async () => {
    renderActions(makeUser({ id: "other", status: "active" }), "me");
    await openMenu();

    expect(await screen.findByRole("menuitem", { name: "Suspender" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Restablecer contraseña" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reactivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reenviar invitación" })).not.toBeInTheDocument();
  });

  it("un usuario 'invited' ofrece 'Reenviar invitación' pero no 'Suspender', 'Reactivar' ni 'Restablecer contraseña'", async () => {
    renderActions(makeUser({ id: "other", status: "invited" }), "me");
    await openMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Reenviar invitación" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Suspender" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reactivar" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Restablecer contraseña" }),
    ).not.toBeInTheDocument();
  });

  it("un usuario 'suspended' ofrece 'Reactivar' pero no 'Suspender', 'Reenviar invitación' ni 'Restablecer contraseña'", async () => {
    renderActions(makeUser({ id: "other", status: "suspended" }), "me");
    await openMenu();

    expect(await screen.findByRole("menuitem", { name: "Reactivar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Suspender" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reenviar invitación" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Restablecer contraseña" }),
    ).not.toBeInTheDocument();
  });

  it("'Editar' llama onEdit con el usuario", async () => {
    const onEdit = vi.fn();
    const target = makeUser({ id: "other", status: "active" });
    renderActions(target, "me", { onEdit });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

    expect(onEdit).toHaveBeenCalledWith(target);
  });

  it("'Suspender' pide confirmación: cancelarla NO llama onSuspend", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onSuspend = vi.fn();
    const target = makeUser({ id: "other", status: "active" });
    renderActions(target, "me", { onSuspend });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Suspender" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onSuspend).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("'Suspender' pide confirmación: confirmarla llama onSuspend con el usuario", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSuspend = vi.fn();
    const target = makeUser({ id: "other", status: "active" });
    renderActions(target, "me", { onSuspend });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Suspender" }));

    expect(onSuspend).toHaveBeenCalledWith(target);
    confirmSpy.mockRestore();
  });

  it("'Reactivar' llama onReactivate sin confirmación", async () => {
    const onReactivate = vi.fn();
    const target = makeUser({ id: "other", status: "suspended" });
    renderActions(target, "me", { onReactivate });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Reactivar" }));

    expect(onReactivate).toHaveBeenCalledWith(target);
  });

  it("'Reenviar invitación' llama onResendInvitation sin confirmación", async () => {
    const onResendInvitation = vi.fn();
    const target = makeUser({ id: "other", status: "invited" });
    renderActions(target, "me", { onResendInvitation });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Reenviar invitación" }));

    expect(onResendInvitation).toHaveBeenCalledWith(target);
  });

  it("'Restablecer contraseña' llama onResetPassword sin confirmación", async () => {
    const onResetPassword = vi.fn();
    const target = makeUser({ id: "other", status: "active" });
    renderActions(target, "me", { onResetPassword });
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));

    expect(onResetPassword).toHaveBeenCalledWith(target);
  });
});
