import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { exportWithLimit, MAX_EXPORT_ROWS } from "./export-guard";

/**
 * F5-CORE-02 — LA implementación del criterio «síncrono con tope».
 *
 * ── Por qué un tope y no una cola ───────────────────────────────────────
 *
 * La cola Redis + worker + S3 del viejo FLUJOS §8 quedó DIFERIDA con el
 * criterio de F4-PRINT-BT: sin un tenant real cuyos reportes desborden con
 * filtros razonables, montarla sería código de fe. El tope es la promesa que
 * sí se puede cumplir hoy.
 *
 * ── Por qué 400 y no un Excel truncado ──────────────────────────────────
 *
 * Un archivo cortado se LEE COMO COMPLETO: quien lo abre no tiene forma de
 * saber que faltan filas, y toma decisiones de inventario sobre un pedazo.
 * Es la misma clase de mentira que un `catch` vacío.
 *
 * ── Por qué el contador va SEPARADO del fetcher ─────────────────────────
 *
 * Para que las filas NO se materialicen cuando el dataset desborda. Si el
 * helper recibiera las filas ya armadas, el tope las rechazaría DESPUÉS de
 * que la base las trajo y el proceso las sostuvo en memoria — que es
 * exactamente el problema del que el tope viene a proteger.
 */
describe("exportWithLimit", () => {
  /**
   * El rechazo, ya tipado. Un `.catch((e) => e)` deja un union con el caso
   * feliz que `typecheck:full` rechaza —y peor: si la exportación NO fallara,
   * el test seguiría leyendo campos de un objeto que no es la excepción. Acá
   * la ausencia de rechazo es un fallo con nombre.
   */
  async function rechazoDe(promesa: Promise<unknown>): Promise<BadRequestException> {
    const error = await promesa.then(
      () => null,
      (e: unknown) => e as BadRequestException,
    );
    if (error === null) {
      throw new Error("se esperaba un 400 por exceder el tope y la exportación salió bien");
    }
    return error;
  }

  const CABECERA = ["folio", "total"];
  const filas = (n: number) =>
    Array.from({ length: n }, (_, i) => [`VTA-${String(i).padStart(6, "0")}`, "20.00"]);

  it("bajo el tope: exporta el archivo con cabecera y filas", async () => {
    const fetcher = jest.fn().mockResolvedValue(filas(2));

    const { body, filename, contentType } = await exportWithLimit({
      count: async () => 2,
      rows: fetcher,
      header: CABECERA,
      format: "xlsx",
      sheetName: "Ventas",
      filenameBase: "ventas",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(filename).toBe("ventas.xlsx");
    expect(contentType).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    expect(sheet?.name).toBe("Ventas");
    // Cabecera + 2 filas: el encabezado lo pone el helper, no el llamador.
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(1).getCell(1).value).toBe("folio");
  });

  /**
   * ⚠ El corazón de la tarea: sobre el tope NO se piden las filas.
   * Sin este assert, el tope sería una decoración que rechaza al final.
   */
  it("sobre el tope: 400 con la clave i18n y el fetcher NUNCA se invoca", async () => {
    const fetcher = jest.fn();

    const intento = exportWithLimit({
      count: async () => MAX_EXPORT_ROWS + 1,
      rows: fetcher,
      header: CABECERA,
      format: "xlsx",
    });

    const fallo = await rechazoDe(intento);
    expect(fallo).toBeInstanceOf(BadRequestException);
    expect((fallo.getResponse() as { message: string }).message).toBe("reports.export_too_large");
    expect(fetcher).not.toHaveBeenCalled();
  });

  /**
   * El mensaje tiene que decir CUÁNTO es demasiado y cuánto pidió: «acota los
   * filtros» sin números deja a la persona adivinando si sobran diez filas o
   * cien mil.
   */
  it("el 400 dice el tope y el tamaño real, para que «acotar» sea accionable", async () => {
    const fallo = await rechazoDe(
      exportWithLimit({
        count: async () => 25_000,
        rows: jest.fn(),
        header: CABECERA,
        format: "xlsx",
      }),
    );

    const cuerpo = fallo.getResponse() as { args: Record<string, unknown> };
    expect(cuerpo.args).toEqual({ max: MAX_EXPORT_ROWS, total: 25_000 });
  });

  it("justo EN el tope todavía exporta: el límite es inclusivo", async () => {
    const fetcher = jest.fn().mockResolvedValue(filas(1));

    await expect(
      exportWithLimit({
        count: async () => MAX_EXPORT_ROWS,
        rows: fetcher,
        header: CABECERA,
        format: "xlsx",
      }),
    ).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalled();
  });

  it("un dataset vacío exporta la planilla con solo la cabecera, no un 400", async () => {
    // Cero resultados es una respuesta legítima de un filtro, no un error: el
    // Excel con solo encabezados dice «no hay nada acá», que es la verdad.
    const { body } = await exportWithLimit({
      count: async () => 0,
      rows: async () => [],
      header: CABECERA,
      format: "xlsx",
    });

    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    expect(workbook.worksheets[0]?.rowCount).toBe(1);
  });

  it("también sirve CSV: el formato es del llamador", async () => {
    const { filename, contentType } = await exportWithLimit({
      count: async () => 1,
      rows: async () => filas(1),
      header: CABECERA,
      format: "csv",
      filenameBase: "ventas",
    });

    expect(filename).toBe("ventas.csv");
    expect(contentType).toContain("text/csv");
  });
});
