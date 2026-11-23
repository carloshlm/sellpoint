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

  /** F10-KPI-07 — hasta dos renglones de detalle: los cinco mosaicos miden lo mismo. */
  it("details pinta hasta dos renglones bajo el número", () => {
    pintar(
      <KpiCard
        label="Ventas del mes"
        value="$1,687.00"
        details={["Cierre estimado: $3,100.00", "Para tu meta: $18.41 al día", "Un tercero"]}
      />,
    );

    expect(screen.getByText("Cierre estimado: $3,100.00")).toBeInTheDocument();
    expect(screen.getByText("Para tu meta: $18.41 al día")).toBeInTheDocument();
    expect(screen.queryByText("Un tercero")).not.toBeInTheDocument();
  });

  /**
   * F10-KPI-08 — `progress`: la misma barra de la meta con otra etiqueta. El
   * dibujo se topa en 100 (y en 0), pero la etiqueta dice el número real.
   */
  describe("progress (F10-KPI-08)", () => {
    const relleno = (container: HTMLElement) =>
      container.querySelector("[data-slot='progress-fill']") as HTMLElement;

    it("pinta la barra al porcentaje con SU etiqueta, no la de la meta", () => {
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="-$2,957.81"
          progress={{ pct: 69.6, label: "69.6% de tus gastos cubiertos" }}
        />,
      );

      expect(screen.getByText("69.6% de tus gastos cubiertos")).toBeInTheDocument();
      expect(screen.queryByText(/de la meta/)).not.toBeInTheDocument();
      expect(relleno(container).style.width).toBe("69.6%");
      // La barra de la meta es otra: no aparece sin goalPct.
      expect(container.querySelector("[data-slot='goal-fill']")).toBeNull();
    });

    it("pasado el 100 se dibuja al tope y la etiqueta dice el número real", () => {
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="$300.00"
          progress={{ pct: 130, label: "130% de tus gastos cubiertos" }}
        />,
      );

      expect(screen.getByText("130% de tus gastos cubiertos")).toBeInTheDocument();
      expect(relleno(container).style.width).toBe("100%");
    });

    it("un avance negativo se dibuja vacío, no como barra llena", () => {
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="-$150.00"
          progress={{ pct: -50, label: "-50% de tus gastos cubiertos" }}
        />,
      );

      expect(relleno(container).style.width).toBe("0%");
    });

    it("cubiertos, la barra es verde y no la primaria", () => {
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="$300.00"
          progress={{ pct: 130, label: "130% de tus gastos cubiertos" }}
        />,
      );

      expect(relleno(container)).toHaveClass("bg-success");
      expect(relleno(container)).not.toHaveClass("bg-primary");
    });

    it("sin cubrir, la barra es la primaria y no verde: un avance, no una alarma", () => {
      // El caso espejo (F5-DASH-09): con cn(), dos colores en conflicto se
      // deduplican; probar solo un sentido dejaría pasar al mutante.
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="-$2,957.81"
          progress={{ pct: 69.6, label: "69.6% de tus gastos cubiertos" }}
        />,
      );

      expect(relleno(container)).toHaveClass("bg-primary");
      expect(relleno(container)).not.toHaveClass("bg-success");
      expect(relleno(container)).not.toHaveClass("bg-destructive");
    });

    it("con pct null no hay barra", () => {
      const { container } = pintar(
        <KpiCard
          label="Utilidad neta del mes"
          value="$1.00"
          progress={{ pct: null, label: "x" }}
        />,
      );

      expect(relleno(container)).toBeNull();
      expect(screen.queryByText("x")).not.toBeInTheDocument();
    });
  });
});
