import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { expandComposition } from "./composition-expander";
import type { ResolvedLine } from "./line-resolver";

/**
 * Integration (Postgres real) — F3-CORE-06: un compuesto no tiene existencias
 * propias, así que sacarlo del almacén significa sacar sus COMPONENTES.
 *
 * La fórmula tiene que ser la MISMA que usa `availability` para decir "alcanza
 * para N": si difirieran, la pantalla prometería 50 cafés y el ledger dejaría
 * de servir al 47.
 */
describe("expandComposition (F3-CORE-06)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let cafeId: string;
  let azucarId: string;
  let vasoId: string;
  let comboId: string;
  let sinComposicionId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant compo ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const nuevo = (sku: string, name: string, isComposite = false) =>
        tx.product.create({ data: { tenantId, sku: `${sku}-${stamp}`, name, isComposite } });

      const [azucar, vaso, cafe, combo, sinComposicion] = await Promise.all([
        nuevo("AZU", "Azúcar"),
        nuevo("VAS", "Vaso"),
        nuevo("CAF", "Café", true),
        nuevo("CMB", "Combo desayuno", true),
        nuevo("SIN", "Compuesto vacío", true),
      ]);

      // Café = 20 gr de azúcar (10% de merma) + 1 vaso.
      await tx.productComposition.create({
        data: {
          tenantId,
          parentProductId: cafe.id,
          componentProductId: azucar.id,
          quantity: 20,
          wastePercentage: 10,
        },
      });
      await tx.productComposition.create({
        data: { tenantId, parentProductId: cafe.id, componentProductId: vaso.id, quantity: 1 },
      });
      // Combo = 2 cafés. Anidado: el combo lleva un compuesto.
      await tx.productComposition.create({
        data: { tenantId, parentProductId: combo.id, componentProductId: cafe.id, quantity: 2 },
      });

      azucarId = azucar.id;
      vasoId = vaso.id;
      cafeId = cafe.id;
      comboId = combo.id;
      sinComposicionId = sinComposicion.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const linea = (productId: string, quantity: number): ResolvedLine => ({
    lineIndex: 0,
    productId,
    sku: "X",
    presentationId: null,
    quantityBase: new Prisma.Decimal(quantity),
    quantityInput: new Prisma.Decimal(quantity),
    unitCost: null,
    expand: true,
  });

  const expand = (lines: ResolvedLine[]) =>
    prisma.withTenantContext(tenantId, (tx) => expandComposition(tx, tenantId, lines));

  it("un café descuenta 22 gr de azúcar (20 + 10% de merma) y 1 vaso", async () => {
    const result = await expand([linea(cafeId, 1)]);
    const porProducto = new Map(result.map((l) => [l.productId, l.quantityBase.toString()]));

    expect(porProducto.get(azucarId)).toBe("22");
    expect(porProducto.get(vasoId)).toBe("1");
  });

  it("tres cafés multiplican: 66 gr de azúcar", async () => {
    const result = await expand([linea(cafeId, 3)]);

    expect(result.find((l) => l.productId === azucarId)?.quantityBase.toString()).toBe("66");
  });

  /**
   * El anidado: el combo lleva 2 cafés, y cada café 22 gr de azúcar. Nadie
   * captura "44 gr" — se deduce recorriendo el grafo, y si el recorrido se
   * detuviera en el primer nivel el saldo del azúcar nunca bajaría.
   */
  it("un compuesto DENTRO de otro se expande hasta el fondo", async () => {
    const result = await expand([linea(comboId, 1)]);
    const porProducto = new Map(result.map((l) => [l.productId, l.quantityBase.toString()]));

    expect(porProducto.get(azucarId)).toBe("44");
    expect(porProducto.get(vasoId)).toBe("2");
    // El café intermedio NO aparece: no tiene existencias propias.
    expect(porProducto.has(cafeId)).toBe(false);
  });

  it("cada componente recuerda de qué compuesto salió, para que el kardex lo explique", async () => {
    const result = await expand([linea(comboId, 1)]);

    for (const line of result) {
      expect(line.parentProductId).toBe(comboId);
    }
  });

  it("las líneas expandidas no llevan presentación: ya están en unidad base", async () => {
    const result = await expand([linea(cafeId, 1)]);

    expect(result.every((l) => l.presentationId === null)).toBe(true);
  });

  it("dos líneas del mismo compuesto agregan por componente en vez de duplicar", async () => {
    const result = await expand([linea(cafeId, 1), { ...linea(cafeId, 2), lineIndex: 1 }]);
    const azucar = result.filter((l) => l.productId === azucarId);

    expect(azucar).toHaveLength(1);
    expect(azucar[0]?.quantityBase.toString()).toBe("66");
  });

  it("un compuesto sin componentes definidos se rechaza en vez de descontar nada", async () => {
    await expect(expand([linea(sinComposicionId, 1)])).rejects.toThrow(ConflictException);
  });

  it("las líneas que no son compuestas pasan de largo", async () => {
    const simple = { ...linea(azucarId, 5), expand: false };

    const result = await expand([simple]);

    expect(result).toHaveLength(1);
    expect(result[0]?.productId).toBe(azucarId);
  });
});
