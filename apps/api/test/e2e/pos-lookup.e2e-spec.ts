import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import type { LookupItem } from "../../src/modules/pos/lookup.strategies";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-CART-01 — el buscador del mostrador.
 *
 * Lo que estos tests protegen no es "que la búsqueda encuentre cosas" sino la
 * regla que hace útil al POS: **solo se ofrece lo que se puede cobrar desde el
 * almacén del turno**. Un buscador generoso que muestra el catálogo entero
 * termina en un cobro que falla con el cliente enfrente.
 */
describe("Buscador del POS (F4-CART-01)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

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

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `lookup-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant lookup ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    const body = login.body as { accessToken: string };
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split(".")[1] as string, "base64").toString(),
    ) as { tenantId: string };

    return { token: body.accessToken, tenantId: payload.tenantId };
  }

  /**
   * Un tenant con dos almacenes y un catálogo pensado para que cada regla del
   * buscador tenga a qué agarrarse.
   */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const stamp = randomUUID().slice(0, 8);

    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const central = (await tx.warehouse.findFirstOrThrow({ select: { id: true } })).id;
      const sucursal = (
        await tx.warehouse.create({ data: { tenantId, name: `Sucursal ${stamp}` } })
      ).id;

      const producto = async (
        sku: string,
        name: string,
        opciones: {
          enCentral?: number;
          presentaciones?: { name: string; factor: number; barcode?: string; price?: number }[];
        } = {},
      ) => {
        const p = await tx.product.create({
          data: { tenantId, sku: `${sku}-${stamp}`, name },
        });
        for (const [i, pres] of (
          opciones.presentaciones ?? [{ name: "Pieza", factor: 1, price: 10 }]
        ).entries()) {
          await tx.productPresentation.create({
            data: {
              tenantId,
              productId: p.id,
              name: pres.name,
              factor: pres.factor,
              allowFractionalInput: false,
              isDefaultSale: i === 0,
              ...(pres.barcode !== undefined && { barcode: pres.barcode }),
              ...(pres.price !== undefined && { price: pres.price }),
            },
          });
        }
        if (opciones.enCentral !== undefined) {
          await tx.stockByWarehouse.create({
            data: { tenantId, productId: p.id, warehouseId: central, quantity: opciones.enCentral },
          });
        }
        return p.id;
      };

      // Los dígitos del código son únicos por corrida: el índice de barcode es
      // único por tenant, pero dos tenants de dos tests no deben chocar en la
      // lectura si algo quedara fuera de contexto.
      const codigoCaja = `75${stamp.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}01`;
      const codigoPieza = `75${stamp.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}02`;

      const conCodigo = await producto("BARRA", "Agua mineral", {
        enCentral: 50,
        presentaciones: [
          { name: "Pieza", factor: 1, barcode: codigoPieza, price: 12 },
          { name: "Caja ×12", factor: 12, barcode: codigoCaja, price: 130 },
        ],
      });

      const conStock = await producto("CONSTOCK", "Agua con gas", { enCentral: 30 });
      const sinStock = await producto("SINSTOCK", "Agua sin existencias", { enCentral: 0 });

      // El servicio se ofrece SOLO en Central. Sucursal nace sin ninguno.
      const servicio = await tx.service.create({
        data: { tenantId, code: `MAS-${stamp}`, name: "Masaje relajante", price: 400 },
      });
      await tx.serviceWarehouse.create({
        data: { tenantId, serviceId: servicio.id, warehouseId: central },
      });

      return {
        central,
        sucursal,
        conCodigo,
        conStock,
        sinStock,
        servicioId: servicio.id,
        codigoCaja,
        codigoPieza,
        stamp,
      };
    });

    return { token, tenantId, ...datos };
  }

  const abrirTurno = (token: string, warehouseId: string) =>
    request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({ warehouseId });

  const buscar = (token: string, q: string) =>
    request(app.getHttpServer())
      .get("/pos/lookup")
      .query({ q })
      .set("Authorization", bearer(token));

  const items = (res: { body: unknown }) => (res.body as { items: LookupItem[] }).items;

  describe("sin turno", () => {
    /**
     * El mismo 409 que el cobro. Devolver una lista vacía sería mentir: no es
     * que no haya nada, es que no se preguntó desde ningún lado.
     */
    it("buscar sin turno abierto da 409, no una lista vacía", async () => {
      const { token } = await escenario();

      const res = await buscar(token, "agua").expect(409);

      expect((res.body as { message: string }).message).toContain("turno de caja");
    });
  });

  describe("el almacén del turno ACOTA", () => {
    it("un producto sin stock en el almacén del turno NO aparece", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, "Agua").expect(200);
      const ids = items(res).map((i) => (i.type === "product" ? i.id : null));

      expect(ids).toContain(e.conStock);
      expect(ids).not.toContain(e.sinStock);
    });

    it("el mismo producto desaparece si el turno se abre en el OTRO almacén", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.sucursal).expect(201);

      const res = await buscar(e.token, "Agua").expect(200);

      // Todo el stock está en Central: desde Sucursal no hay nada que vender.
      expect(items(res).filter((i) => i.type === "product")).toHaveLength(0);
    });

    it("la respuesta dice contra qué almacén se resolvió", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, "Agua").expect(200);

      expect((res.body as { warehouseId: string }).warehouseId).toBe(e.central);
    });
  });

  describe("BarcodeLookup", () => {
    /**
     * ⚠ LA INVARIANTE DEL MÓDULO. **El código identifica la PRESENTACIÓN, no
     * el producto.** La caja de 12 y la pieza suelta son dos códigos del mismo
     * producto: escanear la caja y que el carrito preseleccione la pieza
     * cobraría una en vez de doce.
     */
    it("el código de la CAJA preselecciona la caja, no la pieza", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, e.codigoCaja).expect(200);
      const item = items(res)[0];

      expect(item?.type).toBe("product");
      if (item?.type !== "product") {
        throw new Error("se esperaba un producto");
      }
      const preseleccionada = item.presentations.find((p) => p.id === item.matchedPresentationId);
      expect(preseleccionada?.name).toBe("Caja ×12");
      expect(preseleccionada?.factor).toBe("12");
    });

    it("el código de la PIEZA preselecciona la pieza", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, e.codigoPieza).expect(200);
      const item = items(res)[0];

      if (item?.type !== "product") {
        throw new Error("se esperaba un producto");
      }
      const preseleccionada = item.presentations.find((p) => p.id === item.matchedPresentationId);
      expect(preseleccionada?.name).toBe("Pieza");
    });

    /**
     * `exact` es lo que le deja al carrito mandar el escaneo derecho a la
     * línea sin abrir una lista. Sin este dato, escanear se sentiría igual de
     * lento que teclear.
     */
    it("un acierto por código de barras viene marcado como exacto", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, e.codigoCaja).expect(200);

      expect((res.body as { exact: boolean }).exact).toBe(true);
      expect(items(res)).toHaveLength(1);
    });

    it("un código que no existe cae a la búsqueda difusa en vez de devolver vacío", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      // Todo dígitos y del largo de un EAN: `BarcodeLookup` lo intenta. Al no
      // acertar, la cadena SIGUE — cortar el acierto no es cortar el intento.
      const res = await buscar(e.token, "9999999999999").expect(200);

      expect((res.body as { exact: boolean }).exact).toBe(false);
    });
  });

  describe("SkuLookup", () => {
    it("el SKU exacto resuelve a un producto y viene marcado como exacto", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, `CONSTOCK-${e.stamp}`).expect(200);
      const item = items(res)[0];

      expect((res.body as { exact: boolean }).exact).toBe(true);
      expect(item?.type === "product" && item.id).toBe(e.conStock);
    });

    it("un SKU que existe pero SIN stock en este almacén no se ofrece", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, `SINSTOCK-${e.stamp}`).expect(200);

      // Sin la disponibilidad, el acierto exacto lo mandaría al carrito y el
      // cobro fallaría después.
      expect(items(res)).toHaveLength(0);
    });
  });

  describe("ServiceLookup", () => {
    it("encuentra el servicio ofrecido en el almacén del turno", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, "masaje").expect(200);
      const servicios = items(res).filter((i) => i.type === "service");

      expect(servicios).toHaveLength(1);
      expect(servicios[0]?.type === "service" && servicios[0].id).toBe(e.servicioId);
    });

    /**
     * La semántica EXPLÍCITA de `service_warehouses` (Carlos, 2026-08-19): sin
     * filas, el servicio no se vende en ningún lado. Al revés que
     * `user_warehouse_scopes`, donde vacío significa "todos".
     */
    it("un servicio NO asociado al almacén del turno no aparece", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.sucursal).expect(201);

      const res = await buscar(e.token, "masaje").expect(200);

      expect(items(res).filter((i) => i.type === "service")).toHaveLength(0);
    });

    /**
     * Un almacén nuevo nace SIN servicios (bitácora 2026-08-19). Buscar en un
     * turno abierto ahí devuelve vacío y 200 — no es una lista rota, es la
     * respuesta correcta.
     */
    it("un almacén nuevo no ofrece ningún servicio, y eso no es un error", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.sucursal).expect(201);

      const res = await buscar(e.token, "servicio").expect(200);

      expect(items(res)).toHaveLength(0);
    });
  });

  describe("QuoteLookup", () => {
    async function cotizacion(tenantId: string, warehouseId: string, folio: string) {
      return prisma.withTenantContext(tenantId, async (tx) => {
        const autor = await tx.user.findFirstOrThrow({ select: { id: true } });
        return tx.quote.create({
          data: { tenantId, folio, warehouseId, total: 500, createdBy: autor.id },
        });
      });
    }

    it("el folio COT resuelve a la cotización", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      const q = await cotizacion(e.tenantId, e.central, "COT-000001");

      const res = await buscar(e.token, "COT-000001").expect(200);
      const item = items(res)[0];

      expect((res.body as { exact: boolean }).exact).toBe(true);
      expect(item?.type === "quote" && item.id).toBe(q.id);
    });

    it("el folio en minúsculas resuelve igual: el cajero no teclea mayúsculas", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      await cotizacion(e.tenantId, e.central, "COT-000002");

      const res = await buscar(e.token, "cot-000002").expect(200);

      expect(items(res)[0]?.type).toBe("quote");
    });

    /**
     * Se devuelve MARCADA, no escondida: quien busca un folio ya usado necesita
     * enterarse de eso, no recibir un "no existe" que lo mande a recapturar.
     */
    it("una cotización ya cargada vuelve con su estado, no desaparece", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      const q = await cotizacion(e.tenantId, e.central, "COT-000003");
      await prisma.withTenantContext(e.tenantId, (tx) =>
        // `loadedAt` no es decorado: el CHECK `quotes_status_coherent` de
        // F4-DB-02 exige que un estado terminal traiga su fecha. Un `loaded`
        // sin cuándo sería una cotización usada que nadie puede rastrear.
        tx.quote.update({ where: { id: q.id }, data: { status: "loaded", loadedAt: new Date() } }),
      );

      const res = await buscar(e.token, "COT-000003").expect(200);
      const item = items(res)[0];

      expect(item?.type === "quote" && item.status).toBe("loaded");
    });

    /**
     * Una cotización se hace en un almacén y se puede cobrar en otro: el
     * cliente cotiza en la sucursal y pasa por la central.
     */
    it("una cotización de OTRO almacén se encuentra igual", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      await cotizacion(e.tenantId, e.sucursal, "COT-000004");

      const res = await buscar(e.token, "COT-000004").expect(200);

      expect(items(res)[0]?.type).toBe("quote");
    });

    it("una cotización de otro tenant no existe para este", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      const ajeno = await escenario();
      await cotizacion(ajeno.tenantId, ajeno.central, "COT-000009");

      const res = await buscar(e.token, "COT-000009").expect(200);

      expect(items(res)).toHaveLength(0);
    });
  });

  describe("TextSearchLookup", () => {
    it("media palabra del nombre encuentra el producto, sin marcar exacto", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);

      const res = await buscar(e.token, "miner").expect(200);

      expect((res.body as { exact: boolean }).exact).toBe(false);
      expect(items(res).some((i) => i.type === "product" && i.id === e.conCodigo)).toBe(true);
    });

    /**
     * Las difusas corren TODAS y se suman: buscar una palabra que está en un
     * producto y en un servicio tiene que traer los dos.
     */
    it("la búsqueda difusa suma productos y servicios", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      await prisma.withTenantContext(e.tenantId, (tx) =>
        tx.service.updateMany({ where: { id: e.servicioId }, data: { name: "Agua termal" } }),
      );

      const res = await buscar(e.token, "Agua").expect(200);

      expect(items(res).some((i) => i.type === "product")).toBe(true);
      expect(items(res).some((i) => i.type === "service")).toBe(true);
    });
  });

  describe("aislamiento entre tenants", () => {
    it("el catálogo de otro tenant no se busca desde acá", async () => {
      const e = await escenario();
      await abrirTurno(e.token, e.central).expect(201);
      const ajeno = await escenario();

      const res = await buscar(e.token, `CONSTOCK-${ajeno.stamp}`).expect(200);

      expect(items(res)).toHaveLength(0);
    });
  });
});
