import { localCalendarDate } from "@sellpoint/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as dashboardApi from "../lib/dashboard/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F5-DASH-11..15 — los widgets del panel y sus reglas de lectura: el filtro
 * de período gobierna a los suyos, las alertas se COMPONEN de lo ya cargado
 * (cero requests extra — se asevera contando llamadas), y cada vacío es
 * honesto.
 */
vi.mock("../lib/dashboard/api", () => ({
  getDashboardKpis: vi.fn(),
  getDashboardSeries: vi.fn(),
  getDashboardProducts: vi.fn(),
  getDashboardInventory: vi.fn(),
  getDashboardPayments: vi.fn(),
  getDashboardControl: vi.fn(),
}));
vi.mock("../lib/inventory/api", () => ({
  listExpiring: vi.fn().mockResolvedValue([]),
}));

const mocked = vi.mocked(dashboardApi);

const KPIS: dashboardApi.DashboardKpis = {
  today: { total: "1000", tickets: 4, averageTicket: "250", deltaVsLastWeekPct: -14 },
  month: { total: "50000", deltaVsPrevMonthPct: 5, goal: null, goalPct: null },
  profit: {
    month: "12000",
    deltaVsPrevMonthPct: null,
    netMonth: null,
    netDeltaVsPrevMonthPct: null,
  },
};

const SERIES: dashboardApi.DashboardSeries = {
  byDay: [
    { day: 1, current: "100", previous: "80" },
    { day: 2, current: "150", previous: "90" },
  ],
  byHour: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: hour === 11 ? "200" : "0",
  })),
};

const PRODUCTS: dashboardApi.DashboardProducts = {
  topSold: [
    {
      itemId: "p1",
      sku: "COC-600",
      name: "Coca-Cola 600ml",
      units: "842",
      unit: "unit",
      revenue: "8420",
      deltaPct: 32,
    },
    {
      itemId: "p2",
      sku: "SAB-45",
      name: "Sabritas 45g",
      units: "3",
      unit: "unit",
      revenue: "60",
      deltaPct: null,
    },
    // Se vende por peso: el API ya manda los kilos y su unidad.
    {
      itemId: "p3",
      sku: "QUE-MOZ",
      name: "Queso mozzarella",
      units: "7.7500",
      unit: "kg",
      revenue: "1627.50",
      deltaPct: null,
    },
  ],
  topProfit: [
    {
      itemId: "p2",
      sku: "SAB-45",
      name: "Sabritas 45g",
      revenue: "60",
      cost: "12",
      profit: "48",
      marginPct: 80,
    },
  ],
};

const INVENTORY: dashboardApi.DashboardInventory = {
  outOfStock: 8,
  belowMin: 27,
  inventoryValue: "1248500",
  attention: [
    {
      productId: "p1",
      sku: "COC-600",
      name: "Coca-Cola 600ml",
      stock: "3",
      stockMin: "20",
      daysLeft: 0.7,
    },
    { productId: "p3", sku: "AGU-1L", name: "Agua 1L", stock: "8", stockMin: "20", daysLeft: null },
  ],
};

const PAYMENTS: dashboardApi.DashboardPayments = {
  methods: [
    { method: "cash", total: "31000", pct: 62 },
    { method: "card", total: "19000", pct: 38 },
  ],
};

/** F10-KPI-15 — «Control» con algo en cada contador. */
const CONTROL: dashboardApi.DashboardControl = {
  cash: {
    shortage: { amount: "250.50", shifts: 2 },
    overage: { amount: "200.00", shifts: 1 },
    closedShifts: 5,
  },
  discounts: { amount: "400.00", tickets: 2, pctOfSales: 10 },
  cancellations: { count: 3, amount: "800.00" },
  range: { from: "2026-03-01", to: "2026-03-15" },
};

const demoUser = (permissions: string[], modules: string[] = []): AuthUser =>
  buildAuthUser({
    permissions,
    // F10-KPI-17: el aviso de gastos solo aparece con el módulo de Gastos.
    ...(modules.length > 0 && {
      subscription: { ...SUBSCRIPTION_PLUS, modules: modules as never },
    }),
  });

