import { buildSalesWhere } from "./sales-where";

/**
 * El builder es PURO, así que se prueba sin base y sin reloj.
 *
 * Eso importa especialmente para el rango de fechas: el e2e que lo cubre
 * («una venta de HOY entra en el rango que termina hoy») solo distingue UTC de
 * CDMX durante las 6 horas en que las dos zonas están en días distintos. Una
 * contraprueba lo demostró: reemplazar `startOfDayUtc` por `new Date(from)` no
 * ponía rojo el e2e a las 5 de la tarde. Acá la zona se fija a mano y el test
 * muerde siempre.
 */
describe("buildSalesWhere", () => {
  const BASE = { tenantId: "t1", timeZone: "America/Mexico_City" };

  describe("el rango va en días del calendario del NEGOCIO", () => {
    it("el inicio del día de CDMX son las 06:00 UTC, no la medianoche UTC", async () => {
      const where = buildSalesWhere({ ...BASE, from: "2026-08-24" });

      // Si esto fuera `new Date("2026-08-24")` —medianoche UTC— el negocio
      // perdería las ventas hechas entre las 18:00 y las 24:00 del día
      // anterior, que en CDMX todavía son de ayer. Ese era el bug de «los
      // movimientos de hoy no salen».
      expect((where.createdAt as { gte: Date }).gte.toISOString()).toBe("2026-08-24T06:00:00.000Z");
    });

    it("el fin es el ARRANQUE del día siguiente, con `lt`", async () => {
      const where = buildSalesWhere({ ...BASE, to: "2026-08-24" });
      const rango = where.createdAt as { lt: Date };

      // `lt` y no `lte`: así no se pierde el último milisegundo del día.
      expect(rango.lt.toISOString()).toBe("2026-08-25T06:00:00.000Z");
    });

    it("sin fechas no filtra por instante", async () => {
      expect(buildSalesWhere(BASE)).not.toHaveProperty("createdAt");
    });
  });

  describe("el folio busca por las DOS identidades del papel", () => {
    it("un mismo texto se prueba contra el folio y contra el código de barras", () => {
      const where = buildSalesWhere({ ...BASE, folio: "20260824" });

      // Quien escanea el ticket trae el código de 12 dígitos; quien lo dicta
      // por teléfono trae el `VTA-…`. Un solo campo para los dos.
      expect(where.OR).toEqual([
        { folio: { contains: "20260824", mode: "insensitive" } },
        { barcode: { contains: "20260824" } },
      ]);
    });
  });

  describe("el alcance", () => {
    /**
     * El contrato del MOSTRADOR: sin `warehouseIds` no hay filtro de almacén.
     * La cajera tiene que encontrar el ticket que el cliente trae en la mano,
     * sin importar de qué caja salió.
     */
    it("sin alcance no filtra por almacén: es el contrato del POS", () => {
      expect(buildSalesWhere(BASE)).not.toHaveProperty("warehouseId");
    });

    it("con alcance acota a esos almacenes", () => {
      const where = buildSalesWhere({ ...BASE, warehouseIds: ["w1", "w2"] });

      expect(where.warehouseId).toEqual({ in: ["w1", "w2"] });
    });

    /**
     * ⚠ Un alcance VACÍO no es «todos»: es «ninguno». Omitir la clave dejaría
     * pasar el inventario entero justo cuando el interceptor no pudo resolver
     * el scope y degradó fail-closed.
     */
    it("un alcance vacío no devuelve nada, y no todo", () => {
      expect(buildSalesWhere({ ...BASE, warehouseIds: [] }).warehouseId).toEqual({ in: [] });
    });

    it("un almacén explícito manda sobre el alcance ya validado", () => {
      const where = buildSalesWhere({ ...BASE, warehouseId: "w1", warehouseIds: ["w1", "w2"] });

      expect(where.warehouseId).toBe("w1");
    });
  });
});
