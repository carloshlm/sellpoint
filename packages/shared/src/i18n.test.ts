import { describe, expect, it } from "vitest";
import { localeToBcp47, SUPPORTED_CURRENCIES } from "./i18n";

describe("SUPPORTED_CURRENCIES", () => {
  it("soporta exactamente MXN, USD y CAD (decisión de Carlos, 2026-08-16)", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["MXN", "USD", "CAD"]);
  });
});

describe("localeToBcp47", () => {
  it("maps 'es' to the Mexico-first BCP-47 tag 'es-MX'", () => {
    expect(localeToBcp47("es")).toBe("es-MX");
  });

  it("maps 'en' to the US BCP-47 tag 'en-US'", () => {
    expect(localeToBcp47("en")).toBe("en-US");
  });
});
