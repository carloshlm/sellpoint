import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { CartSearch } from "./cart-search";

/**
 * F10-MANFIX-16 — la ayuda del buscador del punto de venta.
 *
 * Un `placeholder` no se parte en renglones: la ayuda completa se cortaba en
 * el celular («Escanea, teclea el código, el nombre o un») y también en una
 * tableta con el menú abierto, donde el buscador ocupa media pantalla. Si no
 * cabe, va la corta, que sí se lee entera. Lo decide el ancho del CAMPO,
 * medido, no el de la pantalla.
 *
 * jsdom no calcula anchos ni tiene lienzo para medir texto: acá se finge el
 * ancho del campo y se mide a 9 px por letra. Cómo se ve de verdad se revisa
 * en el navegador.
 */
vi.mock("@/components/pos/barcode-scanner", () => ({ BarcodeScanner: () => null }));

const COMPLETA = "Escanea, teclea el código, el nombre o un folio COT-…";
const CORTA = "Código, nombre o folio COT-…";

/** El campo mide `ancho` px por dentro, y cada letra, 9. */
function fingirCampo(ancho: number) {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(ancho);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (texto: string) => ({ width: texto.length * 9 }),
  } as never);
}

function renderBuscador() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n()}>
        <CartSearch />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole("textbox", { name: "Buscar" });
}

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
});

describe("la ayuda del buscador (F10-MANFIX-16)", () => {
  it("en un campo angosto, como el de un celular, va la ayuda corta, entera", () => {
    // Un celular de 375 px deja unos 325 para el texto: la completa pide 477.
    fingirCampo(325);

    expect(renderBuscador()).toHaveAttribute("placeholder", CORTA);
  });

  it("si la completa cabe, se queda la completa", () => {
    fingirCampo(600);

    expect(renderBuscador()).toHaveAttribute("placeholder", COMPLETA);
  });

  it("sin forma de medir (un campo oculto), se queda la completa", () => {
    // Sin fingir nada: jsdom dice que el campo mide 0.
    expect(renderBuscador()).toHaveAttribute("placeholder", COMPLETA);
  });
});

/**
 * Carlos (2026-11-16): «el folío no lo define el idioma del usuario sino el
 * idioma principal de un país». Un negocio en Estados Unidos cotiza con `QTE`,
 * y la ayuda se lo dice aunque quien vende use la app en español.
 */
describe("la ayuda muestra el prefijo de cotización del negocio", () => {
  it("un negocio que numera en inglés ve QTE-", () => {
    useAuthStore.setState({
      accessToken: "token",
      user: buildAuthUser({ tenant: buildTenantBlock({ country: "US", folioLanguage: "en" }) }),
    });

    expect(renderBuscador()).toHaveAttribute(
      "placeholder",
      "Escanea, teclea el código, el nombre o un folio QTE-…",
    );
  });

  it("un negocio que numera en español sigue viendo COT-", () => {
    useAuthStore.setState({
      accessToken: "token",
      user: buildAuthUser({ tenant: buildTenantBlock({ folioLanguage: "es" }) }),
    });

    expect(renderBuscador()).toHaveAttribute("placeholder", COMPLETA);
  });
});
