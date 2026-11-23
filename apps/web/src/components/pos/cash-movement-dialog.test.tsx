import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as posApi from "@/lib/pos/api";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { CloseSession } from "./close-session";
import { SessionBar } from "./session-bar";

/**
 * F10-CASHMOV-04 — «Efectivo» en la barra del turno: entradas y retiros.
 *
 * Hoy del cajón solo salen gastos, así que el efectivo que el cajero se lleva
 * a la caja fuerte aparece como FALTANTE en el arqueo. El diálogo registra la
 * entrada o el retiro en el momento, sin salir de la venta, y el cierre lo
 * cuenta. Estas pruebas cuidan lo que el cajero ve y lo que viaja al API
 * (contrato L5 de `odd/tasks/f10-cashmov.md`).
 */
vi.mock("@/lib/pos/api", async (original) => ({
  ...(await original<typeof import("@/lib/pos/api")>()),
  getSessionTotals: vi.fn(),
  listCashMovements: vi.fn(),
  createCashMovement: vi.fn(),
  cancelCashMovement: vi.fn(),
}));

const mocked = vi.mocked(posApi);

const CODIGO_CONFIGURADO = "2026-11-01T15:00:00.000Z";

const TURNO: posApi.CashboxSession = {
  id: "s1",
  folio: "TUR-000042",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-11-23T14:00:00.000Z",
  closedAt: null,
  openingCash: "500",
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Sucursal Centro" },
};

const ARQUEO: posApi.SessionArqueo = {
  totals: [{ method: "cash", total: "430.50", count: 3 }],
  cashExpenses: { total: "90", count: 1, items: [] },
  openingCash: "500",
  expectedCash: "840.50",
};

const movimiento = (extra: Partial<posApi.CashMovement> = {}): posApi.CashMovement => ({
  id: "m1",
  type: "out",
  reason: "safe",
  amount: "500",
  note: null,
  authorized: true,
  status: "active",
  // 17:30 UTC son las 11:30 en la Ciudad de México, la zona del negocio demo.
  createdAt: "2026-11-23T17:30:00.000Z",
  createdBy: { id: "u1", name: "Luis Ramírez" },
  canceledAt: null,
  canceledBy: null,
  cancelReason: null,
  ...extra,
});

/** Monta la pieza con el negocio con o sin código de autorización configurado. */
function montar(pieza: ReactNode, discountCodeSetAt: string | null = CODIGO_CONFIGURADO) {
  useAuthStore
    .getState()
    .setAuth(
      "jwt",
      buildAuthUser({ permissions: ["pos:sell"], tenant: buildTenantBlock({ discountCodeSetAt }) }),
    );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={queryClient}>{pieza}</QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

/** Abre el diálogo desde la barra y lo devuelve. */
async function abrirDialogo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByTestId("session-bar")).getByRole("button", { name: "Efectivo" }),
  );
  return screen.findByRole("dialog", { name: "Entradas y retiros de efectivo" });
}

/** Las opciones del motivo, en el orden en que se ven. */
const motivos = (dialogo: HTMLElement) =>
  within(within(dialogo).getByLabelText("Motivo"))
    .getAllByRole("option")
    .map((opcion) => opcion.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().clearAuth();
  mocked.getSessionTotals.mockResolvedValue(ARQUEO);
  mocked.listCashMovements.mockResolvedValue({ movements: [] });
});

describe("«Efectivo» en la barra del turno", () => {
  it("la barra lo ofrece y no pide los movimientos hasta que lo abres", async () => {
    const user = montar(<SessionBar session={TURNO} />);

    const barra = screen.getByTestId("session-bar");
    expect(barra).toHaveTextContent("Sucursal Centro");
    expect(mocked.listCashMovements).not.toHaveBeenCalled();

    const dialogo = await abrirDialogo(user);
    await waitFor(() => expect(mocked.listCashMovements).toHaveBeenCalledTimes(1));
    expect(
      await within(dialogo).findByText("Todavía no hay entradas ni retiros en este turno."),
    ).toBeInTheDocument();
  });
});