async function renderDashboard(
  permissions: string[] = ["reports:read", "inventory:read"],
  modules: string[] = [],
) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, modules));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocked)) {
    fn.mockReset();
  }
  mocked.getDashboardKpis.mockResolvedValue(KPIS);
  mocked.getDashboardSeries.mockResolvedValue(SERIES);
  mocked.getDashboardProducts.mockResolvedValue(PRODUCTS);
  mocked.getDashboardInventory.mockResolvedValue(INVENTORY);
  mocked.getDashboardPayments.mockResolvedValue(PAYMENTS);
  mocked.getDashboardControl.mockResolvedValue(CONTROL);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Los widgets del panel (F5-DASH-11..15)", () => {
  it("las dos gráficas montan con nombre; un día sin ventas muestra su vacío por hora", async () => {
    await renderDashboard();

    expect(
      await screen.findByRole("img", { name: "Ventas: mes actual vs anterior" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ventas de hoy por hora" })).toBeInTheDocument();

    // Con todo en cero, la de horas no pinta 24 barras mudas.
    mocked.getDashboardSeries.mockResolvedValue({
      ...SERIES,
      byHour: SERIES.byHour.map((h) => ({ ...h, total: "0" })),
    });
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Sin datos del período")).toBeInTheDocument();
    });
  });

  it("el filtro de período re-pide tops y pagos con el período elegido", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await screen.findByText("Más vendidos");

    await user.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => {
      expect(mocked.getDashboardProducts).toHaveBeenCalledWith("today");
      expect(mocked.getDashboardPayments).toHaveBeenCalledWith("today");
    });
  });

  it("con ventas pero sin costos, la lista de utilidad NO miente «sin ventas»", async () => {
    // El caso real de Carlos (2026-09-01): ventas previas al snapshot de
    // costo. Hay ventas — lo que no hay es costos congelados, y el vacío
    // tiene que decir ESO.
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, topProfit: [] });

    await renderDashboard();

    await screen.findByText("Mayor utilidad");
    expect(screen.getByText(/Aún sin costos congelados/)).toBeInTheDocument();
    expect(screen.queryByText("Sin ventas en el período")).not.toBeInTheDocument();
  });

  it("lo que se vende por peso dice su unidad: «7.75 kg», no «7.75 unidades»", async () => {
    await renderDashboard();
    await screen.findByText("Más vendidos");
    expect(screen.getByText("7.75 kg")).toBeInTheDocument();
    expect(screen.queryByText(/7\.75 unidades/)).not.toBeInTheDocument();
    // Lo que se cuenta sigue contándose.
    expect(screen.getByText("842 unidades")).toBeInTheDocument();
  });

  it("la unidad se escribe con su símbolo: gramos «g» y litros «L», no el código interno", async () => {
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: [
        { ...PRODUCTS.topSold[0], itemId: "g1", name: "Pimienta", units: "850.0000", unit: "gr" },
        { ...PRODUCTS.topSold[0], itemId: "l1", name: "Leche", units: "12.5000", unit: "l" },
        { ...PRODUCTS.topSold[0], itemId: "b1", name: "Jamón", units: "3.2500", unit: "lb" },
      ],
    } as dashboardApi.DashboardProducts);
    await renderDashboard();
    await screen.findByText("Más vendidos");
    expect(screen.getByText("850 g")).toBeInTheDocument();
    expect(screen.getByText("12.5 L")).toBeInTheDocument();
    expect(screen.getByText("3.25 lb")).toBeInTheDocument();
  });

  it("un API viejo que aún no manda `unit` sigue diciendo «unidades»", async () => {
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: PRODUCTS.topSold.map(({ unit: _sinUnidad, ...resto }) => resto),
    } as dashboardApi.DashboardProducts);
    await renderDashboard();
    await screen.findByText("Más vendidos");
    expect(screen.getByText("842 unidades")).toBeInTheDocument();
  });

  it("los tops cuentan las dos historias y la lista de atención predice días", async () => {
    await renderDashboard();

    await screen.findByText("Más vendidos");
    expect(screen.getAllByText("Coca-Cola 600ml").length).toBeGreaterThan(0);
    expect(screen.getByText("Mayor utilidad")).toBeInTheDocument();
    expect(screen.getByText(/80% margen/)).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("0.7 días restantes")).toBeInTheDocument();
    expect(screen.getByText("Sin ritmo de venta")).toBeInTheDocument();
    // El donut con su leyenda.
    expect(screen.getByText("62%")).toBeInTheDocument();
    // Las tres listas (dos tops + atención) viven en cajas deslizables: en un
    // celular las filas no caben y sin scroll se cortaban en el borde.
    expect(screen.getAllByTestId("scrollable-list")).toHaveLength(3);
  });

  it("las alertas se componen de lo cargado — y cada endpoint se pidió UNA sola vez", async () => {
    await renderDashboard();

    // Las cuatro reglas disparan con este escenario.
    expect(await screen.findByText(/8 productos agotados/)).toBeInTheDocument();
    expect(screen.getByText(/14% abajo del mismo día/)).toBeInTheDocument();
    expect(screen.getByText(/Coca-Cola 600ml creció 32%/)).toBeInTheDocument();
    expect(screen.getByText(/62% de tus ventas del mes es con efectivo/)).toBeInTheDocument();

    // La prueba del «cero requests extra»: alertas + widgets comparten caché.
    expect(mocked.getDashboardKpis).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardProducts).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardInventory).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(1);
    // F10-KPI-15: «Control» es la décima petición de la carga, y también una sola.
    expect(mocked.getDashboardControl).toHaveBeenCalledTimes(1);
  });

  it("sin condiciones, el bloque de alertas desaparece completo", async () => {
    mocked.getDashboardKpis.mockResolvedValue({
      ...KPIS,
      today: { ...KPIS.today, deltaVsLastWeekPct: 2 },
    });
    mocked.getDashboardProducts.mockResolvedValue({ topSold: [], topProfit: [] });
    mocked.getDashboardInventory.mockResolvedValue({ outOfStock: 0, belowMin: 0, attention: [] });
    mocked.getDashboardPayments.mockResolvedValue({
      methods: [
        { method: "cash", total: "500", pct: 50 },
        { method: "card", total: "500", pct: 50 },
      ],
    });

    await renderDashboard();

    await screen.findByText("Ventas de hoy");
    expect(screen.queryByText(/agotad/)).not.toBeInTheDocument();
    expect(screen.queryByText(/creció/)).not.toBeInTheDocument();
  });

  /**
   * Carlos (2026-11-24): «Cuando se le da clic a producto agotado desde el
   * panel debería enviar al reporte de Stock por Sucursal y que haya otro
   * filtro de checkbox que diga agotados».
   */
  it("el contador de agotados navega al stock filtrado por «Agotados»", async () => {
    await renderDashboard();

    const enlace = (await screen.findByText(/Agotados/)).closest("a");
    expect(enlace?.getAttribute("href")).toContain("/reports/stock");
    expect(enlace?.getAttribute("href")).toContain("outOfStock=true");
    expect(enlace?.getAttribute("href")).not.toContain("belowMin");
  });

  it("el contador de stock bajo sigue navegando con «Solo bajo mínimo»", async () => {
    await renderDashboard();

    const enlace = (await screen.findByText(/Stock bajo/)).closest("a");
    expect(enlace?.getAttribute("href")).toContain("/reports/stock");
    expect(enlace?.getAttribute("href")).toContain("belowMin=true");
    expect(enlace?.getAttribute("href")).not.toContain("outOfStock");
  });

  /**
   * F10-PEND-06 — a 1280 px con el menú abierto, «$53,853.00» se salía de su
   * mosaico: tres columnas en una tarjeta de media pantalla. Ahora las columnas
   * las decide el ancho de la TARJETA (consulta de contenedor), y el valor
   * ocupa el renglón entero mientras no caben tres. Lo que se ve, se verificó
   * en el navegador; esto fija la estructura.
   */
  it("el valor del inventario ocupa su renglón hasta que la tarjeta da para tres columnas", async () => {
    mocked.getDashboardInventory.mockResolvedValue({ ...INVENTORY, inventoryValue: "53853.00" });
    await renderDashboard();

    const valor = await screen.findByText("$53,853.00");
    const mosaico = valor.closest("a") as HTMLElement;
    const rejilla = mosaico.parentElement as HTMLElement;
    expect(rejilla.closest("section")?.className).toContain("@container");
    expect(rejilla.className).toContain("grid-cols-2");
    expect(rejilla.className).toContain("@lg:grid-cols-3");
    expect(rejilla.className).not.toMatch(/(^|\s)lg:grid-cols-3/);
    expect(mosaico.className).toContain("col-span-2");
    expect(mosaico.className).toContain("@lg:col-span-1");
    expect(valor.className).toContain("wrap-anywhere");
  });
});

