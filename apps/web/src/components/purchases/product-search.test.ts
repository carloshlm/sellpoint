import { presentacionInicialDe } from "./product-search";

/**
 * F10-PRESCODE — la presentación con que nace una línea de compra o de orden
 * de compra. Carlos (2026-11-23): «dar la entrada a por ejemplo la bolsa de 1
 * Kilo o la Bolsa de 10 Kilos, ya sea por código de barra o código interno».
 */
describe("presentacionInicialDe", () => {
  const presentaciones = [
    { id: "kilo", isPurchasable: false },
    { id: "bolsa-1k", isPurchasable: true },
    { id: "bolsa-10k", isPurchasable: true },
  ];

  it("la encontrada por su código gana", () => {
    expect(
      presentacionInicialDe(presentaciones, {
        matchedPresentation: { id: "bolsa-10k", name: "Bolsa 10 Kilos" },
      }),
    ).toBe("bolsa-10k");
  });

  it("sin código encontrado, la primera comprable, como antes", () => {
    expect(presentacionInicialDe(presentaciones, { matchedPresentation: null })).toBe("bolsa-1k");
    expect(presentacionInicialDe(presentaciones, {})).toBe("bolsa-1k");
  });

  it("una encontrada que no se compra no se impone: cae a la comprable", () => {
    expect(
      presentacionInicialDe(presentaciones, {
        matchedPresentation: { id: "kilo", name: "Kilogramo" },
      }),
    ).toBe("bolsa-1k");
  });

  it("sin ninguna comprable, la primera; sin presentaciones, vacío (el API cae a la base)", () => {
    expect(presentacionInicialDe([{ id: "a", isPurchasable: false }], {})).toBe("a");
    expect(presentacionInicialDe([], {})).toBe("");
  });
});
