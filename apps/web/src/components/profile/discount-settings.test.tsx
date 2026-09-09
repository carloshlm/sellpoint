import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as tenantApi from "@/lib/tenant/api";
import type { AuthUser } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { DiscountSettings } from "./discount-settings";

/**
 * F4-DISC — «Descuentos en caja» en Mi perfil (Carlos, 2026-09-09).
 *
 * El código es una credencial: se teclea dos veces, viaja una vez y no se
 * vuelve a mostrar. Lo que la tarjeta protege es que NUNCA se mande a medias
 * (corto, con letras, sin confirmar) y que quitarlo sea un acto explícito.
 */
vi.mock("@/lib/tenant/api", async (importOriginal) => ({
  ...(await importOriginal<typeof tenantApi>()),
  updateMyTenant: vi.fn(),
}));
vi.mock("@/lib/auth/session-resync", () => ({
  resyncSession: vi.fn().mockResolvedValue(undefined),
}));

const mockedUpdate = vi.mocked(tenantApi.updateMyTenant);

const CONFIGURADO = "2026-09-09T15:00:00.000Z";

const demoUser = (permissions: string[], tenant: Partial<tenantApi.TenantBlock> = {}): AuthUser =>
  buildAuthUser({ permissions, tenant: buildTenantBlock(tenant) });

function renderCard(user: AuthUser) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <DiscountSettings user={user} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedUpdate.mockReset();
});

describe("Descuentos en caja en Mi perfil (F4-DISC)", () => {
  it("sin tenants:manage la tarjeta no existe", () => {
    renderCard(demoUser(["pos:sell"]));

    expect(screen.queryByTestId("discount-settings")).not.toBeInTheDocument();
  });

  it("sin código dice que los descuentos están apagados y no ofrece quitar nada", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByTestId("discount-code-status")).toHaveTextContent(
      "Sin código: los descuentos están apagados.",
    );
    expect(screen.getByLabelText("Código de autorización (4 a 8 dígitos)")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Quitar código" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("con código dice desde cuándo, pide uno NUEVO y ofrece quitarlo; el código no se muestra", () => {
    renderCard(demoUser(["tenants:manage"], { discountCodeSetAt: CONFIGURADO }));

    expect(screen.getByTestId("discount-code-status")).toHaveTextContent(
      /Código configurado el \d/,
    );
    expect(screen.getByLabelText("Nuevo código (4 a 8 dígitos)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Quitar código" })).toBeInTheDocument();
  });

  it("guardar manda el código una sola vez y lo borra de la pantalla", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, discountCodeSetAt: CONFIGURADO });
    renderCard(actor);

    await user.type(screen.getByLabelText("Código de autorización (4 a 8 dígitos)"), "1234");
    await user.type(screen.getByLabelText("Repite el código"), "1234");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ discountCode: "1234" });
    });
    expect(await screen.findByTestId("discount-settings-success")).toHaveTextContent(
      "Descuentos guardados.",
    );
    expect(screen.getByLabelText("Código de autorización (4 a 8 dígitos)")).toHaveValue("");
    expect(screen.getByLabelText("Repite el código")).toHaveValue("");
  });

  it("los códigos que no coinciden bloquean el guardado", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText("Código de autorización (4 a 8 dígitos)"), "1234");
    await user.type(screen.getByLabelText("Repite el código"), "1235");

    expect(screen.getByText("Los códigos no coinciden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("un código corto se marca y las letras no entran", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));
    const codigo = screen.getByLabelText("Código de autorización (4 a 8 dígitos)");

    await user.type(codigo, "12a");

    expect(codigo).toHaveValue("12");
    expect(screen.getByText("El código debe tener de 4 a 8 dígitos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("el tope se guarda como número, sin tocar el código", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, discountMaxPercent: "10" });
    renderCard(actor);

    await user.type(screen.getByLabelText("Tope por ticket (opcional)"), "10");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ discountMaxPercent: 10 });
    });
  });

  it("vaciar un tope existente lo BORRA: manda null, no cero", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"], {
      discountCodeSetAt: CONFIGURADO,
      discountMaxPercent: "10.00",
    });
    mockedUpdate.mockResolvedValue({ ...actor.tenant, discountMaxPercent: null });
    renderCard(actor);
    const tope = screen.getByLabelText("Tope por ticket (opcional)");
    expect(tope).toHaveValue("10.00");

    await user.clear(tope);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ discountMaxPercent: null });
    });
  });

  it("un tope mayor a 100 % no se guarda", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));
    const tope = screen.getByLabelText("Tope por ticket (opcional)");

    await user.type(tope, "150");

    expect(tope).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("quitar el código manda null y avisa que los descuentos quedan apagados", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"], { discountCodeSetAt: CONFIGURADO });
    mockedUpdate.mockResolvedValue({ ...actor.tenant, discountCodeSetAt: null });
    renderCard(actor);

    await user.click(screen.getByRole("button", { name: "Quitar código" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ discountCode: null });
    });
    expect(await screen.findByTestId("discount-settings-success")).toHaveTextContent(
      "Código quitado",
    );
  });
});
