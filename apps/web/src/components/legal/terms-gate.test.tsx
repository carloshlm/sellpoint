import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { TermsGate } from "@/components/legal/terms-gate";
import { createQueryClient } from "@/lib/query-client";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { createI18n } from "../../i18n";

/**
 * F11-SITE-LEGAL-03 — la pared de la aceptación, en sus DOS estados.
 *
 * `termsEnabled` y `acceptTerms` se mockean por módulo: la versión vigente es
 * una constante de `@sellpoint/shared` y encenderla de verdad en un test
 * obligaría a mockear ese paquete entero. `vi.hoisted` deja una caja mutable
 * que cada caso llena antes de renderizar.
 */
const estado = vi.hoisted(() => ({ encendido: false }));

vi.mock("@/lib/legal/terms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/terms")>();
  return { ...actual, termsEnabled: () => estado.encendido };
});

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@/lib/auth/api", () => ({
  acceptTerms: vi.fn(),
  logout: vi.fn(),
}));

const { acceptTerms, logout } = await import("@/lib/auth/api");
const acceptTermsMock = vi.mocked(acceptTerms);
const logoutMock = vi.mocked(logout);

function renderGate() {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <TermsGate />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

function sesionCon(mustAcceptTerms: boolean | undefined) {
  useAuthStore.getState().setAuth("token", buildAuthUser({ mustAcceptTerms }));
}

describe("TermsGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estado.encendido = false;
    useAuthStore.getState().clearAuth();
    acceptTermsMock.mockResolvedValue({
      termsVersion: "2026-10-01",
      acceptedAt: "2026-10-05T12:00:00.000Z",
    });
    logoutMock.mockResolvedValue(undefined);
  });

  describe("dormido", () => {
    it("no pinta NADA, aunque el usuario nunca haya aceptado", () => {
      sesionCon(true);
      renderGate();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("encendido", () => {
    beforeEach(() => {
      estado.encendido = true;
    });

    it("sin sesión no hay a quién pedirle nada", () => {
      renderGate();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("quien ya aceptó no ve el diálogo", () => {
      sesionCon(false);
      renderGate();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("quien debe aceptar ve la pared, con los dos enlaces en pestaña nueva", () => {
      sesionCon(true);
      renderGate();

      expect(screen.getByRole("dialog", { name: "Antes de seguir" })).toBeInTheDocument();

      const terminos = screen.getByRole("link", { name: "Términos" });
      const privacidad = screen.getByRole("link", { name: "Aviso de privacidad" });
      for (const enlace of [terminos, privacidad]) {
        expect(enlace).toHaveAttribute("target", "_blank");
        expect(enlace).toHaveAttribute("rel", "noopener");
      }
      expect(terminos).toHaveAttribute("href", "https://sellpointy.com/es-mx/terminos/");
      expect(privacidad).toHaveAttribute("href", "https://sellpointy.com/es-mx/privacidad/");
    });

    it("la pared NO se puede ignorar: ni Escape, ni clic afuera, ni X", async () => {
      sesionCon(true);
      renderGate();
      const user = userEvent.setup();

      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("dialog-backdrop"));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
    });

    it("aceptar sella en el API, cierra la pared y no vuelve", async () => {
      sesionCon(true);
      renderGate();

      await userEvent.click(screen.getByRole("button", { name: "Acepto" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(acceptTermsMock).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().user?.mustAcceptTerms).toBe(false);
    });

    it("si el API falla, la pared SIGUE ahí y lo dice", async () => {
      acceptTermsMock.mockRejectedValue({ statusCode: 500, message: "boom", error: "Server" });
      sesionCon(true);
      renderGate();

      await userEvent.click(screen.getByRole("button", { name: "Acepto" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No pudimos guardar tu aceptación",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    /** La única salida: quien no quiera aceptar se va, no queda encerrado. */
    it("cerrar sesión limpia la sesión y manda a /login", async () => {
      sesionCon(true);
      renderGate();

      await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

      await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
      expect(navigateMock).toHaveBeenCalledWith({ to: "/login", replace: true });
    });
  });
});
