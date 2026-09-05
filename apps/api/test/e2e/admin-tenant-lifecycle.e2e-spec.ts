import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../../src/infrastructure/redis/redis.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  BILLING_TEST_PASSWORD,
  bearer,
  cargarStock,
  crearProducto,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { activarModulo } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

const DIA_MS = 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = "sp_refresh";

/**
 * F7-LIFECYCLE-06 — el ciclo completo de un negocio desde el backoffice:
 * desactivar (ya no entra, reversible), reactivar, y eliminar solo tras 30
 * días desactivado, con nombre exacto y la contraseña del administrador.
 * Al final no queda NADA del negocio en ninguna tabla, y el otro negocio
 * sigue intacto.
 */
describe("Ciclo de vida del negocio desde el backoffice (F7-LIFECYCLE-06)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocioB: TenantFixture;
  let otro: TenantFixture;
  let nombreB: string;
  let cookieB: string;

  const ruta = (sufijo = "") => `/admin/tenants/${negocioB.tenantId}${sufijo}`;
  const login = (email: string) =>
    request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: BILLING_TEST_PASSWORD });
  const eliminar = (
    body: { password: string; confirmName: string },
    tenantId = negocioB.tenantId,
  ) =>
    request(app.getHttpServer())
      .delete(`/admin/tenants/${tenantId}`)
      .set("Authorization", bearer(admin.token))
      .send(body);

  /** Filas con ese tenant_id en TODAS las tablas base que lo llevan. */
  async function filasDelNegocio(tenantId: string): Promise<Record<string, number>> {
    const tablas = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`;
    const conteo: Record<string, number> = {};
    await prisma.withTenantContext(tenantId, async (tx) => {
      for (const { table_name } of tablas) {
        const [fila] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "${table_name}" WHERE tenant_id = $1::uuid`,
          tenantId,
        );
        if (fila && Number(fila.n) > 0) conteo[table_name] = Number(fila.n);
      }
    });
    return conteo;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "lifecycle-admin");
    await makePlatformAdmin(app, prisma, admin);
    otro = await registerTenant(app, "lifecycle-otro");
    negocioB = await registerTenant(app, "lifecycle-b");
    await setTenantMarket(prisma, negocioB.tenantId, "MX");
    nombreB = (await prisma.tenant.findUniqueOrThrow({ where: { id: negocioB.tenantId } })).name;

    // Un negocio con vida: producto con existencias, una venta en caja y un
    // cliente de Recepción. Lo que un borrado ingenuo dejaría a medias.
    const producto = await crearProducto(app, negocioB.token, 30);
    const almacen = await almacenInicial(prisma, negocioB.tenantId);
    await cargarStock(app, negocioB.token, almacen, producto.id, 10);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(negocioB.token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(negocioB.token))
      .send({ paymentMethod: "cash", lines: [{ productId: producto.id, quantity: 1 }] })
      .expect(201);
    await activarModulo(app, admin, negocioB.tenantId, "reception");
    // La activación de módulo se lee al entrar: sesión nueva para B.
    const sesion = await login(negocioB.email).expect(200);
    negocioB.token = (sesion.body as { accessToken: string }).accessToken;
    const setCookie = sesion.headers["set-cookie"] as unknown as string[];
    cookieB = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))?.split(";")[0] ?? "";
    await request(app.getHttpServer())
      .post("/reception/customers")
      .set("Authorization", bearer(negocioB.token))
      .send({ firstName: "Luis", lastNamePaternal: "Lara" })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("un TenantAdmin normal recibe 403 en los tres endpoints", async () => {
    await request(app.getHttpServer())
      .post(ruta("/suspend"))
      .set("Authorization", bearer(negocioB.token))
      .send({ reason: "No debería poder" })
      .expect(403);
    await request(app.getHttpServer())
      .post(ruta("/reactivate"))
      .set("Authorization", bearer(negocioB.token))
      .expect(403);
    await request(app.getHttpServer())
      .delete(ruta())
      .set("Authorization", bearer(negocioB.token))
      .send({ password: BILLING_TEST_PASSWORD, confirmName: nombreB })
      .expect(403);
  });

  it("desactivar: 200 con el ciclo de vida, y el negocio deja de entrar", async () => {
    const respuesta = await request(app.getHttpServer())
      .post(ruta("/suspend"))
      .set("Authorization", bearer(admin.token))
      .send({ reason: "Pruebas del ciclo de vida" })
      .expect(200);
    expect(respuesta.body).toMatchObject({
      suspendedAt: expect.any(String),
      suspendedBy: { id: admin.userId, name: "Ana Pérez" },
      reason: "Pruebas del ciclo de vida",
      suspendedDays: 0,
      deletable: false,
    });

    // Login con la password CORRECTA: 403 con la clave del negocio.
    const rechazo = await login(negocioB.email).expect(403);
    expect(rechazo.body).toMatchObject({ code: "auth.tenant_suspended" });
    // La sesión que tenía murió: sus refresh tokens se borraron al desactivar.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieB).expect(401);
    // Y el resumen del backoffice lo dice.
    const overview = await request(app.getHttpServer())
      .get(ruta("/overview"))
      .set("Authorization", bearer(admin.token))
      .expect(200);
    expect(
      (overview.body as { lifecycle: { deletable: boolean; reason: string } }).lifecycle,
    ).toMatchObject({
      deletable: false,
      reason: "Pruebas del ciclo de vida",
    });
  });

  it("desactivar dos veces → 409; un motivo corto → 400", async () => {
    const otraVez = await request(app.getHttpServer())
      .post(ruta("/suspend"))
      .set("Authorization", bearer(admin.token))
      .send({ reason: "Otra vez" })
      .expect(409);
    expect(otraVez.body).toMatchObject({ code: "admin.tenant_already_suspended" });
    await request(app.getHttpServer())
      .post(`/admin/tenants/${otro.tenantId}/suspend`)
      .set("Authorization", bearer(admin.token))
      .send({ reason: "abc" })
      .expect(400);
  });

  it("reactivar: el negocio vuelve a entrar; reactivar de nuevo → 409", async () => {
    await request(app.getHttpServer())
      .post(ruta("/reactivate"))
      .set("Authorization", bearer(admin.token))
      .expect(200);
    const sesion = await login(negocioB.email).expect(200);
    negocioB.token = (sesion.body as { accessToken: string }).accessToken;
    const deNuevo = await request(app.getHttpServer())
      .post(ruta("/reactivate"))
      .set("Authorization", bearer(admin.token))
      .expect(409);
    expect(deNuevo.body).toMatchObject({ code: "admin.tenant_not_suspended" });
  });

  it("eliminar recién desactivado → 409 y dice desde cuándo sí", async () => {
    await request(app.getHttpServer())
      .post(ruta("/suspend"))
      .set("Authorization", bearer(admin.token))
      .send({ reason: "Cierre definitivo" })
      .expect(200);
    const rechazo = await eliminar({
      password: BILLING_TEST_PASSWORD,
      confirmName: nombreB,
    }).expect(409);
    expect(rechazo.body).toMatchObject({
      code: "admin.tenant_not_deletable",
      deletableAt: expect.any(String),
    });
  });

  it("tras 31 días desactivado: nombre mal → 422, contraseña mal → 401, cinco fallos → 429", async () => {
    await prisma.tenant.update({
      where: { id: negocioB.tenantId },
      data: { suspendedAt: new Date(Date.now() - 31 * DIA_MS) },
    });
    const nombre = await eliminar({
      password: BILLING_TEST_PASSWORD,
      confirmName: nombreB.toLowerCase(),
    }).expect(422);
    expect(nombre.body).toMatchObject({ code: "admin.confirm_name_mismatch" });

    for (let i = 0; i < 5; i += 1) {
      const clave = await eliminar({ password: "no-es-esta", confirmName: nombreB }).expect(401);
      expect(clave.body).toMatchObject({ code: "admin.password_mismatch" });
    }
    const bloqueado = await eliminar({
      password: BILLING_TEST_PASSWORD,
      confirmName: nombreB,
    }).expect(429);
    expect(bloqueado.body).toMatchObject({ code: "admin.too_many_attempts" });
    expect(await prisma.tenant.findUnique({ where: { id: negocioB.tenantId } })).not.toBeNull();
    await app.get(REDIS_CLIENT).del(`throttle:admin-purge:${admin.userId}`);
  });

  it("el propio negocio del administrador → 409, ni desactivado ni eliminado", async () => {
    await request(app.getHttpServer())
      .post(`/admin/tenants/${admin.tenantId}/suspend`)
      .set("Authorization", bearer(admin.token))
      .send({ reason: "Me equivoqué de fila" })
      .expect(409);
    const rechazo = await eliminar(
      { password: BILLING_TEST_PASSWORD, confirmName: "lo que sea" },
      admin.tenantId,
    ).expect(409);
    expect(rechazo.body).toMatchObject({ code: "admin.cannot_touch_own_tenant" });
  });

  it("eliminar de verdad: no queda nada del negocio, la auditoría lo recuerda y el otro sigue", async () => {
    const antes = await filasDelNegocio(negocioB.tenantId);
    expect(antes.users).toBeGreaterThanOrEqual(1);
    expect(antes.sales).toBe(1);
    expect(antes.customers).toBe(1);

    const respuesta = await eliminar({
      password: BILLING_TEST_PASSWORD,
      confirmName: nombreB,
    }).expect(200);
    expect(respuesta.body).toEqual({ purged: true, name: nombreB });

    expect(await prisma.tenant.findUnique({ where: { id: negocioB.tenantId } })).toBeNull();
    expect(await filasDelNegocio(negocioB.tenantId)).toEqual({});
    await request(app.getHttpServer())
      .get(ruta("/overview"))
      .set("Authorization", bearer(admin.token))
      .expect(404);

    const auditoria = await prisma.withTenantContext(admin.tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: admin.tenantId, action: "tenant.purged", resourceId: negocioB.tenantId },
      }),
    );
    expect(auditoria?.before).toMatchObject({ name: nombreB, sales: 1 });
    expect(auditoria?.after).toMatchObject({ name: nombreB, sales: 1 });

    // Quien era de ese negocio ya no existe para el login.
    await login(negocioB.email).expect(401);
    // Y el otro negocio no se enteró.
    await request(app.getHttpServer())
      .get(`/admin/tenants/${otro.tenantId}/overview`)
      .set("Authorization", bearer(admin.token))
      .expect(200);
    await login(otro.email).expect(200);
  });
});
