import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { SURFACE } from "@/components/ui/surface";
import { Table } from "@/components/ui/table";

/**
 * La superficie de los listados (Carlos, 2026-08-25).
 *
 * Los listados NO se pintan sobre el fondo de la página: van en su tarjeta,
 * como los recuadros de «Mi perfil». La piel vive en UNA constante —`SURFACE`—
 * que consumen las dos familias de tablas, y está hecha de TOKENS para que el
 * selector de temas del wizard re-pinte todo cambiando variables CSS.
 *
 * jsdom no calcula estilos, así que acá no se mira el color: se fija la
 * ESTRUCTURA — que ambos contenedores llevan la piel compartida y que la piel
 * no tiene colores literales. El aspecto real se verifica en navegador
 * (lección del proyecto: un test verde en jsdom no prueba un layout).
 */
describe("la superficie de los listados", () => {
  it("la piel usa tokens de tema, nunca un color literal", () => {
    // Un `bg-white` se ve idéntico hoy y rompe el primer tema oscuro.
    expect(SURFACE).not.toMatch(/white|black|#|slate|gray|zinc/);
    expect(SURFACE).toContain("bg-card");
    expect(SURFACE).toContain("border-border");
  });

  it("ScrollableTable envuelve su contenido con la piel", () => {
    render(
      <ScrollableTable>
        <table />
      </ScrollableTable>,
    );

    const caja = screen.getByTestId("scrollable-table");
    for (const clase of SURFACE.split(" ")) {
      expect(caja.className).toContain(clase);
    }
  });

  it("el contenedor de Table lleva la MISMA piel: una sola fuente", () => {
    const { container } = render(<Table />);

    const contenedor = container.querySelector('[data-slot="table-container"]');
    for (const clase of SURFACE.split(" ")) {
      expect(contenedor?.className).toContain(clase);
    }
  });
});
