import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  BILLING_TEST_PASSWORD,
  bearer,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-SUPPL-05 — el catálogo de proveedores de punta a punta.
 *
 * Lo que fija:
 *  - alta, edición (incluido retirar con `isActive`) y baja con el Admin;
 *  - **un negocio SIN ningún módulo llega igual**: proveedores es core y el
 *    controller no lleva `@RequiresModule` (ningún 402);
 *  - el permiso: Viewer lee y recibe 403 al crear; Seller 403 en todo;
 *  - RLS: lo de un negocio no se ve desde otro (404, no 403);
 *  - la búsqueda por registro fiscal y el filtro `isActive`;
 *  - un RFC mal formado en un negocio mexicano rebota con 422 y uno válido se
 *    guarda normalizado.
 */
describe("Proveedores (F9-SUPPL-05)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let otro: TenantFixture;
  let viewerToken: string;
  let sellerToken: string;

  /** Un usuario del negocio con UN rol base: invitado, canjea y entra. */
  async function usuarioConRol(nombre: "Viewer" | "Seller"): Promise<string> {
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const rol = (roles.body as { id: string; name: string }[]).find((r) => r.name === nombre);
    const email = `suppl-${nombre.toLowerCase()}-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(negocio.token))
      .send({ email, firstName: "Vera", lastName: nombre, roleIds: [rol?.id] })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.filter((m) => m.to === email).at(-1)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: BILLING_TEST_PASSWORD })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: BILLING_TEST_PASSWORD })
      .expect(200);
    return (login.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    // Ningún módulo pactado: el trial Plus trae Compras y Gastos incluidos,
    // pero el catálogo NO depende de eso (ver «sin módulos»).
    negocio = await registerTenant(app, "suppl");
    otro = await registerTenant(app, "suppl-otro");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    viewerToken = await usuarioConRol("Viewer");
    sellerToken = await usuarioConRol("Seller");
  });

  afterAll(async () => {
    await app.close();
  });

  const crear = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/suppliers").set("Authorization", bearer(token)).send(body);

  it("alta, listado alfabético, edición, retiro y baja", async () => {
    const norte = await crear(negocio.token, {
      name: "Distribuidora Norte",
      taxId: "dno900101ab1",
      contactName: "Rosa Luna",
      phone: "+525512345678",
      email: "ventas@norte.mx",
    }).expect(201);
    const centro = await crear(negocio.token, { name: "Abarrotes Centro" }).expect(201);
    const idNorte = (norte.body as { id: string }).id;
    const idCentro = (centro.body as { id: string }).id;
    // El RFC se guarda normalizado: mayúsculas, sin espacios.
    expect((norte.body as { taxId: string }).taxId).toBe("DNO900101AB1");

    const lista = await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((lista.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
      idCentro,
      idNorte,
    ]);

    // Búsqueda por registro fiscal.
    const porRfc = await request(app.getHttpServer())
      .get("/suppliers?query=DNO900101")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((porRfc.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([idNorte]);

    // Editar y retirar: el retirado desaparece del filtro de activos.
    const editado = await request(app.getHttpServer())
      .patch(`/suppliers/${idCentro}`)
      .set("Authorization", bearer(negocio.token))
      .send({ contactName: "Luis Gómez", isActive: false })
      .expect(200);
    expect(editado.body).toMatchObject({ contactName: "Luis Gómez", isActive: false });
    const activos = await request(app.getHttpServer())
      .get("/suppliers?isActive=true")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((activos.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([idNorte]);

    await request(app.getHttpServer())
      .delete(`/suppliers/${idCentro}`)
      .set("Authorization", bearer(negocio.token))
      .expect(204);
    await request(app.getHttpServer())
      .get(`/suppliers/${idCentro}`)
      .set("Authorization", bearer(negocio.token))
      .expect(404);
  });

  /**
   * F9-SUPPCAT-03 (Carlos, 2026-09-12): el proveedor tiene su código como los
   * demás catálogos. Lo trae la persona (en MAYÚSCULAS, único por negocio) o
   * lo pone el sistema: `PROV-001`, `PROV-002`… por el MAYOR usado, no por
   * conteo, para que borrar uno intermedio no repita un código vivo.
   */
  it("el código: PROV-NNN si no viene, en mayúsculas si viene, único por negocio y buscable", async () => {
    const codigos = await registerTenant(app, "codigos");
    const primero = (await crear(codigos.token, { name: "Sin código uno" }).expect(201)).body as {
      id: string;
      code: string;
    };
    expect(primero.code).toMatch(/^PROV-\d{3}$/);
    const segundo = (await crear(codigos.token, { name: "Sin código dos" }).expect(201)).body as {
      id: string;
      code: string;
    };
    expect(Number(segundo.code.slice(5))).toBe(Number(primero.code.slice(5)) + 1);

    const acme = (await crear(codigos.token, { code: " acme ", name: "Acme" }).expect(201))
      .body as {
      code: string;
    };
    expect(acme.code).toBe("ACME");
    const rebote = await crear(codigos.token, { code: "acme", name: "Acme otra vez" }).expect(409);
    expect((rebote.body as { code: string }).code).toBe("suppliers.code_taken");

    const porCodigo = await request(app.getHttpServer())
      .get(`/suppliers?query=${primero.code}`)
      .set("Authorization", bearer(codigos.token))
      .expect(200);
    expect((porCodigo.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
      primero.id,
    ]);

    // Borrar el último y crear otro: la serie sigue por el MAYOR, no por el conteo.
    await request(app.getHttpServer())
      .delete(`/suppliers/${segundo.id}`)
      .set("Authorization", bearer(codigos.token))
      .expect(204);
    const tercero = (await crear(codigos.token, { name: "Sin código tres" }).expect(201)).body as {
      code: string;
    };
    // Con PROV-001 vivo y PROV-002 borrado, el siguiente es PROV-002 (MAX+1 = 2).
    expect(Number(tercero.code.slice(5))).toBe(Number(primero.code.slice(5)) + 1);

    // Editar el código: normalizado y único.
    await request(app.getHttpServer())
      .patch(`/suppliers/${primero.id}`)
      .set("Authorization", bearer(codigos.token))
      .send({ code: "acme" })
      .expect(409);
    const renombrado = await request(app.getHttpServer())
      .patch(`/suppliers/${primero.id}`)
      .set("Authorization", bearer(codigos.token))
      .send({ code: "norte-01" })
      .expect(200);
    expect(renombrado.body).toMatchObject({ code: "NORTE-01" });
  });

  /**
   * F9-SUPPCAT-05 (Carlos, 2026-09-12): proveedores es un catálogo de primera
   * clase — nace con su catálogo de sistema y sus `attributes` se validan con
   * el MISMO motor que almacenes, productos y servicios.
   */
  it("campos propios: el catálogo `suppliers` existe y sus attributes se validan", async () => {
    const propio = await registerTenant(app, "suppl-campos");
    const catalogos = (
      await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(propio.token))
        .expect(200)
    ).body as { id: string; systemKey: string | null; isSystem: boolean }[];
    const deProveedores = catalogos.find((c) => c.systemKey === "suppliers");
    expect(deProveedores).toMatchObject({ isSystem: true });

    await request(app.getHttpServer())
      .post(`/catalogs/${deProveedores?.id}/fields`)
      .set("Authorization", bearer(propio.token))
      .send({ label: "Días de crédito", fieldType: "number", required: true })
      .expect(201);

    // Sin el campo requerido: rebota nombrando el campo.
    const sinCampo = await crear(propio.token, { name: "Acme", attributes: {} }).expect(400);
    expect(sinCampo.body).toMatchObject({
      code: "suppliers.invalid_attributes",
      errors: [{ key: "dias_de_credito", code: "catalogs.field_required" }],
    });
    // Con el tipo equivocado: rebota por tipo.
    const malTipo = await crear(propio.token, {
      name: "Acme",
      attributes: { dias_de_credito: "30" },
    }).expect(400);
    expect(malTipo.body).toMatchObject({
      errors: [{ key: "dias_de_credito", code: "catalogs.field_must_be_number" }],
    });
    // Bien: se guarda y vuelve.
    const creado = await crear(propio.token, {
      name: "Acme",
      attributes: { dias_de_credito: 30 },
    }).expect(201);
    expect(creado.body).toMatchObject({ attributes: { dias_de_credito: 30 } });
    const leido = await request(app.getHttpServer())
      .get(`/suppliers/${(creado.body as { id: string }).id}`)
      .set("Authorization", bearer(propio.token))
      .expect(200);
    expect(leido.body).toMatchObject({ attributes: { dias_de_credito: 30 } });
    // Sin `attributes` en el alta no se exige nada: el JSONB queda vacío (como en almacenes).
    await crear(propio.token, { name: "Sin atributos" }).expect(201);
    // Editarlos también valida.
    await request(app.getHttpServer())
      .patch(`/suppliers/${(creado.body as { id: string }).id}`)
      .set("Authorization", bearer(propio.token))
      .send({ attributes: { dias_de_credito: "x" } })
      .expect(400);
  });

  it("sin módulos pactados el catálogo responde igual: es core, no lleva @RequiresModule", async () => {
    // `otro` no pactó nada y no tiene país: el trial trae Compras/Gastos, pero
    // aunque no los trajera el catálogo seguiría respondiendo 200.
    await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", bearer(otro.token))
      .expect(200);
    await crear(otro.token, { name: "Proveedor del otro" }).expect(201);
  });

  it("RLS: lo del otro negocio no se ve, ni se edita, ni se borra (404)", async () => {
    const ajeno = await crear(otro.token, { name: "Solo del otro" }).expect(201);
    const id = (ajeno.body as { id: string }).id;
    await request(app.getHttpServer())
      .get(`/suppliers/${id}`)
      .set("Authorization", bearer(negocio.token))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/suppliers/${id}`)
      .set("Authorization", bearer(negocio.token))
      .send({ name: "Robado" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/suppliers/${id}`)
      .set("Authorization", bearer(negocio.token))
      .expect(404);
  });

  it("Viewer lee y recibe 403 al crear; Seller 403 en todo", async () => {
    await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", bearer(viewerToken))
      .expect(200);
    await crear(viewerToken, { name: "Nope" }).expect(403);
    await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", bearer(sellerToken))
      .expect(403);
    await crear(sellerToken, { name: "Nope" }).expect(403);
  });

  it("un RFC mal formado en un negocio mexicano rebota con 422; sin prefijo el teléfono es 400", async () => {
    const res = await crear(negocio.token, { name: "Malo", taxId: "NOPE" }).expect(422);
    expect((res.body as { message: string }).message).toContain("registro fiscal");
    await crear(negocio.token, { name: "Malo", phone: "5512345678" }).expect(400);
  });
});
