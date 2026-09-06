import { describe, expect, it } from "vitest";
import { rateToScaled, TAX_RATE_SCALE } from "./tax";
import {
  CA_REGION_NAMES,
  CA_REGIONS,
  isRegionCode,
  needsRegion,
  regionName,
  resolveTaxDefaults,
  TAX_CURATED_COUNTRIES,
  US_REGION_NAMES,
  US_REGIONS,
  US_STATE_BASE_RATE,
} from "./tax-defaults";

/**
 * F4-TAX-03 — lo que se siembra por país. Se fija lo que el recibo va a decir
 * en cada mercado y la propiedad que sostiene el índice único parcial de la
 * base: EXACTAMENTE un grupo default por combinación.
 */
describe("los tres mercados", () => {
  it("México: precio final, IVA 16% default, 8% de frontera activo, 0% y exento", () => {
    const mx = resolveTaxDefaults("MX");
    expect(mx.mode).toBe("included");
    expect(mx.groups.map((g) => [g.code, g.isDefault])).toEqual([
      ["VAT16", true],
      ["VAT8", false],
      ["VAT0", false],
      ["EXEMPT", false],
    ]);
    expect(mx.groups[0]?.name).toBe("IVA 16%");
    expect(mx.groups[3]?.rates).toEqual([]);
  });

  it("Ontario: un solo componente HST 13%", () => {
    const on = resolveTaxDefaults("CA", "ON");
    expect(on.mode).toBe("excluded");
    const def = on.groups.find((g) => g.isDefault);
    expect(def?.code).toBe("HST");
    expect(def?.rates).toEqual([{ code: "HST", name: "HST 13%", rate: "13" }]);
  });

  it("Columbia Británica: GST 5% y PST 7% por separado, y un grupo de solo GST", () => {
    const bc = resolveTaxDefaults("CA", "BC");
    const def = bc.groups.find((g) => g.isDefault);
    expect(def?.code).toBe("GST_PST");
    expect(def?.rates.map((r) => [r.code, r.rate])).toEqual([
      ["GST", "5"],
      ["PST", "7"],
    ]);
    expect(bc.groups.map((g) => g.code)).toEqual(["GST_PST", "GST_ONLY", "ZERO", "EXEMPT"]);
  });

  it("Quebec: el QST lleva cuatro decimales", () => {
    const qc = resolveTaxDefaults("CA", "QC");
    const def = qc.groups.find((g) => g.isDefault);
    expect(def?.rates[1]).toEqual({ code: "QST", name: "QST 9.975%", rate: "9.975" });
    expect(def?.name).toBe("GST 5% + QST 9.975%");
  });

  it("Nueva Escocia bajó al 14% en 2025; Manitoba le dice RST a su impuesto", () => {
    expect(resolveTaxDefaults("CA", "NS").groups[0]?.rates[0]?.rate).toBe("14");
    expect(resolveTaxDefaults("CA", "MB").groups[0]?.rates[1]?.code).toBe("RST");
  });

  it("Canadá sin provincia todavía: solo lo federal, GST 5% default", () => {
    const ca = resolveTaxDefaults("CA");
    expect(ca.groups.find((g) => g.isDefault)?.code).toBe("GST_ONLY");
    expect(resolveTaxDefaults("CA", "AB").groups.find((g) => g.isDefault)?.code).toBe("GST_ONLY");
  });

  it("Texas: la tasa estatal 6.25% como punto de partida; Oregón no cobra", () => {
    const tx = resolveTaxDefaults("US", "TX");
    expect(tx.mode).toBe("excluded");
    expect(tx.groups.find((g) => g.isDefault)).toMatchObject({
      code: "SALES_TAX",
      name: "Sales tax 6.25%",
    });
    const or = resolveTaxDefaults("US", "OR");
    expect(or.groups.find((g) => g.isDefault)?.code).toBe("NO_TAX");
    expect(resolveTaxDefaults("US").groups.find((g) => g.isDefault)?.code).toBe("NO_TAX");
  });
});

