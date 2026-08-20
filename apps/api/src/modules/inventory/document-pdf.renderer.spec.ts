import {
  buildDocumentDefinition,
  type PdfDocumentInput,
  type PdfRow,
} from "./document-pdf.renderer";

/**
 * F3-DOC-07 — el papel que alguien firma.
 *
 * Se testea el `docDefinition` y no el binario: lo que importa es QUÉ dice el
 * documento, y comparar bytes de un PDF sería frágil y no explicaría nada
 * cuando falle.
 */
describe("buildDocumentDefinition (F3-DOC-07)", () => {
  const t = (key: string) => key;

  const base: PdfDocumentInput = {
    tenant: {
      name: "Mi Negocio",
      legalName: "DISTRIBUIDORA DEL NORTE S.A. DE C.V.",
      taxId: "DNO010203AB4",
    },
    document: {
      folio: "ENT-000042",
      type: "entry",
      status: "confirmed",
      warehouseName: "Central",
      linkedWarehouseName: null,
      reasonCode: "invoice",
      reference: "F-88213",
      reasonNote: null,
      createdAt: new Date("2026-08-18T19:42:00Z"),
      createdByName: "Ana Ruiz",
      authorizedByName: null,
    },
    rows: [
      {
        lineNo: 1,
        sku: "PAR-500",
        name: "Paracetamol",
        presentationName: "Caja ×12",
        quantityInput: "3",
        quantityBase: "36",
        baseUnit: "unit",
        unitCost: "15.50",
        lotCode: null,
        expiresAt: null,
        location: null,
        theoretical: null,
        counted: null,
      },
    ],
  };

  /** La fila de referencia, ya estrechada: `base.rows[0]` es `PdfRow | undefined`. */
  const fila = base.rows[0] as PdfRow;

  const textos = (def: unknown): string => JSON.stringify(def);

  describe("el encabezado", () => {
    it("usa la razón social y el RFC del negocio", () => {
      const def = buildDocumentDefinition(base, t);

      expect(textos(def)).toContain("DISTRIBUIDORA DEL NORTE S.A. DE C.V.");
      expect(textos(def)).toContain("DNO010203AB4");
    });

    it("cae al nombre comercial si no hay razón social", () => {
      const def = buildDocumentDefinition(
        { ...base, tenant: { name: "Mi Negocio", legalName: null, taxId: null } },
        t,
      );

      expect(textos(def)).toContain("Mi Negocio");
    });

    it("el folio va siempre, es lo que la persona busca", () => {
      expect(textos(buildDocumentDefinition(base, t))).toContain("ENT-000042");
    });
  });

  describe("la marca de agua", () => {
    /**
     * Un papel sin marca es un papel que alguien va a firmar. Un borrador
     * impreso por error no puede parecer un documento asentado.
     */
    it("un borrador sale marcado", () => {
      const def = buildDocumentDefinition(
        { ...base, document: { ...base.document, status: "draft" } },
        t,
      );

      expect((def as { watermark?: unknown }).watermark).toBeDefined();
    });

    it("un anulado también", () => {
      const def = buildDocumentDefinition(
        { ...base, document: { ...base.document, status: "canceled" } },
        t,
      );

      expect((def as { watermark?: unknown }).watermark).toBeDefined();
    });

    it("un confirmado NO lleva marca: es el documento de verdad", () => {
      const def = buildDocumentDefinition(base, t);

      expect((def as { watermark?: unknown }).watermark).toBeUndefined();
    });
  });

  describe("el cuerpo cambia por tipo", () => {
    it("una entrada muestra presentación y costo", () => {
      const json = textos(buildDocumentDefinition(base, t));

      expect(json).toContain("Caja ×12");
      expect(json).toContain("15.50");
    });

    it("una salida NO muestra costo: no tiene precio de compra", () => {
      const json = textos(
        buildDocumentDefinition(
          {
            ...base,
            document: { ...base.document, type: "exit", reasonCode: "loss" },
            rows: [{ ...fila, unitCost: null }],
          },
          t,
        ),
      );

      expect(json).not.toContain("pdf.unitCost");
    });

    it("un inventario físico muestra teórico, contado y diferencia", () => {
      const json = textos(
        buildDocumentDefinition(
          {
            ...base,
            document: { ...base.document, type: "physical_count", reasonCode: "physical_count" },
            rows: [
              {
                ...fila,
                presentationName: null,
                unitCost: null,
                theoretical: "120",
                counted: "115",
              },
            ],
          },
          t,
        ),
      );

      expect(json).toContain("pdf.theoretical");
      expect(json).toContain("pdf.counted");
      expect(json).toContain("pdf.difference");
      // 115 − 120 = −5, y la diferencia se muestra calculada.
      expect(json).toContain("-5");
    });
  });

  describe("el pie", () => {
    it("cuenta LÍNEAS y nunca un total de unidades", () => {
      const json = textos(
        buildDocumentDefinition(
          {
            ...base,
            rows: [
              { ...fila, quantityBase: "36", baseUnit: "unit" },
              { ...fila, lineNo: 2, quantityBase: "2.5", baseUnit: "kg" },
            ],
          },
          t,
        ),
      );

      expect(json).toContain("pdf.totalLines");
      // Sumar 36 unidades + 2.5 kg daría 38.5 de nada.
      expect(json).not.toContain("38.5");
      expect(json).not.toContain("pdf.totalUnits");
    });

    it("lleva las tres líneas de firma", () => {
      const json = textos(buildDocumentDefinition(base, t));

      expect(json).toContain("pdf.deliveredBy");
      expect(json).toContain("pdf.receivedBy");
      expect(json).toContain("pdf.authorizedBy");
    });

    /**
     * Criterio de cierre de F3: «uno de 300 líneas sale paginado con el
     * encabezado repetido». `headerRows: 1` es lo que hace que pdfmake repita
     * la fila de títulos en cada hoja — sin él, de la página 2 en adelante hay
     * números sin decir de qué columna son. Estaba implementado y **sin un
     * solo test**: lo destapó ejecutar el checklist en vez de leerlo.
     */
    it("una tabla larga repite el encabezado en cada hoja", () => {
      const largo = {
        ...base,
        rows: Array.from({ length: 300 }, (_, indice) => ({
          ...(base.rows[0] as (typeof base.rows)[number]),
          lineNo: indice + 1,
        })),
      };

      const definicion = buildDocumentDefinition(largo, t) as unknown as {
        content: { table?: { headerRows?: number; body: unknown[] } }[];
      };
      const tabla = definicion.content.find((bloque) => bloque.table !== undefined)?.table;

      expect(tabla?.headerRows).toBe(1);
      // 300 líneas + la fila de encabezado.
      expect(tabla?.body).toHaveLength(301);
    });
  });
});
