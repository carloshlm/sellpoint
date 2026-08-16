import { describe, expect, it } from "vitest";
import {
  CURATED_COUNTRIES,
  CURATED_TIMEZONES,
  getCuratedTimezones,
  getDefaultCurrency,
  getTaxIdAbbreviation,
  isCuratedCountry,
} from "./markets";

describe("markets (decisiones de Carlos, 2026-08-16)", () => {
  it("son 26 países curados, sin duplicados", () => {
    expect(CURATED_COUNTRIES).toHaveLength(26);
    expect(new Set(CURATED_COUNTRIES).size).toBe(26);
  });

  it("conserva las 45 zonas horarias curadas (sin perder ninguna al reorganizar TIMEZONE_OPTIONS)", () => {
    const total = Object.values(CURATED_TIMEZONES).flat().length;
    expect(total).toBe(45);
  });

  it("isCuratedCountry: true para un país curado, false para uno fuera del catálogo", () => {
    expect(isCuratedCountry("MX")).toBe(true);
    expect(isCuratedCountry("JP")).toBe(false);
  });

  it("getCuratedTimezones: país curado con una sola zona la devuelve sola (Francia)", () => {
    expect(getCuratedTimezones("FR")).toEqual(["Europe/Paris"]);
  });

  it("getCuratedTimezones: país curado con varias zonas las devuelve todas (México)", () => {
    expect(getCuratedTimezones("MX")).toEqual([
      "America/Mexico_City",
      "America/Cancun",
      "America/Hermosillo",
      "America/Tijuana",
    ]);
  });

  it("getCuratedTimezones: país no curado devuelve undefined (el caller cae al catálogo IANA completo)", () => {
    expect(getCuratedTimezones("JP")).toBeUndefined();
  });

  it("getDefaultCurrency: MX/US/CA/EUR-zone/GB preseleccionan su moneda local", () => {
    expect(getDefaultCurrency("MX")).toBe("MXN");
    expect(getDefaultCurrency("US")).toBe("USD");
    expect(getDefaultCurrency("CA")).toBe("CAD");
    expect(getDefaultCurrency("PT")).toBe("EUR");
    expect(getDefaultCurrency("ES")).toBe("EUR");
    expect(getDefaultCurrency("FR")).toBe("EUR");
    expect(getDefaultCurrency("IT")).toBe("EUR");
    expect(getDefaultCurrency("DE")).toBe("EUR");
    expect(getDefaultCurrency("GB")).toBe("GBP");
  });

  it("getDefaultCurrency: Centro y Sudamérica preseleccionan USD (decisión operativa 2026-08-16)", () => {
    expect(getDefaultCurrency("AR")).toBe("USD");
    expect(getDefaultCurrency("BR")).toBe("USD");
    expect(getDefaultCurrency("CL")).toBe("USD");
    expect(getDefaultCurrency("CR")).toBe("USD");
  });

  it("getDefaultCurrency: un país no curado también cae a USD", () => {
    expect(getDefaultCurrency("JP")).toBe("USD");
  });

  it("getTaxIdAbbreviation: siglas exactas para MX (RFC) y CL (RUT)", () => {
    expect(getTaxIdAbbreviation("MX")).toBe("RFC");
    expect(getTaxIdAbbreviation("CL")).toBe("RUT");
  });

  it("getTaxIdAbbreviation: undefined para un país no curado (el caller usa la etiqueta genérica)", () => {
    expect(getTaxIdAbbreviation("JP")).toBeUndefined();
  });
});
