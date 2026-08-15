import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { RoleSummary } from "@/lib/rbac/api";
import { StepInvites } from "./step-invites";

/**
 * F1-WEB-ONBOARD-04 (tarea 03.1/03.2 del batch 04+05, apply-progress
 * #355/#351). Paso 4: filas dinámicas email+nombre+rol (D5, #347). El
 * submit real (`POST /users` por fila, Promise.allSettled) lo hace el
 * container (`routes/onboarding.tsx`); acá solo se emite
 * `onSubmit(rows)`/`onSkip()`.
 */
const ROLES: RoleSummary[] = [
  { id: "r1", name: "Cajero", permissionCodes: ["sales:read"], userCount: 2 },
  { id: "r2", name: "Admin", permissionCodes: ["users:manage"], userCount: 1 },
];

function renderStep(props: Partial<React.ComponentProps<typeof StepInvites>> = {}) {
  const onSubmit = vi.fn();
  const onSkip = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <StepInvites
        roles={ROLES}
        isSubmitting={false}
        onSubmit={onSubmit}
        onSkip={onSkip}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onSubmit, onSkip };
}

function row(index: number) {
  return screen.getByTestId(`invite-row-${index}`);
}

describe("StepInvites", () => {
  it("nace con una fila vacía (email, nombre, apellido paterno, rol)", () => {
    renderStep();

    expect(screen.getByTestId("step-invites")).toBeInTheDocument();
    expect(within(row(0)).getByLabelText("Email")).toHaveValue("");
    expect(within(row(0)).getByLabelText("Nombre")).toHaveValue("");
    expect(within(row(0)).getByLabelText("Apellido paterno")).toHaveValue("");
    expect(within(row(0)).getByLabelText("Rol")).toHaveValue("");
  });

  it("'Agregar fila' agrega una fila más, 'Quitar fila' la elimina", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "Agregar fila" }));
    expect(row(1)).toBeInTheDocument();

    await user.click(within(row(1)).getByRole("button", { name: "Quitar fila" }));
    expect(screen.queryByTestId("invite-row-1")).not.toBeInTheDocument();
  });

  it("sin llenar la única fila, 'Quitar fila' no aparece (mínimo 1 fila)", () => {
    renderStep();

    expect(within(row(0)).queryByRole("button", { name: "Quitar fila" })).not.toBeInTheDocument();
  });

  it("Enviar invitaciones con filas válidas emite onSubmit con los datos de cada fila", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.type(within(row(0)).getByLabelText("Email"), "ana@acme.mx");
    await user.type(within(row(0)).getByLabelText("Nombre"), "Ana");
    await user.type(within(row(0)).getByLabelText("Apellido paterno"), "García");
    await user.selectOptions(within(row(0)).getByLabelText("Rol"), "Cajero");
    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    expect(onSubmit).toHaveBeenCalledWith([
      { email: "ana@acme.mx", firstName: "Ana", lastNamePaternal: "García", roleId: "r1" },
    ]);
  });

  it("con una fila sin completar, Enviar invitaciones NO emite onSubmit (validación zod)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(row(0)).getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("Omitir emite onSkip sin validar ni requerir filas completas", async () => {
    const user = userEvent.setup();
    const { onSkip, onSubmit } = renderStep();

    await user.click(screen.getByRole("button", { name: "Omitir" }));

    expect(onSkip).toHaveBeenCalledWith();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("muestra el resultado por fila: éxito en una, error en otra, sin bloquear ninguna", async () => {
    const user = userEvent.setup();
    renderStep({
      rowResults: {
        0: { status: "success" },
        1: { status: "error", message: "Ese correo ya está en uso." },
      },
    });
    await user.click(screen.getByRole("button", { name: "Agregar fila" }));

    expect(within(row(0)).getByText("Invitación enviada.")).toBeInTheDocument();
    expect(within(row(1)).getByRole("alert")).toHaveTextContent("Ese correo ya está en uso.");
  });

  it("una fila ya exitosa queda deshabilitada (no se reenvía al reintentar)", () => {
    renderStep({ rowResults: { 0: { status: "success" } } });

    expect(within(row(0)).getByLabelText("Email")).toBeDisabled();
  });

  it("mientras isSubmitting, Enviar invitaciones queda deshabilitado", () => {
    renderStep({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  });

  it("con lng: 'en', el paso 4 se muestra en inglés", async () => {
    const i18n = createI18n();
    await i18n.changeLanguage("en");
    render(
      <I18nextProvider i18n={i18n}>
        <StepInvites roles={ROLES} isSubmitting={false} onSubmit={vi.fn()} onSkip={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Invite your team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invitations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });
});
