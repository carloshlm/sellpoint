import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { SandboxBanner } from "./sandbox-banner";

/**
 * El aviso de SANDBOX (2026-08-26): la MISMA imagen del front sirve en
 * producción y en el sandbox (VITE_API_URL relativo), así que el ambiente
 * solo se conoce en runtime por el hostname. Quien opera en
 * sandbox.sellpointy.com tiene que saberlo de un vistazo — capturar ventas
 * de verdad en el ambiente de mentira es el error que este banner evita.
 */
function renderBanner(hostname: string) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <SandboxBanner hostname={hostname} />
    </I18nextProvider>,
  );
}

describe("SandboxBanner", () => {
  it("aparece en el sandbox", () => {
    renderBanner("sandbox.sellpointy.com");

    expect(screen.getByTestId("sandbox-banner")).toHaveTextContent(/sandbox/i);
    expect(screen.getByTestId("sandbox-banner")).toHaveTextContent(/pruebas/i);
  });

  it("NO existe en producción ni en desarrollo local", () => {
    renderBanner("app.sellpointy.com");
    expect(screen.queryByTestId("sandbox-banner")).not.toBeInTheDocument();
  });

  it("localhost tampoco lo muestra", () => {
    renderBanner("localhost");
    expect(screen.queryByTestId("sandbox-banner")).not.toBeInTheDocument();
  });
});
