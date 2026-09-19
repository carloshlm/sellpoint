import { AdminSiteService } from "./admin-site.service";

/**
 * F11-SITE-LEAD-08/09 — lo que el backoffice ve del sitio: la lista de
 * prospectos (solo lectura, la red para el día que un correo no llegue) y los
 * números de la medición.
 *
 * Los rangos se leen en el calendario de la PLATAFORMA (CDMX): quien mira
 * estos números es Carlos, no un negocio con su propia zona.
 */
describe("AdminSiteService (F11-SITE-LEAD-08/09)", () => {
  let prisma: {
    siteLead: { findMany: jest.Mock; count: jest.Mock };
    siteEvent: { groupBy: jest.Mock };
  };
  let service: AdminSiteService;

  const fila = (extra: Record<string, unknown> = {}) => ({
    id: "lead-1",
    createdAt: new Date("2026-09-18T20:00:00.000Z"),
    name: "Ana Pérez",
    email: "ana@example.com",
    country: "MX",
    route: "es-mx",
    planInterest: "pro",
    businessType: "Abarrotes",
    message: "Hola",
    notifiedAt: new Date("2026-09-18T20:00:01.000Z"),
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      siteLead: {
        findMany: jest.fn().mockResolvedValue([fila()]),
        count: jest.fn().mockResolvedValue(1),
      },
      siteEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    service = new AdminSiteService(prisma as any);
  });

  describe("listLeads", () => {
    it("devuelve items y total, con `notified` derivado de notified_at", async () => {
      const resultado = await service.listLeads({ page: 1, pageSize: 20 });

      expect(resultado).toEqual({
        items: [
          {
            id: "lead-1",
            createdAt: "2026-09-18T20:00:00.000Z",
            name: "Ana Pérez",
            email: "ana@example.com",
            country: "MX",
            route: "es-mx",
            planInterest: "pro",
            businessType: "Abarrotes",
            message: "Hola",
            notified: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it("sin notified_at, `notified` es false: ese es el que hay que contestar a mano", async () => {
      prisma.siteLead.findMany.mockResolvedValue([fila({ notifiedAt: null })]);

      const { items } = await service.listLeads({ page: 1, pageSize: 20 });

      expect(items[0]?.notified).toBe(false);
    });

    it("el más nuevo primero, y la página se traduce a skip/take", async () => {
      await service.listLeads({ page: 3, pageSize: 25 });

      expect(prisma.siteLead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "desc" }, skip: 50, take: 25 }),
      );
    });

    it("el rango es de DÍAS del calendario de la plataforma, con el final abierto", async () => {
      await service.listLeads({ from: "2026-09-01", to: "2026-09-30", page: 1, pageSize: 20 });

      const { where } = prisma.siteLead.findMany.mock.calls[0][0];
      // CDMX es UTC−6: el día arranca a las 06:00 UTC.
      expect((where.createdAt.gte as Date).toISOString()).toBe("2026-09-01T06:00:00.000Z");
      expect((where.createdAt.lt as Date).toISOString()).toBe("2026-10-01T06:00:00.000Z");
    });

    it("sin rango no filtra por fecha", async () => {
      await service.listLeads({ page: 1, pageSize: 20 });

      expect(prisma.siteLead.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe("eventsSummary", () => {
    const rango = { from: "2026-09-01", to: "2026-09-30" };

    function conConteos(
      porEvento: unknown[],
      porMercado: unknown[] = [],
      porOrigen: unknown[] = [],
    ) {
      prisma.siteEvent.groupBy
        .mockResolvedValueOnce(porEvento)
        .mockResolvedValueOnce(porMercado)
        .mockResolvedValueOnce(porOrigen);
    }

    it("los CINCO eventos salen siempre, en cero los que no ocurrieron", async () => {
      conConteos([{ event: "cta_click", _count: { _all: 7 } }]);

      const resumen = await service.eventsSummary(rango);

      expect(resumen.byEvent).toEqual({
        cta_click: 7,
        form_open: 0,
        form_submit: 0,
        market_change: 0,
        plans_expand: 0,
      });
      expect(resumen.byMarket).toEqual({ mx: 0, us: 0, ca: 0 });
    });

    it("la tasa de apertura a envío: de cada 100 que abren, cuántos envían", async () => {
      conConteos([
        { event: "form_open", _count: { _all: 40 } },
        { event: "form_submit", _count: { _all: 10 } },
      ]);

      expect((await service.eventsSummary(rango)).formOpenToSubmitRate).toBe(0.25);
    });

    /** Una tasa sin denominador no es cero, es nada: `null`, y el web lo pinta como «—». */
    it("sin aperturas la tasa es null, no cero", async () => {
      conConteos([{ event: "form_submit", _count: { _all: 3 } }]);

      expect((await service.eventsSummary(rango)).formOpenToSubmitRate).toBeNull();
    });

    it("el top de orígenes separa envíos de clics y ordena por la suma", async () => {
      conConteos(
        [],
        [],
        [
          { referrerDomain: "google.com", event: "form_submit", _count: { _all: 2 } },
          { referrerDomain: "google.com", event: "cta_click", _count: { _all: 5 } },
          { referrerDomain: "facebook.com", event: "cta_click", _count: { _all: 9 } },
        ],
      );

      expect((await service.eventsSummary(rango)).topReferrers).toEqual([
        { domain: "facebook.com", formSubmit: 0, ctaClick: 9, total: 9 },
        { domain: "google.com", formSubmit: 2, ctaClick: 5, total: 7 },
      ]);
    });

    it("filtrar por mercado se traslada a las tres consultas", async () => {
      conConteos([], [], []);

      await service.eventsSummary({ ...rango, market: "ca" });

      for (const [{ where }] of prisma.siteEvent.groupBy.mock.calls) {
        expect(where.market).toBe("ca");
      }
    });

    it("el resumen devuelve el rango que se le pidió", async () => {
      conConteos([], [], []);

      const resumen = await service.eventsSummary(rango);

      expect(resumen).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    });
  });
});
