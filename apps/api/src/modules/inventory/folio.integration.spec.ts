import { ConfigService } from "@nestjs/config";
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

  const take = (owner: string, key: string, prefix: string) =>
    prisma.withTenantContext(owner, (tx) => nextFolio(tx, owner, key, prefix));

  it("la primera vez de un tenant en una serie es el 1, con seis dígitos", async () => {
    await expect(take(tenantId, "entry", "ENT")).resolves.toBe("ENT-000001");
  });

  it("cada tenant lleva su propia cuenta: los dos arrancan en 1", async () => {
    await take(tenantId, "exit", "SAL");
    await take(tenantId, "exit", "SAL");

    await expect(take(otherTenantId, "exit", "SAL")).resolves.toBe("SAL-000001");
  });

  it("las series del mismo tenant no se pisan entre sí", async () => {
    const [entry, count] = await Promise.all([
      take(otherTenantId, "entry", "ENT"),
      take(otherTenantId, "physical_count", "INV"),
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
    const key = "concurrent";
    const folios = await Promise.all(Array.from({ length: 20 }, () => take(tenantId, key, "ENT")));

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
    const key = "rollback";
    await take(tenantId, key, "ENT");

    await expect(
      prisma.withTenantContext(tenantId, async (tx) => {
        await nextFolio(tx, tenantId, key, "ENT");
        throw new Error("algo salió mal después de tomar el folio");
      }),
    ).rejects.toThrow();

    await expect(take(tenantId, key, "ENT")).resolves.toBe("ENT-000002");
  });

  it("pasado el millón sigue creciendo en vez de romperse", async () => {
    const key = "big";
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.tenantSequence.create({ data: { tenantId, key, nextValue: 999_999n } }),
    );

    await expect(take(tenantId, key, "ENT")).resolves.toBe("ENT-1000000");
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
