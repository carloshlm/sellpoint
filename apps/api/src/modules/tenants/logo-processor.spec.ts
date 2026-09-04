import {
  TICKET_LOGO_MAX_HEIGHT,
  TICKET_LOGO_MAX_INPUT_BYTES,
  TICKET_LOGO_MAX_STORED_BYTES,
  TICKET_LOGO_MAX_WIDTH,
} from "@sellpoint/shared";
import sharp from "sharp";
import { LogoRejected, processTicketLogo } from "./logo-processor";

/**
 * F4-TICKETCFG-03 — el procesador de logotipos es una función PURA sobre
 * bytes: lo que entra es una foto cualquiera; lo que sale es lo que la
 * térmica puede imprimir. Las imágenes se GENERAN aquí con sharp — nada
 * binario en el repo.
 */
describe("processTicketLogo (F4-TICKETCFG-03)", () => {
  jest.setTimeout(30_000);

  /** Una foto a color, ruidosa (para que pese) y grande. */
  async function fotoAColor(width: number, height: number): Promise<Buffer> {
    const ruido = Buffer.alloc(width * height * 3);
    let semilla = 7;
    for (let i = 0; i < ruido.length; i += 1) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      ruido[i] = semilla % 256;
    }
    return sharp(ruido, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 60 })
      .toBuffer();
  }

  it("una foto a color grande (más de 1 MB) sale como PNG gris, pequeño y proporcional", async () => {
    const entrada = await fotoAColor(3000, 2000);
    // Grande de verdad, pero dentro de lo que se acepta subir (2 MB).
    expect(entrada.byteLength).toBeGreaterThan(1_000_000);
    expect(entrada.byteLength).toBeLessThanOrEqual(TICKET_LOGO_MAX_INPUT_BYTES);
    const { png, width, height } = await processTicketLogo(entrada);
    expect(png.byteLength).toBeLessThanOrEqual(TICKET_LOGO_MAX_STORED_BYTES);
    expect(width).toBeLessThanOrEqual(TICKET_LOGO_MAX_WIDTH);
    expect(height).toBeLessThanOrEqual(TICKET_LOGO_MAX_HEIGHT);
    // 3:2 se conserva (tolerancia de un píxel de redondeo).
    expect(Math.abs(width / height - 1.5)).toBeLessThan(0.02);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(width);
    // Gris de verdad: los tres canales valen lo mismo en cada píxel muestreado.
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    for (let px = 0; px < 50; px += 1) {
      const i = px * Math.floor(data.length / 50 / info.channels) * info.channels;
      expect(data[i]).toBe(data[i + 1]);
      expect(data[i + 1]).toBe(data[i + 2]);
    }
  });

  it("un PNG con transparencia sale con fondo BLANCO: en térmica lo transparente se imprime negro", async () => {
    const conAlfa = await sharp({
      create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { png } = await processTicketLogo(conAlfa);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBeLessThanOrEqual(3);
    // Esquina superior izquierda: blanco.
    expect(data[0]).toBe(255);
  });

  it("una imagen pequeña no se agranda", async () => {
    const chica = await sharp({
      create: { width: 100, height: 40, channels: 3, background: "#333" },
    })
      .png()
      .toBuffer();
    const { width, height } = await processTicketLogo(chica);
    expect(width).toBe(100);
    expect(height).toBe(40);
  });

  it("lo que no es imagen rebota como not_image, sin procesar", async () => {
    await expect(processTicketLogo(Buffer.from("hola, no soy una imagen"))).rejects.toMatchObject({
      reason: "not_image",
    });
  });

  it("más de 2 MB de entrada rebota como too_large antes de tocar la imagen", async () => {
    const gigante = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    await expect(processTicketLogo(gigante)).rejects.toBeInstanceOf(LogoRejected);
    await expect(processTicketLogo(gigante)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("una imagen diminuta rebota como too_small: no hay nada que imprimir", async () => {
    const puntito = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    await expect(processTicketLogo(puntito)).rejects.toMatchObject({ reason: "too_small" });
  });
});
