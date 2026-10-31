import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { type AddressValidationErrors, withValidatedTenantAddress } from "./address-validation";

/**
 * La regla de dirección por país del NEGOCIO, una sola para Sucursales y
 * Proveedores. Lo que fija:
 *  - sin región ni CP no se consulta el país;
 *  - una región que no es del país rebota con la excepción de QUIEN LLAMA;
 *  - el CP se normaliza (`M5V 3L9`) y uno mal formado rebota igual;
 *  - el CP vacío queda en `null`, y `null` pasa sin tocarse.
 */
describe("withValidatedTenantAddress", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  let tx: { tenant: { findUniqueOrThrow: jest.Mock } };

  const almacen: AddressValidationErrors = {
    invalidRegion: () => new UnprocessableEntityException({ message: "warehouses.invalid_region" }),
    invalidPostalCode: () =>
      new UnprocessableEntityException({ message: "warehouses.invalid_postal_code" }),
  };
  const proveedor: AddressValidationErrors = {
    invalidRegion: () => new BadRequestException({ message: "suppliers.invalid_region" }),
    invalidPostalCode: () => new BadRequestException({ message: "suppliers.invalid_postal_code" }),
  };

  const conPais = (country: string | null) => {
    tx.tenant.findUniqueOrThrow.mockResolvedValue({ country });
  };

  const validar = <T extends { region?: string | null; postalCode?: string | null }>(
    input: T,
    errors: AddressValidationErrors = almacen,
  ) =>
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial de la tx a propósito
    withValidatedTenantAddress(tx as any, TENANT, input, errors);

  beforeEach(() => {
    tx = { tenant: { findUniqueOrThrow: jest.fn() } };
  });

  it("sin región ni CP no consulta el país y devuelve lo mismo", async () => {
    const input = { city: "Guadalajara", region: undefined, postalCode: undefined };
    await expect(validar(input)).resolves.toBe(input);
    await expect(validar({ region: null, postalCode: null })).resolves.toEqual({
      region: null,
      postalCode: null,
    });
    expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("lee el país del negocio que le pasas", async () => {
    conPais("MX");
    await validar({ region: "JAL" });
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: TENANT },
      select: { country: true },
    });
  });

  it("una región de otro país rebota con la excepción de Sucursales", async () => {
    conPais("MX");
    const error = await validar({ region: "ON" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      message: "warehouses.invalid_region",
    });
  });

  it("la misma región rebota con la excepción de Proveedores cuando llama Proveedores", async () => {
    conPais("MX");
    const error = await validar({ region: "ON" }, proveedor).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: "suppliers.invalid_region",
    });
  });

  it("un país que no pide región rechaza cualquiera", async () => {
    conPais("ES");
    await expect(validar({ region: "MD" })).rejects.toThrow(UnprocessableEntityException);
  });

  it("el CP se normaliza al formato del país y uno mal formado rebota", async () => {
    conPais("CA");
    await expect(validar({ postalCode: "m5v3l9" })).resolves.toEqual({ postalCode: "M5V 3L9" });
    conPais("MX");
    await expect(validar({ region: "JAL", postalCode: " 44100 " })).resolves.toEqual({
      region: "JAL",
      postalCode: "44100",
    });
    const error = await validar({ postalCode: "4410" }, proveedor).catch((e: unknown) => e);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: "suppliers.invalid_postal_code",
    });
    await expect(validar({ postalCode: "4410" })).rejects.toMatchObject({
      response: { message: "warehouses.invalid_postal_code" },
    });
  });

  it("un CP vacío queda en null y el resto del input viaja intacto", async () => {
    conPais("MX");
    await expect(validar({ city: "León", postalCode: "  " })).resolves.toEqual({
      city: "León",
      postalCode: null,
    });
  });

  it("sin país del negocio, cualquier CP vale pero ninguna región", async () => {
    conPais(null);
    await expect(validar({ postalCode: "abc 123" })).resolves.toEqual({ postalCode: "ABC 123" });
    await expect(validar({ region: "JAL" })).rejects.toThrow(UnprocessableEntityException);
  });
});
