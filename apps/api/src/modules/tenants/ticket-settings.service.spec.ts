import { TICKET_LOGO_SVG } from "@sellpoint/shared";
import sharp from "sharp";
import { TicketSettingsService } from "./ticket-settings.service";

/**
 * F4-TICKETCFG-04 — la configuración del ticket.
 *
 * Sin fila valen los defaults. `update` hace upsert con SOLO lo mandado y
 * audita antes/después SIN el binario. `setLogo` procesa y guarda el PNG en
 * la misma fila: reemplazar ES borrar la anterior. `clearLogo` vuelve a
 * «ninguno». `leer` devuelve lo que los renderers pintan: el SVG del preset
 * o el data URL del PNG.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

const filaBase = () => ({
  tenantId: TENANT,
  showBusinessName: true,
  showTaxId: true,
  showAddress: true,
  showPhone: true,
  showWarehouse: true,
  footerMessage: null,
  logoKind: "none",
  logoPreset: null,
  logoPng: null,
  logoWidth: null,
  logoHeight: null,
});

describe("TicketSettingsService (F4-TICKETCFG-04)", () => {
  jest.setTimeout(30_000);
  let tx: { ticketSettings: { findUnique: Mock; upsert: Mock } };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: TicketSettingsService;

  beforeEach(() => {
    tx = {
      ticketSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockImplementation(({ create, update }) =>
            Promise.resolve({ ...filaBase(), ...create, ...update }),
          ),
      },
    };
    prisma = { withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new TicketSettingsService(prisma as any, audit as any);
  });

  it("sin fila: defaults, sin logotipo, y no la crea", async () => {
    await expect(service.get(USER)).resolves.toEqual({
      showBusinessName: true,
      showTaxId: true,
      showAddress: true,
      showPhone: true,
      showWarehouse: true,
      footerMessage: null,
      logo: { kind: "none" },
      logoDataUrl: null,
    });
    expect(tx.ticketSettings.upsert).not.toHaveBeenCalled();
  });

  it("update guarda SOLO lo mandado; un preset limpia los bytes; audita sin el binario", async () => {
    const res = await service.update(
      USER,
      {
        showTaxId: false,
        footerMessage: "Vuelva pronto",
        logo: { kind: "preset", preset: "pharmacy" },
      },
      META,
    );
    const { create, update } = tx.ticketSettings.upsert.mock.calls[0][0];
    expect(update).toEqual({
      showTaxId: false,
      footerMessage: "Vuelva pronto",
      logoKind: "preset",
      logoPreset: "pharmacy",
      logoPng: null,
      logoWidth: null,
      logoHeight: null,
      updatedBy: "u-1",
    });
    expect(create).toMatchObject({ tenantId: TENANT, showTaxId: false, logoPreset: "pharmacy" });
    expect(res).toMatchObject({
      showTaxId: false,
      footerMessage: "Vuelva pronto",
      logo: { kind: "preset", preset: "pharmacy" },
      logoDataUrl: null,
    });
    const auditoria = audit.record.mock.calls[0][1];
    expect(auditoria.action).toBe("tenant.ticket_settings.update");
    expect(JSON.stringify(auditoria)).not.toContain("logoPng");
    expect(auditoria.after).toMatchObject({ logo: { kind: "preset", preset: "pharmacy" } });
  });

  it("setLogo procesa la imagen, la guarda como custom en la MISMA fila y devuelve el data URL", async () => {
    const foto = await sharp({
      create: { width: 600, height: 300, channels: 3, background: "#777" },
    })
      .jpeg()
      .toBuffer();
    const res = await service.setLogo(USER, foto.toString("base64"), META);
    const { update } = tx.ticketSettings.upsert.mock.calls[0][0];
    expect(update.logoKind).toBe("custom");
    expect(update.logoPreset).toBeNull();
    expect(Buffer.isBuffer(update.logoPng)).toBe(true);
    expect(update.logoWidth).toBeLessThanOrEqual(384);
    expect(update.logoHeight).toBeLessThanOrEqual(160);
    expect(res.logo).toEqual({ kind: "custom" });
    expect(res.logoDataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    // El binario nunca viaja a la auditoría.
    expect(JSON.stringify(audit.record.mock.calls[0][1])).not.toContain("base64");
  });

  it("setLogo con algo que no es imagen rebota como 422 con su clave", async () => {
    await expect(
      service.setLogo(USER, Buffer.from("no soy imagen").toString("base64"), META),
    ).rejects.toMatchObject({ response: { message: "tenants.ticket_logo_not_image" } });
    expect(tx.ticketSettings.upsert).not.toHaveBeenCalled();
  });

  it("clearLogo deja «ninguno» y sin bytes", async () => {
    tx.ticketSettings.findUnique.mockResolvedValue({
      ...filaBase(),
      logoKind: "custom",
      logoPng: Buffer.from([1, 2, 3]),
      logoWidth: 10,
      logoHeight: 10,
    });
    const res = await service.clearLogo(USER, META);
    expect(tx.ticketSettings.upsert.mock.calls[0][0].update).toEqual({
      logoKind: "none",
      logoPreset: null,
      logoPng: null,
      logoWidth: null,
      logoHeight: null,
      updatedBy: "u-1",
    });
    expect(res.logo).toEqual({ kind: "none" });
    expect(res.logoDataUrl).toBeNull();
  });

  it("leer devuelve lo que se pinta: el SVG del preset o el data URL del PNG", async () => {
    tx.ticketSettings.findUnique.mockResolvedValue({
      ...filaBase(),
      logoKind: "preset",
      logoPreset: "cafe",
      showWarehouse: false,
    });
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial
    const conPreset = await service.leer(tx as any, TENANT);
    expect(conPreset.settings.showWarehouse).toBe(false);
    expect(conPreset.logo).toEqual({ svg: TICKET_LOGO_SVG.cafe });

    tx.ticketSettings.findUnique.mockResolvedValue({
      ...filaBase(),
      logoKind: "custom",
      logoPng: Buffer.from("png-bytes"),
      logoWidth: 100,
      logoHeight: 40,
    });
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial
    const conPng = await service.leer(tx as any, TENANT);
    expect(conPng.logo).toEqual({
      dataUrl: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
    });

    tx.ticketSettings.findUnique.mockResolvedValue(null);
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial
    const sinFila = await service.leer(tx as any, TENANT);
    expect(sinFila.logo).toBeNull();
    expect(sinFila.settings.footerMessage).toBeNull();
  });
});
