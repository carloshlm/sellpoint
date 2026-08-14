import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { PermissionGroup } from "@/lib/rbac/api";
import { PermissionChecklist } from "./permission-checklist";

/**
 * F1-WEB-USERS WU6 (D4/D5 del design). Presentacional puro: sin queries ni
 * store. Estado del checklist = `Set<string>` de CÓDIGOS — nunca índices
 * (riesgo #1 del proposal: mapear por índice es exactamente cómo un checkbox
 * otorga un permiso equivocado en silencio).
 */

const GROUPS: PermissionGroup[] = [
  {
    module: "users",
    permissions: [
      { code: "users:read", description: null },
      { code: "users:manage", description: null },
    ],
  },
  {
    module: "roles",
    permissions: [{ code: "roles:manage", description: null }],
  },
  {
    // Ni owned por el actor ni en el baseline del rol en los props default —
    // el único code que ejercita el caso "no poseído Y no en el rol".
    module: "products",
    permissions: [{ code: "products:manage", description: null }],
  },
];

function renderChecklist(props: Partial<React.ComponentProps<typeof PermissionChecklist>> = {}) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <PermissionChecklist
        groups={GROUPS}
        baselinePermissionCodes={["users:read", "roles:manage"]}
        actorPermissionCodes={["users:read", "users:manage"]}
        selected={new Set(["users:read", "roles:manage"])}
        onToggle={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

describe("PermissionChecklist", () => {
  it("togglear un checkbox emite el CODE, no un índice", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderChecklist({ onToggle });

    await user.click(screen.getByRole("checkbox", { name: "users:manage" }));

    expect(onToggle).toHaveBeenCalledWith("users:manage", true);
  });

  it("desmarcar un code ya seleccionado emite (code, false)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderChecklist({ onToggle });

    await user.click(screen.getByRole("checkbox", { name: "users:read" }));

    expect(onToggle).toHaveBeenCalledWith("users:read", false);
  });

  it("un code que el actor NO posee y que NO está en el rol (baseline) aparece deshabilitado", () => {
    renderChecklist();

    expect(screen.getByRole("checkbox", { name: "products:manage" })).toBeDisabled();
  });

  it("un code que el actor NO posee pero SÍ está en el rol (baseline) aparece HABILITADO (D5)", () => {
    // roles:manage está en el baseline del rol (ya asignado) aunque el actor
    // no lo posea — debe poder QUITARSE (y re-agregarse) sin romper el guard
    // anti-escalada del backend, que valida el delta contra el baseline.
    renderChecklist({
      baselinePermissionCodes: ["users:read", "roles:manage"],
      actorPermissionCodes: ["users:read"],
      selected: new Set(["users:read", "roles:manage"]),
    });

    expect(screen.getByRole("checkbox", { name: "roles:manage" })).toBeEnabled();
  });

  it("un code que el actor SÍ posee siempre está habilitado, esté o no en el baseline", () => {
    renderChecklist({
      baselinePermissionCodes: [],
      actorPermissionCodes: ["users:read", "users:manage"],
      selected: new Set(),
    });

    expect(screen.getByRole("checkbox", { name: "users:manage" })).toBeEnabled();
  });

  it("agrupa los permisos por módulo", () => {
    renderChecklist();

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("roles")).toBeInTheDocument();
  });
});
