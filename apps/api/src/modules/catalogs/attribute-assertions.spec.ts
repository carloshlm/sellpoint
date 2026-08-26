import { BadRequestException, ConflictException } from "@nestjs/common";
import type { AuthUser } from "../auth/types/auth-user";
import { assertSystemCatalogAttributes, assertValidAttributes } from "./attribute-assertions";
import type { FieldDefinition } from "./validate-attributes";

const USER: AuthUser = { userId: "u1", tenantId: "t1", permissions: [], locale: "es" };

const textField = (key: string, required = false): FieldDefinition => ({
  key,
  fieldType: "text",
  required,
  isArchived: false,
  lookupCatalogId: null,
});

function buildTx(overrides?: {
  catalog?: { id: string } | null;
  lookupTarget?: { id: string } | null;
  fields?: FieldDefinition[];
}) {
  // `?? default` NO sirve acá: `catalog: null` es un valor deliberado (el
  // catálogo no existe), no una ausencia.
  const catalog = overrides && "catalog" in overrides ? overrides.catalog : { id: "cat-1" };
  return {
    catalog: {
      findFirst: jest.fn().mockResolvedValue(catalog),
    },
    catalogField: {
      findMany: jest.fn().mockResolvedValue(overrides?.fields ?? []),
    },
    catalogRecord: {
      findFirst: jest.fn().mockResolvedValue(overrides?.lookupTarget ?? null),
    },
  } as never;
}

describe("attribute-assertions (helper compartido, 2026-08-26)", () => {
  it("attributes válidos pasan sin excepción", async () => {
    await expect(
      assertValidAttributes(buildTx(), USER, [textField("color")], { color: "rojo" }, "x.invalid"),
    ).resolves.toBeUndefined();
  });

  it("los errores del validador viajan con la clave del LLAMADOR", async () => {
    await expect(
      assertValidAttributes(
        buildTx(),
        USER,
        [textField("color", true)],
        {},
        "warehouses.invalid_attributes",
      ),
    ).rejects.toMatchObject({
      response: {
        message: "warehouses.invalid_attributes",
        errors: [{ key: "color", message: "catalogs.field_required" }],
      },
    });
  });

  it("un lookup hacia un registro inexistente se rechaza", async () => {
    const lookup: FieldDefinition = {
      key: "region",
      fieldType: "lookup",
      required: false,
      isArchived: false,
      lookupCatalogId: "cat-regiones",
    };

    await expect(
      assertValidAttributes(
        buildTx({ lookupTarget: null }),
        USER,
        [lookup],
        { region: "550e8400-e29b-41d4-a716-446655440000" },
        "x.invalid",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sin catálogo del sistema truena FUERTE con la clave del llamador", async () => {
    await expect(
      assertSystemCatalogAttributes(
        buildTx({ catalog: null }),
        USER,
        "warehouses",
        {},
        { invalid: "warehouses.invalid_attributes", catalogMissing: "warehouses.catalog_missing" },
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { message: "warehouses.catalog_missing" },
    });
  });

  it("resuelve el catálogo por systemKey y valida contra SUS campos", async () => {
    const tx = buildTx({ fields: [textField("encargado", true)] });

    await expect(
      assertSystemCatalogAttributes(
        tx,
        USER,
        "warehouses",
        {},
        {
          invalid: "warehouses.invalid_attributes",
          catalogMissing: "warehouses.catalog_missing",
        },
      ),
    ).rejects.toMatchObject({
      response: { errors: [{ key: "encargado", message: "catalogs.field_required" }] },
    });

    expect((tx as { catalog: { findFirst: jest.Mock } }).catalog.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "t1", systemKey: "warehouses" },
      select: { id: true },
    });
  });
});
