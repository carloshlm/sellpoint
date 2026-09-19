import { Logger } from "@nestjs/common";
import type { SiteLeadInput } from "@sellpoint/shared";
import { SiteLeadsService } from "./site-leads.service";

/**
 * F11-SITE-LEAD-02/03/04/05 — el alta de un prospecto del sitio público.
 *
 * Las tres reglas que estos tests fijan:
 *  · la respuesta es SIEMPRE el mismo 202 — exista o no ese correo de antes, y
 *    haya caído o no en las trampas anti-robot;
 *  · se GUARDA primero y se avisa después: un Resend caído deja al prospecto
 *    en la base con `notified_at` en NULL, nunca lo pierde;
 *  · lo descartado no se guarda, no avisa y no deja rastro con datos de nadie.
 */
const AHORA = new Date("2026-09-18T20:00:00.000Z");

function entrada(overrides: Partial<SiteLeadInput> = {}): SiteLeadInput {
  return {
    name: "Ana Pérez",
    email: "ana@example.com",
    country: "MX",
    locale: "es",
    route: "es-mx",
    planInterest: "pro",
    businessType: "Abarrotes",
    message: "Quiero saber más.",
    sourceUrl: "https://sellpointy.com/es-mx/",
    consent: true,
    consentText: "Acepto el aviso de privacidad.",
    elapsedMs: 12_000,
    ...overrides,
  } as SiteLeadInput;
}

