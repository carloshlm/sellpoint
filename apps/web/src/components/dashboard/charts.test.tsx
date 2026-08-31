import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { ChartBars } from "./chart-bars";
import { ChartDonut } from "./chart-donut";
import { ChartLine } from "./chart-line";

/**
 * F5-DASH-08 — los TRES envoltorios de gráficas.
 *
 * Lo que se fija acá es el CONTRATO del envoltorio, no el dibujo (jsdom no
 * calcula layout — lo visual lo verifica F5-DASH-16 en el navegador):
 * cada uno monta su gráfica cuando hay datos, muestra su vacío honesto
 * cuando no, y es una región accesible con nombre.
 */
function pintar(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);
}

describe("Los envoltorios de gráficas (F5-DASH-08)", () => {
  const puntos = [
    { dia: "1", actual: 100, anterior: 80 },
    { dia: "2", actual: 150, anterior: 120 },
  ];

  it("ChartLine con datos monta la gráfica como región nombrada", () => {
    const { container } = pintar(
      <ChartLine
        label="Ventas del mes"
        data={puntos}
        xKey="dia"
        lines={[
          { dataKey: "actual", token: "primary" },
          { dataKey: "anterior", token: "muted" },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Ventas del mes" })).toBeInTheDocument();
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });

  it("ChartLine sin datos dice «Sin datos del período», no un hueco", () => {
    const { container } = pintar(
      <ChartLine label="Ventas del mes" data={[]} xKey="dia" lines={[{ dataKey: "actual" }]} />,
    );

    expect(screen.getByText("Sin datos del período")).toBeInTheDocument();
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
  });

  it("ChartBars con datos monta y sin datos muestra su vacío", () => {
    const { container, rerender } = pintar(
      <ChartBars label="Por hora" data={puntos} xKey="dia" barKey="actual" />,
    );
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();

    rerender(
      <I18nextProvider i18n={createI18n()}>
        <ChartBars label="Por hora" data={[]} xKey="dia" barKey="actual" />
      </I18nextProvider>,
    );
    expect(screen.getByText("Sin datos del período")).toBeInTheDocument();
  });

  it("ChartDonut con datos monta, y con puros ceros muestra el vacío (un donut de ceros es un aro mudo)", () => {
    const { container, rerender } = pintar(
      <ChartDonut
        label="Métodos de pago"
        data={[
          { name: "Efectivo", value: 62 },
          { name: "Tarjeta", value: 38 },
        ]}
      />,
    );
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();

    rerender(
      <I18nextProvider i18n={createI18n()}>
        <ChartDonut label="Métodos de pago" data={[{ name: "Efectivo", value: 0 }]} />
      </I18nextProvider>,
    );
    expect(screen.getByText("Sin datos del período")).toBeInTheDocument();
  });

  /**
   * El GUARDIÁN del contrato: recharts solo se importa en los envoltorios.
   * Quien lo importe directo en una pantalla se salta los tokens del tema y
   * el vacío honesto — y este test lo delata por nombre.
   */
  it("nadie importa recharts fuera de los tres envoltorios", () => {
    const raiz = join(__dirname, "../..");
    // El propio guardián contiene el texto que busca: se exime a sí mismo.
    const permitidos = new Set([
      "chart-line.tsx",
      "chart-bars.tsx",
      "chart-donut.tsx",
      "charts.test.tsx",
    ]);
    const infractores = readdirSync(raiz, { recursive: true })
      .map(String)
      .filter((ruta) => /\.(ts|tsx)$/.test(ruta) && !ruta.includes("node_modules"))
      .filter((ruta) => {
        const nombre = ruta.split("/").at(-1) ?? "";
        if (permitidos.has(nombre)) {
          return false;
        }
        return readFileSync(join(raiz, ruta), "utf8").includes('from "recharts"');
      });

    expect(infractores).toEqual([]);
  });
});
