import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCode } from "@sellpoint/shared";
import { createStudySchema } from "../medical-clinic/dto/upsert-study.dto";
import { createProductSchema } from "../products/dto/upsert-product.dto";
import { createServiceSchema } from "../services/dto/upsert-service.dto";
import { createWarehouseSchema } from "../warehouses/dto/upsert-warehouse.dto";
import { createRecordSchema } from "./dto/upsert-record.dto";

/**
 * BARRERA: todo CÓDIGO de catálogo que entra al API se normaliza a
 * MAYÚSCULAS (F9-SUPPCAT-01, Carlos 2026-09-12).
 *
 * Cada uno de estos códigos tiene un índice único por tenant SENSIBLE a
 * mayúsculas: sin normalizar, `abc` y `ABC` son dos productos, y una planilla
 * con `abc` crea un duplicado en vez de actualizar. Normalizar solo en la
 * pantalla no alcanza (una importación entra por acá). Y no basta con arreglar
 * los cinco esquemas de hoy: el barrido de abajo exige que cualquier `sku:` o
 * `code:` nuevo de estos DTOs pase por `normalizeCode`. Mismo molde que
 * `inventory/lot-code-contract.spec.ts`.
 */
describe("los códigos de catálogo se normalizan en el borde del API", () => {
  it("producto: el sku sube a mayúsculas y se recorta", () => {
    const parsed = createProductSchema.parse({ sku: " abc-01 ", name: "Uno", baseUnit: "unit" });
    expect(parsed.sku).toBe("ABC-01");
  });

  it("servicio, almacén, registro y estudio: igual", () => {
    expect(createServiceSchema.parse({ code: "corte", name: "Corte", warehouseIds: [] }).code).toBe(
      "CORTE",
    );
    expect(createWarehouseSchema.parse({ code: "alm 1", name: "Central" }).code).toBe("ALM 1");
    expect(createRecordSchema.parse({ code: "kg", attributes: {} }).code).toBe("KG");
    expect(createStudySchema.parse({ code: "bh", name: "Biometría", price: 1 }).code).toBe("BH");
  });

  it("un código que se queda vacío al limpiarlo se RECHAZA", () => {
    expect(() =>
      createServiceSchema.parse({ code: "   ", name: "Corte", warehouseIds: [] }),
    ).toThrow();
  });

  it("ningún DTO de catálogo declara un código crudo", () => {
    const archivos = [
      "dto/upsert-record.dto.ts",
      "../products/dto/upsert-product.dto.ts",
      "../services/dto/upsert-service.dto.ts",
      "../warehouses/dto/upsert-warehouse.dto.ts",
      "../medical-clinic/dto/upsert-study.dto.ts",
    ];
    const crudos = archivos.filter((archivo) => {
      const fuente = readFileSync(join(__dirname, archivo), "utf8");
      // Cada declaración `sku:` / `code:` con un zod al lado debe traer el normalizador.
      const declaraciones = fuente.match(/\b(sku|code):\s*(z\.[^\n]*|codigo[^\n]*)/g) ?? [];
      // El estudio declara `code: codigo` con el helper aparte: el archivo entero
      // tiene que traer el normalizador, no solo la línea.
      return (
        !fuente.includes("normalizeCode") ||
        declaraciones.some((d) => !d.includes("normalizeCode") && !d.startsWith("code: codigo"))
      );
    });
    expect({ sinNormalizar: crudos }).toEqual({ sinNormalizar: [] });
  });

  it("la barrera está mirando de verdad (no un barrido vacío)", () => {
    const fuente = readFileSync(join(__dirname, "dto/upsert-record.dto.ts"), "utf8");
    expect(fuente).toContain("code:");
    expect(normalizeCode("abc")).toBe("ABC");
  });
});
