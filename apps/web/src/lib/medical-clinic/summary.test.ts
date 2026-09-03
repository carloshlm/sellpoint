import { summaryOf } from "./summary";

/** F9-CLINIC-WEB-16 — lo que la tarjeta completada dice en una línea. */
describe("summaryOf", () => {
  const t = (key: string) => key.split(".").at(-1) ?? key;

  it("Datos Generales: sexo y ocupación; Motivo y Padecimiento: los primeros 80 caracteres", () => {
    expect(summaryOf("general_data", { sex: "F", occupation: "Docente" }, t)).toBe("F · Docente");
    expect(summaryOf("chief_complaint", { complaint: "Dolor de garganta" }, t)).toBe(
      "Dolor de garganta",
    );
    const largo =
      "Inicia hace tres días con dolor faríngeo intenso que empeora al deglutir y se acompaña de fiebre";
    const resumen = summaryOf("current_illness", { narrative: largo }, t);
    expect(resumen?.length).toBeLessThanOrEqual(81);
    expect(resumen?.endsWith("…")).toBe(true);
    // Corta en palabra, no a media palabra.
    expect(resumen).toBe(
      "Inicia hace tres días con dolor faríngeo intenso que empeora al deglutir y se…",
    );
  });

  it("sin datos, o en una sección sin resumen, devuelve null", () => {
    expect(summaryOf("general_data", {}, t)).toBeNull();
    expect(summaryOf("chief_complaint", { onsetValue: 3 }, t)).toBeNull();
    expect(summaryOf("allergies", { foo: "bar" }, t)).toBeNull();
  });
});
