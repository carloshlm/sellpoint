import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import { cleanFindings, FindingsChecklist, type FindingsValue } from "./findings-checklist";
import { NegatedToggle } from "./negated-toggle";

const render = (ui: ReactNode) =>
  rtlRender(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);

const ITEMS = [
  { key: "respiratory", label: "Respiratorio", hint: "tos, disnea" },
  { key: "digestive", label: "Digestivo" },
];

function Checklist() {
  const [value, setValue] = useState<FindingsValue>({});
  return (
    <>
      <FindingsChecklist
        items={ITEMS}
        value={value}
        onChange={setValue}
        allNormalLabel="Todos negados"
        normalLabel="Negado"
        findingsLabel="Con síntomas"
      />
      <output data-testid="valor">{JSON.stringify(cleanFindings(value))}</output>
    </>
  );
}

/** F9-CLINIC-HC-04 — el checklist de aparatos y sistemas / regiones. */
describe("FindingsChecklist", () => {
  it("«Todos negados» pone {normal: true} en cada ítem, explícito", async () => {
    render(<Checklist />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Todos negados" }));
    expect(screen.getByTestId("valor")).toHaveTextContent(
      '{"respiratory":{"normal":true},"digestive":{"normal":true}}',
    );
    expect(screen.getByText("tos, disnea")).toBeInTheDocument();
  });

  it("cambiar uno a hallazgos y escribir manda {findings} solo en ese; sin texto no viaja", async () => {
    render(<Checklist />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Todos negados" }));
    const digestivo = screen.getByRole("radiogroup", { name: "Digestivo" });
    await user.click(within(digestivo).getByRole("radio", { name: "Con síntomas" }));
    // Con hallazgos pero sin texto: no es un hallazgo todavía.
    expect(screen.getByTestId("valor")).toHaveTextContent('{"respiratory":{"normal":true}}');
    await user.type(screen.getByLabelText("Con síntomas: Digestivo"), "dolor epigástrico");
    expect(screen.getByTestId("valor")).toHaveTextContent(
      '{"respiratory":{"normal":true},"digestive":{"findings":"dolor epigástrico"}}',
    );
  });

  it("volver a «Negado» quita el texto del valor", async () => {
    render(<Checklist />);
    const user = userEvent.setup();
    const digestivo = screen.getByRole("radiogroup", { name: "Digestivo" });
    await user.click(within(digestivo).getByRole("radio", { name: "Con síntomas" }));
    await user.type(screen.getByLabelText("Con síntomas: Digestivo"), "náusea");
    await user.click(within(digestivo).getByRole("radio", { name: "Negado" }));
    expect(screen.getByTestId("valor")).toHaveTextContent('{"digestive":{"normal":true}}');
    expect(screen.queryByLabelText("Con síntomas: Digestivo")).not.toBeInTheDocument();
  });
});

function Negable() {
  const [negated, setNegated] = useState(false);
  return (
    <>
      <NegatedToggle
        checked={negated}
        onChange={setNegated}
        label="Negados"
        hint="Sin antecedentes"
      />
      <fieldset disabled={negated}>
        <label>
          Nota
          <input />
        </label>
      </fieldset>
    </>
  );
}

describe("NegatedToggle", () => {
  it("marcarlo deshabilita el resto del formulario y desmarcarlo lo devuelve", async () => {
    render(<Negable />);
    const user = userEvent.setup();
    expect(screen.getByText("Sin antecedentes")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Negados" }));
    expect(screen.getByLabelText("Nota")).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Negados" }));
    expect(screen.getByLabelText("Nota")).toBeEnabled();
  });
});
