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
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { activarModulo } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-TAX-10 — `taxGroupId` en los cuatro catálogos con precio. La base NO
 * frena que un artículo apunte al grupo de OTRO negocio (la FK no pasa por
 * la RLS): lo frena el DTO con un 422. `null` explícito limpia el override;
 * el GET lo devuelve.
 */
describe("el grupo de impuesto del artículo (F4-TAX-10)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let a: TenantFixture;
  let b: TenantFixture;
  let exentoA: string;
  let exentoB: string;

  const http = () => request(app.getHttpServer());
  const grupo = async (tenantId: string, code: string) =>
    (
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.taxGroup.create({ data: { tenantId, code, name: code, isDefault: code === "VAT16" } }),
      )
    ).id;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    const admin = await registerTenant(app, "tax-items-admin");
    await makePlatformAdmin(app, prisma, admin);
    a = await registerTenant(app, "tax-items-a");
    b = await registerTenant(app, "tax-items-b");
    await setTenantMarket(prisma, a.tenantId, "MX");
    await activarModulo(app, admin, a.tenantId, "medical_clinic");
    await grupo(a.tenantId, "VAT16");
    exentoA = await grupo(a.tenantId, "EXEMPT");
    exentoB = await grupo(b.tenantId, "EXEMPT");
  });

  afterAll(async () => {
    await app.close();
  });

  it("producto: se crea con su grupo, otro negocio no puede nombrarlo, null lo limpia", async () => {
    const creado = await http()
      .post("/products")
      .set("Authorization", bearer(a.token))
      .send({ sku: "TAX-1", name: "Medicina", baseUnit: "unit", price: 50, taxGroupId: exentoA })
      .expect(201);
    const id = (creado.body as { id: string }).id;
    expect(
      (await http().get(`/products/${id}`).set("Authorization", bearer(a.token)).expect(200)).body,
    ).toMatchObject({
      taxGroupId: exentoA,
    });
    const ajeno = await http()
      .post("/products")
      .set("Authorization", bearer(a.token))
      .send({ sku: "TAX-2", name: "Colado", baseUnit: "unit", taxGroupId: exentoB })
      .expect(422);
    expect(ajeno.body).toMatchObject({ code: "catalogs.tax_group_unknown" });
    await http()
      .patch(`/products/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: exentoB })
      .expect(422);
    const limpio = await http()
      .patch(`/products/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: null })
      .expect(200);
    expect((limpio.body as { taxGroupId: string | null }).taxGroupId).toBeNull();
    const listado = await http().get("/products").set("Authorization", bearer(a.token)).expect(200);
    expect(
      (listado.body as { items: { id: string; taxGroupId: string | null }[] }).items.find(
        (p) => p.id === id,
      )?.taxGroupId,
    ).toBeNull();
  });

  it("servicio: lo mismo, con el resumen que devuelve el propio POST", async () => {
    const almacen = await prisma.withTenantContext(a.tenantId, (tx) =>
      tx.warehouse.findFirstOrThrow({ select: { id: true } }),
    );
    const creado = await http()
      .post("/services")
      .set("Authorization", bearer(a.token))
      .send({
        code: "CONS",
        name: "Consulta",
        price: 300,
        warehouseIds: [almacen.id],
        taxGroupId: exentoA,
      })
      .expect(201);
    expect(creado.body).toMatchObject({ taxGroupId: exentoA });
    const id = (creado.body as { id: string }).id;
    await http()
      .patch(`/services/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: exentoB })
      .expect(422);
    const limpio = await http()
      .patch(`/services/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: null })
      .expect(200);
    expect((limpio.body as { taxGroupId: string | null }).taxGroupId).toBeNull();
  });

  it("estudio de laboratorio: lo mismo, por la clase base de los dos catálogos", async () => {
    const creado = await http()
      .post("/medical-clinic/lab-studies")
      .set("Authorization", bearer(a.token))
      .send({ code: "BH", name: "Biometría hemática", price: 250, taxGroupId: exentoA })
      .expect(201);
    expect(creado.body).toMatchObject({ taxGroupId: exentoA });
    const id = (creado.body as { id: string }).id;
    await http()
      .patch(`/medical-clinic/lab-studies/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: exentoB })
      .expect(422);
    const limpio = await http()
      .patch(`/medical-clinic/lab-studies/${id}`)
      .set("Authorization", bearer(a.token))
      .send({ taxGroupId: null })
      .expect(200);
    expect((limpio.body as { taxGroupId: string | null }).taxGroupId).toBeNull();
  });
});
