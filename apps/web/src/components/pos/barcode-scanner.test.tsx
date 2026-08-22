import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
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
const decodeFromStream = vi.fn();
/** Con qué se CONSTRUYÓ el lector: hints y opciones. Ver los tests de config. */
const construidoCon = vi.fn();

/**
 * El stream falso. El TRACK es el personaje importante: es lo que el
 * componente configura (`applyConstraints`) y vigila (`ended`) — ver los tests
 * de la lente Samsung, abajo.
 */
const track = {
  applyConstraints: vi.fn(),
  stop: vi.fn(),
  addEventListener: vi.fn(),
};
const streamFalso = { getVideoTracks: () => [track], getTracks: () => [track] };
const getUserMedia = vi.fn();

vi.mock("@zxing/browser", () => ({
  // El lector 1D, no el multiformato: una tienda escanea EAN/UPC/Code-128, y
  // probar QR, Aztec, PDF417 y DataMatrix en cada ciclo gasta el presupuesto
  // del intento en formatos que nadie va a presentar en una caja.
  BrowserMultiFormatOneDReader: class {
    constructor(hints: unknown, opciones: unknown) {
      construidoCon(hints, opciones);
    }
    decodeFromStream = decodeFromStream;
  },
}));

/**
 * Los argumentos de la primera llamada a un mock, exigiendo que exista.
 *
 * `mock.calls[0]` es `undefined` cuando nadie llamó, y encadenar sobre eso da
 * un TypeError que no explica nada. Acá el fallo NOMBRA el problema.
 */