/**
 * F10-KPI-04 — «Ventas de hoy por hora» dibuja al fondo el mismo día de las
 * últimas cuatro semanas, con su leyenda. Sin referencia, la gráfica queda
 * como estaba.
 */
const CON_REFERENCIA: dashboardApi.DashboardSeries = {
  ...SERIES,
  byHour: SERIES.byHour.map((h) => ({
    ...h,
    reference: h.hour === 11 ? "250.00" : h.hour === 15 ? "20.00" : "0",
  })),
};

/** La tarjeta de la gráfica por hora (su título es un `h2`). */
async function tarjetaPorHora(): Promise<HTMLElement> {
  const titulo = await screen.findByRole("heading", { name: "Ventas de hoy por hora" });
  return titulo.closest("section") as HTMLElement;
}

describe("F10-KPI-04: la gráfica por hora dibuja su referencia", () => {
  it("con referencia, la leyenda dice «Hoy» y «Mismo día, últimas 4 semanas»", async () => {
    mocked.getDashboardSeries.mockResolvedValue(CON_REFERENCIA);
    await renderDashboard();

    const tarjeta = await tarjetaPorHora();
    await waitFor(() => {
      expect(within(tarjeta).getByText("Mismo día, últimas 4 semanas")).toBeInTheDocument();
    });
    expect(within(tarjeta).getByText("Hoy")).toBeInTheDocument();
    expect(
      within(tarjeta).getByRole("img", { name: "Ventas de hoy por hora" }),
    ).toBeInTheDocument();
  });

  it("sin referencia (un API anterior, o null en las 24 horas) la gráfica queda como hoy", async () => {
    // SERIES no trae `reference`: así responde un API anterior.
    await renderDashboard();
    const tarjeta = await tarjetaPorHora();
    expect(
      within(tarjeta).getByRole("img", { name: "Ventas de hoy por hora" }),
    ).toBeInTheDocument();
    expect(within(tarjeta).queryByText("Mismo día, últimas 4 semanas")).not.toBeInTheDocument();
    expect(within(tarjeta).queryByText("Hoy")).not.toBeInTheDocument();

    // Y un API nuevo con un negocio sin historia: null en las 24 horas.
    cleanup();
    mocked.getDashboardSeries.mockResolvedValue({
      ...SERIES,
      byHour: SERIES.byHour.map((h) => ({ ...h, reference: null })),
    });
    await renderDashboard();
    const otra = await tarjetaPorHora();
    expect(within(otra).getByRole("img", { name: "Ventas de hoy por hora" })).toBeInTheDocument();
    expect(within(otra).queryByText("Mismo día, últimas 4 semanas")).not.toBeInTheDocument();
    expect(within(otra).queryByText("Hoy")).not.toBeInTheDocument();
  });

  it("antes de la primera venta del día, con referencia, enseña el día típico en lugar del vacío", async () => {
    mocked.getDashboardSeries.mockResolvedValue({
      ...CON_REFERENCIA,
      byHour: CON_REFERENCIA.byHour.map((h) => ({ ...h, total: "0" })),
    });
    await renderDashboard();

    const tarjeta = await tarjetaPorHora();
    await waitFor(() => {
      expect(within(tarjeta).getByText("Mismo día, últimas 4 semanas")).toBeInTheDocument();
    });
    expect(within(tarjeta).queryByText("Sin datos del período")).not.toBeInTheDocument();
  });
});

/**
 * F10-KPI-02 — bajo «Mayor utilidad», dos avisos plegables: lo que se vendió
 * por debajo de su costo y lo que se vendió sin costo. El caso de la captura
 * de Carlos del 19 de septiembre: «Fotocopia», −$2.14 y −248.8% de margen.
 */
const MARGENES: Pick<
  dashboardApi.DashboardProducts,
  "belowCost" | "belowCostCount" | "uncosted" | "uncostedCount"
> = {
  belowCost: [
    {
      itemId: "p9",
      kind: "product",
      sku: "LEC-1L",
      name: "Leche 1L",
      revenue: "50.00",
      cost: "60.00",
      profit: "-10.00",
      marginPct: -20,
    },
    {
      itemId: "s1",
      kind: "service",
      sku: "FOT",
      name: "Fotocopia",
      revenue: "0.86",
      cost: "3.00",
      profit: "-2.14",
      marginPct: -248.8,
    },
  ],
  belowCostCount: 2,
  uncosted: [
    { itemId: "p7", kind: "product", sku: "DES", name: "Despensa básica", revenue: "646.56" },
    { itemId: "s2", kind: "service", sku: "ENV", name: "Envío a domicilio", revenue: "90.51" },
  ],
  uncostedCount: 3,
};

const CON_CATALOGO = ["reports:read", "inventory:read", "products:read", "services:read"];

