import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@/stores/auth.store";
import { useQuickCatalogStore } from "@/stores/quick-catalog.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { createI18n } from "../i18n";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F10-QUICKCAT — la carga rápida.
 *
 * Lo que se prueba acá es lo que hace que escanear 80 productos sea posible:
 * que ningún escaneo se pierda, que el borrador sobreviva, que sea del dueño
 * correcto y que un rebote del servidor no borre media hora de trabajo.
 */
vi.mock("../lib/products/api", () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  listPresentations: vi.fn(),
  createPresentation: vi.fn(),
  updatePresentation: vi.fn(),
  deletePresentation: vi.fn(),
  getComposition: vi.fn(),
  replaceComposition: vi.fn(),
  getAvailability: vi.fn(),
  getCostEstimate: vi.fn(),
  lookupBarcode: vi.fn(),
  quickAddProducts: vi.fn(),
}));

// La cámara no existe en jsdom. Se reemplaza por una marca para poder afirmar
// CUÁNDO se ofrece, que sí es parte de esta pantalla.
vi.mock("@/components/pos/barcode-scanner", () => ({
  BarcodeScanner: () => <div data-testid="scanner-de-camara" />,
}));

/**
 * Finge las capacidades del aparato: `matchMedia` no existe en jsdom.
 *
 * `puntero` decide si se ofrece la cámara; `ancho`, si la línea se pinta como
 * fila de tabla o apilada.
 */
function fingirAparato({ puntero, ancho }: { puntero: "grueso" | "fino"; ancho: boolean }) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (consulta: string) => ({
      matches: consulta.includes("pointer: coarse") ? puntero === "grueso" : ancho,
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

const mocked = vi.mocked(productsApi);

const desconocido = (code: string): productsApi.BarcodeLookup => ({
  status: "unknown",
  code,
  gtin14: `0${code}`,
  tenant: null,
  global: null,
  contributable: true,
});

const enCatalogoGlobal = (
  code: string,
  name: string,
  lang: string | null = "es",
): productsApi.BarcodeLookup => ({
  status: "global",
  code,
  gtin14: `0${code}`,
  tenant: null,
  global: { name, lang, brand: "Marca", unitSize: "600 ml" },
  contributable: false,
});

const yaEsDelNegocio = (code: string, name: string, price: string): productsApi.BarcodeLookup => ({
  status: "tenant",
  code,
  gtin14: `0${code}`,
  tenant: { productId: "p-1", presentationId: "pr-1", sku: code, name, price },
  global: null,
  contributable: false,
});

const USUARIO = buildAuthUser({
  permissions: ["products:read", "products:manage"],
  tenant: buildTenantBlock({}),
});

async function abrir(user = USUARIO) {
  useAuthStore.getState().setAuth("jwt", user);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/products/quick"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

/** Dar de alta pasa por su confirmación desde 2026-09-17. */
const darDeAlta = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Dar de alta/ }));
  const dialogo = await screen.findByTestId("quick-confirm-add");
  await user.click(within(dialogo).getByRole("button", { name: "Dar de alta" }));
};

/**
 * Teclea `texto` y un Enter sobre `campo`, con una pausa CONTROLADA entre
 * teclas. El reloj es falso a propósito: la detección del lector mide tiempos,
 * y un `setTimeout` real haría que la prueba dependa de lo rápido que ande la
 * máquina — que es justo como el CI tumbó otra prueba de este archivo.
 */
function teclearComo(
  campo: HTMLInputElement,
  texto: string,
  pausaMs: number,
  reloj: { ahora: number },
) {
  for (const caracter of texto) {
    reloj.ahora += pausaMs;
    fireEvent.keyDown(campo, { key: caracter });
    fireEvent.input(campo, { target: { value: campo.value + caracter } });
  }
  reloj.ahora += pausaMs;
  fireEvent.keyDown(campo, { key: "Enter" });
}

const escanear = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  const campo = screen.getByLabelText("Código de barras");
  await user.click(campo);
  await user.type(campo, `${code}{Enter}`);
};

