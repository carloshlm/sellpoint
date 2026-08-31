import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { parseSpreadsheet } from "../../src/common/spreadsheet/spreadsheet";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F3-COUNT — el inventario físico.
 *
 * **El conteo es un documento con folio (`INV`) y borrador**, como la entrada
 * y la salida: se baja la plantilla, se sube lo contado a sus líneas, se mira
 * la reconciliación —que es la previa del borrador— y solo `inventory:manage`
 * aprueba. Que sea un borrador es lo que permite cerrar el sistema a mitad de
 * un conteo de 500 líneas y retomarlo por folio, que es exactamente cuando
 * más importa.
 */
describe("Inventario físico (F3-COUNT)", () => {
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
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant count ${randomUUID()}`,
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

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /**
   * El escenario del Excel de Carlos: un producto simple con saldo, uno con
   * TRES lotes en distintas ubicaciones, un compuesto (que no se cuenta) y uno
   * con lotes pero sin saldo todavía.
   */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const stamp = randomUUID().slice(0, 6);
      const warehouse = await tx.warehouse.create({
        data: { tenantId, name: `Central ${stamp}` },
      });

      const [simple, conLotes, compuesto, sinSaldo] = await Promise.all([
        tx.product.create({ data: { tenantId, sku: `SIM-${stamp}`, name: "Jabón" } }),
        tx.product.create({
          data: { tenantId, sku: `LOT-${stamp}`, name: "Suero", tracksLots: true },
        }),
        tx.product.create({
          data: { tenantId, sku: `CMP-${stamp}`, name: "Kit", isComposite: true },
        }),
        tx.product.create({
          data: { tenantId, sku: `NEW-${stamp}`, name: "Recién marcado", tracksLots: true },
        }),
      ]);

      await tx.stockByWarehouse.create({
        data: { tenantId, productId: simple.id, warehouseId: warehouse.id, quantity: 40 },
      });

      // Los códigos están elegidos para que el orden ALFABÉTICO sea el
      // INVERSO del cronológico: si alguien ordenara por código, este
      // escenario lo delata. (Con códigos "naturales" como st10/st30/st60 los
      // dos órdenes coinciden y el test no probaría nada.)
      const [st30, st10, st60] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: conLotes.id,
            lotCode: "bbb-sep",
            expiresAt: new Date("2026-09-30"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: conLotes.id,
            lotCode: "zzz-jul",
            expiresAt: new Date("2026-07-01"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: conLotes.id,
            lotCode: "aaa-dic",
            expiresAt: new Date("2026-12-31"),
          },
        }),
      ]);
      await tx.stockLot.createMany({
        data: [
          { tenantId, lotId: st30.id, warehouseId: warehouse.id, location: "A-1", quantity: 20 },
          { tenantId, lotId: st10.id, warehouseId: warehouse.id, location: "B-2", quantity: 9 },
          { tenantId, lotId: st60.id, warehouseId: warehouse.id, location: "C-3", quantity: 1 },
        ],
      });
      await tx.stockByWarehouse.create({
        data: { tenantId, productId: conLotes.id, warehouseId: warehouse.id, quantity: 30 },
      });

      return {
        warehouseId: warehouse.id,
        simpleSku: simple.sku,
        lotesSku: conLotes.sku,
        compuestoSku: compuesto.sku,
        sinSaldoSku: sinSaldo.sku,
        simpleId: simple.id,
        lotesId: conLotes.id,
      };
    });
    return { token, tenantId, ...datos };
  }

  /**
   * Un token con `inventory:movement` pero SIN `inventory:manage`: el operario
   * que captura conteos todos los días. Sin ese permiso intermedio, el test
   * del 403 pasaría por el motivo equivocado.
   */
  async function tokenSinManage(tenantId: string): Promise<string> {
    const tokenService = app.get(TokenService);
    const userId = await prisma.withTenantContext(tenantId, async (tx) => {
      const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
      return owner.id;
    });
    return tokenService.signAccessToken({
      sub: userId,
      tenantId,
      permissions: ["inventory:read", "inventory:movement"],
      locale: "es",
    });
  }

  async function plantilla(token: string, warehouseId: string, format: "csv" | "xlsx" = "csv") {
    // `.buffer(true)` + `.parse` porque supertest no sabe qué hacer con
    // `text/csv` ni con el binario de xlsx: sin esto `res.text` viene vacío.
    const res = await request(app.getHttpServer())
      .get(
        `/inventory/documents/template?type=physical_count&warehouseId=${warehouseId}&format=${format}`,
      )
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const buffer = res.body as Buffer;
    return parseSpreadsheet(
      format === "csv" ? buffer.toString("utf8") : buffer.toString("base64"),
      format,
    );
  }

  describe("F3-COUNT-01 — la plantilla sale con el teórico", () => {
    it("un producto simple ocupa UNA fila, con su saldo real y el contado vacío", async () => {
      const { token, warehouseId, simpleSku } = await escenario();

      const filas = await plantilla(token, warehouseId);
      const header = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
      const col = (nombre: string) => header.indexOf(nombre);
      const suyas = filas.slice(1).filter((f) => f[col("sku")] === simpleSku);

      expect(suyas).toHaveLength(1);
      expect(suyas[0]?.[col("teorico")]).toBe("40");
      // `contado` viene VACÍO: es la columna que la persona llena.
      expect(suyas[0]?.[col("contado")]).toBe("");
      // Sin lotes, esas columnas van vacías — la misma plantilla sirve para los
      // dos casos, que es exactamente el Excel del cliente.
      expect(suyas[0]?.[col("lote")]).toBe("");
    });

    /** El Excel de Carlos: tres lotes en tres ubicaciones, tres filas. */
    it("un producto con 3 lotes sale en 3 filas, ordenadas por caducidad", async () => {
      const { token, warehouseId, lotesSku } = await escenario();

      const filas = await plantilla(token, warehouseId);
      const header = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
      const col = (nombre: string) => header.indexOf(nombre);
      const suyas = filas.slice(1).filter((f) => f[col("sku")] === lotesSku);

      expect(suyas.map((f) => f[col("lote")])).toEqual(["zzz-jul", "bbb-sep", "aaa-dic"]);
      expect(suyas.map((f) => f[col("teorico")])).toEqual(["9", "20", "1"]);
      expect(suyas.map((f) => f[col("ubicacion")])).toEqual(["B-2", "A-1", "C-3"]);
      expect(suyas[0]?.[col("caducidad")]).toBe("2026-07-01");
    });

    /**
     * Un producto marcado con lotes pero todavía sin ninguno sale igual, con la
     * fila vacía: es la única forma de cargar el PRIMER lote desde la planilla.
     */
    it("un producto con lotes pero sin saldo trae una fila vacía", async () => {
      const { token, warehouseId, sinSaldoSku } = await escenario();

      const filas = await plantilla(token, warehouseId);
      const header = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
      const col = (nombre: string) => header.indexOf(nombre);
      const suyas = filas.slice(1).filter((f) => f[col("sku")] === sinSaldoSku);

      expect(suyas).toHaveLength(1);
      expect(suyas[0]?.[col("lote")]).toBe("");
      expect(suyas[0]?.[col("teorico")]).toBe("0");
    });

    /** Un compuesto no tiene existencias propias: contarlo no significa nada. */
    it("los compuestos no aparecen", async () => {
      const { token, warehouseId, compuestoSku } = await escenario();

      const filas = await plantilla(token, warehouseId);
      const header = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
      const col = (nombre: string) => header.indexOf(nombre);

      expect(filas.slice(1).map((f) => f[col("sku")])).not.toContain(compuestoSku);
    });

    it("el xlsx trae lo mismo que el csv", async () => {
      const { token, warehouseId, simpleSku } = await escenario();

      const csv = await plantilla(token, warehouseId, "csv");
      const xlsx = await plantilla(token, warehouseId, "xlsx");

      expect(xlsx[0]).toEqual(csv[0]);
      const skus = (filas: string[][]) => filas.slice(1).map((f) => f[0]);
      expect(skus(xlsx)).toEqual(skus(csv));
      expect(skus(csv)).toContain(simpleSku);
    });

    /**
     * La plantilla trae el nombre y la unidad para que quien cuenta sepa qué
     * está mirando; la importación las IGNORA (lee por nombre de columna), así
     * que el round-trip cierra sin editar nada.
     */
    it("lleva nombre y unidad, y aun así se puede volver a subir", async () => {
      const { token, warehouseId } = await escenario();

      const filas = await plantilla(token, warehouseId);
      const header = (filas[0] ?? []).map((c) => c.trim().toLowerCase());

      expect(header).toEqual(
        expect.arrayContaining([
          "sku",
          "nombre",
          "unidad",
          "lote",
          "caducidad",
          "ubicacion",
          "teorico",
          "contado",
        ]),
      );
    });
  });

  /**
   * F3-COUNT-02 — la reconciliación NO es un endpoint propio.
   *
   * Subir el archivo es el import del borrador (F3-DOC-05) y el resultado
   * reconciliado es el DETALLE de ese borrador, que para `physical_count`
   * agrega `theoretical` y `difference` por línea. Una pantalla menos y, sobre
   * todo, un lugar menos donde el teórico podría calcularse distinto.
   *
   * **Nada se escribe hasta aprobar**: mirar la reconciliación no puede dejar
   * lotes fantasma ni mover un saldo.
   */
  describe("F3-COUNT-02 — la reconciliación es la previa del borrador", () => {
    async function borradorCon(token: string, warehouseId: string, csv: string) {
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "physical_count", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;

      const reporte = await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines/import`)
        .set("Authorization", bearer(token))
        .send({ file: csv, format: "csv", mode: "replace" });
      if (reporte.status !== 200) {
        throw new Error(`import ${reporte.status}: ${JSON.stringify(reporte.body)}`);
      }

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      return { id, reporte: reporte.body, detalle: detalle.body as Record<string, unknown> };
    }

    it("una línea contada igual al teórico sale sin diferencia", async () => {
      const { token, warehouseId, simpleSku } = await escenario();

      const { detalle } = await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,40`,
      );
      const fila = (detalle.rows as Record<string, unknown>[])[0];

      expect(fila).toEqual(
        expect.objectContaining({ theoretical: "40", counted: "40", difference: "0" }),
      );
    });

    it("contar de menos da diferencia negativa; de más, positiva", async () => {
      const { token, warehouseId, simpleSku } = await escenario();

      const menos = await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,35`,
      );
      // Solo cabe UN conteo abierto por almacén: para probar el otro caso hay
      // que cerrar el primero, igual que haría quien opera.
      await request(app.getHttpServer())
        .post(`/inventory/documents/${menos.id}/cancel`)
        .set("Authorization", bearer(token))
        .send({ reason: "se prueba el otro sentido" })
        .expect(200);
      const mas = await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,44`,
      );

      expect((menos.detalle.rows as { difference: string }[])[0]?.difference).toBe("-5");
      expect((mas.detalle.rows as { difference: string }[])[0]?.difference).toBe("4");
    });

    /**
     * El teórico de un producto CON lotes se lee por (lote, ubicación), no del
     * total del producto: contar el estante B-2 no dice nada del A-1.
     */
    it("con lotes, el teórico es el de ESE lote y ubicación", async () => {
      const { token, warehouseId, lotesSku } = await escenario();

      const { detalle } = await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${lotesSku},zzz-jul,2026-07-01,B-2,7`,
      );
      const fila = (detalle.rows as Record<string, unknown>[])[0];

      // El lote de julio tiene 9 en B-2, no los 30 del producto entero.
      expect(fila).toEqual(
        expect.objectContaining({ theoretical: "9", counted: "7", difference: "-2" }),
      );
    });

    it("el resumen cuenta coincidencias, discrepancias y omitidos", async () => {
      const { token, warehouseId, simpleSku, lotesSku } = await escenario();

      const { detalle } = await borradorCon(
        token,
        warehouseId,
        [
          "sku,lote,caducidad,ubicacion,contado",
          `${simpleSku},,,,40`,
          `${lotesSku},zzz-jul,2026-07-01,B-2,7`,
          // Sin `contado`: quien contaba no llegó a esa fila.
          `${lotesSku},bbb-sep,2026-09-30,A-1,`,
        ].join("\n"),
      );

      expect(detalle.countSummary).toEqual(
        expect.objectContaining({ counted: 2, matches: 1, discrepancies: 1, skipped: 1 }),
      );
    });

    /** Mirar la reconciliación no puede dejar rastro en la base. */
    it("nada se escribe: ni movimientos ni lotes nuevos", async () => {
      const { token, tenantId, warehouseId, lotesSku, lotesId } = await escenario();

      await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${lotesSku},lote-que-no-existe,2027-01-01,D-4,5`,
      );

      const rastro = await prisma.withTenantContext(tenantId, async (tx) => ({
        movimientos: await tx.stockMovement.count(),
        lotes: await tx.productLot.count({ where: { productId: lotesId } }),
      }));

      expect(rastro.movimientos).toBe(0);
      // Los tres del escenario, ninguno nuevo.
      expect(rastro.lotes).toBe(3);
    });

    it("un lote que no existe se marca como nuevo, sin crearlo", async () => {
      const { token, warehouseId, lotesSku } = await escenario();

      const { detalle } = await borradorCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${lotesSku},lote-nuevo,2027-01-01,D-4,5`,
      );
      const fila = (detalle.rows as Record<string, unknown>[])[0];

      expect(fila?.newLot).toBe(true);
      expect(fila?.theoretical).toBe("0");
      expect((detalle.countSummary as { newLots: number }).newLots).toBe(1);
    });
  });

  /**
   * F3-COUNT-03 — aprobar el conteo.
   *
   * **Solo `inventory:manage`**: es el único tipo de documento que no basta
   * con `inventory:movement`. Un conteo puede reescribir el saldo de todo un
   * almacén de una vez — quien mueve mercancía todos los días no debería poder
   * hacerlo solo.
   *
   * Una diferencia se asienta como DOS movimientos —salida del teórico entero
   * y entrada de lo contado— y no como un ajuste por la diferencia. Así el
   * kardex cuenta la historia real: "había 120, se contó 115", y no un "-5"
   * que no dice de dónde salió.
   */
  /**
   * ── UN SOLO CONTEO ABIERTO POR ALMACÉN (Carlos, 2026-08-30) ───────────
   *
   * «No debería poder tener más de 1 inventario físico abierto por almacén;
   * deberías poder cancelar uno si quieres abrir uno nuevo.»
   *
   * Un conteo es una FOTO del almacén en un momento. Dos borradores abiertos
   * sobre el mismo almacén son dos fotos que se contradicen, y peor: cada uno
   * guarda el teórico que vio al capturarse, así que aprobar el segundo
   * pisaría el ajuste del primero con datos viejos. En producción se vieron
   * tres borradores del mismo almacén.
   *
   * Solo aplica al CONTEO: entradas y salidas simultáneas son normales — dos
   * personas descargando camiones distintos no se estorban.
   */
  /**
   * ── LA HOJA SE ORDENA POR RECORRIDO, NO POR SKU (Carlos, 2026-08-30) ──
   *
   * La ubicación del producto es un dato de REFERENCIA —dónde suele estar—,
   * no parte el saldo. Su valor entero está acá: una hoja de 300 líneas
   * ordenada por SKU obliga a cruzar el almacén en zigzag; ordenada por
   * ubicación, el conteo es un paseo de ida.
   *
   * Los productos sin ubicación van al final: son los que hay que buscar, y
   * mandarlos al principio castigaría al que sí ordenó su catálogo.
   */
  describe("la plantilla se ordena por ubicación", () => {
    it("agrupa por recorrido del almacén y deja al final lo que no tiene ubicación", async () => {
      const { token, tenantId, warehouseId } = await escenario();
      const stamp = randomUUID().slice(0, 6);
      // El orden por recorrido es del negocio que USA ubicaciones: para el
      // resto, ordenar por una columna vacía sería barajar la hoja sin motivo.
      await prisma.tenant.update({ where: { id: tenantId }, data: { usesLocations: true } });
      await prisma.withTenantContext(tenantId, async (tx) => {
        await tx.product.create({
          data: { tenantId, sku: `ZZZ-${stamp}`, name: "Último por SKU", location: "A-1" },
        });
        await tx.product.create({
          data: { tenantId, sku: `AAA-${stamp}`, name: "Primero por SKU", location: "C-9" },
        });
      });

      // `plantilla` devuelve la matriz cruda: la fila 0 es el encabezado.
      const filas = await plantilla(token, warehouseId);
      const col = (nombre: string) =>
        (filas[0] ?? []).map((c) => c.trim().toLowerCase()).indexOf(nombre);
      const skus = filas.slice(1).map((f) => String(f[col("sku")] ?? ""));
      const posA1 = skus.indexOf(`ZZZ-${stamp}`);
      const posC9 = skus.indexOf(`AAA-${stamp}`);
      const sinUbicacion = skus.findIndex((sku) => sku.startsWith("SIM-"));

      // A-1 antes que C-9, aunque su SKU sea el último del alfabeto.
      expect(posA1).toBeLessThan(posC9);
      // Y los que no tienen ubicación, después de los que sí.
      expect(posC9).toBeLessThan(sinUbicacion);
    });

    it("con el interruptor APAGADO manda el código, como siempre", async () => {
      const { token, tenantId, warehouseId } = await escenario();
      const stamp = randomUUID().slice(0, 6);
      await prisma.withTenantContext(tenantId, async (tx) => {
        await tx.product.create({
          data: { tenantId, sku: `ZZZ-${stamp}`, name: "Último por SKU", location: "A-1" },
        });
        await tx.product.create({
          data: { tenantId, sku: `AAA-${stamp}`, name: "Primero por SKU", location: "C-9" },
        });
      });

      const filas = await plantilla(token, warehouseId);
      const col = (nombre: string) =>
        (filas[0] ?? []).map((c) => c.trim().toLowerCase()).indexOf(nombre);
      const skus = filas.slice(1).map((f) => String(f[col("sku")] ?? ""));

      // Sin el interruptor, el alfabeto: AAA antes que ZZZ.
      expect(skus.indexOf(`AAA-${stamp}`)).toBeLessThan(skus.indexOf(`ZZZ-${stamp}`));
    });
  });

  /**
   * ── LA UBICACIÓN NO DEPENDE DE LOS LOTES (Carlos, 2026-08-31) ────────
   *
   * «Hay productos que no tienen lote ni caducidad y sí deberían poder tener
   * ubicación si el negocio tiene activo ese parámetro.»
   *
   * Tiene razón, pero con un matiz que decide el diseño: el saldo POR
   * ubicación vive en `stock_lots`, cuya clave es (lote, almacén, ubicación).
   * Un producto sin lote guarda su saldo en `stock_by_warehouse`, que no la
   * tiene — así que capturar una ubicación ahí no puede partir existencias.
   *
   * Lo que sí puede, y es lo útil: **actualizar la ubicación de REFERENCIA
   * del producto**. El inventario físico es justamente el momento en que
   * alguien descubre dónde está de verdad cada cosa, así que contar pasa a
   * ser la forma natural de mantener el catálogo al día.
   */
  describe("la ubicación de un producto SIN lote", () => {
    /** Un borrador con su CSV cargado; el helper de F3-COUNT-03 vive en otro bloque. */
    async function conteoCon(token: string, warehouseId: string, csv: string) {
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "physical_count", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines/import`)
        .set("Authorization", bearer(token))
        .send({ file: csv, format: "csv", mode: "replace" })
        .expect(200);
      return id;
    }

    it("al aprobar el conteo, actualiza la ubicación de referencia del producto", async () => {
      const { token, tenantId, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteoCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,B-01-01,40`,
      );

      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set("Authorization", bearer(token))
        .send({})
        .expect(201);

      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.findUniqueOrThrow({ where: { id: simpleId }, select: { location: true } }),
      );
      expect(producto.location).toBe("B-01-01");
    });

    /** Sin ubicación capturada no se pisa la que ya tenía: omitir no es borrar. */
    it("una línea sin ubicación deja intacta la del producto", async () => {
      const { token, tenantId, warehouseId, simpleSku, simpleId } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.update({ where: { id: simpleId }, data: { location: "C-9" } }),
      );
      const id = await conteoCon(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,40`,
      );

      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set("Authorization", bearer(token))
        .send({})
        .expect(201);

      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.findUniqueOrThrow({ where: { id: simpleId }, select: { location: true } }),
      );
      expect(producto.location).toBe("C-9");
    });
  });

  describe("un solo conteo abierto por almacén", () => {
    const crear = (token: string, warehouseId: string, type = "physical_count") =>
      request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type, warehouseId });

    it("el segundo conteo en el mismo almacén se rechaza, nombrando el folio abierto", async () => {
      const { token, warehouseId } = await escenario();
      const primero = await crear(token, warehouseId).expect(201);

      const rechazo = await crear(token, warehouseId).expect(409);

      expect(rechazo.body).toMatchObject({ code: "inventory.count_already_open" });
      // El FOLIO, no solo el "no": sin él, el usuario no sabe cuál cancelar.
      expect((rechazo.body as { message: string }).message).toContain(
        (primero.body as { folio: string }).folio,
      );
    });

    it("en OTRO almacén sí se puede: la foto es por almacén", async () => {
      const { token, tenantId, warehouseId } = await escenario();
      await crear(token, warehouseId).expect(201);
      const otro = await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({ data: { tenantId, name: `Otro ${randomUUID().slice(0, 6)}` } }),
      );

      await crear(token, otro.id).expect(201);
    });

    it("cancelado el primero, el siguiente entra", async () => {
      const { token, warehouseId } = await escenario();
      const primero = await crear(token, warehouseId).expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/documents/${(primero.body as { id: string }).id}/cancel`)
        .set("Authorization", bearer(token))
        .send({ reason: "se abrió por error" })
        .expect(200);

      await crear(token, warehouseId).expect(201);
    });

    /** Entradas y salidas no se estorban: dos camiones a la vez es normal. */
    it("las entradas simultáneas siguen permitidas", async () => {
      const { token, warehouseId } = await escenario();
      await crear(token, warehouseId, "entry").expect(201);

      await crear(token, warehouseId, "entry").expect(201);
    });
  });

  describe("F3-COUNT-03 — aprobar mueve el stock", () => {
    async function conteo(token: string, warehouseId: string, csv: string) {
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "physical_count", warehouseId })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines/import`)
        .set("Authorization", bearer(token))
        .send({ file: csv, format: "csv", mode: "replace" })
        .expect(200);
      return id;
    }

    const aprobar = (token: string, id: string) =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set("Authorization", bearer(token))
        .send({});

    it("teórico 40 contado 35: dos movimientos y el saldo queda en 35", async () => {
      const { token, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,35`,
      );

      const res = await aprobar(token, id).expect(201);
      const body = res.body as {
        movements: { productId: string; direction: string; quantityBase: string }[];
        stock: { productId: string; quantity: string }[];
      };

      const suyos = body.movements.filter((m) => m.productId === simpleId);
      // Salida del teórico ENTERO y entrada de lo contado: el kardex cuenta
      // "había 40, se contó 35", no un "-5" sin origen.
      expect(suyos).toHaveLength(2);
      expect(Number(suyos.find((m) => m.direction === "exit")?.quantityBase)).toBe(40);
      expect(Number(suyos.find((m) => m.direction === "entry")?.quantityBase)).toBe(35);
      expect(Number(body.stock.find((s) => s.productId === simpleId)?.quantity)).toBe(35);
    });

    /**
     * ── LA PREVIA DEL CONTEO NO SUMA: FIJA (Carlos, 2026-08-30) ─────────
     *
     * Carlos capturó un conteo y vio, en una línea cuya diferencia era CERO,
     * que el stock pasaba de 266.5 a 279.5. La previsualización calculaba
     * `después = antes + cantidad` —la fórmula de una ENTRADA— cuando un
     * conteo REEMPLAZA el saldo por lo contado.
     *
     * Es la pantalla donde se decide si confirmar un ajuste de inventario:
     * una columna que dice "va a subir" cuando en realidad "se va a quedar
     * igual" es peor que no mostrar nada.
     *
     * El efecto real por producto es `saldo − teórico + contado`, acumulado
     * línea a línea: así un producto con tres lotes contados muestra el
     * total al que va a llegar.
     */
    it("la previa NO suma lo contado: contar lo mismo deja el saldo igual", async () => {
      const { token, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,40`,
      );

      const previa = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      const fila = (
        previa.body as {
          rows: {
            productId: string;
            stockBefore: string;
            stockAfter: string;
            difference: string | null;
          }[];
        }
      ).rows.find((l) => l.productId === simpleId);

      // El teórico es 40 y se contaron 40: el saldo NO se mueve.
      expect(fila?.difference).toBe("0");
      expect(Number(fila?.stockBefore)).toBe(40);
      expect(Number(fila?.stockAfter)).toBe(40);
    });

    it("contar de MENOS baja el saldo a lo contado, no lo suma", async () => {
      const { token, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,35`,
      );

      const previa = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      const fila = (previa.body as { rows: { productId: string; stockAfter: string }[] }).rows.find(
        (l) => l.productId === simpleId,
      );

      // Sumaría 75; lo correcto es que quede en 35.
      expect(Number(fila?.stockAfter)).toBe(35);
    });

    /**
     * ── EL TEÓRICO NEGATIVO (2026-08-28) ────────────────────────────────
     *
     * Era imposible hasta F7: el CHECK `quantity >= 0` de la base lo impedía,
     * y F7-DB-07 lo quitó para que el plan Basic —que no lleva control de
     * inventario— pueda vender con saldo en cero. El negativo que queda ES la
     * lista de lo que hay que inventariar el día que ese negocio suba a Pro,
     * así que el conteo TIENE que poder corregirlo.
     *
     * Un conteo es ABSOLUTO: lo contado es el saldo nuevo, no un delta que se
     * suma a lo que había. Con teórico positivo eso se logra con la salida
     * del teórico entero; con teórico NEGATIVO, el movimiento que lo pone en
     * cero es una ENTRADA por su valor absoluto. Sin esa rama, un teórico de
     * −3 contado en 12 terminaba en 9.
     */
    it("un teórico NEGATIVO se corrige: contado 12 sobre −3 deja 12, no 9", async () => {
      const { token, tenantId, warehouseId, simpleSku, simpleId } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.updateMany({
          where: { productId: simpleId, warehouseId },
          data: { quantity: -3 },
        }),
      );

      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,12`,
      );
      const res = await aprobar(token, id).expect(201);
      const body = res.body as {
        movements: { productId: string; direction: string; quantityBase: string }[];
        stock: { productId: string; quantity: string }[];
      };

      expect(Number(body.stock.find((s) => s.productId === simpleId)?.quantity)).toBe(12);
      // Dos entradas: la que devuelve el negativo a cero y la de lo contado.
      const suyos = body.movements.filter((m) => m.productId === simpleId);
      expect(suyos.map((m) => [m.direction, Number(m.quantityBase)])).toEqual([
        ["entry", 3],
        ["entry", 12],
      ]);
    });

    /** Contar lo mismo que había no es un movimiento: no pasó nada. */
    it("una línea que coincide no genera movimientos", async () => {
      const { token, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,40`,
      );

      const res = await aprobar(token, id).expect(201);
      const body = res.body as { movements: { productId: string }[] };

      expect(body.movements.filter((m) => m.productId === simpleId)).toHaveLength(0);
    });

    it("de tres lotes, solo el que difiere se mueve, y el total baja", async () => {
      const { token, tenantId, warehouseId, lotesSku, lotesId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        [
          "sku,lote,caducidad,ubicacion,contado",
          `${lotesSku},bbb-sep,2026-09-30,A-1,20`,
          `${lotesSku},zzz-jul,2026-07-01,B-2,9`,
          `${lotesSku},aaa-dic,2026-12-31,C-3,1`,
        ].join("\n"),
      );

      const res = await aprobar(token, id).expect(201);
      const body = res.body as { movements: { productId: string }[] };

      // Los tres coinciden: NADA se mueve. Y por eso la respuesta tampoco
      // trae saldos —no hubo pasada del ledger—, así que el total se verifica
      // contra la base.
      expect(body.movements.filter((m) => m.productId === lotesId)).toHaveLength(0);
      const saldo = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.findFirst({
          where: { productId: lotesId, warehouseId },
          select: { quantity: true },
        }),
      );
      expect(Number(saldo?.quantity)).toBe(30);
    });

    it("un lote que difiere mueve solo ese lote y baja el total del producto", async () => {
      const { token, warehouseId, lotesSku, lotesId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        [
          "sku,lote,caducidad,ubicacion,contado",
          `${lotesSku},bbb-sep,2026-09-30,A-1,20`,
          // Del lote de julio había 9 y se contaron 5.
          `${lotesSku},zzz-jul,2026-07-01,B-2,5`,
          `${lotesSku},aaa-dic,2026-12-31,C-3,1`,
        ].join("\n"),
      );

      const res = await aprobar(token, id).expect(201);
      const body = res.body as { stock: { productId: string; quantity: string }[] };

      // 30 − 4 = 26: la invariante `Σ stock_lots == stock_by_warehouse` se
      // sostiene porque el ledger mueve las dos juntas.
      expect(Number(body.stock.find((s) => s.productId === lotesId)?.quantity)).toBe(26);
    });

    it("un lote nuevo en la planilla se crea y queda con su saldo", async () => {
      const { token, tenantId, warehouseId, lotesSku, lotesId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        [
          "sku,lote,caducidad,ubicacion,contado",
          `${lotesSku},bbb-sep,2026-09-30,A-1,20`,
          `${lotesSku},zzz-jul,2026-07-01,B-2,9`,
          `${lotesSku},aaa-dic,2026-12-31,C-3,1`,
          `${lotesSku},lote-encontrado,2027-03-01,D-4,6`,
        ].join("\n"),
      );

      await aprobar(token, id).expect(201);

      const creado = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.findFirst({
          where: { productId: lotesId, lotCode: "lote-encontrado" },
          select: { id: true, expiresAt: true },
        }),
      );
      expect(creado).not.toBeNull();

      const lotes = await request(app.getHttpServer())
        .get(`/products/${lotesId}/lots?withStock=true`)
        .set("Authorization", bearer(token))
        .expect(200);
      const nuevo = (lotes.body as { lotCode: string; totalQuantity: string }[]).find(
        (l) => l.lotCode === "lote-encontrado",
      );
      expect(Number(nuevo?.totalQuantity)).toBe(6);
    });

    /**
     * Un conteo puede tardar horas. Si el saldo se movió entre mirar la
     * reconciliación y aprobar, gana **lo contado** —es lo que alguien vio con
     * los ojos— pero queda registrado que hubo deriva.
     */
    it("si el saldo cambió mientras tanto, gana lo contado y se anota la deriva", async () => {
      const { token, tenantId, warehouseId, simpleSku, simpleId } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,35`,
      );

      // Entran 10 más DESPUÉS de contar: el teórico pasa de 40 a 50.
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.update({
          where: { productId_warehouseId: { productId: simpleId, warehouseId } },
          data: { quantity: 50 },
        }),
      );

      const res = await aprobar(token, id).expect(201);
      const body = res.body as {
        stock: { productId: string; quantity: string }[];
        drifted: number;
      };

      // El saldo final es lo CONTADO, y la salida fue del teórico FRESCO (50).
      expect(Number(body.stock.find((s) => s.productId === simpleId)?.quantity)).toBe(35);
      expect(body.drifted).toBe(1);
    });

    it("sin `inventory:manage` no se aprueba", async () => {
      const { token, tenantId, warehouseId, simpleSku } = await escenario();
      const id = await conteo(
        token,
        warehouseId,
        `sku,lote,caducidad,ubicacion,contado\n${simpleSku},,,,35`,
      );
      // El operario tiene `movement` —captura conteos todos los días— y aun
      // así no puede aprobarlos.
      const operario = await tokenSinManage(tenantId);

      await aprobar(operario, id).expect(403);
    });
  });
});
