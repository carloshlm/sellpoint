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
});
