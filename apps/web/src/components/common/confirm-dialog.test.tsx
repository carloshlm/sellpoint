import { render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * El diálogo es INLINE, no un modal centrado: puede montarse fuera del
 * viewport y el clic que lo abrió parecería no hacer nada (Carlos,
 * 2026-08-25). Al montar tiene que traerse a la vista y tomar el foco —
 * en el CONTENEDOR, nunca en el botón destructivo.
 */
describe("ConfirmDialog: la respuesta visible al clic que lo abre", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockReset();
    // jsdom no implementa scrollIntoView: sin esto el hook no tiene qué llamar.
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  function renderDialog() {
    return render(
      <ConfirmDialog
        data-testid="dialogo"
        title="Eliminar registro"
        body="Vas a eliminar «kg»."
        confirmLabel="Eliminar registro"
        cancelLabel="Cancelar"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
  }

  it("al montarse se trae a la vista (autoscroll)", () => {
    renderDialog();

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("el foco queda en el CONTENEDOR, no en el botón destructivo: un Enter por inercia no borra", () => {
    renderDialog();

    expect(screen.getByTestId("dialogo")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Eliminar registro" })).not.toHaveFocus();
  });
});
