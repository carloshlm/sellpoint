import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { useCartStore } from "@/stores/cart.store";
import { createI18n } from "../i18n";
import * as posApi from "../lib/pos/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F4-CART — el carrito en la pantalla de venta.
 *
 * Lo que se prueba es el CAMINO del mostrador: teclear o escanear, que el
 * acierto exacto entre solo, que la presentación escaneada sea la que se cobra
 * y que el numpad obedezca a la unidad. No se prueba que los botones existan.
 */
vi.mock("../lib/pos/api", () => ({
  getSession: vi.fn(),
  openSession: vi.fn(),
  getSessionTotals: vi.fn(),
  closeSession: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  listScopedWarehouses: vi.fn(),
}));

const mocked = vi.mocked(posApi);

const PIEZA: posApi.LookupPresentation = {
  id: "pres-pieza",
  name: "Pieza",
  factor: "1",
  price: "12.50",
  barcode: "7501234567001",
  isDefaultSale: true,
  allowFractionalInput: false,
};

const CAJA: posApi.LookupPresentation = {
  id: "pres-caja",
  name: "Caja ×12",
  factor: "12",
  price: "140.00",
  barcode: "7501234567002",
  isDefaultSale: false,
  allowFractionalInput: false,
};

const AGUA: posApi.LookupProductItem = {
  type: "product",
  matchedBy: "text",
  id: "prod-agua",
  sku: "AGUA",
  name: "Agua mineral",
  baseUnit: "unit",
  isComposite: false,
  available: "50",
  expired: "0",
  presentations: [PIEZA, CAJA],
  matchedPresentationId: null,
};

const HARINA: posApi.LookupProductItem = {
  ...AGUA,
  id: "prod-harina",
  sku: "HAR",
  name: "Harina a granel",
  baseUnit: "kg",
  presentations: [{ ...PIEZA, id: "pres-kg", name: "Kilo", allowFractionalInput: true }],
};

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "cajero@demo.test",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "t1",
    name: "Demo",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

const sesion = (): posApi.CashboxSession => ({
  id: "s1",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-08-21T15:00:00.000Z",
  closedAt: null,
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Almacén Centro" },
});

async function renderPos() {
  useAuthStore.getState().setAuth("jwt", demoUser(["pos:sell"]));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/pos"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByLabelText("Buscar");
}

