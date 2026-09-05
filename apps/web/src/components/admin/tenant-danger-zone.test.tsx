import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as adminApi from "@/lib/admin/api";
import { createQueryClient } from "@/lib/query-client";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { TenantDangerZone } from "./tenant-danger-zone";

vi.mock("@/lib/admin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/api")>()),
  suspendTenant: vi.fn(),
  reactivateTenant: vi.fn(),
  deleteTenant: vi.fn(),
}));
const mocked = vi.mocked(adminApi);

/**
 * F7-LIFECYCLE-08 — la «Zona de peligro» del expediente: desactivar con
 * motivo, reactivar, y eliminar solo cuando el API dice `deletable`, con el
 * nombre exacto y la contraseña del administrador. Nunca sobre el propio
 * negocio.
 */
const admin = (): AuthUser => ({
  id: "admin-1",
  email: "carlos@backoffice.mx",
  firstName: "Carlos",
  lastNamePaternal: "H",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["tenants:manage"],
  isPlatformAdmin: true,
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
    id: "backoffice",
    name: "BACKOFFICE",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

const activo: adminApi.TenantLifecycleView = {
  suspendedAt: null,
  suspendedBy: null,
  reason: null,
  suspendedDays: 0,
  deletableAt: null,
  deletable: false,
};
const hace3dias: adminApi.TenantLifecycleView = {
  suspendedAt: "2026-09-01T15:00:00.000Z",
  suspendedBy: { id: "admin-1", name: "Carlos H" },
  reason: "Impago reiterado",
  suspendedDays: 3,
  deletableAt: "2026-10-01T15:00:00.000Z",
  deletable: false,
};
const hace31dias: adminApi.TenantLifecycleView = {
  ...hace3dias,
  suspendedAt: "2026-08-04T15:00:00.000Z",
  suspendedDays: 31,
  deletableAt: "2026-09-03T15:00:00.000Z",
  deletable: true,
};

function renderZona(lifecycle: adminApi.TenantLifecycleView, tenantId = "t1") {
  useAuthStore.getState().setAuth("jwt", admin());
  const onDeleted = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <TenantDangerZone
          tenantId={tenantId}
          tenantName="Acme"
          timezone="America/Mexico_City"
          lifecycle={lifecycle}
          onDeleted={onDeleted}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { onDeleted };
}

beforeEach(() => {
  mocked.suspendTenant.mockResolvedValue(hace3dias);
  mocked.reactivateTenant.mockResolvedValue(activo);
  mocked.deleteTenant.mockResolvedValue({ purged: true, name: "Acme" });
});

afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().clearAuth();
});

describe("«Zona de peligro» del expediente (F7-LIFECYCLE-08)", () => {
  it("activo: «Desactivar negocio» pide motivo y no manda con 4 caracteres", async () => {
    renderZona(activo);
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: "Desactivar negocio" }));
    const dialogo = await screen.findByRole("alertdialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Desactivar negocio" });
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText("Motivo"), "abcd");
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText("Motivo"), "e");
    await usuario.click(confirmar);
    await waitFor(() => expect(mocked.suspendTenant).toHaveBeenCalledWith("t1", "abcde"));
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
  });

  it("desactivado hace 3 días: «Reactivar» y «Eliminar» deshabilitado con la fecha habilitante", async () => {
    renderZona(hace3dias);
    expect(
      screen.getByText(/Desactivado el 1\/9\/26 por Carlos H · lleva 3 días/),
    ).toBeInTheDocument();
    expect(screen.getByText("Motivo: Impago reiterado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar negocio" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar negocio" })).toBeDisabled();
    expect(screen.getByText("Se podrá eliminar a partir del 1/10/26.")).toBeInTheDocument();

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(mocked.reactivateTenant).toHaveBeenCalledWith("t1"));
  });

  it("desactivado hace 31 días: eliminar exige el nombre exacto y la contraseña, y avisa al terminar", async () => {
    const { onDeleted } = renderZona(hace31dias);
    const usuario = userEvent.setup();
    const eliminar = screen.getByRole("button", { name: "Eliminar negocio" });
    expect(eliminar).toBeEnabled();
    await usuario.click(eliminar);
    const dialogo = await screen.findByRole("alertdialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Eliminar definitivamente" });
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText("Escribe el nombre exacto: Acme"), "acme");
    await usuario.type(within(dialogo).getByLabelText("Tu contraseña"), "mi-clave");
    expect(confirmar).toBeDisabled();
    await usuario.clear(within(dialogo).getByLabelText("Escribe el nombre exacto: Acme"));
    await usuario.type(within(dialogo).getByLabelText("Escribe el nombre exacto: Acme"), "Acme");
    expect(confirmar).toBeEnabled();
    await usuario.click(confirmar);
    await waitFor(() =>
      expect(mocked.deleteTenant).toHaveBeenCalledWith("t1", {
        password: "mi-clave",
        confirmName: "Acme",
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("Acme"));
  });

  it("un 401 del API se lee dentro del diálogo y no se navega", async () => {
    mocked.deleteTenant.mockRejectedValue({
      statusCode: 401,
      message: "La contraseña no es correcta.",
      error: "Unauthorized",
    });
    const { onDeleted } = renderZona(hace31dias);
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: "Eliminar negocio" }));
    const dialogo = await screen.findByRole("alertdialog");
    await usuario.type(within(dialogo).getByLabelText("Escribe el nombre exacto: Acme"), "Acme");
    await usuario.type(within(dialogo).getByLabelText("Tu contraseña"), "mala");
    await usuario.click(within(dialogo).getByRole("button", { name: "Eliminar definitivamente" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "La contraseña no es correcta.",
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("el propio negocio del administrador no tiene zona de peligro", () => {
    renderZona(activo, "backoffice");
    expect(screen.queryByText("Zona de peligro")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar negocio" })).not.toBeInTheDocument();
  });
});
