import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { KpiCard } from "./kpi-card";

/**
 * F5-DASH-09 — la tarjeta que cuenta la historia: valor, delta con color
 * semántico, sparkline y barra de meta. Cada aserción protege una regla de
 * lectura: verde = mejora, «—» = aún no sé (jamás NaN), y la barra dice el
 * avance REAL aunque el dibujo se tope en 100.
 */
function pintar(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);
}

describe("KpiCard (F5-DASH-09)", () => {
  it("una delta positiva sube en verde con su flecha", () => {
    pintar(<KpiCard label="Ventas de hoy" value="$48,520.00" deltaPct={12.4} />);

    const delta = screen.getByText(/12.4%/);
    expect(delta).toHaveClass("text-success");
    expect(delta.textContent).toContain("▲");
  });

  it("una delta negativa baja en rojo", () => {
    pintar(<KpiCard label="Ventas de hoy" value="$100" deltaPct={-8} />);

    const delta = screen.getByText(/8%/);
    expect(delta).toHaveClass("text-destructive");
    expect(delta.textContent).toContain("▼");
  });

  it("invertDelta voltea el color: cuando subir es MALO, el verde miente", () => {
    pintar(<KpiCard label="Devoluciones" value="12" deltaPct={5} invertDelta />);

    const delta = screen.getByText(/5%/);
    expect(delta).toHaveClass("text-destructive");
    // Y NO el verde: un mutante que ignora invertDelta pinta LOS DOS colores
    // y pasaría un aserto que solo pide el rojo.
    expect(delta).not.toHaveClass("text-success");
  });

  it("invertDelta al bajar: menos devoluciones es VERDE", () => {
    // El caso espejo caza al mutante que tailwind-merge esconde en el otro:
    // ahí «último color gana» disimula el doble color; acá no hay disfraz.
    pintar(<KpiCard label="Devoluciones" value="8" deltaPct={-5} invertDelta />);

    expect(screen.getByText(/5%/)).toHaveClass("text-success");
  });

  it("sin valor muestra «—» y sin delta no inventa una: jamás NaN", () => {
    const { container } = pintar(<KpiCard label="Utilidad del mes" value={null} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("%");
  });

  it("la barra de meta pinta el avance y el texto dice el número real", () => {
    const { container } = pintar(
      <KpiCard label="Ventas del mes" value="$685,240" goalPct={85.7} />,
    );

    expect(screen.getByText("85.7% de la meta")).toBeInTheDocument();
    const relleno = container.querySelector("[data-slot='goal-fill']") as HTMLElement;
    expect(relleno.style.width).toBe("85.7%");
  });

  it("una meta superada se dibuja al tope pero DICE el número real", () => {
    const { container } = pintar(
      <KpiCard label="Ventas del mes" value="$900,000" goalPct={112.5} />,
    );

    expect(screen.getByText("112.5% de la meta")).toBeInTheDocument();
    const relleno = container.querySelector("[data-slot='goal-fill']") as HTMLElement;
    expect(relleno.style.width).toBe("100%");
  });

  it("la sparkline es un SVG con la serie; una serie plana no divide por cero", () => {
    const { container } = pintar(<KpiCard label="Tendencia" value="$1" sparkline={[5, 5, 5, 5]} />);

    const linea = container.querySelector("svg polyline");
    expect(linea).not.toBeNull();
    expect(linea?.getAttribute("points")).not.toContain("NaN");
  });

  it("el detalle secundario acompaña al número grande", () => {
    pintar(<KpiCard label="Ventas de hoy" value="$300" detail="2 tickets · $150 promedio" />);

    expect(screen.getByText("2 tickets · $150 promedio")).toBeInTheDocument();
  });
});