describe("el resto del mundo", () => {
  it("un país curado con IVA: precio final y su tasa estándar con su nombre", () => {
    expect(resolveTaxDefaults("ES").groups[0]).toMatchObject({
      code: "VAT21",
      name: "IVA 21%",
      isDefault: true,
    });
    expect(resolveTaxDefaults("FR").groups[0]?.name).toBe("TVA 20%");
    expect(resolveTaxDefaults("DE").groups[0]?.name).toBe("MwSt 19%");
    expect(resolveTaxDefaults("GB").groups[0]?.name).toBe("VAT 20%");
    expect(resolveTaxDefaults("PE").groups[0]?.name).toBe("IGV 18%");
    expect(resolveTaxDefaults("BZ").groups[0]?.code).toBe("VAT12_5");
  });

  it("Brasil se siembra en cero: sus tributos no caben en una tasa", () => {
    expect(resolveTaxDefaults("BR").groups.find((g) => g.isDefault)?.code).toBe("NO_TAX");
  });

  it("un país no curado (o sin país) nace sin impuesto y con precio final", () => {
    for (const pais of ["JP", null, undefined]) {
      const d = resolveTaxDefaults(pais);
      expect(d.mode).toBe("included");
      expect(d.groups).toEqual([
        { code: "NO_TAX", name: "Sin impuesto 0%", isDefault: true, rates: [] },
      ]);
    }
  });
});

describe("las propiedades que sostienen la base", () => {
  const combinaciones: [string, string | undefined][] = [
    ...TAX_CURATED_COUNTRIES.map((c): [string, string | undefined] => [c, undefined]),
    ...CA_REGIONS.map((r): [string, string | undefined] => ["CA", r]),
    ...US_REGIONS.map((r): [string, string | undefined] => ["US", r]),
    ["JP", undefined],
  ];

  it("exactamente UN default por combinación: es lo que exige el índice único parcial", () => {
    for (const [pais, region] of combinaciones) {
      const defaults = resolveTaxDefaults(pais, region).groups.filter((g) => g.isDefault);
      expect(defaults, `${pais}/${region ?? "-"}`).toHaveLength(1);
    }
  });

  it("los códigos de grupo no se repiten y toda tasa cabe en DECIMAL(7,4) entre 0 y 100", () => {
    for (const [pais, region] of combinaciones) {
      const { groups } = resolveTaxDefaults(pais, region);
      expect(new Set(groups.map((g) => g.code)).size).toBe(groups.length);
      for (const g of groups) {
        for (const r of g.rates) {
          expect(() => rateToScaled(r.rate)).not.toThrow();
          expect((r.rate.split(".")[1] ?? "").length).toBeLessThanOrEqual(TAX_RATE_SCALE);
        }
      }
    }
  });

  it("solo Canadá y Estados Unidos piden región, y solo aceptan las suyas", () => {
    expect(needsRegion("CA")).toBe(true);
    expect(needsRegion("US")).toBe(true);
    expect(needsRegion("MX")).toBe(false);
    expect(needsRegion(null)).toBe(false);
    expect(isRegionCode("CA", "BC")).toBe(true);
    expect(isRegionCode("CA", "TX")).toBe(false);
    expect(isRegionCode("US", "TX")).toBe(true);
    expect(isRegionCode("MX", "NL")).toBe(false);
    expect(CA_REGIONS).toHaveLength(13);
    expect(US_REGIONS).toHaveLength(51);
    expect(Object.keys(US_STATE_BASE_RATE)).toHaveLength(51);
  });
});

/**
 * F4-TAX-18 — el wizard y la tarjeta muestran la provincia o el estado por su
 * nombre, no por el código. Nombres oficiales en inglés: son nombres propios
 * y así los conoce quien vende ahí.
 */
describe("el nombre de la provincia o del estado (F4-TAX-18)", () => {
  it("toda región de Canadá y de Estados Unidos tiene nombre", () => {
    for (const r of CA_REGIONS) expect(CA_REGION_NAMES[r].length).toBeGreaterThan(2);
    for (const r of US_REGIONS) expect(US_REGION_NAMES[r].length).toBeGreaterThan(2);
    expect(Object.keys(CA_REGION_NAMES)).toHaveLength(CA_REGIONS.length);
    expect(Object.keys(US_REGION_NAMES)).toHaveLength(US_REGIONS.length);
  });

  it("regionName resuelve por país y devuelve undefined fuera de CA/US o con un código ajeno", () => {
    expect(regionName("CA", "BC")).toBe("British Columbia");
    expect(regionName("US", "TX")).toBe("Texas");
    expect(regionName("US", "DC")).toBe("District of Columbia");
    expect(regionName("CA", "TX")).toBeUndefined();
    expect(regionName("MX", "BC")).toBeUndefined();
  });
});
