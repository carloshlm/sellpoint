import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import { RowList } from "./row-list";

const render = (ui: ReactNode) =>
  rtlRender(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);

interface Fila {
  name: string;
}

/** F9-CLINIC-HC-04 — la lista de filas que usan alergias, medicamentos, cirugías… */
function Lista({ max }: { max?: number }) {
  const [rows, setRows] = useState<Fila[]>([]);
  return (
    <>
      <RowList
        rows={rows}
        onChange={setRows}
        emptyRow={() => ({ name: "" })}
        addLabel="Agregar alergia"
        label="Alergias"
        max={max}
        render={(row, patch, index) => (
          <label>
            Sustancia {index + 1}
            <input value={row.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
        )}
      />
      <output data-testid="filas">{JSON.stringify(rows)}</output>
    </>
  );
}

describe("RowList", () => {
  it("sin filas solo hay el botón; agregar crea la fila y le pasa el foco", async () => {
    render(<Lista />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    const campo = screen.getByLabelText("Sustancia 1");
    expect(campo).toHaveFocus();
    expect(screen.getByRole("list", { name: "Alergias" })).toBeInTheDocument();
  });

  it("escribir en una fila cambia solo esa; quitar deja la lista consistente", async () => {
    render(<Lista />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    await user.type(screen.getByLabelText("Sustancia 1"), "Penicilina");
    await user.click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    await user.type(screen.getByLabelText("Sustancia 2"), "Mariscos");
    expect(screen.getByTestId("filas")).toHaveTextContent(
      '[{"name":"Penicilina"},{"name":"Mariscos"}]',
    );
    const filas = within(screen.getByRole("list")).getAllByRole("listitem");
    await user.click(within(filas[0] as HTMLElement).getByRole("button", { name: "Quitar 1" }));
    expect(screen.getByTestId("filas")).toHaveTextContent('[{"name":"Mariscos"}]');
    expect(screen.getByLabelText("Sustancia 1")).toHaveValue("Mariscos");
  });

  it("con el máximo alcanzado el botón de agregar desaparece", async () => {
    render(<Lista max={1} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    expect(screen.queryByRole("button", { name: "+ Agregar alergia" })).not.toBeInTheDocument();
  });
});
