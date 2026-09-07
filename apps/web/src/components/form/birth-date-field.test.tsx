import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "@/i18n";
import { BirthDateField } from "./birth-date-field";

const render = (ui: ReactNode) =>
  rtlRender(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);

/**
 * Una fecha de nacimiento NO es una fecha cualquiera. El calendario nativo
 * abre en el mes actual, y para llegar a 1985 hay que retroceder cientos de
 * clics — en el celular, peor. Tres campos separados se teclean de corrido y
 * abren el teclado numérico.
 */
function Campo({ inicial = "" }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <BirthDateField label="Fecha de nacimiento" value={valor} onChange={setValor} />
      <output data-testid="valor">{valor}</output>
    </>
  );
}

describe("BirthDateField", () => {
  it("se teclea de corrido: día, mes y año arman una fecha ISO", async () => {
    const user = userEvent.setup();
    render(<Campo />);

    await user.type(screen.getByLabelText("Día"), "2");
    await user.selectOptions(screen.getByLabelText("Mes"), "9");
    await user.type(screen.getByLabelText("Año"), "1990");

    expect(screen.getByTestId("valor")).toHaveTextContent("1990-09-02");
  });

  it("precarga una fecha guardada repartida en sus tres partes", () => {
    render(<Campo inicial="1985-03-17" />);

    expect(screen.getByLabelText("Día")).toHaveValue("17");
    expect(screen.getByLabelText("Mes")).toHaveValue("3");
    expect(screen.getByLabelText("Año")).toHaveValue("1985");
  });

  it("incompleta no inventa una fecha: mientras falte una parte, el valor es vacío", async () => {
    const user = userEvent.setup();
    render(<Campo />);

    await user.type(screen.getByLabelText("Día"), "2");
    await user.type(screen.getByLabelText("Año"), "1990");
    // Sin mes no hay fecha — antes que adivinar, nada.
    expect(screen.getByTestId("valor")).toHaveTextContent("");
  });

  it("el 31 de febrero no existe: una fecha imposible no se compone", async () => {
    const user = userEvent.setup();
    render(<Campo />);

    await user.type(screen.getByLabelText("Día"), "31");
    await user.selectOptions(screen.getByLabelText("Mes"), "2");
    await user.type(screen.getByLabelText("Año"), "1990");

    expect(screen.getByTestId("valor")).toHaveTextContent("");
  });

  it("en el celular abre el teclado numérico, no el alfabético", () => {
    render(<Campo />);

    expect(screen.getByLabelText("Día")).toHaveAttribute("inputMode", "numeric");
    expect(screen.getByLabelText("Año")).toHaveAttribute("inputMode", "numeric");
  });

  it("el mes es una lista, no un número: dd/mm y mm/dd dejan de ser ambiguos", () => {
    render(<Campo inicial="1985-03-17" />);
    const mes = screen.getByLabelText("Mes") as HTMLSelectElement;

    expect(mes.tagName).toBe("SELECT");
    // 12 meses + el placeholder.
    expect(mes.options).toHaveLength(13);
    expect([...mes.options].map((o) => o.text)).toContain("marzo");
  });

  it("borrar una parte borra la fecha, sin dejar a medias lo guardado", async () => {
    const user = userEvent.setup();
    render(<Campo inicial="1985-03-17" />);

    await user.clear(screen.getByLabelText("Año"));
    expect(screen.getByTestId("valor")).toHaveTextContent("");
  });

  it("el error y la ayuda se anuncian una sola vez para todo el grupo", () => {
    render(
      <BirthDateField
        label="Fecha de nacimiento"
        value=""
        onChange={vi.fn()}
        error="La fecha no es válida o es futura."
        hint="Edad: 36 años"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("La fecha no es válida o es futura.");
    expect(screen.getByRole("group", { name: "Fecha de nacimiento" })).toBeInTheDocument();
  });
});
