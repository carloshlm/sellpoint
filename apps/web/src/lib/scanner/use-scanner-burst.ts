import { useEffect, useRef } from "react";

/**
 * ── Detectar el LECTOR, no el teclado ────────────────────────────────────
 *
 * Un lector de códigos de barras es, para el navegador, un teclado que escribe
 * muy rápido y termina en Enter. No hay ningún evento que lo distinga, así que
 * se lo reconoce por cómo escribe: se escucha el documento entero en fase de
 * captura y, al llegar el Enter, se pregunta si todo lo tecleado llegó a
 * velocidad de máquina y si forma un código de barras.
 *
 * Esto vive en un hook —y no dentro de una pantalla— porque la misma pistola se
 * usa en Carga rápida, en Entradas y Salidas y en el alta de un producto. La
 * heurística es delicada y cara de calibrar: tenerla tres veces sería tenerla
 * mal dos veces.
 */

/**
 * El PROMEDIO de milisegundos por tecla que puede tener una ráfaga y seguir
 * pareciendo un lector.
 *
 * ── Por qué el promedio y no la pausa entre cada par ─────────────────────
 *
 * La primera versión medía tecla contra tecla, y se le escapaba el lector de
 * Carlos: basta UN hipo —el sistema ocupado, una pestaña que pide atención—
 * para que un par de teclas se separe y toda la ráfaga se parta en dos. El
 * promedio sobre la ráfaga entera aguanta ese hipo sin perder la señal.
 *
 * ── Por qué hay DOS techos y no uno ──────────────────────────────────────
 *
 * Este umbral existe para una sola cosa: distinguir un código de barras de un
 * PRECIO tecleado. Y un precio tiene seis o siete dígitos como mucho — nadie
 * cobra ocho cifras por un refresco. Así que la longitud de la ráfaga ya dice
 * cuánto hay que desconfiar del reloj:
 *
 * - 6 o 7 dígitos: podría ser un precio de verdad. El techo se queda apretado.
 * - 8 o más: no es un precio en ninguna moneda que manejemos. El techo se
 *   afloja, porque lo único que queda del otro lado es un lector.
 *
 * Un techo único obliga a elegir entre dos males: apretado se pierden lectores
 * lentos, flojo se come el precio de alguien. Separarlos por longitud no elige.
 *
 * ── De dónde salen los números ───────────────────────────────────────────
 *
 * El lector Bluetooth de Carlos, MEDIDO en su equipo el 2026-09-17: 12 dígitos
 * en 660 ms, 60 de promedio. Con el techo viejo de 50 el presupuesto era 600 y
 * se pasaba por 60 ms, así que su escaneo desde el precio se descartaba como si
 * lo hubiera tecleado él. No era un error de lógica: el umbral estaba calibrado
 * con un lector imaginario de 20 ms por tecla.
 *
 * Una persona sostiene difícilmente menos de 150 ms por dígito en el teclado
 * numérico. 120 deja el doble de margen sobre el lector medido y sigue por
 * debajo del mecanógrafo más rápido.
 */
const MAX_PROMEDIO_POR_TECLA_MS = 50;

/** El techo para una ráfaga que ya es demasiado larga para ser un precio. */
const MAX_PROMEDIO_LECTOR_LARGO_MS = 120;

/** A partir de aquí, la ráfaga dejó de poder ser un precio. */
const LARGO_QUE_YA_NO_ES_PRECIO = 8;

/**
 * La pausa que da por TERMINADA una ráfaga.
 *
 * Sin esto, dos tecleos separados por minutos se sumarían en el mismo búfer y
 * cualquier cosa parecería un código. Con 300 ms, dos capturas distintas nunca
 * se mezclan y un lector nunca se corta a la mitad.
 */
const PAUSA_QUE_CIERRA_LA_RAFAGA_MS = 300;

/** Dónde estaba el cursor cuando empezó la ráfaga, y qué había escrito ahí. */
export interface ScannerBurstOrigin {
  campo: HTMLInputElement;
  valor: string;
}

export interface UseScannerBurstOptions {
  /**
   * Qué hacer con un código que llegó de la pistola.
   *
   * `origen` es el campo donde aterrizó la ráfaga —la cantidad de una línea, el
   * precio de otra— con el valor que tenía ANTES. Devolver ese valor es
   * responsabilidad de quien usa el hook, porque solo esa pantalla sabe si el
   * campo vive en un store, en un estado local o en el servidor.
   */
  onScan: (code: string, origin: ScannerBurstOrigin | null) => void;
  /**
   * Si el hook escucha. En `false` no se registra nada: un diálogo abierto o un
   * documento ya confirmado no deben recibir líneas por la espalda.
   */
  enabled?: boolean;
  /**
   * Campos que tienen su PROPIO camino para el escaneo y a los que el hook no
   * debe meterse — típicamente el input donde se escanea a propósito.
   */
  ignore?: (element: Element | null) => boolean;
  /**
   * Qué cuenta como código de barras. Se recibe de afuera para que cada
   * pantalla aplique su propia regla sin que el hook importe nada del dominio.
   */
  looksLikeBarcode: (text: string) => boolean;
}

