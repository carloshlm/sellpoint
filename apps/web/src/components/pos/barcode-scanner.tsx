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

type Estado = "apagado" | "encendiendo" | "leyendo" | "sin-camara";

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const { t } = useTranslation();
  const [estado, setEstado] = useState<Estado>("apagado");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // El control que devuelve zxing para apagar la cámara. En un ref y no en el
  // estado: cambiarlo no tiene que repintar nada, y sí tiene que sobrevivir al
  // cleanup del efecto.
  const controlesRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (estado !== "encendiendo") {
      return;
    }

    let cancelado = false;

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
          // sumaría dos.
          controlesRef.current?.stop();
          controlesRef.current = null;
          setEstado("apagado");
          onScan(resultado.getText());
        });

        if (cancelado) {
          controles.stop();
          return;
        }
        controlesRef.current = controles;
        setEstado("leyendo");
      } catch {
        // Permiso denegado, sin cámara, o un navegador sin `mediaDevices`. Los
        // tres terminan igual: se dice qué pasó y la búsqueda manual sigue.
        if (!cancelado) {
          setEstado("sin-camara");
        }
      }
    })();

    return () => {
      cancelado = true;
      controlesRef.current?.stop();
      controlesRef.current = null;
    };
  }, [estado, onScan]);

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
        // Es la cámara en vivo, no un video con contenido hablado: no hay
        // pista que subtitular.
        // biome-ignore lint/a11y/useMediaCaption: cámara en vivo, sin audio ni diálogo
        <video ref={videoRef} className="w-full rounded-md bg-black" playsInline />
      )}

      <Button
        variant="outline"
        onClick={() => {
          if (estado === "apagado") {
            setEstado("encendiendo");
            return;
          }
          controlesRef.current?.stop();
          controlesRef.current = null;
          setEstado("apagado");
        }}
      >
        {estado === "apagado" ? t("pos.cart.scan") : t("pos.cart.stopScan")}
      </Button>
    </div>
  );
}
