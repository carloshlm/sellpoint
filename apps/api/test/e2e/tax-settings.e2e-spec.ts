import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  crearProducto,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-TAX-09 — la configuración de impuestos de punta a punta: viaje redondo
 * del PUT, ids estables, el default se mueve sin romper el índice, un grupo
 * ausente se desactiva, uno con artículos no se borra, la región se valida
 * contra el país, y sin `tenants:manage` no se toca.
 */
describe("Configuración de impuestos (F4-TAX-09)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let viewerToken: string;

  const get = (token: string) =>
    request(app.getHttpServer()).get("/tenants/me/taxes").set("Authorization", bearer(token));
  const put = (token: string, body: object) =>
    request(app.getHttpServer())
      .put("/tenants/me/taxes")
      .set("Authorization", bearer(token))
      .send(body);
  const borrar = (token: string, code: string) =>
    request(app.getHttpServer())
      .delete(`/tenants/me/taxes/groups/${code}`)
      .set("Authorization", bearer(token));

  type Vista = {
    mode: string;
    region: string | null;
    needsRegion: boolean;
    groups: {
      id: string;
      code: string;
      isDefault: boolean;
      isActive: boolean;
      usageCount: number;
      rates: { code: string; rate: string }[];
    }[];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    negocio = await registerTenant(app, "tax-cfg");
    await setTenantMarket(prisma, negocio.tenantId, "CA");
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "tax-cfg-viewer");
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin grupos devuelve el modo del negocio y una lista vacía; Canadá pide región", async () => {
    const res = await get(negocio.token).expect(200);
    expect(res.body).toMatchObject({
      mode: "included",
      costMode: "excluded",
      region: null,
      needsRegion: true,
      hasSales: false,
      hasCosts: false,
      groups: [],
    });
  });

  it("el modo del COSTO viaja solo, se audita, llega a /me y avisa cuando ya hay costos (F9-COSTMODE-02)", async () => {
    // Solo `costMode` en el body: antes era `empty_update`.
    const solo = await put(negocio.token, { costMode: "included" }).expect(200);
    expect(solo.body).toMatchObject({ mode: "included", costMode: "included" });
    await put(negocio.token, { costMode: "raro" }).expect(400);

    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((me.body as { tenant: { costTaxMode: string } }).tenant.costTaxMode).toBe("included");

    const audit = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: negocio.tenantId, action: "tenant.tax_settings.update" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(audit?.before).toMatchObject({ costMode: "excluded" });
    expect(audit?.after).toMatchObject({ costMode: "included" });

    // Un costo capturado en el catálogo: la vista avisa, y cambiar el modo NO lo convierte.
    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(negocio.token))
      .send({ sku: "COSTMODE-1", name: "Con costo", baseUnit: "unit", cost: 116 })
      .expect(201);
    expect((await get(negocio.token).expect(200)).body).toMatchObject({ hasCosts: true });
    await put(negocio.token, { costMode: "excluded" }).expect(200);
    const presentacion = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.productPresentation.findFirstOrThrow({
        where: { tenantId: negocio.tenantId, product: { sku: "COSTMODE-1" } },
        select: { cost: true },
      }),
    );
    expect(presentacion.cost?.toString()).toBe("116");
  });

  it("PUT guarda el modo, la región y el catálogo; GET lo devuelve igual (viaje redondo)", async () => {
    const res = await put(negocio.token, {
      mode: "excluded",
      region: "BC",
      groups: [
        {
          code: "GST_PST",
          name: "GST 5% + PST 7%",
          isDefault: true,
          rates: [
            { code: "GST", name: "GST 5%", rate: "5" },
            { code: "PST", name: "PST 7%", rate: "7" },
          ],
        },
        { code: "GST_ONLY", name: "GST 5%", rates: [{ code: "GST", name: "GST 5%", rate: "5" }] },
        { code: "EXEMPT", name: "Exempt", rates: [] },
      ],
    }).expect(200);
    const vista = res.body as Vista;
    expect(vista.mode).toBe("excluded");
    expect(vista.region).toBe("BC");
    expect(vista.groups.map((g) => [g.code, g.isDefault, g.isActive])).toEqual([
      ["GST_PST", true, true],
      ["GST_ONLY", false, true],
      ["EXEMPT", false, true],
    ]);
    expect(vista.groups[0]?.rates).toEqual([
      { code: "GST", name: "GST 5%", rate: "5" },
      { code: "PST", name: "PST 7%", rate: "7" },
    ]);
    const otra = await get(negocio.token).expect(200);
    expect(otra.body).toEqual(res.body);
  });

  it("mover el default deja exactamente uno activo y los ids no cambian; un grupo ausente se desactiva", async () => {
    const antes = (await get(negocio.token).expect(200)).body as Vista;
    const idGstPst = antes.groups.find((g) => g.code === "GST_PST")?.id;
    const res = await put(negocio.token, {
      groups: [
        {
          code: "GST_ONLY",
          name: "GST 5%",
          isDefault: true,
          rates: [{ code: "GST", name: "GST 5%", rate: "5" }],
        },
        {
          code: "GST_PST",
          name: "GST 5% + PST 7%",
          rates: [
            { code: "GST", name: "GST 5%", rate: "5" },
            { code: "PST", name: "PST 7%", rate: "7" },
          ],
        },
      ],
    }).expect(200);
    const vista = res.body as Vista;
    expect(vista.groups.filter((g) => g.isDefault && g.isActive).map((g) => g.code)).toEqual([
      "GST_ONLY",
    ]);
    expect(vista.groups.find((g) => g.code === "GST_PST")?.id).toBe(idGstPst);
    expect(vista.groups.find((g) => g.code === "EXEMPT")).toMatchObject({
      isActive: false,
      isDefault: false,
    });
  });

  it("dos defaults, una tasa de cinco decimales o una región de otro país rebotan", async () => {
    await put(negocio.token, {
      groups: [
        { code: "A", name: "A", isDefault: true, rates: [] },
        { code: "B", name: "B", isDefault: true, rates: [] },
      ],
    }).expect(400);
    await put(negocio.token, {
      groups: [
        {
          code: "A",
          name: "A",
          isDefault: true,
          rates: [{ code: "X", name: "X", rate: "9.97500" }],
        },
      ],
    }).expect(400);
    await put(negocio.token, { region: "TX" }).expect(422);
  });

  it("un grupo con artículos no se borra (409 con cuántos), el default tampoco; uno libre sí", async () => {
    const vista = (await get(negocio.token).expect(200)).body as Vista;
    const gstPst = vista.groups.find((g) => g.code === "GST_PST");
    const producto = await crearProducto(app, negocio.token, 10);
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.product.update({ where: { id: producto.id }, data: { taxGroupId: gstPst?.id } }),
    );
    const enUso = await borrar(negocio.token, "GST_PST").expect(409);
    expect(enUso.body).toMatchObject({ code: "tenants.tax_group_in_use" });
    expect(
      ((await get(negocio.token)).body as Vista).groups.find((g) => g.code === "GST_PST")
        ?.usageCount,
    ).toBe(1);
    await borrar(negocio.token, "GST_ONLY").expect(409);
    const res = await borrar(negocio.token, "exempt").expect(200);
    expect((res.body as Vista).groups.map((g) => g.code)).toEqual(["GST_ONLY", "GST_PST"]);
    await borrar(negocio.token, "NADA").expect(422);
  });

  it("sin tenants:manage se lee (el selector del catálogo lo necesita) pero no se cambia", async () => {
    await get(viewerToken).expect(200);
    await put(viewerToken, { mode: "included" }).expect(403);
    await borrar(viewerToken, "GST_PST").expect(403);
  });
});
