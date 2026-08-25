import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";

/**
 * F5-CAT — los tres exports DIRECTOS: usuarios, almacenes y catálogo.
 *
 * ── Por qué no tienen pantalla propia ───────────────────────────────────
 *
 * Una tabla en Reportes duplicaría los listados que ya existen en Sistema,
 * Almacenes y Catálogo. La tarjeta del hub descarga el Excel y punto.
 *
 * ── Por qué necesitan endpoint propio ───────────────────────────────────
 *
 * Porque el permiso es OTRO. Los listados existentes piden `users:manage` o
 * `products:manage` —permisos de EDICIÓN—, y un Viewer que solo puede leer se
 * quedaría sin poder bajar su propio catálogo. Exportar es leer: ese es el
 * criterio «reimprimir es leer» de F4-UI-03 aplicado acá.
 */
describe("Exports directos (F5-CAT)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let token: string;
  let tenantId: string;
  let userId: string;
  let norteId: string;
  let sku: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Un Viewer de verdad: lee, pero NO administra usuarios ni productos. */
  const viewer = () => ({
    Authorization: `Bearer ${tokenService.signAccessToken({
      sub: userId,
      tenantId,
      permissions: ["reports:read", "inventory:read", "products:read"],
      locale: "es",
    })}`,
  });

  function descargar(url: string, headers: Record<string, string>) {
    return request(app.getHttpServer())
      .get(url)
      .set(headers)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
  }

  async function celdas(body: Buffer): Promise<{ name: string; rows: string[][] }> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet?.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((v) => (v === null || v === undefined ? "" : String(v))));
    });
    return { name: sheet?.name ?? "", rows };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant cat ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);
    tenantId = (registered.body as { tenantId: string }).tenantId;

    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    sku = `CAT-${randomUUID().slice(0, 6)}`;
    await request(app.getHttpServer())
      .post("/products")
      .set(auth())
      .send({ sku, name: "Producto del catálogo", baseUnit: "unit" })
      .expect(201);

    await prisma.withTenantContext(tenantId, async (tx) => {
      userId = (await tx.user.findFirstOrThrow({ where: { tenantId } })).id;
      const [, norte] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: "Central cat", address: "Calle 5" } }),
        tx.warehouse.create({ data: { tenantId, name: "Norte cat", isActive: false } }),
      ]);
      norteId = norte.id;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── F5-CAT-01 ─────────────────────────────────────────────────────────
  describe("usuarios (F5-CAT-01)", () => {
    /**
     * ⚠ LA prueba de la tarea: un Viewer SIN `users:manage` baja el reporte.
     * Ese es el punto de que viva bajo `reports:read` y no colgado del CRUD.
     */
    it("un Viewer sin `users:manage` lo descarga igual", async () => {
      const response = await descargar("/reports/users/export", viewer()).expect(200);

      const { name, rows } = await celdas(response.body as Buffer);
      expect(name).toBe("Usuarios");
      expect(response.headers["content-disposition"]).toContain("usuarios.xlsx");
      // Encabezado + al menos el dueño del tenant.
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.some((r) => r.join("|").includes("Ana"))).toBe(true);
    });

    /**
     * ⚠ SIN campos sensibles. El hash de la contraseña es el que más duele,
     * pero también los tokens: un Excel se reenvía por correo sin pensarlo.
     */
    it("no filtra hashes, tokens ni nada que no deba salir del sistema", async () => {
      const response = await descargar("/reports/users/export", auth()).expect(200);
      const { rows } = await celdas(response.body as Buffer);
      const todo = rows.flat().join("|").toLowerCase();

      expect(todo).not.toContain("$2b$");
      expect(todo).not.toContain("$argon");
      for (const prohibido of ["hash", "token", "password", "secret"]) {
        expect(rows[0]?.join("|").toLowerCase()).not.toContain(prohibido);
      }
    });

    it("trae nombre, correo, roles y estado", async () => {
      const response = await descargar("/reports/users/export", auth()).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows[0]).toEqual(["Nombre", "Correo", "Roles", "Almacenes", "Estado"]);
      const ana = rows.find((r) => r[0]?.includes("Ana"));
      expect(ana?.[2]).toContain("TenantAdmin");
      expect(ana?.[4]).toBe("Activo");
      // Sin alcance asignado NO es «ninguno», es «todos»: una celda vacía se
      // leería al revés y haría pensar que esta persona no puede operar en
      // ningún almacén.
      expect(ana?.[3]).toBe("Todos");
    });

    /**
     * El estado tiene TRES valores. Colapsar `invited` a «Inactivo» borraría
     * justo el dato que alguien busca cuando pregunta por qué una persona no
     * entra al sistema: no es que esté suspendida, es que nunca aceptó.
     */
    it("distingue a quien fue invitado de quien está suspendido", async () => {
      const invitado = await prisma.withTenantContext(tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId,
            email: `invitado-${randomUUID()}@example.com`,
            firstName: "Sin",
            lastNamePaternal: "Aceptar",
            status: "invited",
          },
        }),
      );

      const response = await descargar("/reports/users/export", auth()).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows.find((r) => r[0]?.includes("Sin Aceptar"))?.[4]).toBe("Invitado");

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.user.delete({ where: { id: invitado.id } }),
      );
    });

    it("un POS_Seller no puede bajarlo", async () => {
      const vendedor = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["pos:sell", "pos:view"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get("/reports/users/export")
        .set("Authorization", `Bearer ${vendedor}`)
        .expect(403);
    });
  });

  // ── F5-CAT-02 ─────────────────────────────────────────────────────────
  describe("almacenes (F5-CAT-02)", () => {
    it("baja los almacenes con su dirección y su estado", async () => {
      const response = await descargar("/reports/warehouses/export", auth()).expect(200);

      const { name, rows } = await celdas(response.body as Buffer);
      expect(name).toBe("Almacenes");
      expect(rows[0]).toEqual(["Nombre", "Dirección", "Estado", "Productos con stock"]);

      const central = rows.find((r) => r[0] === "Central cat");
      expect(central?.[1]).toBe("Calle 5");
      expect(central?.[2]).toBe("Activo");
    });

    /**
     * Los desactivados SE VEN, marcados: un almacén inactivo con stock adentro
     * es justo lo que alguien necesita encontrar cuando audita.
     */
    it("los almacenes desactivados se exportan marcados, no se omiten", async () => {
      const response = await descargar("/reports/warehouses/export", auth()).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows.find((r) => r[0] === "Norte cat")?.[2]).toBe("Inactivo");
    });

    it("un usuario acotado solo exporta SUS almacenes", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      const response = await descargar("/reports/warehouses/export", {
        Authorization: acotado.startsWith("Bearer") ? acotado : `Bearer ${acotado}`,
      }).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows.some((r) => r[0] === "Norte cat")).toBe(true);
      expect(rows.some((r) => r[0] === "Central cat")).toBe(false);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });
  });

  // ── F5-CAT-03 ─────────────────────────────────────────────────────────
  describe("catálogo (F5-CAT-03)", () => {
    /**
     * ⚠ La razón de existir de la tarea: el export de la plantilla de
     * importación exige `products:manage`, así que un Viewer no podía bajar
     * su propio catálogo. Este endpoint existe para que exportar sea LEER.
     */
    it("un Viewer sin `products:manage` descarga el catálogo completo", async () => {
      await request(app.getHttpServer())
        .get("/products/import/template?format=xlsx")
        .set(viewer())
        .expect(403);

      const response = await descargar("/reports/products/export", viewer()).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows.some((r) => r[0] === sku)).toBe(true);
    });

    /**
     * Las columnas salen de la MISMA fuente que la plantilla de importación
     * —campos dinámicos incluidos—: si fueran dos listas, un día dirían cosas
     * distintas y lo exportado dejaría de poder reimportarse.
     */
    it("las columnas son las mismas que las de la plantilla de importación", async () => {
      const plantilla = await descargar("/products/import/template?format=xlsx", auth()).expect(
        200,
      );
      const reporte = await descargar("/reports/products/export", auth()).expect(200);

      const encabezadoPlantilla = (await celdas(plantilla.body as Buffer)).rows[0];
      const encabezadoReporte = (await celdas(reporte.body as Buffer)).rows[0];

      expect(encabezadoReporte).toEqual(encabezadoPlantilla);
    });

    /**
     * ⚠ La diferencia de PROPÓSITO con la plantilla: cuando no hay productos,
     * la plantilla inventa una fila de ejemplo («PAR-500 Paracetamol») para
     * enseñar el formato. En un REPORTE eso sería mentir: diría que existe un
     * producto que nadie dio de alta.
     */
    it("un catálogo vacío exporta solo encabezados, sin la fila de ejemplo", async () => {
      // El correo se guarda ANTES de mandarlo: leerlo después de la request
      // obligaría a hurgar en las tripas de supertest.
      const otroEmail = `vacio-${randomUUID()}@example.com`;
      await request(app.getHttpServer())
        .post("/auth/register-tenant")
        .send({
          tenantName: `Vacío ${randomUUID()}`,
          email: otroEmail,
          password: PASSWORD,
          firstName: "Sin",
          lastNamePaternal: "Productos",
          locale: "es",
        })
        .expect(201);

      const mailer = app.get<NoopMailer>(MAILER);
      const link = extractTokenFromLink(mailer.sent.find((m) => m.to === otroEmail)?.vars.link);
      await request(app.getHttpServer())
        .post("/auth/verify-email")
        .send({ token: link })
        .expect(200);
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: otroEmail, password: PASSWORD })
        .expect(200);
      const otroToken = (login.body as { accessToken: string }).accessToken;
      const otroAuth = { Authorization: `Bearer ${otroToken}` };

      const plantilla = await descargar("/products/import/template?format=xlsx", otroAuth).expect(
        200,
      );
      const reporte = await descargar("/reports/products/export", otroAuth).expect(200);

      // La plantilla SÍ trae el ejemplo: es su trabajo enseñar el formato.
      expect((await celdas(plantilla.body as Buffer)).rows).toHaveLength(2);
      // El reporte NO: solo el encabezado.
      expect((await celdas(reporte.body as Buffer)).rows).toHaveLength(1);
    });

    it("un POS_Seller no puede bajar el catálogo", async () => {
      const vendedor = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["pos:sell", "pos:view"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get("/reports/products/export")
        .set("Authorization", `Bearer ${vendedor}`)
        .expect(403);
    });
  });
});
