import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * F4-CART-04 — el escáner de cámara.
 *
 * ── El escáner es un TECLADO RÁPIDO ─────────────────────────────────────
 *
 * Lo que decodifica la cámara entra por el mismo `BarcodeLookup` que lo que se
 * teclea: este componente no busca nada, solo produce texto y se lo entrega a
 * quien maneja el input principal. Que fuera "otro camino" sería tener dos
 * lugares donde se decide qué significa un código, y un día dirían cosas
 * distintas.
 *
 * ── Degrada con gracia ──────────────────────────────────────────────────
 *
 * Sin cámara, sin permiso, o en un navegador sin `mediaDevices`, el botón
 * explica qué pasó y **la búsqueda manual sigue viva**. Un mostrador no puede
 * quedarse sin vender porque alguien dijo que no a un diálogo del navegador.
 *
 * ── La carga es DIFERIDA ────────────────────────────────────────────────
 *
 * `@zxing/browser` se importa dentro del `useEffect`, no arriba. Es un
 * decodificador de imágenes y pesa; la mayoría de los turnos no abre la cámara
 * ni una vez, así que hacer que todos paguen su descarga al entrar al POS
 * sería cobrarles por algo que no usan.
 */

/**
 * ── POR QUÉ ESTA CONFIGURACIÓN, Y NO LOS DEFAULTS (2026-08-22) ────────────
 *
 * Carlos: «ya muestra la imagen pero no detecta el código de barras». La cámara
 * estaba bien; el lector venía con tres defaults que juntos lo volvían casi
 * inútil para una caja. Los tres, medidos en la fuente de `@zxing/browser`:
 *
 *  1. Sin `width`/`height` el navegador entrega lo que quiera — típicamente
 *     640×480. Un UPC-A son 95 módulos: a 640 px, ocupando media pantalla,
 *     quedan ~3 px por barra. Decodificable en teoría, y cualquier temblor o
 *     brillo lo tira abajo.
 *  2. `delayBetweenScanAttempts` vale 500 ms: DOS intentos por segundo. El
 *     cajero tiene que aguantar el pulso como en una foto larga.
 *  3. Sin `TRY_HARDER`, `OneDReader` mira 25 filas alrededor del centro y no
 *     rota la imagen. Con el hint mira el alto completo y reintenta a 90°.
 *
 * Nada de esto se ve leyendo el componente: son defaults de la librería. Por
 * eso `barcode-scanner.test.tsx` los fija uno por uno.
 */

/**
 * ── DOS PASOS, y no uno (2026-08-22, la lección Samsung) ──────────────────
 *
 * La cámara se pide SOLO con `facingMode`, y la resolución se sube DESPUÉS con
 * `applyConstraints` sobre el track ya elegido. No es estilo: en los teléfonos
 * con varias cámaras traseras (Samsung, sobre todo), pedir `facingMode` JUNTO
 * con una resolución hace que Chrome a veces elija una lente auxiliar — macro,
 * profundidad — que entrega CUADROS NEGROS con el stream perfectamente vivo.
 * Carlos lo vio: el punto verde de Android prendido y el recuadro negro. La
 * resolución NO puede participar en la ELECCIÓN del dispositivo.
 *
 * `applyConstraints` no cambia de dispositivo: sube la resolución de la lente
 * buena, y si no llega se queda en lo que dé. `ideal` y NUNCA `exact` por lo
 * mismo: peor que una imagen modesta es no tener ninguna.
 */
const CAMARA_TRASERA: MediaStreamConstraints = { video: { facingMode: "environment" } };
const RESOLUCION_IDEAL: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

/**
 * El truco estándar de los escáneres, reportado por Carlos con precisión: «si
 * acerco el código se desenfoca, y si lo alejo no lo reconoce». Con 2× la caja
 * se sostiene a la distancia donde el enfoque SÍ trabaja y el código igual
 * llena píxeles. Solo se pide si la lente declara llegar (capabilities).
 */
const ZOOM_ESCANER = 2;

/**
 * 100 ms ≈ 10 intentos por segundo. No es gratis —cada intento binariza el
 * cuadro y lo recorre— pero el lector 1D es barato comparado con el
 * multiformato, y el cuello de botella real es la mano del cajero.
 */
const OPCIONES_LECTOR = { delayBetweenScanAttempts: 100 };

/**
 * SIN hints — y en particular SIN `TRY_HARDER`, aunque un arreglo anterior lo
 * pidió a propósito. Medido el 2026-08-22 con A/B en un navegador real contra
 * el chunk desplegado: con el hint puesto, el PRIMER cuadro sin código lanza
 * `Error: Could not create a Canvas element.` — el camino de rotación de
 * `@zxing/browser@0.2.1` está roto — y zxing, ante un error que no es
 * NotFound, MATA el stream él solo, sin excepción hacia afuera: cámara
 * encendida ~700 ms y cuadro negro mudo, en cualquier dispositivo. Sin el
 * hint, el loop reporta NotFoundException (lo normal mientras no hay código) y
 * el track sigue vivo. El costo real de perderlo: el lector mira ~25 filas del
 * centro y no rota — el código se presenta horizontal, como en cualquier
 * escáner de mostrador. `barcode-scanner.test.tsx` fija su AUSENCIA.
 */

