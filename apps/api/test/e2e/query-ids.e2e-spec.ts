import { randomUUID } from "node:crypto";
import { type INestApplication, Logger, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { ModulesContainer } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { UUID_FALLBACK_WARNING } from "../../src/common/filters/all-exceptions.filter";
import { ZodValidationPipe } from "../../src/common/pipes/zod-validation.pipe";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-MANFIX-20 — los ids que viajan en la CONSULTA (`?warehouseId=`,
 * `?lotId=`…).
 *
 * La 17 cerró los ids de RUTA con `@UuidParam` (`route-ids.e2e-spec.ts`). Los
 * de la consulta quedaban a cargo de cada handler, y no todos los revisaban:
 * algunos leían `@Query("warehouseId")` suelto o la consulta entera como
 * `Record<string, string>`, y el texto llegaba crudo a Prisma. Los salvaba el
 * respaldo del filtro de excepciones (`isInvalidUuidInput`): Postgres no podía
 * leer el uuid y el filtro contestaba 400 `common.invalid_id` con un aviso en
 * el log. La respuesta era la correcta; el camino, no. El respaldo es una red
 * de seguridad, no la validación.
 *
 * Por eso esta prueba no se conforma con el 400: espía el aviso del filtro y
 * exige que NO salga. Un id mal formado se rechaza en el DTO de su consulta
 * —`z.uuid()` con la clave `common.invalid_id`— antes de tocar la base.
 *
 * Los handlers NO se listan a mano: salen de los metadatos de Nest (qué lee
 * cada método de la consulta) y de los esquemas de Zod de sus DTO (qué campos
 * son ids). Un handler nuevo con un id en la consulta entra solo al
 * recorrido, igual que una ruta nueva entra al de `route-ids`.
 */

/** Un handler que recibe al menos un id por la consulta. */
interface QueryIdHandler {
  method: string;
  path: string;
  /** Los campos de su consulta que son ids. */
  ids: string[];
}

/** Lo que Nest guarda de cada parámetro de un handler (`ROUTE_ARGS_METADATA`). */
interface RouteArg {
  data?: unknown;
  pipes?: unknown[];
}

/**
 * Lo poco que se lee de un esquema de Zod 4: su definición. Se mira la forma
 * y no la clase para no depender de que el esquema venga de la misma copia de
 * `zod` que esta prueba (los de `@sellpoint/shared` traen la suya).
 */
interface ZodLike {
  _zod: {
    def: {
      format?: string;
      checks?: ZodLike[];
      shape?: Record<string, ZodLike>;
      innerType?: ZodLike;
      in?: ZodLike;
      out?: ZodLike;
    };
  };
}

/** Lo poco que se lee del router de Express 5: sus capas con ruta. */
interface ExpressWithRouter {
  router: {
    stack: { route?: { path: string; methods: Record<string, boolean> } }[];
  };
}

/**
 * Lo que un handler EXIGE en su consulta además de los ids, con un valor
 * válido: sin esto el 400 sería por el campo que falta y no por el id. Un
 * handler nuevo con un campo obligatorio hace fallar el recorrido hasta que
 * alguien lo agregue acá.
 */
const REQUIRED_QUERY: Record<string, Record<string, string>> = {
  "GET /pos/lookup": { q: "Agua" },
  "GET /inventory/documents": { type: "entry" },
  "GET /inventory/documents/template": { type: "physical_count" },
};

/**
 * Los handlers que leen la consulta ENTERA sin un DTO de Zod en su `@Query`.
 * Solo el listado de productos: sus `?attr.<campo>=` son filtros por campo
 * personalizado que el negocio inventa, se comparan contra el JSON de
 * `attributes` y ninguno llega a una columna uuid; el resto de su consulta
 * pasa por `listProductsQuerySchema` dentro del handler.
 */
const RAW_QUERY_ALLOWED = new Set(["GET /products"]);

const NOT_A_UUID = "no-es-un-uuid";

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

const isIdName = (name: string): boolean => name === "id" || name.endsWith("Id");

/** ¿El esquema, quitadas sus envolturas (opcional, default, catch, pipe), es un uuid? */
function isUuidSchema(schema: ZodLike | undefined): boolean {
  if (schema === undefined) {
    return false;
  }
  const def = schema._zod.def;
  // `z.uuid()` lleva el formato en su definición; `z.string().uuid()`, en un check.
  if (def.format === "uuid" || def.checks?.some((check) => check._zod.def.format === "uuid")) {
    return true;
  }
  return [def.innerType, def.in, def.out].some(isUuidSchema);
}

/** Los campos de un DTO de consulta, aunque venga refinado o transformado. */
function shapeOf(schema: ZodLike | undefined): Record<string, ZodLike> {
  if (schema === undefined) {
    return {};
  }
  const def = schema._zod.def;
  return def.shape ?? { ...shapeOf(def.in), ...shapeOf(def.innerType) };
}

/** `@Controller("reports")` + `@Get("stock")` → `/reports/stock`. */
function joinPath(base: unknown, subpath: unknown): string {
  return `/${String(base)}/${String(subpath)}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
}

/**
 * Recorre los controladores de la app ya armada y devuelve los handlers con
 * ids en la consulta, y los que leen la consulta entera sin DTO (que esconden
 * sus campos: no se puede saber si alguno es un id).
 */
function discoverQueryIds(app: INestApplication): {
  handlers: QueryIdHandler[];
  rawQueries: string[];
} {
  const handlers: QueryIdHandler[] = [];
  const rawQueries: string[] = [];

  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype;
      if (typeof controller !== "function") {
        continue;
      }
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const target = prototype[name];
        // `constructor` es la clase misma, que también tiene `PATH_METADATA`.
        if (name === "constructor" || typeof target !== "function") {
          continue;
        }
        const subpath: unknown = Reflect.getMetadata(PATH_METADATA, target);
        if (subpath === undefined) {
          continue;
        }
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, target) as number];
        const path = joinPath(Reflect.getMetadata(PATH_METADATA, controller), subpath);
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
          string,
          RouteArg
        >;

        const ids: string[] = [];
        for (const [key, arg] of Object.entries(args)) {
          if (!key.startsWith(`${RouteParamtypes.QUERY}:`)) {
            continue;
          }
          const pipe = arg.pipes?.find((candidate) => candidate instanceof ZodValidationPipe);
          // `schema` es privado en el pipe; acá solo se lee para saber qué valida.
          const schema = (pipe as { schema?: ZodLike } | undefined)?.schema;
          if (typeof arg.data === "string") {
            if (isIdName(arg.data) || isUuidSchema(schema)) {
              ids.push(arg.data);
            }
          } else if (schema !== undefined) {
            for (const [field, fieldSchema] of Object.entries(shapeOf(schema))) {
              if (isIdName(field) || isUuidSchema(fieldSchema)) {
                ids.push(field);
              }
            }
          } else {
            rawQueries.push(`${method} ${path}`);
          }
        }
        if (ids.length > 0) {
          handlers.push({ method: method ?? "?", path, ids });
        }
      }
    }
  }

  return { handlers, rawQueries };
}

function expressRoutes(app: INestApplication): Set<string> {
  const express: ExpressWithRouter = app.getHttpAdapter().getInstance();
  return new Set(
    express.router.stack.flatMap(({ route }) =>
      route
        ? Object.keys(route.methods).map((method) => `${method.toUpperCase()} ${route.path}`)
        : [],
    ),
  );
}

const label = (handler: QueryIdHandler): string => `${handler.method} ${handler.path}`;

/**
 * La URL de un handler: un uuid nuevo en cada parámetro de ruta, lo que su
 * consulta exige, un uuid bien formado en cada id y, encima, lo que la prueba
 * quiere poner a prueba. Con los demás ids bien formados, el único error
 * posible es el del campo que se está probando.
 */
function urlFor(handler: QueryIdHandler, overrides: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    ...REQUIRED_QUERY[label(handler)],
    ...Object.fromEntries(handler.ids.map((field) => [field, randomUUID()])),
    ...overrides,
  });
  return `${handler.path.replace(/:(\w+)/g, () => randomUUID())}?${query.toString()}`;
}

describe("Los ids de la consulta se validan en su DTO (F10-MANFIX-20)", () => {
  let app: INestApplication<App>;
  let owner: TenantFixture;
  let admin: TenantFixture;
  let handlers: QueryIdHandler[];
  let rawQueries: string[];
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    const prisma = app.get(PrismaService);
    // El mismo escenario que `route-ids`: el negocio queda en Premium con sus
    // módulos, así que ningún candado de plan, de módulo o de permiso contesta
    // antes que el DTO de la consulta.
    admin = await adminDePlataforma(app, prisma, "query-ids-admin");
    owner = await consultorio(app, prisma, "query-ids", admin);
    ({ handlers, rawQueries } = discoverQueryIds(app));
    // Sin `mockImplementation`: los demás avisos del log siguen saliendo.
    warn = jest.spyOn(Logger.prototype, "warn");
  });

  afterAll(async () => {
    warn.mockRestore();
    await app.close();
  });

  const send = (method: string, url: string) => {
    const verb = method.toLowerCase() as HttpVerb;
    const token = url.startsWith("/admin/") ? admin.token : owner.token;
    return request(app.getHttpServer())[verb](url).set("Authorization", bearer(token));
  };

  /** ¿El respaldo del filtro contestó alguna petición desde el último `mockClear`? */
  const fallbackFired = (): boolean =>
    warn.mock.calls.some(([message]) => String(message).startsWith(UUID_FALLBACK_WARNING));

  /** Lo que contestó un handler, en una línea que se entiende sin abrir nada. */
  const describeResponse = (res: request.Response): string => {
    const body = res.body as { code?: string; message?: string };
    const via = fallbackFired() ? " (por el respaldo del filtro)" : "";
    return `${res.status} ${body.code ?? body.message ?? ""}`.trim() + via;
  };

  it("el recorrido encuentra los ids de la consulta y ningún handler la lee sin DTO", () => {
    // Un recorrido que dejara de ver los metadatos pondría en verde, por
    // vacío, todo lo de abajo: la forma más silenciosa de perder esta red.
    expect(handlers.length).toBeGreaterThan(30);
    expect(handlers.map(label)).toEqual(
      expect.arrayContaining([
        "GET /inventory/expiring",
        "GET /products/:id/kardex",
        "GET /products/:id/stock",
        "GET /transfers",
        "GET /inventory/in-transit",
        "GET /reports/sales",
        "GET /purchases/last-cost",
        "GET /admin/tenants/:tenantId/reports/stock",
      ]),
    );

    // Una ruta mal armada probaría URLs que no existen, y cada 404 de Express
    // se leería como un id sin validar.
    const router = expressRoutes(app);
    // Una consulta leída entera y sin DTO esconde sus campos: si trae un id,
    // este recorrido no lo vería.
    expect({
      fueraDelRouter: handlers.map(label).filter((route) => !router.has(route)),
      consultaSinDto: rawQueries.filter((route) => !RAW_QUERY_ALLOWED.has(route)),
    }).toEqual({ fueraDelRouter: [], consultaSinDto: [] });
  });

  it("un id mal formado responde 400 `common.invalid_id` desde su DTO, sin pasar por el respaldo", async () => {
    const failures: string[] = [];

    for (const handler of handlers) {
      for (const field of handler.ids) {
        const url = urlFor(handler, { [field]: NOT_A_UUID });
        warn.mockClear();
        const res = await send(handler.method, url);
        const body = res.body as { code?: string };
        if (res.status !== 400 || body.code !== "common.invalid_id" || fallbackFired()) {
          failures.push(`${handler.method} ${url} → ${describeResponse(res)}`);
        }
      }
    }

    // El objeto y no el arreglo pelado: el diff de Jest nombra el problema y
    // lista TODOS los campos que fallan, no solo el primero.
    expect({ sinValidarEnSuDto: failures }).toEqual({ sinValidarEnSuDto: [] });
  }, 120_000);

  /**
   * La otra cara: la validación no puede rechazar un id de verdad. Con todos
   * sus ids bien formados, lo que conteste cada handler (una lista vacía, un
   * 404 del producto) ya es asunto de su servicio. Esto también atrapa un
   * esquema que rechazara TODO por un error de tipeo.
   */
  it("con uuids bien formados cada handler pasa su DTO, y tampoco toca el respaldo", async () => {
    const rejected: string[] = [];

    for (const handler of handlers) {
      const url = urlFor(handler);
      warn.mockClear();
      const res = await send(handler.method, url);
      const body = res.body as { code?: string };
      if (body.code === "common.invalid_id" || res.status >= 500 || fallbackFired()) {
        rejected.push(`${handler.method} ${url} → ${describeResponse(res)}`);
      }
    }

    expect({ rechazaUnUuidBienFormado: rejected }).toEqual({ rechazaUnUuidBienFormado: [] });
  }, 120_000);

  /**
   * Los handlers del inventario que DESCARTAN la basura en vez de reventar
   * (lotes, en tránsito, traspasos) trataban un id vacío como «sin filtro», y
   * lo siguen haciendo con su DTO: vacío no es un id mal formado, es que no
   * hay id.
   */
  it.each([
    "/inventory/expiring?warehouseId=",
    "/inventory/expiring/export?warehouseId=",
    "/inventory/in-transit?productId=&originWarehouseId=",
    "/inventory/in-transit/export?productId=&originWarehouseId=",
    "/transfers?originWarehouseId=&destinationWarehouseId=&warehouseId=",
  ])("un id vacío en %s sigue siendo «sin filtro»", async (url) => {
    const res = await send("GET", url);

    expect(res.status).toBe(200);
  });
});
