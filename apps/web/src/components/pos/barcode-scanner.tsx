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
 * `ideal` y NUNCA `exact`: con `exact`, una webcam que no llega a 1280 devuelve
 * `OverconstrainedError` y el usuario se queda sin cámara en vez de con una
 * peor. Se pide lo bueno y se acepta lo que haya.
 */
const RESTRICCIONES: MediaStreamConstraints = {
  video: {
    facingMode: "environment",
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/**
 * 100 ms ≈ 10 intentos por segundo. No es gratis —cada intento binariza el
 * cuadro y lo recorre— pero el lector 1D es barato comparado con el
 * multiformato, y el cuello de botella real es la mano del cajero.
 */
const OPCIONES_LECTOR = { delayBetweenScanAttempts: 100 };

/**
 * `TRY_HARDER` escrito como `3` a propósito: el enum `DecodeHintType` vive en
 * `@zxing/library`, que NO es dependencia declarada de la app —solo llega como
 * transitiva de `@zxing/browser`—, y agregarla para importar un número sería
 * cargar un paquete entero al bundle por una constante. El valor está fijado
 * por el test, así que si algún día cambia se pone rojo acá y no en una caja.
 */
const TRY_HARDER = 3;
const HINTS = new Map<number, unknown>([[TRY_HARDER, true]]);

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

    void (async () => {
      try {
        // Import diferido: ver la nota de arriba.
        const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        const lector = new BrowserMultiFormatOneDReader(HINTS, OPCIONES_LECTOR);
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

        // `decodeFromConstraints` y no `decodeFromVideoDevice`: el segundo arma
        // `{ video: { facingMode: "environment" } }` y nada más, y sin pedir
        // resolución el navegador entrega su default. Ver `RESTRICCIONES`.
        const controles = await lector.decodeFromConstraints(RESTRICCIONES, video, (resultado) => {
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
        setFase("leyendo");
      } catch {
        // Permiso denegado, sin cámara, o un navegador sin `mediaDevices`. Los
        // tres terminan igual: se dice qué pasó y la búsqueda manual sigue.
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
