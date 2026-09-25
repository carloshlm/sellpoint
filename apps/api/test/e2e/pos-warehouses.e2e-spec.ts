import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant } from "./support/billing-scenario";
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-MANFIX-08 — las listas de sucursales del punto de venta.
 *
 * «Abrir turno» y el armador de cotizaciones pedían las sucursales a
 * `GET /warehouses?scoped=true`, que exige `warehouses:read`, y el rol de
 * fábrica Seller no lo tiene: la primera pantalla del día de cada cajero decía
 * «No hay sucursales disponibles», aunque el botón sí funcionaba (el API
 * rellena con la asignada). Cada pantalla tiene ahora su lista con SU permiso
 * —la caja con `pos:sell`, la cotización con `pos:quote`, porque una recepción
 * puede cotizar sin cobrar—: las MISMAS sucursales (activas dentro del
 * alcance), sin abrirle a nadie la administración de sucursales.
 */
describe("Las sucursales del punto de venta (F10-MANFIX-08)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const deLaCaja = (token: string) =>
    request(app.getHttpServer()).get("/pos/warehouses").set("Authorization", bearer(token));

  const deLaCotizacion = (token: string) =>
    request(app.getHttpServer()).get("/pos/quotes/warehouses").set("Authorization", bearer(token));

  const nombres = (body: unknown) => (body as { name: string }[]).map((w) => w.name);

  /** El usuario del token: el `sub` del JWT. */
  const idDe = (token: string) =>
    (
      JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
        sub: string;
      }
    ).sub;

  /** Un negocio recién registrado, con su sucursal principal y un cajero (Seller). */
  async function negocioConCajero(prefix: string) {
    const negocio = await registerTenant(app, prefix);
    const principal = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.warehouse.findFirstOrThrow({ select: { id: true, name: true } }),
    );
    const cajero = await usuarioConRol(app, negocio, "seller", `${prefix}-seller`);
    return { negocio, principal, cajero };
  }

  /**
   * La principal, Norte y Sur, con el cajero limitado a Norte y Sur. Sur se
   * cierra DESPUÉS de asignarla: el alcance no acepta una inactiva.
   */
  async function conCajeroLimitado(prefix: string) {
    const { negocio, cajero } = await negocioConCajero(prefix);
    const { norte, sur } = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const crear = (name: string) =>
        tx.warehouse.create({
          data: { tenantId: negocio.tenantId, code: `WH-${randomUUID().slice(0, 8)}`, name },
          select: { id: true },
        });
      return { norte: (await crear("Norte")).id, sur: (await crear("Sur")).id };
    });
    await request(app.getHttpServer())
      .put(`/users/${idDe(cajero)}/warehouse-scope`)
      .set("Authorization", bearer(negocio.token))
      .send({ warehouseIds: [norte, sur] })
      .expect(200);
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.warehouse.update({ where: { id: sur }, data: { isActive: false } }),
    );
    return { negocio, cajero, norte };
  }

  describe("la caja: «Abrir turno»", () => {
    it("un cajero con SOLO el rol Seller recibe 200 y su sucursal", async () => {
      const { principal, cajero } = await negocioConCajero("pos-wh");

      const res = await deLaCaja(cajero).expect(200);

      expect(res.body).toEqual([expect.objectContaining(principal)]);
      // Y sin darle la llave de la administración: la lista de inventario le
      // sigue cerrada, que es justo lo que no había que abrirle.
      await request(app.getHttpServer())
        .get("/warehouses")
        .query({ scoped: "true" })
        .set("Authorization", bearer(cajero))
        .expect(403);
    });

    it("sin `pos:sell` no hay lista: un Viewer lee sucursales, pero no vende", async () => {
      const negocio = await registerTenant(app, "pos-wh-viewer");
      const auditor = await usuarioConRol(app, negocio, "viewer", "pos-wh-viewer");

      await deLaCaja(auditor).expect(403);
    });

    it("respeta el alcance: el cajero limitado ve solo las suyas activas, y abre turno en una de ellas", async () => {
      const { negocio, cajero, norte } = await conCajeroLimitado("pos-wh-scope");

      // Ni la principal (fuera de su alcance) ni Sur (cerrada).
      expect(nombres((await deLaCaja(cajero).expect(200)).body)).toEqual(["Norte"]);
      // La dueña no tiene alcance limitado: todas las activas.
      expect(nombres((await deLaCaja(negocio.token).expect(200)).body)).toEqual([
        "Norte",
        "Sucursal Principal",
      ]);
      // Lo que la lista ofrece es lo que la caja acepta.
      await request(app.getHttpServer())
        .post("/pos/session")
        .set("Authorization", bearer(cajero))
        .send({ warehouseId: norte })
        .expect(201);
    });
  });

  describe("la cotización: el armador", () => {
    it("un cajero con SOLO el rol Seller recibe 200 y su sucursal", async () => {
      const { principal, cajero } = await negocioConCajero("pos-wh-cot");

      const res = await deLaCotizacion(cajero).expect(200);

      expect(res.body).toEqual([expect.objectContaining(principal)]);
    });

    it("sin `pos:quote` no hay lista: un Viewer lee sucursales, pero no cotiza", async () => {
      const negocio = await registerTenant(app, "pos-wh-cot-viewer");
      const auditor = await usuarioConRol(app, negocio, "viewer", "pos-wh-cot-viewer");

      await deLaCotizacion(auditor).expect(403);
    });

    /**
     * Por qué son DOS listas y no una: una recepción puede cotizar sin cobrar
     * (`POS_SELLER_CODES` en role-catalog). Con una sola lista detrás de
     * `pos:sell`, su armador seguiría diciendo que no hay sucursales.
     */
    it("quien solo cotiza (una recepción con `pos:quote`) tiene la lista de la cotización y no la de la caja", async () => {
      const negocio = await registerTenant(app, "pos-wh-recepcion");
      await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(negocio.token))
        .send({ name: "Recepción", permissionCodes: ["pos:quote"] })
        .expect(201);
      const recepcion = await usuarioConRol(
        app,
        negocio,
        { nombre: "Recepción" },
        "pos-wh-recepcion",
      );

      expect(nombres((await deLaCotizacion(recepcion).expect(200)).body)).toEqual([
        "Sucursal Principal",
      ]);
      await deLaCaja(recepcion).expect(403);
    });

    it("respeta el alcance: el cajero limitado ve solo las suyas activas, y cotiza en una de ellas", async () => {
      const { negocio, cajero, norte } = await conCajeroLimitado("pos-wh-cot-scope");
      // Un servicio que se vende en Norte: un producto sin existencia ahí no
      // se cotiza (la regla de lo disponible), y eso no es lo que se prueba.
      const servicio = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(negocio.token))
        .send({
          code: `SRV-${randomUUID().slice(0, 8)}`,
          name: "Consulta",
          price: 100,
          warehouseIds: [norte],
        })
        .expect(201);

      expect(nombres((await deLaCotizacion(cajero).expect(200)).body)).toEqual(["Norte"]);
      expect(nombres((await deLaCotizacion(negocio.token).expect(200)).body)).toEqual([
        "Norte",
        "Sucursal Principal",
      ]);
      // Lo que la lista ofrece es lo que la cotización acepta.
      await request(app.getHttpServer())
        .post("/pos/quotes")
        .set("Authorization", bearer(cajero))
        .send({
          warehouseId: norte,
          lines: [{ serviceId: (servicio.body as { id: string }).id, quantity: 1 }],
        })
        .expect(201);
    });
  });
});
