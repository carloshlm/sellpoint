import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { TICKET_LOGO_MAX_STORED_BYTES } from "@sellpoint/shared";
import sharp from "sharp";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-TICKETCFG-04 — la configuración del ticket de punta a punta: defaults sin
 * fila; una foto a color grande entra y queda gris y pequeña; reemplazarla
 * deja UNA fila (se mide `octet_length` en la base, no se confía en el JSON);
 * lo que no es imagen rebota; quitar vuelve a «ninguno»; sin `tenants:manage`
 * no se toca.
 */
describe("Configuración del ticket (F4-TICKETCFG-04)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let viewerToken: string;

  const get = (token: string) =>
    request(app.getHttpServer())
      .get("/tenants/me/ticket-settings")
      .set("Authorization", bearer(token));
  const put = (token: string, body: object) =>
    request(app.getHttpServer())
      .put("/tenants/me/ticket-settings")
      .set("Authorization", bearer(token))
      .send(body);
  const subir = (token: string, bytes: Buffer) =>
    request(app.getHttpServer())
      .put("/tenants/me/ticket-settings/logo")
      .set("Authorization", bearer(token))
      .send({ content: bytes.toString("base64") });

  const pesoEnBase = async (): Promise<{ filas: number; bytes: number | null }> =>
    prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const filas = await tx.ticketSettings.count({ where: { tenantId: negocio.tenantId } });
      const [r] = await tx.$queryRaw<{ bytes: number | null }[]>`
        SELECT octet_length(logo_png)::int AS bytes FROM ticket_settings WHERE tenant_id = ${negocio.tenantId}::uuid
      `;
      return { filas, bytes: r?.bytes ?? null };
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    negocio = await registerTenant(app, "ticket-cfg");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "ticket-cfg-viewer");
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin fila devuelve los defaults; PUT guarda toggles, pie y preset", async () => {
    const inicial = await get(negocio.token).expect(200);
    expect(inicial.body).toEqual({
      showBusinessName: true,
      showTaxId: true,
      showAddress: true,
      showPhone: true,
      showWarehouse: true,
      footerMessage: null,
      logo: { kind: "none" },
      logoDataUrl: null,
    });
    const guardado = await put(negocio.token, {
      showTaxId: false,
      footerMessage: "  Vuelva pronto  ",
      logo: { kind: "preset", preset: "pharmacy" },
    }).expect(200);
    expect(guardado.body).toMatchObject({
      showTaxId: false,
      showBusinessName: true,
      footerMessage: "Vuelva pronto",
      logo: { kind: "preset", preset: "pharmacy" },
      logoDataUrl: null,
    });
    await put(negocio.token, { logo: { kind: "preset", preset: "bank" } }).expect(400);
    await put(negocio.token, { footerMessage: "a".repeat(161) }).expect(400);
    await put(negocio.token, {}).expect(400);
    // `custom` no entra por el PUT: solo el API lo pone al subir bytes.
    await put(negocio.token, { logo: { kind: "custom" } }).expect(400);
  });

  it("una foto a color grande queda gris y pequeña; reemplazarla deja UNA fila; quitar vuelve a «ninguno»", async () => {
    const ruido = Buffer.alloc(1600 * 1000 * 3);
    let semilla = 3;
    for (let i = 0; i < ruido.length; i += 1) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      ruido[i] = semilla % 256;
    }
    const foto = await sharp(ruido, { raw: { width: 1600, height: 1000, channels: 3 } })
      .jpeg({ quality: 70 })
      .toBuffer();
    expect(foto.byteLength).toBeGreaterThan(300_000);

    const subida = await subir(negocio.token, foto).expect(200);
    expect(subida.body.logo).toEqual({ kind: "custom" });
    const dataUrl = subida.body.logoDataUrl as string;
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    expect(png.byteLength).toBeLessThanOrEqual(TICKET_LOGO_MAX_STORED_BYTES);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBeLessThanOrEqual(384);
    expect(meta.height).toBeLessThanOrEqual(160);
    const primero = await pesoEnBase();
    expect(primero.filas).toBe(1);
    expect(primero.bytes).toBe(png.byteLength);

    // GET lo devuelve igual, y el preset anterior ya no está.
    const leido = await get(negocio.token).expect(200);
    expect(leido.body.logoDataUrl).toBe(dataUrl);
    expect(leido.body.logo).toEqual({ kind: "custom" });

    // Reemplazar: otra imagen, misma fila, otro peso.
    const otra = await sharp({
      create: { width: 300, height: 120, channels: 3, background: "#222" },
    })
      .png()
      .toBuffer();
    const reemplazo = await subir(negocio.token, otra).expect(200);
    expect(reemplazo.body.logoDataUrl).not.toBe(dataUrl);
    const segundo = await pesoEnBase();
    expect(segundo.filas).toBe(1);
    expect(segundo.bytes).not.toBe(primero.bytes);

    // Lo que no es imagen rebota con su motivo, y nada cambia.
    await subir(negocio.token, Buffer.from("hola")).expect(422);
    expect((await pesoEnBase()).bytes).toBe(segundo.bytes);

    // Quitar: «ninguno» y sin bytes.
    const quitado = await request(app.getHttpServer())
      .delete("/tenants/me/ticket-settings/logo")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect(quitado.body).toMatchObject({ logo: { kind: "none" }, logoDataUrl: null });
    expect((await pesoEnBase()).bytes).toBeNull();
  });

  it("sin tenants:manage no se lee ni se cambia", async () => {
    await get(viewerToken).expect(403);
    await put(viewerToken, { showTaxId: true }).expect(403);
    await subir(viewerToken, Buffer.from("x")).expect(403);
  });
});