describe("F10-KPI-02: «Mayor utilidad» avisa lo que pierde y lo que no tiene costo", () => {
  it("lo vendido bajo costo se avisa y, al abrirlo, cada fila lleva a su ficha", async () => {
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, ...MARGENES });
    const user = userEvent.setup();
    await renderDashboard(CON_CATALOGO);

    const aviso = await screen.findByRole("button", {
      name: "2 se vendieron por debajo de su costo",
    });
    expect(aviso).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("margin-check")).not.toBeNull();
    // Cerrado, no enseña las filas.
    expect(screen.queryByRole("link", { name: "Fotocopia" })).not.toBeInTheDocument();

    await user.click(aviso);

    expect(aviso).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("-248.8% margen")).toBeInTheDocument();
    expect(screen.getByText("-20% margen")).toBeInTheDocument();
    // El producto abre su ficha; el servicio, la lista de servicios.
    const leche = screen.getByRole("link", { name: "Leche 1L" });
    expect(leche.getAttribute("href")).toContain("/catalog/products");
    expect(leche.getAttribute("href")).toContain("open=p9");
    expect(screen.getByRole("link", { name: "Fotocopia" }).getAttribute("href")).toBe(
      "/catalog/services",
    );
    // «Mayor utilidad» sigue con lo suyo.
    expect(screen.getByText("80% margen")).toBeInTheDocument();
  });

  it("lo vendido sin costo se avisa, y dice cuántos más hay fuera de la lista", async () => {
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, ...MARGENES });
    const user = userEvent.setup();
    await renderDashboard(CON_CATALOGO);

    await user.click(
      await screen.findByRole("button", {
        name: "3 se vendieron sin costo: no cuentan en tu utilidad",
      }),
    );

    expect(screen.getByRole("link", { name: "Despensa básica" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Envío a domicilio" })).toBeInTheDocument();
    expect(screen.getByText("y 1 más")).toBeInTheDocument();
  });

  it("sin permiso para ver el catálogo, el nombre se lee pero no enlaza", async () => {
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, ...MARGENES });
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(
      await screen.findByRole("button", { name: "2 se vendieron por debajo de su costo" }),
    );

    expect(screen.getByText("Leche 1L")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Leche 1L" })).not.toBeInTheDocument();
  });

  it("si nada dejó utilidad, el vacío no culpa a los costos", async () => {
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, ...MARGENES, topProfit: [] });
    await renderDashboard(CON_CATALOGO);

    expect(await screen.findByText("Nada dejó utilidad en este período.")).toBeInTheDocument();
    expect(screen.queryByText(/Aún sin costos congelados/)).not.toBeInTheDocument();
  });

  it("un API anterior, sin los campos nuevos, deja el recuadro como estaba", async () => {
    await renderDashboard(CON_CATALOGO);

    await screen.findByText("80% margen");
    expect(screen.queryByText(/por debajo de su costo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin costo:/)).not.toBeInTheDocument();
    expect(document.getElementById("margin-check")).toBeNull();
  });
});

/**
 * F10-RPT-01 — Carlos (2026-11-25): «Card Más vendidos y Mayor utilidad poner
 * algún icono que indique si son servicios o productos». El ícono es el de la
 * pantalla de Reportes y lleva su nombre, para quien no lo ve.
 */
async function renglonesDe(titulo: string): Promise<HTMLElement[]> {
  const encabezado = await screen.findByRole("heading", { name: titulo });
  return within(encabezado.closest("section") as HTMLElement).getAllByRole("listitem");
}

/** El nombre accesible del ícono de cada renglón y el nombre del artículo. */
function tiposDe(renglones: HTMLElement[]) {
  return renglones.map((li) => [
    within(li).getByRole("img").getAttribute("aria-label"),
    li.querySelector(".truncate")?.textContent,
  ]);
}

describe("F10-RPT-01: los dos tops dicen si cada renglón es producto, servicio o concepto", () => {
  const CON_TIPO: dashboardApi.DashboardProducts = {
    ...PRODUCTS,
    topSold: [
      {
        ...PRODUCTS.topSold[0],
        kind: "product",
      } as dashboardApi.DashboardProducts["topSold"][number],
      {
        ...PRODUCTS.topSold[1],
        itemId: "s1",
        name: "Corte de cabello",
        kind: "service",
      } as dashboardApi.DashboardProducts["topSold"][number],
      {
        ...PRODUCTS.topSold[2],
        itemId: "concept:flete a domicilio",
        name: "Flete a domicilio",
        unit: "unit",
        kind: "concept",
      } as dashboardApi.DashboardProducts["topSold"][number],
    ],
    topProfit: [
      {
        ...PRODUCTS.topProfit[0],
        itemId: "s1",
        name: "Corte de cabello",
        kind: "service",
      } as dashboardApi.DashboardProducts["topProfit"][number],
      {
        ...PRODUCTS.topProfit[0],
        kind: "product",
      } as dashboardApi.DashboardProducts["topProfit"][number],
    ],
  };

  it("cada renglón de «Más vendidos» lleva el ícono de su tipo, con su nombre", async () => {
    mocked.getDashboardProducts.mockResolvedValue(CON_TIPO);
    await renderDashboard();

    expect(tiposDe(await renglonesDe("Más vendidos"))).toEqual([
      ["Producto", "Coca-Cola 600ml"],
      ["Servicio", "Corte de cabello"],
      ["Concepto", "Flete a domicilio"],
    ]);
  });

  it("cada renglón de «Mayor utilidad» lleva el ícono de su tipo, con su nombre", async () => {
    mocked.getDashboardProducts.mockResolvedValue(CON_TIPO);
    await renderDashboard();

    expect(tiposDe(await renglonesDe("Mayor utilidad"))).toEqual([
      ["Servicio", "Corte de cabello"],
      ["Producto", "Sabritas 45g"],
    ]);
    expect(screen.getAllByRole("img", { name: "Servicio" })).toHaveLength(2);
  });

  it("un API anterior, sin el tipo, deja los renglones como estaban: sin ícono", async () => {
    await renderDashboard();

    const renglones = await renglonesDe("Más vendidos");
    expect(renglones).toHaveLength(3);
    for (const li of renglones) {
      expect(within(li).queryByRole("img")).not.toBeInTheDocument();
    }
    expect(screen.getByText("842 unidades")).toBeInTheDocument();
  });
});

