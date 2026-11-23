import {
  salesExportQuerySchema,
  salesLinesExportQuerySchema,
  salesLinesQuerySchema,
  salesReportQuerySchema,
} from "./sales-report.dto";

/**
 * F10-KPI-11 — el filtro «Solo con descuento» del reporte de Ventas. Llega por
 * la URL como texto (`?discounted=true`) y sale del schema como booleano; lo
 * que no sea `true` o `false` es un 400, como el `belowMin` del stock.
 */
describe("los filtros del reporte de ventas", () => {
  it("`discounted=true` pide solo las ventas con descuento; `false`, todas", () => {
    expect(salesReportQuerySchema.parse({ discounted: "true" }).discounted).toBe(true);
    expect(salesReportQuerySchema.parse({ discounted: "false" }).discounted).toBe(false);
    expect(salesExportQuerySchema.parse({ discounted: "true" }).discounted).toBe(true);
  });

  it("sin `discounted`, la consulta es la de siempre: el campo ni aparece", () => {
    expect(salesReportQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(salesExportQuerySchema.parse({})).toEqual({ format: "xlsx" });
  });

  it("un valor que no es `true` ni `false` se rechaza", () => {
    expect(salesReportQuerySchema.safeParse({ discounted: "si" }).success).toBe(false);
    expect(salesExportQuerySchema.safeParse({ discounted: "1" }).success).toBe(false);
  });

  /**
   * «Ventas por producto» y «Ventas por servicio» heredan los filtros de
   * Ventas, pero el descuento no es de la línea sino del ticket: no lo
   * ofrecen, y mandarlo sigue respondiendo 400 como el día de hoy.
   */
  it("ventas por producto y por servicio siguen rechazando `discounted`", () => {
    expect(salesLinesQuerySchema.safeParse({ discounted: "true" }).success).toBe(false);
    expect(salesLinesExportQuerySchema.safeParse({ discounted: "true" }).success).toBe(false);
    expect(salesLinesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });
});