describe("El carrito del POS (F4-CART)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().clear();
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({ totals: [] });
  });

  describe("buscar", () => {
    it("arranca con el carrito vacío y lo dice", async () => {
      await renderPos();

      expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
    });

    it("una búsqueda difusa lista opciones y el clic agrega la línea", async () => {
      mocked.lookup.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AGUA] });
      await renderPos();

      await userEvent.type(screen.getByLabelText("Buscar"), "agua");
      await userEvent.click(await screen.findByRole("button", { name: /Agua mineral/ }));

      expect(useCartStore.getState().lines).toHaveLength(1);
    });

    /**
     * Un acierto exacto no abre una lista de un solo renglón: entra solo. Es lo
     * que hace que escanear se sienta instantáneo.
     */
    it("un acierto EXACTO entra al carrito sin que nadie elija", async () => {
      mocked.lookup.mockResolvedValue({
        warehouseId: "w1",
        exact: true,
        items: [{ ...AGUA, matchedBy: "barcode", matchedPresentationId: CAJA.id }],
      });
      await renderPos();

      await userEvent.type(screen.getByLabelText("Buscar"), "7501234567002");

      await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    });

    /**
     * ⚠ El código identifica la PRESENTACIÓN. Escanear la caja y cobrar una
     * pieza es un faltante de once unidades que nadie ve hasta el inventario.
     */
    it("escanear la CAJA deja la línea en la caja, no en la pieza", async () => {
      mocked.lookup.mockResolvedValue({
        warehouseId: "w1",
        exact: true,
        items: [{ ...AGUA, matchedBy: "barcode", matchedPresentationId: CAJA.id }],
      });
      await renderPos();

      await userEvent.type(screen.getByLabelText("Buscar"), "7501234567002");

      await waitFor(() => {
        const linea = useCartStore.getState().lines[0];
        expect(linea?.type === "product" && linea.presentationId).toBe(CAJA.id);
      });
    });

    it("sin resultados lo dice, en vez de dejar la pantalla muda", async () => {
      mocked.lookup.mockResolvedValue({ warehouseId: "w1", exact: false, items: [] });
      await renderPos();

      await userEvent.type(screen.getByLabelText("Buscar"), "nada");

      expect(
        await screen.findByText(/No encontramos nada que se pueda vender/),
      ).toBeInTheDocument();
    });
  });

  describe("el carrito", () => {
    it("muestra el subtotal y lo recalcula al cambiar la cantidad", async () => {
      mocked.lookup.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AGUA] });
      await renderPos();
      useCartStore.getState().add(AGUA, { quantity: "2" });

      expect(await screen.findByTestId("cart-subtotal")).toHaveTextContent("25.00");

      const key = useCartStore.getState().lines[0]?.key as string;
      useCartStore.getState().setQuantity(key, "4");

      await waitFor(() => expect(screen.getByTestId("cart-subtotal")).toHaveTextContent("50.00"));
    });

    it("el selector de presentación cambia el renglón sin borrarlo", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);

      await userEvent.selectOptions(await screen.findByLabelText("Presentación"), CAJA.id);

      expect(useCartStore.getState().lines).toHaveLength(1);
      const linea = useCartStore.getState().lines[0];
      expect(linea?.type === "product" && linea.presentationId).toBe(CAJA.id);
    });

    /**
     * Se MARCA, no se bloquea. Quien decide es el API al cobrar, con el saldo
     * del instante — una pantalla que frena con datos de hace un minuto impide
     * ventas que sí se podían hacer.
     */
    it("avisa cuando se pide más de lo que hay, sin bloquear", async () => {
      await renderPos();
      // 5 cajas ×12 son 60 piezas y hay 50.
      useCartStore.getState().add({ ...AGUA, matchedPresentationId: CAJA.id }, { quantity: "5" });

      expect(await screen.findByRole("alert")).toHaveTextContent(/Más de lo que hay/);
    });

    it("quitar borra solo ese renglón", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);
      useCartStore.getState().add(HARINA);

      await userEvent.click((await screen.findAllByLabelText("Quitar"))[0] as HTMLElement);

      expect(useCartStore.getState().lines).toHaveLength(1);
    });
  });

  describe("el numpad (F4-CART-03)", () => {
    /**
     * ⚠ LA INVARIANTE. `allow_fractional_input = false` sale de la categoría de
     * la unidad: media pieza no existe, y el API rechaza esa cantidad. Pintar
     * el punto sería preparar un 422.
     */
    it("en una presentación ENTERA el punto no se pinta", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);

      await userEvent.click(await screen.findByText("Agua mineral"));

      const numpad = await screen.findByTestId("numpad");
      expect(within(numpad).queryByRole("button", { name: "." })).not.toBeInTheDocument();
    });

    it("en una FRACCIONARIA el punto está", async () => {
      await renderPos();
      useCartStore.getState().add(HARINA);

      await userEvent.click(await screen.findByText("Harina a granel"));

      const numpad = await screen.findByTestId("numpad");
      expect(within(numpad).getByRole("button", { name: "." })).toBeInTheDocument();
    });

    it("los dígitos escriben la cantidad de la línea seleccionada", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);

      await userEvent.click(await screen.findByText("Agua mineral"));
      const numpad = await screen.findByTestId("numpad");
      await userEvent.click(within(numpad).getByRole("button", { name: "3" }));

      // La línea nace en "1"; tocar 3 da "13".
      await waitFor(() => expect(useCartStore.getState().lines[0]?.quantity).toBe("13"));
    });

    /**
     * El numpad esconde el punto; no puede esconder el `Ctrl+V`. Se TRUNCA y
     * se avisa: redondear cobraría una pieza que nadie pidió.
     */
    it("pegar un decimal en una presentación entera lo trunca y lo explica", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);
      await userEvent.click(await screen.findByText("Agua mineral"));

      const campo = await screen.findByLabelText("Cantidad");
      await userEvent.clear(campo);
      await userEvent.paste("12.7");

      await waitFor(() => expect(useCartStore.getState().lines[0]?.quantity).toBe("12"));
      expect(screen.getByText(/solo admite enteros/i)).toBeInTheDocument();
    });
  });

  describe("el escáner (F4-CART-04)", () => {
    /**
     * jsdom no tiene cámara: `decodeFromVideoDevice` falla y el componente cae
     * en su rama de degradación. Eso es exactamente lo que hay que probar —
     * **la búsqueda manual sigue viva**. Un mostrador no puede quedarse sin
     * vender porque alguien dijo que no a un diálogo del navegador.
     */
    it("sin cámara lo dice y la búsqueda manual sigue funcionando", async () => {
      mocked.lookup.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AGUA] });
      await renderPos();

      await userEvent.click(await screen.findByRole("button", { name: /Escanear/ }));

      expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Buscar"), "agua");
      expect(await screen.findByRole("button", { name: /Agua mineral/ })).toBeInTheDocument();
    });
  });
});