/**
 * F10-KPI-15 — la tarjeta «Control», bajo las pestañas de periodo: tres
 * contadores que hoy exigen abrir tres reportes y sumar a mano. Cada uno lleva
 * a su reporte ya filtrado con las fechas del periodo.
 */
async function tarjetaControl(): Promise<HTMLElement> {
  const titulo = await screen.findByRole("heading", { name: "Control" });
  return titulo.closest("section") as HTMLElement;
}

/** El enlace de un contador, ya leído: la ruta y sus filtros. */
function enlaceDe(tarjeta: HTMLElement, etiqueta: string) {
  const href = within(tarjeta).getByText(etiqueta).closest("a")?.getAttribute("href") ?? "";
  const url = new URL(href, "http://panel.test");
  return { ruta: url.pathname, filtros: Object.fromEntries(url.searchParams) };
}

/** El importe grande de un contador (el renglón que sigue a su etiqueta). */
function importeDe(tarjeta: HTMLElement, etiqueta: string): HTMLElement {
  return within(tarjeta).getByText(etiqueta).nextElementSibling as HTMLElement;
}

describe("F10-KPI-15: la tarjeta «Control»", () => {
  it("dice los faltantes con sus turnos y los sobrantes aparte, los descuentos y las cancelaciones", async () => {
    await renderDashboard();

    const tarjeta = await tarjetaControl();
    await waitFor(() => {
      expect(within(tarjeta).getByText("$250.50")).toBeInTheDocument();
    });
    expect(within(tarjeta).getByText("2 turnos con faltante")).toBeInTheDocument();
    expect(within(tarjeta).getByText("Sobrantes: $200.00")).toBeInTheDocument();
    expect(within(tarjeta).getByText("$400.00")).toBeInTheDocument();
    expect(within(tarjeta).getByText("10% de tus ventas · 2 tickets")).toBeInTheDocument();
    expect(within(tarjeta).getByText("$800.00")).toBeInTheDocument();
    expect(within(tarjeta).getByText("3 ventas")).toBeInTheDocument();
  });

  // F10-KPI-18: el API redondea a un decimal; $15 de descuento sobre $40,000
  // vendidos llega como 0, y «0% de tus ventas» junto a $15.00 se contradice.
  it("un descuento que redondea a 0% dice «Menos de 0.1%», nunca «0%»", async () => {
    mocked.getDashboardControl.mockResolvedValue({
      ...CONTROL,
      discounts: { amount: "15.00", tickets: 1, pctOfSales: 0 },
    });
    await renderDashboard();

    const tarjeta = await tarjetaControl();
    expect(
      await within(tarjeta).findByText("Menos de 0.1% de tus ventas · 1 ticket"),
    ).toBeInTheDocument();
    expect(within(tarjeta).queryByText(/^0% de tus ventas/)).not.toBeInTheDocument();
  });

  it("sin descuentos sigue diciendo 0% de tus ventas", async () => {
    mocked.getDashboardControl.mockResolvedValue({
      ...CONTROL,
      discounts: { amount: "0.00", tickets: 0, pctOfSales: 0 },
    });
    await renderDashboard();

    const tarjeta = await tarjetaControl();
    expect(await within(tarjeta).findByText("0% de tus ventas · 0 tickets")).toBeInTheDocument();
  });

  it("cambiar el periodo pide el nuevo", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await tarjetaControl();
    expect(mocked.getDashboardControl).toHaveBeenCalledWith("month");

    await user.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => {
      expect(mocked.getDashboardControl).toHaveBeenCalledWith("today");
    });
  });

  it("sin reports:read no se pide ni se pinta", async () => {
    await renderDashboard(["inventory:read"]);

    // El inventario sí carga: la pantalla ya pintó lo que este rol puede ver.
    await screen.findByText("Inventario");
    expect(screen.queryByRole("heading", { name: "Control" })).not.toBeInTheDocument();
    expect(mocked.getDashboardControl).not.toHaveBeenCalled();
  });

  it("cada contador navega a su reporte ya filtrado con las fechas del periodo", async () => {
    await renderDashboard();
    const tarjeta = await tarjetaControl();
    await within(tarjeta).findByText("$250.50");

    expect(enlaceDe(tarjeta, "Faltantes de caja")).toEqual({
      ruta: "/reports/shifts",
      filtros: { difference: "shortage", from: "2026-03-01", to: "2026-03-15" },
    });
    expect(enlaceDe(tarjeta, "Descuentos")).toEqual({
      ruta: "/reports/sales",
      filtros: { status: "completed", discounted: "true", from: "2026-03-01", to: "2026-03-15" },
    });
    expect(enlaceDe(tarjeta, "Cancelaciones")).toEqual({
      ruta: "/reports/sales",
      filtros: { status: "canceled", from: "2026-03-01", to: "2026-03-15" },
    });
  });

  it("con algo que revisar, el importe va en color; en cero dice 0 en color neutro (caso espejo)", async () => {
    // Sin faltantes, pero con descuentos y cancelaciones: el color es de cada
    // contador, no de la tarjeta.
    mocked.getDashboardControl.mockResolvedValue({
      ...CONTROL,
      cash: {
        shortage: { amount: "0.00", shifts: 0 },
        overage: { amount: "0.00", shifts: 0 },
        closedShifts: 4,
      },
    });
    await renderDashboard();
    const tarjeta = await tarjetaControl();
    await within(tarjeta).findByText("0 turnos con faltante");

    const faltantes = importeDe(tarjeta, "Faltantes de caja");
    expect(faltantes).toHaveTextContent("$0.00");
    expect(faltantes).not.toHaveClass("text-destructive");
    expect(faltantes).not.toHaveClass("text-warning");
    expect(importeDe(tarjeta, "Descuentos")).toHaveClass("text-warning");
    expect(importeDe(tarjeta, "Cancelaciones")).toHaveClass("text-warning");

    // Y al revés: con faltantes va en rojo, y lo que está en cero, neutro.
    cleanup();
    mocked.getDashboardControl.mockResolvedValue({
      ...CONTROL,
      discounts: { amount: "0.00", tickets: 0, pctOfSales: null },
      cancellations: { count: 0, amount: "0.00" },
    });
    await renderDashboard();
    const otra = await tarjetaControl();
    await within(otra).findByText("0 tickets");

    expect(importeDe(otra, "Faltantes de caja")).toHaveClass("text-destructive");
    for (const etiqueta of ["Descuentos", "Cancelaciones"]) {
      const importe = importeDe(otra, etiqueta);
      expect(importe).toHaveTextContent("$0.00");
      expect(importe).not.toHaveClass("text-warning");
      expect(importe).not.toHaveClass("text-destructive");
    }
    // Sin ventas no hay porcentaje: solo los tickets, sin «null%».
    expect(within(otra).queryByText(/% de tus ventas/)).not.toBeInTheDocument();
    expect(within(otra).getByText("0 ventas")).toBeInTheDocument();
  });

  it("un API anterior, sin el endpoint, deja el panel como estaba y sin la tarjeta", async () => {
    mocked.getDashboardControl.mockRejectedValue(new Error("404"));
    await renderDashboard();

    await screen.findByText("Más vendidos");
    expect(screen.queryByRole("heading", { name: "Control" })).not.toBeInTheDocument();
  });
});

