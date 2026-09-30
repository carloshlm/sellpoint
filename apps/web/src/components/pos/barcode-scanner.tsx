import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// El .wasm del lector de respaldo, empaquetado por Vite y servido desde el
// propio origen: la CSP no deja bajarlo de un CDN, que es lo que zxing-wasm
// haría por omisión.
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { Button } from "@/components/ui/button";
import { type Area, createConfirmer, isInsideArea, visibleArea } from "@/lib/scanner/visible-area";

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
 * El lector de respaldo (`barcode-detector`, zxing-cpp en WebAssembly) se
 * importa dentro del `useEffect`, no arriba, y SOLO en los navegadores sin
 * `BarcodeDetector` nativo. Pesa; la mayoría de los turnos no abre la cámara
 * ni una vez, así que hacer que todos paguen su descarga al entrar al POS
 * sería cobrarles por algo que no usan.
 */

/**
 * ── LA RESOLUCIÓN NO ES OPCIONAL (2026-08-22) ─────────────────────────────
 *
 * Carlos: «ya muestra la imagen pero no detecta el código de barras». Sin
 * `width`/`height` el navegador entrega lo que quiera — típicamente 640×480.
 * Un UPC-A son 95 módulos: a 640 px, ocupando media pantalla, quedan ~3 px por
 * barra. Decodificable en teoría, y cualquier temblor o brillo lo tira abajo.
 * Por eso se pide 1920×1080 — en dos pasos, ver abajo.
 *
 * ── UN SOLO LECTOR, DOS MOTORES (2026-09-30) ──────────────────────────────
 *
 * Hasta el 2026-09-29 el respaldo era `@zxing/browser` (zxing-js, puerto viejo
 * de Java) con su propio bucle, sus hints rotos (`TRY_HARDER` mataba el stream)
 * y su ceguera a la nitidez: en el iPhone de Carlos, con un UPC enorme y
 * nítido centrado en la línea, NO leía nada. Ahora el respaldo es
 * `barcode-detector`: el MISMO API `BarcodeDetector` que trae Chrome Android,
 * implementado con zxing-cpp en WebAssembly. Un solo bucle para los dos
 * motores; lo único que cambia es quién construye el detector.
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

/**
 * ── ELEGIR LA LENTE (Samsung S20 Ultra, 2026-09-30) ──────────────────────
 *
 * Con `facingMode: environment` a secas, Chrome elige UNA de las cámaras
 * traseras — y en un teléfono con tres o cuatro, no siempre la que enfoca a
 * distancia de mostrador: la telefoto periscópica no enfoca a menos de ~60 cm
 * y la principal de 108 MP tampoco enfoca cerca. Carlos lo vio: borroso en
 * la app con el enfoque continuo puesto, nítido en la cámara nativa, que
 * cambia de lente sola. La web no puede pedir una lente por nombre, pero sí
 * listar las traseras y dejar que la persona cambie hasta dar con la buena.
 * La elegida se recuerda en el aparato: se escoge una vez por caja.
 */
const LLAVE_LENTE = "pos.scanner.deviceId";

function lenteRecordada(): string | null {
  try {
    return localStorage.getItem(LLAVE_LENTE);
  } catch {
    return null;
  }
}

function recordarLente(deviceId: string | null): void {
  try {
    if (deviceId === null) {
      localStorage.removeItem(LLAVE_LENTE);
    } else {
      localStorage.setItem(LLAVE_LENTE, deviceId);
    }
  } catch {
    // Sin almacenamiento (modo privado): se elige en cada sesión, nada más.
  }
}

/**
 * Las cámaras traseras, o todas si las etiquetas no dicen hacia dónde miran
 * (antes del permiso vienen vacías). Chrome Android etiqueta «camera2 0,
 * facing back»; otros navegadores, «Back Camera» o «trasera».
 */
async function camarasTraseras(): Promise<MediaDeviceInfo[]> {
  const todas = (await navigator.mediaDevices.enumerateDevices?.()) ?? [];
  const video = todas.filter((d) => d.kind === "videoinput");
  const traseras = video.filter((d) => /back|rear|environment|trasera|posterior/i.test(d.label));
  return traseras.length > 0 ? traseras : video;
}
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
 * Hubo 5× (Carlos, 2026-08-22, cuando 2× no alcanzaba a su distancia de
 * enfoque); con la lente correcta sobra, y lo quitó el 2026-09-30. Los botones
 * diagnostican de paso: si no aparecen, la lente no expone zoom vía web.
 */