describe("el diálogo de entradas y retiros", () => {
  it("la lista de motivos cambia con el tipo", async () => {
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);

    await user.click(within(dialogo).getByRole("button", { name: "Entrada" }));
    expect(within(dialogo).getByRole("button", { name: "Entrada" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(motivos(dialogo)).toEqual(["Fondo para cambio", "Otro"]);

    await user.click(within(dialogo).getByRole("button", { name: "Retiro" }));
    expect(motivos(dialogo)).toEqual([
      "A la caja fuerte",
      "Depósito al banco",
      "Retiro del dueño",
      "Otro",
    ]);
  });

  it("con «Otro» la nota es obligatoria: sin ella no se registra", async () => {
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);
    const registrar = () => within(dialogo).getByRole("button", { name: "Registrar retiro" });

    await user.type(within(dialogo).getByLabelText("Importe"), "100");
    // Con un motivo de la lista, la nota es opcional.
    expect(within(dialogo).getByLabelText("Nota (opcional)")).toBeInTheDocument();
    expect(registrar()).toBeEnabled();

    await user.selectOptions(within(dialogo).getByLabelText("Motivo"), "Otro");
    expect(within(dialogo).getByText("Con «Otro», escribe de qué se trata.")).toBeInTheDocument();
    expect(registrar()).toBeDisabled();

    await user.type(within(dialogo).getByLabelText("Nota"), "Pago de la tanda");
    expect(registrar()).toBeEnabled();
    expect(within(dialogo).getByLabelText("Nota")).toHaveAttribute("maxLength", "300");
  });

  it("el código aparece solo en un retiro y solo si el negocio lo tiene", async () => {
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);

    await user.click(within(dialogo).getByRole("button", { name: "Retiro" }));
    const codigo = within(dialogo).getByLabelText("Código de autorización");
    expect(codigo).toHaveAttribute("type", "password");
    expect(
      within(dialogo).getByText("Lo define el administrador en Mi perfil."),
    ).toBeInTheDocument();

    await user.click(within(dialogo).getByRole("button", { name: "Entrada" }));
    expect(within(dialogo).queryByLabelText("Código de autorización")).not.toBeInTheDocument();
  });

  it("sin código configurado, el retiro no lo pide", async () => {
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);

    await user.click(within(dialogo).getByRole("button", { name: "Retiro" }));
    expect(within(dialogo).queryByLabelText("Código de autorización")).not.toBeInTheDocument();
  });

  it("un retiro manda el importe como número y el código; mal escrito, el código no deja registrar", async () => {
    mocked.createCashMovement.mockResolvedValue(movimiento());
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);

    await user.click(within(dialogo).getByRole("button", { name: "Retiro" }));
    await user.type(within(dialogo).getByLabelText("Importe"), "500");
    await user.selectOptions(within(dialogo).getByLabelText("Motivo"), "A la caja fuerte");
    await user.type(within(dialogo).getByLabelText("Código de autorización"), "12");
    expect(within(dialogo).getByText("Escribe el código de 4 a 8 dígitos")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Registrar retiro" })).toBeDisabled();

    await user.type(within(dialogo).getByLabelText("Código de autorización"), "34");
    await user.click(within(dialogo).getByRole("button", { name: "Registrar retiro" }));

    await waitFor(() => expect(mocked.createCashMovement).toHaveBeenCalledTimes(1));
    expect(mocked.createCashMovement.mock.calls[0]?.[0]).toStrictEqual({
      type: "out",
      reason: "safe",
      amount: 500,
      code: "1234",
    });
  });

  it("una entrada no manda código, aunque el negocio lo tenga, y sí su nota", async () => {
    mocked.createCashMovement.mockResolvedValue(
      movimiento({ type: "in", reason: "change_fund", amount: "250.5" }),
    );
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);

    await user.click(within(dialogo).getByRole("button", { name: "Entrada" }));
    await user.type(within(dialogo).getByLabelText("Importe"), "250.50");
    await user.type(within(dialogo).getByLabelText("Nota (opcional)"), "  Monedas del banco  ");
    await user.click(within(dialogo).getByRole("button", { name: "Registrar entrada" }));

    await waitFor(() => expect(mocked.createCashMovement).toHaveBeenCalledTimes(1));
    expect(mocked.createCashMovement.mock.calls[0]?.[0]).toStrictEqual({
      type: "in",
      reason: "change_fund",
      amount: 250.5,
      note: "Monedas del banco",
    });
  });

  it("un importe en cero o mal escrito no se registra", async () => {
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);
    const importe = within(dialogo).getByLabelText("Importe");

    await user.type(importe, "0");
    expect(within(dialogo).getByText("El importe debe ser mayor que cero.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Registrar retiro" })).toBeDisabled();

    await user.clear(importe);
    await user.type(importe, "50,5");
    expect(within(dialogo).getByRole("button", { name: "Registrar retiro" })).toBeDisabled();
    expect(mocked.createCashMovement).not.toHaveBeenCalled();
  });

  it("si el API lo rechaza, el diálogo dice su motivo con sus palabras", async () => {
    mocked.createCashMovement.mockRejectedValue({
      statusCode: 409,
      error: "Conflict",
      message: "El retiro deja el efectivo esperado debajo de cero: en el cajón hay $840.50.",
    });
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);

    await user.type(within(dialogo).getByLabelText("Importe"), "10000");
    await user.click(within(dialogo).getByRole("button", { name: "Registrar retiro" }));

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "El retiro deja el efectivo esperado debajo de cero: en el cajón hay $840.50.",
    );
  });

  it("registrar un retiro desde el cierre refresca el arqueo y la lista", async () => {
    mocked.createCashMovement.mockResolvedValue(movimiento());
    const user = montar(<CloseSession session={TURNO} />, null);
    // El arqueo llega después de pintar la pantalla: se espera su número.
    await waitFor(() => expect(screen.getByTestId("expected-cash")).toHaveTextContent("$840.50"));
    expect(screen.queryByTestId("total-cash-out")).not.toBeInTheDocument();

    const dialogo = await abrirDialogo(user);
    await within(dialogo).findByText("Todavía no hay entradas ni retiros en este turno.");
    // Lo que el API contesta después del alta: el retiro cuenta en el esperado.
    mocked.getSessionTotals.mockResolvedValue({
      ...ARQUEO,
      expectedCash: "340.50",
      cashIn: "0",
      cashOut: "500",
    });
    mocked.listCashMovements.mockResolvedValue({ movements: [movimiento()] });

    await user.type(within(dialogo).getByLabelText("Importe"), "500");
    await user.click(within(dialogo).getByRole("button", { name: "Registrar retiro" }));

    expect(await screen.findByTestId("total-cash-out")).toHaveTextContent("−$500.00");
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("$340.50");
    const lista = within(dialogo).getByRole("list", { name: "Movimientos del turno" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialogo).getByRole("status")).toHaveTextContent("Retiro registrado.");
  });
});