/**
 * F10-KPI-17 — cuatro avisos nuevos: faltante de caja, gastos vencidos o por
 * vencer, lo vendido bajo costo y lo vendido sin costo. Salen de `kpis` y de
 * `products` del mes, que ya están cargados; se ordenan por urgencia y se ven
 * cuatro a la vez.
 */
const SIN_ATENCION: dashboardApi.DashboardAttention = {
  payables: { overdueCount: 0, overdueAmount: "0.00", dueSoonCount: 0, dueSoonAmount: "0.00" },
  shiftShortages: {
    count: 0,
    amount: "0.00",
    range: { from: "2026-03-14", to: "2026-03-15" },
  },
};

/** Los `kpis` con lo que pide atención (el resto, como en `KPIS`). */
function conAtencion(
  atencion: {
    payables?: Partial<dashboardApi.DashboardAttention["payables"]>;
    shiftShortages?: Partial<dashboardApi.DashboardAttention["shiftShortages"]>;
  },
  base: dashboardApi.DashboardKpis = KPIS,
): dashboardApi.DashboardKpis {
  return {
    ...base,
    attention: {
      payables: { ...SIN_ATENCION.payables, ...atencion.payables },
      shiftShortages: { ...SIN_ATENCION.shiftShortages, ...atencion.shiftShortages },
    },
  };
}

/** Las condiciones de hoy que no se prueban aquí, apagadas. */
function sinLasDeSiempre() {
  mocked.getDashboardKpis.mockResolvedValue(
    conAtencion({}, { ...KPIS, today: { ...KPIS.today, deltaVsLastWeekPct: 2 } }),
  );
  mocked.getDashboardInventory.mockResolvedValue({ ...INVENTORY, outOfStock: 0 });
  mocked.getDashboardProducts.mockResolvedValue({
    ...PRODUCTS,
    topSold: PRODUCTS.topSold.map((p) => ({ ...p, deltaPct: null })),
  });
  mocked.getDashboardPayments.mockResolvedValue({
    methods: [
      { method: "cash", total: "500", pct: 50 },
      { method: "card", total: "500", pct: 50 },
    ],
  });
}

/** El renglón de un aviso: su `<li>`, por su texto. */
async function aviso(texto: RegExp): Promise<HTMLElement> {
  return (await screen.findByText(texto)).closest("li") as HTMLElement;
}

