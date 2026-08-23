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
  getCapabilities: vi.fn(),
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

/**
 * Instala un `BarcodeDetector` falso en `window`. Por defecto NO existe: la
 * mayoría de los tests ejercitan el camino zxing, que es el fallback
 * universal; el nativo se instala solo donde se prueba.
 */
function instalarDetectorNativo(detect: ReturnType<typeof vi.fn>) {
  class DetectorFalso {
    static getSupportedFormats = vi.fn().mockResolvedValue(["ean_13", "upc_a", "code_128"]);
    detect = detect;
  }
  Object.defineProperty(window, "BarcodeDetector", { value: DetectorFalso, configurable: true });
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
    // Una lente de teléfono típica: sabe enfocar de continuo y hacer zoom.
    track.getCapabilities.mockReturnValue({ focusMode: ["continuous"], zoom: { min: 1, max: 8 } });
    getUserMedia.mockResolvedValue(streamFalso);
    decodeFromStream.mockResolvedValue({ stop });
    // jsdom no trae `mediaDevices`: se instala el nuestro.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Reflect.deleteProperty(window, "BarcodeDetector");
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

  it("el video es una FRANJA, no una pantalla completa", async () => {
    renderScanner();

    await encender();

    const video = await waitFor(() => {
      const v = document.querySelector("video");
      if (v === null) throw new Error("sin <video>");
      return v;
    });
    // Petición de Carlos (2026-08-23), con el escaneo ya funcionando: el
    // recuadro a pantalla casi completa estorba. Una franja de ~190 px al
    // estilo escáner de paquetería alcanza — para leer no hace falta ver la
    // escena, hace falta ver la línea y el código sobre ella. `object-cover`
    // recorta solo lo VISUAL (simétrico, el centro queda donde la línea): el
    // detector sigue recibiendo el cuadro completo de la cámara.
    expect(video.className).toContain("h-48");
    expect(video.className).toContain("object-cover");
  });

  it("al parar, sí se apaga", async () => {
    renderScanner();
    await encender();
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /Dejar de escanear/ }));

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  /**
   * ── MODO CONTINUO (2026-08-23, pedido de Carlos) ──────────────────────
   *
   * «Al activar el escaneo no la quites, para poder seguir escaneando hasta
   * elegir dejar de escanear.» La cámara ya NO se apaga con cada acierto: un
   * mostrador escanea artículo tras artículo. Lo que evita el doble cobro es
   * el ENFRIAMIENTO: el mismo código no se entrega dos veces dentro de la
   * ventana — pero dos códigos DISTINTOS seguidos sí, y el mismo código tras
   * la ventana también (tres unidades iguales son tres entregas legítimas).
   */
  it("un código leído se entrega y la cámara SIGUE encendida", async () => {
    const onScan = vi.fn();
    decodeFromStream.mockImplementation((_stream, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Dejar de escanear/ })).toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeNull();
  });

  it("el MISMO código en cuadros seguidos se entrega UNA vez (enfriamiento)", async () => {
    const onScan = vi.fn();
    decodeFromStream.mockImplementation((_stream, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      setTimeout(() => callback({ getText: () => "7501234567890" }), 60);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 150));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("códigos DISTINTOS seguidos se entregan los dos", async () => {
    const onScan = vi.fn();
    decodeFromStream.mockImplementation((_stream, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      setTimeout(() => callback({ getText: () => "064042603179" }), 60);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    expect(onScan).toHaveBeenNthCalledWith(1, "7501234567890");
    expect(onScan).toHaveBeenNthCalledWith(2, "064042603179");
  });

  it("el mismo código VUELVE a entregarse pasado el enfriamiento", async () => {
    const onScan = vi.fn();
    decodeFromStream.mockImplementation((_stream, _video, callback) => {
      setTimeout(() => callback({ getText: () => "7501234567890" }), 10);
      // Tres unidades iguales son tres entregas legítimas: la ventana solo
      // filtra los cuadros consecutivos de UNA misma pasada.
      setTimeout(() => callback({ getText: () => "7501234567890" }), 1700);
      return Promise.resolve({ stop });
    });
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2), { timeout: 3000 });
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

    /**
     * ── POR QUÉ LA CÁMARA NATIVA VE MEJOR (2026-08-22, reporte de Carlos) ──
     *
     * Con la cámara ya viva, el código seguía sin leerse: «si acerco el código
     * se desenfoca, y si lo alejo no lo reconoce». Exacto: `getUserMedia`
     * entrega la lente con el enfoque que caiga — la app nativa hace autofoco
     * CONTINUO gratis — y sin zoom, la distancia donde el enfoque trabaja
     * deja el código en un puñado de píxeles. El remedio estándar de los
     * escáneres: enfoque continuo + zoom 2×, pedidos SOLO si la lente declara
     * saberlos hacer, cada uno en su propio set de `advanced` para que el
     * navegador aplique los que pueda e ignore el resto.
     */
    it("pide enfoque continuo y zoom cuando la lente sabe hacerlos", async () => {
      renderScanner();

      await encender();

      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(2));
      const avanzado = track.applyConstraints.mock.calls[1]?.[0] as {
        advanced: Record<string, unknown>[];
      };
      expect(avanzado.advanced).toContainEqual({ focusMode: "continuous" });
      expect(avanzado.advanced).toContainEqual({ zoom: 2 });
    });

    it("una cámara sin enfoque ni zoom no recibe pedidos que no entiende", async () => {
      // Una webcam de escritorio: sin capacidades anunciadas. Pedirle zoom
      // igual sería apostar a que ignora lo que no entiende — mejor no pedir.
      track.getCapabilities.mockReturnValue({});
      renderScanner();

      await encender();

      await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    });

    /**
     * ── LA GUÍA Y EL ZOOM MANUAL (2026-08-22, sexta ronda) ────────────────
     *
     * Con la cámara viva, enfocando y a 2×, Carlos seguía sin poder leer — y
     * su captura mostró el código en el TERCIO INFERIOR de la imagen: el
     * lector 1D barre las filas del CENTRO, así que ahí no había nada que
     * leer. La guía existe para que el código se coloque donde el lector
     * mira. Y el zoom pasa a ser del usuario: botones hasta donde la lente
     * declare llegar — que además diagnostican: si no aparecen, la lente no
     * expone zoom vía web.
     */
    it("pinta la guía de centrado sobre el video", async () => {
      renderScanner();

      await encender();

      const guia = await screen.findByTestId("scan-guide");
      // `pointer-events-none`: la guía es un dibujo, no puede robarle los
      // toques al video ni a los botones de zoom.
      expect(guia.className).toContain("pointer-events-none");
      expect(screen.getByText(/línea/i)).toBeInTheDocument();
    });

    it("ofrece los niveles de zoom que la lente declara y aplica el elegido", async () => {
      renderScanner();

      await encender();

      // tope 8 → 1×, 2× y 5× disponibles.
      const boton5 = await screen.findByRole("button", { name: "5×" });
      await userEvent.click(boton5);

      await waitFor(() => {
        const pedidos = track.applyConstraints.mock.calls.map((c) => c[0]);
        expect(pedidos).toContainEqual({ advanced: [{ zoom: 5 }] });
      });
    });

    it("una lente sin zoom no muestra botones de zoom", async () => {
      track.getCapabilities.mockReturnValue({});
      renderScanner();

      await encender();

      await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("button", { name: "2×" })).not.toBeInTheDocument();
    });

    /**
     * ── EL DETECTOR NATIVO PRIMERO (2026-08-23) ───────────────────────────
     *
     * Las capturas de Carlos a 1×/2×/5× dejaron una sola variable viva: el
     * ENFOQUE. zxing necesita nitidez a nivel de barra; el `BarcodeDetector`
     * de Chrome Android es ML Kit por debajo y tolera desenfoque, rotación y
     * poca luz muchísimo mejor. Cuando existe, se usa; zxing queda como
     * fallback universal — y de paso el camino nativo NI DESCARGA zxing.
     */
    it("prefiere el detector NATIVO del navegador cuando existe", async () => {
      const detect = vi.fn().mockResolvedValue([{ rawValue: "7501234567890" }]);
      instalarDetectorNativo(detect);
      const onScan = renderScanner();

      await encender();

      await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(decodeFromStream).not.toHaveBeenCalled();
    });

    it("ofrece linterna cuando la lente la declara, y la enciende", async () => {
      track.getCapabilities.mockReturnValue({
        focusMode: ["continuous"],
        zoom: { min: 1, max: 8 },
        torch: true,
      });
      renderScanner();

      await encender();

      // Más luz ataca el desenfoque por dos vías: profundidad de campo y
      // obturación corta. Solo se ofrece si la lente lo declara.
      const boton = await screen.findByRole("button", { name: /linterna|flashlight/i });
      await userEvent.click(boton);

      await waitFor(() => {
        const pedidos = track.applyConstraints.mock.calls.map((c) => c[0]);
        expect(pedidos).toContainEqual({ advanced: [{ torch: true }] });
      });
    });

    it("sin torch en la lente, no hay botón de linterna", async () => {
      renderScanner();

      await encender();

      await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
      expect(
        screen.queryByRole("button", { name: /linterna|flashlight/i }),
      ).not.toBeInTheDocument();
    });

    it("fija el enfoque CERCA cuando la lente permite enfoque manual", async () => {
      track.getCapabilities.mockReturnValue({
        focusMode: ["continuous", "manual"],
        focusDistance: { min: 0.1, max: 10 },
        zoom: { min: 1, max: 8 },
      });
      renderScanner();

      await encender();

      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(2));
      const avanzado = track.applyConstraints.mock.calls[1]?.[0] as {
        advanced: Record<string, unknown>[];
      };
      // Lo que hace un escáner dedicado: foco FIJO a distancia de mostrador.
      // El continuo de este teléfono nunca clavó la caja (capturas del 22).
      expect(avanzado.advanced).toContainEqual({ focusMode: "manual", focusDistance: 0.15 });
      // Y no se pide el continuo A LA VEZ: dos jefes para el mismo motor.
      expect(avanzado.advanced).not.toContainEqual({ focusMode: "continuous" });
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

  /**
   * ── EL BOTÓN DE MOSTRADOR (2026-08-23, pedido de Carlos) ──────────────
   *
   * Icono grande y con color; la leyenda al lado, chica y gris, como
   * instrucción. En una caja el cajero no lee: reconoce. El icono carga el
   * significado (cámara = escanear, cámara tachada = parar) y el texto
   * acompaña — pero el NOMBRE ACCESIBLE sigue siendo la leyenda, porque un
   * botón que solo dice «svg» no existe para quien usa lector de pantalla.
   */
  describe("el botón de escaneo (diseño de mostrador)", () => {
    const botonEscaneo = () => screen.getByRole("button", { name: /Escanear con la cámara/ });

    it("es un icono con nombre accesible, no un botón de texto", () => {
      renderScanner();

      const boton = botonEscaneo();
      expect(boton.querySelector("svg")).not.toBeNull();
      // El texto NO va adentro del botón: va al lado, como leyenda.
      expect(boton.textContent?.trim()).toBe("");
    });

    it("la leyenda vive al lado, chica y gris", () => {
      renderScanner();

      const leyenda = screen.getByTestId("scan-legend");
      expect(leyenda).toHaveTextContent("Escanear con la cámara");
      expect(leyenda.className).toContain("text-muted-foreground");
      // Fuera del botón: es instrucción, no la etiqueta clickeable.
      expect(botonEscaneo().contains(leyenda)).toBe(false);
    });

    it("apagado es VERDE; encendido es rojo tenue", async () => {
      renderScanner();

      expect(botonEscaneo().className).toContain("bg-success");

      await encender();

      const parar = screen.getByRole("button", { name: /Dejar de escanear/ });
      // La variante `destructive` del sistema: rojo ENTINTADO, no sólido —
      // el rojo sólido ya significa error en esta app y competiría con las
      // alarmas de verdad.
      expect(parar.dataset.variant).toBe("destructive");
      expect(parar.className).not.toContain("bg-success");
    });

    it("el área táctil es de dedo, no de ratón", () => {
      renderScanner();

      // 48 px es el mínimo de un objetivo táctil. `size-8` (32) es de ratón.
      expect(botonEscaneo().className).toContain("size-12");
    });
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
