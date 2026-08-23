import { Camera, CameraOff } from "lucide-react";
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
 * Los niveles que se OFRECEN al usuario, filtrados por lo que la lente declare.
 * Carlos pidió 5× al ver que 2× no alcanzaba a su distancia de enfoque; se le
 * da el control en vez de otra constante adivinada — y los botones diagnostican
 * de paso: si no aparecen, la lente no expone zoom vía web.
 */
const NIVELES_ZOOM = [1, 2, 5];

/**
 * Foco FIJO de mostrador (~15 cm), para lentes con enfoque manual. Las
 * capturas del 2026-08-22 mostraron el autofoco continuo sin clavar nunca la
 * caja; un escáner dedicado no enfoca: vive clavado a distancia de trabajo.
 * Se acota al rango que la lente declare.
 */
const FOCO_ESCANER_M = 0.15;

/**
 * ── EL DETECTOR NATIVO PRIMERO (2026-08-23) ───────────────────────────────
 *
 * `BarcodeDetector` de Chrome Android es ML Kit por debajo: tolera
 * desenfoque, rotación y poca luz muchísimo mejor que zxing — exactamente la
 * variable que quedó viva tras las seis rondas del 22 (imagen desenfocada en
 * los tres niveles de zoom). Cuando existe, se usa y NI SE DESCARGA zxing;
 * zxing queda como fallback universal (Safari, Firefox, escritorio viejo).
 * Solo formatos 1D: mismo criterio que el lector — una caja no presenta QR.
 */
const FORMATOS_1D = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];

interface DetectorNativo {
  detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
}

interface ConstructorDetectorNativo {
  new (opciones: { formats: string[] }): DetectorNativo;
  getSupportedFormats: () => Promise<string[]>;
}

/** `null` cuando no hay detector nativo o no sabe ninguno de nuestros formatos. */
async function crearDetectorNativo(): Promise<DetectorNativo | null> {
  const Ctor = (window as { BarcodeDetector?: ConstructorDetectorNativo }).BarcodeDetector;
  if (Ctor === undefined) {
    return null;
  }
  try {
    const soportados = await Ctor.getSupportedFormats();
    const formats = FORMATOS_1D.filter((f) => soportados.includes(f));
    if (formats.length === 0) {
      return null;
    }
    return new Ctor({ formats });
  } catch {
    // Un detector que revienta al preguntarle qué sabe no es de fiar.
    return null;
  }
}

/**
 * 100 ms ≈ 10 intentos por segundo. No es gratis —cada intento binariza el
 * cuadro y lo recorre— pero el lector 1D es barato comparado con el
 * multiformato, y el cuello de botella real es la mano del cajero.
 */
const OPCIONES_LECTOR = { delayBetweenScanAttempts: 100 };

/**
 * Modo CONTINUO (2026-08-23, pedido de Carlos): la cámara ya no se apaga con
 * cada acierto — un mostrador escanea artículo tras artículo. Lo que evita el
 * doble cobro es esta ventana: el mismo código no se entrega dos veces dentro
 * de ella. Dos códigos DISTINTOS seguidos pasan, y el mismo código pasada la
 * ventana también: tres unidades iguales son tres entregas legítimas.
 */