/** Los avisos a la vista, en su orden. */
function avisosALaVista(): string[] {
  return within(screen.getByRole("list", { name: "Avisos" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

const CON_GASTOS = ["reports:read", "inventory:read", "expenses:read"];

describe("F10-KPI-17: los avisos nuevos, con orden y tope", () => {
  it("caja-faltante: dice los turnos con faltante y lleva a Cierres de turno ya filtrado", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ shiftShortages: { count: 1, amount: "150.00" } }),
    );
    await renderDashboard();

    const renglon = await aviso(/1 turno cerró con faltante de \$150\.00/);
    const href = renglon.querySelector("a")?.getAttribute("href") ?? "";
    const url = new URL(href, "http://panel.test");
    expect(url.pathname).toBe("/reports/shifts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      difference: "shortage",
      from: "2026-03-14",
      to: "2026-03-15",
    });

    // Y el plural.
    cleanup();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ shiftShortages: { count: 2, amount: "300.50" } }),
    );
    await renderDashboard();
    expect(await screen.findByText(/2 turnos cerraron con faltante de \$300\.50/)).toBeVisible();
  });

  it("caja-faltante calla sin faltantes, y con un API anterior", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ payables: { dueSoonCount: 1, dueSoonAmount: "10.00" } }),
    );
    await renderDashboard(CON_GASTOS, ["expenses"]);
    await screen.findByText(/1 gasto vence esta semana/);
    // «Control» también dice «turnos con faltante»: el aviso es el que «cerró».
    expect(screen.queryByText(/cerr(ó|aron) con faltante/)).not.toBeInTheDocument();

    cleanup();
    // Un API anterior no manda `attention`: ningún aviso nuevo, ninguno roto.
    mocked.getDashboardKpis.mockResolvedValue(KPIS);
    await renderDashboard(CON_GASTOS, ["expenses"]);
    await screen.findByText(/14% abajo del mismo día/);
    expect(screen.queryByText(/cerr(ó|aron) con faltante|gastos? venc/)).not.toBeInTheDocument();
  });

  it("gastos vencidos: con el módulo de Gastos, al listado con Pago: Pendiente", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ payables: { overdueCount: 2, overdueAmount: "1850.00" } }),
    );
    await renderDashboard(CON_GASTOS, ["expenses"]);

    const renglon = await aviso(/2 gastos vencidos sin pagar \(\$1,850\.00\)/);
    expect(renglon.querySelector("a")?.getAttribute("href")).toBe(
      "/expenses?paymentStatus=pending",
    );
    expect(screen.queryByText(/vencen? esta semana/)).not.toBeInTheDocument();
  });

  it("gastos por vencer: «vencen esta semana», con su singular", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ payables: { dueSoonCount: 3, dueSoonAmount: "4200.00" } }),
    );
    await renderDashboard(CON_GASTOS, ["expenses"]);

    const renglon = await aviso(/3 gastos vencen esta semana \(\$4,200\.00\)/);
    expect(renglon.querySelector("a")?.getAttribute("href")).toBe(
      "/expenses?paymentStatus=pending",
    );
    expect(screen.queryByText(/vencidos? sin pagar/)).not.toBeInTheDocument();

    cleanup();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ payables: { overdueCount: 1, overdueAmount: "99.00" } }),
    );
    await renderDashboard(CON_GASTOS, ["expenses"]);
    expect(await screen.findByText(/1 gasto vencido sin pagar \(\$99\.00\)/)).toBeVisible();
  });

  it("los avisos de gastos: sin el módulo no aparecen, y sin expenses:read no enlazan", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({
        payables: { overdueCount: 2, overdueAmount: "1850.00" },
        shiftShortages: { count: 1, amount: "150.00" },
      }),
    );
    // Sin el módulo de Gastos: el API los calcula, el panel no los dice.
    await renderDashboard(CON_GASTOS);
    await screen.findByText(/1 turno cerró con faltante/);
    expect(screen.queryByText(/gastos vencidos/)).not.toBeInTheDocument();

    cleanup();
    // Con el módulo pero sin permiso para ver Gastos: el aviso se lee, no enlaza.
    await renderDashboard(["reports:read", "inventory:read"], ["expenses"]);
    const renglon = await aviso(/2 gastos vencidos sin pagar/);
    expect(renglon.querySelector("a")).toBeNull();
  });

  it("bajo-costo: dice cuántos se vendieron por debajo de su costo y lleva a «Mayor utilidad»", async () => {
    sinLasDeSiempre();
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: [],
      belowCost: MARGENES.belowCost?.slice(0, 1),
      belowCostCount: 1,
    });
    await renderDashboard();

    const renglon = await aviso(/1 producto se vendió por debajo de su costo/);
    expect(renglon.querySelector("a")?.getAttribute("href")).toBe("/dashboard#margin-check");

    cleanup();
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: [],
      ...MARGENES,
      uncosted: [],
      uncostedCount: 0,
    });
    await renderDashboard();
    expect(
      await screen.findByText(/2 productos se vendieron por debajo de su costo/),
    ).toBeVisible();
  });

  it("sin-costo: dice cuántos productos del mes no tienen costo, y lleva a la misma ancla", async () => {
    sinLasDeSiempre();
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: [],
      uncosted: MARGENES.uncosted,
      uncostedCount: 12,
    });
    await renderDashboard();

    const renglon = await aviso(
      /12 productos vendidos este mes no tienen costo: tu utilidad está incompleta/,
    );
    expect(renglon.querySelector("a")?.getAttribute("href")).toBe("/dashboard#margin-check");
    expect(screen.queryByText(/por debajo de su costo/)).not.toBeInTheDocument();
  });

  it("bajo-costo y sin-costo callan sin lo suyo, y con un API anterior", async () => {
    sinLasDeSiempre();
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({ shiftShortages: { count: 1, amount: "150.00" } }),
    );
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: [],
      belowCost: [],
      belowCostCount: 0,
      uncosted: [],
      uncostedCount: 0,
    });
    await renderDashboard();
    await screen.findByText(/1 turno cerró con faltante/);
    expect(screen.queryByText(/por debajo de su costo|no tienen? costo/)).not.toBeInTheDocument();

    cleanup();
    // `PRODUCTS` es la forma de un API anterior: sin `belowCost` ni `uncosted`.
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, topSold: [] });
    await renderDashboard();
    await screen.findByText(/1 turno cerró con faltante/);
    expect(screen.queryByText(/por debajo de su costo|no tienen? costo/)).not.toBeInTheDocument();
  });

  it("con seis condiciones se ven cuatro, en el orden de urgencia, y «Ver 2 más» despliega el resto", async () => {
    // Faltante, vencidos, bajo costo, agotados, por vencer y ventas abajo.
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({
        shiftShortages: { count: 1, amount: "150.00" },
        payables: {
          overdueCount: 2,
          overdueAmount: "1850.00",
          dueSoonCount: 3,
          dueSoonAmount: "4200.00",
        },
      }),
    );
    mocked.getDashboardProducts.mockResolvedValue({
      ...PRODUCTS,
      topSold: PRODUCTS.topSold.map((p) => ({ ...p, deltaPct: null })),
      belowCost: MARGENES.belowCost?.slice(0, 1),
      belowCostCount: 1,
    });
    mocked.getDashboardPayments.mockResolvedValue({
      methods: [
        { method: "cash", total: "500", pct: 50 },
        { method: "card", total: "500", pct: 50 },
      ],
    });
    const user = userEvent.setup();
    await renderDashboard(CON_GASTOS, ["expenses"]);
    await screen.findByText(/1 turno cerró con faltante/);

    const visibles = avisosALaVista();
    expect(visibles).toHaveLength(4);
    expect(visibles[0]).toMatch(/turno cerró con faltante/);
    expect(visibles[1]).toMatch(/gastos vencidos sin pagar/);
    expect(visibles[2]).toMatch(/se vendió por debajo de su costo/);
    expect(visibles[3]).toMatch(/productos agotados/);
    expect(screen.queryByText(/vencen esta semana/)).not.toBeInTheDocument();
    expect(screen.queryByText(/abajo del mismo día/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ver 2 más" }));

    const todos = avisosALaVista();
    expect(todos).toHaveLength(6);
    expect(todos[4]).toMatch(/gastos vencen esta semana/);
    expect(todos[5]).toMatch(/14% abajo del mismo día/);
    expect(screen.queryByRole("button", { name: /^Ver \d+ más$/ })).not.toBeInTheDocument();
  });

  it("con las nueve, el orden completo es el de urgencia y nada se pide de más", async () => {
    mocked.getDashboardKpis.mockResolvedValue(
      conAtencion({
        shiftShortages: { count: 1, amount: "150.00" },
        payables: {
          overdueCount: 2,
          overdueAmount: "1850.00",
          dueSoonCount: 3,
          dueSoonAmount: "4200.00",
        },
      }),
    );
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, ...MARGENES });
    const user = userEvent.setup();
    await renderDashboard(CON_GASTOS, ["expenses"]);
    await screen.findByText(/1 turno cerró con faltante/);

    await user.click(screen.getByRole("button", { name: "Ver 5 más" }));

    const orden = avisosALaVista();
    const esperado = [
      /turno cerró con faltante/,
      /gastos vencidos sin pagar/,
      /productos se vendieron por debajo de su costo/,
      /productos agotados/,
      /gastos vencen esta semana/,
      /abajo del mismo día/,
      /productos vendidos este mes no tienen costo/,
      /Coca-Cola 600ml creció 32%/,
      /de tus ventas del mes es con efectivo/,
    ];
    expect(orden).toHaveLength(esperado.length);
    esperado.forEach((patron, i) => {
      expect(orden[i]).toMatch(patron);
    });

    // Ningún aviso nuevo pidió nada: cada fuente, UNA vez.
    expect(mocked.getDashboardKpis).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardProducts).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardInventory).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardControl).toHaveBeenCalledTimes(1);
  });
});

