import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-OUTSTK — el filtro «Agotados» del reporte de stock. Carlos
 * (2026-11-24): «Cuando se le da clic a producto agotado desde el panel
 * debería enviar al reporte de Stock por Sucursal y que haya otro filtro de
 * checkbox que diga agotados. Productos agotados son los que tienen un valor
 * en mínimo y la cantidad es cero».
 *
 * Es la regla del mosaico «Agotados» del panel: si fueran dos, el mosaico
 * diría «2» y la lista mostraría otra cosa.
 */
describe("Reporte de stock: el filtro de agotados (F10-OUTSTK)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const ids: Record<string, string> = {};

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant agotados ${randomUUID()}`,
        email,
        password: "twelve-characters",
        firstName: "Ana",
        lastName: "Pérez",
        locale: "es",
      })
      .expect(201);
    const tenantId = (registered.body as { tenantId: string }).tenantId;
    const mailer = app.get<NoopMailer>(MAILER);
    await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link) })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "twelve-characters" })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const central = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const norte = await tx.warehouse.create({
        data: { tenantId, code: `WH-${randomUUID().slice(0, 8)}`, name: "Norte agotados" },
      });
      const producto = async (
        clave: string,
        datos: { stockMin: string; isActive?: boolean; isComposite?: boolean },
        saldos: [string, string][],
      ) => {
        const p = await tx.product.create({
          data: { tenantId, sku: `${clave}-${randomUUID().slice(0, 6)}`, name: clave, ...datos },
        });
        ids[clave] = p.id;
        for (const [almacen, quantity] of saldos) {
          await tx.stockByWarehouse.create({
            data: { tenantId, productId: p.id, warehouseId: almacen, quantity },
          });
        }
      };

      // Con mínimo y en cero en las dos sucursales: agotado.
      await producto("Agotado", { stockMin: "10" }, [
        [central.id, "0"],
        [norte.id, "0"],
      ]);
      // Con «Vender sin existencias», un saldo negativo también está agotado.
      await producto("Negativo", { stockMin: "5" }, [[central.id, "-2"]]);
      // Bajo mínimo pero con existencia: NO está agotado.
      await producto("Poquito", { stockMin: "10" }, [[central.id, "3"]]);
      // En cero en una sucursal y con existencia en otra: el total no es cero.
      await producto("Repartido", { stockMin: "10" }, [
        [central.id, "0"],
        [norte.id, "4"],
      ]);
      // Sin mínimo: «no llevo control», aunque esté en cero.
      await producto("SinMinimo", { stockMin: "0" }, [[central.id, "0"]]);
      // Con lote y existencia, sin mínimo: el detalle por lote lo muestra,
      // pero NO es agotado ni está bajo mínimo.
      await producto("ConLote", { stockMin: "0" }, [[central.id, "20"]]);
      const conLote = ids.ConLote as string;
      await tx.product.update({ where: { id: conLote }, data: { tracksLots: true } });
      const lote = await tx.productLot.create({
        data: { tenantId, productId: conLote, lotCode: `L-${randomUUID().slice(0, 6)}` },
      });
      await tx.stockLot.create({
        data: { tenantId, lotId: lote.id, warehouseId: central.id, location: "", quantity: "20" },
      });
      // Desactivado o compuesto: el panel no los cuenta, el filtro tampoco.
      await producto("Inactivo", { stockMin: "10", isActive: false }, [[central.id, "0"]]);
      await producto("Compuesto", { stockMin: "10", isComposite: true }, [[central.id, "0"]]);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  type Fila = { productId: string; quantity: string; belowMin: boolean };
  const filas = async (query: string) =>
    (
      (await request(app.getHttpServer()).get(`/reports/stock?${query}`).set(auth()).expect(200))
        .body as { rows: Fila[]; total: number }
    ).rows;
  const productos = (rows: Fila[]) => [...new Set(rows.map((r) => r.productId))].sort();

  it("«Agotados» trae los productos con mínimo y total en cero o menos, con todas sus filas", async () => {
    const rows = await filas("outOfStock=true");

    expect(productos(rows)).toEqual([ids.Agotado, ids.Negativo].sort());
    expect(rows.filter((r) => r.productId === ids.Agotado)).toHaveLength(2);
  });

  it("el mosaico del panel cuenta los mismos que la lista", async () => {
    const panel = await request(app.getHttpServer())
      .get("/reports/dashboard/inventory")
      .set(auth())
      .expect(200);
    const rows = await filas("outOfStock=true");

    expect((panel.body as { outOfStock: number }).outOfStock).toBe(productos(rows).length);
  });

  it("con «Solo bajo mínimo» también puesto, quedan los agotados", async () => {
    const rows = await filas("outOfStock=true&belowMin=true");

    expect(productos(rows)).toEqual([ids.Agotado, ids.Negativo].sort());
  });

  it("«Solo bajo mínimo» sin «Agotados» sigue igual: incluye al que tiene poquito", async () => {
    const rows = await filas("belowMin=true");

    expect(productos(rows)).toEqual(
      expect.arrayContaining([ids.Poquito, ids.Repartido, ids.Agotado]),
    );
  });

  /**
   * Lo que encontró el verificador (B3): con «Detalle por lote y ubicación»
   * los filtros por producto se aceptaban y no filtraban nada.
   */
  it("con el detalle por lote, «Agotados» y «Solo bajo mínimo» también filtran", async () => {
    const lotes = async (query: string) =>
      (
        (
          await request(app.getHttpServer())
            .get(`/reports/stock?detail=lots&${query}`)
            .set(auth())
            .expect(200)
        ).body as { rows: { productId: string }[] }
      ).rows;

    expect((await lotes("")).some((r) => r.productId === ids.ConLote)).toBe(true);
    expect((await lotes("outOfStock=true")).some((r) => r.productId === ids.ConLote)).toBe(false);
    expect((await lotes("belowMin=true")).some((r) => r.productId === ids.ConLote)).toBe(false);
  });

  it("el Excel trae lo mismo que la pantalla", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/stock/export?outOfStock=true&format=csv")
      .set(auth())
      .expect(200);

    expect(res.text).toContain("Agotado");
    expect(res.text).toContain("Negativo");
    expect(res.text).not.toContain("Poquito");
    expect(res.text).not.toContain("Repartido");
  });
});
