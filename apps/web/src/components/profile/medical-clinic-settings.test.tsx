import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import type { AuthUser } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { MedicalClinicSettings } from "./medical-clinic-settings";

vi.mock("@/lib/medical-clinic/api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

/**
 * F9-CLINIC-WEB-21 — la tarjeta de «Mi perfil»: solo existe con el módulo
 * activo y `tenants:manage`; guarda solo lo que cambió.
 */
const user = (modules: AuthUser["subscription"]["modules"], permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, modules },
  tenant: {
    id: "tenant-1",
    name: "Acme",
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
    monthlySalesGoal: null,
  },
});

function renderCard(u: AuthUser) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <MedicalClinicSettings user={u} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mocked.getSettings.mockResolvedValue({
    sellsMedications: true,
    sellsLabStudies: true,
    sellsDiagnosticStudies: false,
  });
  mocked.updateSettings.mockImplementation((input) =>
    Promise.resolve({
      sellsMedications: true,
      sellsLabStudies: true,
      sellsDiagnosticStudies: false,
      ...input,
    }),
  );
});

describe("MedicalClinicSettings", () => {
  it("sin el módulo no se pinta; con módulo pero sin tenants:manage tampoco", () => {
    renderCard(user([], ["tenants:manage"]));
    expect(screen.queryByText("Configuración Consultorio Médico")).not.toBeInTheDocument();
    renderCard(user(["medical_clinic"], ["medical_clinic:read"]));
    expect(screen.queryByText("Configuración Consultorio Médico")).not.toBeInTheDocument();
  });

  it("con ambos pinta las tres casillas con lo del API y guarda SOLO lo cambiado", async () => {
    renderCard(user(["medical_clinic"], ["tenants:manage"]));
    expect(await screen.findByText("Configuración Consultorio Médico")).toBeInTheDocument();
    const lab = await screen.findByRole("checkbox", { name: "Vende estudios de laboratorio" });
    await waitFor(() => expect(lab).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Vende medicamentos" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Vende estudios diagnósticos" })).not.toBeChecked();

    await userEvent.click(lab);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateSettings).toHaveBeenCalledWith({ sellsLabStudies: false }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Configuración guardada.");
  });
});