/**
 * F10-RPT-02 — Carlos (2026-11-25): «En el panel donde sale el mensaje "X
 * producto o servicio creció % sus ventas este mes" Ese elemento al darle
 * click debería enviar al reporte de Ventas por producto o ventas por
 * servicio».
 */
describe("F10-RPT-02: el aviso «creció» lleva a las ventas de ese artículo", () => {
  const ITEM_ID = "3f2b9c1e-8d4a-4b6f-9a1c-2e7d5f0a1b3c";

  /** El mes del aviso en el calendario del negocio (`buildTenantBlock`: CDMX). */
  const hoy = () => localCalendarDate("America/Mexico_City", new Date());
  const inicioDeMes = () => `${hoy().slice(0, 7)}-01`;

  /** Solo el aviso «creció» dispara, con la estrella del tipo pedido. */
  function soloLaEstrella(kind: dashboardApi.SoldItemKind | undefined, itemId = ITEM_ID) {
    sinLasDeSiempre();
    const estrella = {
      ...PRODUCTS.topSold[0],
      itemId,
      name: "Corte de cabello",
      deltaPct: 32,
      ...(kind !== undefined && { kind }),
    } as dashboardApi.DashboardProducts["topSold"][number];
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, topSold: [estrella] });
  }

  /** El enlace del aviso, ya leído: la ruta y sus filtros. */
  async function enlaceDelAviso() {
    const renglon = await aviso(/Corte de cabello creció 32%/);
    const href = renglon.querySelector("a")?.getAttribute("href") ?? "";
    const url = new URL(href, "http://panel.test");
    return { ruta: url.pathname, filtros: Object.fromEntries(url.searchParams) };
  }

  it("un producto lleva a «Ventas por producto» con su id y las fechas del mes", async () => {
    soloLaEstrella("product");
    await renderDashboard();

    expect(await enlaceDelAviso()).toEqual({
      ruta: "/reports/sales-by-product",
      filtros: { itemId: ITEM_ID, from: inicioDeMes(), to: hoy() },
    });
  });

  it("un servicio lleva a «Ventas por servicio» con su id y las fechas del mes", async () => {
    soloLaEstrella("service");
    await renderDashboard();

    expect(await enlaceDelAviso()).toEqual({
      ruta: "/reports/sales-by-service",
      filtros: { itemId: ITEM_ID, from: inicioDeMes(), to: hoy() },
    });
  });

  it("un concepto, o un API anterior sin el tipo, lleva a «Ventas por producto» sin artículo", async () => {
    soloLaEstrella("concept", "concept:flete a domicilio");
    await renderDashboard();
    expect(await enlaceDelAviso()).toEqual({
      ruta: "/reports/sales-by-product",
      filtros: { from: inicioDeMes(), to: hoy() },
    });

    cleanup();
    soloLaEstrella(undefined);
    await renderDashboard();
    expect(await enlaceDelAviso()).toEqual({
      ruta: "/reports/sales-by-product",
      filtros: { from: inicioDeMes(), to: hoy() },
    });
  });

  it("los demás avisos siguen yendo a donde iban", async () => {
    await renderDashboard();

    const metodo = await aviso(/62% de tus ventas del mes es con efectivo/);
    expect(metodo.querySelector("a")?.getAttribute("href")).toBe("/reports/sales");
    const abajo = await aviso(/14% abajo del mismo día/);
    expect(abajo.querySelector("a")?.getAttribute("href")).toBe("/reports/sales");
  });
});
