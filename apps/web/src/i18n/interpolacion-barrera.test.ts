import { createI18n } from "./index";

/**
 * Contraprueba viva de la barrera: si alguien emite un mensaje con
 * `{{marcador}}` y NO manda su argumento, la traducción tiene que reventar en
 * tests — no pintar el marcador crudo en la pantalla del usuario.
 */
describe("barrera de interpolación", () => {
  it("traducir sin el argumento que el mensaje pide REVIENTA", () => {
    const i18n = createI18n();

    // `inventory.insufficient_stock` pide sku, available y requested.
    expect(() =>
      i18n.t("inventory.insufficient_stock", { available: "0", requested: "3" }),
    ).toThrow(/sku/);
  });

  it("con todos los argumentos, traduce y no queda ningún marcador", () => {
    const i18n = createI18n();

    const texto = i18n.t("inventory.insufficient_stock", {
      sku: "ABC-1",
      available: "0",
      requested: "3",
    });

    expect(texto).toContain("ABC-1");
    expect(texto).not.toContain("{{");
  });
});
