/**
 * F5-HUB-01 — la secuencia de descarga de un archivo, en UN solo lugar.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────
 *
 * Vivía copiada en cuatro archivos (catálogo, inventario ×2, POS). No era una
 * duplicación cosmética: cada copia decidía por su cuenta cuándo revocar el
 * `objectURL`, y esa decisión es la que separa una descarga que funciona de
 * una ventana en blanco. Con F5 sumando seis exports más, la cuenta iba a
 * llegar a diez lugares donde equivocarse.
 *
 * ── Por qué no un `<a href>` directo al endpoint ────────────────────────
 *
 * Porque los endpoints exigen el Bearer y un enlace plano viaja sin token. Por
 * eso el archivo se pide con axios (`responseType: "blob"`) y se entrega desde
 * memoria — que además es lo que permite ponerle el nombre correcto.
 */

/**
 * Dispara la descarga de una URL que YA existe, sin revocarla.
 *
 * La primitiva de abajo, para quien todavía necesita la URL viva después del
 * clic: el ticket del POS la abre en una ventana que sigue cargando, y
 * revocarla ahí la dejaría en blanco.
 */
export function dispararDescarga(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

/**
 * El caso normal: baja el blob con ese nombre y libera la URL.
 *
 * `async` a propósito aunque hoy no espere nada: quien la llama ya está en un
 * flujo asíncrono (la respuesta de axios) y devolver una promesa deja la
 * puerta abierta a que un día haya que esperar algo —el permiso del File
 * System Access API, por ejemplo— sin cambiar a cada llamador.
 */
export async function descargarBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  dispararDescarga(url, filename);
  URL.revokeObjectURL(url);
}