function primeraLlamada(mock: { mock: { calls: unknown[][] } }, quien: string): unknown[] {
  const args = mock.mock.calls[0];
  if (args === undefined) {
    throw new Error(`${quien} nunca se llamó`);
  }
  return args;
}

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
    track.applyConstraints.mockResolvedValue(undefined);
    getUserMedia.mockResolvedValue(streamFalso);
    decodeFromStream.mockResolvedValue({ stop });
    // jsdom no trae `mediaDevices`: se instala el nuestro.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
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

    await waitFor(() => expect(decodeFromStream).toHaveBeenCalledTimes(1));
    // Se le da tiempo a cualquier re-render de hacer daño.
    await new Promise((r) => setTimeout(r, 50));
    expect(stop).not.toHaveBeenCalled();
  });

  it("la cámara se enciende UNA sola vez, no en cada repintado", async () => {
    renderScanner();

    await encender();

    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // Arrancarla dos veces deja un stream huérfano con la luz de la cámara
    // encendida y sin nadie que la apague.
    expect(decodeFromStream).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /Dejar de escanear/ }));

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  /**
   * Un acierto apaga la cámara: dejarla leyendo dispararía el mismo código en
   * el cuadro siguiente y el carrito sumaría dos.
   */
  it("un código leído apaga la cámara y lo entrega UNA vez", async () => {
    const onScan = vi.fn();
    decodeFromStream.mockImplementation((_stream, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  /**
   * ── LO QUE HACÍA QUE NO LEYERA NADA (2026-08-22) ──────────────────────
   *
   * Carlos: «ya muestra la imagen pero no detecta el código de barras». La
   * cámara estaba bien; la configuración del lector no. Medido en la fuente de
   * `@zxing/browser@0.2.1`, tres defectos que se suman:
   *
   *  1. `decodeFromVideoDevice(undefined, …)` arma `{ video: { facingMode:
   *     'environment' } }` y NADA MÁS. Sin `width`/`height` el navegador
   *     entrega su default —típicamente 640×480—. Un UPC-A son 95 módulos: a
   *     640 px de ancho, ocupando media pantalla, quedan ~3 px por barra. Al
   *     filo de lo decodificable, y cualquier temblor lo tira abajo.
   *  2. `delayBetweenScanAttempts` vale **500 ms** por defecto: DOS intentos
   *     por segundo. Hay que aguantar el pulso como en una foto larga.
   *  3. Sin `TRY_HARDER`, `OneDReader.doDecode` mira **25 filas** alrededor del
   *     centro (`maxLines = 25`) y no rota la imagen. Con el hint puesto mira
   *     el alto completo y reintenta a 90°.
   *
   * Ninguno de los tres se ve leyendo el componente: son defaults de la
   * librería. Por eso se fijan acá.
   */
  describe("configuración del lector (por qué no leía nada)", () => {
    /**
     * ── LA LENTE EQUIVOCADA DE LOS SAMSUNG (2026-08-22, tercera del día) ──
     *
     * Carlos, desde su Samsung: la cámara ARRANCA (el punto verde de Android
     * aparece) y el cuadro sigue negro. Es un problema documentado de los
     * teléfonos con varias cámaras traseras: cuando `getUserMedia` recibe
     * `facingMode` JUNTO con una resolución, Chrome a veces resuelve el
     * pedido eligiendo una lente auxiliar (macro, profundidad) que entrega
     * CUADROS NEGROS. La resolución no puede participar en la ELECCIÓN del
     * dispositivo — por eso son dos pasos, y estos dos tests fijan cada uno.
     */
    it("pide la cámara trasera SIN meter la resolución en la elección", async () => {
      renderScanner();

      await encender();

      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      const restricciones = primeraLlamada(getUserMedia, "getUserMedia")[0] as {
        video: { facingMode?: string; width?: unknown; height?: unknown };
      };
      expect(restricciones.video.facingMode).toBe("environment");
      expect(restricciones.video.width).toBeUndefined();
      expect(restricciones.video.height).toBeUndefined();
    });

    it("sube la resolución DESPUÉS, sobre la lente ya elegida", async () => {
      renderScanner();

      await encender();

      // `applyConstraints` sobre el track NO cambia de dispositivo: sube la
      // resolución de la lente buena en vez de arriesgar la elección.
      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalled());
      const pedido = primeraLlamada(track.applyConstraints, "applyConstraints")[0] as {
        width: { ideal: number };
        height: { ideal: number };
      };
      // `ideal` y no `exact`: una cámara que no llega se queda en lo que da.
      expect(pedido.width.ideal).toBeGreaterThanOrEqual(1280);
      expect(pedido.height.ideal).toBeGreaterThanOrEqual(720);
    });

    it("si la cámara muere sola, se dice — no se deja el cuadro negro", async () => {
      renderScanner();

      await encender();

      // El componente tiene que VIGILAR el track: si otra app toma la cámara
      // o el sistema la corta, el stream muere sin excepción y sin aviso —
      // exactamente el cuadro negro mudo que no se puede diagnosticar.
      await waitFor(() => expect(track.addEventListener).toHaveBeenCalled());
      const suscripcion = track.addEventListener.mock.calls.find((c) => c[0] === "ended");
      if (suscripcion === undefined) {
        throw new Error("nadie vigila el evento 'ended' del track");
      }
      act(() => (suscripcion[1] as () => void)());
      expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();
    });

    it("intenta MUCHO más de dos veces por segundo", async () => {
      renderScanner();

      await encender();

      await waitFor(() => expect(construidoCon).toHaveBeenCalled());
      const opciones = primeraLlamada(construidoCon, "el constructor del lector")[1] as {
        delayBetweenScanAttempts: number;
      };
      expect(opciones.delayBetweenScanAttempts).toBeLessThanOrEqual(150);
    });

    /**
     * ── TRY_HARDER MATA EL ESCÁNER (2026-08-22, medido con A/B en navegador
     * real contra producción) ──────────────────────────────────────────────
     *
     * Este test es el INVERSO del que vivía acá: el hint que un arreglo
     * anterior pidió para «mirar la imagen entera». Medido con cámara falsa y
     * el chunk desplegado: con TRY_HARDER, el PRIMER cuadro sin código lanza
     * `Error: Could not create a Canvas element.` (el camino de rotación de
     * `@zxing/browser@0.2.1` está roto) y zxing, ante un error que no es
     * NotFound, MATA el stream él solo — track `ended` a los ~700 ms, cuadro
     * negro, sin excepción hacia afuera. Sin el hint: NotFoundException
     * continuo (lo normal mientras no hay código) y el track sigue `live`.
     *
     * 3 === DecodeHintType.TRY_HARDER de `@zxing/library`.
     */
    it("NO pide TRY_HARDER: su camino de rotación revienta y zxing mata el stream", async () => {
      renderScanner();

      await encender();

      await waitFor(() => expect(construidoCon).toHaveBeenCalled());
      const hints = primeraLlamada(construidoCon, "el constructor del lector")[0] as
        | Map<number, unknown>
        | undefined;
      expect(hints?.get(3)).toBeUndefined();
    });

    it("si la librería suelta el video por un error interno, también se dice", async () => {
      renderScanner();

      await encender();

      // `track.stop()` programático NO dispara "ended" (solo las muertes de
      // origen físico lo hacen), así que la vigilancia del track no ve cuando
      // zxing se auto-destruye. Lo que sí se ve: al soltar el stream pone
      // `srcObject = null`, y eso dispara "emptied" en el <video>.
      await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      const video = document.querySelector("video");
      if (video === null) {
        throw new Error("sin <video>");
      }
      act(() => {
        video.dispatchEvent(new Event("emptied"));
      });
      expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();
    });
  });

  /**
   * ── LA SEGUNDA PANTALLA NEGRA (2026-08-22, mismo día) — barrera de FUENTE ──
   *
   * Con el lector ya bien configurado, la cámara volvió a quedar negra y esta
   * vez SIN pedir permisos. La carrera: el `<video>` se montaba con la FASE,
   * que se enciende dentro del efecto — pero el efecto corre tras el commit en
   * el que la fase todavía era "apagado", así que `videoRef.current` era null
   * cuando el `await import("@zxing/browser")` resolvía desde caché (un
   * microtask le gana al re-render de React, que es una tarea del scheduler).
   * El código hacía `return` MUDO: ni getUserMedia, ni permisos, ni error.
   *
   * Por qué funcionó en la primera prueba de Carlos y murió en la segunda: la
   * primera vez el import descargaba el chunk POR RED y React alcanzaba a
   * repintar; con el módulo en caché, la carrera se pierde siempre.
   *
   * Los tests de arriba no pueden verla: dentro de `act` los renders se
   * aplanan antes de drenar los microtasks, así que el video siempre llega a
   * tiempo. Lo que sí se fija es el CONTRATO que la hace imposible: el
   * `<video>` se monta con la INTENCIÓN (`encendida`) — React asigna los refs
   * en el commit y corre los efectos DESPUÉS, así que con ese gate el ref
   * existe siempre que el efecto corra, gane quien gane la carrera del import.
   * Mismo molde que `menu-desplazable.test.ts`: test de fuente para lo que el
   * runtime del test no puede medir.
   */
  it("el <video> se monta con la INTENCIÓN, no con la fase (contrato de fuente)", () => {
    const fuente = readFileSync(join(__dirname, "barcode-scanner.tsx"), "utf8");
    // Anclado en `ref={videoRef}` y no en `<video`: los comentarios del
    // archivo también dicen "<video" y la primera versión de esta barrera
    // midió uno de ellos — la lección del `<nav>` del 2026-08-22, otra vez.
    const idxVideo = fuente.indexOf("ref={videoRef}");
    expect(idxVideo).toBeGreaterThan(-1);

    // La guardia JSX más cercana que envuelve al <video>: `{… && (`.
    const cierreGuardia = fuente.lastIndexOf("&& (", idxVideo);
    const guardia = fuente.slice(fuente.lastIndexOf("{", cierreGuardia), cierreGuardia);

    expect(guardia).toContain("encendida");
    // Ni la fase ni su alias `estado`: cualquiera de los dos revive la carrera.
    expect(guardia).not.toMatch(/fase|estado/);
  });

  it("si la cámara falla, lo dice y no deja la pantalla muda", async () => {
    decodeFromStream.mockRejectedValue(new Error("NotAllowedError"));
    renderScanner();

    await encender();

    expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();
    // Y el stream que ya se había pedido se APAGA: sin esto, la luz de la
    // cámara queda prendida sin que ninguna pantalla la muestre.
    expect(track.stop).toHaveBeenCalled();
  });
});
