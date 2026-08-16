import { describe, expect, it } from "vitest";
import { type CountryCode, ISO_COUNTRY_CODES, isCountryCode } from "./countries";

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

describe("ISO_COUNTRY_CODES", () => {
  it("contains the four countries used across the app's fixtures/docs (MX, US, BR, JP)", () => {
    expect(ISO_COUNTRY_CODES).toContain("MX");
    expect(ISO_COUNTRY_CODES).toContain("US");
    expect(ISO_COUNTRY_CODES).toContain("BR");
    expect(ISO_COUNTRY_CODES).toContain("JP");
  });

  it("excludes non-ISO groupings (EU) and unassigned codes (ZZ)", () => {
    expect(ISO_COUNTRY_CODES).not.toContain("EU");
    expect(ISO_COUNTRY_CODES).not.toContain("ZZ");
  });

  it("every code matches the alpha-2 shape /^[A-Z]{2}$/", () => {
    for (const code of ISO_COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("every code resolves to a real region name via Intl.DisplayNames (no code echoed back as its own name)", () => {
    for (const code of ISO_COUNTRY_CODES) {
      expect(displayNames.of(code)).not.toBe(code);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(ISO_COUNTRY_CODES.length);
  });
});

describe("isCountryCode", () => {
  it("returns true for every code in the catalog", () => {
    for (const code of ISO_COUNTRY_CODES) {
      expect(isCountryCode(code)).toBe(true);
    }
  });

  it("returns false for a non-ISO grouping (EU)", () => {
    expect(isCountryCode("EU")).toBe(false);
  });

  it("returns false for an unassigned/reserved code (ZZ)", () => {
    expect(isCountryCode("ZZ")).toBe(false);
  });

  it("returns false for lowercase input — the catalog is uppercase-only", () => {
    expect(isCountryCode("mx")).toBe(false);
  });

  it("narrows the type: a validated value is assignable to CountryCode", () => {
    const raw: string = "MX";
    if (isCountryCode(raw)) {
      const narrowed: CountryCode = raw;
      expect(narrowed).toBe("MX");
    } else {
      throw new Error("MX should be a valid CountryCode");
    }
  });
});
