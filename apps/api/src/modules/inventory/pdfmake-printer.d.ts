/**
 * `@types/pdfmake` describe la API del NAVEGADOR (`createPdf`), no la del
 * servidor. El printer de Node existe y está documentado, pero sin tipos, así
 * que se declara acá lo único que usamos.
 *
 * Se prefiere esto a un `as any` porque el contrato queda escrito: si mañana
 * la librería cambia la firma, TypeScript lo va a marcar.
 */
declare module "pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface PdfKitDocument {
    on(event: "data", listener: (chunk: Buffer) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    end(): void;
  }

  export default class PdfPrinter {
    constructor(fonts: Record<string, Record<string, string>>);
    createPdfKitDocument(definition: TDocumentDefinitions): PdfKitDocument;
  }
}
