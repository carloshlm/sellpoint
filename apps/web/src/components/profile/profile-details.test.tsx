import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as authApi from "@/lib/auth/api";
import { createQueryClient } from "@/lib/query-client";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { ProfileDetails } from "./profile-details";

/**
 * "Tus datos" editable (Carlos, 2026-08-26): lo que el registro capturó
 * (nombre, apellido paterno y materno) se edita aquí. El email NO — es la
 * identidad de acceso (login + verificación) y cambiarlo exige su propio
 * flujo con re-verificación; se muestra con la explicación.
 */
vi.mock("@/lib/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  updateMyProfile: vi.fn(),
}));

const mockedUpdate = vi.mocked(authApi.updateMyProfile);

const demoUser = (): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: [],
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    phone: null,
    theme: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

function renderCard(user: AuthUser) {
  useAuthStore.setState({ accessToken: "token", user });
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <ProfileDetails user={user} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedUpdate.mockReset();
});

describe("Tus datos editable (2026-08-26)", () => {
  it("nombre y apellidos llegan precargados y editables", () => {
    renderCard(demoUser());

    expect(screen.getByLabelText("Nombre")).toHaveValue("Ana");
    expect(screen.getByLabelText("Apellido paterno")).toHaveValue("Pérez");
    expect(screen.getByLabelText(/Apellido materno/)).toHaveValue("");
  });

  it("el email se muestra pero NO es editable, con la explicación", () => {
    renderCard(demoUser());

    expect(screen.getByTestId("profile-email")).toHaveTextContent("ana@acme.mx");
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.getByText(/identidad de acceso/i)).toBeInTheDocument();
  });

  it("guardar manda SOLO lo modificado y refresca el store", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({
      id: "u1",
      email: "ana@acme.mx",
      firstName: "Ana María",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
    });
    renderCard(demoUser());

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ firstName: "Ana María" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/guardados/i);
    expect(useAuthStore.getState().user?.firstName).toBe("Ana María");
  });

  it("vaciar el apellido materno lo borra con null (es opcional)", async () => {
    const user = userEvent.setup();
    const actor = demoUser();
    actor.lastNameMaternal = "Luna";
    mockedUpdate.mockResolvedValue({
      id: "u1",
      email: "ana@acme.mx",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
    });
    renderCard(actor);

    await user.clear(screen.getByLabelText(/Apellido materno/));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ lastNameMaternal: null });
    });
  });

  it("un requerido vaciado NO se manda: error de validación", async () => {
    const user = userEvent.setup();
    renderCard(demoUser());

    await user.clear(screen.getByLabelText("Apellido paterno"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Este campo es obligatorio")).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("sin cambios el botón Guardar está deshabilitado", () => {
    renderCard(demoUser());

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });
});
