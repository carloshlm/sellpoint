import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-MANFIX-17 — el id de TODAS las rutas del API.
 *
 * Un `:id` que no es uuid llegaba crudo a Prisma: la columna es `uuid`,
 * Postgres no podía leer el texto (22P02, que Prisma 7 entrega como P2007) y
 * el filtro de excepciones lo contestaba como un 500 nuestro, que además iba
 * a Sentry. Es un error de quien llama: 400 con `common.invalid_id`, sin tocar
 * la base. La 13 lo había corregido solo en el punto de venta (y absorbe su
 * `pos-ids.e2e-spec.ts`); esta prueba recorre el API entero.
 *
 * Las rutas NO se listan a mano: salen del router de Express ya armado, así
 * que un controlador nuevo entra solo al recorrido. Cada parámetro que se
 * llama `id` o termina en `Id` se prueba por separado, con los demás bien
 * formados: `/inventory/documents/:id/lines/:lineId` tiene dos puertas y las
 * dos tienen que estar cerradas.
 *
 * Las peticiones van SIN cuerpo a propósito. El id se revisa antes que el
 * cuerpo (ver `common/http/uuid-param.decorator.ts`), así que un PATCH con un
 * id malo y sin cuerpo tiene que contestar por el id, no por el cuerpo que
 * falta. Si la prueba mandara cuerpos válidos no vería esa precedencia.
 */

/** Una ruta del router con los nombres de sus parámetros, en orden. */
interface RouteWithParams {
  method: string;
  path: string;
  params: string[];
}

/** Lo poco que se lee del router de Express 5: sus capas con ruta. */
interface ExpressWithRouter {
  router: {
    stack: { route?: { path: string; methods: Record<string, boolean> } }[];
  };
}

/**
 * Los parámetros de ruta que NO son un uuid, con un valor válido para cada
 * uno. Un parámetro nuevo que no esté acá ni se llame `id`/`…Id` hace fallar
 * el primer test: alguien tiene que decidir a mano si es un id (y entonces
 * lleva `@UuidParam`) o no.
 */
const NON_ID_PARAMS: Record<string, string> = {
  // El código del plan (`PATCH /admin/billing/plans/:code`) y el del grupo de
  // impuestos (`DELETE /tenants/me/taxes/groups/:code`).
  code: "IVA16",
  // `GET /pos/quotes/folio/:folio/for-sale`: el folio que se teclea en caja.
  folio: "COT-000001",
  // La sección del expediente: `/medical-clinic/records/:id/sections/:key`.
  key: "notes",
  // El renglón dentro de esa sección: `…/sections/:key/items/:index/document`.
  index: "0",
  // El renglón de la orden: `/purchase-orders/:id/lines/:lineNo/close-short`.
  lineNo: "1",
  // `DELETE /admin/billing/tenants/:tenantId/modules/:moduleKey`.
  moduleKey: "reception",
};

const NOT_A_UUID = "no-es-un-uuid";

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

const isIdParam = (name: string): boolean => name === "id" || name.endsWith("Id");

function routesWithParams(app: INestApplication): RouteWithParams[] {
  const express: ExpressWithRouter = app.getHttpAdapter().getInstance();
  return express.router.stack.flatMap(({ route }) => {
    if (!route) {
      return [];
    }
    const params = [...route.path.matchAll(/:(\w+)/g)].map((match) => match[1] ?? "");
    if (params.length === 0) {
      return [];
    }
    return Object.keys(route.methods).map((method) => ({
      method: method.toUpperCase(),
      path: route.path,
      params,
    }));
  });
}

