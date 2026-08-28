import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./dialog";

/**
 * F7-WEB-03 — el primer overlay real de la app (los "modales" previos eran
 * secciones inline). Lo que un diálogo accesible NO puede dejar de hacer:
 * anunciarse (role/aria-modal), cerrarse con Escape y con el backdrop, y
 * arrancar el foco ADENTRO — un lector de pantalla que se queda detrás del
 * overlay está atrapado en una página que ya no existe.
 */
function Demo({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Elige tu plan">
      <button type="button">Contratar</button>
    </Dialog>
  );
}

describe("Dialog (F7-WEB-03)", () => {
  it("se anuncia como diálogo modal con su título", () => {
    render(<Demo />);
    const dialog = screen.getByRole("dialog", { name: "Elige tu plan" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("cerrado no deja NADA en el DOM (portal desmontado)", () => {
    function Cerrado() {
      const [open] = useState(false);
      return (
        <Dialog open={open} onClose={() => {}} title="Nada">
          <p>invisible</p>
        </Dialog>
      );
    }
    render(<Cerrado />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape cierra", async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("el click en el backdrop cierra; el click DENTRO no", async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Contratar" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("el foco arranca dentro del diálogo", () => {
    render(<Demo />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  /**
   * ── EL FOCO QUE SE ROBABA A SÍ MISMO (2026-08-29) ────────────────────
   *
   * El `focus()` de apertura compartía efecto con el listener de Escape, que
   * dependía de `onClose` — una función que el padre recrea en CADA render.
   * Resultado: cada cambio de estado del padre devolvía el cursor al panel.
   *
   * Con campos no controlados nadie lo vio, porque escribir no re-renderiza
   * al padre. En cuanto un diálogo tuvo un input controlado (el autocálculo
   * del cobro), solo entraba la PRIMERA letra de lo que se tecleaba.
   */
  it("escribir en un campo NO devuelve el foco al panel en cada tecla", async () => {
    function ConOnCloseNuevoCadaRender() {
      const [valor, setValor] = useState("");
      return (
        <Dialog open onClose={() => undefined} title="Cobro">
          <label htmlFor="monto">Monto</label>
          <input id="monto" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Dialog>
      );
    }

    render(<ConOnCloseNuevoCadaRender />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Monto"), "499");

    // Las TRES teclas llegaron: sin el arreglo, aquí habría un "4".
    expect(screen.getByLabelText("Monto")).toHaveValue("499");
    expect(screen.getByLabelText("Monto")).toHaveFocus();
  });
});
