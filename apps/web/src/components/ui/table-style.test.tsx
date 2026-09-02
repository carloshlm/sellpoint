import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

/**
 * BARRERA de estilo de los listados (Carlos, 2026-09-02): toda tabla que
 * lista filas resalta la fila bajo el cursor y pinta su encabezado con un
 * fondo distinto. El componente `Table` lo trae de fábrica; las tablas crudas
 * de movimientos y del punto de venta lo toman de las MISMAS constantes, para
 * que nadie vuelva a tener un listado que se ve distinto al de al lado.
 */
describe("el estilo compartido de los listados", () => {
  it("el componente Table: encabezado con fondo y filas que se resaltan", () => {
    render(
      <Table>
        <TableHeader data-testid="head">
          <TableRow>
            <TableHead>Folio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-testid="fila">
            <TableCell>ENT-1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByTestId("head")).toHaveClass("bg-muted/40");
    // El encabezado no es una fila: no se resalta al pasar el cursor.
    expect(screen.getByTestId("head").className).toMatch(/hover:bg-transparent/);
    expect(screen.getByTestId("fila")).toHaveClass("hover:bg-muted/50");
  });

  const RAIZ = join(__dirname, "..");
  const fuente = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");

  it.each([
    "inventory/document-list.tsx",
    "inventory/transfers-list.tsx",
    "inventory/expiring-list.tsx",
    "pos/quotes-list.tsx",
    "pos/sales-history.tsx",
  ])("%s toma el encabezado y el resaltado de las constantes compartidas", (ruta) => {
    const codigo = fuente(ruta);

    // USADAS en una clase, no solo importadas: un import huérfano no pinta nada.
    expect(codigo).toContain("${TABLE_HEAD_ROW}");
    expect(codigo).toContain("${TABLE_ROW_HOVER}");
    // Ninguna clase de encabezado ni de resaltado escrita a mano.
    expect(codigo).not.toMatch(/className="border-b text-left/);
  });
});
