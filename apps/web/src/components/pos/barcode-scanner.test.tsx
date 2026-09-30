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
 * ejercitaba. Acá se simulan la cámara y el detector para poder recorrerlo.
 *
 * Dos motores, un bucle (2026-09-30): el `BarcodeDetector` nativo cuando el
 * navegador lo trae, y si no, el mismo API por `barcode-detector` (zxing-cpp
 * en wasm). Por defecto NO hay nativo: la mayoría de los tests ejercitan el
 * respaldo, que es el camino del iPhone; el nativo se instala donde se prueba.
 */

/** El `detect` del respaldo wasm. Cada llamada es un intento del bucle. */
const detectPonyfill = vi.fn();
const prepareZXingModule = vi.fn();

/**
 * El stream falso. El TRACK es el personaje importante: es lo que el
 * componente configura (`applyConstraints`) y vigila (`ended`) — ver los tests
 * de la lente Samsung, abajo.
 */
const track = {
  applyConstraints: vi.fn(),
  getCapabilities: vi.fn(),
  getSettings: vi.fn(),
  stop: vi.fn(),
  addEventListener: vi.fn(),
};
const streamFalso = { getVideoTracks: () => [track], getTracks: () => [track] };
const getUserMedia = vi.fn();
/** Las cámaras que el aparato declara. Por defecto, ninguna lista: una sola lente. */
const enumerateDevices = vi.fn();

vi.mock("barcode-detector/ponyfill", () => ({
  BarcodeDetector: class {
    static getSupportedFormats = vi.fn().mockResolvedValue(["ean_13", "upc_a", "code_128"]);
    detect = detectPonyfill;
  },
  prepareZXingModule,
}));
// El .wasm que Vite empaqueta: en jsdom basta con que resuelva a una ruta.
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/zxing_reader.wasm" }));

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

