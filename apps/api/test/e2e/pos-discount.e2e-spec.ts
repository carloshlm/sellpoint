import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  cargarStock,
  crearProducto,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-DISC — el descuento del ticket, de punta a punta (Carlos, 2026-09-09).
 *
 * El Admin define el código en `PATCH /tenants/me`: viaja UNA vez, se guarda
 * hasheado y nunca vuelve al cliente (solo la fecha en que se definió). El
 * cajero lo teclea al cobrar y el servidor lo verifica ANTES de tocar el
 * inventario: sin código configurado → 422; código malo → 403 y un intento
 * gastado; cinco fallos → 429 por quince minutos aunque el sexto sea el bueno.
 * El importe se prorratea entre las líneas por su bruto (los centavos
 * sobrantes van a la fracción mayor) y respeta el tope del negocio.
 *
 * ⚠ Los casos comparten el contador de intentos del usuario: el orden importa.
 * Un acierto lo pone en cero, y los 422 de tope/subtotal llegan DESPUÉS de
 * verificar el código, así que también lo dejan en cero.
 */
describe("descuento del ticket con código de autorización (F4-DISC)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fx: TenantFixture;
  let caro: string;
  let barato: string;
  const http = () => request(app.getHttpServer());

  /** Dos líneas: 100 + 50 = 150 brutos, para que el prorrateo tenga algo que repartir. */
  const vender = (discount?: { amount: number; code: string; reason?: string }) =>
    http()
      .post("/pos/sales")
      .set("Authorization", bearer(fx.token))
      .send({
        paymentMethod: "cash",
        lines: [
          { productId: caro, quantity: 1 },
          { productId: barato, quantity: 1 },
        ],
        ...(discount && { discount }),
      });

  const pdf = (ruta: string, token: string) =>
    http()
      .get(ruta)
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  const configurar = (body: Record<string, unknown>) =>
    http().patch("/tenants/me").set("Authorization", bearer(fx.token)).send(body);

  const ventas = () => prisma.withTenantContext(fx.tenantId, (tx) => tx.sale.count());

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    fx = await registerTenant(app, "disc");
    await setTenantMarket(prisma, fx.tenantId, "MX");
    // IVA 16 % incluido, sembrado a mano como en pos-taxes: el papel con
    // descuento tiene que mostrar Subtotal → Descuento → Base gravable → IVA.
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { taxMode: "included" } });
    await prisma.withTenantContext(fx.tenantId, (tx) =>
      tx.taxGroup.create({
        data: {
          tenantId: fx.tenantId,
          code: "VAT16",
          name: "IVA 16%",
          isDefault: true,
          sortOrder: 0,
          rates: {
            create: [
              { tenantId: fx.tenantId, code: "VAT", name: "IVA 16%", rate: "16", sortOrder: 0 },
            ],
          },
        },
      }),
    );
    const almacen = await almacenInicial(prisma, fx.tenantId);
    caro = (await crearProducto(app, fx.token, 100)).id;
    barato = (await crearProducto(app, fx.token, 50)).id;
    await cargarStock(app, fx.token, almacen, caro, 50);
    await cargarStock(app, fx.token, almacen, barato, 50);
    await http().post("/pos/session").set("Authorization", bearer(fx.token)).send({}).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin código configurado, un descuento no se cobra: 422 y ninguna venta", async () => {
    const res = await vender({ amount: 5, code: "1234" }).expect(422);

    expect((res.body as { code: string }).code).toBe("pos.discount_not_configured");
    expect(await ventas()).toBe(0);
  });

  it("el Admin define el código y el tope: vuelve la fecha, nunca el código ni su hash", async () => {
    const res = await configurar({ discountCode: "1234", discountMaxPercent: 10 }).expect(200);

    const body = res.body as { discountCodeSetAt: unknown; discountMaxPercent: unknown };
    expect(typeof body.discountCodeSetAt).toBe("string");
    expect(body.discountMaxPercent).toBe("10");
    expect(body).not.toHaveProperty("discountCodeHash");
    expect(JSON.stringify(body)).not.toMatch(/1234|argon2/);

    const me = await http().get("/tenants/me").set("Authorization", bearer(fx.token)).expect(200);
    expect((me.body as { discountMaxPercent: string }).discountMaxPercent).toBe("10");
    expect(JSON.stringify(me.body)).not.toMatch(/1234|argon2/);

    // En la base vive un hash, no el código.
    const fila = await prisma.tenant.findUniqueOrThrow({
      where: { id: fx.tenantId },
      select: { discountCodeHash: true },
    });
    expect(fila.discountCodeHash).toEqual(expect.any(String));
    expect(fila.discountCodeHash).not.toContain("1234");

    // La bitácora sabe QUE se definió, no CUÁL: ni el código ni el hash.
    const bitacora = await prisma.withTenantContext(fx.tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { action: "tenant.updated" },
        orderBy: { createdAt: "desc" },
        take: 1,
      }),
    );
    expect(bitacora[0]?.after).toMatchObject({ discountCode: "[set]", discountMaxPercent: 10 });
    expect(JSON.stringify(bitacora)).not.toMatch(/1234|argon2/);
  });

  it("un código que no son 4 a 8 dígitos, o un tope fuera de (0, 100], se rechaza: 400", async () => {
    await configurar({ discountCode: "12" }).expect(400);
    await configurar({ discountCode: "12ab" }).expect(400);
    await configurar({ discountCode: "123456789" }).expect(400);
    await configurar({ discountMaxPercent: 101 }).expect(400);
    await configurar({ discountMaxPercent: 0 }).expect(400);
  });

  it("código equivocado: 403 y la venta no se abre", async () => {
    const res = await vender({ amount: 5, code: "9999" }).expect(403);

    expect((res.body as { code: string }).code).toBe("pos.discount_code_invalid");
    expect(await ventas()).toBe(0);
  });

  it("código correcto: el descuento se prorratea por el bruto de cada línea y baja el total", async () => {
    const res = await vender({ amount: 5, code: "1234", reason: "  Cliente frecuente  " }).expect(
      201,
    );

    const body = res.body as {
      id: string;
      subtotal: string;
      discount: string;
      total: string;
      taxTotal: string;
      items: { discount: string; lineTotal: string }[];
    };
    expect(body.subtotal).toBe("150");
    expect(body.discount).toBe("5");
    expect(body.total).toBe("145");
    // 5.00 entre 100 y 50: 3.333… y 1.666… → 3.33 + 1.67 (el centavo sobrante
    // va a la fracción mayor), y ninguna línea queda en negativo.
    expect(body.items.map((i) => [i.discount, i.lineTotal])).toEqual([
      ["3.33", "96.67"],
      ["1.67", "48.33"],
    ]);

    const guardada = await prisma.withTenantContext(fx.tenantId, (tx) =>
      tx.sale.findUniqueOrThrow({
        where: { id: body.id },
        select: { discount: true, discountReason: true },
      }),
    );
    expect(guardada.discount.toString()).toBe("5");
    expect(guardada.discountReason).toBe("Cliente frecuente");

    // El papel (Carlos, 2026-09-09): cada línea a su importe de LISTA, y el
    // descuento UNA sola vez en el pie. Si la línea saliera ya descontada,
    // las líneas sumarían 145 y abajo diría «Descuento −5»: dos veces. Con
    // IVA incluido, la base gravable (145 / 1.16 = 125) se llama por su
    // nombre, no «Subtotal», y las dos restas cierran a la vista.
    const papel = await pdf(`/pos/sales/${body.id}/ticket`, fx.token).expect(200);
    const texto = textoDelPdf(papel.body as Buffer);
    expect(texto).toContain("1 pieza × $100.00$100.00");
    expect(texto).toContain("1 pieza × $50.00$50.00");
    expect(texto).not.toContain("$96.67");
    expect(texto).not.toContain("$48.33");
    expect(texto).toContain(
      "Subtotal$150.00Descuento-$5.00Base gravable$125.00IVA 16%$20.00Total$145.00",
    );
    expect(body.taxTotal).toBe("20");
  });

  it("más que el tope del negocio (10 % de 150 = 15): 422 y ninguna venta nueva", async () => {
    const antes = await ventas();

    const res = await vender({ amount: 15.01, code: "1234" }).expect(422);

    expect((res.body as { code: string }).code).toBe("pos.discount_exceeds_limit");
    expect(await ventas()).toBe(antes);
  });

  it("más que el subtotal: 422, antes siquiera de mirar el tope", async () => {
    const res = await vender({ amount: 150.01, code: "1234" }).expect(422);

    expect((res.body as { code: string }).code).toBe("pos.discount_exceeds_subtotal");
  });

  it("un descuento de cero o con tres decimales no pasa del DTO: 400", async () => {
    await vender({ amount: 0, code: "1234" }).expect(400);
    await vender({ amount: 1.005, code: "1234" }).expect(400);
    await vender({ amount: 5, code: "12" }).expect(400);
  });

  it("sin descuento la venta sigue igual que siempre, con o sin código configurado", async () => {
    const res = await vender().expect(201);

    const body = res.body as { discount: string; total: string };
    expect(body.discount).toBe("0");
    expect(body.total).toBe("150");
  });

  it("quitar el código apaga los descuentos: PATCH null → 422 al cobrar con descuento", async () => {
    const res = await configurar({ discountCode: null }).expect(200);
    expect((res.body as { discountCodeSetAt: unknown }).discountCodeSetAt).toBeNull();

    const venta = await vender({ amount: 5, code: "1234" }).expect(422);
    expect((venta.body as { code: string }).code).toBe("pos.discount_not_configured");
  });

  it("cinco códigos malos cierran el candado: el sexto es 429 aunque sea el bueno", async () => {
    await configurar({ discountCode: "4321" }).expect(200);
    const antes = await ventas();

    for (let intento = 0; intento < 5; intento += 1) {
      await vender({ amount: 5, code: "0000" }).expect(403);
    }
    const res = await vender({ amount: 5, code: "4321" }).expect(429);

    expect((res.body as { code: string }).code).toBe("pos.discount_code_locked");
    expect(await ventas()).toBe(antes);
  });
});
