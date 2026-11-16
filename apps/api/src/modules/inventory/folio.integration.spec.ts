import { ConfigService } from "@nestjs/config";
import type { FolioSeries } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { nextFolio, nextSequenceValue } from "./folio";

/**
 * Integration (Postgres real) — F3-DB-03: la numeración de los documentos.
 *
 * El folio es lo que una persona dicta por teléfono y anota en una libreta, y
 * desde la decisión de borradores (2026-08-18) también es **cómo se retoma un
 * movimiento a medio cargar**. Que sea correcto bajo concurrencia no es un
 * lujo: dos personas dando de alta una entrada al mismo tiempo es el caso
 * normal en un almacén con dos turnos.
 */
describe("nextFolio — numeración por tenant y serie (F3-DB-03)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const [tenant, other] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant folios ${stamp}` } }),
      prisma.tenant.create({ data: { name: `Tenant folios vecino ${stamp}` } }),
    ]);
    tenantId = tenant.id;
    otherTenantId = other.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const take = (owner: string, series: FolioSeries) =>
    prisma.withTenantContext(owner, (tx) => nextFolio(tx, owner, series));

  /** Un negocio NUEVO por prueba: la serie arranca en 1 y el idioma sin fijar. */
  const nuevoNegocio = async (data: { country?: string | null; folioLanguage?: string } = {}) =>
    (
      await prisma.tenant.create({
        data: { name: `Tenant folios ${Date.now()}-${Math.random()}`, ...data },
      })
    ).id;

  it("la primera vez de un tenant en una serie es el 1, con seis dígitos", async () => {
    await expect(take(tenantId, "entry")).resolves.toBe("ENT-000001");
  });

  it("cada tenant lleva su propia cuenta: los dos arrancan en 1", async () => {
    await take(tenantId, "exit");
    await take(tenantId, "exit");

    await expect(take(otherTenantId, "exit")).resolves.toBe("SAL-000001");
  });

  it("las series del mismo tenant no se pisan entre sí", async () => {
    const [entry, count] = await Promise.all([
      take(otherTenantId, "entry"),
      take(otherTenantId, "physical_count"),
    ]);

    expect(entry).toBe("ENT-000001");
    expect(count).toBe("INV-000001");
  });

  /**
   * El caso que justifica usar `INSERT … ON CONFLICT DO UPDATE … RETURNING` en
   * vez de `MAX(n)+1`: la sentencia toma el lock de la fila y lo suelta al
   * COMMIT, así que 20 transacciones simultáneas se ordenan solas. Con
   * `MAX+1` dos de ellas leerían el mismo número.
   */
  it("20 transacciones simultáneas producen 20 folios distintos y consecutivos", async () => {
    const negocio = await nuevoNegocio();
    const folios = await Promise.all(Array.from({ length: 20 }, () => take(negocio, "entry")));

    const numeros = folios.map((f) => Number(f.split("-")[1])).sort((a, b) => a - b);
    expect(new Set(folios).size).toBe(20);
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  /**
   * La serie NO tiene huecos, y eso es una consecuencia de guardar el contador
   * en una TABLA y no en un `SEQUENCE`: un `ROLLBACK` deshace también el
   * incremento. Con un SEQUENCE el número se habría perdido para siempre.
   *
   * El precio es que el lock serializa las operaciones de la misma serie del
   * mismo tenant mientras dure la transacción — por eso el folio se toma en
   * una tx corta propia, no dentro de la del ledger.
   */
  it("una transacción que falla no deja hueco: el número vuelve", async () => {
    const negocio = await nuevoNegocio();
    await take(negocio, "entry");

    await expect(
      prisma.withTenantContext(negocio, async (tx) => {
        await nextFolio(tx, negocio, "entry");
        throw new Error("algo salió mal después de tomar el folio");
      }),
    ).rejects.toThrow();

    await expect(take(negocio, "entry")).resolves.toBe("ENT-000002");
  });

  it("pasado el millón sigue creciendo en vez de romperse", async () => {
    const negocio = await nuevoNegocio();
    await prisma.withTenantContext(negocio, (tx) =>
      tx.tenantSequence.create({ data: { tenantId: negocio, key: "entry", nextValue: 999_999n } }),
    );

    await expect(take(negocio, "entry")).resolves.toBe("ENT-1000000");
  });

  /**
   * ── EL IDIOMA DE LOS FOLIOS (Carlos, 2026-11-16) ──────────────────────────
   *
   * «el folío no lo define el idioma del usuario sino el idioma principal de
   * un país»: `TUR-000019` en México, `SHF-000019` en Estados Unidos y Canadá.
   * El juego se FIJA con el primer folio del negocio y ya no cambia, aunque
   * después cambie el país: una serie no mezcla `TUR-000019` con `SHF-000020`.
   */
  describe("el juego de prefijos sale del país y se fija con el primer folio", () => {
    const idiomaDe = async (negocio: string) =>
      (await prisma.tenant.findUniqueOrThrow({ where: { id: negocio } })).folioLanguage;

    it("un negocio en Estados Unidos numera en inglés", async () => {
      const negocio = await nuevoNegocio({ country: "US" });

      await expect(take(negocio, "cashbox_session")).resolves.toBe("SHF-000001");
      await expect(take(negocio, "sale")).resolves.toBe("SLS-000001");
      expect(await idiomaDe(negocio)).toBe("en");
    });

    it("un negocio en México numera en español, como siempre", async () => {
      const negocio = await nuevoNegocio({ country: "MX" });

      await expect(take(negocio, "cashbox_session")).resolves.toBe("TUR-000001");
      expect(await idiomaDe(negocio)).toBe("es");
    });

    it("un negocio sin país numera en español", async () => {
      const negocio = await nuevoNegocio();

      await expect(take(negocio, "quote")).resolves.toBe("COT-000001");
      expect(await idiomaDe(negocio)).toBe("es");
    });

    it("el idioma no se fija antes del primer folio: el país se puede elegir después de registrarse", async () => {
      const negocio = await nuevoNegocio();
      expect(await idiomaDe(negocio)).toBeNull();

      await prisma.tenant.update({ where: { id: negocio }, data: { country: "CA" } });

      await expect(take(negocio, "expense")).resolves.toBe("EXP-000001");
    });

    it("cambiar el país DESPUÉS del primer folio no cambia la serie", async () => {
      const negocio = await nuevoNegocio({ country: "US" });
      await take(negocio, "cashbox_session");

      await prisma.tenant.update({ where: { id: negocio }, data: { country: "MX" } });

      await expect(take(negocio, "cashbox_session")).resolves.toBe("SHF-000002");
      await expect(take(negocio, "purchase_order")).resolves.toBe("POR-000001");
      expect(await idiomaDe(negocio)).toBe("en");
    });

    /**
     * La ventana del deploy: la migración corre ANTES que el API nuevo, y el
     * viejo numera en español sin fijar idioma. Si un negocio en EE. UU.
     * emitió ahí su primer folio, ya tiene una serie en español: se queda en
     * español, igual que la regla del relleno de la migración.
     */
    it("un negocio sin idioma fijo pero con folios ya emitidos se queda en español", async () => {
      const negocio = await nuevoNegocio({ country: "US" });
      await prisma.withTenantContext(negocio, (tx) =>
        tx.tenantSequence.create({ data: { tenantId: negocio, key: "sale", nextValue: 1n } }),
      );

      await expect(take(negocio, "sale")).resolves.toBe("VTA-000002");
      expect(await idiomaDe(negocio)).toBe("es");
    });

    it("el código de barras diario del ticket no cuenta como folio emitido", async () => {
      const negocio = await nuevoNegocio({ country: "US" });
      await prisma.withTenantContext(negocio, (tx) =>
        nextSequenceValue(tx, negocio, "sale_barcode:20261116"),
      );

      await expect(take(negocio, "sale")).resolves.toBe("SLS-000001");
    });

    it("un negocio con el idioma ya fijo lo respeta aunque su país diga otra cosa", async () => {
      const negocio = await nuevoNegocio({ country: "US", folioLanguage: "es" });

      await expect(take(negocio, "sale")).resolves.toBe("VTA-000001");
    });

    it("varios primeros folios al mismo tiempo fijan un solo idioma", async () => {
      const negocio = await nuevoNegocio({ country: "US" });

      const folios = await Promise.all(
        (["sale", "quote", "expense", "purchase", "entry", "exit"] as const).map((serie) =>
          take(negocio, serie),
        ),
      );

      expect(folios).toEqual([
        "SLS-000001",
        "QTE-000001",
        "EXP-000001",
        "PUR-000001",
        "ENT-000001",
        "OUT-000001",
      ]);
      expect(await idiomaDe(negocio)).toBe("en");
    });
  });

  /**
   * ── EL CONTADOR PELADO (2026-08-24) ───────────────────────────────────────
   *
   * `nextSequenceValue` es la mitad de `nextFolio` sin el formato: devuelve el
   * BigInt crudo. Nace para el código de barras diario del ticket
   * (`sale_barcode:YYYYMMDD` → consecutivo 0001-9999 que reinicia cada día),
   * donde el padding es de CUATRO y no hay prefijo con guion — el formato es
   * del llamador, la atomicidad es de acá.
   */
  describe("nextSequenceValue — el contador sin formato", () => {
    it("arranca en 1 y avanza de a uno", async () => {
      const primero = await prisma.withTenantContext(tenantId, (tx) =>
        nextSequenceValue(tx, tenantId, "sale_barcode:20260824"),
      );
      const segundo = await prisma.withTenantContext(tenantId, (tx) =>
        nextSequenceValue(tx, tenantId, "sale_barcode:20260824"),
      );

      expect(primero).toBe(1n);
      expect(segundo).toBe(2n);
    });

    it("una key por DÍA reinicia sola: el día siguiente es otra serie", async () => {
      // La base del reinicio diario del código del ticket: no hay «reset», hay
      // una serie nueva por fecha. El día anterior conserva su cuenta.
      await prisma.withTenantContext(tenantId, (tx) =>
        nextSequenceValue(tx, tenantId, "sale_barcode:20260825"),
      );
      const delDiaNuevo = await prisma.withTenantContext(tenantId, (tx) =>
        nextSequenceValue(tx, tenantId, "sale_barcode:20260826"),
      );

      expect(delDiaNuevo).toBe(1n);
    });

    it("comparte atomicidad con nextFolio: la MISMA serie no entrega repetidos", async () => {
      const valores = await Promise.all(
        Array.from({ length: 10 }, () =>
          prisma.withTenantContext(tenantId, (tx) =>
            nextSequenceValue(tx, tenantId, "sale_barcode:concurrencia"),
          ),
        ),
      );

      expect(new Set(valores.map(String)).size).toBe(10);
    });
  });
});