/** Sustituye cada `:param` de la ruta por su valor. */
function fill(path: string, values: Record<string, string>): string {
  return path.replace(/:(\w+)/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/** Un valor BIEN FORMADO para cada parámetro: un uuid nuevo para los ids. */
function wellFormedValues(route: RouteWithParams): Record<string, string> {
  return Object.fromEntries(
    route.params.map((name) => [
      name,
      isIdParam(name) ? randomUUID() : (NON_ID_PARAMS[name] ?? ""),
    ]),
  );
}

const label = (route: RouteWithParams): string => `${route.method} ${route.path}`;

describe("El id de cada ruta del API (F10-MANFIX-17)", () => {
  let app: INestApplication<App>;
  let owner: TenantFixture;
  let admin: TenantFixture;
  let routes: RouteWithParams[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    const prisma = app.get(PrismaService);
    // El admin de plataforma abre `/admin/*` y le enciende al negocio los dos
    // módulos pactados. Con ellos el negocio queda en Premium: ningún candado
    // de plan, de módulo o de permiso tapa el id que se está probando.
    admin = await adminDePlataforma(app, prisma, "route-ids-admin");
    owner = await consultorio(app, prisma, "route-ids", admin);
    routes = routesWithParams(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: string, url: string) => {
    const verb = method.toLowerCase() as HttpVerb;
    const token = url.startsWith("/admin/") ? admin.token : owner.token;
    return request(app.getHttpServer())[verb](url).set("Authorization", bearer(token));
  };

  /** Lo que contestó una ruta, en una línea que se entiende sin abrir nada. */
  const describeResponse = (res: request.Response): string => {
    const body = res.body as { code?: string; message?: string };
    return `${res.status} ${body.code ?? body.message ?? ""}`.trim();
  };

  it("el recorrido encuentra las rutas con id y no deja parámetros sin clasificar", () => {
    const withId = routes.filter((route) => route.params.some(isIdParam));

    // Un recorrido que dejara de ver el router pondría en verde, por vacío,
    // todo lo de abajo: la forma más silenciosa de perder esta red.
    expect(withId.length).toBeGreaterThan(100);
    expect(withId.map(label)).toEqual(
      expect.arrayContaining([
        "GET /products/:id",
        "PATCH /inventory/documents/:id/lines/:lineId",
        "GET /pos/quotes/:id",
        "POST /admin/tenants/:tenantId/users/:userId/suspend",
        "PATCH /catalogs/:catalogId/records/:recordId",
      ]),
    );

    const unclassified = [...new Set(routes.flatMap((route) => route.params))].filter(
      (name) => !isIdParam(name) && !(name in NON_ID_PARAMS),
    );
    const unknownVerbs = routes.filter(
      (route) => !HTTP_VERBS.includes(route.method.toLowerCase() as HttpVerb),
    );
    expect({ unclassified, unknownVerbs: unknownVerbs.map(label) }).toEqual({
      unclassified: [],
      unknownVerbs: [],
    });
  });

  it("un id que no es uuid responde 400 con `common.invalid_id` en cada ruta y en cada parámetro", async () => {
    const failures: string[] = [];

    for (const route of routes) {
      for (const param of route.params.filter(isIdParam)) {
        const url = fill(route.path, { ...wellFormedValues(route), [param]: NOT_A_UUID });
        const res = await send(route.method, url);
        const body = res.body as { code?: string };
        if (res.status !== 400 || body.code !== "common.invalid_id") {
          failures.push(`${route.method} ${url} → ${describeResponse(res)}`);
        }
      }
    }

    // El objeto y no el arreglo pelado: el diff de Jest nombra el problema y
    // lista TODAS las rutas que fallan, no solo la primera.
    expect({ sinValidarElId: failures }).toEqual({ sinValidarElId: [] });
  }, 120_000);

  /**
   * La otra cara: el candado no puede rechazar un id de verdad. Un uuid bien
   * formado pasa, y lo que conteste la ruta después (un 404, un 400 por el
   * cuerpo que falta) ya es asunto de cada servicio. Esto también atrapa un
   * `@UuidParam("orderid")` mal escrito, que rechazaría TODO.
   */
  it("un uuid bien formado pasa el candado en cada ruta", async () => {
    const rejected: string[] = [];

    for (const route of routes.filter((candidate) => candidate.params.some(isIdParam))) {
      const url = fill(route.path, wellFormedValues(route));
      const res = await send(route.method, url);
      const body = res.body as { code?: string };
      if (body.code === "common.invalid_id" || res.status >= 500) {
        rejected.push(`${route.method} ${url} → ${describeResponse(res)}`);
      }
    }

    expect({ rechazaUnUuidBienFormado: rejected }).toEqual({ rechazaUnUuidBienFormado: [] });
  }, 120_000);

  /**
   * El respaldo del filtro de excepciones. Un id que llega por la CONSULTA no
   * pasa por `@UuidParam`, y varios llegan crudos a la base (`?warehouseId=` de
   * los lotes, del kárdex, de los traspasos). Postgres no lo puede leer como
   * uuid y eso era un 500 nuestro con aviso a Sentry: es el mismo error de
   * quien llama que el de la ruta, y se contesta igual.
   */
  it("un uuid mal formado en la consulta también es 400 con `common.invalid_id`, no 500", async () => {
    const res = await send("GET", `/inventory/expiring?warehouseId=${NOT_A_UUID}`);

    expect({ status: res.status, code: (res.body as { code?: string }).code }).toEqual({
      status: 400,
      code: "common.invalid_id",
    });
  });

  /**
   * Un uuid bien formado que no existe sigue siendo el 404 de cada servicio,
   * con SU clave: la misma respuesta que un registro de otro negocio.
   */
  it.each([
    ["/products/:id", "products.not_found"],
    ["/suppliers/:id", "suppliers.not_found"],
    ["/purchases/:id", "purchases.not_found"],
    ["/purchase-orders/:id", "purchase_orders.not_found"],
    ["/inventory/documents/:id", "inventory.document_not_found"],
    ["/transfers/:id", "inventory.transfer_not_found"],
    ["/expenses/:id", "expenses.not_found"],
    ["/expenses/categories/:id", "expenses.category_not_found"],
    ["/users/:id", "users.not_found"],
    ["/reports/shifts/:id", "reports.shift_not_found"],
    ["/reception/customers/:id", "reception.customer_not_found"],
    ["/medical-clinic/records/:id", "medical_clinic.record_not_found"],
    ["/medical-clinic/lab-studies/:id", "medical_clinic.lab_study_not_found"],
    ["/medical-clinic/diagnostic-studies/:id", "medical_clinic.diagnostic_study_not_found"],
    ["/pos/quotes/:id", "pos.quote_not_found"],
    ["/pos/sales/:id", "pos.sale_not_found"],
    ["/admin/billing/tenants/:tenantId", "billing.tenant_not_found"],
  ])("un uuid que no existe en GET %s sigue siendo 404 (%s)", async (path, code) => {
    const res = await send("GET", fill(path, { id: randomUUID(), tenantId: randomUUID() }));

    expect({ status: res.status, code: (res.body as { code?: string }).code }).toEqual({
      status: 404,
      code,
    });
  });
});