describe("la lista de movimientos y anular", () => {
  const ENTRADA = movimiento({
    id: "m2",
    type: "in",
    reason: "change_fund",
    amount: "300",
    createdAt: "2026-11-23T18:05:00.000Z",
  });
  const RETIRO = movimiento({ id: "m1", note: "Bolsa 14" });

  it("cada movimiento con su tipo, motivo, importe, nota, hora y quién, en el orden del API", async () => {
    mocked.listCashMovements.mockResolvedValue({ movements: [ENTRADA, RETIRO] });
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);

    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });
    const [primero, segundo] = within(lista).getAllByRole("listitem");
    expect(primero).toHaveTextContent("Entrada");
    expect(primero).toHaveTextContent("Fondo para cambio");
    expect(primero).toHaveTextContent("+$300.00");
    expect(primero).toHaveTextContent("12:05");
    expect(segundo).toHaveTextContent("Retiro");
    expect(segundo).toHaveTextContent("A la caja fuerte");
    expect(segundo).toHaveTextContent("−$500.00");
    expect(segundo).toHaveTextContent("Bolsa 14");
    expect(segundo).toHaveTextContent("11:30");
    expect(segundo).toHaveTextContent("Registró Luis Ramírez");
  });

  it("anular un retiro pide el motivo y nunca el código", async () => {
    mocked.listCashMovements.mockResolvedValue({ movements: [ENTRADA, RETIRO] });
    mocked.cancelCashMovement.mockResolvedValue({ ...RETIRO, status: "canceled" });
    const user = montar(<CloseSession session={TURNO} />);
    await screen.findByTestId("expected-cash");
    const dialogo = await abrirDialogo(user);
    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });
    const retiro = within(lista).getAllByRole("listitem")[1] as HTMLElement;

    await user.click(within(retiro).getByRole("button", { name: "Anular" }));
    const confirmar = within(dialogo).getByRole("alertdialog");
    expect(within(confirmar).queryByLabelText("Código de autorización")).not.toBeInTheDocument();
    const boton = within(confirmar).getByRole("button", { name: "Anular el movimiento" });
    expect(boton).toBeDisabled();

    await user.type(within(confirmar).getByLabelText("Por qué se anula"), "Se registró dos veces");
    expect(boton).toBeEnabled();
    const totalesAntes = mocked.getSessionTotals.mock.calls.length;
    await user.click(boton);

    await waitFor(() =>
      expect(mocked.cancelCashMovement).toHaveBeenCalledWith("m1", {
        reason: "Se registró dos veces",
      }),
    );
    expect(mocked.cancelCashMovement.mock.calls[0]?.[1]).not.toHaveProperty("code");
    // Anular cambia el esperado: el arqueo se vuelve a pedir.
    await waitFor(() =>
      expect(mocked.getSessionTotals.mock.calls.length).toBeGreaterThan(totalesAntes),
    );
  });

  it("anular un movimiento borra el aviso de un retiro rechazado: su cifra ya no es la del cajón", async () => {
    mocked.createCashMovement.mockRejectedValue({
      statusCode: 422,
      error: "Unprocessable Entity",
      message: "El efectivo del cajón no puede quedar debajo de cero: hay $840.50.",
    });
    mocked.listCashMovements.mockResolvedValue({ movements: [ENTRADA, RETIRO] });
    mocked.cancelCashMovement.mockResolvedValue({ ...RETIRO, status: "canceled" });
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);

    await user.type(within(dialogo).getByLabelText("Importe"), "10000");
    await user.click(within(dialogo).getByRole("button", { name: "Registrar retiro" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("hay $840.50");

    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });
    const retiro = within(lista).getAllByRole("listitem")[1] as HTMLElement;
    mocked.listCashMovements.mockResolvedValue({
      movements: [
        ENTRADA,
        {
          ...RETIRO,
          status: "canceled",
          canceledAt: "2026-11-23T18:10:00.000Z",
          canceledBy: { id: "u1", name: "Luis Ramírez" },
          cancelReason: "Se registró dos veces",
        },
      ],
    });
    await user.click(within(retiro).getByRole("button", { name: "Anular" }));
    const confirmar = within(dialogo).getByRole("alertdialog");
    await user.type(within(confirmar).getByLabelText("Por qué se anula"), "Se registró dos veces");
    await user.click(within(confirmar).getByRole("button", { name: "Anular el movimiento" }));

    await waitFor(() => expect(within(dialogo).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("anular una entrada pide el código cuando el negocio lo tiene", async () => {
    mocked.listCashMovements.mockResolvedValue({ movements: [ENTRADA, RETIRO] });
    mocked.cancelCashMovement.mockResolvedValue({ ...ENTRADA, status: "canceled" });
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);
    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });
    const entrada = within(lista).getAllByRole("listitem")[0] as HTMLElement;

    await user.click(within(entrada).getByRole("button", { name: "Anular" }));
    const confirmar = within(dialogo).getByRole("alertdialog");
    const boton = within(confirmar).getByRole("button", { name: "Anular el movimiento" });
    await user.type(within(confirmar).getByLabelText("Por qué se anula"), "No era cambio");
    // Sin el código, no se anula: bajar el esperado es lo mismo que un retiro.
    expect(boton).toBeDisabled();

    await user.type(within(confirmar).getByLabelText("Código de autorización"), "1234");
    await user.click(boton);

    await waitFor(() =>
      expect(mocked.cancelCashMovement.mock.calls[0]).toStrictEqual([
        "m2",
        { reason: "No era cambio", code: "1234" },
      ]),
    );
  });

  it("sin código configurado, anular una entrada solo pide el motivo", async () => {
    mocked.listCashMovements.mockResolvedValue({ movements: [ENTRADA] });
    mocked.cancelCashMovement.mockResolvedValue({ ...ENTRADA, status: "canceled" });
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);
    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });

    await user.click(within(lista).getByRole("button", { name: "Anular" }));
    const confirmar = within(dialogo).getByRole("alertdialog");
    expect(within(confirmar).queryByLabelText("Código de autorización")).not.toBeInTheDocument();
    await user.type(within(confirmar).getByLabelText("Por qué se anula"), "No era cambio");
    await user.click(within(confirmar).getByRole("button", { name: "Anular el movimiento" }));

    await waitFor(() =>
      expect(mocked.cancelCashMovement.mock.calls[0]).toStrictEqual([
        "m2",
        { reason: "No era cambio" },
      ]),
    );
  });

  it("si el API rechaza la anulación, se dice con sus palabras", async () => {
    mocked.listCashMovements.mockResolvedValue({ movements: [RETIRO] });
    mocked.cancelCashMovement.mockRejectedValue({
      statusCode: 409,
      error: "Conflict",
      message: "Ese movimiento ya está anulado.",
    });
    const user = montar(<SessionBar session={TURNO} />, null);
    const dialogo = await abrirDialogo(user);
    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });

    await user.click(within(lista).getByRole("button", { name: "Anular" }));
    const confirmar = within(dialogo).getByRole("alertdialog");
    await user.type(within(confirmar).getByLabelText("Por qué se anula"), "Duplicado");
    await user.click(within(confirmar).getByRole("button", { name: "Anular el movimiento" }));

    expect(await within(confirmar).findByRole("alert")).toHaveTextContent(
      "Ese movimiento ya está anulado.",
    );
  });

  it("un movimiento anulado se ve tachado, con su motivo, y ya no ofrece «Anular»", async () => {
    mocked.listCashMovements.mockResolvedValue({
      movements: [
        {
          ...RETIRO,
          status: "canceled",
          canceledAt: "2026-11-23T18:10:00.000Z",
          canceledBy: { id: "u2", name: "Ana Pérez" },
          cancelReason: "Se registró dos veces",
        },
      ],
    });
    const user = montar(<SessionBar session={TURNO} />);
    const dialogo = await abrirDialogo(user);
    const lista = await within(dialogo).findByRole("list", { name: "Movimientos del turno" });
    const anulado = within(lista).getByRole("listitem");

    expect(within(anulado).getByText("−$500.00")).toHaveClass("line-through");
    expect(anulado).toHaveTextContent("Anulado");
    expect(anulado).toHaveTextContent("Anuló Ana Pérez: Se registró dos veces");
    expect(within(anulado).queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });
});
