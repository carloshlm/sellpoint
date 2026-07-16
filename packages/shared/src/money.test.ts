import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats the native pair MXN/es with the shared '$' symbol (anchor)", () => {
    expect(formatMoney(1234.56, "MXN", "es")).toBe("$1,234.56");
  });

  it("formats the native pair USD/en with the shared '$' symbol", () => {
    expect(formatMoney(1234.56, "USD", "en")).toBe("$1,234.56");
  });

  it("formats the foreign pair USD/es with the ICU ISO-code fallback (pinned against Node 22)", () => {
    // es-MX has no narrow symbol mapping for USD in this ICU version, so it
    // falls back to the ISO code + NBSP (U+00A0), NOT "US$".
    expect(formatMoney(1234.56, "USD", "es")).toBe("USD\u00A01,234.56");
  });

  it("formats the foreign pair MXN/en with the disambiguating 'MX$' prefix (pinned against Node 22)", () => {
    expect(formatMoney(1234.56, "MXN", "en")).toBe("MX$1,234.56");
  });

  it("defaults to DEFAULT_CURRENCY/DEFAULT_LOCALE (MXN/es) when called with only an amount", () => {
    expect(formatMoney(1234.56)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "MXN", "es")).toBe("$0.00");
  });

  it("formats negative amounts with the ICU sign", () => {
    expect(formatMoney(-1234.56, "MXN", "es")).toBe("-$1,234.56");
  });

  it("rounds more-than-2-decimal amounts using ICU default half-expand rounding", () => {
    expect(formatMoney(1234.567, "MXN", "es")).toBe("$1,234.57");
  });

  it("throws RangeError for NaN", () => {
    expect(() => formatMoney(Number.NaN, "MXN", "es")).toThrow(RangeError);
  });

  it("throws RangeError for Infinity", () => {
    expect(() => formatMoney(Number.POSITIVE_INFINITY, "MXN", "es")).toThrow(RangeError);
  });

  it("throws RangeError for -Infinity", () => {
    expect(() => formatMoney(Number.NEGATIVE_INFINITY, "MXN", "es")).toThrow(RangeError);
  });
});
