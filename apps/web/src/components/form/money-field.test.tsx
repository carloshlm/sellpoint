import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { MoneyField } from "./money-field";

const render = (ui: ReactNode) =>
  rtlRender(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);

/**
 * Carlos, 2026-09-07: los campos de costo y precio de los catálogos eran
 * `type="number"` a secas — flechitas, sin moneda, y cada uno mostraba lo que
 * le llegó («6» acá, «5.99» allá). Este campo dice en qué moneda se escribe y
 * deja el importe a dos decimales al salir.
 */
function Campo({ inicial = "", hint }: { inicial?: string; hint?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <MoneyField label="Precio" value={valor} onChange={setValor} hint={hint} />
      <output data-testid="valor">{valor}</output>
    </>
  );
}

describe("MoneyField", () => {
  beforeEach(() => {
    useAuthStore.getState().setAuth("jwt", buildAuthUser());
  });

  it("muestra el símbolo y el código ISO de la moneda del negocio", () => {
    render(<Campo />);
    // «$» solo es ambiguo entre pesos y dos dólares: el código lo desambigua.
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByText("MXN")).toBeInTheDocument();
  });

  it("la moneda sigue al negocio, no al idioma: un canadiense en inglés ve $ y CAD, un español ve € y EUR", () => {
    useAuthStore
      .getState()
      .setAuth(
        "jwt",
        buildAuthUser({ locale: "en", tenant: buildTenantBlock({ currency: "CAD" }) }),
      );
    const { unmount } = render(<Campo />);
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByText("CAD")).toBeInTheDocument();
    unmount();

    useAuthStore
      .getState()
      .setAuth("jwt", buildAuthUser({ tenant: buildTenantBlock({ currency: "EUR" }) }));
    render(<Campo />);
    expect(screen.getByText("€")).toBeInTheDocument();
    expect(screen.getByText("EUR")).toBeInTheDocument();
  });

  it("al salir del campo completa a dos decimales lo que se escribió a medias", async () => {
    const user = userEvent.setup();
    render(<Campo />);

    await user.type(screen.getByLabelText("Precio"), "6");
    // Mientras se escribe no se toca nada: una máscara que reacomoda mientras
    // tecleas es hostil con el cursor.
    expect(screen.getByTestId("valor")).toHaveTextContent(/^6$/);

    await user.tab();
    expect(screen.getByLabelText("Precio")).toHaveValue("6.00");
    expect(screen.getByTestId("valor")).toHaveTextContent("6.00");
  });

  it("no formatea lo que no es un importe válido: la coma y el tercer decimal quedan a la vista", async () => {
    const user = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText("Precio");

    await user.type(campo, "5,99");
    await user.tab();
    expect(campo).toHaveValue("5,99");

    await user.clear(campo);
    await user.type(campo, "5.999");
    await user.tab();
    // Un tercer decimal no se redondea a escondidas: Postgres lo haría, y por
    // eso existe el error. El formulario lo marca; el campo no lo disfraza.
    expect(campo).toHaveValue("5.999");
  });

  it("vacío sigue vacío: no inventa un 0.00 en un campo opcional", async () => {
    const user = userEvent.setup();
    render(<Campo />);
    await user.click(screen.getByLabelText("Precio"));
    await user.tab();
    expect(screen.getByLabelText("Precio")).toHaveValue("");
  });

  it("las letras y los símbolos NO entran: no forman parte de un importe", async () => {
    const user = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText("Precio");

    await user.type(campo, "asdds");
    expect(campo).toHaveValue("");

    // Y en medio de un importe tampoco: «12abc34» deja «1234».
    await user.type(campo, "12abc34");
    expect(campo).toHaveValue("1234");
    await user.clear(campo);

    await user.type(campo, "-5$€");
    expect(campo).toHaveValue("5");
  });

  it("la COMA sí entra, aunque sea inválida: descartarla convertiría «5,99» en «599»", async () => {
    // Cien veces más. Entra y el error la marca, que es lo único que evita el
    // precio equivocado.
    const user = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText("Precio");

    await user.type(campo, "5,99");
    expect(campo).toHaveValue("5,99");
  });

  it("un importe en construcción se puede teclear entero: «.5», «6.» y «0.05»", async () => {
    const user = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText("Precio");

    await user.type(campo, ".5");
    expect(campo).toHaveValue(".5");
    await user.clear(campo);
    await user.type(campo, "0.05");
    expect(campo).toHaveValue("0.05");
  });

  it("es texto con teclado decimal, no un number con flechitas", () => {
    render(<Campo />);
    const campo = screen.getByLabelText("Precio");
    expect(campo).toHaveAttribute("type", "text");
    expect(campo).toHaveAttribute("inputmode", "decimal");
  });

  it("el lector de pantalla oye la moneda y la ayuda, aunque el símbolo sea decorativo", () => {
    render(<Campo hint="Lo que cobras" />);
    expect(screen.getByLabelText("Precio")).toHaveAccessibleDescription(/Lo que cobras/);
    expect(screen.getByLabelText("Precio")).toHaveAccessibleDescription(/MXN/);
  });
});
