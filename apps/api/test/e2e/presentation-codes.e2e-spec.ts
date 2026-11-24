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
 * F10-PRESCODE — el código interno de una presentación (Carlos, 2026-11-23):
 * «pero es que si debe poder tener la opción de dar la entrada a por ejemplo
 * la bolsa de 1 Kilo o la Bolsa de 10 Kilos, ya sea por código de barra o
 * código interno».
 *
 * Y la regla que lo acompaña: «No puede repetirse con ningún otro código del
 * negocio: ni con el código interno de un producto, ni con el de otra
 * presentación, ni con un código de barras».
 */
describe("Código interno de las presentaciones (F10-PRESCODE)", () => {
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

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant prescode ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  const bearer = (token: string) => `Bearer ${token}`;

  async function crearProducto(
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; sku: string }> {
    const res = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(token))
      .send({ baseUnit: "kg", price: 180, ...body })
      .expect(201);
    return res.body as { id: string; sku: string };
  }

  function crearPresentacion(token: string, productId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/products/${productId}/presentations`)
      .set("Authorization", bearer(token))
      .send(body);
  }

  function editarPresentacion(
    token: string,
    productId: string,
    presentationId: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .patch(`/products/${productId}/presentations/${presentationId}`)
      .set("Authorization", bearer(token))
      .send(body);
  }

  type Conflicto = {
    message: string;
    errors?: { key: string; code: string; message: string }[];
  };

  describe("guardar el código", () => {
    it("una presentación guarda su código interno normalizado como el sku", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });

      const bolsa = await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "  bolsa10k ",
      }).expect(201);

      expect((bolsa.body as { code: string }).code).toBe("BOLSA10K");

      const lista = await request(app.getHttpServer())
        .get(`/products/${bistec.id}/presentations`)
        .set("Authorization", bearer(token))
        .expect(200);
      const guardada = (lista.body as { name: string; code: string | null }[]).find(
        (p) => p.name === "Bolsa 10 Kilos",
      );
      expect(guardada?.code).toBe("BOLSA10K");
    });

    it("se edita, se reenvía igual sin chocar consigo y se borra con null", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const bolsa = (
        await crearPresentacion(token, bistec.id, {
          name: "Bolsa 1 Kilo",
          factor: 1,
          code: "BOLSA1K",
        }).expect(201)
      ).body as { id: string };

      // El formulario reenvía el código en cada guardado.
      await editarPresentacion(token, bistec.id, bolsa.id, {
        name: "Bolsa 1 Kilo",
        code: "BOLSA1K",
      }).expect(200);

      const cambiada = await editarPresentacion(token, bistec.id, bolsa.id, {
        code: "bistek1kilo",
      }).expect(200);
      expect((cambiada.body as { code: string }).code).toBe("BISTEK1KILO");

      const sinCodigo = await editarPresentacion(token, bistec.id, bolsa.id, {
        code: null,
      }).expect(200);
      expect((sinCodigo.body as { code: string | null }).code).toBeNull();
    });

    it("el código de otro negocio no choca", async () => {
      const a = await registerAndLogin();
      const b = await registerAndLogin();
      const enA = await crearProducto(a.token, { sku: "BISTEC-X", name: "Bistec" });
      const enB = await crearProducto(b.token, { sku: "BISTEC-X", name: "Bistec" });

      await crearPresentacion(a.token, enA.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);
      await crearPresentacion(b.token, enB.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);
    });
  });

  describe("no se repite con ningún otro código del negocio", () => {
    it("ni con el código interno de un producto (aunque cambien las mayúsculas)", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });

      const res = await crearPresentacion(token, bistec.id, {
        name: "Bolsa 1 Kilo",
        factor: 1,
        code: "arrachera",
      }).expect(409);

      const body = res.body as Conflicto;
      expect(body.message).toBe("Ese código ya es el código interno del producto Arrachera.");
      expect(body.errors).toEqual([
        {
          key: "code",
          code: "products.code_taken_product_sku",
          message: "Ese código ya es el código interno del producto Arrachera.",
        },
      ]);
    });

    it("ni con el código interno de otra presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const arrachera = await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });
      await crearPresentacion(token, arrachera.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);

      const res = await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "bolsa10k",
      }).expect(409);

      expect((res.body as Conflicto).message).toBe(
        "Ese código ya es el código interno de «Bolsa 10 Kilos» de Arrachera.",
      );
    });

    it("ni con un código de barras, también en su otra escritura (UPC-A ↔ EAN-13)", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      // El UPC-A de 12 dígitos guardado como código de barras del producto.
      await crearProducto(token, { sku: "AGUA-1L", name: "Agua 1 L", barcode: "036000291452" });

      const res = await crearPresentacion(token, bistec.id, {
        name: "Bolsa 1 Kilo",
        factor: 1,
        // El mismo código como EAN-13: un cero delante.
        code: "0036000291452",
      }).expect(409);

      expect((res.body as Conflicto).message).toBe(
        "Ese código ya es el código de barras de «Kilogramo» de Agua 1 L.",
      );
    });

    it("ni con su propio producto: el sku y el código de la presentación serían ambiguos", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });

      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 1 Kilo",
        factor: 1,
        code: "BISTEC-X",
      }).expect(409);
    });

    it("al editar, el código nuevo también se revisa", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });
      const bolsa = (
        await crearPresentacion(token, bistec.id, {
          name: "Bolsa 1 Kilo",
          factor: 1,
          code: "BOLSA1K",
        }).expect(201)
      ).body as { id: string };

      await editarPresentacion(token, bistec.id, bolsa.id, { code: "ARRACHERA" }).expect(409);
    });

    it("al revés: un producto nuevo no puede tomar como sku el código de una presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);

      const res = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(token))
        .send({ sku: "bolsa10k", name: "Otra cosa", baseUnit: "unit", price: 10 })
        .expect(409);

      const body = res.body as Conflicto;
      expect(body.message).toBe(
        "Ese código ya es el código interno de «Bolsa 10 Kilos» de Bistec.",
      );
      expect(body.errors?.[0]?.key).toBe("sku");
    });

    it("al revés: cambiarle el sku a un producto tampoco", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const arrachera = await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/products/${arrachera.id}`)
        .set("Authorization", bearer(token))
        .send({ sku: "BOLSA10K" })
        .expect(409);

      // Reenviar su propio sku sigue funcionando.
      await request(app.getHttpServer())
        .patch(`/products/${arrachera.id}`)
        .set("Authorization", bearer(token))
        .send({ sku: "ARRACHERA", name: "Arrachera de res" })
        .expect(200);
    });

    it("al revés: un código de barras no puede ser el código de una presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const arrachera = await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });
      // Un código interno de puros números, como los que ya usa una farmacia.
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "200001",
      }).expect(201);

      // Ni en el producto…
      const enProducto = await request(app.getHttpServer())
        .patch(`/products/${arrachera.id}`)
        .set("Authorization", bearer(token))
        .send({ barcode: "200001" })
        .expect(409);
      expect((enProducto.body as Conflicto).errors?.[0]?.key).toBe("barcode");

      // …ni en otra presentación.
      await crearPresentacion(token, arrachera.id, {
        name: "Bolsa 5 Kilos",
        factor: 5,
        barcode: "200001",
      }).expect(409);

      // Una presentación sí puede tener el mismo número como código y como
      // código de barras: es ella misma.
      const propia = await crearPresentacion(token, arrachera.id, {
        name: "Bolsa 2 Kilos",
        factor: 2,
        code: "300001",
      }).expect(201);
      await editarPresentacion(token, arrachera.id, (propia.body as { id: string }).id, {
        barcode: "300001",
      }).expect(200);
    });

    it("Carga rápida rechaza en su renglón el código que ya es de una presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "200001",
      }).expect(201);

      const res = await request(app.getHttpServer())
        .post("/products/quick")
        .set("Authorization", bearer(token))
        .send({ lines: [{ code: "200001", name: "Otra cosa", price: 10 }] })
        .expect(422);

      expect((res.body as { errors: unknown[] }).errors).toEqual([
        {
          line: 1,
          itemCode: "200001",
          field: "code",
          code: "products.code_taken_presentation_code",
          message: "Ese código ya es el código interno de «Bolsa 10 Kilos» de Bistec.",
        },
      ]);
      expect(await prisma.product.count({ where: { sku: "200001" } })).toBe(0);
    });

    it("la importación rechaza en su fila el sku nuevo que ya es de una presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);

      const res = await request(app.getHttpServer())
        .post("/products/import")
        .set("Authorization", bearer(token))
        .send({ content: "sku,nombre\nbolsa10k,Otra cosa\nPAN-1,Pan", dryRun: true })
        .expect(200);

      expect(res.body).toMatchObject({
        valid: 1,
        failed: 1,
        errors: [
          {
            row: 2,
            field: "sku",
            code: "products.code_taken_presentation_code",
            message: "Ese código ya es el código interno de «Bolsa 10 Kilos» de Bistec.",
          },
        ],
      });
    });
  });
  /**
   * Lo que encontró el verificador (B1): la importación revisaba en una
   * transacción y escribía en otra, sin el candado. Un código de presentación
   * guardado entre las dos se colaba como sku. Aquí se sostiene el candado,
   * se deja que la importación pase su revisión y quede esperando para
   * escribir, y se guarda el código justo en medio: tiene que rebotar.
   */
  it("la importación revisa otra vez con el candado: un código guardado en medio no se cuela", async () => {
    const { token, tenantId } = await registerAndLogin();
    const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
    const caja = (
      await crearPresentacion(token, bistec.id, { name: "Caja 11", factor: 11 }).expect(201)
    ).body as { id: string };

    let soltar: () => void = () => {};
    const candadoSuelto = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    let avisarTomado: () => void = () => {};
    const tomado = new Promise<void>((resolve) => {
      avisarTomado = resolve;
    });
    const sostenedor = prisma.withTenantContext(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-codes:${tenantId}`}::text, 0))`;
      avisarTomado();
      await candadoSuelto;
      await tx.productPresentation.update({ where: { id: caja.id }, data: { code: "IMPRACE" } });
    });
    await tomado;

    const importacion = request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre\nIMPRACE,Otra cosa", dryRun: false })
      .then((res) => res);

    // La importación ya revisó (sin choque) y espera el candado para escribir.
    for (let intento = 0; intento < 100; intento += 1) {
      const [fila] = await prisma.$queryRaw<{ esperando: bigint }[]>`
        SELECT count(*) AS esperando FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (Number(fila?.esperando ?? 0) > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    soltar();
    await sostenedor;

    const res = await importacion;
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe(
      "Ese código ya es el código interno de «Caja 11» de Bistec.",
    );
    expect(await prisma.product.count({ where: { tenantId, sku: "IMPRACE" } })).toBe(0);
  });

  /**
   * Carlos (2026-11-24): «debemos evitar que el Codigo Interno sea igual al
   * código de barras o código interno de otro producto». Lo que sigue
   * permitido es usar el PROPIO código de barras como código interno, que es
   * lo que hacen Carga rápida y el alta.
   */
  describe("el código interno de un producto no es el código de barras de otro", () => {
    it("ni al darlo de alta ni al cambiarlo", async () => {
      const { token } = await registerAndLogin();
      await crearProducto(token, { sku: "AGUA-1L", name: "Agua 1 L", barcode: "036000291452" });
      const arrachera = await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });

      const alta = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(token))
        // La otra escritura del mismo código (EAN-13 con un cero delante).
        .send({ sku: "0036000291452", name: "Otra cosa", baseUnit: "unit", price: 10 })
        .expect(409);
      expect((alta.body as Conflicto).message).toBe(
        "Ese código ya es el código de barras de «Kilogramo» de Agua 1 L.",
      );
      expect((alta.body as Conflicto).errors?.[0]?.key).toBe("sku");

      await request(app.getHttpServer())
        .patch(`/products/${arrachera.id}`)
        .set("Authorization", bearer(token))
        .send({ sku: "036000291452" })
        .expect(409);
    });

    it("y al revés: un código de barras no puede ser el código interno de otro producto", async () => {
      const { token } = await registerAndLogin();
      await crearProducto(token, { sku: "7501055300013", name: "Coca 600" });
      const arrachera = await crearProducto(token, { sku: "ARRACHERA", name: "Arrachera" });

      const enProducto = await request(app.getHttpServer())
        .patch(`/products/${arrachera.id}`)
        .set("Authorization", bearer(token))
        .send({ barcode: "7501055300013" })
        .expect(409);
      expect((enProducto.body as Conflicto).message).toBe(
        "Ese código ya es el código interno del producto Coca 600.",
      );
      expect((enProducto.body as Conflicto).errors?.[0]?.key).toBe("barcode");

      await crearPresentacion(token, arrachera.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        barcode: "7501055300013",
      }).expect(409);

      await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(token))
        .send({ sku: "OTRA", name: "Otra", baseUnit: "unit", price: 1, barcode: "7501055300013" })
        .expect(409);
    });

    it("su PROPIO código de barras sí puede ser su código interno, al crear y al editar", async () => {
      const { token } = await registerAndLogin();
      const coca = await crearProducto(token, {
        sku: "7501055300013",
        name: "Coca 600",
        baseUnit: "unit",
        barcode: "7501055300013",
      });

      await request(app.getHttpServer())
        .patch(`/products/${coca.id}`)
        .set("Authorization", bearer(token))
        .send({ sku: "7501055300013", barcode: "7501055300013", name: "Coca-Cola 600 ml" })
        .expect(200);

      // Y un producto de Carga rápida (sku = código de barras) se sigue dando de alta.
      await request(app.getHttpServer())
        .post("/products/quick")
        .set("Authorization", bearer(token))
        .send({ lines: [{ code: "7501055300020", name: "Coca 2 L", price: 38 }] })
        .expect(200);
    });

    /**
     * Lo que encontró el verificador (B1): un producto de Carga rápida tiene
     * su código de barras como sku, así que repetir ese número chocaba con la
     * regla nueva antes que con el índice, y cambiaba el mensaje de siempre.
     */
    it("una repetición en la misma columna conserva su mensaje de siempre", async () => {
      const { token } = await registerAndLogin();
      await crearProducto(token, {
        sku: "7501055300013",
        name: "Coca 600",
        baseUnit: "unit",
        barcode: "7501055300013",
      });

      const mismoSku = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(token))
        .send({ sku: "7501055300013", name: "Otra", baseUnit: "unit", price: 1 })
        .expect(409);
      expect((mismoSku.body as Conflicto).message).toBe("Ya tienes un producto con ese código.");

      const mismoCodigoDeBarras = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(token))
        .send({ sku: "OTRO-1", name: "Otra", baseUnit: "unit", price: 1, barcode: "7501055300013" })
        .expect(409);
      expect((mismoCodigoDeBarras.body as Conflicto).message).toBe(
        "Ese código de barras ya está en uso por otro producto.",
      );
    });

    /**
     * Lo que encontró el verificador (B2): «AB-12» y «AB12» son dos códigos
     * distintos para la caja (busca el código exacto). Solo un código de
     * barras tiene escrituras equivalentes.
     */
    it("un guion o un espacio hacen otro código: no chocan", async () => {
      const { token } = await registerAndLogin();
      const bolsa = await crearProducto(token, { sku: "BOLSA10", name: "Bolsa" });
      await crearPresentacion(token, bolsa.id, {
        name: "Bolsa con guion",
        factor: 2,
        code: "BOLSA-10",
      }).expect(201);

      await crearPresentacion(token, bolsa.id, { name: "Caja", factor: 3, code: "AB12" }).expect(
        201,
      );
      for (const sku of ["AB-12", "AB 12"]) {
        await request(app.getHttpServer())
          .post("/products")
          .set("Authorization", bearer(token))
          .send({ sku, name: `Otro ${sku}`, baseUnit: "unit", price: 1 })
          .expect(201);
      }
    });

    it("Carga rápida rechaza en su renglón el código que es el código interno de otro producto", async () => {
      const { token } = await registerAndLogin();
      await crearProducto(token, { sku: "036000291452", name: "Agua 1 L", baseUnit: "unit" });

      const res = await request(app.getHttpServer())
        .post("/products/quick")
        .set("Authorization", bearer(token))
        .send({ lines: [{ code: "0036000291452", name: "Otra cosa", price: 10 }] })
        .expect(422);

      expect((res.body as { errors: unknown[] }).errors).toEqual([
        {
          line: 1,
          itemCode: "0036000291452",
          field: "code",
          code: "products.code_taken_product_sku",
          message: "Ese código ya es el código interno del producto Agua 1 L.",
        },
      ]);
    });

    it("la importación rechaza en su fila el sku nuevo que es el código de barras de otro", async () => {
      const { token } = await registerAndLogin();
      await crearProducto(token, { sku: "AGUA-1L", name: "Agua 1 L", barcode: "036000291452" });

      const res = await request(app.getHttpServer())
        .post("/products/import")
        .set("Authorization", bearer(token))
        .send({ content: "sku,nombre\n036000291452,Otra cosa\nPAN-1,Pan", dryRun: true })
        .expect(200);

      expect(res.body).toMatchObject({
        valid: 1,
        failed: 1,
        errors: [
          {
            row: 2,
            field: "sku",
            code: "products.code_taken_barcode",
            message: "Ese código ya es el código de barras de «Kilogramo» de Agua 1 L.",
          },
        ],
      });
    });
  });

  /**
   * F10-PRESCODE: la búsqueda de productos que usan Entradas, Salidas, Compras
   * y Órdenes de compra dice qué presentación se encontró por su código.
   */
  describe("la búsqueda de productos nombra la presentación encontrada", () => {
    type Item = { id: string; matchedPresentation: { id: string; name: string } | null };

    const buscar = (token: string, query: string) =>
      request(app.getHttpServer())
        .get("/products")
        .query({ query })
        .set("Authorization", bearer(token))
        .expect(200)
        .then((res) => (res.body as { items: Item[] }).items);

    it("por código interno (sin importar mayúsculas) y por código de barras", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const diez = (
        await crearPresentacion(token, bistec.id, {
          name: "Bolsa 10 Kilos",
          factor: 10,
          code: "BOLSA10K",
        }).expect(201)
      ).body as { id: string };
      const uno = (
        await crearPresentacion(token, bistec.id, {
          name: "Bolsa 1 Kilo",
          factor: 1,
          barcode: "036000291452",
        }).expect(201)
      ).body as { id: string };

      expect(await buscar(token, "bolsa10k")).toEqual([
        expect.objectContaining({
          id: bistec.id,
          matchedPresentation: { id: diez.id, name: "Bolsa 10 Kilos" },
        }),
      ]);
      // El mismo UPC-A escrito como EAN-13, como lo entrega otro lector.
      expect(await buscar(token, "0036000291452")).toEqual([
        expect.objectContaining({
          id: bistec.id,
          matchedPresentation: { id: uno.id, name: "Bolsa 1 Kilo" },
        }),
      ]);
    });

    it("por nombre, sku o un pedazo de código lo encuentra sin elegir presentación", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      await crearPresentacion(token, bistec.id, {
        name: "Bolsa 10 Kilos",
        factor: 10,
        code: "BOLSA10K",
      }).expect(201);

      for (const termino of ["bistec", "BISTEC-X", "bols"]) {
        expect(await buscar(token, termino)).toEqual([
          expect.objectContaining({ id: bistec.id, matchedPresentation: null }),
        ]);
      }
    });

    it("una presentación desactivada no se elige", async () => {
      const { token } = await registerAndLogin();
      const bistec = await crearProducto(token, { sku: "BISTEC-X", name: "Bistec" });
      const diez = (
        await crearPresentacion(token, bistec.id, {
          name: "Bolsa 10 Kilos",
          factor: 10,
          code: "BOLSA10K",
        }).expect(201)
      ).body as { id: string };
      await editarPresentacion(token, bistec.id, diez.id, { isActive: false }).expect(200);

      expect(await buscar(token, "BOLSA10K")).toEqual([
        expect.objectContaining({ id: bistec.id, matchedPresentation: null }),
      ]);
    });
  });
});
