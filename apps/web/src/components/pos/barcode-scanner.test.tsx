import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { BarcodeScanner } from "./barcode-scanner";

/**
 * F4-CART-04 — el escáner de cámara.
 *
 * **Por qué este archivo existe (2026-08-22):** Carlos reportó que la cámara
 * se veía negra — «quiso mostrar la imagen por un milisegundo y se quedó
 * negra». No era el permiso: el efecto se apagaba solo. `estado` estaba en las
 * dependencias del `useEffect` y adentro se llamaba `setEstado("leyendo")`, así
 * que React corría el CLEANUP en esa transición y el cleanup hacía `stop()`.
 * Encendía, pintaba un cuadro y moría.
 *
 * El test de `pos-cart.test.tsx` no podía verlo: en jsdom no hay cámara, así
 * que ese camino siempre caía en «sin cámara» y el arranque exitoso nunca se
 * ejercitaba. Acá se simula `@zxing/browser` para poder recorrerlo.
 */

const stop = vi.fn();
const decodeFromVideoDevice = vi.fn();

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoDevice = decodeFromVideoDevice;
  },
}));

function renderScanner(onScan = vi.fn()) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <BarcodeScanner onScan={onScan} />
    </I18nextProvider>,
  );
  return onScan;
}

const encender = () => userEvent.click(screen.getByRole("button", { name: /Escanear/ }));

describe("BarcodeScanner (F4-CART-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La cámara arranca bien y queda leyendo: el callback no se dispara solo.
    decodeFromVideoDevice.mockResolvedValue({ stop });
  });

  /**
   * ⚠ EL BUG DE LA PANTALLA NEGRA. Si algo llama a `stop()` después de un
   * arranque exitoso, la cámara se apaga y el `<video>` queda en negro. Nadie
   * lo pidió: era el cleanup del efecto disparándose por un cambio de estado
   * interno.
   */
  it("tras encender, NADIE apaga la cámara", async () => {
    renderScanner();

    await encender();

    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledTimes(1));
    // Se le da tiempo a cualquier re-render de hacer daño.
    await new Promise((r) => setTimeout(r, 50));
    expect(stop).not.toHaveBeenCalled();
  });

  it("la cámara se enciende UNA sola vez, no en cada repintado", async () => {
    renderScanner();

    await encender();

    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // Arrancarla dos veces deja un stream huérfano con la luz de la cámara
    // encendida y sin nadie que la apague.
    expect(decodeFromVideoDevice).toHaveBeenCalledTimes(1);
  });

  it("el <video> se pinta y puede reproducirse solo", async () => {
    renderScanner();

    await encender();

    const video = await waitFor(() => {
      const v = document.querySelector("video");
      if (v === null) throw new Error("sin <video>");
      return v;
    });
    // `autoplay` + `muted` + `playsinline`: sin los tres, un navegador móvil
    // adjunta el stream y NO lo reproduce — la misma pantalla negra por otra
    // causa.
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it("al parar, sí se apaga", async () => {
    renderScanner();
    await encender();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /Dejar de escanear/ }));

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  /**
   * Un acierto apaga la cámara: dejarla leyendo dispararía el mismo código en
   * el cuadro siguiente y el carrito sumaría dos.
   */
  it("un código leído apaga la cámara y lo entrega UNA vez", async () => {
    const onScan = vi.fn();
    decodeFromVideoDevice.mockImplementation((_dispositivo, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it("si la cámara falla, lo dice y no deja la pantalla muda", async () => {
    decodeFromVideoDevice.mockRejectedValue(new Error("NotAllowedError"));
    renderScanner();

    await encender();

    expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();
  });
});