interface Rafaga {
  texto: string;
  primeraTecla: number;
  ultimaTecla: number;
  origen: ScannerBurstOrigin | null;
}

export function useScannerBurst({
  onScan,
  enabled = true,
  ignore,
  looksLikeBarcode,
}: UseScannerBurstOptions): void {
  // Las tres entran por ref: el listener se registra UNA vez y no debe
  // volver a montarse porque el padre repintó.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const looksLikeBarcodeRef = useRef(looksLikeBarcode);
  looksLikeBarcodeRef.current = looksLikeBarcode;

  const rafagaRef = useRef<Rafaga | null>(null);

  useEffect(() => {
    if (!enabled) {
      rafagaRef.current = null;
      return;
    }

    const origenDe = (activo: Element | null): ScannerBurstOrigin | null =>
      activo instanceof HTMLInputElement ? { campo: activo, valor: activo.value } : null;

    const alTeclear = (evento: KeyboardEvent) => {
      const activo = document.activeElement;
      if (ignoreRef.current?.(activo) === true) {
        rafagaRef.current = null;
        return;
      }

      if (evento.key === "Enter") {
        const rafaga = rafagaRef.current;
        rafagaRef.current = null;
        if (rafaga === null || !looksLikeBarcodeRef.current(rafaga.texto)) {
          return;
        }
        // Las dos condiciones juntas: lo escrito es un código válido Y llegó a
        // velocidad de máquina. Ninguna alcanza sola — un precio de seis
        // dígitos es un código válido, y «600.00» llega rápido pero no es uno.
        const duracion = rafaga.ultimaTecla - rafaga.primeraTecla;
        const techo =
          rafaga.texto.length >= LARGO_QUE_YA_NO_ES_PRECIO
            ? MAX_PROMEDIO_LECTOR_LARGO_MS
            : MAX_PROMEDIO_POR_TECLA_MS;
        if (duracion > rafaga.texto.length * techo) {
          return;
        }
        evento.preventDefault();
        evento.stopPropagation();
        onScanRef.current(rafaga.texto, rafaga.origen);
        return;
      }

      // Solo caracteres imprimibles: las flechas, Tab y los modificadores no
      // forman parte de lo que escribe un lector.
      if (evento.key.length !== 1) {
        return;
      }
      // ── El reloj sale del EVENTO, no de `Date.now()` ──────────────────
      //
      // `timeStamp` lo pone el navegador cuando NACE la tecla, antes de que
      // corra una línea de JavaScript. `Date.now()` se lee cuando el manejador
      // alcanza a ejecutarse, y entre tecla y tecla React repinta la tabla
      // entera: ese repintado se sumaba a la medición y hacía que un lector
      // rapidísimo pareciera una persona escribiendo despacio.
      const ahora = evento.timeStamp;
      const previa = rafagaRef.current;
      const sigueLaMisma =
        previa !== null && ahora - previa.ultimaTecla <= PAUSA_QUE_CIERRA_LA_RAFAGA_MS;
      rafagaRef.current = sigueLaMisma
        ? { ...previa, texto: previa.texto + evento.key, ultimaTecla: ahora }
        : {
            texto: evento.key,
            primeraTecla: ahora,
            ultimaTecla: ahora,
            origen: origenDe(activo),
          };
    };

    document.addEventListener("keydown", alTeclear, true);
    return () => document.removeEventListener("keydown", alTeclear, true);
  }, [enabled]);
}

/**
 * Le devuelve a un input controlado por React el valor que tenía.
 *
 * ── Por qué no alcanza con `campo.value = valor` ─────────────────────────
 *
 * React lleva su PROPIO rastreador del valor de cada input. Al asignar
 * `.value` a mano, ese rastreador se actualiza de paso, así que el evento
 * `input` que se dispara después se ve como «no cambió nada»: React no llama
 * al `onChange` y el estado se queda con lo que la ráfaga escribió.
 *
 * El síntoma exacto que dejó: Carlos escaneó dos productos con el cursor en el
 * código interno y el campo quedó con los dos códigos PEGADOS
 * («633148100099776455320351»). La pantalla parecía restaurada un instante y
 * el estado nunca lo estuvo.
 *
 * Usar el `set` del prototipo esquiva el rastreador: React ve una diferencia
 * real y procesa el evento como si lo hubiera escrito una persona.
 */
export function restoreInputValue(campo: HTMLInputElement, valor: string): void {
  const asignar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  asignar?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}