const NIVELES_ZOOM = [1, 2];

/**
 * Foco FIJO de mostrador (~15 cm), SOLO para lentes que no saben enfocar de
 * continuo. Hasta el 2026-09-30 se prefería sobre el continuo, por unas
 * capturas del 2026-08-22 (con zxing-js y sin zoom) en las que el autofoco no
 * clavaba la caja. En el Samsung S20 Ultra de Carlos era al revés: la cámara
 * nativa enfoca de continuo y se ve nítida; la app, clavada a 15 cm, borrosa.
 * Un valor adivinado no puede ganarle al motor de enfoque del teléfono.
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

interface Detector {
  // `boundingBox` viene en pixeles de la FUENTE: la foto entera si se le da
  // el <video>, o el recorte si se le da un ImageBitmap.
  detect: (v: HTMLVideoElement | ImageBitmap) => Promise<
    Array<{
      rawValue: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
    }>
  >;
}

interface ConstructorDetector {
  new (opciones: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
}

/**
 * El área visible del cuadro como ImageBitmap, o `null` si el navegador no
 * sabe recortar (`createImageBitmap` con rectángulo) o el video aún no tiene
 * medidas. Quien lo recibe lo cierra: un bitmap sin `close()` es memoria de la
 * GPU que se queda hasta el GC.
 */
async function recortar(video: HTMLVideoElement, area: Area | null): Promise<ImageBitmap | null> {
  if (area === null || typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    return await createImageBitmap(video, area.x, area.y, area.width, area.height);
  } catch {
    return null;
  }
}

