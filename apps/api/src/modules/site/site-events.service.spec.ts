import { Logger } from "@nestjs/common";
import { SiteEventsService } from "./site-events.service";

/**
 * F11-SITE-SEO-06 — la medición propia.
 *
 * El contrato raro de este endpoint tiene una razón: `navigator.sendBeacon`
 * NO lee la respuesta. Un 400 no lo vería nadie y solo serviría para llenar
 * los logs, así que lo que no valida se descarta con el mismo 202.
 */
describe("SiteEventsService (F11-SITE-SEO-06)", () => {
  let prisma: { siteEvent: { create: jest.Mock } };
  let service: SiteEventsService;

  beforeEach(() => {
    prisma = { siteEvent: { create: jest.fn().mockResolvedValue({ id: "ev-1" }) } };
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    service = new SiteEventsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("guarda un evento válido y responde 202", async () => {
    await expect(
      service.record({ event: "cta_click", market: "mx", locale: "es", section: "hero" }),
    ).resolves.toEqual({ received: true });

    expect(prisma.siteEvent.create).toHaveBeenCalledWith({
      data: {
        event: "cta_click",
        market: "mx",
        locale: "es",
        section: "hero",
        plan: null,
        referrerDomain: null,
      },
    });
  });

  it("un evento desconocido se descarta con 202 y SIN fila", async () => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    await expect(
      service.record({ event: "scroll_depth", market: "mx", locale: "es" }),
    ).resolves.toEqual({ received: true });

    expect(prisma.siteEvent.create).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es un objeto tampoco explota", async () => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    await expect(service.record("hola")).resolves.toEqual({ received: true });
    await expect(service.record(null)).resolves.toEqual({ received: true });
    expect(prisma.siteEvent.create).not.toHaveBeenCalled();
  });

  /** La ruta y la query de un `Referer` son justo donde se filtra lo personal. */
  it("el referrer se recorta a DOMINIO en el servidor, no se cree lo que llega", async () => {
    await service.record({
      event: "form_submit",
      market: "us",
      locale: "en",
      referrerDomain: "https://www.google.com/search?q=inventory+app",
    });

    expect(prisma.siteEvent.create.mock.calls[0][0].data.referrerDomain).toBe("google.com");
  });

  it("un referrer que no parsea se guarda como NULL, nunca crudo", async () => {
    await service.record({
      event: "form_submit",
      market: "us",
      locale: "en",
      referrerDomain: "vino cualquier cosa",
    });

    expect(prisma.siteEvent.create.mock.calls[0][0].data.referrerDomain).toBeNull();
  });

  /** Un beacon no se reintenta: si la base falla, se pierde el conteo y ya. */
  it("un fallo de la base se registra pero la respuesta sigue siendo 202", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    prisma.siteEvent.create.mockRejectedValue(new Error("base caída"));

    await expect(
      service.record({ event: "form_open", market: "ca", locale: "fr" }),
    ).resolves.toEqual({ received: true });

    expect(warnSpy).toHaveBeenCalled();
  });
});
