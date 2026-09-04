import { inflateSync } from "node:zlib";

/**
 * El texto de un PDF de pdfmake: los flujos van comprimidos con zlib y el
 * texto vive en HEXADECIMAL dentro de los operadores TJ (`<436f6e…> TJ`),
 * partido en trozos para ajustar el kerning — así que se concatenan en orden.
 * Alcanza para aseverar qué dice el papel que recibe la persona, que es lo
 * que ninguna cabecera HTTP puede contar.
 */
export function textoDelPdf(pdf: Buffer): string {
  const crudo = pdf.toString("latin1");
  let texto = "";
  for (const bloque of crudo.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let flujo: string;
    try {
      flujo = inflateSync(Buffer.from(bloque[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue; // Un flujo que no es zlib (una fuente incrustada, por ejemplo).
    }
    for (const trozo of flujo.matchAll(/<([0-9a-fA-F]+)>/g)) {
      texto += Buffer.from(trozo[1] ?? "", "hex").toString("latin1");
    }
  }
  return texto;
}

/** ¿Lleva una imagen incrustada? pdfmake escribe un objeto `/Subtype /Image` por cada `image`. */
export function tieneImagen(pdf: Buffer): boolean {
  return /\/Subtype\s*\/Image/.test(pdf.toString("latin1"));
}
