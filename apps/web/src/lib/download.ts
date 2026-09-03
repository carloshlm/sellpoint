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

/**
 * Abre un PDF en una ventana nueva para imprimirlo (el ticket del POS, el
 * papel del turno). Si el navegador bloquea la ventana, cae a la descarga:
 * peor imprimir en dos pasos que no poder imprimir. NO revoca la URL: la
 * ventana todavía la está cargando y revocarla la deja en blanco.
 */
export function abrirPdfParaImprimir(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const ventana = window.open(url);
  if (ventana === null) {
    dispararDescarga(url, filename);
  }
}

const PRINT_FRAME_ID = "sellpoint-print-frame";

/**
 * Imprime un PDF SIN salir de la pantalla: lo carga en un iframe oculto y
 * llama a `print()` sobre él, que abre el cuadro de impresión del navegador
 * con el papel ya cargado (Carlos, 2026-09-02: el turno «directamente el
 * cuadro de impresión»). Si el navegador no deja imprimir el iframe, cae a
 * abrirlo en una pestaña, que es lo que hace el ticket del POS.
 *
 * El iframe se queda vivo: quitarlo antes de que la persona confirme cierra
 * el cuadro. Un papel nuevo reemplaza al anterior y libera su URL.
 */
export function imprimirPdf(blob: Blob, filename: string): void {
  const previo = document.getElementById(PRINT_FRAME_ID);
  if (previo) {
    URL.revokeObjectURL(previo.getAttribute("data-url") ?? "");
    previo.remove();
  }
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.id = PRINT_FRAME_ID;
  frame.title = filename;
  frame.setAttribute("data-url", url);
  frame.setAttribute("aria-hidden", "true");
  // Tamaño cero en vez de display:none: Chrome no imprime un iframe sin caja.
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      abrirPdfParaImprimir(blob, filename);
    }
  });
  frame.src = url;
  document.body.appendChild(frame);
}
