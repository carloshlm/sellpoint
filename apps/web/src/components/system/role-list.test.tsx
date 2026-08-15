import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { RoleSummary } from "@/lib/rbac/api";
import { RoleList } from "./role-list";

/**
 * F1-WEB-USERS WU6. Sidebar de roles presentacional: selección + "Eliminar"
 * deshabilitado si `userCount > 0` (previene client-side el 409
 * `roles.role_in_use` en vez de solo manejarlo).
 */

const ROLES: RoleSummary[] = [
  { id: "r1", name: "Cajero", permissionCodes: ["sales:read"], userCount: 3 },
  { id: "r2", name: "Sin uso", permissionCodes: [], userCount: 0 },
];

function renderList(props: Partial<React.ComponentProps<typeof RoleList>> = {}) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <RoleList
        roles={ROLES}
        selectedRoleId="r1"
        canManage={true}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

describe("RoleList", () => {
  it("lista los roles del tenant", () => {
    renderList();

    expect(screen.getByText("Cajero")).toBeInTheDocument();
    expect(screen.getByText("Sin uso")).toBeInTheDocument();
  });

  it("seleccionar un rol llama onSelect con su id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderList({ onSelect });

    await user.click(screen.getByRole("button", { name: /Sin uso/ }));

    expect(onSelect).toHaveBeenCalledWith("r2");
  });

  it("'Eliminar' está deshabilitado cuando userCount > 0 (previene roles.role_in_use)", () => {
    renderList();

    // W4: el disabled trae un aria-label distinto ("Eliminar — motivo") —
    // el regex matchea ambos botones, igual que el string exacto antes.
    const deleteButtons = screen.getAllByRole("button", { name: /^Eliminar/ });
    const cajeroDelete = deleteButtons[0];
    expect(cajeroDelete).toBeDisabled();
  });

  // W4 (verify-report #341): `title` sobre un botón deshabilitado no dispara
  // tooltip nativo en Firefox/Safari — el motivo del disabled debe ser
  // accesible SIEMPRE, no solo con hover en Chromium.
  it("el motivo de 'Eliminar' deshabilitado es accesible vía aria, no solo title", () => {
    renderList();

    const cajeroDelete = screen.getByRole("button", {
      name: "Eliminar — Este rol tiene usuarios asignados. No se puede eliminar.",
    });
    expect(cajeroDelete).toBeDisabled();
  });

  // W4: el design pedía un sidebar con `userCount`, la clave
  // `roles.editor.userCount(_other)` existía pero el número no se
  // renderizaba en ningún lado.
  it("muestra el userCount junto al nombre de cada rol", () => {
    renderList();

    expect(screen.getByText("3 usuarios")).toBeInTheDocument();
    expect(screen.getByText("0 usuarios")).toBeInTheDocument();
  });

  it("'Eliminar' está habilitado cuando userCount === 0", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderList({ onDelete });

    const deleteButtons = screen.getAllByRole("button", { name: /^Eliminar/ });
    const sinUsoDelete = deleteButtons[1];
    expect(sinUsoDelete).toBeEnabled();
    if (!sinUsoDelete) throw new Error("botón eliminar no encontrado");
    await user.click(sinUsoDelete);

    expect(onDelete).toHaveBeenCalledWith(ROLES[1]);
  });

  it("sin canManage no ofrece 'Eliminar' ni 'Nuevo rol'", () => {
    renderList({ canManage: false });

    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo rol" })).not.toBeInTheDocument();
  });

  it("'Nuevo rol' llama onCreate", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderList({ onCreate });

    await user.click(screen.getByRole("button", { name: "Nuevo rol" }));

    expect(onCreate).toHaveBeenCalled();
  });
});
