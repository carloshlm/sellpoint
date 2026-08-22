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
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const lector = new BrowserMultiFormatReader();
        const video = videoRef.current;
        if (video === null || cancelado) {
          return;
        }

        const controles = await lector.decodeFromVideoDevice(undefined, video, (resultado) => {
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
      {estado !== "apagado" && (
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
        {estado === "apagado" ? t("pos.cart.scan") : t("pos.cart.stopScan")}
      </Button>
    </div>
  );
}