/** Con `Ctor`, un detector que sepa alguno de nuestros formatos; si no, `null`. */
async function construirDetector(Ctor: ConstructorDetector): Promise<Detector | null> {
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
 * El detector: el NATIVO del navegador si existe (Chrome Android: ML Kit), y
 * si no, el mismo API por `barcode-detector` (zxing-cpp en WebAssembly), que
 * se descarga solo aquí. `null` si ninguno sabe leer un código 1D.
 */
async function crearDetector(): Promise<Detector | null> {
  const nativo = (window as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
  if (nativo !== undefined) {
    const detector = await construirDetector(nativo);
    if (detector !== null) {
      return detector;
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  // El .wasm sale del propio bundle (ver el import de arriba); sin esto la
  // librería lo pide a jsDelivr y la CSP lo bloquea en silencio.
  prepareZXingModule({
    overrides: {
      locateFile: (ruta: string, prefijo: string) =>
        ruta.endsWith(".wasm") ? zxingWasmUrl : prefijo + ruta,
    },
  });
  return construirDetector(BarcodeDetector as unknown as ConstructorDetector);
}

/**
 * La pausa entre un intento y el siguiente. Corta a propósito: cada intento ya
 * espera a que el detector termine (100–300 ms en ML Kit, menos en wasm sobre
 * el recorte), y cuantos más intentos por segundo, antes junta sus dos votos
 * un código bien leído. Era 100 ms hasta el 2026-09-30.
 */
const PAUSA_ENTRE_INTENTOS_MS = 30;

/**
 * Modo CONTINUO (2026-08-23, pedido de Carlos): la cámara ya no se apaga con
 * cada acierto — un mostrador escanea artículo tras artículo. Lo que evita el
 * doble cobro es esta ventana: el mismo código no se entrega dos veces dentro
 * de ella. Dos códigos DISTINTOS seguidos pasan, y el mismo código pasada la
 * ventana también: tres unidades iguales son tres entregas legítimas.
 */
const ENFRIAMIENTO_MS = 1500;

/**
 * La confirmación del detector NATIVO (Carlos, 2026-09-29): un código se
 * entrega cuando se lee igual dos veces dentro de esta ventana, aunque en
 * medio haya una lectura distinta o cuadros sin nada. ML Kit tolera el
 * desenfoque tanto que a veces «lee» un código válido que no está (cuatro
 * distintos para una misma caja): la buena se repite, la borrosa no. Los
 * intentos van cada ~100 ms más lo que tarde el detector (100–300 ms), así que
 * 2.5 s son bastantes intentos. El primer intento fue «dos SEGUIDAS en 500 ms»
 * y obligaba a sostener el producto quieto: un cuadro fallido reiniciaba la
 * cuenta. Ver `lib/scanner/visible-area.ts`. Aplica a los dos motores: el
 * wasm también lee cuadro tras cuadro cuando el código está a la vista.
 */
const CONFIRMACION_MS = 2500;

interface BarcodeScannerProps {
  /** Recibe el texto decodificado. El mismo que produciría el teclado. */
  onScan: (text: string) => void;
}

/**
 * ¿El dedo es el puntero principal de este aparato?
 *
 * Decide si se OFRECE escanear con la cámara. En una laptop la cámara apunta a
 * la cara, no al anaquel: el botón está de adorno y ocupa el lugar donde se
 * espera algo útil (Carlos, 2026-09-17, primero en la Carga rápida y después
 * en el mostrador).
 *
 * `(pointer: coarse)` pregunta por la CAPACIDAD —el puntero principal es
 * grueso, o sea un dedo— y no por el ancho de la ventana, que es lo que se
 * suele usar mal: una laptop con la ventana angosta sigue siendo una laptop.
 *
 * La regla vive ACÁ y no en cada pantalla porque las dos que lo usan la
 * quieren igual, y la tercera que venga también.
 *
 * `?.` y el respaldo en `false` por jsdom, que no implementa `matchMedia`.
 */
function conCamaraDeMano(): boolean {
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/**
 * Lo que se MUESTRA. Deliberadamente separado de la INTENCIÓN (`encendida`):
 * ver la nota del efecto, abajo.
 */
type Fase = "apagado" | "encendiendo" | "leyendo" | "sin-camara";

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const { t } = useTranslation();
  // Se resuelve UNA vez: la capacidad del aparato no cambia mientras la
  // pantalla está abierta.
  const [camaraALaMano] = useState(conCamaraDeMano);

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
  // La lente pedida (por `deviceId`) y las traseras disponibles para cambiar.
  const [lente, setLente] = useState<string | null>(lenteRecordada);
  const [lentes, setLentes] = useState<MediaDeviceInfo[]>([]);

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

        // La lente recordada, y si ya no existe (otro aparato, otro
        // navegador), la trasera que Chrome elija — y se olvida la vieja.
        if (lente !== null) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: lente } },
            });
          } catch {
            recordarLente(null);
            stream = await navigator.mediaDevices.getUserMedia(CAMARA_TRASERA);
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia(CAMARA_TRASERA);
        }
        // Con el permiso dado, las etiquetas ya dicen qué cámara es cada una.
        camarasTraseras()
          .then((lista) => {
            if (!cancelado) setLentes(lista);
          })
          .catch(() => undefined);
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
        if (capacidades.focusMode?.includes("continuous") === true) {
          // Como la cámara nativa (Samsung S20 Ultra, 2026-09-30): el motor
          // de enfoque del teléfono sigue al producto. No se pide el manual
          // a la vez: dos jefes para el mismo motor.
          ajustes.push({ focusMode: "continuous" });
        } else if (capacidades.focusMode?.includes("manual") === true && rangoFoco !== undefined) {
          // Sin continuo: foco FIJO de mostrador, en el MISMO set que el modo
          // manual — van juntos o no van; un `focusDistance` sin modo manual
          // no hace nada.
          const distancia = Math.min(
            Math.max(FOCO_ESCANER_M, rangoFoco.min ?? FOCO_ESCANER_M),
            rangoFoco.max ?? FOCO_ESCANER_M,
          );
          ajustes.push({ focusMode: "manual", focusDistance: distancia });
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
          // La lente que LEE es la buena: se recuerda para el próximo arranque
          // sin esperar a que alguien toque «Cambiar cámara» (2026-09-30).
          const lenteQueLeyo = pistaRef.current?.getSettings?.().deviceId;
          if (lenteQueLeyo !== undefined && lenteQueLeyo !== lenteRecordada()) {
            recordarLente(lenteQueLeyo);
          }
          navigator.vibrate?.(60);
          onScanRef.current(texto);
        };

        const detector = await crearDetector();
        if (detector === null) {
          throw new Error("ningún detector de códigos de barras disponible");
        }
        if (cancelado) {
          for (const t of stream.getTracks()) {
            t.stop();
          }
          return;
        }

        // ── Nosotros somos el bucle, con cualquiera de los dos motores ──
        const streamVivo = stream;
        video.srcObject = streamVivo;
        try {
          await video.play();
        } catch {
          // `autoPlay` ya lo pide; un play() rechazado acá no es fatal.
        }
        let vivo = true;
        const confirmar = createConfirmer(CONFIRMACION_MS);
        const tick = async () => {
          if (!vivo || cancelado) {
            return;
          }
          try {
            // SOLO lo que se ve (2026-09-29): el recuadro muestra el tercio
            // central de la foto y el detector, si se le da el <video>,
            // recibe la foto completa — leía códigos fuera de la vista. Se
            // le da el RECORTE: un tercio de los píxeles, así que también
            // intenta más veces por segundo. Si el navegador no sabe
            // recortar, recibe el <video> y se filtra por la caja de cada
            // código (`isInsideArea`).
            const area = visibleArea(video);
            const recorte = await recortar(video, area);
            let texto: string | undefined;
            try {
              const codigos = await detector.detect(recorte ?? video);
              texto = codigos.find(
                (codigo) =>
                  codigo.rawValue !== "" &&
                  (recorte !== null || isInsideArea(codigo.boundingBox, area)),
              )?.rawValue;
            } finally {
              recorte?.close();
            }
            if (texto !== undefined && vivo && !cancelado && confirmar(texto, Date.now())) {
              // Sin `return`: el loop sigue — modo continuo. El
              // enfriamiento de `entregar` filtra los cuadros repetidos.
              entregar(texto);
            }
          } catch {
            // Cuadro aún no listo o detector quisquilloso: se reintenta.
          }
          setTimeout(() => {
            void tick();
          }, PAUSA_ENTRE_INTENTOS_MS);
        };
        void tick();
        const controles = {
          stop: () => {
            vivo = false;
            for (const t of streamVivo.getTracks()) {
              t.stop();
            }
            video.srcObject = null;
          },
        };

        if (cancelado) {
          controles.stop();
          return;
        }
        controlesRef.current = controles;
        // La segunda vigilancia, y no es redundante con la del track: un
        // `track.stop()` programático NO dispara "ended" — eso lo reservan
        // los navegadores para muertes de origen físico. Lo que sí deja
        // huella es soltar el stream (`srcObject = null`): el <video> dispara
        // "emptied". Nació para la auto-destrucción de zxing-js y se queda:
        // si algo suelta el video, el cuadro negro no será mudo.
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
  }, [encendida, lente]);

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

  /**
   * La siguiente lente trasera después de la que está en uso. Cambiar `lente`
   * reinicia el efecto: la cámara actual se apaga y la nueva arranca con los
   * mismos ajustes (resolución, enfoque, zoom).
   */
  const cambiarLente = () => {
    const actual = pistaRef.current?.getSettings?.().deviceId ?? lente;
    const indice = lentes.findIndex((d) => d.deviceId === actual);
    const siguiente = lentes[(indice + 1) % lentes.length];
    if (siguiente === undefined) {
      return;
    }
    recordarLente(siguiente.deviceId);
    setLente(siguiente.deviceId);
  };

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

  // Sin cámara de mano no se ofrece nada: ni el botón ni el aviso. Va DESPUÉS
  // de los hooks —React exige que corran siempre y en el mismo orden— y por
  // eso es un `return` tardío y no una guarda al principio.
  if (!camaraALaMano) {
    return null;
  }

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
            // `object-cover` recorta solo lo visible y el recorte simétrico
            // deja el centro real exactamente donde la guía dice que está. El
            // detector nativo recibe la foto ENTERA: por eso descarta lo que
            // cae fuera de este recuadro (`visibleArea`, 2026-09-29). zxing
            // barre las filas del centro, que son las de la línea.
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
          {(torchDisponible || topeZoom !== null || lentes.length > 1) && (
            <div className="absolute right-2 bottom-2 flex gap-1">
              {lentes.length > 1 && (
                // Solo con más de una trasera: en un teléfono de una lente el
                // botón no tendría a dónde cambiar.
                <Button type="button" size="sm" variant="secondary" onClick={cambiarLente}>
                  {t("pos.cart.switchCamera")}
                </Button>
              )}
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
