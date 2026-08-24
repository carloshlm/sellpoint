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
  createSale: vi.fn(),
}));
// `listScopedWarehouses` NO existe: el alcance se pide con
// `listWarehouses({ scoped: true })`. El mock la declaraba y nadie lo notaba
// porque ningún test la USABA — un mock de una función inexistente es una
// mentira que solo se descubre cuando alguien intenta apoyarse en ella.
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
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

const IMPRESION: posApi.LookupServiceItem = {
  type: "service",
  matchedBy: "text",
  id: "srv-impresion",
  code: "IMPRESION001",
  name: "Impresión",
  price: "1.00",
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

    /**
     * ⚠ Lo destapó la prueba de punta a punta en PRODUCCIÓN (2026-08-21): el
     * carrito decía «1 piezas». Cuatro pantallas pluralizaban sin mirar la
     * cantidad porque cada una llamaba a `unitName(..., { plural: true })` por
     * su cuenta. La decisión vive ahora en `formatQuantityWithUnit`.
     */
    it("una sola unidad va en SINGULAR: «1 pieza», no «1 piezas»", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA, { quantity: "1" });

      const linea = await screen.findByTestId(`cart-qty-${useCartStore.getState().lines[0]?.key}`);
      expect(linea).toHaveTextContent("1 pieza");
      expect(linea).not.toHaveTextContent("1 piezas");
    });

    it("dos o más van en plural", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA, { quantity: "2" });

      const linea = await screen.findByTestId(`cart-qty-${useCartStore.getState().lines[0]?.key}`);
      expect(linea).toHaveTextContent("2 piezas");
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

    /**
     * ── SERVICIOS: ENTEROS (2026-08-24, corrección de Carlos) ───────────
     *
     * El código decía «un servicio admite decimales: media hora de consulta
     * es media hora» y suena razonable — pero un servicio en este modelo no
     * tiene UNIDAD: solo código, nombre y precio. Sin unidad no hay forma de
     * distinguir «hora de consulta» de «impresión», y Carlos vio 1.7
     * impresiones en el carrito. Enteros es lo coherente con el modelo que
     * hay; el día que un servicio se cobre por fracción, la respuesta es un
     * campo suyo, no un permiso general.
     */
    it("un SERVICIO no ofrece el punto: no se venden 1.7 impresiones", async () => {
      await renderPos();
      useCartStore.getState().add(IMPRESION);

      await userEvent.click(await screen.findByText("Impresión"));

      const numpad = await screen.findByTestId("numpad");
      expect(within(numpad).queryByRole("button", { name: "." })).not.toBeInTheDocument();
    });

    /**
     * ── ABRIR EL TECLADO DESDE CANTIDAD Y PRECIO (2026-08-24) ───────────
     *
     * Carlos: el teclado solo salía tocando el NOMBRE. La cantidad es
     * justamente lo que se va a cambiar, así que es el lugar más natural para
     * tocar — y el importe está pegado a ella.
     */
    it.each(["cantidad", "importe"])("tocar el %s abre el teclado", async (zona) => {
      await renderPos();
      useCartStore.getState().add(AGUA);
      await screen.findByText("Agua mineral");
      const key = useCartStore.getState().lines[0]?.key ?? "";

      await userEvent.click(
        screen.getByTestId(zona === "cantidad" ? `cart-qty-${key}` : `cart-total-${key}`),
      );

      expect(await screen.findByTestId("numpad")).toBeInTheDocument();
    });

    /**
     * ── CERRAR EL TECLADO (2026-08-24) ──────────────────────────────────
     *
     * Ocupa media pantalla y tapa el carrito. Dos salidas, y las dos importan:
     * un botón explícito —descubrible— y volver a tocar la MISMA línea, que
     * es el gesto que uno intenta primero. Sin la segunda, tocar la línea ya
     * seleccionada no hace nada y la pantalla parece trabada.
     */
    it("un botón cierra el teclado", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);
      await userEvent.click(await screen.findByText("Agua mineral"));
      await screen.findByTestId("numpad");

      await userEvent.click(screen.getByRole("button", { name: /ocultar teclado/i }));

      expect(screen.queryByTestId("numpad")).not.toBeInTheDocument();
    });

    it("volver a tocar la MISMA línea también lo cierra", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);

      await userEvent.click(await screen.findByText("Agua mineral"));
      await screen.findByTestId("numpad");
      await userEvent.click(screen.getByText("Agua mineral"));

      expect(screen.queryByTestId("numpad")).not.toBeInTheDocument();
    });

    it("tocar OTRA línea NO lo cierra: cambia de línea", async () => {
      await renderPos();
      useCartStore.getState().add(AGUA);
      useCartStore.getState().add(HARINA);

      await userEvent.click(await screen.findByText("Agua mineral"));
      await userEvent.click(screen.getByText("Harina a granel"));

      // Sigue abierto y ahora edita la harina — que sí admite decimales.
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

/**
 * F4-UI-01 y F4-UI-02 — la pantalla de venta y el cobro.
 *
 * Lo que se protege son las dos garantías que hacen que un mostrador funcione:
 * que un doble tap **no cobre dos veces**, y que un rechazo del servidor caiga
 * SOBRE el renglón culpable en vez de arriba de todo.
 */
describe("Cobrar (F4-UI-01 / F4-UI-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().clear();
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({ totals: [] });
  });

  const venta = (): posApi.Sale => ({
    id: "sale-1",
    folio: "VTA-000007",
    warehouseId: "w1",
    status: "completed",
    paymentMethod: "cash",
    subtotal: "25.00",
    discount: "0.00",
    total: "25.00",
    createdAt: "2026-08-21T16:00:00.000Z",
    items: [],
  });

  async function conCarrito() {
    await renderPos();
    useCartStore.getState().add(AGUA, { quantity: "2" }); // 2 × 12.50 = 25.00
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar" }));
    return screen.findByTestId("checkout-panel");
  }

  describe("la pantalla", () => {
    it("sin líneas no deja abrir el cobro: no hay nada que cobrar", async () => {
      await renderPos();

      expect(screen.getByRole("button", { name: "Cobrar" })).toBeDisabled();
    });

    /**
     * El carrito queda a la VISTA mientras se cobra. Un modal encima taparía
     * justamente lo que hay que verificar antes de cobrar — y, si el servidor
     * rechaza una línea, el renglón culpable ya está en pantalla.
     */
    it("al cobrar, el carrito sigue visible", async () => {
      await conCarrito();

      expect(screen.getByTestId("cart-panel")).toBeInTheDocument();
    });
  });

  describe("el vuelto", () => {
    it("se calcula al escribir cuánto se recibe", async () => {
      await conCarrito();

      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      expect(screen.getByTestId("checkout-change")).toHaveTextContent("25.00");
    });

    /**
     * Mientras no alcance, lo que hay que ver es cuánto FALTA — no un vuelto
     * negativo, que en un mostrador nadie sabe leer.
     */
    it("con efectivo insuficiente dice cuánto falta y no deja cobrar", async () => {
      await conCarrito();

      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "10");

      expect(screen.getByTestId("checkout-missing")).toHaveTextContent("15.00");
      expect(screen.getByTestId("checkout-change")).toHaveTextContent("0.00");
      expect(screen.getByRole("button", { name: "Cobrar" })).toBeDisabled();
    });

    /**
     * Tarjeta y transferencia se autorizan por su monto exacto fuera del
     * sistema: pedir "con cuánto paga" ahí sería una pregunta sin respuesta.
     */
    it("con tarjeta no se pregunta cuánto se recibe", async () => {
      await conCarrito();

      await userEvent.click(screen.getByRole("button", { name: "Tarjeta" }));

      expect(screen.queryByLabelText("Con cuánto paga")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cobrar" })).toBeEnabled();
    });
  });

  describe("el cobro", () => {
    it("manda ids y cantidades con el método elegido, y avisa el folio", async () => {
      mocked.createSale.mockResolvedValue(venta());
      await conCarrito();
      await userEvent.click(screen.getByRole("button", { name: "Transferencia" }));

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(mocked.createSale).toHaveBeenCalledTimes(1));
      expect(mocked.createSale.mock.calls[0]?.[0]).toEqual({
        paymentMethod: "transfer",
        lines: [{ productId: "prod-agua", presentationId: PIEZA.id, quantity: 2 }],
      });
      expect(await screen.findByTestId("sale-done")).toHaveTextContent("VTA-000007");
    });

    /**
     * (2) Carlos: que el aviso de venta cobrada sea VERDE.
     *
     * Estaba en `bg-primary/10`, el mismo azul que usa la app para cualquier
     * información. Un cobro exitoso es la confirmación que el cajero busca de
     * reojo con el cliente enfrente: el verde se reconoce sin leer. Se usa el
     * token `--success` que ya existe, no un color crudo — la barrera de
     * theming lo exige y ya me cobró una vez.
     */
    it("el aviso de venta cobrada se ve como ÉXITO, no como información", async () => {
      mocked.createSale.mockResolvedValue(venta());
      await conCarrito();
      await userEvent.click(screen.getByRole("button", { name: "Transferencia" }));
      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));
      await waitFor(() => expect(mocked.createSale).toHaveBeenCalled());

      const aviso = await screen.findByTestId("sale-done");
      expect(aviso.className).toContain("success");
      expect(aviso.className).not.toContain("bg-primary");
    });

    it("cobrada la venta, el carrito queda vacío para el siguiente cliente", async () => {
      mocked.createSale.mockResolvedValue(venta());
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(0));
    });

    it("el botón deshabilitado frena el segundo clic mientras el primero está en vuelo", async () => {
      // Una promesa que no resuelve deja el primer intento colgado.
      mocked.createSale.mockImplementation(() => new Promise(() => {}));
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      const boton = screen.getByRole("button", { name: "Cobrar" });
      await userEvent.click(boton);
      await userEvent.click(boton);

      expect(mocked.createSale).toHaveBeenCalledTimes(1);
    });

    /**
     * ⚠ LA INVARIANTE DE LA TAREA, y el test que de verdad la prueba.
     *
     * El botón deshabilitado NO alcanza: solo cubre la ventana en que el primer
     * intento sigue en vuelo. El caso que rompe una caja es el otro — el cobro
     * falla o la red se corta, el cajero vuelve a tocar, y **el servidor ya
     * había asentado la venta**. Ahí lo único que impide cobrar dos veces es que
     * el segundo intento traiga la MISMA clave.
     *
     * Por eso nace al ABRIR el panel y no en el clic. Un primer test que solo
     * hacía dos clics seguidos pasaba con la clave generada en el clic — probaba
     * el botón, no la clave.
     */
    it("tras un fallo, el reintento manda la MISMA clave: es lo que impide el doble cobro", async () => {
      mocked.createSale
        .mockRejectedValueOnce({
          statusCode: 0,
          message: "Network Error",
          error: "Network Error",
        })
        .mockResolvedValueOnce(venta());
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));
      await screen.findByRole("alert");
      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(mocked.createSale).toHaveBeenCalledTimes(2));
      const [primera, segunda] = mocked.createSale.mock.calls.map((c) => c[1]);
      expect(primera).toBe(segunda);
    });

    it("la clave es un UUID, no un contador ni la hora", async () => {
      mocked.createSale.mockResolvedValue(venta());
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(mocked.createSale).toHaveBeenCalled());
      expect(mocked.createSale.mock.calls[0]?.[1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("el rechazo del servidor", () => {
    /**
     * ⚠ Lección del confirm mudo de F3: el error NUNCA se traga.
     */
    it("un rechazo se pinta, no deja el botón muerto", async () => {
      mocked.createSale.mockRejectedValue({
        statusCode: 422,
        message: "No hay suficiente existencia de «AGUA»: hay 1 y se piden 2.",
        error: "Unprocessable Entity",
        code: "inventory.insufficient_stock",
        sku: "AGUA",
      });
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      expect(await screen.findByText(/No hay suficiente existencia/)).toBeInTheDocument();
    });

    /**
     * ⚠ LA OTRA INVARIANTE. En un carrito de ocho renglones, un mensaje que no
     * señala CUÁL obliga a revisarlos uno por uno con el cliente enfrente. El
     * `sku` viaja como dato en el cuerpo, no dentro del texto traducido.
     */
    it("el renglón culpable queda marcado, no solo el mensaje de arriba", async () => {
      mocked.createSale.mockRejectedValue({
        statusCode: 422,
        message: "No hay suficiente existencia de «AGUA».",
        error: "Unprocessable Entity",
        code: "inventory.insufficient_stock",
        sku: "AGUA",
      });
      await renderPos();
      useCartStore.getState().add(AGUA, { quantity: "2" });
      useCartStore.getState().add(HARINA, { quantity: "1" });
      await userEvent.click(await screen.findByRole("button", { name: "Cobrar" }));
      await userEvent.type(await screen.findByLabelText("Con cuánto paga"), "500");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(useCartStore.getState().errorSku).toBe("AGUA"));
      const marcados = document.querySelectorAll("[data-rejected='true']");
      // UNO marcado, no los dos: señalar todos es no señalar ninguno.
      expect(marcados).toHaveLength(1);
    });

    it("corregir la cantidad borra la marca: el rechazo hablaba del estado viejo", async () => {
      mocked.createSale.mockRejectedValue({
        statusCode: 422,
        message: "No hay suficiente existencia.",
        error: "Unprocessable Entity",
        code: "inventory.insufficient_stock",
        sku: "AGUA",
      });
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");
      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));
      await waitFor(() => expect(useCartStore.getState().errorSku).toBe("AGUA"));

      const key = useCartStore.getState().lines[0]?.key as string;
      useCartStore.getState().setQuantity(key, "1");

      expect(useCartStore.getState().errorSku).toBeNull();
    });

    it("un rechazo NO vacía el carrito: lo que se corrige es la línea", async () => {
      mocked.createSale.mockRejectedValue({
        statusCode: 422,
        message: "No hay suficiente existencia.",
        error: "Unprocessable Entity",
        code: "inventory.insufficient_stock",
      });
      await conCarrito();
      await userEvent.type(screen.getByLabelText("Con cuánto paga"), "50");

      await userEvent.click(screen.getByRole("button", { name: "Cobrar" }));

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(useCartStore.getState().lines).toHaveLength(1);
    });
  });
});
