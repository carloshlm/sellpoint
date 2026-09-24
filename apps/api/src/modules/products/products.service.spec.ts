import type { AuthUser } from "../auth/types/auth-user";
import type { CreateProductDto, UpdateProductDto } from "./dto/upsert-product.dto";
import { ProductsService } from "./products.service";

/**
 * F10-MANFIX-06 — encender el control por lote es de Plus.
 *
 * El flag `lots` no se puede exigir por RUTA: `POST /products` y
 * `PATCH /products/:id` son de todos los planes y solo UNA casilla del cuerpo
 * es de Plus. Por eso el candado vive en el servicio y mira el CAMBIO, no el
 * valor: encender (dar de alta con la casilla, o pasarla de apagada a
 * encendida) responde el mismo 402 que el guard; lo que ya lleva lote se sigue
 * guardando igual, y apagarlo se permite. Es la LEY de F9-PLANLIST: quien baja
 * de plan conserva lo que ya hizo.
 *
 * El camino contra la base lo prueba el e2e `billing-plan-gates`.
 */
describe("ProductsService — el candado de lotes (F10-MANFIX-06)", () => {
  const PLAN_PRO = { planCode: "pro", features: { lots: false } };
  const PLAN_PLUS = { planCode: "plus", features: { lots: true } };

  const PRODUCTO = {
    id: "p-1",
    sku: "LECHE-1L",
    name: "Leche 1 L",
    baseUnit: "unit",
    isActive: true,
    tracksLots: false,
  };

  const tx = {
    catalog: { findFirst: jest.fn() },
    catalogField: { findMany: jest.fn() },
    product: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    productPresentation: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    stockLot: { findMany: jest.fn() },
  };
  const auditar = jest.fn();
  const resolverPlan = jest.fn();

  const service = new ProductsService(
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    { withTenantContext: (_t: string, cb: (tx: unknown) => unknown) => cb(tx) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    { record: auditar } as any,
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    { resolve: resolverPlan } as any,
  );

  const usuario: AuthUser = { tenantId: "t-1", userId: "u-1", permissions: [], locale: "es" };
  const meta = { ip: "127.0.0.1", userAgent: "jest" };

  const alta = (tracksLots: boolean) => {
    const dto: CreateProductDto = {
      sku: "LECHE-1L",
      name: "Leche 1 L",
      baseUnit: "unit",
      stockMin: 0,
      isComposite: false,
      tracksLots,
      attributes: {},
    };
    return service.create(usuario, dto, meta);
  };
  const editar = (cambios: UpdateProductDto) => service.update(usuario, "p-1", cambios, meta);

  /** El 402 del guard, con su `feature` y el plan de quien lo pidió. */
  const candadoDeLotes = {
    status: 402,
    response: {
      message: "billing.feature_not_in_plan",
      args: { feature: "lots", planCode: "pro" },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.catalog.findFirst.mockResolvedValue({ id: "cat-productos" });
    tx.catalogField.findMany.mockResolvedValue([]);
    tx.product.create.mockResolvedValue(PRODUCTO);
    tx.product.findFirst.mockResolvedValue(PRODUCTO);
    tx.product.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...PRODUCTO, ...data }),
    );
    tx.productPresentation.create.mockResolvedValue({});
    tx.stockLot.findMany.mockResolvedValue([]);
    auditar.mockResolvedValue(undefined);
    resolverPlan.mockResolvedValue(PLAN_PLUS);
  });

  describe("al dar de alta", () => {
    it("sin `lots` en el plan, crear con la casilla encendida es 402 y no escribe nada", async () => {
      resolverPlan.mockResolvedValue(PLAN_PRO);

      await expect(alta(true)).rejects.toMatchObject(candadoDeLotes);
      expect(tx.product.create).not.toHaveBeenCalled();
    });

    it("con `lots` en el plan, el alta con lote se guarda", async () => {
      await alta(true);

      expect(tx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tracksLots: true }) }),
      );
    });

    it("con la casilla apagada, el alta ni siquiera consulta el plan", async () => {
      resolverPlan.mockResolvedValue(PLAN_PRO);

      await alta(false);

      expect(resolverPlan).not.toHaveBeenCalled();
      expect(tx.product.create).toHaveBeenCalled();
    });
  });

  describe("al editar", () => {
    it("sin `lots`, pasar la casilla de apagada a encendida es 402 y no escribe nada", async () => {
      resolverPlan.mockResolvedValue(PLAN_PRO);

      await expect(editar({ tracksLots: true })).rejects.toMatchObject(candadoDeLotes);
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it("con `lots`, encenderla se guarda", async () => {
      await editar({ tracksLots: true });

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tracksLots: true }) }),
      );
    });

    it("sin `lots`, un producto que YA lleva lote se guarda con la casilla encendida", async () => {
      // El formulario manda la casilla en cada guardado: editar el nombre de
      // un producto con lote, heredado de cuando el negocio era Plus, no es
      // encender nada.
      resolverPlan.mockResolvedValue(PLAN_PRO);
      tx.product.findFirst.mockResolvedValue({ ...PRODUCTO, tracksLots: true });

      await editar({ name: "Leche entera 1 L", tracksLots: true });

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Leche entera 1 L", tracksLots: true }),
        }),
      );
    });

    it("sin `lots`, apagar la casilla se permite", async () => {
      resolverPlan.mockResolvedValue(PLAN_PRO);
      tx.product.findFirst.mockResolvedValue({ ...PRODUCTO, tracksLots: true });

      await editar({ tracksLots: false });

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tracksLots: false }) }),
      );
    });

    it("una edición que no toca la casilla no consulta el plan", async () => {
      resolverPlan.mockResolvedValue(PLAN_PRO);

      await editar({ name: "Leche entera 1 L" });

      expect(resolverPlan).not.toHaveBeenCalled();
      expect(tx.product.update).toHaveBeenCalled();
    });
  });
});