/** Finge el puntero principal del aparato: jsdom no implementa `matchMedia`. */
function fingirPuntero(tipo: "grueso" | "fino") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (consulta: string) => ({
      matches: consulta.includes("pointer: coarse") ? tipo === "grueso" : tipo === "fino",
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

describe("BarcodeScanner (F4-CART-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La cámara arranca bien y queda leyendo: el callback no se dispara solo.
    track.applyConstraints.mockResolvedValue(undefined);
    // Una lente de teléfono típica: sabe enfocar de continuo y hacer zoom.
    track.getCapabilities.mockReturnValue({ focusMode: ["continuous"], zoom: { min: 1, max: 8 } });
    getUserMedia.mockResolvedValue(streamFalso);
    detectPonyfill.mockResolvedValue([]);
    // jsdom no trae `mediaDevices`: se instala el nuestro.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia, enumerateDevices },
      configurable: true,
    });
    enumerateDevices.mockResolvedValue([]);
    track.getSettings.mockReturnValue({ deviceId: "lente-a" });
    localStorage.clear();
    // Ni `matchMedia`. Estas pruebas son sobre un aparato que SÍ tiene la
    // cámara en la mano; sin esto, el componente no pinta nada y todas fallan
    // por la razón equivocada.
    fingirPuntero("grueso");
    Reflect.deleteProperty(window, "BarcodeDetector");
  });

  /**
   * ⚠ EL BUG DE LA PANTALLA NEGRA. Si algo llama a `stop()` después de un
   * arranque exitoso, la cámara se apaga y el `<video>` queda en negro. Nadie
   * lo pidió: era el cleanup del efecto disparándose por un cambio de estado
   * interno.
   */
  /**
   * Carlos (2026-09-17), primero en la Carga rápida y después en el mostrador:
   * «quita el botón de escanear con cámara para computadoras y sólo déjalo
   * para celulares». En una laptop la cámara apunta a la cara, no al anaquel.
   *
   * Se pregunta por la CAPACIDAD del puntero y no por el ancho de la ventana:
   * una laptop con la ventana angosta sigue siendo una laptop.
   */
  it("con el dedo como puntero se ofrece la cámara", () => {
    fingirPuntero("grueso");
    renderScanner();

    expect(screen.getByTestId("barcode-scanner")).toBeInTheDocument();
  });

  it("con ratón NO se pinta nada: ni el botón ni el aviso", () => {
    fingirPuntero("fino");
    renderScanner();

    expect(screen.queryByTestId("barcode-scanner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scanner-unavailable")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tras encender, NADIE apaga la cámara", async () => {
    renderScanner();

    await encender();

    await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
    // Se le da tiempo a cualquier re-render de hacer daño.
    await new Promise((r) => setTimeout(r, 50));
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("la cámara se enciende UNA sola vez, no en cada repintado", async () => {
    renderScanner();

    await encender();

    await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // Arrancarla dos veces deja un stream huérfano con la luz de la cámara
    // encendida y sin nadie que la apague.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
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
    // recorta solo lo VISUAL (simétrico, el centro queda donde la línea); al
    // detector se le da ese mismo recorte (ver «solo cuenta lo que se ve»).
    expect(video.className).toContain("h-48");
    expect(video.className).toContain("object-cover");
  });

  it("al parar, sí se apaga", async () => {
    renderScanner();
    await encender();
    await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /Dejar de escanear/ }));

    await waitFor(() => expect(track.stop).toHaveBeenCalled());
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
    detectPonyfill.mockResolvedValue([{ rawValue: "7501234567890" }]);
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
    expect(track.stop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Dejar de escanear/ })).toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeNull();
  });

  it("el MISMO código en cuadros seguidos se entrega UNA vez (enfriamiento)", async () => {
    const onScan = vi.fn();
    // El mismo código en TODOS los cuadros: una sola entrega.
    detectPonyfill.mockResolvedValue([{ rawValue: "7501234567890" }]);
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 150));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("códigos DISTINTOS seguidos se entregan los dos", async () => {
    const onScan = vi.fn();
    // Cada código se lee dos veces (sus votos) y después el otro.
    detectPonyfill
      .mockResolvedValueOnce([{ rawValue: "7501234567890" }])
      .mockResolvedValueOnce([{ rawValue: "7501234567890" }])
      .mockResolvedValueOnce([{ rawValue: "064042603179" }])
      .mockResolvedValueOnce([{ rawValue: "064042603179" }])
      .mockResolvedValue([]);
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    expect(onScan).toHaveBeenNthCalledWith(1, "7501234567890");
    expect(onScan).toHaveBeenNthCalledWith(2, "064042603179");
  });

  it("el mismo código VUELVE a entregarse pasado el enfriamiento", async () => {
    const onScan = vi.fn();
    // Tres unidades iguales son tres entregas legítimas: la ventana solo
    // filtra los cuadros consecutivos de UNA misma pasada. El código está a
    // la vista todo el tiempo: pasado el enfriamiento, vuelve a entregarse.
    detectPonyfill.mockResolvedValue([{ rawValue: "7501234567890" }]);
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  /**
   * Carlos, 2026-09-29: con el código a la vista, el detector NATIVO entregaba
   * lecturas VÁLIDAS pero equivocadas (721733000937, 721966444003… para un
   * 721733000968): ML Kit tolera tanto el desenfoque que a veces cuadra un
   * dígito verificador. Un código cuenta cuando se lee igual dos veces en la
   * ventana; una lectura borrosa distinta en medio no reinicia la cuenta.
   * zxing (iPhone) NO confirma: exigírselo lo dejó sin leer (2026-09-30).
   */
  it("el detector nativo entrega la lectura que se REPITE, no la borrosa", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce([{ rawValue: "721733000937" }])
      .mockResolvedValueOnce([{ rawValue: "721733000968" }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ rawValue: "721733000968" }]);
    instalarDetectorNativo(detect);
    const onScan = renderScanner();

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("721733000968"));
    expect(onScan).not.toHaveBeenCalledWith("721733000937");
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  /**
   * El iPhone (2026-09-30): Safari no trae `BarcodeDetector`, y zxing-js no
   * leía ni un UPC enorme y nítido. El respaldo es ahora el mismo API por
   * `barcode-detector` (zxing-cpp en wasm), con el .wasm del PROPIO bundle:
   * la CSP bloquea el CDN del que la librería lo bajaría por omisión.
   */
  it("sin detector nativo, el respaldo wasm lee por el mismo bucle y con el wasm propio", async () => {
    const onScan = vi.fn();
    detectPonyfill.mockResolvedValue([{ rawValue: "7501234567890" }]);
    renderScanner(onScan);

    await encender();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("7501234567890"));
    const opciones = prepareZXingModule.mock.calls[0]?.[0] as {
      overrides: { locateFile: (ruta: string, prefijo: string) => string };
    };
    expect(opciones.overrides.locateFile("zxing_reader.wasm", "https://cdn/")).toBe(
      "/zxing_reader.wasm",
    );
    expect(opciones.overrides.locateFile("otro.js", "https://cdn/")).toBe("https://cdn/otro.js");
  });

  /**
   * Carlos, 2026-09-29: un código DEBAJO del recuadro se leía. El video usa
   * `object-cover`: con la cámara vertical el recuadro muestra solo el tercio
   * central de la foto, y el detector nativo recibe la foto completa. Se
   * fingen las medidas de un teléfono: 1080×1920 en una franja de 360×192
   * (se ve de y=672 a y=1248).
   */
  describe("solo cuenta lo que se ve en el recuadro (detector nativo)", () => {
    const medidas = { videoWidth: 1080, videoHeight: 1920, clientWidth: 360, clientHeight: 192 };
    beforeEach(() => {
      for (const [prop, value] of Object.entries(medidas)) {
        Object.defineProperty(HTMLVideoElement.prototype, prop, { value, configurable: true });
      }
    });
    afterEach(() => {
      for (const prop of Object.keys(medidas)) {
        Reflect.deleteProperty(HTMLVideoElement.prototype, prop);
      }
    });

    it("un código debajo del recuadro NO se entrega, aunque esté en la foto", async () => {
      const detect = vi
        .fn()
        .mockResolvedValue([
          { rawValue: "721733000968", boundingBox: { x: 300, y: 1500, width: 480, height: 160 } },
        ]);
      instalarDetectorNativo(detect);
      const onScan = renderScanner();

      await encender();

      await waitFor(() => expect(detect.mock.calls.length).toBeGreaterThan(2));
      expect(onScan).not.toHaveBeenCalled();
    });

    it("el código sobre la línea sí se entrega (leído dos veces)", async () => {
      const detect = vi
        .fn()
        .mockResolvedValue([
          { rawValue: "721733000968", boundingBox: { x: 300, y: 900, width: 480, height: 160 } },
        ]);
      instalarDetectorNativo(detect);
      const onScan = renderScanner();

      await encender();

      await waitFor(() => expect(onScan).toHaveBeenCalledWith("721733000968"));
    });

    it("si en la foto hay uno fuera y otro dentro, se entrega el de dentro", async () => {
      const detect = vi.fn().mockResolvedValue([
        { rawValue: "9788353000038", boundingBox: { x: 300, y: 1500, width: 480, height: 160 } },
        { rawValue: "721733000968", boundingBox: { x: 300, y: 900, width: 480, height: 160 } },
      ]);
      instalarDetectorNativo(detect);
      const onScan = renderScanner();

      await encender();

      await waitFor(() => expect(onScan).toHaveBeenCalledWith("721733000968"));
      expect(onScan).not.toHaveBeenCalledWith("9788353000038");
    });

    /**
     * Cuando el navegador sabe recortar, el detector recibe SOLO el área
     * visible: un tercio de los píxeles, y ningún código de fuera. El bitmap
     * se cierra siempre — es memoria de la GPU.
     */
    it("si el navegador sabe recortar, el detector recibe el recorte y se cierra", async () => {
      const close = vi.fn();
      const bitmap = { close };
      const createImageBitmap = vi.fn().mockResolvedValue(bitmap);
      Object.defineProperty(window, "createImageBitmap", {
        value: createImageBitmap,
        configurable: true,
      });
      try {
        const detect = vi.fn().mockResolvedValue([{ rawValue: "721733000968" }]);
        instalarDetectorNativo(detect);
        const onScan = renderScanner();

        await encender();

        await waitFor(() => expect(onScan).toHaveBeenCalledWith("721733000968"));
        expect(createImageBitmap).toHaveBeenCalledWith(
          expect.any(HTMLVideoElement),
          0,
          672,
          1080,
          576,
        );
        expect(detect).toHaveBeenCalledWith(bitmap);
        expect(close).toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(window, "createImageBitmap");
      }
    });
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

      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
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

      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
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
      expect(detectPonyfill).not.toHaveBeenCalled();
      expect(prepareZXingModule).not.toHaveBeenCalled();
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

      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
      expect(
        screen.queryByRole("button", { name: /linterna|flashlight/i }),
      ).not.toBeInTheDocument();
    });

    it("prefiere el enfoque CONTINUO aunque la lente sepa enfoque manual", async () => {
      // Samsung S20 Ultra (Carlos, 2026-09-30): la cámara nativa enfoca de
      // continuo y se ve nítida; la app, clavada a 15 cm, se veía borrosa.
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
      expect(avanzado.advanced).toContainEqual({ focusMode: "continuous" });
      // Y no se pide el manual A LA VEZ: dos jefes para el mismo motor.
      expect(avanzado.advanced.some((a) => a.focusMode === "manual")).toBe(false);
    });

    it("sin enfoque continuo, fija el foco CERCA si la lente permite el manual", async () => {
      track.getCapabilities.mockReturnValue({
        focusMode: ["manual"],
        focusDistance: { min: 0.1, max: 10 },
        zoom: { min: 1, max: 8 },
      });
      renderScanner();

      await encender();

      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(2));
      const avanzado = track.applyConstraints.mock.calls[1]?.[0] as {
        advanced: Record<string, unknown>[];
      };
      expect(avanzado.advanced).toContainEqual({ focusMode: "manual", focusDistance: 0.15 });
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

    it("si algo suelta el video (srcObject = null), también se dice", async () => {
      renderScanner();

      await encender();

      // `track.stop()` programático NO dispara "ended" (solo las muertes de
      // origen físico lo hacen), así que la vigilancia del track no lo ve.
      // Lo que sí se ve: soltar el stream dispara "emptied" en el <video>.
      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
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

  /**
   * ── ELEGIR LA LENTE (Samsung S20 Ultra, 2026-09-30) ────────────────────
   *
   * Con «cámara trasera» a secas, Chrome eligió una lente que no enfoca a
   * distancia de mostrador: borroso en la app con el enfoque continuo puesto,
   * nítido en la cámara nativa. La web no puede pedir una lente por nombre;
   * sí puede listar las traseras y dejar cambiar hasta dar con la buena, y
   * recordarla en el aparato.
   */
  describe("cambiar de lente", () => {
    const camaras = [
      { kind: "videoinput", deviceId: "lente-a", label: "camera2 0, facing back", groupId: "" },
      { kind: "videoinput", deviceId: "lente-b", label: "camera2 2, facing back", groupId: "" },
      { kind: "videoinput", deviceId: "selfie", label: "camera2 1, facing front", groupId: "" },
    ];

    it("con más de una trasera ofrece cambiar; al cambiar pide la siguiente y la recuerda", async () => {
      enumerateDevices.mockResolvedValue(camaras);
      renderScanner();

      await encender();

      const boton = await screen.findByRole("button", { name: "Cambiar cámara" });
      await userEvent.click(boton);

      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      expect(getUserMedia.mock.calls[1]?.[0]).toEqual({
        video: { deviceId: { exact: "lente-b" } },
      });
      expect(localStorage.getItem("pos.scanner.deviceId")).toBe("lente-b");
      // La cámara anterior se apagó: no quedan dos streams vivos.
      expect(track.stop).toHaveBeenCalled();
    });

    it("la selfie no cuenta: solo se rota entre las traseras", async () => {
      enumerateDevices.mockResolvedValue(camaras);
      track.getSettings.mockReturnValue({ deviceId: "lente-b" });
      renderScanner();

      await encender();

      await userEvent.click(await screen.findByRole("button", { name: "Cambiar cámara" }));

      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      expect(getUserMedia.mock.calls[1]?.[0]).toEqual({
        video: { deviceId: { exact: "lente-a" } },
      });
    });

    it("con una sola lente no hay botón", async () => {
      enumerateDevices.mockResolvedValue([camaras[0]]);
      renderScanner();

      await encender();

      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Cambiar cámara" })).not.toBeInTheDocument();
    });

    it("la lente recordada se pide primero; si ya no existe, cae a la trasera y la olvida", async () => {
      localStorage.setItem("pos.scanner.deviceId", "lente-vieja");
      getUserMedia
        .mockRejectedValueOnce(new Error("OverconstrainedError"))
        .mockResolvedValue(streamFalso);
      renderScanner();

      await encender();

      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
        video: { deviceId: { exact: "lente-vieja" } },
      });
      expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ video: { facingMode: "environment" } });
      expect(localStorage.getItem("pos.scanner.deviceId")).toBeNull();
      await waitFor(() => expect(detectPonyfill).toHaveBeenCalled());
    });
  });

  it("si la cámara falla, lo dice y no deja la pantalla muda", async () => {
    // El detector revienta al construirse: ni nativo ni respaldo.
    detectPonyfill.mockRejectedValue(new Error("boom"));
    (prepareZXingModule as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("NotAllowedError");
    });
    renderScanner();

    await encender();

    expect(await screen.findByTestId("scanner-unavailable")).toBeInTheDocument();
    // Y el stream que ya se había pedido se APAGA: sin esto, la luz de la
    // cámara queda prendida sin que ninguna pantalla la muestre.
    expect(track.stop).toHaveBeenCalled();
  });
});