interface BarcodeScannerProps {
  /** Recibe el texto decodificado. El mismo que produciría el teclado. */
  onScan: (text: string) => void;
}

/**
 * Lo que se MUESTRA. Deliberadamente separado de la INTENCIÓN (`encendida`):
 * ver la nota del efecto, abajo.
 */
type Fase = "apagado" | "encendiendo" | "leyendo" | "sin-camara";

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const { t } = useTranslation();

  /**
   * ── La INTENCIÓN, y por qué está separada de la fase (2026-08-22) ──────
   *
   * `encendida` responde «¿el usuario quiere la cámara prendida?» y es la ÚNICA
   * dependencia del efecto. `fase` es lo que se pinta y cambia libremente sin
   * volver a disparar nada.
   *
   * Estaban fusionadas en un solo `estado`, y eso causaba **la pantalla negra**
   * que Carlos reportó: el efecto dependía de `estado`, adentro llamaba a
   * `setEstado("leyendo")`, y React ejecutaba el CLEANUP en esa transición —
   * cleanup que hace `stop()`. La cámara encendía, pintaba un cuadro y moría.
   *
   * La regla que se rompía: **un efecto no puede depender de un estado que él
   * mismo cambia**, porque cada cambio equivale a desmontarlo. Fijado por
   * `barcode-scanner.test.tsx`, que simula zxing para poder recorrer el
   * arranque exitoso (en jsdom no hay cámara y ese camino nunca se ejercitaba).
   *
   * Y la segunda lección, del mismo día: **lo que el efecto necesita en el DOM
   * se monta con la intención, no con la fase**. El `<video>` colgaba de la
   * fase y el efecto corría antes de que existiera — ver el comentario del
   * JSX. La fase queda solo para lo que se PINTA alrededor.
   */
  const [encendida, setEncendida] = useState(false);
  const [fase, setFase] = useState<Fase>("apagado");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlesRef = useRef<{ stop: () => void } | null>(null);

  // `onScan` en un ref y no en las dependencias: si el padre le pasa una
  // función nueva en cada render, incluirla reiniciaría la cámara sola.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!encendida) {
      return;
    }

    let cancelado = false;
    setFase("encendiendo");

    // Fuera del try para poder apagarlo en el catch: si algo falla DESPUÉS de
    // `getUserMedia`, el stream ya existe y la luz de la cámara está prendida.
    // Un fallo que deja la luz encendida sin imagen es el peor de los mundos.
    let stream: MediaStream | null = null;

    void (async () => {
      try {
        // Import diferido: ver la nota de arriba.
        const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        const lector = new BrowserMultiFormatOneDReader(undefined, OPCIONES_LECTOR);
        if (cancelado) {
          return;
        }
        const video = videoRef.current;
        if (video === null) {
          // Con el video montado por la intención esto es imposible; si algún
          // refactor lo vuelve posible, cae al catch y se muestra el aviso.
          // La versión anterior hacía `return` MUDO acá, y ese silencio fue la
          // segunda pantalla negra: ni getUserMedia, ni permisos, ni error.
          throw new Error("el <video> no estaba montado al arrancar el lector");
        }

        stream = await navigator.mediaDevices.getUserMedia(CAMARA_TRASERA);
        if (cancelado) {
          for (const t of stream.getTracks()) {
            t.stop();
          }
          return;
        }

        const [pista] = stream.getVideoTracks();
        // La resolución, sobre la lente YA elegida — ver `RESOLUCION_IDEAL`.
        // Si el modo no existe, se queda como está: no es motivo para fallar.
        await pista?.applyConstraints(RESOLUCION_IDEAL).catch(() => undefined);

        // ── Por qué la cámara nativa ve mejor, y cómo emparejarla ─────────
        // `getUserMedia` entrega la lente con el enfoque que caiga; la app
        // nativa hace autofoco CONTINUO gratis. Y sin zoom, la distancia
        // donde el enfoque trabaja deja el código en un puñado de píxeles.
        // Cada ajuste va en su PROPIO set de `advanced`: el navegador aplica
        // los que puede e ignora el resto, en vez de descartar el paquete.
        const capacidades = (pista?.getCapabilities?.() ?? {}) as {
          focusMode?: string[];
          zoom?: { max?: number };
        };
        const ajustes: Record<string, unknown>[] = [];
        if (capacidades.focusMode?.includes("continuous") === true) {
          ajustes.push({ focusMode: "continuous" });
        }
        if ((capacidades.zoom?.max ?? 0) >= ZOOM_ESCANER) {
          ajustes.push({ zoom: ZOOM_ESCANER });
        }
        if (ajustes.length > 0) {
          await pista
            ?.applyConstraints({ advanced: ajustes } as MediaTrackConstraints)
            .catch(() => undefined);
        }
        // Si otra app toma la cámara o el sistema la corta, el track muere SIN
        // excepción: sin esta vigilancia quedaría el cuadro negro mudo.
        pista?.addEventListener("ended", () => {
          if (!cancelado) {
            setEncendida(false);
            setFase("sin-camara");
          }
        });

        const controles = await lector.decodeFromStream(stream, video, (resultado) => {
          if (resultado === undefined || cancelado) {
            return;
          }
          // Se apaga apenas hay un acierto: dejar la cámara leyendo dispararía
          // el mismo código otra vez en el siguiente cuadro y el carrito
          // sumaría dos. Apagar es bajar la INTENCIÓN — el cleanup del efecto
          // hace el `stop()`, que es su trabajo.
          setEncendida(false);
          onScanRef.current(resultado.getText());
        });

        if (cancelado) {
          controles.stop();
          return;
        }
        controlesRef.current = controles;
        // La segunda vigilancia, y no es redundante con la del track: cuando
        // zxing muere por un error interno de su loop, apaga el stream con
        // `track.stop()`, y un stop programático NO dispara "ended" — eso lo
        // reservan los navegadores para muertes de origen físico. Lo que sí
        // deja huella es que al soltar el stream pone `srcObject = null`, y el
        // <video> dispara "emptied". Sin esto, esa muerte era invisible:
        // cuadro negro sin aviso, sin excepción y sin consola.
        video.addEventListener("emptied", () => {
          if (!cancelado) {
            setEncendida(false);
            setFase("sin-camara");
          }
        });
        setFase("leyendo");
      } catch (error) {
        // Permiso denegado, sin cámara, o un navegador sin `mediaDevices`. Los
        // tres terminan igual: se dice qué pasó y la búsqueda manual sigue.
        // El error va a consola porque este catch ya se tragó DOS bugs en
        // silencio — con un teléfono conectado por USB, `chrome://inspect`
        // muestra esta línea y ahorra una tarde de adivinar.
        console.error("[barcode-scanner]", error);
        for (const t of stream?.getTracks() ?? []) {
          t.stop();
        }
        if (!cancelado) {
          setEncendida(false);
          setFase("sin-camara");
        }
      }
    })();

    return () => {
      cancelado = true;
      controlesRef.current?.stop();
      controlesRef.current = null;
    };
  }, [encendida]);

  // El apagado limpio: la fase sigue a la intención cuando no hubo error.
  useEffect(() => {
    if (!encendida) {
      setFase((actual) => (actual === "sin-camara" ? actual : "apagado"));
    }
  }, [encendida]);

  const estado = fase;

  if (estado === "sin-camara") {
    return (
      <p role="status" className="text-muted-foreground text-xs" data-testid="scanner-unavailable">
        {t("pos.cart.cameraUnavailable")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="barcode-scanner">
      {/* Con `encendida` y NUNCA con la fase: la fase se prende dentro del
          efecto, y el efecto corre tras un commit en el que el video aún no
          existía — con el import de zxing en caché, su microtask le ganaba al
          re-render y `videoRef.current` era null. Segunda pantalla negra del
          2026-08-22, esta vez sin pedir permisos. Con la intención como gate,
          React asigna el ref en el commit y corre el efecto DESPUÉS: el video
          existe siempre, gane quien gane esa carrera. */}
      {encendida && (
        // `autoPlay`, `muted` y `playsInline` son los TRES necesarios: un
        // navegador móvil que recibe el stream sin ellos lo adjunta y NO lo
        // reproduce — la misma pantalla negra por otra causa. `muted` no es
        // cosmético: sin él, la política de autoplay bloquea la reproducción.
        //
        // Bonus inesperado: acá vivía un `biome-ignore` de `useMediaCaption`, y
        // al poner `muted` la regla dejó de dispararse sola. Tiene sentido — un
        // video sin audio no tiene nada que subtitular. Una supresión menos.
        <video ref={videoRef} className="w-full rounded-md bg-black" autoPlay muted playsInline />
      )}

      <Button
        variant="outline"
        // Solo se toca la INTENCIÓN. El `stop()` lo hace el cleanup del
        // efecto, que es su trabajo: apagarla acá a mano dejaría dos lugares
        // que apagan y ninguno que sepa del otro.
        onClick={() => setEncendida((prendida) => !prendida)}
      >
        {encendida ? t("pos.cart.stopScan") : t("pos.cart.scan")}
      </Button>
    </div>
  );
}