const ENFRIAMIENTO_MS = 1500;

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
  // El track vivo, para que los botones de zoom le hablen; y lo que la lente
  // declaró poder, para decidir qué botones existen.
  const pistaRef = useRef<MediaStreamTrack | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [topeZoom, setTopeZoom] = useState<number | null>(null);
  const [conLinterna, setConLinterna] = useState(false);
  const [torchDisponible, setTorchDisponible] = useState(false);

  // `onScan` en un ref y no en las dependencias: si el padre le pasa una
  // función nueva en cada render, incluirla reiniciaría la cámara sola.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  // La última entrega, para el enfriamiento del modo continuo.
  const ultimaLecturaRef = useRef<{ texto: string; en: number } | null>(null);

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
          focusDistance?: { min?: number; max?: number };
          zoom?: { max?: number };
          torch?: boolean;
        };
        // El diagnóstico gratis: con el teléfono por USB, `chrome://inspect`
        // dice exactamente qué sabe hacer ESTA lente — datos, no teorías.
        console.info("[barcode-scanner] capabilities", capacidades);
        const ajustes: Record<string, unknown>[] = [];
        const rangoFoco = capacidades.focusDistance;
        if (capacidades.focusMode?.includes("manual") === true && rangoFoco !== undefined) {
          // Foco FIJO de mostrador, en el MISMO set que el modo manual: van
          // juntos o no van — un `focusDistance` sin modo manual no hace nada.
          // Y no se pide el continuo a la vez: dos jefes para el mismo motor.
          const distancia = Math.min(
            Math.max(FOCO_ESCANER_M, rangoFoco.min ?? FOCO_ESCANER_M),
            rangoFoco.max ?? FOCO_ESCANER_M,
          );
          ajustes.push({ focusMode: "manual", focusDistance: distancia });
        } else if (capacidades.focusMode?.includes("continuous") === true) {
          ajustes.push({ focusMode: "continuous" });
        }
        const maximoDeLaLente = capacidades.zoom?.max ?? 0;
        if (maximoDeLaLente >= ZOOM_ESCANER) {
          ajustes.push({ zoom: ZOOM_ESCANER });
        }
        pistaRef.current = pista ?? null;
        setTopeZoom(maximoDeLaLente >= ZOOM_ESCANER ? maximoDeLaLente : null);
        setZoom(maximoDeLaLente >= ZOOM_ESCANER ? ZOOM_ESCANER : null);
        setTorchDisponible(capacidades.torch === true);
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

        // MODO CONTINUO: un acierto ya NO apaga la cámara — se sigue
        // escaneando hasta que el usuario elija parar. El enfriamiento evita
        // que los cuadros consecutivos del MISMO código se cobren doble; la
        // vibración es el «bip» del escáner: sin ella no se sabe si registró.
        const entregar = (texto: string) => {
          const ahora = Date.now();
          const previa = ultimaLecturaRef.current;
          if (previa !== null && previa.texto === texto && ahora - previa.en < ENFRIAMIENTO_MS) {
            return;
          }
          ultimaLecturaRef.current = { texto, en: ahora };
          navigator.vibrate?.(60);
          onScanRef.current(texto);
        };

        const detector = await crearDetectorNativo();
        let controles: { stop: () => void };

        if (detector !== null) {
          // ── Camino nativo: nosotros somos el loop ─────────────────────
          const streamNativo = stream;
          video.srcObject = streamNativo;
          try {
            await video.play();
          } catch {
            // `autoPlay` ya lo pide; un play() rechazado acá no es fatal.
          }
          let vivo = true;
          const tick = async () => {
            if (!vivo || cancelado) {
              return;
            }
            try {
              const codigos = await detector.detect(video);
              const texto = codigos[0]?.rawValue;
              if (texto !== undefined && texto !== "" && vivo && !cancelado) {
                // Sin `return`: el loop sigue — modo continuo. El
                // enfriamiento de `entregar` filtra los cuadros repetidos.
                entregar(texto);
              }
            } catch {
              // Cuadro aún no listo o detector quisquilloso: se reintenta.
            }
            setTimeout(() => {
              void tick();
            }, OPCIONES_LECTOR.delayBetweenScanAttempts);
          };
          void tick();
          controles = {
            stop: () => {
              vivo = false;
              for (const t of streamNativo.getTracks()) {
                t.stop();
              }
              video.srcObject = null;
            },
          };
        } else {
          // ── Fallback universal: zxing, con import diferido — solo quien
          // cae acá paga la descarga del decodificador. ──────────────────
          const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
          const lector = new BrowserMultiFormatOneDReader(undefined, OPCIONES_LECTOR);
          if (cancelado) {
            for (const t of stream.getTracks()) {
              t.stop();
            }
            return;
          }
          controles = await lector.decodeFromStream(stream, video, (resultado) => {
            if (resultado === undefined || cancelado) {
              return;
            }
            entregar(resultado.getText());
          });
        }

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
      pistaRef.current = null;
      setZoom(null);
      setTopeZoom(null);
      setConLinterna(false);
      setTorchDisponible(false);
    }
  }, [encendida]);

  const alternarLinterna = () => {
    const objetivo = !conLinterna;
    const ajuste: Record<string, unknown>[] = [{ torch: objetivo }];
    void pistaRef.current
      ?.applyConstraints({ advanced: ajuste } as MediaTrackConstraints)
      .then(() => setConLinterna(objetivo))
      .catch(() => undefined);
  };

  const aplicarZoom = (nivel: number) => {
    // Mismo molde que `ajustes` en el efecto: `zoom` no existe en los tipos
    // DOM de TS, así que el objeto pasa por un tipo ancho antes del cast.
    const ajuste: Record<string, unknown>[] = [{ zoom: nivel }];
    void pistaRef.current
      ?.applyConstraints({ advanced: ajuste } as MediaTrackConstraints)
      .then(() => setZoom(nivel))
      .catch(() => undefined);
  };

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
        <div className="relative">
          <video
            ref={videoRef}
            // Franja de escáner, no pantalla completa (Carlos, 2026-08-23):
            // `object-cover` recorta solo lo visible — el detector recibe el
            // cuadro entero — y el recorte simétrico deja el centro real
            // exactamente donde la guía dice que está.
            className="h-48 w-full rounded-md bg-black object-cover"
            autoPlay
            muted
            playsInline
          />
          {/* La guía de centrado. El lector 1D barre las filas del CENTRO de
              la imagen (~25, sin TRY_HARDER): un código en el tercio inferior
              — la captura de Carlos — es invisible por bien enfocado que
              esté. La línea dice dónde mirar sin explicar nada. */}
          <div
            data-testid="scan-guide"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center px-3"
          >
            <div className="h-0.5 w-full rounded bg-destructive/70" />
          </div>
          {(torchDisponible || topeZoom !== null) && (
            <div className="absolute right-2 bottom-2 flex gap-1">
              {torchDisponible && (
                // Más luz ataca el desenfoque por dos vías: profundidad de
                // campo y obturación corta. Solo si la lente declara torch.
                <Button
                  type="button"
                  size="sm"
                  variant={conLinterna ? "default" : "secondary"}
                  aria-pressed={conLinterna}
                  onClick={alternarLinterna}
                >
                  {t("pos.cart.torch")}
                </Button>
              )}
              {topeZoom !== null &&
                NIVELES_ZOOM.filter((nivel) => nivel <= topeZoom).map((nivel) => (
                  <Button
                    key={nivel}
                    type="button"
                    size="sm"
                    variant={zoom === nivel ? "default" : "secondary"}
                    onClick={() => aplicarZoom(nivel)}
                  >
                    {nivel}×
                  </Button>
                ))}
            </div>
          )}
        </div>
      )}

      {encendida && <p className="text-muted-foreground text-xs">{t("pos.cart.scanHint")}</p>}

      {/* ── El botón de mostrador (2026-08-23) ──────────────────────────
          Icono grande con color, leyenda al lado en gris. En una caja el
          cajero no lee: RECONOCE. El icono carga el significado (cámara =
          escanear, cámara tachada = parar) y el texto acompaña como
          instrucción.

          El `aria-label` NO es decorativo: sin él, el botón sería un «svg»
          sin nombre para un lector de pantalla — y también para los tests,
          que lo buscan por su nombre accesible.

          Sobre los colores: verde sólido para arrancar (token `--success`,
          «adelante», sin competir con el azul de Cobrar) y rojo TENUE para
          parar. Tenue y no sólido a propósito: en esta app el rojo intenso ya
          significa ERROR —líneas rechazadas, avisos— y un botón así
          competiría con las alarmas de verdad. Entintado + cámara tachada se
          lee «detener» sin gritar «problema». */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant={encendida ? "destructive" : "default"}
          aria-label={encendida ? t("pos.cart.stopScan") : t("pos.cart.scan")}
          // 48 px es el mínimo de un objetivo táctil; el `size-8` del sistema
          // es medida de ratón, no de dedo sobre un mostrador.
          className={`size-12 ${encendida ? "" : "bg-success text-success-foreground hover:bg-success/90"}`}
          // Solo se toca la INTENCIÓN. El `stop()` lo hace el cleanup del
          // efecto, que es su trabajo: apagarla acá a mano dejaría dos lugares
          // que apagan y ninguno que sepa del otro.
          onClick={() => setEncendida((prendida) => !prendida)}
        >
          {encendida ? <CameraOff className="size-6" /> : <Camera className="size-6" />}
        </Button>

        <span className="text-muted-foreground text-sm" data-testid="scan-legend">
          {encendida ? t("pos.cart.stopScan") : t("pos.cart.scan")}
        </span>
      </div>
    </div>
  );
}
