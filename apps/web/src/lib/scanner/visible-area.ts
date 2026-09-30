/**
 * Qué lee el escáner de cámara: SOLO lo que se ve, y SOLO si se lee dos veces.
 *
 * Carlos, 2026-09-29, con capturas de su teléfono: un código DEBAJO del
 * recuadro se leía bien, y con el código a la vista entregaba lecturas válidas
 * pero equivocadas. Dos causas que se sumaban:
 *
 * 1. El `<video>` del escáner usa `object-cover` en una franja ancha y baja.
 *    La cámara de un teléfono en vertical entrega ~1080×1920: el recuadro
 *    muestra solo el tercio central de esa foto. El detector nativo
 *    (`BarcodeDetector`, ML Kit en Chrome Android) recibe la foto COMPLETA y
 *    devuelve códigos de cualquier parte, también de lo que no se ve.
 * 2. Una lectura borrosa de un código 1D cuadra su dígito verificador de vez
 *    en cuando (una de cada diez, más o menos), y se entregaba a la primera.
 *
 * Aquí viven las dos reglas, como funciones puras para poder probarlas sin
 * cámara: qué parte de la foto se ve (`visibleArea`), si un código está en
 * ella (`isInsideArea`) y si una lectura ya se confirmó (`createConfirmer`).
 */

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lo que hace falta del `<video>`: medidas de la foto y del recuadro. */
export interface VideoBox {
  videoWidth: number;
  videoHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * La parte de la foto que el recuadro muestra, en pixeles de la foto (los
 * mismos del `boundingBox` del detector).
 *
 * `object-cover` escala la foto hasta cubrir el recuadro y recorta lo que
 * sobra por igual de cada lado; la escala es la mayor de las dos proporciones.
 * `null` mientras el video no tiene medidas (antes de su primer cuadro): sin
 * área no se filtra, y ese momento dura lo que tarda en llegar el cuadro.
 */
export function visibleArea(video: VideoBox): Area | null {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (videoWidth <= 0 || videoHeight <= 0 || clientWidth <= 0 || clientHeight <= 0) {
    return null;
  }
  const scale = Math.max(clientWidth / videoWidth, clientHeight / videoHeight);
  const width = Math.min(videoWidth, clientWidth / scale);
  const height = Math.min(videoHeight, clientHeight / scale);
  return {
    x: Math.round((videoWidth - width) / 2),
    y: Math.round((videoHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Un código cuenta si el CENTRO de su caja cae en lo que se ve: uno que se
 * asoma a medias por la orilla ya está donde la persona apunta. Sin área o
 * sin caja no hay con qué decidir, y cuenta.
 */
export function isInsideArea(box: Area | undefined, area: Area | null): boolean {
  if (box === undefined || area === null) {
    return true;
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return (
    centerX >= area.x &&
    centerX <= area.x + area.width &&
    centerY >= area.y &&
    centerY <= area.y + area.height
  );
}

/**
 * Un código cuenta cuando se lee IGUAL dos veces dentro de `windowMs`, no
 * necesariamente seguidas: una lectura borrosa distinta en medio NO reinicia
 * la cuenta. Así fue el primer intento (2026-09-29) y Carlos lo sufrió en su
 * Android: cada intento del detector tarda 100–300 ms más la pausa, y con
 * «dos seguidas en 500 ms» un solo cuadro fallido volvía a empezar — solo
 * confirmaba con el producto quieto y a la distancia exacta. Una lectura
 * borrosa rara vez se repite idéntica; la buena se repite en cuanto el
 * detector vuelve a acertar.
 */
export function createConfirmer(windowMs: number): (text: string, at: number) => boolean {
  let reads: Array<{ text: string; at: number }> = [];
  return (text, at) => {
    reads = reads.filter((read) => at - read.at <= windowMs);
    const votes = reads.filter((read) => read.text === text).length + 1;
    reads.push({ text, at });
    return votes >= 2;
  };
}