describe("SiteLeadsService (F11-SITE-LEAD)", () => {
  let prisma: {
    siteLead: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
  };
  let mailer: { send: jest.Mock };
  // F11-SITE-LEGAL-04: el enlace de baja del pie del acuse.
  let unsubscribes: { urlFor: jest.Mock };
  let service: SiteLeadsService;

  const config = (admins: string) =>
    ({ get: () => admins }) as unknown as ConstructorParameters<typeof SiteLeadsService>[2];

  function build(admins = "carls.hlm@gmail.com, otro@sellpointy.com"): SiteLeadsService {
    return new SiteLeadsService(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      mailer as any,
      config(admins),
      { now: () => AHORA },
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      unsubscribes as any,
    );
  }

  beforeEach(() => {
    prisma = {
      siteLead: {
        create: jest.fn().mockResolvedValue({ id: "lead-1", email: "ana@example.com" }),
        update: jest.fn().mockResolvedValue({ id: "lead-1" }),
        // Nadie dado de baja por default.
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    unsubscribes = {
      urlFor: jest.fn().mockReturnValue("https://app.example.com/api/public/unsubscribe?token=t"),
    };
    service = build();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("guarda el prospecto con el consentimiento sellado con la hora del servidor", async () => {
    await expect(service.submit(entrada())).resolves.toEqual({ received: true });

    expect(prisma.siteLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Ana Pérez",
        email: "ana@example.com",
        country: "MX",
        locale: "es",
        route: "es-mx",
        planInterest: "pro",
        businessType: "Abarrotes",
        message: "Quiero saber más.",
        sourceUrl: "https://sellpointy.com/es-mx/",
        consentAt: AHORA,
        consentText: "Acepto el aviso de privacidad.",
      }),
    });
  });

  /** Ni la trampa ni el reloj se guardan: no son del prospecto, son del robot. */
  it("no guarda la trampa ni el reloj", async () => {
    await service.submit(entrada({ website: "", elapsedMs: 12_000 }));

    const { data } = prisma.siteLead.create.mock.calls[0][0];
    expect(data).not.toHaveProperty("website");
    expect(data).not.toHaveProperty("elapsedMs");
  });

  it("avisa a CADA administrador de la plataforma, en español y con Reply-To al prospecto", async () => {
    await service.submit(entrada());

    const avisos = mailer.send.mock.calls
      .map(([m]: [{ template: string; to: string }]) => m)
      .filter((m: { template: string }) => m.template === "site-lead");

    expect(avisos.map((m: { to: string }) => m.to)).toEqual([
      "carls.hlm@gmail.com",
      "otro@sellpointy.com",
    ]);
    expect(avisos[0]).toMatchObject({
      locale: "es",
      replyTo: "ana@example.com",
      vars: expect.objectContaining({
        name: "Ana Pérez",
        email: "ana@example.com",
        country: "MX",
        planInterest: "pro",
        businessType: "Abarrotes",
        message: "Quiero saber más.",
        route: "es-mx",
        sourceUrl: "https://sellpointy.com/es-mx/",
      }),
    });
  });

  it("sella notified_at cuando el aviso salió", async () => {
    await service.submit(entrada());

    expect(prisma.siteLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { notifiedAt: AHORA },
    });
  });

  /**
   * El caso que justifica el orden «guardar primero, avisar después»: si el
   * proveedor de correo está caído, el prospecto NO se pierde.
   */
  it("si el aviso falla: la fila queda, notified_at en NULL y la respuesta sigue siendo 202", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    mailer.send.mockRejectedValue(new Error("Resend caído"));

    await expect(service.submit(entrada())).resolves.toEqual({ received: true });

    expect(prisma.siteLead.create).toHaveBeenCalled();
    expect(prisma.siteLead.update).not.toHaveBeenCalled();
  });

  it("sin administradores configurados no sella notified_at: nadie se enteró", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    service = build("");

    await expect(service.submit(entrada())).resolves.toEqual({ received: true });

    expect(prisma.siteLead.create).toHaveBeenCalled();
    expect(prisma.siteLead.update).not.toHaveBeenCalled();
  });

  describe("la respuesta automática al prospecto (LEAD-05)", () => {
    it("va en SU idioma, con el enlace para empezar la prueba", async () => {
      await service.submit(entrada({ locale: "fr", email: "luc@example.com" }));

      const acuse = mailer.send.mock.calls
        .map(([m]: [{ template: string }]) => m)
        .find((m: { template: string }) => m.template === "site-lead-reply");

      expect(acuse).toMatchObject({
        to: "luc@example.com",
        locale: "fr",
        vars: expect.objectContaining({
          name: "Ana Pérez",
          email: "luc@example.com",
          link: "https://app.sellpointy.com/register",
        }),
      });
    });

    /**
     * F11-SITE-LEGAL-04 — el acuse es el ÚNICO correo COMERCIAL del sistema:
     * lleva pie con enlace de baja, y ese enlace es de ESTE prospecto.
     */
    it("lleva su enlace de baja, armado con el id de la fila recién creada", async () => {
      await service.submit(entrada());

      expect(unsubscribes.urlFor).toHaveBeenCalledWith("lead-1", "es");
      const acuse = mailer.send.mock.calls
        .map(([m]: [{ template: string; vars: Record<string, string> }]) => m)
        .find((m: { template: string }) => m.template === "site-lead-reply");
      expect(acuse?.vars.unsubscribeUrl).toBe(
        "https://app.example.com/api/public/unsubscribe?token=t",
      );
    });

    it("quien ya se dio de baja NO recibe el acuse, aunque vuelva a escribir", async () => {
      jest.spyOn(Logger.prototype, "log").mockImplementation();
      prisma.siteLead.findFirst.mockResolvedValue({ id: "lead-viejo" });

      await expect(service.submit(entrada())).resolves.toEqual({ received: true });

      expect(prisma.siteLead.findFirst).toHaveBeenCalledWith({
        where: { email: "ana@example.com", unsubscribedAt: { not: null } },
        select: { id: true },
      });
      const acuse = mailer.send.mock.calls
        .map(([m]: [{ template: string }]) => m)
        .find((m: { template: string }) => m.template === "site-lead-reply");
      expect(acuse).toBeUndefined();
    });

    it("pero el aviso INTERNO al backoffice sí sale: eso no es comercial", async () => {
      jest.spyOn(Logger.prototype, "log").mockImplementation();
      prisma.siteLead.findFirst.mockResolvedValue({ id: "lead-viejo" });

      await service.submit(entrada());

      const aviso = mailer.send.mock.calls
        .map(([m]: [{ template: string }]) => m)
        .find((m: { template: string }) => m.template === "site-lead");
      expect(aviso).toBeDefined();
    });

    it("un fallo del acuse tampoco rompe el 202 ni desarma el aviso ya sellado", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      mailer.send.mockImplementation(({ template }: { template: string }) =>
        template === "site-lead-reply"
          ? Promise.reject(new Error("rebotó"))
          : Promise.resolve(undefined),
      );

      await expect(service.submit(entrada())).resolves.toEqual({ received: true });

      expect(prisma.siteLead.update).toHaveBeenCalled();
    });
  });

  describe("las trampas anti-robot (LEAD-03)", () => {
    it("la trampa llena: 202 idéntico, sin fila y sin correos", async () => {
      jest.spyOn(Logger.prototype, "log").mockImplementation();

      await expect(service.submit(entrada({ website: "http://spam.example" }))).resolves.toEqual({
        received: true,
      });

      expect(prisma.siteLead.create).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it("demasiado rápido: 202 idéntico, sin fila y sin correos", async () => {
      jest.spyOn(Logger.prototype, "log").mockImplementation();

      await expect(service.submit(entrada({ elapsedMs: 200 }))).resolves.toEqual({
        received: true,
      });

      expect(prisma.siteLead.create).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    /** Un log de descarte con el correo dentro sería una libreta de prospectos en los logs. */
    it("el log del descarte NO lleva datos personales", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();

      await service.submit(entrada({ website: "http://spam.example" }));

      const textos = logSpy.mock.calls.flat().join(" ");
      expect(textos).not.toContain("ana@example.com");
      expect(textos).not.toContain("Ana Pérez");
      expect(textos).toContain("honeypot");
    });
  });
});
