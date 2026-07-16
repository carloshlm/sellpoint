import { describe, expect, it } from "vitest";
import { localeToBcp47 } from "./i18n";

describe("localeToBcp47", () => {
  it("maps 'es' to the Mexico-first BCP-47 tag 'es-MX'", () => {
    expect(localeToBcp47("es")).toBe("es-MX");
  });

  it("maps 'en' to the US BCP-47 tag 'en-US'", () => {
    expect(localeToBcp47("en")).toBe("en-US");
  });
});
