import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { CashboxSession, SessionArqueo } from "@/lib/pos/api";
import { CloseSession } from "./close-session";

/**
 * El cierre detalla los gastos que salieron del cajón (Carlos, 2026-11-01).
 *
 * El Encargado puede cargarle un gasto al turno de otro cajero. Con un total
 * suelto —«Gastos en efectivo (2 gastos) −$450»— ese cajero no sabe cuáles
 * son ni quién los puso: ahora cada uno aparece con su folio, su concepto,
 * quién lo registró y su monto.
 */
let arqueo: SessionArqueo;

vi.mock("@/lib/pos/hooks", () => ({
  useSessionTotals: () => ({ data: arqueo }),
  useCloseSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/admin/scope", () => ({ useScopedCurrency: () => "MXN" }));

const TURNO: CashboxSession = {
  id: "s1",
  folio: "TUR-000001",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-11-01T15:00:00.000Z",
  closedAt: null,
  openingCash: "0",
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Almacén Central" },
};

function renderCierre() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <CloseSession session={TURNO} />
    </I18nextProvider>,
  );
}

describe("el cierre detalla los gastos del cajón", () => {
  it("cada gasto con su folio, su concepto, quién lo registró y su monto", () => {
    arqueo = {
      totals: [{ method: "cash", total: "500", count: 3 }],
      cashExpenses: {
        total: "450",
        count: 2,
        items: [
          {
            id: "e1",
            folio: "GAS-000012",
            description: "Garrafón de agua",
            total: "50",
            createdBy: { id: "u1", name: "Ana Pérez" },
          },
          {
            id: "e2",
            folio: "GAS-000013",
            description: "Mensajería",
            total: "400",
            createdBy: { id: "u2", name: "Luis Ramírez" },
          },
        ],
      },
      openingCash: "0",
      expectedCash: "50",
    };
    renderCierre();

    const lista = screen.getByRole("list", { name: "Gastos en efectivo" });
    const renglones = within(lista).getAllByRole("listitem");
    expect(renglones).toHaveLength(2);
    expect(renglones[0]).toHaveTextContent("GAS-000012");
    expect(renglones[0]).toHaveTextContent("Garrafón de agua");
    expect(renglones[0]).toHaveTextContent("Registró Ana Pérez");
    expect(renglones[0]).toHaveTextContent("−$50.00");
    expect(renglones[1]).toHaveTextContent("Registró Luis Ramírez");
    expect(renglones[1]).toHaveTextContent("−$400.00");
    expect(screen.getByTestId("total-cash-expenses")).toHaveTextContent("−$450.00");
  });

  it("sin gastos no hay renglón ni lista", () => {
    arqueo = {
      totals: [],
      cashExpenses: { total: "0", count: 0, items: [] },
      openingCash: "0",
      expectedCash: "0",
    };
    renderCierre();

    expect(screen.queryByTestId("total-cash-expenses")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Gastos en efectivo" })).not.toBeInTheDocument();
  });
});

/**
 * Carlos (2026-11-19): «Al cerrar el turno cuando coloco una "coma" en el
 * campo de "Efectivo contado en caja" me manda un error». `Number("1,")` es
 * NaN y `formatMoney(NaN)` lanza: la pantalla entera se caía en «Something
 * went wrong!». Lo contado se valida como cualquier importe, igual que «Con
 * cuánto paga» del cobro.
 */
describe("lo contado se valida como cualquier importe", () => {
  beforeEach(() => {
    arqueo = {
      totals: [{ method: "cash", total: "254", count: 2 }],
      cashExpenses: { total: "0", count: 0, items: [] },
      openingCash: "1000",
      expectedCash: "1254",
    };
  });

  const escribir = (texto: string) =>
    fireEvent.change(screen.getByLabelText("Efectivo contado en caja"), {
      target: { value: texto },
    });

  it("una coma no tumba la pantalla: dice cómo escribirlo y no deja cerrar", () => {
    renderCierre();

    escribir("1,");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Escribe el importe solo con números y punto decimal, como 150.00",
    );
    expect(screen.queryByTestId("cash-difference")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar turno" })).toBeDisabled();
  });

  it("un importe con separador de miles tampoco: se escribe sin la coma", () => {
    renderCierre();

    escribir("1,254.00");

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar turno" })).toBeDisabled();
  });

  it("un importe bien escrito sigue mostrando la diferencia y deja cerrar", () => {
    renderCierre();

    escribir("1250");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-$4.00");
    expect(screen.getByRole("button", { name: "Cerrar turno" })).toBeEnabled();
  });
});