describe("Carga rápida de catálogo (F10-QUICKCAT)", () => {
  beforeEach(() => {
    // `clearAllMocks` NO vacía la cola de `mockResolvedValueOnce`: una prueba
    // que deja uno sin consumir se lo presta a la siguiente, y el síntoma —un
    // nombre de otra prueba— no se parece en nada a la causa.
    vi.resetAllMocks();
    // `fingirAparato` define `window.matchMedia`, que jsdom no trae. Se quita
    // entre pruebas para que ninguna herede el aparato de la anterior: una
    // dependencia de orden es de las que fallan lejos de donde se causan.
    Reflect.deleteProperty(window, "matchMedia");
    localStorage.clear();
    useQuickCatalogStore.setState({ owner: null, lines: [], storageFailed: false });
    useAuthStore.getState().clearAuth();
    mocked.listProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  });

  it("el catálogo compartido sugiere el nombre y solo queda poner el precio", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");

    expect(await screen.findByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
    expect(screen.getByText("Nombre sugerido")).toBeInTheDocument();
  });

  /**
   * F10-LANG — el caso que lo originó: Carlos escaneó un aceite de oliva en
   * Canadá y la pantalla le sugirió «Huile d'olive vierge extra» con la misma
   * insignia que cualquier nombre en su idioma.
   */
  it("un nombre en otro idioma se sugiere igual, pero la insignia lo dice", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      enCatalogoGlobal("6191509903627", "Huile d'olive vierge extra", "fr"),
    );
    const user = await abrir();

    await escanear(user, "6191509903627");

    // Se sugiere: con la marca al lado alcanza para reconocer la botella.
    expect(await screen.findByDisplayValue("Huile d'olive vierge extra")).toBeInTheDocument();
    // Y se dice en qué idioma está, en el idioma de quien lee.
    expect(screen.getByText("Nombre en francés")).toBeInTheDocument();
    expect(screen.queryByText("Nombre sugerido")).not.toBeInTheDocument();
  });

  it("el nombre en tu propio idioma no lleva aviso de idioma", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      enCatalogoGlobal("7501055300013", "Refresco 600 ml", "es"),
    );
    const user = await abrir();

    await escanear(user, "7501055300013");

    expect(await screen.findByText("Nombre sugerido")).toBeInTheDocument();
  });

  it("al reescribir el nombre, el aviso de idioma desaparece", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      enCatalogoGlobal("6191509903627", "Huile d'olive vierge extra", "fr"),
    );
    const user = await abrir();
    await escanear(user, "6191509903627");
    await screen.findByText("Nombre en francés");

    const nombre = screen.getByLabelText("Nombre del producto");
    await user.clear(nombre);
    await user.type(nombre, "Aceite de oliva extra virgen");

    // Lo que hay ahora lo escribió la persona, en el suyo.
    expect(screen.queryByText("Nombre en francés")).not.toBeInTheDocument();
  });

  it("lo que el negocio ya tiene no se renombra desde acá: el nombre es de solo lectura", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      yaEsDelNegocio("7501055300013", "Como lo llamo yo", "18.50"),
    );
    const user = await abrir();

    await escanear(user, "7501055300013");

    const nombre = await screen.findByDisplayValue("Como lo llamo yo");
    expect(nombre).toHaveAttribute("readonly");
    expect(screen.getByText("Ya lo tienes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("18.50")).toBeInTheDocument();
  });

  /**
   * Carlos (2026-09-17): «el usuario no debe saber que estamos alimentando el
   * catálogo global con lo que él escriba». La insignia dice QUÉ HACER, no de
   * dónde sale el dato — que además es lo único que le sirve a quien está
   * cargando su catálogo.
   */
  it("lo que nadie conoce pide el nombre, sin contar de dónde sale el catálogo", async () => {
    mocked.lookupBarcode.mockResolvedValue(desconocido("7509999000013"));
    const user = await abrir();

    await escanear(user, "7509999000013");

    expect(await screen.findByText("Escribe el nombre")).toBeInTheDocument();
    expect(screen.queryByText(/catálogo compartido/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nuevo para todos/)).not.toBeInTheDocument();
  });

  it("el nombre de un producto que ya tienes se VE de solo lectura", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      yaEsDelNegocio("7501055300013", "Patron Anejo Tequila 375 Ml", "600"),
    );
    const user = await abrir();

    await escanear(user, "7501055300013");

    const nombre = await screen.findByDisplayValue("Patron Anejo Tequila 375 Ml");
    expect(nombre).toHaveAttribute("readonly");
    // Y se nota: un campo bloqueado con el mismo aspecto que los demás invita
    // a teclear en él y a no entender por qué no pasa nada.
    expect(nombre.className).toContain("bg-muted");
  });

  /**
   * El defecto que costó una insignia vacía en pantalla: `nameLang` se agregó
   * a `QuickLine` sin subir la versión del borrador, un borrador guardado
   * antes revivió sin ese campo, y el guardia comparaba contra `null` cuando
   * lo que había era `undefined`. Resultado: «Nombre en » sin idioma.
   */
  it("una línea guardada SIN el campo del idioma no pinta una insignia vacía", async () => {
    useQuickCatalogStore.setState({
      owner: `${USUARIO.tenant.id}:${USUARIO.id}`,
      lines: [
        // A propósito sin `nameLang`: así quedaban las líneas de la versión
        // anterior del borrador.
        {
          code: "7501008042984",
          status: "known",
          name: "Zucaritas",
          price: "19",
          brand: "Kellogg's",
          contributable: false,
        } as unknown as ReturnType<typeof useQuickCatalogStore.getState>["lines"][number],
      ],
      storageFailed: false,
    });

    await abrir();

    expect(await screen.findByDisplayValue("Zucaritas")).toBeInTheDocument();
    expect(screen.getByText("Nombre sugerido")).toBeInTheDocument();
    expect(screen.queryByText(/Nombre en\s*$/)).not.toBeInTheDocument();
  });

  /**
   * Carlos (2026-09-16) llegó con tres líneas en su borrador dadas de alta
   * como códigos de barras: un número de 24 dígitos, «adsadasdsad» y una
   * consulta SQL entera.
   */
  it.each([
    ["658723675843268975432785", "24 dígitos"],
    ["adsadasdsad", "letras"],
    ["SELECT * FROM global_barcode_catalog", "una consulta SQL"],
    ["12345", "demasiado corto"],
  ])("no crea línea con %s (%s)", async (codigo) => {
    const user = await abrir();

    await escanear(user, codigo);

    expect(await screen.findByRole("status")).toHaveTextContent("no es un código de barras");
    // Ni se consulta: no hay nada que buscar con eso.
    expect(mocked.lookupBarcode).not.toHaveBeenCalled();
    expect(
      screen.getByText("Todavía no escaneas nada. El primer código abre la lista."),
    ).toBeInTheDocument();
    // Lo tecleado se queda a la vista para poder corregirlo.
    expect(screen.getByLabelText("Código de barras")).toHaveValue(codigo);
  });

  it("una línea vieja con un código imposible frena el alta y lo dice", async () => {
    useQuickCatalogStore.setState({
      owner: `${USUARIO.tenant.id}:${USUARIO.id}`,
      lines: [
        {
          code: "adsadasdsad",
          status: "new",
          name: "Producto Error 2",
          price: "10.00",
          brand: null,
          nameLang: null,
          contributable: false,
        },
      ],
      storageFailed: false,
    });
    const user = await abrir();

    await user.click(await screen.findByRole("button", { name: /Dar de alta/ }));

    expect(await screen.findByText(/no es un código de barras/)).toBeInTheDocument();
    expect(mocked.quickAddProducts).not.toHaveBeenCalled();
  });

  /**
   * Carlos (2026-09-17), con un lector Bluetooth: «si tengo un producto ya
   * agregado en una línea y luego escaneo otro producto no me agrega una línea
   * nueva y me da el foco en el product Name del producto anterior».
   *
   * Un lector es un teclado que escribe doce caracteres y el Enter en el mismo
   * suspiro. React agrupa los `onChange` y los aplica después, así que al
   * llegar el Enter la variable del estado todavía traía lo de ANTES y la
   * función se salía por «no hay nada que escanear». Acá se reproduce eso: el
   * valor llega al DOM y el Enter se dispara sin que React haya procesado
   * ningún cambio.
   */
  it("un lector que escribe y manda Enter de un golpe SÍ agrega la línea", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    await abrir();
    const campo = screen.getByLabelText("Código de barras") as HTMLInputElement;

    campo.value = "7501055300013";
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
    expect(mocked.lookupBarcode).toHaveBeenCalledWith("7501055300013");
  });

  it("y con una línea ya puesta, el segundo escaneo del lector agrega OTRA", async () => {
    mocked.lookupBarcode
      .mockResolvedValueOnce(enCatalogoGlobal("7501055300013", "Primero"))
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");

    const campo = screen.getByLabelText("Código de barras") as HTMLInputElement;
    campo.value = "7509999000006";
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByDisplayValue("Segundo")).toBeInTheDocument();
    // Y el campo queda limpio para el siguiente, no con el código pegado.
    await waitFor(() => {
      expect(screen.getByLabelText("Código de barras")).toHaveValue("");
    });
  });

  it("el mismo código dos veces NO duplica la línea", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");
    await escanear(user, "7501055300013");

    expect(await screen.findByRole("status")).toHaveTextContent("ya está en la lista");
    expect(screen.getAllByDisplayValue("Refresco 600 ml")).toHaveLength(1);
    expect(mocked.lookupBarcode).toHaveBeenCalledTimes(1);
  });

  /**
   * El bug que `pos/cart-search.tsx` ya pagó: dos consultas en vuelo se pisan
   * y una línea se pierde. Con la pistola en la mano, dos escaneos separados
   * por 200 ms son lo normal.
   */
  it("dos escaneos seguidos, sin esperar al primero, dejan DOS líneas", async () => {
    // La primera consulta se resuelve CUANDO ESTA PRUEBA QUIERE, no cuando
    // vence un temporizador. Con `setTimeout(30)` el CI la resolvía en la
    // ventana entre el clic y la primera tecla del segundo escaneo —campo
    // enfocado y vacío— y la prueba fallaba solo allá. Un reloj no es una
    // manera de ordenar los hechos que la prueba quiere fijar.
    let resolverPrimera: (valor: productsApi.BarcodeLookup) => void = () => undefined;
    mocked.lookupBarcode
      .mockImplementationOnce(
        () =>
          new Promise<productsApi.BarcodeLookup>((resolve) => {
            resolverPrimera = resolve;
          }),
      )
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    // El segundo se encola con el primero TODAVÍA en vuelo, que es lo que esta
    // prueba existe para fijar.
    await escanear(user, "7509999000006");
    resolverPrimera(enCatalogoGlobal("7501055300013", "Primero"));

    expect(await screen.findByDisplayValue("Primero")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Segundo")).toBeInTheDocument();
    // Y el segundo código NO terminó dentro del precio del primero, que es
    // como se rompía: el foco se movía en la ventana entre el clic y la
    // primera tecla del segundo escaneo.
    for (const precio of screen.getAllByLabelText("Precio de venta")) {
      expect(precio).toHaveValue("");
    }
  });

  /**
   * El otro lado de la moneda de la ráfaga: con UN escaneo suelto el foco SÍ
   * tiene que ir al precio, que es lo que hace posible el bucle «escanear,
   * precio, Enter». Un guardia demasiado celoso lo rompería sin que ninguna
   * otra prueba se diera cuenta.
   */
  it("tras un escaneo suelto, el foco va al precio de esa línea", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco");

    await waitFor(() => {
      expect(screen.getByLabelText("Precio de venta")).toHaveFocus();
    });
  });

  it("el borrador sobrevive a salir de la pantalla y volver", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    // Como si se hubiera cerrado la pestaña: solo queda lo guardado.
    const guardado = localStorage.getItem("sellpoint.quickCatalog");
    useQuickCatalogStore.setState({ owner: null, lines: [], storageFailed: false });
    expect(guardado).toContain("7501055300013");
  });

  it("el borrador de OTRA cuenta no aparece: se descarta al entrar", async () => {
    useQuickCatalogStore.setState({
      owner: "otro-negocio:otro-usuario",
      lines: [
        {
          code: "7501055300013",
          status: "known",
          name: "Del vecino",
          price: "10",
          brand: null,
          nameLang: null,
          contributable: false,
        },
      ],
      storageFailed: false,
    });

    await abrir();

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Del vecino")).not.toBeInTheDocument();
    });
  });

  it("un rebote del servidor NO vacía el borrador y marca la línea culpable", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    mocked.quickAddProducts.mockRejectedValue({
      statusCode: 422,
      error: "Unprocessable Entity",
      message: "Revisa las líneas marcadas.",
      errors: [
        {
          line: 1,
          itemCode: "7501055300013",
          field: "code",
          message: "Ese código ya está en uso.",
        },
      ],
    });
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");
    await user.type(screen.getByLabelText("Precio de venta"), "18.50");

    await darDeAlta(user);

    expect(await screen.findByText("Ese código ya está en uso.")).toBeInTheDocument();
    // La media hora de escaneo sigue en pie.
    expect(screen.getByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
  });

  it("al dar de alta se manda en el orden en que se escaneó, no como se ve", async () => {
    mocked.lookupBarcode
      .mockResolvedValueOnce(enCatalogoGlobal("7501055300013", "Primero"))
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    mocked.quickAddProducts.mockResolvedValue({ created: 2, updated: 0, contributed: 1 });
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");
    await escanear(user, "7509999000006");
    await screen.findByDisplayValue("Segundo");

    const precios = screen.getAllByLabelText("Precio de venta");
    // El segundo escaneo se pinta ARRIBA: su precio es el primero de la tabla.
    await user.type(precios[0] as HTMLElement, "10");
    await user.type(precios[1] as HTMLElement, "20");

    await darDeAlta(user);

    await waitFor(() => {
      // El segundo argumento es el contexto que react-query le pasa a toda
      // `mutationFn`; lo que se mide es el cuerpo.
      expect(mocked.quickAddProducts).toHaveBeenCalledWith(
        {
          lines: [
            { code: "7501055300013", name: "Primero", price: 20 },
            { code: "7509999000006", name: "Segundo", price: 10 },
          ],
        },
        expect.anything(),
      );
    });
    expect(await screen.findByText(/2 productos nuevos/)).toBeInTheDocument();
  });

  it("una línea sin precio frena el alta y lo dice, sin mandar nada", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: /Dar de alta/ }));

    expect(await screen.findByText("Escribe el precio de venta.")).toBeInTheDocument();
    expect(mocked.quickAddProducts).not.toHaveBeenCalled();
  });

  it("Enter en el precio devuelve el foco al escáner: eso hace viable la ráfaga", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    const precio = screen.getByLabelText("Precio de venta");
    await user.click(precio);
    await user.type(precio, "18.50{Enter}");

    expect(screen.getByLabelText("Código de barras")).toHaveFocus();
  });

  /**
   * Carlos (2026-09-17): «el botón Descartar lista es muy peligroso si se
   * presiona sin querer ya que pierdes el trabajo de las líneas que ya
   * registraste».
   */
  it("descartar PREGUNTA, y al cancelar no se pierde nada", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: "Descartar la lista" }));
    const dialogo = await screen.findByTestId("quick-confirm-discard");
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(screen.getByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
  });

  it("recién al confirmar se descarta, y el aviso dice cuántas se fueron", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: "Descartar la lista" }));
    const dialogo = await screen.findByTestId("quick-confirm-discard");
    await user.click(within(dialogo).getByRole("button", { name: "Descartar la lista" }));

    expect(screen.queryByDisplayValue("Refresco 600 ml")).not.toBeInTheDocument();
    // El aviso se enfoca solo, y ese foco es el que trae la pantalla hasta él.
    const aviso = await screen.findByTestId("quick-discarded");
    expect(aviso).toHaveTextContent("Se descartó 1 línea");
    expect(aviso).toHaveFocus();
  });

  it("el alta PREGUNTA y dice cuántos crea y a cuántos les cambia el precio", async () => {
    mocked.lookupBarcode
      .mockResolvedValueOnce(enCatalogoGlobal("7501055300013", "Nuevo"))
      .mockResolvedValueOnce(yaEsDelNegocio("7509999000006", "Ya lo tengo", "10"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Nuevo");
    await escanear(user, "7509999000006");
    await screen.findByDisplayValue("Ya lo tengo");
    await user.type(screen.getAllByLabelText("Precio de venta")[1] as HTMLElement, "20");

    await user.click(screen.getByRole("button", { name: /Dar de alta/ }));

    const dialogo = await screen.findByTestId("quick-confirm-add");
    expect(dialogo).toHaveTextContent("1 productos nuevos");
    expect(dialogo).toHaveTextContent("1 con precio actualizado");
    expect(mocked.quickAddProducts).not.toHaveBeenCalled();
  });

  it("el aviso de alta se enfoca solo: es el autoscroll hasta el resultado", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    mocked.quickAddProducts.mockResolvedValue({ created: 1, updated: 0, contributed: 1 });
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");
    await user.type(screen.getByLabelText("Precio de venta"), "18.50");

    await darDeAlta(user);

    const aviso = await screen.findByTestId("quick-saved");
    expect(aviso).toHaveTextContent("1 producto nuevo");
    expect(aviso).toHaveFocus();
  });

  /**
   * Carlos (2026-09-17): «el logo de escanear con la cámara no debe aparecer
   * en dispositivos como laptops, sólo en tablets y celulares».
   *
   * Se pregunta por la CAPACIDAD del puntero y no por el ancho de la ventana:
   * una laptop con la ventana angosta sigue siendo una laptop, y su cámara
   * apunta a la cara, no al anaquel.
   */
  it("la cámara se ofrece con el dedo como puntero, y no con el ratón", async () => {
    fingirAparato({ puntero: "grueso", ancho: false });
    await abrir();
    expect(await screen.findByTestId("scanner-de-camara")).toBeInTheDocument();
  });

  it("con ratón no aparece el botón de la cámara", async () => {
    fingirAparato({ puntero: "fino", ancho: true });
    await abrir();
    await waitFor(() => {
      expect(screen.queryByTestId("scanner-de-camara")).not.toBeInTheDocument();
    });
  });

  /**
   * Carlos (2026-09-17): «la columna Nombre del producto se ve muy pequeña en
   * celular». Agrandarla sola no alcanzaba — con cuatro columnas en 390 px la
   * tabla se desplaza de lado, y como el foco salta al precio tras cada
   * escaneo, el navegador arrastraba la vista hasta el precio y el nombre
   * desaparecía. Se veía UNA columna a la vez.
   */
  it("en pantalla angosta la línea se apila y no hay tabla que desplazar", async () => {
    fingirAparato({ puntero: "grueso", ancho: false });
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    // El nombre y el precio conviven sin desplazar nada.
    expect(screen.getByLabelText("Nombre del producto")).toBeVisible();
    expect(screen.getByLabelText("Precio de venta")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Y los `id` no se duplican: solo existe UNO de los dos diseños.
    expect(document.querySelectorAll("#quick-name-7501055300013")).toHaveLength(1);
  });

  it("en pantalla ancha sigue siendo la tabla de siempre", async () => {
    fingirAparato({ puntero: "fino", ancho: true });
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(document.querySelectorAll("#quick-name-7501055300013")).toHaveLength(1);
  });

  /**
   * Carlos eligió detectar el lector (2026-09-17) sobre dejar el foco quieto o
   * aceptar la pérdida: al escanear, el foco va al precio, y si en vez de
   * teclearlo se pasa la pistola por el siguiente producto, ese código entraba
   * EN EL PRECIO. Con un lector de mano pasa seguido.
   */
  it("el lector dispara aunque el cursor esté en el precio, y el precio no se ensucia", async () => {
    const reloj = { ahora: 1_000 };
    vi.spyOn(Date, "now").mockImplementation(() => reloj.ahora);
    mocked.lookupBarcode
      .mockResolvedValueOnce(enCatalogoGlobal("7501055300013", "Primero"))
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");

    const precio = screen.getByLabelText("Precio de venta") as HTMLInputElement;
    await user.click(precio);
    fireEvent.input(precio, { target: { value: "18.50" } });

    // La pistola dispara sobre el campo de precio: sin pausas de persona.
    teclearComo(precio, "7509999000006", 8, reloj);

    expect(await screen.findByDisplayValue("Segundo")).toBeInTheDocument();
    // Y el precio que ya estaba escrito vuelve intacto.
    expect(screen.getAllByLabelText("Precio de venta")[1]).toHaveValue("18.50");
  });

  it("una persona tecleando los mismos dígitos en el precio NO crea una línea", async () => {
    const reloj = { ahora: 1_000 };
    vi.spyOn(Date, "now").mockImplementation(() => reloj.ahora);
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Primero"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");

    const precio = screen.getByLabelText("Precio de venta") as HTMLInputElement;
    await user.click(precio);

    // Los mismos dígitos, con pausas de persona: es un precio, no un escaneo.
    teclearComo(precio, "7509999000006", 120, reloj);

    expect(mocked.lookupBarcode).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("Segundo")).not.toBeInTheDocument();
    expect(precio).toHaveValue("7509999000006");
  });

  it("una ráfaga que NO es un código de barras se deja pasar tal cual", async () => {
    const reloj = { ahora: 1_000 };
    vi.spyOn(Date, "now").mockImplementation(() => reloj.ahora);
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Primero"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");

    const nombre = screen.getByLabelText("Nombre del producto") as HTMLInputElement;
    await user.click(nombre);
    fireEvent.input(nombre, { target: { value: "" } });
    // Rápido, pero no es un código: son letras.
    teclearComo(nombre, "Refresco", 8, reloj);

    expect(mocked.lookupBarcode).toHaveBeenCalledTimes(1);
    expect(nombre).toHaveValue("Refresco");
  });

  it("quitar una línea la saca del borrador", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: /Quitar la línea/ }));

    expect(screen.queryByDisplayValue("Refresco 600 ml")).not.toBeInTheDocument();
  });
});
