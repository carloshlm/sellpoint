import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
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

const demoUser = (permissions: string[]): AuthUser => buildAuthUser({ permissions });

async function renderDashboard(permissions: string[] = ["reports:read", "inventory:read"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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

  it("el contador de agotados navega al stock YA filtrado", async () => {
    await renderDashboard();

    const enlace = (await screen.findByText(/Agotados/)).closest("a");
    expect(enlace?.getAttribute("href")).toContain("/reports/stock");
    expect(enlace?.getAttribute("href")).toContain("belowMin=true");
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
