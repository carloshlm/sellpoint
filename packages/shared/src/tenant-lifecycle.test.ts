import { describe, expect, it } from "vitest";
import {
  deleteTenantSchema,
  suspendTenantSchema,
  TENANT_DELETE_COOLING_DAYS,
  tenantLifecycle,
} from "./tenant-lifecycle";

/**
 * F7-LIFECYCLE-01 — la regla del ciclo de vida de un negocio es CÓDIGO
 * compartido: el API decide con ella si se puede eliminar y el web pinta
 * con ella «se podrá eliminar a partir de…». Una sola verdad para el
 * enfriamiento de 30 días.
 */
describe("tenantLifecycle (F7-LIFECYCLE-01)", () => {
  const AHORA = new Date("2026-09-04T18:00:00.000Z");

  it("el enfriamiento son 30 días", () => {
    expect(TENANT_DELETE_COOLING_DAYS).toBe(30);
  });

  it("sin suspendedAt el negocio está activo y no es eliminable", () => {
    expect(tenantLifecycle({ suspendedAt: null }, AHORA)).toEqual({
      suspended: false,
      suspendedDays: 0,
      deletableAt: null,
      deletable: false,
    });
  });

  it("suspendido hace 29 días: todavía no, y dice desde cuándo sí", () => {
    const hace29 = new Date(AHORA.getTime() - 29 * 24 * 60 * 60 * 1000);
    const resultado = tenantLifecycle({ suspendedAt: hace29 }, AHORA);
    expect(resultado.suspended).toBe(true);
    expect(resultado.suspendedDays).toBe(29);
    expect(resultado.deletable).toBe(false);
    expect(resultado.deletableAt?.toISOString()).toBe("2026-09-05T18:00:00.000Z");
  });

  it("suspendido hace exactamente 30 días: eliminable", () => {
    const hace30 = new Date(AHORA.getTime() - 30 * 24 * 60 * 60 * 1000);
    const resultado = tenantLifecycle({ suspendedAt: hace30 }, AHORA);
    expect(resultado.suspendedDays).toBe(30);
    expect(resultado.deletable).toBe(true);
  });

  it("acepta la fecha como texto ISO (así viaja por el API)", () => {
    const resultado = tenantLifecycle({ suspendedAt: "2026-07-01T00:00:00.000Z" }, AHORA);
    expect(resultado.suspended).toBe(true);
    expect(resultado.suspendedDays).toBe(65);
    expect(resultado.deletable).toBe(true);
  });

  it("los días se cuentan completos, sin redondear hacia arriba", () => {
    const hace2ymedio = new Date(AHORA.getTime() - 2.5 * 24 * 60 * 60 * 1000);
    expect(tenantLifecycle({ suspendedAt: hace2ymedio }, AHORA).suspendedDays).toBe(2);
  });
});

describe("los DTO del ciclo de vida", () => {
  it("el motivo de la suspensión va de 5 a 300 caracteres, recortado", () => {
    expect(suspendTenantSchema.safeParse({ reason: "  Impago reiterado  " }).data).toEqual({
      reason: "Impago reiterado",
    });
    expect(suspendTenantSchema.safeParse({ reason: "abcd" }).success).toBe(false);
    expect(suspendTenantSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
    expect(suspendTenantSchema.safeParse({}).success).toBe(false);
  });

  it("eliminar exige contraseña y el nombre a confirmar, sin recortar la contraseña", () => {
    expect(
      deleteTenantSchema.safeParse({ password: " secreta ", confirmName: " Negocio ONE " }).data,
    ).toEqual({ password: " secreta ", confirmName: "Negocio ONE" });
    expect(deleteTenantSchema.safeParse({ password: "", confirmName: "X" }).success).toBe(false);
    expect(deleteTenantSchema.safeParse({ password: "x", confirmName: "  " }).success).toBe(false);
  });
});
