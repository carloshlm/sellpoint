import {
  TICKET_LOGO_MAX_HEIGHT,
  TICKET_LOGO_MAX_INPUT_BYTES,
  TICKET_LOGO_MAX_STORED_BYTES,
  TICKET_LOGO_MAX_WIDTH,
} from "@sellpoint/shared";
import sharp from "sharp";

export type LogoRejectedReason = "not_image" | "too_large" | "too_small";

/** Por qué no se aceptó la imagen; el controller lo traduce a un 422 con clave. */
export class LogoRejected extends Error {
  constructor(readonly reason: LogoRejectedReason) {
    super(`ticket logo rejected: ${reason}`);
  }
}

export interface ProcessedLogo {
  png: Buffer;
  width: number;
  height: number;
}

/** Menos de esto no es un logotipo, es un punto. */
const MIN_SIDE = 16;

/**
 * F4-TICKETCFG-03 — de una foto cualquiera al logotipo que la térmica puede
 * imprimir. Función PURA sobre bytes, sin Nest ni Prisma: se prueba con
 * imágenes generadas.
 *
 * El orden importa:
 *  1. `rotate()` sin argumentos aplica la orientación EXIF: la foto de un
 *     celular llega «acostada» y sin esto el logotipo saldría de lado.
 *  2. `flatten` sobre blanco ANTES de convertir a gris: la transparencia en
 *     una térmica se imprime NEGRA (no hay «nada», hay papel sin tinta que
 *     el driver decide), y un PNG con fondo transparente saldría como un
 *     bloque oscuro.
 *  3. `resize` dentro de 384×160 sin agrandar: 58 mm a 203 dpi son 384
 *     puntos, y un logotipo más alto le roba el papel al número del turno.
 *  4. `grayscale` + `normalise`: el gris es lo único que el papel entiende y
 *     el normalizado estira el contraste de una foto lavada.
 *  5. PNG de paleta corta: 16 grises pesan una fracción de 256 y en la
 *     térmica se ven igual. Si aun así no cabe en 64 KB, 4 grises; si ni así,
 *     se rebota — es una imagen que no es un logotipo.
 */
export async function processTicketLogo(input: Buffer): Promise<ProcessedLogo> {
  if (input.byteLength > TICKET_LOGO_MAX_INPUT_BYTES) {
    throw new LogoRejected("too_large");
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new LogoRejected("not_image");
  }
  if (meta.width === undefined || meta.height === undefined) {
    throw new LogoRejected("not_image");
  }
  if (meta.width < MIN_SIDE || meta.height < MIN_SIDE) {
    throw new LogoRejected("too_small");
  }

  const base = sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: TICKET_LOGO_MAX_WIDTH,
      height: TICKET_LOGO_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .normalise();

  for (const colors of [16, 4]) {
    const { data, info } = await base
      .clone()
      .png({ palette: true, colors, compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength <= TICKET_LOGO_MAX_STORED_BYTES) {
      return { png: data, width: info.width, height: info.height };
    }
  }
  throw new LogoRejected("too_large");
}
