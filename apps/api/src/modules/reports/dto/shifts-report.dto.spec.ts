import { shiftsExportQuerySchema, shiftsReportQuerySchema } from "./shifts-report.dto";

/**
 * F10-KPI-13 — el filtro «Diferencia» de Cierres de turno: con faltante, con
 * sobrante o cuadrados. Lo mismo para la tabla y para el Excel.
 */
describe("los filtros del reporte de cierres", () => {
  it("acepta los tres valores de la diferencia, en la tabla y en el export", () => {
    for (const difference of ["shortage", "overage", "balanced"] as const) {
      expect(shiftsReportQuerySchema.parse({ difference }).difference).toBe(difference);
      expect(shiftsExportQuerySchema.parse({ difference }).difference).toBe(difference);
    }
  });

  it("rechaza cualquier otro valor", () => {
    expect(shiftsReportQuerySchema.safeParse({ difference: "faltante" }).success).toBe(false);
    expect(shiftsExportQuerySchema.safeParse({ difference: "" }).success).toBe(false);
  });

  it("sin `difference`, la consulta es la de siempre", () => {
    expect(shiftsReportQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(shiftsExportQuerySchema.parse({})).toEqual({ format: "xlsx" });
  });
});
