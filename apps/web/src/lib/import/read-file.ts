/**
 * Un archivo del navegador → base64, que es como viaja el Excel dentro del
 * JSON de toda importación (productos, servicios, almacenes, subcatálogos).
 *
 * En trozos: `String.fromCharCode(...arr)` con un archivo de MB revienta el
 * stack por cantidad de argumentos.
 */
export async function readFileAsBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
